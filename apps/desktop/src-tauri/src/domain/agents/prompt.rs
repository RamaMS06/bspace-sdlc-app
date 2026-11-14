//! What the agent is sent for a chat message: the user's parts turned into ACP prompt parts.

use crate::domain::acp::PromptPart;
use crate::domain::attachments::{human_size, is_image_name, MAX_IMAGE_BLOCK};
use crate::types::{MessagePart, Project};
use std::path::{Path, PathBuf};

/// How much of a mentioned project's AGENTS.md goes into the prompt.
const BRIEF_LIMIT: usize = 8 * 1024;

/// `<folder>/AGENTS.md`, cut to `BRIEF_LIMIT` bytes on a character boundary.
pub(crate) fn read_brief(folder: &Path) -> Option<String> {
    let text = std::fs::read_to_string(folder.join("AGENTS.md")).ok()?;
    Some(truncate_brief(&text))
}

fn truncate_brief(text: &str) -> String {
    if text.len() <= BRIEF_LIMIT {
        return text.to_string();
    }
    let mut end = BRIEF_LIMIT;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n[AGENTS.md cut at 8 KB]", &text[..end])
}

/// Turns chat parts into what the agent sees. Tool parts are skipped. A mentioned
/// project's AGENTS.md (from `brief`) is inlined, since a new chat's agent runs
/// outside that project's folder.
pub(crate) fn build_prompt(
    parts: &[MessagePart],
    project: impl Fn(&str) -> Option<Project>,
    brief: impl Fn(&Path) -> Option<String>,
) -> Vec<PromptPart> {
    let mut out = Vec::new();
    for part in parts {
        match part {
            MessagePart::Text { text } => out.push(PromptPart::Text(text.clone())),
            MessagePart::Mention { project_id, title } => {
                out.push(PromptPart::Text(match project(project_id) {
                    Some(p) => {
                        let head = format!(
                            "Context: project \"{}\". Its Buma id is {}. Its files are in {}.",
                            p.title, p.id, p.folder
                        );
                        match brief(Path::new(&p.folder)) {
                            Some(b) if !b.trim().is_empty() => {
                                format!("{head}\nIts AGENTS.md:\n\n{}", b.trim_end())
                            }
                            _ => head,
                        }
                    }
                    None => format!(
                        "Context: project \"{title}\" (no longer on this computer)."
                    ),
                }));
            }
            MessagePart::File { path, name, size, .. } => {
                let rel = Path::new(path)
                    .file_name()
                    .map(|f| format!("attachments/{}", f.to_string_lossy()))
                    .unwrap_or_else(|| name.clone());
                let inline = is_image_name(name) && *size <= MAX_IMAGE_BLOCK;
                let size = human_size(*size);
                if inline {
                    out.push(PromptPart::Image { path: PathBuf::from(path) });
                    out.push(PromptPart::Text(format!("Attached image: {rel} ({name}, {size})")));
                } else {
                    out.push(PromptPart::Text(format!("Attached file: {rel} ({name}, {size})")));
                }
            }
            MessagePart::Tool { .. } | MessagePart::Thought { .. } | MessagePart::A2ui { .. } => {}
            MessagePart::A2uiAction { summary, action } => {
                out.push(PromptPart::Text(format!("{summary}\n\n```a2ui-action\n{action}\n```")));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::attachments::mime_for;
    use crate::types::{ProjectStatus, ToolCallStatus};

    #[test]
    fn brief_is_read_and_cut_at_8_kb() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(read_brief(tmp.path()), None);
        std::fs::write(tmp.path().join("AGENTS.md"), "# Hi\n").unwrap();
        assert_eq!(read_brief(tmp.path()).as_deref(), Some("# Hi\n"));
        // 3-byte characters straddle the limit: the cut stays on a boundary.
        let long = "é€".repeat(3000);
        std::fs::write(tmp.path().join("AGENTS.md"), &long).unwrap();
        let cut = read_brief(tmp.path()).unwrap();
        let body = cut.strip_suffix("\n[AGENTS.md cut at 8 KB]").unwrap();
        assert!(body.len() <= BRIEF_LIMIT && body.len() > BRIEF_LIMIT - 4);
        assert!(long.starts_with(body));
    }

    #[test]
    fn a2ui_action_becomes_summary_and_fenced_json() {
        let parts = vec![
            MessagePart::A2ui { surface_id: "s1".into(), messages: vec![serde_json::json!({"version":"v0.9"})] },
            MessagePart::A2uiAction {
                summary: "Picked: Kenapa rupiah melemah?".into(),
                action: serde_json::json!({"version":"v0.9","action":{"name":"pick"}}),
            },
        ];
        assert_eq!(
            build_prompt(&parts, |_| None, |_| None),
            vec![PromptPart::Text(
                "Picked: Kenapa rupiah melemah?\n\n```a2ui-action\n{\"action\":{\"name\":\"pick\"},\"version\":\"v0.9\"}\n```".into()
            )]
        );
    }

    #[test]
    fn missing_mention_has_no_empty_folder() {
        let parts = vec![MessagePart::Mention { project_id: "x".into(), title: "Gone".into() }];
        assert_eq!(
            build_prompt(&parts, |_| None, |_| None),
            vec![PromptPart::Text(
                "Context: project \"Gone\" (no longer on this computer).".into()
            )]
        );
    }

    #[test]
    fn prompt_conversion() {
        let project = Project {
            id: "p1".into(),
            title: "Launch".into(),
            slug: "launch".into(),
            folder: "/w/launch".into(),
            status: ProjectStatus::Draft,
            created_at: String::new(),
            updated_at: String::new(),
        };
        let parts = vec![
            MessagePart::Text { text: "hi".into() },
            MessagePart::Mention { project_id: "p1".into(), title: "old".into() },
            MessagePart::Tool {
                tool_call_id: "t".into(),
                title: "x".into(),
                status: ToolCallStatus::Done,
                tool_kind: None,
                path: None,
            },
            MessagePart::Thought { text: "hmm".into() },
        ];
        let out = build_prompt(
            &parts,
            |id| (id == "p1").then(|| project.clone()),
            |f| (f == Path::new("/w/launch")).then(|| "# Launch\n- Kind: promo\n".to_string()),
        );
        assert_eq!(
            out,
            vec![
                PromptPart::Text("hi".into()),
                PromptPart::Text(
                    "Context: project \"Launch\". Its Buma id is p1. Its files are in /w/launch.\nIts AGENTS.md:\n\n# Launch\n- Kind: promo"
                        .into()
                ),
            ]
        );
    }

    #[test]
    fn file_parts_become_images_or_text() {
        let parts = vec![
            MessagePart::File {
                path: "/w/c/attachments/shot.PNG".into(),
                name: "shot.PNG".into(),
                mime: "image/png".into(),
                size: 10,
                modified_at: None,
            },
            MessagePart::File {
                path: "/w/c/attachments/brief.pdf".into(),
                name: "brief.pdf".into(),
                mime: "application/pdf".into(),
                size: 2048,
                modified_at: None,
            },
        ];
        assert_eq!(
            build_prompt(&parts, |_| None, |_| None),
            vec![
                PromptPart::Image { path: PathBuf::from("/w/c/attachments/shot.PNG") },
                PromptPart::Text("Attached image: attachments/shot.PNG (shot.PNG, 10 B)".into()),
                PromptPart::Text(
                    "Attached file: attachments/brief.pdf (brief.pdf, 2.0 KB)".into()
                ),
            ]
        );
    }

    #[test]
    fn gifs_and_big_images_are_sent_as_file_lines() {
        let file = |name: &str, size: u64| MessagePart::File {
            path: format!("/w/c/attachments/{name}"),
            name: name.into(),
            mime: mime_for(name).into(),
            size,
            modified_at: None,
        };
        let parts = vec![
            file("loop.gif", 10),
            file("big.jpg", MAX_IMAGE_BLOCK + 1),
            file("edge.webp", MAX_IMAGE_BLOCK),
        ];
        let out = build_prompt(&parts, |_| None, |_| None);
        assert_eq!(out[0], PromptPart::Text("Attached file: attachments/loop.gif (loop.gif, 10 B)".into()));
        assert_eq!(out[1], PromptPart::Text("Attached file: attachments/big.jpg (big.jpg, 5.0 MB)".into()));
        assert_eq!(out[2], PromptPart::Image { path: PathBuf::from("/w/c/attachments/edge.webp") });
        assert_eq!(out.len(), 4);
    }
}
