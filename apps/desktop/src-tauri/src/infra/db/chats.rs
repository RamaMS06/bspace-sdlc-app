//! Chats, their messages, and the archive.

use super::{bind_values, new_id, now, query_as, Db, Result};
use crate::types::*;
use rusqlite::params_from_iter;
use serde_json::{json, Value};

const CHAT_SELECT: &str = "SELECT id, project_id AS projectId, agent_id AS agentId, title, \
    created_at AS createdAt, folder FROM chats";

impl Db {
    pub fn create_chat(&self, project_id: Option<&str>, agent: AgentId, title: &str) -> Result<Chat> {
        let chat = Chat {
            id: new_id(),
            project_id: project_id.map(str::to_string),
            agent_id: agent,
            title: title.to_string(),
            created_at: now(),
            folder: None,
        };
        let vals = bind_values(&chat, &["id", "projectId", "agentId", "title", "createdAt"])?;
        self.conn().execute(
            "INSERT INTO chats (id, project_id, agent_id, title, created_at) VALUES (?1,?2,?3,?4,?5)",
            params_from_iter(vals),
        )?;
        Ok(chat)
    }

    /// `Some(id)` lists that project's chats; `None` lists chats not tied to a project.
    pub fn list_chats(&self, project_id: Option<&str>) -> Result<Vec<Chat>> {
        let conn = self.conn();
        match project_id {
            Some(p) => query_as(
                &conn,
                &format!("{CHAT_SELECT} WHERE project_id = ?1 ORDER BY created_at DESC, rowid DESC"),
                &[&p],
            ),
            None => query_as(
                &conn,
                &format!("{CHAT_SELECT} WHERE project_id IS NULL ORDER BY created_at DESC, rowid DESC"),
                &[],
            ),
        }
    }

    /// Chats, project or not, newest activity first; a project once (its most active chat), at most
    /// `limit` entries. Chats of a deleted project are left out.
    pub fn list_recent_chats(&self, limit: Option<u32>) -> Result<Vec<RecentChat>> {
        let limit = limit.map_or(-1, i64::from);
        query_as(
            &self.conn(),
            "WITH active AS ( \
               SELECT c.id, c.project_id, c.agent_id, c.title, c.created_at, c.rowid AS rid, p.title AS project_title, \
                 COALESCE((SELECT MAX(m.created_at) FROM messages m WHERE m.chat_id = c.id), c.created_at) AS active_at \
               FROM chats c LEFT JOIN projects p ON p.id = c.project_id \
               WHERE (c.project_id IS NULL OR p.id IS NOT NULL) AND c.archived_at IS NULL \
             ), ranked AS ( \
               SELECT *, ROW_NUMBER() OVER (PARTITION BY COALESCE(project_id, id) ORDER BY active_at DESC, rid DESC) AS n \
               FROM active \
             ) \
             SELECT id, project_id AS projectId, agent_id AS agentId, title, created_at AS createdAt, \
               project_title AS projectTitle, active_at AS activeAt \
             FROM ranked WHERE n = 1 ORDER BY active_at DESC, rid DESC LIMIT ?1",
            &[&limit],
        )
    }

    /// Archived threads, most recently archived first: a project once, like Recent.
    pub fn list_archived_chats(&self) -> Result<Vec<RecentChat>> {
        query_as(
            &self.conn(),
            "WITH arch AS ( \
               SELECT c.id, c.project_id, c.agent_id, c.title, c.created_at, c.archived_at, c.rowid AS rid, \
                 p.title AS project_title, \
                 COALESCE((SELECT MAX(m.created_at) FROM messages m WHERE m.chat_id = c.id), c.created_at) AS active_at \
               FROM chats c LEFT JOIN projects p ON p.id = c.project_id \
               WHERE (c.project_id IS NULL OR p.id IS NOT NULL) AND c.archived_at IS NOT NULL \
             ), ranked AS ( \
               SELECT *, ROW_NUMBER() OVER (PARTITION BY COALESCE(project_id, id) ORDER BY active_at DESC, rid DESC) AS n \
               FROM arch \
             ) \
             SELECT id, project_id AS projectId, agent_id AS agentId, title, created_at AS createdAt, \
               project_title AS projectTitle, active_at AS activeAt, archived_at AS archivedAt \
             FROM ranked WHERE n = 1 ORDER BY archived_at DESC, rid DESC",
            &[],
        )
    }

