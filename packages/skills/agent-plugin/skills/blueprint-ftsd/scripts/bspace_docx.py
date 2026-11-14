#!/usr/bin/env python3
"""BUMA Blueprint / FTSD docx helper. Stdlib only: runs in Claude Code, Codex, Claude.ai and ChatGPT code execution.

  fill     --template BUMA.docx --md X.md --out X.docx      draft md -> docx, once (never overwrites)
  snapshot X.docx                                          docx -> X.md + X.media/ (what the AI reads)
  gate     X.docx --name B --table REGEX [--only|--skip|--hash-skip REGEX]
                                                           every approval row dated, nothing changed since
  ids      old.md new.md [--also other.md ...]             changed IDs + IDs that cite them (stale)
  contract ftsd.md openapi.yaml                            every SCR has an operation, §6.2 API-xx = x-id
  comment  X.docx --find TEXT --text TEXT [--author NAME]  Word comment on the first paragraph containing TEXT
"""
import argparse, hashlib, html, json, os, re, shutil, sys, zipfile
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape, quoteattr

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
ID = re.compile(r'\b(?:US|BR|AR|SRC|SCR|TC|API)-\d+')
DATED = re.compile(r'\d{4}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2}')
BODY_W = 9029  # A4 width minus BUMA template margins, dxa


def q(tag, ns=W):
    return '{%s}%s' % (ns, tag)


def read_zip(path):
    with zipfile.ZipFile(path) as z:
        return {n: z.read(n) for n in z.namelist()}


def write_zip(path, files):
    tmp = path + '.tmp'
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as z:
        for n, data in files.items():
            z.writestr(n, data)
    os.replace(tmp, path)


# ---------- fill: md -> docx, reusing the template's styles, header logos, footer and page setup

def run(text, rpr=''):
    return '<w:r>%s<w:t xml:space="preserve">%s</w:t></w:r>' % ('<w:rPr>%s</w:rPr>' % rpr if rpr else '', escape(text))


def para(text, style=None, ppr='', rpr=''):
    s = '<w:pStyle w:val="%s"/>' % style if style else ''
    return '<w:p><w:pPr>%s%s</w:pPr>%s</w:p>' % (s, ppr, run(text, rpr) if text else '')


