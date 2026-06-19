#!/usr/bin/env python3
"""
measure_tokens.py — token gate for deep-distill machine mode.

Usage:
  python measure_tokens.py FILE [FILE ...]
  python measure_tokens.py --json FILE [FILE ...]
  python measure_tokens.py --compare SOURCE MINIFIED --require-smaller --require-ascii

The script bootstraps tiktoken into a cached venv if it is not importable. First
run may need network; later runs reuse ~/.cache/deep-distill/token-venv.
"""
import argparse
import importlib.util
import json
import os
import subprocess
import sys
import venv
from pathlib import Path


ENCODINGS = ("cl100k_base", "o200k_base")


def ensure_tiktoken():
    if importlib.util.find_spec("tiktoken") is not None:
        import tiktoken
        return tiktoken

    cache = Path(os.environ.get("DEEP_DISTILL_TOKEN_VENV",
                                "~/.cache/deep-distill/token-venv")).expanduser()
    py = cache / "bin" / "python"
    pip = cache / "bin" / "pip"
    if not py.exists():
        cache.parent.mkdir(parents=True, exist_ok=True)
        venv.create(cache, with_pip=True)
    env = dict(os.environ)
    env["PIP_DISABLE_PIP_VERSION_CHECK"] = "1"
    subprocess.run([str(pip), "-q", "install", "tiktoken"], check=True, env=env)
    os.execv(str(py), [str(py), *sys.argv])


def is_ascii(text):
    return all(ord(ch) < 128 for ch in text)


def stats(path, encoders):
    text = Path(path).expanduser().read_text(encoding="utf-8")
    return {
        "path": str(Path(path).expanduser().resolve()),
        "chars": len(text),
        "words": len(text.split()),
        "ascii": is_ascii(text),
        "tokens": {name: len(enc.encode(text)) for name, enc in encoders.items()},
    }


def reduction(src, dst, name):
    a = src["tokens"][name]
    b = dst["tokens"][name]
    if a == 0:
        return 0.0
    return round((a - b) * 100.0 / a, 2)


def print_table(rows):
    print("file\tchars\twords\tascii\tcl100k\to200k")
    for r in rows:
        print(f"{Path(r['path']).name}\t{r['chars']}\t{r['words']}\t{str(r['ascii']).lower()}"
              f"\t{r['tokens']['cl100k_base']}\t{r['tokens']['o200k_base']}")


def main():
    ap = argparse.ArgumentParser(description="Measure BPE token counts for machine-mode artifacts.")
    ap.add_argument("files", nargs="*")
    ap.add_argument("--json", action="store_true", dest="as_json")
    ap.add_argument("--compare", nargs=2, metavar=("SOURCE", "MINIFIED"))
    ap.add_argument("--require-smaller", action="store_true",
                    help="exit nonzero unless MINIFIED is smaller in every measured tokenizer")
    ap.add_argument("--require-ascii", action="store_true",
                    help="exit nonzero unless every measured file is ASCII-only")
    args = ap.parse_args()

    if args.compare:
        files = list(args.compare)
    else:
        files = list(args.files)
    if not files:
        ap.error("provide FILEs or --compare SOURCE MINIFIED")

    tiktoken = ensure_tiktoken()
    encoders = {name: tiktoken.get_encoding(name) for name in ENCODINGS}
    rows = [stats(path, encoders) for path in files]

    report = {"files": rows}
    if args.compare:
        src, dst = rows
        report["comparison"] = {
            "source": src["path"],
            "minified": dst["path"],
            "reduction_pct": {name: reduction(src, dst, name) for name in ENCODINGS},
            "smaller": {name: dst["tokens"][name] < src["tokens"][name] for name in ENCODINGS},
        }

    if args.as_json:
        print(json.dumps(report, indent=2))
    else:
        print_table(rows)
        if "comparison" in report:
            comp = report["comparison"]
            print("reduction_pct\tcl100k\t{cl100k_base}\to200k\t{o200k_base}".format(
                **comp["reduction_pct"]))

    bad = False
    if args.require_ascii:
        ascii_rows = rows[-1:] if args.compare else rows
        if any(not r["ascii"] for r in ascii_rows):
            print("ERROR: non-ASCII characters present in compressed artifact.", file=sys.stderr)
            bad = True
    if args.require_smaller and "comparison" in report:
        smaller = report["comparison"]["smaller"]
        if not all(smaller.values()):
            print("ERROR: minified file is not smaller in every measured tokenizer.", file=sys.stderr)
            bad = True
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