    /// Archives or restores a whole thread: every chat of the chat's project, or the chat alone.
    pub fn set_thread_archived(&self, chat_id: &str, archived: bool) -> Result<()> {
        let stamp: Option<String> = archived.then(now);
        self.conn().execute(
            "UPDATE chats SET archived_at = ?2 \
             WHERE COALESCE(project_id, id) = (SELECT COALESCE(project_id, id) FROM chats WHERE id = ?1)",
            rusqlite::params![chat_id, stamp],
        )?;
        Ok(())
    }

    /// Deletes everything archived for good: archived chats with their messages, and archived cards.
    /// Projects and their folders stay. Returns (chats, cards) removed.
    pub fn purge_archive(&self) -> Result<(usize, usize)> {
        let conn = self.conn();
        let tx = conn.unchecked_transaction()?;
        tx.execute("DELETE FROM messages WHERE chat_id IN (SELECT id FROM chats WHERE archived_at IS NOT NULL)", [])?;
        let chats = tx.execute("DELETE FROM chats WHERE archived_at IS NOT NULL", [])?;
        let cards = tx.execute("DELETE FROM jobs WHERE archived_at IS NOT NULL AND status <> 'working'", [])?;
        tx.commit()?;
        Ok((chats, cards))
    }

    /// Points a chat at another agent. `None` when the chat doesn't exist.
    pub fn set_chat_agent(&self, chat_id: &str, agent: AgentId) -> Result<Option<Chat>> {
        let v = serde_json::to_value(agent)?;
        self.conn().execute(
            "UPDATE chats SET agent_id = ?1 WHERE id = ?2",
            rusqlite::params![v.as_str().unwrap_or_default(), chat_id],
        )?;
        self.get_chat(chat_id)
    }

    /// Attaches a folder to a chat, or detaches it (`None`).
    pub fn set_chat_folder(&self, id: &str, folder: Option<&str>) -> Result<Option<Chat>> {
        self.conn().execute("UPDATE chats SET folder = ?1 WHERE id = ?2", rusqlite::params![folder, id])?;
        self.get_chat(id)
    }

    /// Moves a chat into a project (a feature started from a chat that began without one).
    pub fn set_chat_project(&self, id: &str, project_id: &str) -> Result<Option<Chat>> {
        self.conn().execute("UPDATE chats SET project_id = ?1 WHERE id = ?2", rusqlite::params![project_id, id])?;
        self.get_chat(id)
    }

    pub fn get_chat(&self, id: &str) -> Result<Option<Chat>> {
        let sql = format!("{CHAT_SELECT} WHERE id = ?1");
        Ok(query_as::<Chat>(&self.conn(), &sql, &[&id])?.into_iter().next())
    }

    pub fn add_message(
        &self,
        chat_id: &str,
        role: MessageRole,
        parts: &[MessagePart],
    ) -> Result<ChatMessage> {
        let msg = ChatMessage {
            id: new_id(),
            chat_id: chat_id.to_string(),
            role,
            parts: parts.to_vec(),
            created_at: now(),
        };
        let role_s = serde_json::to_value(role)?;
        self.conn().execute(
            "INSERT INTO messages (id, chat_id, role, parts, created_at) VALUES (?1,?2,?3,?4,?5)",
            rusqlite::params![
                msg.id,
                msg.chat_id,
                role_s.as_str().unwrap_or_default(),
                serde_json::to_string(&msg.parts)?,
                msg.created_at
            ],
        )?;
        // Writing in an archived thread brings it back to Recent.
        if role == MessageRole::User {
            self.set_thread_archived(chat_id, false)?;
        }
        Ok(msg)
    }

