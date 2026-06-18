#!/usr/bin/env python3
"""
stage_document.py — turn any long document into a uniform workspace the
deep-distill federated workflow can fan out over.

Why this exists: a 400-page book will not fit faithfully in one context. We
split it into its natural sections (chapters / headings / spine items) ONCE,
deterministically, so the workflow can run one set of agents per section and an
adversarial pass can re-read each section's source. Splitting in code (not by an
agent) keeps boundaries stable and cheap.

Supports: PDF (PyMuPDF, with page-render of figure pages), DOCX, EPUB, TXT/MD.

Outputs into <workspace>/:
  manifest.json            uniform index (see schema at bottom)
  text/<id>.txt            full extracted text of one section
  figs/<id>__*.png|jpg     figures for that section (PDF: rendered pages;
                           DOCX/EPUB: embedded images copied out)

Usage:
  python stage_document.py INPUT [--workspace DIR] [--dpi 150]
         [--min-sections 6] [--max-sections 80] [--min-chars 400]
         [--section-level N] [--chunk-pages 12] [--chunk-words 6000]
         [--keep-frontmatter]

The script prints the workspace path and a section summary; read manifest.json
next, then pass its `sections` array to the workflow via `args`.
"""
import argparse, json, os, re, sys, html, zipfile, shutil
from pathlib import Path
from collections import Counter


# ----------------------------------------------------------------------------- helpers
def log(*a): print(*a, file=sys.stderr)

def slug(i): return f"{i:02d}"

def ensure_pymupdf():
    """Import PyMuPDF, installing it if needed — robust to PEP 668 'externally-managed'
    Pythons (Homebrew, Debian/Ubuntu). Tries, in order: already-importable -> user install
    -> user install w/ --break-system-packages -> an isolated cached venv. The script self-heals
    so no agent has to improvise an environment fix."""
    import subprocess, site, importlib, glob, os
    py = sys.executable

    def _try_import():
        try:
            importlib.invalidate_caches()
            import fitz; return fitz
        except ImportError:
            return None

    got = _try_import()
    if got:
        return got

    # 1) user-site install (plain, then with the PEP 668 escape hatch — both stay in ~/.local)
    for extra in ([], ["--break-system-packages"]):
        log(f"PyMuPDF missing -> pip install --user {' '.join(extra)} pymupdf ...")
        subprocess.run([py, "-m", "pip", "install", "--user", "--quiet", *extra, "pymupdf"],
                       check=False)
        usp = site.getusersitepackages()
        if usp not in sys.path:
            sys.path.append(usp)
        got = _try_import()
        if got:
            return got

    # 2) isolated venv fallback (clean on externally-managed systems; cached for reuse)
    venv = os.path.join(os.environ.get("TMPDIR", "/tmp"), "deep-distill-venv")
    log(f"falling back to an isolated venv at {venv} ...")
    if not os.path.isdir(venv):
        subprocess.run([py, "-m", "venv", venv], check=False)
    vpy = os.path.join(venv, "bin", "python")
    subprocess.run([vpy, "-m", "pip", "install", "--quiet", "pymupdf"], check=False)
    for sp in glob.glob(os.path.join(venv, "lib", "python*", "site-packages")):
        if sp not in sys.path:
            sys.path.insert(0, sp)
    got = _try_import()
    if got:
        return got

    raise RuntimeError(
        "Could not install PyMuPDF automatically. Install it manually, e.g.:\n"
        "  python3 -m pip install --user --break-system-packages pymupdf\n"
        "or in a venv, then re-run this script.")

def write_section(ws, sid, title, text):
    p = ws / "text" / f"{sid}.txt"
    p.write_text(f"# {title}\n\n{text}", encoding="utf-8")
    return p

