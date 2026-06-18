---
name: deep-distill
description: Distill an entire long document — a PDF, EPUB, DOCX, book, research paper, textbook, manual, spec, or report — into one dense compressed reference that loses nothing — every formula, definition, named function or code snippet, parameter, number, and caveat, plus a written explanation of every diagram, chart, and figure. It uses a federated multi-agent workflow that splits the document into sections, extracts text and explains figures in parallel, runs an adversarial completeness pass to catch anything missed, then synthesizes the connective tissue. Use this skill whenever the user wants to extract the wisdom from, compress, distill, condense, make a cheat-sheet or study notes from, or get a thorough TL;DR of a large or technical document — especially when they say the file is long, dense, math-heavy, or full of figures, or ask you to explain all the diagrams or to not lose anything. Default output is telegraphic and grammar-sacrifice; a readable digest is available on request.
---

# deep-distill

Compress a long document into one maximally dense reference, **losing nothing** — every formula, definition, named function/snippet, parameter, threshold, number, caveat, author opinion, and an explanation of every figure. Output is telegraphic ("grammar-sacrifice") by default; readable prose on request.

## When to use this

Trigger on requests like: "extract all the wisdom from this book," "compress this 300-page PDF," "make me a cheat sheet from this paper," "explain every diagram in this manual," "TL;DR this whole textbook but don't lose anything," "turn this report into dense study notes." Also use it proactively when a user hands you a large/dense/figure-heavy document and wants its contents captured.

Skip it for short documents (a few pages — just read and summarize directly) and for documents the user wants *rewritten* or *critiqued* rather than distilled.

## Why federated (read this — it's the whole point)

A 400-page book cannot pass through one context without fidelity loss: details get averaged away, late chapters get short-changed, and figures are never actually looked at. So we **split the document into its natural sections once, deterministically**, then run a small team of agents per section. The non-negotiable quality move is the **precision+recall faithfulness gate**: a separate agent re-reads each section's *source* and checks the distilled draft both ways — every claim must be supported (precision, so compression can't invent "wisdom") and every salient source question must be answerable from the note (recall, so nothing important was dropped). That, plus per-section attention, is what lets you promise "nothing lost in translation." Splitting and assembly happen in plain scripts (stable, cheap); only the judgment work is done by agents.

