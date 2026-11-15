//! An Android emulator (or a phone on USB) shown and driven inside the app: the screen comes from `adb`
//! screenshots and taps, swipes, keys and typing go back through `adb`, so the Build stage can show the
//! app being built without opening Android Studio. The Android SDK has to be installed; the app only
//! looks at it and never changes it.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::process::Command;

const CALL_TIMEOUT: Duration = Duration::from_secs(15);

/// The SDK tools this app drives.
#[derive(Debug, Clone)]
pub struct Sdk {
    pub adb: PathBuf,
    pub emulator: Option<PathBuf>,
}

fn exe(dir: &Path, name: &str) -> Option<PathBuf> {
    let names = if cfg!(windows) { vec![format!("{name}.exe"), format!("{name}.bat")] } else { vec![name.to_string()] };
    names.iter().map(|n| dir.join(n)).find(|p| p.is_file())
}

/// The Android SDK folders to look in, best first: the environment's, then where Android Studio puts it.
pub fn sdk_roots(env: &dyn Fn(&str) -> Option<String>, home: Option<&Path>) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = ["ANDROID_HOME", "ANDROID_SDK_ROOT"].iter().filter_map(|k| env(k)).filter(|v| !v.is_empty()).map(PathBuf::from).collect();
    if let Some(h) = home {
        roots.push(h.join("Library").join("Android").join("sdk"));
        roots.push(h.join("Android").join("Sdk"));
    }
    if let Some(local) = env("LOCALAPPDATA") {
        roots.push(PathBuf::from(local).join("Android").join("Sdk"));
    }
    roots
}

/// `adb` and `emulator` from the first SDK folder that has `adb`, else from the PATH.
pub fn find_sdk(roots: &[PathBuf], on_path: &dyn Fn(&str) -> Option<PathBuf>) -> Option<Sdk> {
    for root in roots {
        if let Some(adb) = exe(&root.join("platform-tools"), "adb") {
            return Some(Sdk { adb, emulator: exe(&root.join("emulator"), "emulator").or_else(|| on_path("emulator")) });
        }
    }
    on_path("adb").map(|adb| Sdk { adb, emulator: on_path("emulator") })
}

/// The SDK on this computer.
pub fn sdk() -> Option<Sdk> {
    crate::infra::exec::refresh_shell_path();
    let env = |k: &str| std::env::var(k).ok();
    let home = crate::infra::exec::home_dir();
    let roots = sdk_roots(&env, home.as_deref());
    find_sdk(&roots, &|p| crate::infra::exec::Exec::which(&crate::infra::exec::RealExec, p))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub serial: String,
    pub name: String,
    /// `device` is ready; anything else (`offline`, `unauthorized`) can't be driven yet.
    pub state: String,
    pub emulator: bool,
}

/// What can be shown: the SDK's presence, the devices that are on, and the emulators that could be started.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub sdk: bool,
    pub devices: Vec<Device>,
    pub avds: Vec<String>,
}

/// `serial` is passed to adb as an argument: only what a serial looks like is allowed.
fn valid_serial(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | ':' | '-' | '_'))
}

async fn run(program: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let mut cmd = Command::new(program);
    cmd.args(args).env("PATH", crate::infra::exec::augmented_path()).stdin(std::process::Stdio::null()).kill_on_drop(true);
    let out = tokio::time::timeout(CALL_TIMEOUT, cmd.output())
        .await
        .map_err(|_| "The device didn't answer in time".to_string())?
        .map_err(|e| format!("Couldn't run {}: {e}", program.display()))?;
    if out.status.success() {
        return Ok(out.stdout);
    }
    let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
    Err(if err.is_empty() { "The device refused that".into() } else { err })
}

/// Parses `adb devices -l`.
pub fn parse_devices(out: &str) -> Vec<Device> {
    out.lines()
        .skip_while(|l| !l.starts_with("List of devices"))
        .skip(1)
        .filter_map(|l| {
            let mut parts = l.split_whitespace();
            let serial = parts.next()?.to_string();
            let state = parts.next()?.to_string();
            let rest: Vec<&str> = parts.collect();
            let field = |k: &str| rest.iter().find_map(|p| p.strip_prefix(k)).map(|v| v.replace('_', " "));
            let emulator = serial.starts_with("emulator-");
            let name = field("model:").or_else(|| field("device:")).unwrap_or_else(|| serial.clone());
            Some(Device { serial, name, state, emulator })
        })
        .collect()
}

