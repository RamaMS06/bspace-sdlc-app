#!/usr/bin/env python3
"""Self-check: python3 test_bspace_docx.py (no output + exit 0 = pass)."""
import contextlib, io, os, re, shutil, tempfile, zipfile
import bspace_docx as b

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, '..', 'assets')


def call(*argv):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = b.main(list(argv))
    return code, out.getvalue()


def edit_xml(path, old, new):
    with zipfile.ZipFile(path) as z:
        files = {n: z.read(n) for n in z.namelist()}
    doc = files['word/document.xml'].decode('utf-8')
    assert old in doc, old
    files['word/document.xml'] = doc.replace(old, new, 1).encode('utf-8')
    b.write_zip(path, files)


def gate(docx, name, table, **kw):
    argv = ['gate', docx, '--name', name, '--table', table] + sum((['--' + k.replace('_', '-'), v] for k, v in kw.items()), [])
    return call(*argv)[0]


with tempfile.TemporaryDirectory() as d:
    ftsd, docx = os.path.join(d, 'ftsd.md'), os.path.join(d, 'FTSD.docx')
    shutil.copy(os.path.join(ASSETS, 'ftsd.md'), ftsd)
    call('fill', '--template', os.path.join(ASSETS, 'buma-template.docx'), '--md', ftsd, '--out', docx)
    try:
        call('fill', '--template', os.path.join(ASSETS, 'buma-template.docx'), '--md', ftsd, '--out', docx)
        raise AssertionError('fill must refuse to overwrite')
    except SystemExit:
        pass
    with zipfile.ZipFile(docx) as z:
        names = z.namelist()
        assert 'word/header1.xml' in names and 'word/media/image32.png' in names, 'BUMA header logos kept'
    os.remove(ftsd)
    md = b.snapshot(docx)
    assert '# User Story & Design' in md and '## SCR-01 <Screen name>' in md, md[:400]
    assert '| SRC-01 | SAP |' in md and '| 1 | | | | Text (50) | M |' in md

    # F1: functional rows empty → fail; dated → pass; edit content → stale; F2 ignores the functional table
    F1 = dict(hash_skip='^#+ (Technical|Approval)')
    F2 = dict(hash_skip='^#+ Approval')
    assert gate(docx, 'F1', '^Functional Approval', **F1) == 1, 'no dates yet'

    def sign(title, end):
        """a human types a date into every empty Date cell (last cell of each row) of one approval table"""
        with zipfile.ZipFile(docx) as z:
            doc = z.read('word/document.xml').decode('utf-8')
        part = doc[doc.index(title):doc.index(end) if end else len(doc)]
        empty = '<w:p><w:pPr><w:ind w:firstLine="0"/></w:pPr></w:p></w:tc></w:tr>'
        edit_xml(docx, part, part.replace(empty, empty.replace('</w:pPr>', '</w:pPr><w:r><w:t>28-10-2026</w:t></w:r>')))

    sign('Functional Approval', 'Technical Approval')
    assert gate(docx, 'F1', '^Functional Approval', **F1) == 0
    assert gate(docx, 'F2', '^Technical Approval', **F2) == 1, 'F2 rows have no date'
    edit_xml(docx, '>/&lt;resource&gt;<', '>/orders<')  # technical-only change (§API Contract)
    assert gate(docx, 'F1', '^Functional Approval', **F1) == 0, 'technical edit keeps F1'
    sign('Technical Approval', None)
    assert gate(docx, 'F2', '^Technical Approval', **F2) == 0
    edit_xml(docx, '>Text (50)<', '>Text (80)<')
    assert gate(docx, 'F1', '^Functional Approval', **F1) == 1, 'functional edit after approval stales F1'
    assert gate(docx, 'F2', '^Technical Approval', **F2) == 1, '... and F2'

    # revision impact: BR-01 changed → SCR-01 (cites it) and API-01 (cites SCR-01) stale
    old, new = os.path.join(d, 'old.md'), os.path.join(d, 'FTSD.md')
    shutil.copy(new, old)
    text = open(old, encoding='utf-8').read().replace('\n| BR-01 | |', '\n| BR-01 | Qty > 0 |')
    open(new, 'w', encoding='utf-8').write(text)
    code, out = call('ids', old, new)
    assert '"changed": ["BR-01"]' in out and 'SCR-01' in out and 'API-01' in out, out

    # contract: §6.2 API-01 + SCR-01 vs the openapi template (API-01..04, SCR-01..03) → mismatch listed
    code, out = call('contract', new, os.path.join(ASSETS, 'openapi.yaml'))
    assert code == 1 and 'API-02 in openapi.yaml, missing in FTSD' in out, out

    # comment lands in comments.xml and the paragraph keeps its text
    call('comment', docx, '--find', 'Initial draft', '--text', 'US-01 changed: confirm Qty rule BR-01')
    with zipfile.ZipFile(docx) as z:
        assert 'confirm Qty rule' in z.read('word/comments.xml').decode('utf-8')
        assert 'commentReference' in z.read('word/document.xml').decode('utf-8')
    assert 'Initial draft' in b.snapshot(docx)
