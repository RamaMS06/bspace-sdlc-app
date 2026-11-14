//! Where secrets live: the OS keychain, with a 0600 file only where there is no keychain. Holds the
//! Buma sign-in token, the Your API provider key and the Azure DevOps sign-in.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Keychain service name for every stored token.
pub const SERVICE: &str = "com.buma.bspace-sdlc-app";

/// Why a token store call failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StoreError {
    /// There's no keychain on this computer (no backend, no Secret Service): auth.json stands in.
    Unavailable(String),
    /// The keychain is there but said no (the user clicked Deny, or it stayed locked). Never a
    /// reason to put the token in a file instead.
    Refused(String),
    /// Anything else, such as auth.json that couldn't be written.
    Failed(String),
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unavailable(e) => write!(f, "no keychain: {e}"),
            Self::Refused(e) => write!(f, "the keychain refused: {e}"),
            Self::Failed(e) => f.write_str(e),
        }
    }
}

pub(crate) fn io_err(e: impl ToString) -> StoreError {
    StoreError::Failed(e.to_string())
}

/// Where sign-in tokens live, by keychain account. Injectable so tests never touch the OS keychain.
pub trait TokenStore: Send + Sync {
    fn get(&self, account: &str) -> Result<Option<String>, StoreError>;
    fn set(&self, account: &str, token: &str) -> Result<(), StoreError>;
    /// Deleting a token that isn't there is not an error.
    fn delete(&self, account: &str) -> Result<(), StoreError>;
}

/// In-memory store, for tests.
#[cfg(test)]
#[derive(Default)]
pub struct MemoryStore(std::sync::Mutex<std::collections::HashMap<String, String>>);

#[cfg(test)]
impl TokenStore for MemoryStore {
    fn get(&self, account: &str) -> Result<Option<String>, StoreError> {
        Ok(self.0.lock().unwrap_or_else(|e| e.into_inner()).get(account).cloned())
    }
    fn set(&self, account: &str, token: &str) -> Result<(), StoreError> {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).insert(account.into(), token.into());
        Ok(())
    }
    fn delete(&self, account: &str) -> Result<(), StoreError> {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).remove(account);
        Ok(())
    }
}

/// The OS keychain (macOS Keychain, Windows Credential Manager, Secret Service on Linux).
pub struct KeyringStore;

impl KeyringStore {
    fn entry(account: &str) -> Result<keyring::Entry, StoreError> {
        keyring::Entry::new(SERVICE, account).map_err(classify)
    }
}

/// Only "there is no keychain here" is `Unavailable`; a keychain that is there but says no
/// (Deny, a dismissed or locked prompt) is `Refused`.
/// - macOS: no keychain / not available is `NoStorageAccess`; Deny is a `PlatformFailure`
///   (errSecUserCanceled, errSecAuthFailed).
/// - Windows: `NoStorageAccess` is no logon session.
/// - Linux: no Secret Service on the bus fails to connect, a `PlatformFailure`; a locked
///   collection or a dismissed prompt is `NoStorageAccess`.
pub fn classify(e: keyring::Error) -> StoreError {
    let none_here = if cfg!(target_os = "linux") {
        matches!(e, keyring::Error::PlatformFailure(_))
    } else {
        matches!(e, keyring::Error::NoStorageAccess(_))
    };
    if none_here {
        StoreError::Unavailable(e.to_string())
    } else {
        StoreError::Refused(e.to_string())
    }
}

impl TokenStore for KeyringStore {
    fn get(&self, account: &str) -> Result<Option<String>, StoreError> {
        match Self::entry(account)?.get_password() {
            Ok(t) => Ok(Some(t)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(classify(e)),
        }
    }
    fn set(&self, account: &str, token: &str) -> Result<(), StoreError> {
        Self::entry(account)?.set_password(token).map_err(classify)
    }
    fn delete(&self, account: &str) -> Result<(), StoreError> {
        match Self::entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(classify(e)),
        }
    }
}

/// `<app_data>/auth.json`, `{ account: token }`, readable by this user only (0600 on unix).
/// Used only when the keychain can't be.
pub struct FileStore {
    path: PathBuf,
}

impl FileStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    /// A missing or damaged file holds no tokens.
    fn read(&self) -> Result<FileMap, StoreError> {
        match std::fs::read(&self.path) {
            Ok(bytes) => Ok(serde_json::from_slice(&bytes).unwrap_or_default()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(FileMap::new()),
            Err(e) => Err(io_err(e)),
        }
    }

    /// Writes a fresh 0600 file and renames it into place; no tokens left means no file.
    fn write(&self, map: &FileMap) -> Result<(), StoreError> {
        if map.is_empty() {
            return match std::fs::remove_file(&self.path) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(io_err(e)),
                _ => Ok(()),
            };
        }
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(io_err)?;
        }
        let tmp = self.path.with_extension("json.tmp");
        let _ = std::fs::remove_file(&tmp);
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut opts, 0o600);
        let body = serde_json::to_vec(map).map_err(io_err)?;
        let written = opts.open(&tmp).and_then(|mut f| {
            std::io::Write::write_all(&mut f, &body)?;
            f.sync_all()
        });
        if let Err(e) = written.and_then(|_| std::fs::rename(&tmp, &self.path)) {
            let _ = std::fs::remove_file(&tmp);
            return Err(io_err(e));
        }
        Ok(())
    }
}

