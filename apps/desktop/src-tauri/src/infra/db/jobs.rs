//! Board cards (jobs).

use super::{bind_values, now, query_as, Db, Result};
use crate::types::*;
use rusqlite::params_from_iter;

const JOB_SELECT: &str = "SELECT id, kind, title, project_id AS projectId, chat_id AS chatId, \
    agent_id AS agentId, status, progress, note, updated_at AS updatedAt, archived_at AS archivedAt FROM jobs";
const JOB_KEYS: [&str; 10] = ["id", "kind", "title", "projectId", "chatId", "agentId", "status", "progress", "note", "updatedAt"];

impl Db {
    /// Archives or restores board cards. A working card is never archived: it is still going.
    pub fn set_jobs_archived(&self, ids: &[String], archived: bool) -> Result<()> {
        let stamp: Option<String> = archived.then(now);
        let conn = self.conn();
        let tx = conn.unchecked_transaction()?;
        for id in ids {
            tx.execute(
                "UPDATE jobs SET archived_at = ?2 WHERE id = ?1 AND (?2 IS NULL OR status <> 'working')",
                rusqlite::params![id, stamp],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    // ---- jobs ----

    pub fn upsert_job(&self, j: &Job) -> Result<()> {
        let vals = bind_values(j, &JOB_KEYS)?;
        self.conn().execute(
            "INSERT INTO jobs (id, kind, title, project_id, chat_id, agent_id, status, progress, note, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, \
             title=excluded.title, project_id=excluded.project_id, chat_id=excluded.chat_id, \
             agent_id=excluded.agent_id, status=excluded.status, progress=excluded.progress, \
             note=excluded.note, updated_at=excluded.updated_at, \
             archived_at=CASE WHEN jobs.status = excluded.status THEN jobs.archived_at ELSE NULL END",
            params_from_iter(vals),
        )?;
        Ok(())
    }

    /// Marks jobs still `working` as failed with `note`: their agent died with the app.
    /// Returns how many changed.
    pub fn fail_stale_jobs(&self, note: &str) -> Result<usize> {
        Ok(self.conn().execute(
            // A permission request (needs-you, no note) died with its session too; a build turn that
            // stopped waiting for an answer (needs-you with its note) still waits for the user.
            "UPDATE jobs SET status = 'failed', note = ?1, updated_at = ?2 \
             WHERE status = 'working' OR (status = 'needs-you' AND note IS NULL)",
            rusqlite::params![note, now()],
        )?)
    }

    /// Removes a job from the board. A job that is working is never deleted (the board may be
    /// stale), and deleting a job that isn't there is fine.
    pub fn delete_job(&self, id: &str) -> Result<()> {
        self.conn().execute("DELETE FROM jobs WHERE id = ?1 AND status <> 'working'", [id])?;
        Ok(())
    }

    /// Build cards only: the video app's other cards (renders, style studies) are left out.
    pub fn list_jobs(&self) -> Result<Vec<Job>> {
        let sql = format!("{JOB_SELECT} WHERE kind = 'build' ORDER BY updated_at DESC, rowid DESC");
        query_as(&self.conn(), &sql, &[])
    }

}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infra::db::testing::*;

    #[test]
    fn jobs_upsert_and_list() {
        let db = db();
        let mut j = Job {
            id: "j1".into(),
            kind: JobKind::Build,
            title: "Build".into(),
            project_id: None,
            chat_id: None,
            agent_id: AgentId::Claude,
            status: JobStatus::Queued,
            progress: None,
            note: None,
            archived_at: None,
            updated_at: "2026-01-01T00:00:00Z".into(),
        };
        db.upsert_job(&j).unwrap();
        j.status = JobStatus::Working;
        j.progress = Some(0.5);
        j.updated_at = "2026-01-02T00:00:00Z".into();
        db.upsert_job(&j).unwrap();
        assert_eq!(db.list_jobs().unwrap(), vec![j.clone()]);
    }


    #[test]
    fn delete_job_removes_only_that_job() {
        let db = db();
        let job = |id: &str| Job {
            id: id.into(),
            kind: JobKind::Build,
            title: id.into(),
            project_id: None,
            chat_id: None,
            agent_id: AgentId::Claude,
            status: JobStatus::Failed,
            progress: None,
            note: None,
            archived_at: None,
            updated_at: "2026-01-01T00:00:00Z".into(),
        };
        db.upsert_job(&job("a")).unwrap();
        db.upsert_job(&job("b")).unwrap();
        let mut working = job("w");
        working.status = JobStatus::Working;
        db.upsert_job(&working).unwrap();
        db.delete_job("a").unwrap();
        db.delete_job("missing").unwrap();
        // A job that is working again (stale board) is never deleted.
        db.delete_job("w").unwrap();
        let ids: Vec<_> = db.list_jobs().unwrap().into_iter().map(|j| j.id).collect();
        assert!(ids.contains(&"w".to_string()) && ids.contains(&"b".to_string()) && !ids.contains(&"a".to_string()));
    }

    #[test]
    fn stale_working_jobs_fail_on_start() {
        let db = db();
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
            archived_at: None,
            updated_at: "2026-01-01T00:00:00Z".into(),
        };
        db.upsert_job(&job("w", JobStatus::Working)).unwrap();
        db.upsert_job(&job("d", JobStatus::Done)).unwrap();
        db.upsert_job(&job("p", JobStatus::NeedsYou)).unwrap();
        let mut stopped = job("s", JobStatus::NeedsYou);
        stopped.note = Some("Waiting for your answer".into());
        db.upsert_job(&stopped).unwrap();
        assert_eq!(db.fail_stale_jobs("closed").unwrap(), 2);
        let after = db.list_jobs().unwrap();
        assert_eq!(after.iter().find(|j| j.id == "p").unwrap().status, JobStatus::Failed);
        assert_eq!(after.iter().find(|j| j.id == "s").unwrap().status, JobStatus::NeedsYou);
        let jobs = db.list_jobs().unwrap();
        let w = jobs.iter().find(|j| j.id == "w").unwrap();
        assert_eq!((w.status, w.note.as_deref()), (JobStatus::Failed, Some("closed")));
        assert_eq!(jobs.iter().find(|j| j.id == "d").unwrap().status, JobStatus::Done);
    }
}
