---
name: deep-distill
description: Distill or compress a whole document with a faithfulness-gated, federated workflow. Use for human consumption when the user wants to extract wisdom from a long PDF, EPUB, DOCX, book, paper, manual, spec, report, or figure-heavy document into a dense study/reference note that preserves formulas, code, numbers, caveats, and figure explanations. Use for machine consumption when the user wants to minify operative instructions, system prompts, agent rules, policies, agreements, API/format contracts, or specs into a token-minimized ASCII artifact that can replace the source in an LLM prompt and must pass blind directive-recovery verification. If the user invokes deep-distill without choosing human or machine mode, ask which output they want before running.
metadata:
  hermes:
    requires_toolsets: [terminal]
---

# deep-distill

Turn a whole document into one of two high-fidelity artifacts:

- **human mode** -> a dense, readable-or-telegraphic reference for a person studying the source. This is the original deep-distill path: preserve wisdom, formulas, code, figures, caveats, and cross-section links.
- **machine mode** -> a token-minimized, ASCII-only prompt artifact for an LLM. This is stricter: the output is meant to replace the source as operative instructions, so every atomic directive must be recoverable from the compressed text alone.

## Mode Dispatch

Parse the invocation before doing any work.

- `/deep-distill human @DOC` or "deep-distill this for a reader" -> **human mode**.
- `/deep-distill machine @DOC` or "minify this prompt / agreement / rules file" -> **machine mode**.
- `/deep-distill @DOC` or an ambiguous conversational request -> ask one concise question: "Distill for a human study reference, or compress for machine prompt use?" Do not silently guess.

Use the doc-type heuristic only to recommend an option when asking:

- Recommend **machine** for text-only operative documents a model will consume: system/developer prompts, coding-agent rules, operating agreements, policies, API/format contracts, protocol/spec instructions, checklists, or anything the user says will be pasted into context.
- Recommend **human** for books, papers, manuals, reports, textbook chapters, figure/math-heavy PDFs, and anything the user wants to study or learn from.

## Shared Hard Rules

1. **Read through `stage_document.py` first.** It creates a workspace with section text and a `manifest.json`. Human mode may render/extract figures. Machine mode must pass `--no-figs` unless the user explicitly says images contain operative instructions.
2. **Never browser-read or screenshot a PDF.** For human-mode figures, use the rendered PNGs from the workspace `figs/` folder listed in `manifest.json`. Screenshotting/viewer snapshots are prohibited fallbacks.
3. **Use the real shell/terminal.** Do not run the staging scripts inside an isolated interpreter that cannot see the user's files.
4. **On staging errors, fix the command and retry.** Usual fixes: set `SKILL_DIR` in the same command, ensure `python3` exists, let the script install PyMuPDF. If there is no shell, stop and say so.
5. **Machine-mode subagents must not write files or run git.** Every machine-mode agent prompt already says this; keep it there. Only the parent assembles/writes the final artifact after certification.

Path rule: define `SKILL_DIR` inside each shell command. Use the install location for the current agent:

- Claude Code: `$HOME/.claude/skills/deep-distill`
- Codex: `$HOME/.codex/skills/deep-distill`
- Hermes: `$HOME/.hermes/skills/deep-distill`

## Human Mode

Use human mode when the output is for a person. It expands the document into a study-grade reference: section distillations, figure explanations, Q-cues, cross-section links, indexes, and synthesis.

### 1. Stage

```bash
SKILL_DIR="$HOME/.codex/skills/deep-distill"
python3 "$SKILL_DIR/scripts/stage_document.py" "/absolute/path/to/document.pdf"
```

The script prints `WORKSPACE: ...` and `MANIFEST: ...`. Use those exact paths.

Useful flags: `--title "..."`, `--section-level N`, `--dpi 200`, `--min-vector-drawings N`, `--no-vector-figs`, `--keep-frontmatter`, `--workspace DIR`.

### 2. Fan Out

Read `manifest.json`. Dispatch one subagent per `sections` entry in parallel. Give each subagent its `text_file` plus its `figures` paths. It runs the four per-section stages below and returns its finalized markdown section.

Shortcut: if the runtime has a workflow runner, run `references/workflow-template.js` with:

```js
{
  mode: "human",
  title: "<manifest.title>",
  density: "telegraphic",
  sections: <manifest.sections>
}
```

Use `density: "readable"` if the user asked for prose.

### 3. Synthesize

If the workflow runner did not already synthesize, run one subagent over all finalized sections to produce document-level theses, cross-section links, formula/code indexes, and top takeaways. The synthesis prompt lives in `references/workflow-template.js`.

### 4. Assemble

Collect:

```json
{ "title": "...", "synthesis": "...", "sections": [ {"id":"01","title":"...","final":"..." } ] }
```

Then:

```bash
SKILL_DIR="$HOME/.codex/skills/deep-distill"
python3 "$SKILL_DIR/scripts/assemble.py" --mode human --result result.json --manifest "<workspace>/manifest.json" --out "<source dir>/<name> - Distilled.md"
```

### 5. Deliver

Give the user the output file path and surface the synthesis's highest-value takeaways inline.

## Machine Mode

Use machine mode when the output is for an LLM. The goal is not a prettier summary; it is a smaller prompt artifact that preserves directive force. The output should be ASCII-only, tokenizer-measured, and blindly recoverable without the original.

### Machine Pipeline