impl TokenStore for FileStore {
    fn get(&self, account: &str) -> Result<Option<String>, StoreError> {
        Ok(self.read()?.remove(account))
    }
    fn set(&self, account: &str, token: &str) -> Result<(), StoreError> {
        let mut map = self.read()?;
        map.insert(account.into(), token.into());
        self.write(&map)
    }
    fn delete(&self, account: &str) -> Result<(), StoreError> {
        let mut map = self.read()?;
        if map.remove(account).is_none() {
            return Ok(());
        }
        self.write(&map)
    }
}

/// The keychain, falling back to the file only when there is no keychain at all. A keychain
/// that refuses (Deny) is an error, never a quiet move to the file. The fallback is logged once.
pub struct SecureStore<K: TokenStore> {
    keychain: K,
    file: FileStore,
    warned: AtomicBool,
}

impl<K: TokenStore> SecureStore<K> {
    pub fn new(keychain: K, file: FileStore) -> Self {
        Self { keychain, file, warned: AtomicBool::new(false) }
    }

    fn fallback(&self, why: &StoreError) {
        if !self.warned.swap(true, Ordering::Relaxed) {
            eprintln!("[auth] the keychain isn't available ({why}); keeping the sign-in token in auth.json instead");
        }
    }
}

impl<K: TokenStore> TokenStore for SecureStore<K> {
    /// The keychain first; the file holds a token saved while there was no keychain.
    fn get(&self, account: &str) -> Result<Option<String>, StoreError> {
        match self.keychain.get(account) {
            Ok(Some(t)) => Ok(Some(t)),
            Ok(None) => self.file.get(account),
            Err(e @ StoreError::Unavailable(_)) => {
                self.fallback(&e);
                self.file.get(account)
            }
            Err(e) => Err(e),
        }
    }
    fn set(&self, account: &str, token: &str) -> Result<(), StoreError> {
        match self.keychain.set(account, token) {
            Ok(()) => {
                // A copy from a keychain outage would otherwise linger in the file.
                let _ = self.file.delete(account);
                Ok(())
            }
            Err(e @ StoreError::Unavailable(_)) => {
                self.fallback(&e);
                self.file.set(account, token)
            }
            Err(e) => Err(e),
        }
    }
    fn delete(&self, account: &str) -> Result<(), StoreError> {
        let keychain = self.keychain.delete(account);
        let file = self.file.delete(account);
        match keychain {
            Ok(()) => Ok(()),
            Err(e @ StoreError::Unavailable(_)) => {
                self.fallback(&e);
                file
            }
            Err(e) => Err(e),
        }
    }
}

type FileMap = BTreeMap<String, String>;

/// Secrets other than the sign-in token: the Your API provider key and the Azure DevOps sign-in. Kept
/// in the keychain like the sign-in token (a file only when there is no keychain); dev builds use a
/// 0600 file for the reason given at `app::setup::auth_manager`.
pub(crate) struct ApiKeys(pub Arc<dyn TokenStore>);

impl ApiKeys {
    pub(crate) fn new(data_dir: &Path) -> Self {
        let store: Arc<dyn TokenStore> = if cfg!(debug_assertions) {
            Arc::new(FileStore::new(data_dir.join("api-key-dev.json")))
        } else {
            Arc::new(SecureStore::new(KeyringStore, FileStore::new(data_dir.join("api-key.json"))))
        };
        Self(store)
    }