**Orchestration is capability-dependent (this skill runs on Claude Code, Codex, and Hermes):**
- **If you have a multi-agent Workflow / subagent tool** (e.g. Claude Code's `Workflow`), use it — `references/workflow-template.js` is the ready-to-run federation. Calling it is expected; don't ask first, just run it.
- **If you don't** (e.g. a single-agent Codex or Hermes session), run the *same* pipeline yourself, sequentially: loop over `manifest.sections` doing the four per-section stages, then the synthesis. `references/workflow-template.js` is the canonical spec of the prompts/rules to follow at each stage — read it and apply each agent's prompt in turn.
- **Or delegate:** Codex and Hermes can hand the whole job to a Claude Code session (both ship a "delegate to Claude Code" skill); that gets you the full parallel federation.

## Pipeline

Resolve `SKILL_DIR` to this skill's directory first (the folder containing this SKILL.md), then run the four steps.

### Step 1 — Stage the document

Turn the input into a uniform workspace (per-section text + rendered/extracted figures + a manifest). This auto-installs PyMuPDF if needed and handles PDF, EPUB, DOCX, TXT/MD. Sectioning uses, in order: a bookmark TOC → **in-text numbered-heading detection** (for the many papers that ship no bookmarks) → fixed page chunks. Figure pages are found by raster images **and vector-drawing density**, so the line-art diagrams common in papers (which `get_images()` never reports) are still captured.

```bash
python3 "$SKILL_DIR/scripts/stage_document.py" "/path/to/input.pdf" --title "Nice Title"
```

Useful flags: `--workspace DIR` (default `$TMPDIR/deep-distill/<name>`), `--title "..."` (override; else PDF metadata/filename), `--dpi 150` (figure render quality), `--section-level N` (force chapter/heading granularity if auto-split is too coarse or too fine), `--min-chars 400` (drop near-empty sections like covers), `--keep-frontmatter` (keep Contents/Index/Copyright, dropped by default), `--min-vector-drawings 6` (vector-diagram detection threshold) / `--no-vector-figs` (raster only), `--chunk-pages 12` / `--chunk-words 6000` (fallback sizing). The script prints the workspace path and a section list, and writes `manifest.json`.

If it reports **no sections / empty text**, the PDF is probably scanned images — OCR it first (the `pdf` skill can do this), then re-run.

### Step 2 — Read the manifest, then run the workflow

Read `manifest.json` (small — metadata only, not the section text). The `text_file` and `figures` paths in it are absolute, so any agent can read them directly.

**With a Workflow tool (Claude Code):** launch the bundled workflow, passing the manifest's fields as `args`.

```
Workflow({
  scriptPath: "<SKILL_DIR>/references/workflow-template.js",
  args: {
    title:   <manifest.title>,
    density: "telegraphic",          // or "readable" if the user asked for prose
    sections: <manifest.sections>    // the whole array, verbatim
  }
})
```

**Without one (Codex / Hermes single-agent):** do the same work yourself — for each section in `manifest.sections`, run stages 1–4 below (reading `text_file` and any `figures`), collect the finalized sections, then run the synthesis. Follow the exact prompts/rules in `references/workflow-template.js`. It's slower (no parallelism) but produces the same artifact; or delegate to Claude Code for the parallel version.

Per section the workflow runs (pipelined, so fast sections finish while slow ones are still going):
1. **Extract** — one text agent digests prose/formulas/code under the **5-way inclusion gate** (Relevant / Specific / Novel / Faithful / Anywhere); 1–3 vision agents explain the figures (auto-split when a section has many) under a **no-fabrication rule** — report only legibly-readable values, hedge anything inferred as "≈ (from chart)". Runs in parallel.
2. **Consolidate (completeness-first)** — fuses everything into one telegraphic draft where **density comes from cutting filler and fusing redundancy, never from dropping content**. There is no length budget: **preservation tiers** (never compress thesis/definitions/numbers/mechanisms/formulas), the **qualifier rule** (never drop when/where/under-what-condition — those qualifiers *are* the wisdom), and **molecular sizing** (each line minimal but self-contained). Emits a `Q:` cue list and an intra-section concept-link layer; no process commentary.
3. **Verify (faithfulness gate)** — a separate agent re-reads the *source* and runs six checks: precision (every claim supported?), recall/coverage (QuestEval — every salient source question answerable + every subsection/figure/code/param/exercise present?), context-collapse, TIER-0 survival, decontextualization, and figure-fabrication/leakage → returns corrections or `PASS`.
4. **Finalize** — **reinstates** every item the gate flagged as dropped and applies all corrections (completeness over brevity); skipped automatically when the gate returns `PASS`.

Then a final agent writes the **document-level synthesis** with context-aware merging: core theses, how-it-fits-together, a high-value **cross-section link layer**, cross-cutting pitfalls, formula/code indexes, top takeaways — citing section ids and self-checking (G-Eval style) before returning.

These stages encode verified SOTA techniques; the rationale + citations live in [`references/techniques.md`](references/techniques.md).

It returns `{ title, synthesis, sections: [ {id, title, final}, ... ] }`. The result lands in the completion notification's `output-file`.

The workflow runs in the background. While it runs, you can tell the user roughly how many agents are in flight (~3–6 per section). For a typical book this is a large job (tens of agents, millions of tokens, several minutes) — that thoroughness is the point; don't shortcut it.

### Step 3 — Assemble the final document

Point the assembler at the workflow's output file. It unwraps the `{result: ...}` wrapper, orders sections, prepends the synthesis, and builds a clickable table of contents.

```bash
python3 "$SKILL_DIR/scripts/assemble.py" \
  --result "/path/from/notification/output-file" \
  --manifest "<workspace>/manifest.json" \
  --out "<same dir as source>/<source name> — Distilled.md"
```

Default the output next to the source file. If a section's `final` came back as a failure stub, re-run just that section (re-invoke the workflow with `args.sections` set to the one section) and re-assemble.

### Step 4 — Deliver

Give the user the output file path as a clickable markdown link, and surface the single highest-leverage piece **inline** — usually the synthesis's "If You Remember N Things" plus the "how it fits together" map — so they get value without opening the file. Briefly note coverage (sections distilled, figures explained).

## Tuning knobs

- **Density** — `args.density: "readable"` for clean prose instead of telegraphic. Everything else (formulas, figures, caveats) is still preserved.
- **Granularity** — if sections are too coarse (whole Parts) or too fine (tiny subsections), re-stage with `--section-level N`. Aim for chapter-sized units (roughly 5–60 sections).
- **Figure fidelity** — bump `--dpi 200` for dense plots with small axis labels; drop to `--dpi 110` to save space on figure-light docs.
- **Scale** — the workflow auto-pipelines and caps concurrency; very large docs just take longer. No manual scaling needed.

## Edge cases

- **Scanned PDFs**: image-only pages yield no text — OCR first, then re-run.
- **No table of contents**: the stager detects in-text numbered headings (consecutive 1,2,3… sequence, which rejects diagram labels/citations); only if too few are found does it fall back to fixed-size chunks ("Pages a–b").
- **Vector diagrams**: detected via drawing density, not just raster images — tune with `--min-vector-drawings` or disable with `--no-vector-figs` if a text-heavy doc over-triggers.
- **DOCX/EPUB figures**: embedded images are copied out and attached to the section they appear in; vector art (EMF/WMF/SVG) is skipped (not readable as raster). The figure explanation otherwise works identically.
- **Huge single sections**: a very long chapter is still one agent — fine, but if a section's text is enormous (hundreds of KB), consider re-staging that file split, or accept the longer single-agent read.

## Files

- `scripts/stage_document.py` — document → workspace (manifest + text/ + figs/). Multi-format; TOC / in-text-heading / chunk sectioning; raster + vector figure detection.
- `references/workflow-template.js` — the federated extract → consolidate (Chain-of-Density) → faithfulness-gate → finalize → synthesize workflow. Parameterized entirely via `args`; usually no edits needed.
- `scripts/assemble.py` — workflow result → final markdown with TOC + synthesis.
- `references/techniques.md` — the verified SOTA research foundation (cited) behind every prompt rule. Read it to understand or tune the pipeline.
