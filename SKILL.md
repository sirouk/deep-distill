---
name: deep-distill
description: Distill an entire long document — a PDF, EPUB, DOCX, book, research paper, textbook, manual, spec, or report — into one dense compressed reference that loses nothing — every formula, definition, named function or code snippet, parameter, number, and caveat, plus a written explanation of every diagram, chart, and figure. It uses a federated multi-agent workflow that splits the document into sections, extracts text and explains figures in parallel, runs an adversarial completeness pass to catch anything missed, then synthesizes the connective tissue. Use this skill whenever the user wants to extract the wisdom from, compress, distill, condense, make a cheat-sheet or study notes from, or get a thorough TL;DR of a large or technical document — especially when they say the file is long, dense, math-heavy, or full of figures, or ask you to explain all the diagrams or to not lose anything. Default output is telegraphic and grammar-sacrifice; a readable digest is available on request.
metadata:
  hermes:
    requires_toolsets: [terminal]
---

# deep-distill

Compress a long document into one maximally dense reference, **losing nothing** — every formula, definition, named function/snippet, parameter, threshold, number, caveat, author opinion, and an explanation of every figure. Telegraphic ("grammar-sacrifice") by default; readable prose on request.

## When to use this

Trigger on: "extract the wisdom from / compress / distill / condense this book·paper·manual·report", "make a cheat sheet or study notes", "explain every diagram", "TL;DR this whole thing without losing anything". Also use it proactively when handed a large, dense, or figure-heavy document.

Skip it for short docs (a few pages — just read and summarize directly) and for docs the user wants *rewritten* or *critiqued* rather than distilled.

## How it works

One pass over a long document loses fidelity — details get averaged out, late sections get short-changed, figures go unread. So deep-distill **splits the document into sections once, distills each section with its own subagent, faithfulness-checks each against the source, then synthesizes** the cross-section connective tissue. The non-negotiable quality move is the per-section **faithfulness gate**: a subagent re-reads the source and confirms every claim is supported (precision) and nothing salient was dropped (recall). Splitting and assembly are plain scripts; only the judgment is done by agents.

**You need two tools — every supported agent has both:**
1. a **shell** to run the scripts — Claude Code: Bash; Hermes: the `terminal` toolset (run `hermes tools` to enable); Codex: built-in (with `codex --enable skills`).
2. a way to **run subagents in parallel** — whatever current multi-agent, task-delegation, or workflow capability your runtime provides (Claude Code, Codex, and Hermes each have one; use the most capable, current one available to you).

## Hard rules — do exactly this, do not improvise

1. **The only way to read the document is `stage_document.py`** (Step 1). It uses PyMuPDF to extract the text **and render every figure page to a PNG**. Run it with your real shell/terminal — never with a sandboxed code interpreter that can't see the user's files.
2. **NEVER open, screenshot, "page-snapshot", or "browser-vision" the document.** Do not use a browser or any viewer/screenshot tool on the PDF — not as a first try, not as a fallback. You don't need to: the script already produced PNG images of the figures (in the workspace `figs/` folder, listed per section in `manifest.json` as absolute paths). To explain a figure, **read those PNG files**. Screenshotting the PDF is prohibited and gives wrong, low-fidelity results.
3. **Run each command exactly as written, as one shell command**, substituting only the bracketed values. Do not invent multi-statement preflights (`uname`/`whoami`/`set -e …`) — they're unnecessary and error-prone.
4. **On error, fix the command and retry — do not fall back.** Usual fixes: define `SKILL_DIR` in the same command (below); ensure `python3` is on `PATH`; let the script install PyMuPDF. If you truly have no shell tool, stop and tell the user — never substitute a browser read.

**Path rule:** don't rely on any pre-set variable — build the skill folder from `$HOME` (always set) and define `SKILL_DIR` *inside* each command. Your agent's folder is one of: `$HOME/.claude/skills/deep-distill` (Claude Code) · `$HOME/.codex/skills/deep-distill` (Codex) · `$HOME/.hermes/skills/deep-distill` (Hermes).

## Run it — five steps, in order

### 1 · Stage — run this exactly, in your shell/terminal

```bash
SKILL_DIR="$HOME/.hermes/skills/deep-distill"   # ← your agent's dir: .claude / .codex / .hermes
python3 "$SKILL_DIR/scripts/stage_document.py" "/absolute/path/to/document.pdf"
```

The script auto-installs PyMuPDF on first run, extracts per-section text, and **renders every figure page to a PNG**. It prints two lines — `WORKSPACE: …` and `MANIFEST: …` — plus a section list. **Use those exact printed paths** in the steps below; don't guess them.

- Prints **no sections / empty text** → the PDF is scanned images: OCR it first (the `pdf` skill can), then re-run. Do **not** browser-read it.
- `python3` missing or PyMuPDF won't install → fix that and re-run. That is the only path; there is no browser fallback.
- Optional flags: `--title "..."`, `--section-level N` (granularity), `--dpi 200` (sharper figures), `--min-vector-drawings` / `--no-vector-figs`, `--keep-frontmatter`, `--workspace DIR`.