    /// The keychain can block or ask, so it runs off the async threads.
    pub(crate) async fn get_account(&self, account: &'static str) -> Result<Option<String>, String> {
        let store = self.0.clone();
        tauri::async_runtime::spawn_blocking(move || store.get(account)).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())
    }

    pub(crate) async fn set_account(&self, account: &'static str, key: String) -> Result<(), String> {
        let store = self.0.clone();
        tauri::async_runtime::spawn_blocking(move || store.set(account, &key)).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())
    }

    pub(crate) async fn delete_account(&self, account: &'static str) -> Result<(), String> {
        let store = self.0.clone();
        tauri::async_runtime::spawn_blocking(move || store.delete(account)).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())
    }

    /// The Your API provider key.
    pub(crate) async fn get(&self) -> Result<Option<String>, String> {
        self.get_account(crate::domain::api_engine::KEY_ACCOUNT).await
    }

    pub(crate) async fn set(&self, key: String) -> Result<(), String> {
        self.set_account(crate::domain::api_engine::KEY_ACCOUNT, key).await
    }

    pub(crate) async fn delete(&self) -> Result<(), String> {
        self.delete_account(crate::domain::api_engine::KEY_ACCOUNT).await
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A keychain that always fails the same way.
    pub(crate) struct Broken(StoreError);
    impl TokenStore for Broken {
        fn get(&self, _: &str) -> Result<Option<String>, StoreError> {
            Err(self.0.clone())
        }
        fn set(&self, _: &str, _: &str) -> Result<(), StoreError> {
            Err(self.0.clone())
        }
        fn delete(&self, _: &str) -> Result<(), StoreError> {
            Err(self.0.clone())
        }
    }

    pub(crate) fn no_keychain() -> Broken {
        Broken(StoreError::Unavailable("no backend".into()))
    }

    pub(crate) fn denied() -> Broken {
        Broken(StoreError::Refused("user canceled".into()))
    }

    #[test]
    fn file_store_round_trips_per_account() {
        let dir = tempfile::tempdir().unwrap();
        let f = FileStore::new(dir.path().join("auth.json"));
        assert_eq!(f.get("api:a").unwrap(), None);
        f.set("api:a", "tyg_a").unwrap();
        f.set("api:b", "tyg_b").unwrap();
        assert_eq!(f.get("api:a").unwrap().as_deref(), Some("tyg_a"));
        f.delete("api:a").unwrap();
        f.delete("api:a").unwrap();
        assert_eq!(f.get("api:a").unwrap(), None);
        assert_eq!(f.get("api:b").unwrap().as_deref(), Some("tyg_b"));
        f.delete("api:b").unwrap();
        assert!(!dir.path().join("auth.json").exists(), "no tokens, no file");
    }

    #[cfg(unix)]
    #[test]
    fn file_store_is_private_to_the_user() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth.json");
        std::fs::write(&path, "{}").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        FileStore::new(path.clone()).set("api:a", "tyg_a").unwrap();
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
    }

    #[test]
    fn file_store_survives_a_damaged_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth.json");
        std::fs::write(&path, "not json").unwrap();
        let f = FileStore::new(path);
        assert_eq!(f.get("api:a").unwrap(), None);
        f.set("api:a", "tyg_a").unwrap();
        assert_eq!(f.get("api:a").unwrap().as_deref(), Some("tyg_a"));
    }

    #[test]
    fn secure_store_uses_the_keychain_and_leaves_no_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth.json");
        let s = SecureStore::new(MemoryStore::default(), FileStore::new(path.clone()));
        s.set("api:a", "tyg_a").unwrap();
        assert_eq!(s.get("api:a").unwrap().as_deref(), Some("tyg_a"));
        assert!(!path.exists());
        assert_eq!(s.keychain.get("api:a").unwrap().as_deref(), Some("tyg_a"));
        s.delete("api:a").unwrap();
        assert_eq!(s.get("api:a").unwrap(), None);
    }

    #[test]
    fn secure_store_falls_back_to_the_file_when_there_is_no_keychain() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth.json");
        let s = SecureStore::new(no_keychain(), FileStore::new(path.clone()));
        s.set("api:a", "tyg_a").unwrap();
        assert!(path.exists());
        assert!(s.warned.load(Ordering::Relaxed));
        assert_eq!(s.get("api:a").unwrap().as_deref(), Some("tyg_a"));
        s.delete("api:a").unwrap();
        assert_eq!(s.get("api:a").unwrap(), None);
    }

    #[test]
    fn a_keychain_that_says_no_is_an_error_and_never_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth.json");
        let s = SecureStore::new(denied(), FileStore::new(path.clone()));
        assert!(matches!(s.set("api:a", "tyg_a"), Err(StoreError::Refused(_))));
        assert!(!path.exists(), "a Deny never moves the token to a file");
        assert!(!s.warned.load(Ordering::Relaxed));
        assert!(matches!(s.get("api:a"), Err(StoreError::Refused(_))));
        assert!(matches!(s.delete("api:a"), Err(StoreError::Refused(_))));
    }

    #[test]
    fn keychain_errors_are_sorted_into_none_here_and_said_no() {
        let boxed = || -> Box<dyn std::error::Error + Send + Sync> { "x".into() };
        let (none_here, said_no) = if cfg!(target_os = "linux") {
            (keyring::Error::PlatformFailure(boxed()), keyring::Error::NoStorageAccess(boxed()))
        } else {
            (keyring::Error::NoStorageAccess(boxed()), keyring::Error::PlatformFailure(boxed()))
        };
        assert!(matches!(classify(none_here), StoreError::Unavailable(_)));
        assert!(matches!(classify(said_no), StoreError::Refused(_)));
    }

    #[test]
    fn a_token_saved_while_the_keychain_was_down_is_still_found_and_moves_on_the_next_save() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth.json");
        FileStore::new(path.clone()).set("api:a", "tyg_old").unwrap();
        let s = SecureStore::new(MemoryStore::default(), FileStore::new(path.clone()));
        assert_eq!(s.get("api:a").unwrap().as_deref(), Some("tyg_old"));
        s.set("api:a", "tyg_new").unwrap();
        assert!(!path.exists(), "the file copy is removed once the keychain holds the token");
        s.delete("api:a").unwrap();
        assert_eq!(s.get("api:a").unwrap(), None);
    }
}