    pub fn list_messages(&self, chat_id: &str) -> Result<Vec<ChatMessage>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT id, chat_id AS chatId, role, parts, created_at AS createdAt \
             FROM messages WHERE chat_id = ?1 ORDER BY rowid",
        )?;
        let rows = stmt.query_map([chat_id], |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "chatId": r.get::<_, String>(1)?,
                "role": r.get::<_, String>(2)?,
                "parts": r.get::<_, String>(3)?,
                "createdAt": r.get::<_, String>(4)?,
            }))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let mut v = row?;
            // A part this version no longer knows (a video app's frame or style mention) is left out,
            // so an old chat still opens.
            let parts: Vec<Value> = serde_json::from_str(v["parts"].as_str().unwrap_or("[]"))?;
            let known: Vec<MessagePart> = parts.into_iter().filter_map(|p| serde_json::from_value(p).ok()).collect();
            v["parts"] = serde_json::to_value(known)?;
            out.push(serde_json::from_value(v)?);
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infra::db::testing::*;

    #[test]
    fn a_chat_keeps_the_folder_attached_to_it() {
        let db = Db::open_in_memory().unwrap();
        let chat = db.create_chat(None, AgentId::Claude, "Talk").unwrap();
        assert_eq!(chat.folder, None);
        let attached = db.set_chat_folder(&chat.id, Some("/w/app")).unwrap().unwrap();
        assert_eq!(attached.folder.as_deref(), Some("/w/app"));
        assert_eq!(db.get_chat(&chat.id).unwrap().unwrap().folder.as_deref(), Some("/w/app"));
        assert_eq!(db.set_chat_folder(&chat.id, None).unwrap().unwrap().folder, None);
        assert_eq!(db.set_chat_project(&chat.id, "p1").unwrap().unwrap().project_id.as_deref(), Some("p1"));
    }

    #[test]
    fn set_chat_agent_persists_and_misses_unknown_chats() {
        let db = Db::open_in_memory().unwrap();
        let chat = db.create_chat(Some("a"), AgentId::Claude, "Fix intro").unwrap();
        let updated = db.set_chat_agent(&chat.id, AgentId::Codex).unwrap().unwrap();
        assert_eq!(updated.agent_id, AgentId::Codex);
        assert_eq!(updated.title, "Fix intro");
        assert_eq!(db.get_chat(&chat.id).unwrap().unwrap().agent_id, AgentId::Codex);
        assert_eq!(db.set_chat_agent("nope", AgentId::Gemini).unwrap(), None);
    }

    #[test]
    fn an_archived_thread_leaves_recent_until_restored_or_written_in() {
        let db = db();
        db.insert_project(&project("a", "2026-01-01T00:00:00Z")).unwrap();
        let first = db.create_chat(Some("a"), AgentId::Claude, "First").unwrap();
        let second = db.create_chat(Some("a"), AgentId::Claude, "Second").unwrap();
        let loose = db.create_chat(None, AgentId::Claude, "Loose").unwrap();
        // Archiving one chat of a project archives the whole thread.
        db.set_thread_archived(&first.id, true).unwrap();
        let ids = |v: Vec<RecentChat>| v.into_iter().map(|c| c.id).collect::<Vec<_>>();
        assert_eq!(ids(db.list_recent_chats(None).unwrap()), vec![loose.id.clone()]);
        let archived = db.list_archived_chats().unwrap();
        assert_eq!(archived.len(), 1, "a project shows once");
        assert_eq!(archived[0].project_id.as_deref(), Some("a"));
        assert!(archived[0].archived_at.is_some());
        db.set_thread_archived(&second.id, false).unwrap();
        assert_eq!(db.list_recent_chats(None).unwrap().len(), 2);
        assert!(db.list_archived_chats().unwrap().is_empty());
        // The user writing in an archived thread brings it back; the agent writing does not.
        db.set_thread_archived(&loose.id, true).unwrap();
        db.add_message(&loose.id, MessageRole::Agent, &[]).unwrap();
        assert_eq!(db.list_archived_chats().unwrap().len(), 1);
        db.add_message(&loose.id, MessageRole::User, &[]).unwrap();
        assert!(db.list_archived_chats().unwrap().is_empty());
    }

    #[test]
    fn purging_the_archive_deletes_archived_chats_and_cards_only() {
        let db = db();
        let gone = db.create_chat(None, AgentId::Claude, "Gone").unwrap();
        let kept = db.create_chat(None, AgentId::Claude, "Kept").unwrap();
        db.add_message(&gone.id, MessageRole::User, &[]).unwrap();
        db.add_message(&kept.id, MessageRole::User, &[]).unwrap();
        db.set_thread_archived(&gone.id, true).unwrap();
        let job = |id: &str, status: JobStatus| Job {
            id: id.into(),
            kind: JobKind::Build,
            title: id.into(),
            project_id: None,
            chat_id: None,
            agent_id: AgentId::Claude,
            status,
            progress: None,
            note: None,
            updated_at: "2026-01-01T00:00:00Z".into(),
            archived_at: None,
        };
        db.upsert_job(&job("done", JobStatus::Done)).unwrap();
        db.upsert_job(&job("busy", JobStatus::Working)).unwrap();
        db.upsert_job(&job("other", JobStatus::Done)).unwrap();
        db.set_jobs_archived(&["done".into(), "busy".into()], true).unwrap();
        let archived = |id: &str| db.list_jobs().unwrap().into_iter().find(|j| j.id == id).unwrap().archived_at.is_some();
        assert!(archived("done"));
        assert!(!archived("busy"), "a working card is never archived");
        // Rewriting a card with the same status keeps it archived; a new status brings it back.
        db.upsert_job(&job("done", JobStatus::Done)).unwrap();
        assert!(archived("done"));
        db.upsert_job(&job("other", JobStatus::Done)).unwrap();
        db.set_jobs_archived(&["other".into()], true).unwrap();
        db.upsert_job(&job("other", JobStatus::Working)).unwrap();
        assert!(!archived("other"));

        assert_eq!(db.purge_archive().unwrap(), (1, 1));
        assert!(db.get_chat(&gone.id).unwrap().is_none());
        assert!(db.list_messages(&gone.id).unwrap().is_empty());
        assert_eq!(db.list_messages(&kept.id).unwrap().len(), 1);
        let left: Vec<String> = db.list_jobs().unwrap().into_iter().map(|j| j.id).collect();
        assert!(!left.contains(&"done".to_string()) && left.contains(&"busy".to_string()));
    }

    #[test]
    fn recent_chats_newest_activity_first_with_project_titles() {
        let db = db();
        db.insert_project(&project("a", "2026-01-01T00:00:00Z")).unwrap();
        let video = db.create_chat(Some("a"), AgentId::Claude, "Feature chat").unwrap();
        let loose = db.create_chat(None, AgentId::Codex, "Loose").unwrap();
        let quiet = db.create_chat(None, AgentId::Claude, "Quiet").unwrap();
        // A chat of a deleted project has nowhere to go: it is left out.
        let orphan = db.create_chat(Some("gone"), AgentId::Claude, "Orphan").unwrap();
        let conn = db.conn();
        conn.execute("UPDATE chats SET created_at = '2026-01-01T00:00:00Z'", []).unwrap();
        for (chat, at) in [(&video, "2026-01-02T00:00:00Z"), (&loose, "2026-01-03T00:00:00Z"), (&orphan, "2026-01-09T00:00:00Z")] {
            conn.execute(
                "INSERT INTO messages (id, chat_id, role, parts, created_at) VALUES (?1, ?2, 'user', '[]', ?3)",
                rusqlite::params![format!("m-{}", chat.id), chat.id, at],
            )
            .unwrap();
        }
        drop(conn);

        let recent = db.list_recent_chats(None).unwrap();
        let ids: Vec<&str> = recent.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, vec![loose.id.as_str(), video.id.as_str(), quiet.id.as_str()]);
        assert_eq!(recent[0].project_title, None);
        assert_eq!(recent[0].active_at, "2026-01-03T00:00:00Z");
        assert_eq!(recent[1].project_title.as_deref(), Some("Title a"));
        assert_eq!(recent[1].project_id.as_deref(), Some("a"));
        // No messages yet: the chat counts from when it was made.
        assert_eq!(recent[2].active_at, "2026-01-01T00:00:00Z");
        assert_eq!(recent[2].title, "Quiet");

        let top = db.list_recent_chats(Some(1)).unwrap();
        assert_eq!(top.len(), 1);
        assert_eq!(top[0].id, loose.id);
    }


    #[test]
    fn recent_chats_count_a_project_once_before_the_limit() {
        let db = db();
        db.insert_project(&project("a", "2026-01-01T00:00:00Z")).unwrap();
        let busy: Vec<Chat> = (0..5).map(|i| db.create_chat(Some("a"), AgentId::Claude, &format!("A{i}")).unwrap()).collect();
        let loose = db.create_chat(None, AgentId::Claude, "Loose").unwrap();
        let conn = db.conn();
        conn.execute("UPDATE chats SET created_at = '2026-01-01T00:00:00Z'", []).unwrap();
        conn.execute("UPDATE chats SET created_at = '2026-01-02T00:00:00Z' WHERE id = ?1", [&busy[2].id]).unwrap();
        conn.execute("UPDATE chats SET created_at = '2026-01-03T00:00:00Z' WHERE project_id = 'a' AND id != ?1", [&busy[2].id])
            .unwrap();
        drop(conn);
        let recent = db.list_recent_chats(Some(2)).unwrap();
        let ids: Vec<&str> = recent.iter().map(|c| c.id.as_str()).collect();
        // The project's most active chat stands for it; the limit counts distinct entries.
        assert_eq!(ids.len(), 2);
        assert_eq!(recent[0].project_id.as_deref(), Some("a"));
        assert_ne!(recent[0].id, busy[2].id);
        assert_eq!(ids[1], loose.id.as_str());
    }

    #[test]
    fn chat_and_messages_round_trip() {
        let db = db();
        db.insert_project(&project("a", "2026-01-01T00:00:00Z")).unwrap();
        let chat = db.create_chat(Some("a"), AgentId::Claude, "Fix intro").unwrap();
        let global = db.create_chat(None, AgentId::Codex, "General").unwrap();
        assert_eq!(db.list_chats(Some("a")).unwrap(), vec![chat.clone()]);
        assert_eq!(db.list_chats(None).unwrap(), vec![global]);
        assert_eq!(db.get_chat(&chat.id).unwrap(), Some(chat.clone()));
        assert_eq!(db.get_chat("nope").unwrap(), None);

        let file = MessagePart::File { path: "/w/a/brief.pdf".into(), name: "brief.pdf".into(), mime: "application/pdf".into(), size: 3, modified_at: None };
        let m1 = db.add_message(&chat.id, MessageRole::User, &[MessagePart::Text { text: "look".into() }, file.clone()]).unwrap();
        let m2 = db.add_message(&chat.id, MessageRole::Agent, &[MessagePart::Text { text: "ok".into() }]).unwrap();
        let got = db.list_messages(&chat.id).unwrap();
        assert_eq!(got, vec![m1, m2]);
        assert_eq!(got[0].parts[1], file);
    }

    #[test]
    fn an_old_chat_with_video_app_parts_still_opens() {
        let db = db();
        let chat = db.create_chat(None, AgentId::Claude, "Old").unwrap();
        db.conn()
            .execute(
                "INSERT INTO messages (id, chat_id, role, parts, created_at) VALUES ('m', ?1, 'user', ?2, 't')",
                rusqlite::params![
                    chat.id,
                    r#"[{"type":"text","text":"look"},{"type":"frame","projectId":"p","frame":1,"timeSec":0,"imagePath":"/x.png","marks":[]},{"type":"style-mention","styleId":"s","name":"S"}]"#
                ],
            )
            .unwrap();
        let got = db.list_messages(&chat.id).unwrap();
        assert_eq!(got[0].parts, vec![MessagePart::Text { text: "look".into() }]);
    }

    #[test]
    fn get_chat_finds_project_chats() {
        let db = Db::open_in_memory().unwrap();
        let chat = db.create_chat(Some("p1"), AgentId::Gemini, "Intro").unwrap();
        let loose = db.create_chat(None, AgentId::Claude, "Loose").unwrap();
        // The unfiltered list only has chats without a project, so lookups must go by id.
        assert!(!db.list_chats(None).unwrap().contains(&chat));
        assert_eq!(db.get_chat(&chat.id).unwrap(), Some(chat));
        assert_eq!(db.get_chat(&loose.id).unwrap(), Some(loose));
        assert_eq!(db.get_chat("missing").unwrap(), None);
    }
}
