//! Projects.

use super::{bind_values, merge_patch, now, query_as, Db, DbError, Result};
use crate::types::*;
use rusqlite::params_from_iter;
use serde_json::{json, Value};

// Column lists use camelCase aliases so rows deserialize straight into the serde types.
// A status from the video app (`rendered`, `scheduled`) reads as `building`.
const PROJECT_SELECT: &str = "SELECT id, title, slug, folder, \
    CASE status WHEN 'draft' THEN 'draft' ELSE 'building' END AS status, \
    created_at AS createdAt, updated_at AS updatedAt FROM projects";
const PROJECT_KEYS: [&str; 7] = ["id", "title", "slug", "folder", "status", "createdAt", "updatedAt"];

impl Db {
    pub fn list_projects(&self) -> Result<Vec<Project>> {
        let sql = format!("{PROJECT_SELECT} ORDER BY updated_at DESC, rowid DESC");
        query_as(&self.conn(), &sql, &[])
    }

    pub fn insert_project(&self, p: &Project) -> Result<()> {
        let vals = bind_values(p, &PROJECT_KEYS)?;
        self.conn().execute(
            "INSERT INTO projects (id, title, slug, folder, status, created_at, updated_at, kind, format, language) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,'explainer','9:16','id')",
            params_from_iter(vals),
        )?;
        Ok(())
    }

    pub fn get_project(&self, id: &str) -> Result<Option<Project>> {
        let sql = format!("{PROJECT_SELECT} WHERE id = ?1");
        Ok(query_as::<Project>(&self.conn(), &sql, &[&id])?.into_iter().next())
    }

    /// Shallow-merges `patch` over the stored project. `id` cannot change; `updatedAt`
    /// is bumped unless the patch sets it.
    pub fn update_project(&self, id: &str, patch: Value) -> Result<Project> {
        if let Some(new_id) = patch.get("id") {
            if new_id != &json!(id) {
                return Err(DbError("project id cannot be changed".into()));
            }
        }
        let current = self
            .get_project(id)?
            .ok_or_else(|| DbError(format!("project not found: {id}")))?;
        let mut merged = serde_json::to_value(&current)?;
        if patch.get("updatedAt").is_none() {
            merged["updatedAt"] = json!(now());
        }
        merge_patch(&mut merged, &patch);
        let updated: Project = serde_json::from_value(merged)?;
        let mut vals = bind_values(&updated, &PROJECT_KEYS)?;
        let id_val = vals.remove(0);
        vals.push(id_val);
        self.conn().execute(
            "UPDATE projects SET title=?1, slug=?2, folder=?3, status=?4, created_at=?5, updated_at=?6 WHERE id=?7",
            params_from_iter(vals),
        )?;
        Ok(updated)
    }

    /// Moves a project along draft → building. Without `reset` it never goes back, and a project
    /// already there is returned as it is, unwritten. `updatedAt` never changes.
    pub fn set_project_status(&self, id: &str, status: ProjectStatus, reset: bool) -> Result<Project> {
        let rank = |s: ProjectStatus| match s {
            ProjectStatus::Draft => 0,
            ProjectStatus::Building => 1,
        };
        let current = self
            .get_project(id)?
            .ok_or_else(|| DbError(format!("project not found: {id}")))?;
        let moves = if reset { current.status != status } else { rank(status) > rank(current.status) };
        if !moves {
            return Ok(current);
        }
        // Not an edit: `updatedAt` (the "recent" order and "x ago") stays as it was.
        self.update_project(id, json!({ "status": status, "updatedAt": current.updated_at }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infra::db::testing::*;
    use serde_json::json;

    #[test]
    fn project_insert_list_update() {
        let db = db();
        db.insert_project(&project("a", "2026-01-01T00:00:00Z")).unwrap();
        db.insert_project(&project("b", "2026-02-01T00:00:00Z")).unwrap();
        let ids: Vec<_> = db.list_projects().unwrap().into_iter().map(|p| p.id).collect();
        assert_eq!(ids, ["b", "a"]);
        assert_eq!(db.get_project("zzz").unwrap(), None);

        let up = db
            .update_project("a", json!({"title": "New", "status": "building"}))
            .unwrap();
        assert_eq!(up.title, "New");
        assert_eq!(up.status, ProjectStatus::Building);
        assert_eq!(db.get_project("a").unwrap().unwrap(), up);
        let ids: Vec<_> = db.list_projects().unwrap().into_iter().map(|p| p.id).collect();
        assert_eq!(ids, ["a", "b"]);

        assert!(db.update_project("a", json!({"id": "other"})).is_err());
        assert!(db.update_project("a", json!({"status": "bogus"})).is_err());
        assert!(db.update_project("missing", json!({"title": "x"})).is_err());
        assert_eq!(db.get_project("a").unwrap().unwrap().title, "New");
    }

    #[test]
    fn project_status_only_moves_forward_unless_reset() {
        let db = db();
        db.insert_project(&project("a", "2026-01-01T00:00:00Z")).unwrap();
        let b = db.set_project_status("a", ProjectStatus::Building, false).unwrap();
        assert_eq!(b.status, ProjectStatus::Building);
        // A status move is not an edit: the project keeps its place in "recent" lists.
        assert_eq!(b.updated_at, "2026-01-01T00:00:00Z");
        assert_eq!(db.get_project("a").unwrap().unwrap().updated_at, "2026-01-01T00:00:00Z");
        // The same status again changes nothing, not even the time.
        let again = db.set_project_status("a", ProjectStatus::Building, false).unwrap();
        assert_eq!(again, b);
        // Never backwards on its own.
        assert_eq!(db.set_project_status("a", ProjectStatus::Draft, false).unwrap().status, ProjectStatus::Building);
        // An explicit reset may.
        assert_eq!(db.set_project_status("a", ProjectStatus::Draft, true).unwrap().status, ProjectStatus::Draft);
        assert_eq!(db.get_project("a").unwrap().unwrap().status, ProjectStatus::Draft);
        assert_eq!(db.get_project("a").unwrap().unwrap().updated_at, "2026-01-01T00:00:00Z");
        assert!(db.set_project_status("missing", ProjectStatus::Building, false).is_err());
    }


}