def table(rows):
    n = max(len(r) for r in rows)
    w = BODY_W // n
    out = []
    for i, r in enumerate(rows):
        shd, bold = ('<w:shd w:val="clear" w:color="auto" w:fill="D9E2F3"/>', '<w:b/>') if i == 0 else ('', '')
        cells = ''.join('<w:tc><w:tcPr><w:tcW w:w="%d" w:type="dxa"/>%s</w:tcPr>%s</w:tc>'
                        % (w, shd, ''.join(para(t.strip(), ppr='<w:ind w:firstLine="0"/>', rpr=bold) for t in c.split('<br>')))
                        for c in r + [''] * (n - len(r)))
        out.append('<w:tr>%s%s</w:tr>' % ('<w:trPr><w:tblHeader/></w:trPr>' if i == 0 else '', cells))
    border = ''.join('<w:%s w:val="single" w:sz="4" w:space="0" w:color="4472C4"/>' % s
                     for s in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'))
    return ('<w:tbl><w:tblPr><w:tblStyle w:val="ProposalTable4"/><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>' + border + '</w:tblBorders>'
            '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>'
            '</w:tblPr><w:tblGrid>%s</w:tblGrid>%s</w:tbl><w:p/>' % ('<w:gridCol w:w="%d"/>' % w * n, ''.join(out)))


def md_body(lines):
    out, tbl = [], []
    for line in lines + ['']:
        s = line.rstrip()
        if s.lstrip().startswith('|'):
            cells = [c.strip().replace('\\|', '|') for c in re.split(r'(?<!\\)\|', s.strip().strip('|'))]
            if not all(re.fullmatch(r':?-+:?', c) for c in cells):
                tbl.append(cells)
            continue
        if tbl:
            out.append(table(tbl))
            tbl = []
        h = re.match(r'(#{1,4}) (.*)', s)
        b = re.match(r'(\s*)[-*] (.*)', s)
        if h:
            out.append(para(h.group(2), 'Heading%d' % len(h.group(1))))
        elif b:
            out.append(para(b.group(2), 'ListParagraph', '<w:numPr><w:ilvl w:val="%d"/><w:numId w:val="10"/></w:numPr>'
                            % min(len(b.group(1)) // 2, 8)))
        elif re.fullmatch(r'\*\*(.+)\*\*', s):  # unnumbered title (Sign Off, Approval)
            out.append(para(s[2:-2], ppr='<w:ind w:firstLine="0"/>', rpr='<w:b/><w:color w:val="0070C0"/>'))
        elif s:
            out.append(para(s))
    return ''.join(out)


PAGE = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
TOC = ('<w:p><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r>'
       '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' + run('Klik kanan → Update Field untuk daftar isi.') +
       '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>')


def empty_root(xml):
    start = xml.index('<', xml.index('?>') + 2) if xml.startswith('<?xml') else 0
    end = xml.index('>', start)
    if xml[end - 1] == '/':
        return xml
    return xml[:end + 1] + '</%s>' % re.match(r'<([\w:]+)', xml[start:]).group(1)


def fill(a):
    if os.path.exists(a.out):
        sys.exit('%s exists: the docx is the source now. Edit it in Word, then run snapshot.' % a.out)
    lines = open(a.md, encoding='utf-8').read().splitlines()
    params, i = {}, 0
    while i < len(lines) and (m := re.match(r'([A-Za-z][\w -]*): (.+)', lines[i])):
        params[m.group(1)] = m.group(2).strip()
        i += 1
    big, grey = '<w:spacing w:before="240" w:after="240"/>', '<w:color w:val="808080"/><w:sz w:val="54"/>'
    body = (para(params.get('Project', ''), 'NoSpacing', big + '<w:jc w:val="right"/>', '<w:color w:val="0070C0"/><w:sz w:val="72"/>')
            + para('PT. Bukit Makmur Mandiri Utama', 'NoSpacing', big, grey)
            + para(params.get('Document', ''), 'NoSpacing', big, grey) + PAGE
            + para('General Information', ppr='<w:ind w:firstLine="0"/>', rpr='<w:b/><w:color w:val="0070C0"/>')
            + table([['Item', 'Value']] + [[k, v] for k, v in params.items()]) + TOC + PAGE + md_body(lines[i:]))
    files = read_zip(a.template)
    doc = files['word/document.xml'].decode('utf-8')
    doc = (doc[:doc.index('<w:body>')] + '<w:body>' + body
           + doc[doc.rindex('<w:sectPr'):doc.rindex('</w:body>')] + '</w:body></w:document>')
    files['word/document.xml'] = doc.encode('utf-8')
    # drop the template's body images/links (other projects' content); header logos live in header rels
    rels = files['word/_rels/document.xml.rels'].decode('utf-8')
    files['word/_rels/document.xml.rels'] = re.sub(
        r'<Relationship [^>]*/>',
        lambda m: '' if re.search(r'Type="[^"]*/(image|hyperlink)"', m.group(0))
        and '"%s"' % re.search(r'Id="(\w+)"', m.group(0)).group(1) not in doc else m.group(0), rels).encode('utf-8')
    used = b''.join(v for k, v in files.items() if k.endswith('.rels'))
    for n in [n for n in files if n.startswith('word/media/') and n[5:].encode() not in used]:
        del files[n]
    for n in [n for n in files if re.fullmatch(r'word/comments\w*\.xml', n)]:
        files[n] = empty_root(files[n].decode('utf-8')).encode('utf-8')
    write_zip(a.out, files)
    print('wrote', a.out)


# ---------- snapshot: docx -> md + media

def run_text(p, img):
    out = []
    for r in p.iter(q('r')):
        for c in r:
            if c.tag == q('t'):
                out.append(c.text or '')
            elif c.tag in (q('tab'), q('br'), q('cr')):
                out.append(' ')
            elif c.tag == q('drawing'):
                out += ['![](%s)' % img(b.get(q('embed', R))) for b in c.iter(q('blip', A))]
    return re.sub(r'\s+', ' ', ''.join(out)).strip()


def blocks(parent):
    for el in parent if parent is not None else []:
        if el.tag == q('sdt'):
            gal = el.find('.//' + q('docPartGallery'))
            if gal is None or 'Table of Contents' not in gal.get(q('val'), ''):
                yield from blocks(el.find(q('sdtContent')))
        elif el.tag in (q('p'), q('tbl')):
            yield el


def snapshot(path):
    files = read_zip(path)
    stem = os.path.splitext(path)[0]
    media = stem + '.media'
    rels = {m.group(1): m.group(2) for m in re.finditer(
        r'<Relationship [^>]*?Id="(\w+)"[^>]*?Target="([^"]+)"', files['word/_rels/document.xml.rels'].decode('utf-8'))}

    def img(rid):
        name = os.path.basename(rels.get(rid, ''))
        if 'word/media/' + name not in files:
            return 'missing-image'
        os.makedirs(media, exist_ok=True)
        with open(os.path.join(media, name), 'wb') as f:
            f.write(files['word/media/' + name])
        return os.path.basename(media) + '/' + name

    out = []
    for el in blocks(ET.fromstring(files['word/document.xml']).find(q('body'))):
        if el.tag == q('tbl'):
            rows = [[' <br> '.join(t for t in (run_text(p, img) for p in tc.iter(q('p'))) if t).replace('|', '\\|')
                     for tc in tr.findall(q('tc'))] for tr in el.findall(q('tr'))]
            n = max([len(r) for r in rows] or [0])
            if n:
                rows = ['|' + ''.join(' %s |' % c if c else ' |' for c in r + [''] * (n - len(r))) for r in rows]
                out += ['', rows[0], '|' + '---|' * n] + rows[1:] + ['']
            continue
        s = run_text(el, img)
        style = el.find('./%s/%s' % (q('pPr'), q('pStyle')))
        h = re.fullmatch(r'Heading(\d)', style.get(q('val')) if style is not None else '')
        if not s or (style is not None and style.get(q('val')).startswith('TOC')) or 'Update Field' in s:
            continue
        if h:
            out += ['', '#' * int(h.group(1)) + ' ' + s, '']
        elif el.find('./%s/%s' % (q('pPr'), q('numPr'))) is not None:
            out.append('- ' + s)
        else:
            out.append(s)
    md = ('<!-- snapshot of %s: edit the docx in Word; this file is overwritten -->\n\n' % os.path.basename(path)
          + re.sub(r'\n{3,}', '\n\n', '\n'.join(out)).strip() + '\n')
    with open(stem + '.md', 'w', encoding='utf-8') as f:
        f.write(md)
    return md


# ---------- gate: approval rows dated by humans, content unchanged since those dates

def cells(line):
    return [c.strip() for c in re.split(r'(?<!\\)\|', line.strip().strip('|'))]


def gate(a):
    md = snapshot(a.docx).splitlines()
    at = next((i for i, l in enumerate(md) if not l.startswith('|') and re.search(a.table, l, re.I)), None)
    if at is None:
        return report(a, False, ['no paragraph matching %r' % a.table])
    start = next((i for i in range(at, len(md)) if md[i].startswith('|')), len(md))
    end = next((i for i in range(start, len(md)) if not md[i].startswith('|')), len(md))
    head = [c.lower() for c in cells(md[start])] if start < len(md) else []
    if 'date' not in head:
        return report(a, False, ['approval table after %r has no Date column' % a.table])
    d, n = head.index('date'), head.index('name') if 'name' in head else None
    signers, missing = [], []
    for line in md[start + 2:end]:
        c = cells(line)
        who = (c[n] if n is not None else '') or ' / '.join(x for j, x in enumerate(c) if j != d and x)
        if not who.strip(' -') or (a.only and not re.search(a.only, line, re.I)) or (a.skip and re.search(a.skip, line, re.I)):
            continue
        signers.append([who, c[d]])
        if not DATED.search(c[d]):
            missing.append('waiting for %s (no date)' % who)
    if not signers:
        missing.append('no signer rows')
    # hash = document minus the approval table and any --hash-skip section, so signing never stales it
    keep, skip_level = [], 0
    for i, line in enumerate(md):
        h = re.match(r'(#+) ', line)
        if h and (not skip_level or len(h.group(1)) <= skip_level):
            skip_level = len(h.group(1)) if a.hash_skip and re.search(a.hash_skip, line, re.I) else 0
        if not skip_level and not start <= i < end and not re.match(r'\| (Status|Version|Approved-hash) \|', line):
            keep.append(line)
    digest = hashlib.sha256('\n'.join(keep).encode('utf-8')).hexdigest()[:12]
    state_path = os.path.splitext(a.docx)[0] + '.gate.json'
    state = json.load(open(state_path)) if os.path.exists(state_path) else {}
    prev = state.get(a.name)
    if not missing and prev and prev['hash'] != digest and prev['dates'] == signers:
        missing.append('changed since approval (%s → %s): status Review, every signer re-dates' % (prev['hash'], digest))
    if not missing:
        state[a.name] = {'hash': digest, 'dates': signers}
        with open(state_path, 'w') as f:
            json.dump(state, f, indent=1)
    return report(a, not missing, missing, digest)


def report(a, ok, problems, digest=None):
    print(json.dumps({'gate': a.name, 'pass': ok, 'hash': digest, 'problems': problems}, ensure_ascii=False))
    return 0 if ok else 1


# ---------- ids: impact of a revision

def definitions(md):
    """ID -> text that defines it: a table row whose first cell holds the ID, or a heading section."""
    out, cur = {}, None
    for line in md.splitlines():
        if line.startswith('#'):
            m = ID.search(line)
            cur = m.group(0) if m else None
            if cur:
                out[cur] = line
            continue
        if line.startswith('|'):
            m = ID.match(cells(line)[0])
            if m:
                out[m.group(0)] = out.get(m.group(0), '') + '\n' + line
                continue
        if cur:
            out[cur] += '\n' + line
    return out


def ids(a):
    old, new = (definitions(open(p, encoding='utf-8').read()) for p in (a.old, a.new))
    changed = sorted(k for k in set(old) | set(new) if old.get(k) != new.get(k))
    defs = dict(new)
    for p in a.also or []:
        defs.update(definitions(open(p, encoding='utf-8').read()))
    stale, todo = set(), list(changed)
    while todo:
        c = todo.pop()
        for k, text in defs.items():
            if k not in stale and k not in changed and re.search(r'\b%s\b' % re.escape(c), text):
                stale.add(k)
                todo.append(k)
    print(json.dumps({'changed': changed, 'stale': sorted(stale)}))
    return 0


# ---------- contract: FTSD §6.2 and openapi.yaml cover the same screens and endpoints

def contract(a):
    md, api = (open(p, encoding='utf-8').read() for p in (a.ftsd, a.openapi))
    scr = set(re.findall(r'SCR-\d+', '\n'.join(l for l in md.splitlines() if l.startswith('#'))))
    listed = set(re.findall(r'^\| (API-\d+)', md, re.M))
    in_api = set(re.findall(r'x-id: (API-\d+)', api))
    problems = (['%s has no operation (x-scr) in openapi.yaml' % s for s in sorted(scr - set(re.findall(r'x-scr: .*?(SCR-\d+)', api)))]
                + ['%s in FTSD §6.2, missing in openapi.yaml' % s for s in sorted(listed - in_api)]
                + ['%s in openapi.yaml, missing in FTSD §6.2' % s for s in sorted(in_api - listed)])
    return report(argparse.Namespace(name='contract'), not problems, problems)


# ---------- comment: AI proposes, the analyst accepts or rejects in Word

CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml'


def comment(a):
    files = read_zip(a.docx)
    doc = files['word/document.xml'].decode('utf-8')
    if 'word/comments.xml' not in files:
        files['word/comments.xml'] = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                                      '<w:comments xmlns:w="%s"/>' % W).encode('utf-8')
        rels = files['word/_rels/document.xml.rels'].decode('utf-8')
        files['word/_rels/document.xml.rels'] = rels.replace('</Relationships>', '<Relationship Id="rIdAiComments" Type="'
            'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>').encode('utf-8')
        ct = files['[Content_Types].xml'].decode('utf-8')
        files['[Content_Types].xml'] = ct.replace('</Types>', '<Override PartName="/word/comments.xml" ContentType="%s"/></Types>' % CT).encode('utf-8')
    com = empty_root(files['word/comments.xml'].decode('utf-8'))
    cid = max([int(x) for x in re.findall(r'w:id="(\d+)"', com + doc)] + [0]) + 1
    for m in re.finditer(r'<w:p\b(?:(?!<w:p\b).)*?</w:p>', doc, re.S):
        text = html.unescape(''.join(re.findall(r'<w:t(?: [^>]*)?>([^<]*)</w:t>', m.group(0))))
        if a.find in text:
            p = m.group(0)
            open_end = p.index('>') + 1
            ppr = re.match(r'<w:pPr>.*?</w:pPr>|<w:pPr/>', p[open_end:], re.S)
            cut = open_end + (ppr.end() if ppr else 0)
            p = (p[:cut] + '<w:commentRangeStart w:id="%d"/>' % cid + p[cut:-6] + '<w:commentRangeEnd w:id="%d"/>'
                 '<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="%d"/></w:r></w:p>' % (cid, cid))
            files['word/document.xml'] = (doc[:m.start()] + p + doc[m.end():]).encode('utf-8')
            close = com.rindex('</')
            files['word/comments.xml'] = (com[:close] + '<w:comment w:id="%d" w:author=%s w:initials="AI">%s</w:comment>'
                                          % (cid, quoteattr(a.author), para(a.text)) + com[close:]).encode('utf-8')
            write_zip(a.docx, files)
            print('comment %d on: %s' % (cid, text[:80]))
            return 0
    sys.exit('no paragraph contains %r' % a.find)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)
    f = sub.add_parser('fill')
    f.add_argument('--template', required=True)
    f.add_argument('--md', required=True)
    f.add_argument('--out', required=True)
    sub.add_parser('snapshot').add_argument('docx')
    g = sub.add_parser('gate')
    g.add_argument('docx')
    g.add_argument('--name', required=True, help='B, F1, F2: key in <doc>.gate.json')
    g.add_argument('--table', required=True, help='regex of the paragraph above the approval table')
    g.add_argument('--only', help='count only signer rows matching')
    g.add_argument('--skip', help='ignore signer rows matching')
    g.add_argument('--hash-skip', help='headings whose sections do not stale this gate')
    i = sub.add_parser('ids')
    i.add_argument('old')
    i.add_argument('new')
    i.add_argument('--also', nargs='*')
    k = sub.add_parser('contract')
    k.add_argument('ftsd')
    k.add_argument('openapi')
    c = sub.add_parser('comment')
    c.add_argument('docx')
    c.add_argument('--find', required=True)
    c.add_argument('--text', required=True)
    c.add_argument('--author', default='AI (bspace-sdlc)')
    a = p.parse_args(argv)
    if a.cmd == 'snapshot':
        snapshot(a.docx)
        print('wrote', os.path.splitext(a.docx)[0] + '.md')
        return 0
    return {'fill': fill, 'gate': gate, 'ids': ids, 'contract': contract, 'comment': comment}[a.cmd](a) or 0


if __name__ == '__main__':
    sys.exit(main())
