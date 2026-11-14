//! The app's ACP client against `bridges/codex-app-server.mjs`, with a stand-in for `codex app-server`
//! behind it (`src/features/agents/bridge/fake-app-server.mjs`). Needs `node` on PATH.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use bspace_sdlc_app_lib::domain::acp::{AcpManager, AcpSink, PromptPart, SessionOptions};
use bspace_sdlc_app_lib::types::{AgentQuestion, AgentUpdate, PermissionRequest};

#[derive(Default)]
struct Sink {
    updates: Mutex<Vec<AgentUpdate>>,
    permissions: Mutex<Vec<PermissionRequest>>,
}

impl AcpSink for Sink {
    fn update(&self, _chat: &str, u: AgentUpdate) {
        self.updates.lock().unwrap().push(u);
    }
    fn permission(&self, req: PermissionRequest) {
        self.permissions.lock().unwrap().push(req);
    }
    fn question(&self, _q: AgentQuestion) {}
}

impl Sink {
    async fn until(&self, what: &str, cond: impl Fn(&Sink) -> bool) {
        let start = Instant::now();
        while !cond(self) {
            assert!(start.elapsed() < Duration::from_secs(15), "timed out waiting for {what}: {:?}", self.updates.lock().unwrap());
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }
    fn finished(&self) -> bool {
        self.updates.lock().unwrap().iter().any(|u| matches!(u, AgentUpdate::Done { .. } | AgentUpdate::Error { .. }))
    }
}

fn paths() -> (PathBuf, PathBuf) {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    (manifest.join("bridges/codex-app-server.mjs"), manifest.join("../src/features/agents/bridge/fake-app-server.mjs"))
}

async fn start(chat: &str, auth: &str) -> (AcpManager, Arc<Sink>, tempfile::TempDir) {
    let (bridge, fake) = paths();
    let dir = tempfile::tempdir().unwrap();
    let manager = AcpManager::new();
    let sink = Arc::new(Sink::default());
    let options = SessionOptions {
        env: vec![
            ("BUMA_CODEX_CMD".into(), format!("[\"node\",{:?}]", fake.to_string_lossy())),
            ("BUMA_NO_BROWSER".into(), "1".into()),
            ("FAKE_LOG".into(), dir.path().join("fake.log").to_string_lossy().into_owned()),
            ("FAKE_AUTH".into(), auth.into()),
        ],
        ..Default::default()
    };
    manager
        .start_with(chat, &["node".to_string(), bridge.to_string_lossy().into_owned()], dir.path(), sink.clone(), options)
        .await
        .expect("the bridge starts and opens a session");
    (manager, sink, dir)
}

#[tokio::test]
async fn the_app_lists_the_accounts_models_and_streams_a_turn_through_the_bridge() {
    let (manager, sink, _dir) = start("c1", "chatgpt").await;
    // The models Codex reports for the account (not the adapter's old list) reach the app's model menu.
    let models = manager.models("c1").unwrap().expect("models");
    assert_eq!(models.current.as_deref(), Some("m1"));
    assert_eq!(models.options.iter().map(|m| m.value.as_str()).collect::<Vec<_>>(), ["m1"]);
    manager.set_model("c1", "any-model-the-account-has").await.unwrap();
    manager.prompt("c1", vec![PromptPart::Text("hello".into())]).await.unwrap();
    sink.until("done", |s| s.finished()).await;
    let ups = sink.updates.lock().unwrap().clone();
    let said: String = ups.iter().filter_map(|u| if let AgentUpdate::Text { text } = u { Some(text.as_str()) } else { None }).collect();
    assert_eq!(said, "Hi there");
    assert!(ups.iter().any(|u| matches!(u, AgentUpdate::Thought { text } if text == "thinking")));
    assert!(matches!(ups.last(), Some(AgentUpdate::Done { stop_reason }) if stop_reason == "end_turn"));
    manager.stop("c1").await.unwrap();
}

#[tokio::test]
async fn an_approval_from_codex_reaches_the_user_and_the_choice_goes_back() {
    let (manager, sink, dir) = start("c2", "chatgpt").await;
    manager.prompt("c2", vec![PromptPart::Text("approve".into())]).await.unwrap();
    sink.until("permission", |s| !s.permissions.lock().unwrap().is_empty()).await;
    let req = sink.permissions.lock().unwrap()[0].clone();
    assert!(req.commands[0].contains("rm -rf build"), "{:?}", req.commands);
    let decline = req.options.iter().find(|o| o.label == "Decline").expect("a decline option").id.clone();
    manager.respond_permission(&req.request_id, Some(decline)).unwrap();
    sink.until("done", |s| s.finished()).await;
    let log = std::fs::read_to_string(dir.path().join("fake.log")).unwrap();
    assert!(log.contains("\"decision\":\"decline\""), "{log}");
    manager.stop("c2").await.unwrap();
}

#[tokio::test]
async fn stop_ends_the_turn_as_cancelled_and_a_signed_out_account_asks_for_sign_in() {
    let (manager, sink, _dir) = start("c3", "chatgpt").await;
    manager.prompt("c3", vec![PromptPart::Text("hang".into())]).await.unwrap();
    tokio::time::sleep(Duration::from_millis(400)).await;
    manager.cancel("c3").await.unwrap();
    sink.until("cancelled", |s| s.finished()).await;
    assert!(matches!(sink.updates.lock().unwrap().last(), Some(AgentUpdate::Done { stop_reason }) if stop_reason == "cancelled"));
    manager.stop("c3").await.unwrap();

    // Signed out: no session opens, and the error says to sign in (the app shows its sign-in flow).
    let (bridge, fake) = paths();
    let dir = tempfile::tempdir().unwrap();
    let options = SessionOptions {
        env: vec![
            ("BUMA_CODEX_CMD".into(), format!("[\"node\",{:?}]", fake.to_string_lossy())),
            ("FAKE_LOG".into(), dir.path().join("fake.log").to_string_lossy().into_owned()),
            ("FAKE_AUTH".into(), "none".into()),
        ],
        ..Default::default()
    };
    let err = AcpManager::new()
        .start_with("c4", &["node".to_string(), bridge.to_string_lossy().into_owned()], dir.path(), Arc::new(Sink::default()), options)
        .await
        .expect_err("no session without a sign-in");
    assert!(err.to_string().to_lowercase().contains("sign in") || err.to_string().to_lowercase().contains("auth"), "{err}");
}