pub async fn overview(sdk: Option<&Sdk>) -> Overview {
    let Some(sdk) = sdk else { return Overview { sdk: false, devices: vec![], avds: vec![] } };
    let devices = run(&sdk.adb, &["devices", "-l"]).await.map(|o| parse_devices(&String::from_utf8_lossy(&o))).unwrap_or_default();
    let avds = match &sdk.emulator {
        Some(e) => run(e, &["-list-avds"]).await.map(|o| String::from_utf8_lossy(&o).lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with("INFO")).map(str::to_string).collect()).unwrap_or_default(),
        None => vec![],
    };
    Overview { sdk: true, devices, avds }
}

/// Starts an emulator and returns at once; it shows up in `overview` when it has booted.
pub fn boot(sdk: &Sdk, avd: &str) -> Result<(), String> {
    let emulator = sdk.emulator.as_ref().ok_or("The Android emulator isn't installed. Add it in Android Studio's SDK Manager.")?;
    if avd.is_empty() || !avd.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.')) {
        return Err("That emulator name isn't valid".into());
    }
    Command::new(emulator)
        .args(["-avd", avd])
        .env("PATH", crate::infra::exec::augmented_path())
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Couldn't start the emulator: {e}"))
}

/// One frame: the screen as a PNG, with its size in device pixels.
#[derive(Debug)]
pub struct Frame {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// The size in an PNG's header.
pub fn png_size(png: &[u8]) -> Option<(u32, u32)> {
    if png.len() < 24 || &png[..8] != b"\x89PNG\r\n\x1a\n" {
        return None;
    }
    let n = |i: usize| u32::from_be_bytes([png[i], png[i + 1], png[i + 2], png[i + 3]]);
    Some((n(16), n(20)))
}

pub async fn screenshot(sdk: &Sdk, serial: &str) -> Result<Frame, String> {
    if !valid_serial(serial) {
        return Err("That device isn't valid".into());
    }
    let png = run(&sdk.adb, &["-s", serial, "exec-out", "screencap", "-p"]).await?;
    let (width, height) = png_size(&png).ok_or("The device didn't send a picture. It may be locked or still starting.")?;
    Ok(Frame { png, width, height })
}

pub async fn tap(sdk: &Sdk, serial: &str, x: u32, y: u32) -> Result<(), String> {
    input(sdk, serial, &["tap", &x.to_string(), &y.to_string()]).await
}

pub async fn swipe(sdk: &Sdk, serial: &str, from: (u32, u32), to: (u32, u32), ms: u32) -> Result<(), String> {
    let (a, b, c, d, t) = (from.0.to_string(), from.1.to_string(), to.0.to_string(), to.1.to_string(), ms.clamp(50, 3000).to_string());
    input(sdk, serial, &["swipe", &a, &b, &c, &d, &t]).await
}

/// The few keys the preview offers, by Android key code.
pub fn key_code(name: &str) -> Option<u32> {
    match name {
        "home" => Some(3),
        "back" => Some(4),
        "recents" => Some(187),
        "enter" => Some(66),
        "delete" => Some(67),
        _ => None,
    }
}

pub async fn key(sdk: &Sdk, serial: &str, name: &str) -> Result<(), String> {
    let code = key_code(name).ok_or("That key isn't available")?;
    input(sdk, serial, &["keyevent", &code.to_string()]).await
}

/// `adb shell input text` takes ASCII only, with spaces as `%s`; the whole word is quoted for the device's shell.
pub fn text_arg(text: &str) -> Result<String, String> {
    if text.is_empty() || text.len() > 500 {
        return Err("Type 1 to 500 characters".into());
    }
    if !text.chars().all(|c| c.is_ascii() && !c.is_ascii_control()) {
        return Err("Only English letters, numbers and symbols can be typed into the device".into());
    }
    let escaped: String = text.chars().map(|c| if c == ' ' { "%s".to_string() } else if c == '%' { "%25".to_string() } else { c.to_string() }).collect();
    Ok(format!("'{}'", escaped.replace('\'', "'\\''")))
}

pub async fn text(sdk: &Sdk, serial: &str, text: &str) -> Result<(), String> {
    let arg = text_arg(text)?;
    if !valid_serial(serial) {
        return Err("That device isn't valid".into());
    }
    run(&sdk.adb, &["-s", serial, "shell", "input", "text", &arg]).await.map(|_| ())
}

async fn input(sdk: &Sdk, serial: &str, args: &[&str]) -> Result<(), String> {
    if !valid_serial(serial) {
        return Err("That device isn't valid".into());
    }
    let mut all = vec!["-s", serial, "shell", "input"];
    all.extend_from_slice(args);
    run(&sdk.adb, &all).await.map(|_| ())
}

/// Saves a frame in the feature's `device-shots` folder (the Verify stage shows it) and returns its path
/// relative to the feature.
pub fn save_shot(feature_folder: &Path, png: &[u8]) -> Result<String, String> {
    let dir = feature_folder.join("device-shots");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = format!("device-{}.png", chrono::Local::now().format("%Y%m%d-%H%M%S"));
    std::fs::write(dir.join(&name), png).map_err(|e| e.to_string())?;
    Ok(format!("device-shots/{name}"))
}

#[cfg(test)]
mod real {
    use super::*;

