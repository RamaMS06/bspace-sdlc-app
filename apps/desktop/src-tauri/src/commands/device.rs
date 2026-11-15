//! The Android emulator preview (see `domain::device`).

use super::{err, CmdResult};
use crate::app::state::AppState;
use crate::domain::device::{self, Overview, Sdk};
use crate::domain::workspace::project_folder;
use base64::Engine;
use serde::Serialize;
use tauri::State;

const NO_SDK: &str = "The Android SDK isn't installed. Install Android Studio to preview the app on an emulator.";

async fn sdk() -> CmdResult<Sdk> {
    tauri::async_runtime::spawn_blocking(device::sdk).await.map_err(err)?.ok_or_else(|| NO_SDK.to_string())
}

/// The SDK's presence, the devices that are on and the emulators that could be started.
#[tauri::command]
pub(crate) async fn device_overview() -> CmdResult<Overview> {
    let sdk = tauri::async_runtime::spawn_blocking(device::sdk).await.map_err(err)?;
    Ok(device::overview(sdk.as_ref()).await)
}

#[tauri::command]
pub(crate) async fn device_boot(avd: String) -> CmdResult<()> {
    device::boot(&sdk().await?, &avd)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FrameOut {
    /// The screen as a PNG, base64.
    png: String,
    width: u32,
    height: u32,
}

/// One picture of the device's screen.
#[tauri::command]
pub(crate) async fn device_frame(serial: String) -> CmdResult<FrameOut> {
    let f = device::screenshot(&sdk().await?, &serial).await?;
    Ok(FrameOut { png: base64::engine::general_purpose::STANDARD.encode(&f.png), width: f.width, height: f.height })
}

#[tauri::command]
pub(crate) async fn device_tap(serial: String, x: u32, y: u32) -> CmdResult<()> {
    device::tap(&sdk().await?, &serial, x, y).await
}

#[tauri::command]
pub(crate) async fn device_swipe(serial: String, x1: u32, y1: u32, x2: u32, y2: u32, ms: u32) -> CmdResult<()> {
    device::swipe(&sdk().await?, &serial, (x1, y1), (x2, y2), ms).await
}

#[tauri::command]
pub(crate) async fn device_key(serial: String, name: String) -> CmdResult<()> {
    device::key(&sdk().await?, &serial, &name).await
}

#[tauri::command]
pub(crate) async fn device_text(serial: String, text: String) -> CmdResult<()> {
    device::text(&sdk().await?, &serial, &text).await
}

/// Saves the device's screen in the feature's `device-shots` folder; returns its path in the feature.
#[tauri::command]
pub(crate) async fn device_save_shot(state: State<'_, AppState>, project_id: String, serial: String) -> CmdResult<String> {
    let folder = project_folder(&state.db, &project_id)?;
    let f = device::screenshot(&sdk().await?, &serial).await?;
    tauri::async_runtime::spawn_blocking(move || device::save_shot(&folder, &f.png)).await.map_err(err)?
}
