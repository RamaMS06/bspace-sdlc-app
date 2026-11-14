//! Agent activity for Settings › Agents › Usage: the turns each agent ran (`agent-usage.jsonl`,
//! written by `acp`) and the times the app moved a chat to the next agent (failover lines,
//! `"event": "failover"`, in the same file).

use std::io::{BufRead, BufReader, Write};
use std::path::Path;

use chrono::{DateTime, Utc};
use serde_json::{json, Value};

/// The most lines the Usage screen reads, newest kept.
pub const MAX_LINES: usize = 5000;

/// The log lines at or after `since` (all of them when None), oldest first, at most `MAX_LINES`.
/// A missing file is an empty log; lines that aren't JSON are skipped.
pub fn read(path: &Path, since: Option<DateTime<Utc>>) -> Vec<Value> {
    let Ok(file) = std::fs::File::open(path) else { return Vec::new() };
    let mut out: Vec<Value> = BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter_map(|l| serde_json::from_str::<Value>(l.trim()).ok())
        .filter(|v| match since {
            None => true,
            Some(cut) => v
                .get("at")
                .and_then(Value::as_str)
                .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                .is_some_and(|at| at.with_timezone(&Utc) >= cut),
        })
        .collect();
    if out.len() > MAX_LINES {
        out.drain(..out.len() - MAX_LINES);
    }
    out
}

/// The failover line: a chat moved from one agent to the next, and why.
pub fn failover_line(chat: &str, from: &str, to: &str, reason: &str, at: &str) -> Value {
    json!({ "event": "failover", "at": at, "chat": chat, "from": from, "to": to, "reason": reason })
}

/// Appends one line to the log.
pub fn append(path: &Path, line: &Value) -> std::io::Result<()> {
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(f, "{line}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_lines_since_a_time_and_skips_junk() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("agent-usage.jsonl");
        std::fs::write(
            &p,
            "{\"agent\":\"claude\",\"at\":\"2026-11-01T00:00:00Z\"}\nnot json\n{\"agent\":\"codex\",\"at\":\"2026-11-14T00:00:00Z\"}\n",
        )
        .unwrap();
        assert_eq!(read(&p, None).len(), 2);
        let since = DateTime::parse_from_rfc3339("2026-11-10T00:00:00Z").unwrap().with_timezone(&Utc);
        let recent = read(&p, Some(since));
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0]["agent"], "codex");
        assert!(read(&dir.path().join("missing"), None).is_empty());
    }

    #[test]
    fn failover_lines_are_appended() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("agent-usage.jsonl");
        append(&p, &failover_line("c1", "claude", "codex", "limit", "2026-11-14T00:00:00Z")).unwrap();
        let lines = read(&p, None);
        assert_eq!(lines[0]["event"], "failover");
        assert_eq!(lines[0]["to"], "codex");
    }
}
