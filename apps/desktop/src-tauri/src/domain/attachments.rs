//! Files the user attaches to a chat: copied into the chat's folder, where the agent may read them.

use crate::domain::projects;
use crate::domain::workspace::safe_segment;
use crate::types::MessagePart;
use std::path::Path;

/// The largest file a chat takes.
pub(crate) const MAX_ATTACHMENT: u64 = 50 * 1024 * 1024;
/// Larger images go to the agent as the "Attached file" line: agents refuse big inline images.
pub(crate) const MAX_IMAGE_BLOCK: u64 = 5 * 1024 * 1024;

/// Mime type from the file extension; unknown ones are generic binary.
pub(crate) fn mime_for(name: &str) -> &'static str {
    let ext = Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        "txt" | "md" => "text/plain",
        "csv" => "text/csv",
        "json" => "application/json",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        _ => "application/octet-stream",
    }
}

/// Images the agent gets as an image block (the types ACP's `image_block` sends). A gif is a file.
pub(crate) fn is_image_name(name: &str) -> bool {
    matches!(mime_for(name), "image/png" | "image/jpeg" | "image/webp")
}

pub(crate) fn human_size(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    let b = bytes as f64;
    if b < KB {
        format!("{bytes} B")
    } else if b < KB * KB {
        format!("{:.1} KB", b / KB)
    } else {
        format!("{:.1} MB", b / (KB * KB))
    }
}

/// Copies `source` into `<cwd>/attachments/`, under a name that is not taken yet.
pub(crate) fn copy_attachment(cwd: &Path, source: &Path, max: u64) -> Result<MessagePart, String> {
    let meta = std::fs::metadata(source).map_err(|e| format!("Can't read that file: {e}"))?;
    if !meta.is_file() {
        return Err("That isn't a file".into());
    }
    if meta.len() > max {
        return Err("That file is larger than 50 MB".into());
    }
    let file_name = source
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .filter(|n| safe_segment(n))
        .ok_or("That file has no usable name")?;
    let dir = cwd.join("attachments");
    if !projects::ensure_inside(cwd, &dir) {
        return Err("The agent can only read files inside this chat's folder".into());
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("Can't create {}: {e}", dir.display()))?;
    let (stem, ext) = match file_name.rfind('.') {
        Some(i) if i > 0 => (file_name[..i].to_string(), file_name[i..].to_string()),
        _ => (file_name.clone(), String::new()),
    };
    let mut name = file_name;
    let mut n = 1;
    loop {
        let dest = dir.join(&name);
        if !projects::ensure_inside(cwd, &dest) {
            return Err("The agent can only read files inside this chat's folder".into());
        }
        // create_new keeps two attachments from racing for the same name.
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&dest) {
            Ok(mut out) => {
                let mut input = std::fs::File::open(source)
                    .map_err(|e| format!("Can't read that file: {e}"))?;
                if let Err(e) = std::io::copy(&mut input, &mut out) {
                    drop(out);
                    let _ = std::fs::remove_file(&dest);
                    return Err(format!("Can't copy that file: {e}"));
                }
                return Ok(MessagePart::File {
                    path: dest.to_string_lossy().into_owned(),
                    mime: mime_for(&name).into(),
                    name,
                    size: meta.len(),
                    modified_at: None,
                });
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                n += 1;
                name = format!("{stem}-{n}{ext}");
            }
            Err(e) => return Err(format!("Can't copy that file: {e}")),
        }
    }
}

/// Attached files must live inside the chat's own folder.
pub(crate) fn check_file_parts(cwd: &Path, parts: &[MessagePart]) -> Result<(), String> {
    for part in parts {
        if let MessagePart::File { path, .. } = part {
            if !projects::ensure_inside(cwd, Path::new(path)) {
                return Err("That file is outside this chat's folder".into());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn attach_copies_into_attachments_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let cwd = tmp.path().join("cwd");
        std::fs::create_dir_all(&cwd).unwrap();
        let src = tmp.path().join("notes.pdf");
        std::fs::write(&src, b"hello").unwrap();
        let part = copy_attachment(&cwd, &src, MAX_ATTACHMENT).unwrap();
        let dest = cwd.join("attachments").join("notes.pdf");
        assert_eq!(std::fs::read(&dest).unwrap(), b"hello");
        assert_eq!(
            part,
            MessagePart::File {
                path: dest.to_string_lossy().into_owned(),
                name: "notes.pdf".into(),
                mime: "application/pdf".into(),
                size: 5,
                modified_at: None,
            }
        );
    }

    #[test]
    fn attach_names_collisions_uniquely() {
        let tmp = tempfile::tempdir().unwrap();
        let cwd = tmp.path().join("cwd");
        std::fs::create_dir_all(&cwd).unwrap();
        let src = tmp.path().join("a.png");
        std::fs::write(&src, b"1").unwrap();
        copy_attachment(&cwd, &src, MAX_ATTACHMENT).unwrap();
        std::fs::write(&src, b"22").unwrap();
        let MessagePart::File { name, path, mime, .. } =
            copy_attachment(&cwd, &src, MAX_ATTACHMENT).unwrap()
        else {
            panic!("not a file part")
        };
        assert_eq!(name, "a-2.png");
        assert_eq!(mime, "image/png");
        assert_eq!(std::fs::read(path).unwrap(), b"22");
        assert_eq!(std::fs::read(cwd.join("attachments").join("a.png")).unwrap(), b"1");
    }

    #[test]
    fn attach_rejects_big_files_and_non_files() {
        let tmp = tempfile::tempdir().unwrap();
        let cwd = tmp.path().join("cwd");
        std::fs::create_dir_all(&cwd).unwrap();
        let src = tmp.path().join("big.bin");
        std::fs::write(&src, vec![0u8; 11]).unwrap();
        let e = copy_attachment(&cwd, &src, 10).unwrap_err();
        assert_eq!(e, "That file is larger than 50 MB");
        assert!(copy_attachment(&cwd, tmp.path(), 10).is_err());
        assert!(copy_attachment(&cwd, &tmp.path().join("missing"), 10).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn attach_rejects_a_destination_outside_the_cwd() {
        let tmp = tempfile::tempdir().unwrap();
        let cwd = tmp.path().join("cwd");
        let outside = tmp.path().join("outside");
        std::fs::create_dir_all(&cwd).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, cwd.join("attachments")).unwrap();
        let src = tmp.path().join("a.txt");
        std::fs::write(&src, b"x").unwrap();
        assert!(copy_attachment(&cwd, &src, MAX_ATTACHMENT).is_err());
        assert!(!outside.join("a.txt").exists());
    }


    #[test]
    fn file_parts_must_be_inside_the_chat_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let cwd = tmp.path().join("cwd");
        std::fs::create_dir_all(&cwd).unwrap();
        let file = |p: PathBuf| MessagePart::File {
            path: p.to_string_lossy().into_owned(),
            name: "x".into(),
            mime: "text/plain".into(),
            size: 1,
            modified_at: None,
        };
        assert!(check_file_parts(&cwd, &[file(cwd.join("attachments").join("x"))]).is_ok());
        assert!(check_file_parts(&cwd, &[file(tmp.path().join("secret"))]).is_err());
    }
}