def choose_level(levels_list, min_sections, max_sections):
    """Pick the DEEPEST heading level whose section count stays <= max_sections.

    Going deep gives chapter/sub-section granularity (what we want) instead of a
    handful of giant Parts; the cap stops us from exploding into hundreds of tiny
    fragments. If even the coarsest level already exceeds the cap (a flat doc with
    very many top-level entries), we accept it — there's nothing coarser.
    """
    levels = sorted(set(levels_list))
    if not levels:
        return None
    best = levels[0]
    for L in levels:
        n = sum(1 for l in levels_list if l <= L)
        if n <= max_sections:
            best = L          # deeper is better as long as we're under the cap
        else:
            break
    return best


# Front/back matter that carries no "wisdom" — dropped by default (English heuristic).
SKIP_TITLE_RE = re.compile(
    r"^\s*(table of contents|contents|index|copyright|dedication|epigraph|"
    r"title page|half title|about the author|colophon|frontispiece)\s*$", re.I)

def is_boilerplate(title):
    return bool(SKIP_TITLE_RE.match(title or ""))


# Numbered section headings ("3. Timestamp Server", "4. Proof-of-Work", "2.1 Setup")
# living in body text — the fallback for PDFs/text that ship without a TOC, which is
# most academic papers. The title class allows hyphens/slashes but NOT periods, so
# real sentences ("1. We do this thing.") don't match — only short heading lines do.
HEADING_RE = re.compile(
    r"(?m)^[ \t]*(\d{1,2}(?:\.\d{1,2})*)\.?\s+([A-Z][A-Za-z0-9 ,:/&'\-]{2,60})[ \t]*$")

def detect_headings(text):
    """Return [(title, char_pos)] for top-level numbered headings in CONSECUTIVE order.

    The regex also matches diagram labels, list items, and citations that look like
    'N. Word' (PDF text extraction often puts the number on its own line, e.g. the
    Bitcoin whitepaper's '1.\\nIntroduction'). Enforcing a strict 1,2,3,... sequence
    rejects all of those — they appear out of order — and keeps only real sections.
    """
    cand = []
    for m in HEADING_RE.finditer(text):
        try:
            n = int(m.group(1).split(".")[0])
        except ValueError:
            continue
        cand.append((n, f"{m.group(1)}. {m.group(2).strip()}", m.start()))
    out, expected = [], 1
    for n, title, pos in cand:
        if n == expected:
            out.append((title, pos))
            expected += 1
    return out


def render_figs(doc, mat, pages, ws, cid):
    out_files = []
    for pg in pages:
        out = ws / "figs" / f"{cid}__p{pg}.png"
        try:
            doc[pg - 1].get_pixmap(matrix=mat).save(str(out))
            out_files.append(str(out))
        except Exception as e:
            log(f"  figure render failed p{pg}: {e}")
    return out_files


