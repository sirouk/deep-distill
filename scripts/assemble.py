#!/usr/bin/env python3
"""
assemble.py — turn the deep-distill workflow's JSON result into one markdown file.

The Workflow tool writes its result to a task-output file. That file is usually
{ "result": { "title", "synthesis", "sections":[{id,title,final}] }, ... } but
this script also accepts the bare result object, and tolerates key variants
(synthesis|meta_synth, sections|chapters). Point --result at whichever you have.

Usage:
  python assemble.py --result RESULT.json --out OUT.md [--manifest MANIFEST.json]
                     [--title "..."] [--mode human|machine|auto]
"""
import argparse, json, re, sys
from pathlib import Path


def unwrap(obj):
    """Find the dict that has the sections/synthesis payload."""
    if isinstance(obj, dict):
        if any(k in obj for k in ("sections", "chapters", "artifact", "compressed", "minified")):
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


def ascii_only(text):
    return all(ord(ch) < 128 for ch in text)


def load_manifest(path):
    if not path:
        return {}
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception:
        return {}


def machine_artifact(payload):
    for key in ("artifact", "compressed", "minified", "final"):
        val = payload.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip() + "\n"

    sections = payload.get("sections") or payload.get("chapters") or []
    parts = []
    for s in sorted(sections, key=lambda x: str(x.get("id", ""))):
        val = s.get("artifact") or s.get("compressed") or s.get("final")
        if isinstance(val, str) and val.strip():
            parts.append(val.strip())
    return "\n\n".join(parts).strip() + ("\n" if parts else "")


def machine_certified(payload):
    if payload.get("certified") is True:
        return True
    status = str(payload.get("status") or "").lower()
    if status in ("certified", "verified", "pass", "passed"):
        return True
    verification = payload.get("verification") or payload.get("certificate") or {}
    if isinstance(verification, dict):
        vstatus = str(verification.get("status") or "").lower()
        missing = verification.get("missing")
        if vstatus in ("certified", "verified", "pass", "passed"):
            return True
        if isinstance(missing, list) and len(missing) == 0:
            return True
    return False


def write_machine(payload, args, manifest):
    artifact = machine_artifact(payload)
    if not artifact.strip():
        print("ERROR: machine result has no artifact/compressed/final text.", file=sys.stderr)
        sys.exit(1)

    certified = machine_certified(payload)
    ascii_ok = ascii_only(artifact)
    if not certified and not args.allow_uncertified:
        print("ERROR: refusing to write uncertified machine artifact "
              "(use --allow-uncertified to inspect it).", file=sys.stderr)
        sys.exit(1)
    if not ascii_ok and not args.allow_non_ascii:
        print("ERROR: refusing to write non-ASCII machine artifact "
              "(machine mode should stay tokenizer-friendly ASCII).", file=sys.stderr)
        sys.exit(1)

    outp = Path(args.out).expanduser().resolve()
    outp.parent.mkdir(parents=True, exist_ok=True)
    outp.write_text(artifact, encoding="utf-8")

    title = args.title or payload.get("title") or manifest.get("title") or "Document"
    verification = payload.get("verification") or {}
    total = verification.get("total_count") or payload.get("directive_count") or "?"
    recovered = verification.get("recovered_count")
    if recovered is None and isinstance(verification.get("missing"), list) and total != "?":
        recovered = total - len(verification["missing"])
    if recovered is None:
        recovered = "?"

    print(f"WROTE: {outp}")
    print(f"title: {title}")
    print(f"mode: machine   chars: {len(artifact):,}   words: {len(artifact.split()):,}   ascii: {ascii_ok}")
    print(f"certified: {certified}   directive recovery: {recovered}/{total}")
    if manifest.get("source"):
        print("token gate:")
        print(f"  python3 scripts/measure_tokens.py --compare {manifest['source']} {outp} "
              "--require-smaller --require-ascii")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--result", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--manifest", default=None)
    ap.add_argument("--title", default=None)
    ap.add_argument("--mode", choices=("auto", "human", "machine"), default="auto")
    ap.add_argument("--allow-uncertified", action="store_true",
                    help="write machine artifacts even if the verifier did not certify them")
    ap.add_argument("--allow-non-ascii", action="store_true",
                    help="write machine artifacts even if they contain non-ASCII characters")
    args = ap.parse_args()

    raw = json.loads(Path(args.result).read_text(encoding="utf-8"))
    payload = unwrap(raw)
    if not payload:
        print("ERROR: could not locate sections/synthesis in result JSON.", file=sys.stderr)
        sys.exit(1)

    manifest = load_manifest(args.manifest)
    is_machine = args.mode == "machine" or (
        args.mode == "auto" and (
            str(payload.get("mode", "")).lower() == "machine" or
            any(k in payload for k in ("artifact", "compressed", "minified"))
        )
    )
    if is_machine:
        write_machine(payload, args, manifest)
        return

    sections = payload.get("sections") or payload.get("chapters") or []
    synthesis = payload.get("synthesis") or payload.get("meta_synth") or ""
    title = args.title or payload.get("title")

    src = fmt = None
    if manifest:
        title = title or manifest.get("title")
        src, fmt = manifest.get("source"), manifest.get("format")
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
