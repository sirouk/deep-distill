# Changelog

All notable changes to deep-distill. Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [0.1.0] — initial release

First public release: a Claude Code skill that distills a long document's *wisdom* — not just its word count — into one dense, faithful, human-readable reference.

### Included
- **`scripts/stage_document.py`** — multi-format stager (PDF · EPUB · DOCX · TXT/MD). Sectioning via bookmark TOC → in-text numbered-heading detection → page chunks. Figure-page detection by raster images **and** vector-drawing density (so vector line-art diagrams aren't missed). Auto-installs PyMuPDF.
- **`references/workflow-template.js`** — the federated 5-stage workflow: Extract (5-way inclusion gate) → Consolidate (completeness-first) → Verify (precision+recall+coverage faithfulness gate) → Finalize (reinstate dropped) → cross-linked Synthesis.
- **`scripts/assemble.py`** — stitches the workflow result into one markdown reference with TOC + synthesis.
- **`references/techniques.md`** — the verified, cited research foundation behind every prompt rule.
- **`examples/`** — a distilled Bitcoin whitepaper demo.
- **`install.sh`** + multi-agent install — the skill is a portable SKILL.md that runs in **Claude Code** (`~/.claude/skills/`), **Codex** (`~/.codex/skills/`), and **Hermes** (`~/.hermes/skills/`). Claude Code gets the full parallel federation via the `Workflow` tool; Codex/Hermes run the same pipeline sequentially or delegate to Claude Code.

### Method evolution (the short version; full story in [EVALUATION.md](EVALUATION.md))
- **v1** — extract → completeness-critic → consolidate → synthesize.
- **v2** — added the full SOTA stack (5-way inclusion gate, Chain-of-Density, preservation tiers, qualifier rule, precision+recall faithfulness gate, cross-section links). A blind A/B **revealed v2 regressed vs v1** on faithfulness/coverage: the fixed-length Chain-of-Density pass dropped whole subsections and fabricated figure values to hit a density target.
- **v3** — made completeness non-negotiable + added figure anti-fabrication; **also lost 7–2** (it stopped fabricating but began silently "correcting" source typos, and still dropped worked examples — the preservation tiers literally listed "worked examples" in the drop-tier).
- **v4 (shipped)** — kept the original's **verbatim-fidelity, keep-everything core** (reproduce code/formulas/symbols exactly; flag-don't-fix source typos; worked examples + exercises are TIER-0) and added only the changes that independently helped: figure anti-fabrication, cross-section links, Q-cues, qualifier rule. **Won the blind A/B 9–0** (faithfulness +1.11, coverage +0.33, usability +1.00; density −1.00 is the one accepted trade-off).

### Known limitations
- The dense note is lossy by design ("nothing lost" = no *salient wisdom* lost, enforced by the faithfulness gate — not literal losslessness).
- Requires Claude Code with the Workflow tool / subagents and a vision-capable model.
- Scanned PDFs must be OCR'd first.