1. **Inventory** -> extract every atomic directive from each section: rule, condition, threshold, exception, carve-out, prohibition, permission, priority, literal string, path, command, variable, role boundary.
2. **Compress** -> rewrite into terse ASCII. Delete filler and rationale. Fuse duplicates into compact rule blocks. Preserve all qualifiers and exact literals. Never use rare Unicode as shorthand. Keep directive IDs internal; do not emit `D001`-style labels in the artifact.
3. **Blind reconstruct** -> multiple readers receive only the compressed artifact and reconstruct the directive set.
4. **Artifact-aware judge** -> compare the source-derived directive checklist against both the artifact text and the reconstructions. Mark missing only when genuinely absent, weakened, scope-collapsed, contradictory, or garbled.
5. **Patch loop** -> restore missing directives or ASCII failures compactly and repeat until zero gaps and ASCII pass, or return `needs_patch`.
6. **Token gate** -> measure source vs artifact with `tiktoken` (`cl100k_base` and `o200k_base`); require the artifact to be smaller and ASCII-only.

### 1. Stage

```bash
SKILL_DIR="$HOME/.codex/skills/deep-distill"
python3 "$SKILL_DIR/scripts/stage_document.py" "/absolute/path/to/DOC.md" --no-figs --min-chars 1 --keep-frontmatter
```

For prompt/agreement/rules files, keep short sections. A one-line section can still be a binding directive.

### 2. Run the Workflow

Run `references/workflow-template.js` with:

```js
{
  mode: "machine",
  title: "<manifest.title>",
  sections: <manifest.sections>,
  machine_candidates: 3,
  machine_patch_rounds: 3
}
```

The workflow returns:

```json
{
  "title": "...",
  "mode": "machine",
  "status": "certified|needs_patch",
  "certified": true,
  "artifact": "...",
  "directive_count": 161,
  "verification": {
    "status": "certified",
    "total_count": 161,
    "recovered_count": 161,
    "missing": [],
    "ascii_ok": true
  }
}
```

If `status` is `needs_patch`, do not use the artifact as a replacement prompt. Inspect `verification.missing`, patch, and rerun.

### 3. Assemble

```bash
SKILL_DIR="$HOME/.codex/skills/deep-distill"
python3 "$SKILL_DIR/scripts/assemble.py" --mode machine --result result.json --manifest "<workspace>/manifest.json" --out "<source dir>/<name>.min.txt"
```

The assembler normalizes common typographic punctuation to ASCII, then refuses uncertified or still-non-ASCII machine artifacts by default. Use `--allow-uncertified` only to inspect a failed candidate, not to ship it.

### 4. Token Gate

```bash
SKILL_DIR="$HOME/.codex/skills/deep-distill"
python3 "$SKILL_DIR/scripts/measure_tokens.py" --compare "/absolute/path/to/DOC.md" "<source dir>/<name>.min.txt" --require-smaller --require-ascii
```

First run may bootstrap `tiktoken` into `~/.cache/deep-distill/token-venv`. Report both tokenizers. If the artifact is not smaller in both, rerun compression with a tighter candidate or tell the user the document is already near its compact limit.

### 5. Deliver

Give the user the `.min.txt` path plus a short certificate:

- directive recovery: `N/N`, missing `0`
- ASCII: pass/fail
- token counts: source -> minified for `cl100k_base` and `o200k_base`
- honest caveat: this is strong practical evidence of functional equivalence, not a mathematical proof every model will obey it identically.

## The Human Per-Section Stages

`references/workflow-template.js` holds the canonical prompts. In brief:

1. **Extract** -> digest prose/formulas/code under the 5-way inclusion gate; explain figures by reading rendered PNGs only; reproduce literal code/formulas/symbols verbatim; preserve source typos with `[sic]`.
2. **Consolidate** -> fuse into one dense section. Compression comes from cutting filler and fusing redundant prose only; never drop tier-0 content. Emit `Q:` cues and `Links`.
3. **Faithfulness gate** -> re-read source and check precision, recall/coverage, context-collapse, tier-0 survival, decontextualization, figure fabrication, and literal fidelity.
4. **Finalize** -> apply corrections, reinstate dropped items, restore verbatim artifacts, fix distortions.

## Tuning

- **Mode** -> `human` vs `machine`; ask if absent.
- **Human density** -> `telegraphic` default, `readable` on request.
- **Machine aggressiveness** -> `machine_candidates` and `machine_patch_rounds`; never accept an artifact with any missing directives.
- **Machine output shape** -> fuse directives into compact blocks; keep inventory/checklist IDs out of the final artifact.
- **Granularity** -> `--section-level N`, `--chunk-words N`, `--min-chars N`; aim for enough sections that each agent can reason locally.
- **Figures** -> human mode can tune `--dpi`, `--min-vector-drawings`, `--no-vector-figs`; machine mode defaults to `--no-figs`.

## Edge Cases

- **Scanned PDFs** -> OCR first, then stage. Do not browser-read.
- **No PDF bookmarks** -> the stager detects numbered headings, then falls back to page chunks.
- **DOCX/EPUB figures** -> human mode extracts embedded images where possible; vector-only formats may be skipped.
- **Machine doc with examples** -> keep examples only if they carry operative rules, thresholds, literals, or exceptions. Drop examples that merely justify a rule.
- **Machine artifact fails token gate** -> do not fake a win. Either tighten and rerun or report that the source is already compact.

## Files

- `scripts/stage_document.py` -> document to sections, figures, and `manifest.json`.
- `references/workflow-template.js` -> human federation plus machine compression/certification workflow.
- `scripts/assemble.py` -> human result to markdown, or certified machine artifact to `.min.txt`.
- `scripts/measure_tokens.py` -> `tiktoken` token gate for machine mode.
- `references/techniques.md` -> cited research foundation and mode-specific technique notes.
