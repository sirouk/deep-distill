#!/usr/bin/env python3
"""
assemble.py — turn the deep-distill workflow's JSON result into one markdown file.

The Workflow tool writes its result to a task-output file. That file is usually
{ "result": { "title", "synthesis", "sections":[{id,title,final}] }, ... } but
this script also accepts the bare result object, and tolerates key variants
(synthesis|meta_synth, sections|chapters). Point --result at whichever you have.

Usage:
  python assemble.py --result RESULT.json --out OUT.md [--manifest MANIFEST.json]
                     [--title "..."]
"""
import argparse, json, re, sys
from pathlib import Path


def unwrap(obj):
    """Find the dict that has the sections/synthesis payload."""
    if isinstance(obj, dict):
        if any(k in obj for k in ("sections", "chapters")):
            return obj
        for key in ("result", "output", "data"):
            if key in obj:
                got = unwrap(obj[key])
                if got:
                    return got
        # result sometimes arrives as a JSON string
        for v in obj.values():
            if isinstance(v, str) and v.lstrip().startswith("{"):
                try:
                    got = unwrap(json.loads(v))
                    if got:
                        return got
                except Exception:
                    pass
    if isinstance(obj, str):
        try:
            return unwrap(json.loads(obj))
        except Exception:
            return None
    return None


def anchor(text):
    a = text.strip().lower()
    a = re.sub(r"[^\w\s-]", "", a)
    a = re.sub(r"\s+", "-", a)
    return a


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--result", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--manifest", default=None)
    ap.add_argument("--title", default=None)
    args = ap.parse_args()

    raw = json.loads(Path(args.result).read_text(encoding="utf-8"))
    payload = unwrap(raw)
    if not payload:
        print("ERROR: could not locate sections/synthesis in result JSON.", file=sys.stderr)
        sys.exit(1)

    sections = payload.get("sections") or payload.get("chapters") or []
    synthesis = payload.get("synthesis") or payload.get("meta_synth") or ""
    title = args.title or payload.get("title")

    src = fmt = None
    if args.manifest:
        try:
            man = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
            title = title or man.get("title")
            src, fmt = man.get("source"), man.get("format")
        except Exception:
            pass
    title = title or "Document"

    # order by id if present
    def key(s): return str(s.get("id", ""))
    sections = sorted(sections, key=key)

    out = []
    out.append(f"# {title} — Distilled")
    sub = "Telegraphic / grammar-sacrifice distillation"
    if src:
        sub += f" of `{Path(src).name}`"
    sub += (f". {len(sections)} sections. Built with a federated extract -> explain-diagrams -> "
            f"adversarial-gap-check -> consolidate pass — nothing dropped in translation.")
    out.append(f"*{sub}*\n")

    out.append("## Contents\n")
    if synthesis:
        out.append("- [Synthesis](#" + anchor(f"{title} — Synthesis") + ")")
    for s in sections:
        t = s.get("title", s.get("id", "?"))
        out.append(f"- [{t}](#{anchor(t)})")
    out.append("\n---\n")

    if synthesis:
        out.append(synthesis.strip())
        out.append("\n\n---\n\n# Section-by-Section Reference\n")

    for s in sections:
        out.append((s.get("final") or "").strip())
        out.append("\n---\n")

    doc = "\n".join(out)
    outp = Path(args.out).expanduser().resolve()
    outp.parent.mkdir(parents=True, exist_ok=True)
    outp.write_text(doc, encoding="utf-8")

    print(f"WROTE: {outp}")
    print(f"chars: {len(doc):,}   words: {len(doc.split()):,}   sections: {len(sections)}")


if __name__ == "__main__":
    main()
