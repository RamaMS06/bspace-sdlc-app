//! Test doubles shared by unit tests in several modules.

use crate::infra::exec::Exec;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// An `Exec` that answers from a table: `program` (or its file name) -> its output.
#[derive(Default)]
pub(crate) struct FakeExec {
    out: HashMap<String, String>,
}
impl FakeExec {
    pub(crate) fn with(mut self, prog: &str, out: &str) -> Self {
        self.out.insert(prog.to_string(), out.to_string());
        self
    }
}
impl Exec for FakeExec {
    fn run(&self, program: &str, _args: &[&str]) -> Option<String> {
        let name = Path::new(program).file_name().map(|n| n.to_string_lossy().into_owned());
        self.out.get(program).or_else(|| self.out.get(name.as_deref()?)).cloned()
    }
    fn which(&self, program: &str) -> Option<PathBuf> {
        self.out.get(program).map(|_| PathBuf::from(format!("/bin/{program}")))
    }
}

// ---- a fake Buma API ----


#[derive(Debug, Clone)]
pub(crate) struct Req {
    pub method: String,
    pub path: String,
    pub auth: Option<String>,
    pub body: String,
}

type Handler = Arc<dyn Fn(&Req, usize) -> (u16, String) + Send + Sync>;

/// A tiny HTTP/1.1 server on 127.0.0.1. `handler` gets each request and how many
/// requests came before it to the same path; every request is recorded.
pub(crate) struct Fake {
    pub base: String,
    pub hits: Arc<Mutex<Vec<Req>>>,
}

impl Fake {
    pub fn hits(&self, path: &str) -> Vec<Req> {
        self.hits.lock().unwrap().iter().filter(|r| r.path == path).cloned().collect()
    }
}

pub(crate) async fn fake(handler: impl Fn(&Req, usize) -> (u16, String) + Send + Sync + 'static) -> Fake {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let handler: Handler = Arc::new(handler);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}/api", listener.local_addr().unwrap());
    let hits: Arc<Mutex<Vec<Req>>> = Arc::default();
    let recorded = hits.clone();
    tokio::spawn(async move {
        while let Ok((mut s, _)) = listener.accept().await {
            let handler = handler.clone();
            let hits = recorded.clone();
            tokio::spawn(async move {
                let mut buf = Vec::new();
                let mut chunk = [0u8; 4096];
                let (head, body) = loop {
                    let n = s.read(&mut chunk).await.unwrap_or(0);
                    buf.extend_from_slice(&chunk[..n]);
                    let text = String::from_utf8_lossy(&buf).to_string();
                    if let Some(i) = text.find("\r\n\r\n") {
                        let len = text[..i]
                            .lines()
                            .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse().unwrap_or(0)))
                            .unwrap_or(0usize);
                        if buf.len() >= i + 4 + len || n == 0 {
                            break (text[..i].to_string(), text[i + 4..].to_string());
                        }
                    }
                    if n == 0 {
                        return;
                    }
                };
                let mut first = head.lines().next().unwrap_or("").split(' ');
                let method = first.next().unwrap_or("").to_string();
                let path = first.next().unwrap_or("").to_string();
                let auth = head
                    .lines()
                    .find_map(|l| l.split_once(':').filter(|(k, _)| k.eq_ignore_ascii_case("authorization")).map(|(_, v)| v.trim().to_string()));
                let req = Req { method, path, auth, body };
                let nth = {
                    let mut h = hits.lock().unwrap();
                    let nth = h.iter().filter(|r| r.path == req.path).count();
                    h.push(req.clone());
                    nth
                };
                let (status, body) = handler(&req, nth);
                // A 3xx body is where it redirects to.
                let location = if (300..400).contains(&status) { format!("Location: {body}\r\n") } else { String::new() };
                let res = format!(
                    "HTTP/1.1 {status} X\r\n{location}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = s.write_all(res.as_bytes()).await;
                let _ = s.shutdown().await;
            });
        }
    });
    Fake { base, hits }
}

/// An address nothing listens on.
pub(crate) async fn dead_base() -> String {
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = l.local_addr().unwrap();
    drop(l);
    format!("http://{addr}/api")
}

pub(crate) const DEVICE: &str = r#"{"deviceCode":"dev-secret","userCode":"ABCD-EFGH","verificationUri":"http://x/api/auth/device","verificationUriComplete":"http://x/api/auth/device?code=ABCD-EFGH","expiresIn":600,"interval":1}"#;
pub(crate) const ISSUED: &str = r#"{"token":"tyg_abc","account":{"id":"acc_1","email":"a@b.c","name":"Ana","plan":"free","features":[]}}"#;
pub(crate) const ME: &str = r#"{"id":"acc_1","email":"a@b.c","name":"Ana","plan":"pro","features":["ai-images"],"credits":310}"#;
pub(crate) fn err(code: &str) -> (u16, String) {
    (400, format!(r#"{{"error":"{code}"}}"#))
}
pub(crate) const TICK: Duration = Duration::from_millis(2);
