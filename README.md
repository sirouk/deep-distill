# deep-distill

**Compress an entire document's *wisdom* — not just its word count — into one dense, terse, human-readable reference that loses nothing.** Every formula, definition, named function, parameter, number, caveat, and an explanation of every diagram. Telegraphic ("grammar-sacrifice") by default; readable prose on request.

deep-distill is a [Claude Code](https://claude.com/claude-code) **skill**. It turns a 400-page book or a dense paper into a single reference file by splitting the document into its natural sections and running a federated team of agents over each one — extracting, explaining the figures, and then **adversarially verifying against the source** so nothing is dropped or invented in translation.

> The prompts aren't vibes. Every rule in the pipeline traces to a verified, cited technique from the summarization / knowledge-representation / cognitive-science literature — see [`references/techniques.md`](references/techniques.md).

---

## Why "wisdom, not words"

Ordinary summarization shortens text and averages meaning away. deep-distill is built around the opposite goal — keep the *potency*:

- **Preservation tiers** — the thesis, definitions, numbers, conditions, causal mechanisms, named methods, and formulas are **never** compressed. All compression is spent on examples, restatement, and filler. *(LLMLingua Budget Controller principle.)*
- **Qualifier rule (anti "context-collapse")** — telegraphic style may drop articles and copulas but **never** the `when / where / for-whom / under-what-condition` qualifiers. A claim shorn of its scope reads as universal and is *worse than omission*. *(PropRAG; Molecular Facts.)*
- **Precision + recall faithfulness gate** — a separate agent re-reads the source and checks the draft both ways: every claim must be **supported** (precision — compression can't invent), and every salient source question must be **answerable from the note** (recall — nothing important dropped). *(FActScore / SAFE + QuestEval.)*
- **Completeness-first compression** — density comes from cutting filler and fusing redundancy, **never** from dropping content; there is no length budget. (We learned this the hard way — see [Validation](#validation): a naive fixed-length Chain-of-Density pass quietly dropped whole subsections, so we replaced it.)
- **Cross-section link layer** — the synthesizer emits labeled `concept —relation→ concept` links *between* sections, the integrative insight a per-section split would otherwise destroy. *(Concept maps; Zettelkasten link-with-a-reason.)*
- **Figure anti-fabrication** — vision agents report only values they can actually read off a chart (hedged `≈ … from chart`), never invented specifics; a dedicated gate check hunts fabricated figure numbers.

---

## Example: the Bitcoin whitepaper

The demo distills Satoshi Nakamoto's 9-page [Bitcoin whitepaper](https://bitcoin.org/bitcoin.pdf) — short, famous, freely distributable, with real vector diagrams (the transaction/block chain, Merkle-tree pruning, SPV) and the Poisson double-spend math.

➡️ **[`examples/bitcoin-whitepaper.distilled.md`](examples/bitcoin-whitepaper.distilled.md)**

> 🍎 **Fun fact:** for about five years, *every Mac secretly shipped with the Bitcoin whitepaper.* A copy of `bitcoin.pdf` lived inside macOS as a test page for the Image Capture scanner utility (`/System/Library/Image Capture/Devices/VirtualScanner.app/Contents/Resources/simpledoc.pdf`), from **macOS Mojave (2018)** until Apple quietly removed it in **Ventura 13.4 (2023)**. Nobody at Apple ever publicly explained why it was there. It's a fitting demo input for a tool about hidden, compressed knowledge.

That whitepaper also exposed — and drove — two real upgrades to the stager: its sections have **no PDF bookmarks** (so deep-distill detects in-text numbered headings) and its diagrams are **pure vector line-art** that `get_images()` never reports (so deep-distill detects figures by vector-drawing density too).

---

## How it works

```mermaid
flowchart LR
    A[Document<br/>PDF · EPUB · DOCX · TXT] --> B[stage_document.py<br/>split into sections<br/>+ render/extract figures]
    B --> M[(manifest.json)]
    M --> W{{federated workflow<br/>per section, pipelined}}
    subgraph W [ ]
      direction TB
      E[1 · Extract<br/>text + figures, 5-way gate] --> C[2 · Consolidate<br/>completeness-first + tiers]
      C --> V[3 · Faithfulness gate<br/>precision + recall + coverage vs source]
      V --> F[4 · Finalize<br/>reinstate dropped + fix]
    end
    W --> S[5 · Synthesis<br/>theses · cross-section links · indexes]
    S --> AS[assemble.py] --> O[One dense .md reference]
```

1. **Stage** (`scripts/stage_document.py`) — a plain, deterministic script splits the document (bookmark TOC → in-text headings → page chunks), renders figure pages (raster **and** vector diagrams), and writes a `manifest.json`. Auto-installs [PyMuPDF](https://pymupdf.readthedocs.io/).
2. **Distill** (`references/workflow-template.js`) — the federated [Workflow](https://docs.claude.com/en/docs/claude-code) runs the 5 stages above, one team per section, pipelined for speed. Returns structured JSON.
3. **Assemble** (`scripts/assemble.py`) — stitches the result into one markdown file with a clickable table of contents and the document-level synthesis up top.

The splitting and assembly are cheap scripts; only the judgment work uses agents.

---

## Validation

This pipeline was **stress-tested against itself**, not just asserted to be good. We ran a **blind A/B**: distill the same source chapters with two method versions, then have an independent panel of judge-agents — who don't know which method produced which output, and who read the original source to ground every call — score six dimensions (faithfulness, wisdom-coverage, qualifier preservation, density, figure explanation, usability).

It took three rounds. An early version that bolted on every fashionable summarization technique (including a fixed-length Chain-of-Density pass) **lost to the simpler baseline 7–2** — it bought density by quietly dropping whole subsections and fabricating figure values. A completeness-first retune *also* lost 7–2 (it stopped fabricating but began silently "correcting" source typos and still dropped worked examples). The shipped method (**v4**) keeps the original's **verbatim-fidelity, keep-everything core** and adds only the changes that independently helped — figure anti-fabrication, cross-section links, Q-cues — and **won 9–0**: faithfulness +1.11, coverage +0.33, usability +1.00, with the one honest cost being density (v4 is more verbose, by design).

Full methodology, all three rounds, and per-dimension scores are in **[`EVALUATION.md`](EVALUATION.md)**. The lesson generalizes: a technique that is state-of-the-art for *fixed-length summaries* (Chain-of-Density) can be actively harmful for *lose-nothing distillation*. Measure on your actual objective — don't assume "more SOTA" is better.

---

## Install

deep-distill is a portable **SKILL.md** skill — the same skill works in **Claude Code**, **Codex**, and **Hermes** ([SKILL.md is a cross-agent standard](https://developers.openai.com/codex/skills); only the install directory differs).

### One-command install

```bash
# Claude Code  → ~/.claude/skills/deep-distill
curl -fsSL https://raw.githubusercontent.com/sirouk/deep-distill/main/install.sh | bash -s -- claude

# Codex        → ~/.codex/skills/deep-distill      (then once: codex --enable skills)
curl -fsSL https://raw.githubusercontent.com/sirouk/deep-distill/main/install.sh | bash -s -- codex

# Hermes       → ~/.hermes/skills/deep-distill
curl -fsSL https://raw.githubusercontent.com/sirouk/deep-distill/main/install.sh | bash -s -- hermes

# …or all three at once
curl -fsSL https://raw.githubusercontent.com/sirouk/deep-distill/main/install.sh | bash -s -- all
```

The installer pulls `SKILL.md` + `scripts/` + `references/` from raw GitHub into the right per-agent skills directory. (Skim [`install.sh`](install.sh) before piping any installer to `bash` — good hygiene.)

### Manual install (raw URLs, no script)

```bash
AGENT_DIR=~/.claude/skills/deep-distill        # or ~/.codex/skills/deep-distill , ~/.hermes/skills/deep-distill
mkdir -p "$AGENT_DIR/scripts" "$AGENT_DIR/references"
BASE=https://raw.githubusercontent.com/sirouk/deep-distill/main
for f in SKILL.md scripts/stage_document.py scripts/assemble.py \
         references/workflow-template.js references/techniques.md; do
  curl -fsSL "$BASE/$f" -o "$AGENT_DIR/$f"
done
```

### Or clone the whole repo into the skills dir

```bash
git clone https://github.com/sirouk/deep-distill ~/.claude/skills/deep-distill   # or ~/.codex/... , ~/.hermes/...
```

| Agent | Skills directory | Notes |
|---|---|---|
| **Claude Code** | `~/.claude/skills/deep-distill` | Full parallel, faithfulness-gated federation via the `Workflow` tool |
| **Codex** | `~/.codex/skills/deep-distill` | `codex --enable skills` once; fans out one [subagent](https://developers.openai.com/codex/subagents) per section in parallel |
| **Hermes** | `~/.hermes/skills/deep-distill` | [hermes-agent](https://github.com/NousResearch/hermes-agent); enable the `terminal` toolset (`hermes tools`); fans out one [subagent](https://hermes-agent.nousresearch.com/docs/user-guide/features/delegation) per section in parallel |

Restart the agent, then just ask — e.g. *"deep-distill this PDF in my Downloads."* The skill triggers on requests to extract/compress/distill a long or figure-heavy document.

### Requirements

- **A shell / terminal / code-execution tool** — the skill *runs scripts*, it never reads the PDF directly. Claude Code: Bash (built in); Hermes: the `terminal` toolset (`hermes tools` to enable); Codex: built in once skills are on. Without it the agent can't run the pipeline.
- **Python 3.8+** (PyMuPDF auto-installs via `pip --user` on first run).
- A **vision-capable model** (to read and explain figures).
- **Subagent fan-out** — the skill states the *intent* ("dispatch one subagent per section, in parallel") and each agent uses whatever current parallel-subagent capability it has — so it stays correct as those tools evolve. Claude Code, Codex, and Hermes all provide one; the parent then synthesizes.

---

## Usage notes & tuning

- **Density** — pass `density: "readable"` to the workflow for clean prose instead of telegraphic; formulas/figures/caveats are still preserved.
- **Granularity** — `--section-level N` if auto-sectioning is too coarse/fine (aim for ~5–60 chapter-sized units).
- **Figures** — `--dpi 200` for dense plots; `--min-vector-drawings` / `--no-vector-figs` to tune vector-diagram detection.
- **Scope** — the workflow auto-pipelines and caps concurrency; bigger docs just take longer.

## Honest limitations

- **It is lossy.** The dense note discards the source; "nothing lost" means *no salient wisdom* lost (enforced by the faithfulness gate), not literal losslessness. Each claim is anchored to its section for traceability.
- **It costs tokens.** A full book is tens of agents and millions of tokens over several minutes. That thoroughness is the point.
- **Scanned PDFs need OCR first** (image-only pages yield no text).
- The faithfulness gate is a strong reducer of omission/hallucination, **not** a proof of zero error.

## Repository layout

```
deep-distill/
├── SKILL.md                       # the skill: triggering + the pipeline (portable across agents)
├── install.sh                     # one-command installer for Claude Code / Codex / Hermes
├── scripts/
│   ├── stage_document.py          # document → sections + figures + manifest
│   └── assemble.py                # workflow result → final markdown
├── references/
│   ├── workflow-template.js       # the federated 5-stage workflow (canonical prompt spec)
│   └── techniques.md              # verified, cited research foundation
├── examples/
│   └── bitcoin-whitepaper.distilled.md
├── EVALUATION.md                  # blind-A/B methodology + how the method was validated
├── CHANGELOG.md
├── LICENSE                        # MIT
└── README.md
```

## Acknowledgements

The pipeline stands on published work — Chain-of-Density, LLMLingua, FActScore, SAFE, QuestEval, SummaC, BooookScore, PropRAG, Molecular Facts, Dense X / propositions, concept maps (Novak & Cañas), Zettelkasten, Progressive Summarization, and the Cornell method. Full citations in [`references/techniques.md`](references/techniques.md).

## License

[MIT](LICENSE).
