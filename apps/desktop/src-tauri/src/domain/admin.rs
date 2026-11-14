//! Who is an admin of BSpace SDLC. An admin can edit the SDLC plugin (`bspace-sdlc-skills`): install, update,
//! remove or switch plugins on the Skills screen. Everyone can still use the plugin, and add and use their own
//! skills. The account is the one signed in to Azure DevOps (`domain::devops`), matched by its email.
//!
//! This is the app's own gate (the buttons and the commands behind them), not a lock on the files: the
//! plugin lives on each person's computer.

use crate::domain::devops::{DevopsProfile, DevopsStatus};

/// The admin accounts, by Azure DevOps sign-in email (lower case).
pub const ADMINS: &[&str] = &["p-rama.msugiyanto@bukitmakmur.com"];

/// Whether an email is an admin's. Case does not matter; nothing is an admin without an email.
pub fn is_admin_email(email: Option<&str>) -> bool {
    let Some(email) = email.map(|e| e.trim().to_lowercase()).filter(|e| !e.is_empty()) else { return false };
    ADMINS.iter().any(|a| *a == email)
}

pub fn is_admin(profile: &DevopsProfile) -> bool {
    is_admin_email(profile.email.as_deref())
}

/// The error of an admin-only action when the signed-in account is not an admin.
pub const NOT_ADMIN: &str = "Only an admin can edit the SDLC plugin";

/// Ok when the account in `status` is an admin.
pub fn require(status: &DevopsStatus) -> Result<(), String> {
    if status.admin {
        Ok(())
    } else {
        Err(NOT_ADMIN.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(email: Option<&str>) -> DevopsProfile {
        DevopsProfile { org: "buma".into(), id: "u".into(), display_name: "Rama".into(), email: email.map(str::to_string) }
    }

    #[test]
    fn the_listed_account_is_an_admin_whatever_its_case_and_nobody_else_is() {
        assert!(is_admin(&profile(Some("p-rama.msugiyanto@bukitmakmur.com"))));
        assert!(is_admin(&profile(Some("  P-Rama.Msugiyanto@BukitMakmur.com "))));
        assert!(!is_admin(&profile(Some("someone@bukitmakmur.com"))));
        assert!(!is_admin(&profile(Some("p-rama.msugiyanto@gmail.com"))));
        // A sign-in with no email is nobody's account.
        assert!(!is_admin(&profile(None)));
        assert!(!is_admin(&profile(Some(""))));
    }

    #[test]
    fn an_admin_only_action_needs_the_admin_flag_of_the_status() {
        let admin = DevopsStatus { signed_in: true, admin: true, profile: Some(profile(Some("p-rama.msugiyanto@bukitmakmur.com"))) };
        let user = DevopsStatus { signed_in: true, admin: false, profile: Some(profile(Some("x@y.z"))) };
        assert!(require(&admin).is_ok());
        assert_eq!(require(&user).unwrap_err(), NOT_ADMIN);
        assert!(require(&DevopsStatus { signed_in: false, admin: false, profile: None }).is_err());
    }
}