### 2 · Fan out — one subagent per section, in parallel

Read `manifest.json` (its `text_file` and `figures` paths are absolute). Then **dispatch one subagent per `sections` entry, in parallel** — using whatever concurrent-subagent / task-delegation / multi-agent capability your runtime currently offers. Reach for the most capable, current mechanism you have; if it supports async dispatch, fire all the section tasks and collect each as it returns. Hand each subagent its section's `text_file` + `figures`; it runs the four per-section stages (below) and returns its finalized `## <title>` markdown block. Collect every section, then continue to Step 3. Bound concurrency to a sane number if your runtime lets you.

Shortcut: if your runtime has a ready-made multi-agent **workflow runner**, the bundled `references/workflow-template.js` is a drop-in federation — run it through that runner with `{ title: <manifest.title>, density: "telegraphic", sections: <manifest.sections> }`. It performs the fan-out **and** the synthesis and returns the whole result, so you can skip to Step 4.

Use `density: "readable"` instead of `"telegraphic"` if the user wants prose.

### 3 · Synthesize  *(Codex / Hermes — Claude Code's Workflow already did this)*

Run one subagent over all finalized sections to produce the document-level synthesis: core theses, **cross-section links**, formula/code indexes, top takeaways. The prompt is the synthesis stage in `references/workflow-template.js`.

### 4 · Assemble

Collect the pieces into `result.json` = `{ "title", "synthesis", "sections": [ {"id","title","final"}, … ] }` (Claude Code: that's exactly the object the Workflow returned — it lands in the task notification's `output-file`). Then:

```bash
SKILL_DIR="$HOME/.hermes/skills/deep-distill"   # ← your agent's dir: .claude / .codex / .hermes
python3 "$SKILL_DIR/scripts/assemble.py" --result result.json --manifest "<workspace>/manifest.json" --out "<source dir>/<name> — Distilled.md"
```

### 5 · Deliver

Give the user the output file path (clickable) and surface the synthesis's top takeaways inline so they get value without opening it.

## The four per-section stages (what each subagent does)

`references/workflow-template.js` holds the full, canonical prompt for each stage; in brief:

1. **Extract** — digest prose/formulas/code under the **5-way inclusion gate** (Relevant / Specific / Novel / Faithful / Anywhere); explain figures by reading the **rendered PNGs** (the section's `figures` paths — never the original PDF, never a screenshot) under the **no-fabrication rule** (only legibly-readable values; hedge anything inferred as "≈ … from chart"). Reproduce code/formulas/symbols **verbatim**; preserve and flag source typos `[sic]` — never silently "fix" them.
2. **Consolidate** — fuse into one telegraphic section. Density comes from cutting filler and fusing redundant prose **only**, never from dropping content (no length budget). Apply **preservation tiers** (thesis, defs, numbers, mechanisms, formulas, worked examples, exercises = never drop), the **qualifier rule** (keep when/where/under-what-condition), and **molecular sizing** (each line minimal but self-contained). Emit a `Q:` cue list and an intra-section `Links` block. No process commentary.
3. **Faithfulness gate** — re-read the source and flag: unsupported/distorted claims (precision); salient source questions the draft can't answer + any dropped subsection/figure/code/example (recall + coverage); context-collapse; TIER-0 loss; decontextualization; figure fabrication; any literal artifact paraphrased or silently corrected. Return corrections, or `PASS`.
4. **Finalize** — apply the corrections: reinstate anything dropped, restore verbatim artifacts, fix distortions. Skip when the gate returns `PASS`.

The technique choices (Chain-of-Density, FActScore/SAFE, QuestEval, PropRAG, Molecular Facts, concept-map links) are cited in `references/techniques.md`; the method was chosen by blind A/B (see `EVALUATION.md`).

## Tuning

- **Density** — `readable` vs `telegraphic` (default). Either way every formula/figure/caveat is preserved.
- **Granularity** — `--section-level N` if auto-sectioning is too coarse/fine (aim for ~5–60 sections).
- **Figures** — `--dpi 200` for dense plots; `--min-vector-drawings` / `--no-vector-figs` to tune vector-diagram detection.

## Edge cases

- **Scanned PDFs** → image-only pages yield no text; OCR first, then re-run.
- **No bookmarks** → in-text numbered-heading detection (consecutive 1,2,3…); only then page chunks.
- **DOCX/EPUB figures** → embedded images extracted and attached to their section; vector art (EMF/WMF/SVG) is skipped.

## Files

- `scripts/stage_document.py` — document → sections + figures + `manifest.json` (multi-format).
- `references/workflow-template.js` — the federation + the canonical per-stage prompts.
- `scripts/assemble.py` — collected results → final markdown (TOC + synthesis).
- `references/techniques.md` — the verified, cited research foundation.
