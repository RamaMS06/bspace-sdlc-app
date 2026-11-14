//! Serde mirrors of the TypeScript types in `packages/shared/src/types.ts`.
//! Field names are camelCase and string unions serialize to the exact TS literals.

mod agents;
mod environment;
mod settings;
mod projects;
mod chats;
mod jobs;
mod usage;
mod auth;

pub use agents::*;
pub use environment::*;
pub use settings::*;
pub use projects::*;
pub use chats::*;
pub use jobs::*;
pub use usage::*;
pub use auth::*;


#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn tool_id_and_job_kind_literals() {
        assert_eq!(serde_json::to_value(ToolId::FigmaMcp).unwrap(), json!("figma-mcp"));
        assert_eq!(serde_json::to_value(JobKind::Build).unwrap(), json!("build"));
        assert_eq!(serde_json::to_value(JobStatus::NeedsYou).unwrap(), json!("needs-you"));
    }

    #[test]
    fn message_part_a2ui_round_trips() {
        let v = json!({"type":"a2ui","surfaceId":"s","messages":[]});
        let part: MessagePart = serde_json::from_value(v.clone()).unwrap();
        assert!(matches!(&part, MessagePart::A2ui { surface_id, .. } if surface_id == "s"));
        assert_eq!(serde_json::to_value(&part).unwrap(), v);
        let v = json!({"type":"a2ui-action","summary":"Picked: A","action":{"version":"v0.9"}});
        let part: MessagePart = serde_json::from_value(v.clone()).unwrap();
        assert!(matches!(&part, MessagePart::A2uiAction { summary, .. } if summary == "Picked: A"));
        assert_eq!(serde_json::to_value(&part).unwrap(), v);
    }

    #[test]
    fn message_part_file_round_trips() {
        let v = json!({"type":"file","path":"/w/attachments/a.pdf","name":"a.pdf",
            "mime":"application/pdf","size":2048});
        let part: MessagePart = serde_json::from_value(v.clone()).unwrap();
        assert!(matches!(&part, MessagePart::File { size: 2048, modified_at: None, .. }));
        assert_eq!(serde_json::to_value(&part).unwrap(), v);
        // An image the agent made keeps its time.
        let v = json!({"type":"file","path":"/w/p/a.png","name":"a.png","mime":"image/png","size":3,
            "modifiedAt":"2026-11-04T10:00:00.000Z"});
        let part: MessagePart = serde_json::from_value(v.clone()).unwrap();
        assert!(matches!(&part, MessagePart::File { modified_at: Some(_), .. }));
        assert_eq!(serde_json::to_value(&part).unwrap(), v);
    }

    #[test]
    fn agent_update_tool_round_trips() {
        let v = json!({"kind":"tool","toolCallId":"t1","title":"Run","status":"running"});
        let u: AgentUpdate = serde_json::from_value(v.clone()).unwrap();
        assert_eq!(serde_json::to_value(&u).unwrap(), v);
        let d = json!({"kind":"done","stopReason":"end_turn"});
        let u: AgentUpdate = serde_json::from_value(d.clone()).unwrap();
        assert_eq!(serde_json::to_value(&u).unwrap(), d);
    }

    #[test]
    fn tool_kind_and_path_are_optional_and_camel_case() {
        let v = json!({"kind":"tool","toolCallId":"t1","title":"Read","status":"done","toolKind":"read","path":"/a/b.ts"});
        let u: AgentUpdate = serde_json::from_value(v.clone()).unwrap();
        assert_eq!(serde_json::to_value(&u).unwrap(), v);
        let part = json!({"type":"tool","toolCallId":"t1","title":"Read","status":"done","toolKind":"read","path":"/a/b.ts"});
        let p: MessagePart = serde_json::from_value(part.clone()).unwrap();
        assert_eq!(serde_json::to_value(&p).unwrap(), part);
        let t = json!({"type":"thought","text":"hmm"});
        let p: MessagePart = serde_json::from_value(t.clone()).unwrap();
        assert_eq!(serde_json::to_value(&p).unwrap(), t);
    }

}