    /// Against a real emulator on this machine: `cargo test real_device -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore = "needs a running Android emulator"]
    async fn real_device() {
        let sdk = sdk().expect("Android SDK");
        let o = overview(Some(&sdk)).await;
        println!("overview: {o:?}");
        let d = o.devices.iter().find(|d| d.state == "device").expect("a running device");
        let f = screenshot(&sdk, &d.serial).await.unwrap();
        println!("frame {}x{} {} bytes", f.width, f.height, f.png.len());
        assert!(f.width > 100 && f.height > 100);
        tap(&sdk, &d.serial, f.width / 2, f.height / 2).await.unwrap();
        swipe(&sdk, &d.serial, (f.width / 2, f.height * 3 / 4), (f.width / 2, f.height / 4), 300).await.unwrap();
        key(&sdk, &d.serial, "home").await.unwrap();
        text(&sdk, &d.serial, "halo dunia").await.unwrap();
        let dir = tempfile::tempdir().unwrap();
        println!("saved {}", save_shot(dir.path(), &screenshot(&sdk, &d.serial).await.unwrap().png).unwrap());
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    /// A fake SDK: an `adb` shell script that logs its arguments and answers like a device, an `emulator` too.
    fn fake_sdk() -> (tempfile::TempDir, Sdk, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let log = dir.path().join("calls.log");
        let png = dir.path().join("frame.png");
        // 8-byte signature, IHDR length+type, then width 1080 and height 2400.
        let mut bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR".to_vec();
        bytes.extend_from_slice(&1080u32.to_be_bytes());
        bytes.extend_from_slice(&2400u32.to_be_bytes());
        std::fs::write(&png, bytes).unwrap();
        let tools = dir.path().join("platform-tools");
        std::fs::create_dir_all(&tools).unwrap();
        let adb = tools.join("adb");
        std::fs::write(
            &adb,
            format!(
                "#!/bin/sh\necho \"$@\" >> '{log}'\ncase \"$*\" in\n  \"devices -l\") printf 'List of devices attached\\nemulator-5554          device product:sdk_gphone64 model:Pixel_8 device:emu64a transport_id:1\\nR58M123ABC             unauthorized usb:1-1 transport_id:2\\n\\n';;\n  *screencap*) cat '{png}';;\n  *'input text'*) ;;\n  *fail*) echo 'device offline' >&2; exit 1;;\nesac\n",
                log = log.display(),
                png = png.display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&adb, std::fs::Permissions::from_mode(0o755)).unwrap();
        let em = dir.path().join("emulator");
        std::fs::create_dir_all(&em).unwrap();
        let emu = em.join("emulator");
        std::fs::write(&emu, format!("#!/bin/sh\necho \"emulator $@\" >> '{}'\ncase \"$1\" in -list-avds) printf 'INFO | x\\nPixel_8_API_35\\nTablet\\n';; esac\n", log.display())).unwrap();
        std::fs::set_permissions(&emu, std::fs::Permissions::from_mode(0o755)).unwrap();
        let sdk = find_sdk(&[dir.path().to_path_buf()], &|_| None).unwrap();
        (dir, sdk, log)
    }

    fn calls(log: &Path) -> Vec<String> {
        std::fs::read_to_string(log).unwrap_or_default().lines().map(str::to_string).collect()
    }

    #[test]
    fn finds_the_sdk_in_the_environment_first_then_where_android_studio_puts_it_then_the_path() {
        let (dir, _sdk, _) = fake_sdk();
        let root = dir.path().to_string_lossy().to_string();
        let env = move |k: &str| (k == "ANDROID_HOME").then(|| root.clone());
        let roots = sdk_roots(&env, Some(Path::new("/home/u")));
        assert_eq!(roots[0], dir.path());
        assert!(roots.contains(&PathBuf::from("/home/u/Android/Sdk")) && roots.contains(&PathBuf::from("/home/u/Library/Android/sdk")));
        let sdk = find_sdk(&roots, &|_| None).unwrap();
        assert!(sdk.adb.ends_with("platform-tools/adb") && sdk.emulator.unwrap().ends_with("emulator/emulator"));
        // No SDK folder: whatever is on the PATH.
        let found = find_sdk(&[], &|p| (p == "adb").then(|| PathBuf::from("/usr/bin/adb"))).unwrap();
        assert_eq!(found.adb, PathBuf::from("/usr/bin/adb"));
        assert!(found.emulator.is_none());
        assert!(find_sdk(&[], &|_| None).is_none());
    }

    #[test]
    fn reads_the_device_list() {
        let d = parse_devices("List of devices attached\nemulator-5554 device product:x model:Pixel_8 device:emu\nR58M unauthorized usb:1-1\n\n");
        assert_eq!(d[0], Device { serial: "emulator-5554".into(), name: "Pixel 8".into(), state: "device".into(), emulator: true });
        assert_eq!((d[1].state.as_str(), d[1].emulator, d[1].name.as_str()), ("unauthorized", false, "R58M"));
        assert!(parse_devices("").is_empty());
    }

    #[tokio::test]
    async fn lists_devices_and_emulators_that_could_start() {
        let (_d, sdk, _) = fake_sdk();
        let o = overview(Some(&sdk)).await;
        assert!(o.sdk);
        assert_eq!(o.devices.iter().map(|d| d.serial.as_str()).collect::<Vec<_>>(), ["emulator-5554", "R58M123ABC"]);
        assert_eq!(o.avds, ["Pixel_8_API_35", "Tablet"]);
        assert!(!overview(None).await.sdk);
    }

    #[tokio::test]
    async fn a_frame_is_the_screen_png_with_its_size() {
        let (_d, sdk, log) = fake_sdk();
        let f = screenshot(&sdk, "emulator-5554").await.unwrap();
        assert_eq!((f.width, f.height), (1080, 2400));
        assert_eq!(calls(&log).last().unwrap(), "-s emulator-5554 exec-out screencap -p");
        assert!(screenshot(&sdk, "a b; rm").await.unwrap_err().contains("isn't valid"));
    }

    #[tokio::test]
    async fn taps_swipes_keys_and_typing_go_to_the_device() {
        let (_d, sdk, log) = fake_sdk();
        tap(&sdk, "emulator-5554", 540, 1200).await.unwrap();
        swipe(&sdk, "emulator-5554", (500, 1800), (500, 600), 10_000).await.unwrap();
        key(&sdk, "emulator-5554", "back").await.unwrap();
        text(&sdk, "emulator-5554", "it's 100% ok").await.unwrap();
        let c = calls(&log);
        assert_eq!(c[0], "-s emulator-5554 shell input tap 540 1200");
        // The swipe's time is kept to 3 seconds at most.
        assert_eq!(c[1], "-s emulator-5554 shell input swipe 500 1800 500 600 3000");
        assert_eq!(c[2], "-s emulator-5554 shell input keyevent 4");
        assert_eq!(c[3], "-s emulator-5554 shell input text 'it'\\''s%s100%25%sok'");
        assert!(key(&sdk, "emulator-5554", "power").await.unwrap_err().contains("isn't available"));
    }

    #[test]
    fn typing_is_ascii_only_and_bounded() {
        assert!(text_arg("halo dunia").is_ok());
        assert!(text_arg("café").unwrap_err().contains("English"));
        assert!(text_arg("").is_err());
        assert!(text_arg(&"a".repeat(501)).is_err());
    }

    #[tokio::test]
    async fn a_refusal_from_the_device_is_shown_in_its_words() {
        let (_d, sdk, _) = fake_sdk();
        let e = run(&sdk.adb, &["-s", "x", "fail"]).await.unwrap_err();
        assert!(e.contains("device offline"), "{e}");
    }

    #[tokio::test]
    async fn starting_an_emulator_launches_it_and_saves_frames_in_the_feature() {
        let (_d, sdk, log) = fake_sdk();
        boot(&sdk, "Pixel_8_API_35").unwrap();
        for _ in 0..50 {
            if calls(&log).iter().any(|c| c == "emulator -avd Pixel_8_API_35") {
                break;
            }
            tokio::time::sleep(Duration::from_millis(40)).await;
        }
        assert!(calls(&log).iter().any(|c| c == "emulator -avd Pixel_8_API_35"));
        assert!(boot(&sdk, "a b").unwrap_err().contains("isn't valid"));
        let feature = tempfile::tempdir().unwrap();
        let rel = save_shot(feature.path(), b"png").unwrap();
        assert!(rel.starts_with("device-shots/device-") && feature.path().join(&rel).is_file());
    }
}
