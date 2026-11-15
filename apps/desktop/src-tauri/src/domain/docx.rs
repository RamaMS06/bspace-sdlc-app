//! A Word document (.docx) as Markdown, so the app can show a Blueprint or FTSD without Word: headings,
//! paragraphs, bold and italic text, lists and tables. Pictures, comments and tracked changes are left
//! out; the document itself is never changed.

use std::io::Read;

/// Largest .docx read (bigger ones are opened in Word).
pub const MAX_BYTES: u64 = 25 * 1024 * 1024;

/// The Markdown of a .docx file's body.
pub fn to_markdown(bytes: &[u8]) -> Result<String, String> {
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|_| "This isn't a Word document".to_string())?;
    let mut xml = String::new();
    zip.by_name("word/document.xml")
        .map_err(|_| "This isn't a Word document".to_string())?
        .take(64 * 1024 * 1024)
        .read_to_string(&mut xml)
        .map_err(|_| "This Word document can't be read".to_string())?;
    Ok(from_document_xml(&xml))
}

fn decode(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let Some(end) = rest.find(';') else { break };
        let ent = &rest[1..end];
        let ch = match ent {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            _ if ent.starts_with("#x") => u32::from_str_radix(&ent[2..], 16).ok().and_then(char::from_u32),
            _ if ent.starts_with('#') => ent[1..].parse().ok().and_then(char::from_u32),
            _ => None,
        };
        match ch {
            Some(c) => {
                out.push(c);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// The value of attribute `name` (like `w:val`) in a tag's text.
fn attr<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let at = tag.find(&format!("{name}=\""))? + name.len() + 2;
    let end = tag[at..].find('"')?;
    Some(&tag[at..at + end])
}

/// Whether a run property like `<w:b/>` turns the style on (`w:val="0"`/`"false"` turns it off).
fn on(tag: &str) -> bool {
    !matches!(attr(tag, "w:val"), Some("0") | Some("false") | Some("none"))
}

#[derive(Default)]
struct Para {
    /// A table-of-contents line: its page numbers mean nothing here, so it is left out.
    toc: bool,
    heading: usize,
    list: Option<usize>,
    text: String,
}

#[derive(Default)]
struct Run {
    bold: bool,
    italic: bool,
    text: String,
}

fn flush_run(p: &mut Para, r: &mut Run) {
    let t = std::mem::take(&mut r.text);
    if t.trim().is_empty() || p.heading > 0 {
        p.text.push_str(&t);
    } else {
        // Markdown emphasis can't start or end with a space: keep those outside the marks.
        let (lead, core, trail) = {
            let core = t.trim();
            let lead = &t[..t.len() - t.trim_start().len()];
            let trail = &t[t.trim_end().len()..];
            (lead, core, trail)
        };
        let mark = match (r.bold, r.italic) {
            (true, true) => "***",
            (true, false) => "**",
            (false, true) => "*",
            _ => "",
        };
        p.text.push_str(lead);
        p.text.push_str(mark);
        p.text.push_str(core);
        p.text.push_str(mark);
        p.text.push_str(trail);
    }
    r.bold = false;
    r.italic = false;
}

fn para_line(p: &Para) -> String {
    let text = p.text.trim();
    if text.is_empty() || p.toc {
        return String::new();
    }
    if p.heading > 0 {
        return format!("{} {}", "#".repeat(p.heading.min(6)), text);
    }
    if let Some(level) = p.list {
        return format!("{}- {}", "  ".repeat(level), text);
    }
    text.to_string()
}

fn cell(s: &str) -> String {
    s.replace('|', "\\|").replace('\n', " ").trim().to_string()
}

/// The Markdown of `word/document.xml`.
pub fn from_document_xml(xml: &str) -> String {
    let mut blocks: Vec<String> = Vec::new();
    let mut p = Para::default();
    let mut r = Run::default();
    let mut in_text = false;
    let mut in_rpr = false;
    // Tables (they can nest: the innermost is the one being filled).
    let mut tables: Vec<Vec<Vec<String>>> = Vec::new();
    let mut cell_text: Vec<String> = Vec::new();

    let mut rest = xml;
    while let Some(lt) = rest.find('<') {
        if in_text {
            r.text.push_str(&decode(&rest[..lt]));
        }
        let Some(gt) = rest[lt..].find('>') else { break };
        let tag = &rest[lt + 1..lt + gt];
        rest = &rest[lt + gt + 1..];
        let closing = tag.starts_with('/');
        let name = tag.trim_start_matches('/').split(|c: char| c.is_whitespace() || c == '/').next().unwrap_or("");
        match (name, closing) {
            ("w:p", false) if !tag.ends_with('/') => p = Para::default(),
            ("w:p", true) => {
                flush_run(&mut p, &mut r);
                let line = para_line(&p);
                if let Some(c) = cell_text.last_mut() {
                    if !line.is_empty() {
                        if !c.is_empty() {
                            c.push_str("; ");
                        }
                        c.push_str(&line);
                    }
                } else if !line.is_empty() {
                    blocks.push(line);
                }
                p = Para::default();
            }
            ("w:pStyle", false) => {
                let v = attr(tag, "w:val").unwrap_or("").to_lowercase();
                if v == "title" || v == "heading" {
                    p.heading = 1;
                } else if v.starts_with("toc") {
                    p.toc = true;
                } else if let Some(n) = v.strip_prefix("heading").and_then(|n| n.trim().parse::<usize>().ok()) {
                    p.heading = n;
                } else if v.contains("list") && p.list.is_none() {
                    p.list = Some(0);
                }
            }
            ("w:ilvl", false) => p.list = Some(attr(tag, "w:val").and_then(|v| v.parse().ok()).unwrap_or(0)),
            ("w:numPr", false) if p.list.is_none() => p.list = Some(0),
            ("w:r", false) if !tag.ends_with('/') => {
                flush_run(&mut p, &mut r);
            }
            ("w:r", true) => flush_run(&mut p, &mut r),
            ("w:rPr", false) => in_rpr = !tag.ends_with('/'),
            ("w:rPr", true) => in_rpr = false,
            ("w:b", false) if in_rpr => r.bold = on(tag),
            ("w:i", false) if in_rpr => r.italic = on(tag),
            ("w:t", false) => in_text = !tag.ends_with('/'),
            ("w:t", true) => in_text = false,
            ("w:tab", false) => r.text.push(' '),
            ("w:br", false) | ("w:cr", false) => r.text.push(' '),
            ("w:tbl", false) => tables.push(Vec::new()),
            ("w:tr", false) => {
                if let Some(t) = tables.last_mut() {
                    t.push(Vec::new());
                }
            }
            ("w:tc", false) => cell_text.push(String::new()),
            ("w:tc", true) => {
                let c = cell_text.pop().unwrap_or_default();
                if let Some(row) = tables.last_mut().and_then(|t| t.last_mut()) {
                    row.push(cell(&c));
                }
            }
            ("w:tbl", true) => {
                let rows = tables.pop().unwrap_or_default();
                let md = table(&rows);
                // A table inside a cell is flattened into that cell.
                if let Some(c) = cell_text.last_mut() {
                    c.push_str(&rows.iter().map(|r| r.join(" · ")).collect::<Vec<_>>().join("; "));
                } else if !md.is_empty() {
                    blocks.push(md);
                }
            }
            _ => {}
        }
    }
    // Consecutive list items stay together; everything else is its own paragraph.
    let mut out = String::new();
    for (i, b) in blocks.iter().enumerate() {
        if i > 0 {
            let both_list = |s: &str| s.trim_start().starts_with("- ");
            out.push_str(if both_list(b) && both_list(&blocks[i - 1]) { "\n" } else { "\n\n" });
        }
        out.push_str(b);
    }
    out
}

fn table(rows: &[Vec<String>]) -> String {
    let rows: Vec<&Vec<String>> = rows.iter().filter(|r| !r.is_empty()).collect();
    let width = rows.iter().map(|r| r.len()).max().unwrap_or(0);
    if width == 0 {
        return String::new();
    }
    let line = |r: &Vec<String>| {
        let mut cells: Vec<String> = r.clone();
        cells.resize(width, String::new());
        format!("| {} |", cells.join(" | "))
    };
    let mut out = vec![line(rows[0]), format!("|{}|", vec![" --- "; width].join("|"))];
    out.extend(rows[1..].iter().map(|r| line(r)));
    out.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn p(style: Option<&str>, runs: &str) -> String {
        let ppr = style.map(|s| format!(r#"<w:pPr><w:pStyle w:val="{s}"/></w:pPr>"#)).unwrap_or_default();
        format!("<w:p>{ppr}{runs}</w:p>")
    }
    fn run(t: &str) -> String {
        format!(r#"<w:r><w:t xml:space="preserve">{t}</w:t></w:r>"#)
    }

    #[test]
    #[ignore = "reads a real Blueprint on this machine: BUMA_DOCX=/path cargo test real_docx -- --ignored --nocapture"]
    fn real_docx() {
        let path = std::env::var("BUMA_DOCX").unwrap();
        let md = to_markdown(&std::fs::read(path).unwrap()).unwrap();
        println!("{}", &md[..md.len().min(3000)]);
        assert!(!md.trim().is_empty());
    }

    #[test]
    fn headings_paragraphs_emphasis_and_entities() {
        let body = [
            p(Some("Title"), &run("Attendance Blueprint")),
            p(Some("Heading2"), &run("1. Scope")),
            p(None, &format!(r#"{}<w:r><w:rPr><w:b/></w:rPr><w:t>clock in</w:t></w:r>{}"#, run("Workers "), run(" &amp; out &lt;daily&gt;."))),
            p(None, r#"<w:r><w:rPr><w:b w:val="0"/><w:i/></w:rPr><w:t>note</w:t></w:r>"#),
            p(None, ""),
            p(Some("TOC 1"), &run("Project Definition 2")),
            p(Some("Heading 3"), &run("1.1 Overview")),
            p(Some("Heading"), &run("Process")),
        ]
        .concat();
        let md = from_document_xml(&format!("<w:document><w:body>{body}</w:body></w:document>"));
        assert_eq!(md, "# Attendance Blueprint\n\n## 1. Scope\n\nWorkers **clock in** & out <daily>.\n\n*note*\n\n### 1.1 Overview\n\n# Process");
    }

    #[test]
    fn lists_stay_together_with_their_levels() {
        let item = |lvl: u8, t: &str| format!(r#"<w:p><w:pPr><w:numPr><w:ilvl w:val="{lvl}"/><w:numId w:val="1"/></w:numPr></w:pPr>{}</w:p>"#, run(t));
        let md = from_document_xml(&[p(None, &run("Roles:")), item(0, "Worker"), item(1, "Shift"), item(0, "Supervisor")].concat());
        assert_eq!(md, "Roles:\n\n- Worker\n  - Shift\n- Supervisor");
    }

    #[test]
    fn tables_become_markdown_tables() {
        let tc = |t: &str| format!("<w:tc><w:tcPr/>{}</w:tc>", p(None, &run(t)));
        let tr = |a: &str, b: &str| format!("<w:tr>{}{}</w:tr>", tc(a), tc(b));
        let md = from_document_xml(&format!("<w:tbl>{}{}</w:tbl>{}", tr("Field", "Source"), tr("NRP", "SAP | HR"), p(None, &run("after"))));
        assert_eq!(md, "| Field | Source |\n| --- | --- |\n| NRP | SAP \\| HR |\n\nafter");
    }

    #[test]
    fn reads_a_real_docx_zip_and_refuses_other_files() {
        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut z = zip::ZipWriter::new(&mut buf);
            z.start_file("word/document.xml", zip::write::SimpleFileOptions::default()).unwrap();
            z.write_all(format!("<w:document><w:body>{}</w:body></w:document>", p(Some("Heading1"), &run("FTSD"))).as_bytes()).unwrap();
            z.finish().unwrap();
        }
        assert_eq!(to_markdown(buf.get_ref()).unwrap(), "# FTSD");
        assert!(to_markdown(b"not a zip").unwrap_err().contains("Word"));
    }
}