# ----------------------------------------------------------------------------- PDF
def stage_pdf(src, ws, args):
    fitz = ensure_pymupdf()
    doc = fitz.open(str(src))
    title = (doc.metadata or {}).get("title") or src.stem
    toc = doc.get_toc()  # [[level, title, page(1-indexed)], ...]
    npages = doc.page_count
    mat = fitz.Matrix(args.dpi / 72, args.dpi / 72)

    page_text = [doc[p].get_text() for p in range(npages)]

    # A page is a "figure page" if it has a raster image OR enough VECTOR drawings.
    # Many papers (e.g. the Bitcoin whitepaper) draw all diagrams as vector line-art,
    # which get_images() never reports — without this, every diagram is silently missed.
    minvec = 0 if args.no_vector_figs else args.min_vector_drawings
    fig_pages = set()
    for p in range(npages):
        pg = doc[p]
        if pg.get_images(full=True) or (minvec and len(pg.get_drawings()) >= minvec):
            fig_pages.add(p + 1)

    sections, dropped = [], []
    sid = 0

    # Strategy 1: a real bookmark TOC -> page-based sections.
    page_bounds = []
    if toc:
        lvl = args.section_level or choose_level([l for l, _, _ in toc],
                                                 args.min_sections, args.max_sections)
        page_bounds = [(t.strip(), p) for l, t, p in toc if l <= lvl and 1 <= p <= npages]
        page_bounds.sort(key=lambda x: x[1])

    if page_bounds:
        log(f"PDF TOC -> level {args.section_level or 'auto'} -> {len(page_bounds)} boundaries")
        for i, (sec_title, start) in enumerate(page_bounds):
            end = page_bounds[i + 1][1] - 1 if i + 1 < len(page_bounds) else npages
            if end < start:
                continue
            if not args.keep_frontmatter and is_boilerplate(sec_title):
                dropped.append(sec_title); continue
            text = "".join(f"\n===== PAGE {pg} =====\n{page_text[pg-1]}"
                           for pg in range(start, end + 1))
            if len(text.strip()) < args.min_chars:
                dropped.append(sec_title); continue
            sid += 1; cid = slug(sid)
            figs = [pg for pg in range(start, end + 1) if pg in fig_pages]
            tf = write_section(ws, cid, sec_title, text)
            sections.append({"id": cid, "title": sec_title, "text_file": str(tf),
                             "chars": len(text), "figures": render_figs(doc, mat, figs, ws, cid),
                             "source_pages": [start, end]})
    else:
        # Strategy 2: no TOC -> detect in-text numbered headings, split by char offset.
        clean, spans, off = [], [], 0
        for p in range(npages):
            t = page_text[p]; spans.append((off, off + len(t), p + 1)); clean.append(t); off += len(t)
        clean_full = "".join(clean)
        heads = detect_headings(clean_full)

        def page_at(pos):
            for s, e, pg in spans:
                if s <= pos < e:
                    return pg
            return spans[-1][2] if spans else 1

        if len(heads) >= max(3, args.min_sections // 2):
            log(f"No TOC -> {len(heads)} in-text headings -> offset sectioning")
            bounds = []
            if heads[0][1] >= args.min_chars:          # keep the abstract/front before heading 1
                bounds.append(("Abstract / Front matter", 0))
            bounds += heads
            for i, (sec_title, pos) in enumerate(bounds):
                endpos = bounds[i + 1][1] if i + 1 < len(bounds) else len(clean_full)
                text = clean_full[pos:endpos].strip()
                if (not args.keep_frontmatter and is_boilerplate(sec_title)) or len(text) < args.min_chars:
                    dropped.append(sec_title); continue
                sid += 1; cid = slug(sid)
                figs = [pg for (s, e, pg) in spans if pos <= s < endpos and pg in fig_pages]
                tf = write_section(ws, cid, sec_title, text)
                sections.append({"id": cid, "title": sec_title, "text_file": str(tf),
                                 "chars": len(text), "figures": render_figs(doc, mat, figs, ws, cid),
                                 "source_pages": [page_at(pos), page_at(max(pos, endpos - 1))]})
        else:
            # Strategy 3: no structure at all -> fixed-size page chunks.
            step = args.chunk_pages
            log(f"No TOC / too few headings -> {step}-page chunks")
            for start in range(1, npages + 1, step):
                end = min(start + step - 1, npages)
                text = "".join(f"\n===== PAGE {pg} =====\n{page_text[pg-1]}"
                               for pg in range(start, end + 1))
                if len(text.strip()) < args.min_chars:
                    continue
                sid += 1; cid = slug(sid)
                figs = [pg for pg in range(start, end + 1) if pg in fig_pages]
                tf = write_section(ws, cid, f"Pages {start}-{end}", text)
                sections.append({"id": cid, "title": f"Pages {start}-{end}", "text_file": str(tf),
                                 "chars": len(text), "figures": render_figs(doc, mat, figs, ws, cid),
                                 "source_pages": [start, end]})

    if dropped:
        log(f"Dropped {len(dropped)} boilerplate/near-empty: "
            + ", ".join(dropped[:8]) + ("..." if len(dropped) > 8 else ""))
    return title, sections


# ----------------------------------------------------------------------------- DOCX
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

def stage_docx(src, ws, args):
    import xml.etree.ElementTree as ET
    z = zipfile.ZipFile(str(src))
    xml = z.read("word/document.xml")
    # rId -> media path
    rels = {}
    try:
        rxml = z.read("word/_rels/document.xml.rels").decode("utf-8", "ignore")
        for m in re.finditer(r'Id="([^"]+)"[^>]*Target="([^"]+)"', rxml):
            rels[m.group(1)] = m.group(2)
    except KeyError:
        pass
    root = ET.fromstring(xml)
    body = root.find(f"{W}body")

    # First pass: collect (heading_level or None, text, [rIds]) per paragraph
    paras = []
    heading_levels = []
    for p in body.findall(f"{W}p"):
        style = None
        pPr = p.find(f"{W}pPr")
        if pPr is not None:
            ps = pPr.find(f"{W}pStyle")
            if ps is not None:
                style = ps.get(f"{W}val", "")
        texts = "".join(t.text or "" for t in p.iter(f"{W}t"))
        rids = [b.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed")
                for b in p.iter("{http://schemas.openxmlformats.org/drawingml/2006/main}blip")]
        rids = [r for r in rids if r]
        hlvl = None
        if style and style.lower().startswith("heading"):
            mdig = re.search(r"(\d+)", style)
            hlvl = int(mdig.group(1)) if mdig else 1
            heading_levels.append(hlvl)
        paras.append((hlvl, texts, rids))

    chosen = (args.section_level
              or choose_level(heading_levels, args.min_sections, args.max_sections)) if heading_levels else None

    media_dir = ws / "figs"
    def extract_media(rid, cid, k):
        tgt = rels.get(rid)
        if not tgt:
            return None
        name = "word/" + tgt.lstrip("/") if not tgt.startswith("word/") else tgt
        name = name.replace("word/word/", "word/")
        try:
            data = z.read(name)
        except KeyError:
            try:
                data = z.read("word/" + os.path.basename(tgt))
            except KeyError:
                return None
        ext = os.path.splitext(tgt)[1] or ".png"
        if ext.lower() in (".emf", ".wmf"):
            return None  # not readable as an image
        out = media_dir / f"{cid}__img{k}{ext}"
        out.write_bytes(data)
        return str(out)

    # Build sections by splitting at chosen heading level
    sections = []
    cur_title, cur_text, cur_imgs = (args.fallback_title or src.stem), [], []
    sid = 0
    def flush():
        nonlocal sid, cur_text, cur_imgs, cur_title
        text = "\n".join(cur_text).strip()
        if len(text) >= args.min_chars or cur_imgs:
            sid += 1
            cid = slug(sid)
            figs = []
            for k, rid in enumerate(cur_imgs):
                f = extract_media(rid, cid, k)
                if f: figs.append(f)
            tf = write_section(ws, cid, cur_title, text)
            sections.append({"id": cid, "title": cur_title, "text_file": str(tf),
                             "chars": len(text), "figures": figs})
        cur_text.clear(); cur_imgs.clear()

    if chosen is None:
        # no headings -> size-based chunks
        all_text = "\n".join(t for _, t, _ in paras)
        toks = all_text.split()
        for i in range(0, len(toks), args.chunk_words):
            sid += 1; cid = slug(sid)
            chunk = " ".join(toks[i:i + args.chunk_words])
            tf = write_section(ws, cid, f"Part {sid}", chunk)
            sections.append({"id": cid, "title": f"Part {sid}", "text_file": str(tf),
                             "chars": len(chunk), "figures": []})
    else:
        started = False
        for hlvl, text, rids in paras:
            if hlvl is not None and hlvl <= chosen:
                if started:
                    flush()
                cur_title = text.strip() or f"Section {sid+1}"
                started = True
            else:
                if text.strip():
                    cur_text.append(text)
                cur_imgs.extend(rids)
        flush()
    title = src.stem
    return title, sections


# ----------------------------------------------------------------------------- EPUB
def _strip_html(s):
    s = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", s)
    s = re.sub(r"(?i)<\s*br\s*/?>", "\n", s)
    s = re.sub(r"(?i)</\s*(p|div|h[1-6]|li)\s*>", "\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    return html.unescape(s)

def stage_epub(src, ws, args):
    z = zipfile.ZipFile(str(src))
    container = z.read("META-INF/container.xml").decode("utf-8", "ignore")
    opf_path = re.search(r'full-path="([^"]+)"', container).group(1)
    opf_dir = os.path.dirname(opf_path)
    opf = z.read(opf_path).decode("utf-8", "ignore")
    # manifest: id -> href ; spine: order of idrefs
    items = dict(re.findall(r'<item[^>]*id="([^"]+)"[^>]*href="([^"]+)"', opf))
    items2 = dict(re.findall(r'<item[^>]*href="([^"]+)"[^>]*id="([^"]+)"', opf))
    items.update({v: k for k, v in items2.items()})  # tolerate attr order
    spine = re.findall(r'<itemref[^>]*idref="([^"]+)"', opf)

    def zpath(href):
        return os.path.normpath(os.path.join(opf_dir, href)).replace("\\", "/")

    sections, sid = [], 0
    for idref in spine:
        href = items.get(idref)
        if not href:
            continue
        try:
            raw = z.read(zpath(href)).decode("utf-8", "ignore")
        except KeyError:
            continue
        # title
        mt = re.search(r"(?is)<title>(.*?)</title>", raw) or \
             re.search(r"(?is)<h[1-3][^>]*>(.*?)</h[1-3]>", raw)
        sec_title = _strip_html(mt.group(1)).strip()[:120] if mt else f"Section {sid+1}"
        text = re.sub(r"\n\s*\n\s*\n+", "\n\n", _strip_html(raw)).strip()
        if len(text) < args.min_chars:
            continue
        sid += 1; cid = slug(sid)
        figs = []
        base = os.path.dirname(zpath(href))
        for k, m in enumerate(re.finditer(r'(?i)<img[^>]*src="([^"]+)"', raw)):
            ip = os.path.normpath(os.path.join(base, m.group(1))).replace("\\", "/")
            try:
                data = z.read(ip)
            except KeyError:
                continue
            ext = os.path.splitext(ip)[1] or ".png"
            if ext.lower() in (".svg",):
                continue
            out = ws / "figs" / f"{cid}__img{k}{ext}"
            out.write_bytes(data); figs.append(str(out))
        tf = write_section(ws, cid, sec_title, text)
        sections.append({"id": cid, "title": sec_title, "text_file": str(tf),
                         "chars": len(text), "figures": figs})
    title = src.stem
    return title, sections


# ----------------------------------------------------------------------------- TXT / MD
def stage_text(src, ws, args):
    text = src.read_text(encoding="utf-8", errors="ignore")
    heads = list(re.finditer(r"(?m)^(#{1,6})\s+(.*)$", text))
    sections, sid = [], 0
    if heads:
        levels = [len(h.group(1)) for h in heads]
        chosen = args.section_level or choose_level(levels, args.min_sections, args.max_sections)
        bounds = [(h.group(2).strip(), h.start(), len(h.group(1))) for h in heads
                  if len(h.group(1)) <= chosen]
        for i, (t, pos, _) in enumerate(bounds):
            endpos = bounds[i + 1][1] if i + 1 < len(bounds) else len(text)
            body = text[pos:endpos].strip()
            if len(body) < args.min_chars:
                continue
            sid += 1; cid = slug(sid)
            tf = write_section(ws, cid, t, body)
            sections.append({"id": cid, "title": t, "text_file": str(tf),
                             "chars": len(body), "figures": []})
    if not sections:
        toks = text.split()
        for i in range(0, len(toks), args.chunk_words):
            sid += 1; cid = slug(sid)
            chunk = " ".join(toks[i:i + args.chunk_words])
            tf = write_section(ws, cid, f"Part {sid}", chunk)
            sections.append({"id": cid, "title": f"Part {sid}", "text_file": str(tf),
                             "chars": len(chunk), "figures": []})
    return src.stem, sections


# ----------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description="Stage a document for deep-distill.")
    ap.add_argument("input")
    ap.add_argument("--workspace", default=None)
    ap.add_argument("--dpi", type=int, default=150)
    ap.add_argument("--min-sections", type=int, default=6, dest="min_sections")
    ap.add_argument("--max-sections", type=int, default=80, dest="max_sections")
    ap.add_argument("--min-chars", type=int, default=400, dest="min_chars")
    ap.add_argument("--section-level", type=int, default=None, dest="section_level",
                    help="force TOC/heading level for section boundaries")
    ap.add_argument("--chunk-pages", type=int, default=12, dest="chunk_pages")
    ap.add_argument("--chunk-words", type=int, default=6000, dest="chunk_words")
    ap.add_argument("--min-vector-drawings", type=int, default=6, dest="min_vector_drawings",
                    help="treat a page as a figure page if it has >= this many vector drawings")
    ap.add_argument("--no-vector-figs", action="store_true", dest="no_vector_figs",
                    help="disable vector-diagram detection (use raster images only)")
    ap.add_argument("--fallback-title", default=None, dest="fallback_title")
    ap.add_argument("--title", default=None, help="override the document title (else PDF metadata / filename)")
    ap.add_argument("--keep-frontmatter", action="store_true", dest="keep_frontmatter",
                    help="keep Contents/Index/Copyright-style sections (dropped by default)")
    args = ap.parse_args()

    src = Path(args.input).expanduser().resolve()
    if not src.exists():
        log(f"ERROR: not found: {src}"); sys.exit(1)
    ext = src.suffix.lower()

    ws = Path(args.workspace).expanduser().resolve() if args.workspace else \
        Path(os.environ.get("TMPDIR", "/tmp")) / "deep-distill" / re.sub(r"\W+", "_", src.stem)[:60]
    (ws / "text").mkdir(parents=True, exist_ok=True)
    (ws / "figs").mkdir(parents=True, exist_ok=True)

    if ext == ".pdf":
        title, sections = stage_pdf(src, ws, args)
    elif ext == ".docx":
        title, sections = stage_docx(src, ws, args)
    elif ext == ".epub":
        title, sections = stage_epub(src, ws, args)
    elif ext in (".txt", ".md", ".markdown", ".rst", ".text"):
        title, sections = stage_text(src, ws, args)
    else:
        log(f"ERROR: unsupported extension '{ext}'. Supported: pdf, docx, epub, txt, md.")
        sys.exit(2)

    if args.title:
        title = args.title

    # Drop boilerplate sections for non-PDF formats too (PDF filters earlier).
    if not args.keep_frontmatter and ext != ".pdf":
        sections = [s for s in sections if not is_boilerplate(s["title"])]

    if not sections:
        log("ERROR: no sections extracted (empty/scanned doc?). For scanned PDFs, OCR first.")
        sys.exit(3)

    manifest = {"source": str(src), "format": ext.lstrip("."), "title": title,
                "workspace": str(ws), "n_sections": len(sections),
                "n_figures": sum(len(s["figures"]) for s in sections),
                "sections": sections}
    (ws / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"WORKSPACE: {ws}")
    print(f"MANIFEST:  {ws/'manifest.json'}")
    print(f"TITLE:     {title}")
    print(f"SECTIONS:  {len(sections)}   FIGURES: {manifest['n_figures']}")
    for s in sections:
        print(f"  {s['id']}  {s['chars']:>7}c  figs:{len(s['figures']):>2}  {s['title'][:60]}")


if __name__ == "__main__":
    main()

# manifest.json schema:
# { source, format, title, workspace, n_sections, n_figures,
#   sections: [ { id, title, text_file(abs), chars, figures:[abs,...],
#                 source_pages?:[start,end] } ] }
