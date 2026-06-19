# Evaluation: how deep-distill was validated

deep-distill's pipeline was not just designed and asserted to be good — it was **stress-tested against itself** with a blind, source-grounded A/B, and an early version was caught regressing and fixed. This doc records the methodology and results so the claims in the README are auditable and reproducible.

## Why test the method, not just trust it

It is easy to bolt every fashionable summarization technique onto a pipeline and *assume* the output got better. It often doesn't. Distillation quality is multi-dimensional (faithfulness, coverage, qualifier preservation, density, figure handling, usability) and these trade off against each other. The only honest way to know whether a change helped is to measure it on the actual objective — *lose-nothing* distillation — with judges who can't see which method produced which output.

## Methodology — blind A/B

For a set of representative chapters, holding the **source text and figures identical**:

1. **Two methods** distill each chapter (only the method differs).
2. **Independent judge-agents** receive both outputs labelled only **Version A** / **Version B**, with the A/B side **randomized per (chapter, judge)** so position can't be a tell.
3. Each judge **reads the original source chapter** to ground every faithfulness/coverage call.
4. Judges score each version **1–10 on six dimensions** — faithfulness, wisdom-coverage, qualifier-preservation, density/terseness, figure-explanation, usability — pick an overall winner, and cite **concrete** evidence (a specific qualifier/number/figure/claim one kept or got right that the other dropped or distorted).
5. **3 judges per chapter**; results are **de-blinded** afterward and tallied, with per-dimension means.

The harness is itself a deterministic Workflow (nested distill → extract-baseline → judge panel → synthesize), so the test is repeatable. Same source, same judges, same rubric across rounds.

## Round 1 — v1 vs v2: the full SOTA stack *regressed*

- **v1** = original (extract → completeness-critic → consolidate → synthesize).
- **v2** = v1 + the full SOTA stack: 5-way inclusion gate, **fixed-length Chain-of-Density**, preservation tiers, qualifier rule, precision+recall faithfulness gate, cross-section links, Q-cues.

**Result: v1 won, 7–2** (v2 took only Ch3 2–1; was swept 0–3 on Ch7 and Ch16). Tested on 3 chapters of *Advances in Financial Machine Learning* (Labeling, Cross-Validation, ML Asset Allocation), 9 verdicts.

| Dimension | v2 | v1 | winner |
|---|---|---|---|
| Faithfulness | 8.22 | **8.44** | v1 |
| Wisdom / coverage | 8.44 | **9.00** | v1 |
| Qualifier preservation | 8.56 | **9.00** | v1 |
| Figure explanation | 7.89 | **8.56** | v1 |
| Density / terseness | **8.89** | 7.67 | v2 |
| Usability | **8.78** | 8.33 | v2 |

v2 won **only** the two axes it was tuned to push (density, usability) and lost the three that matter most for "lose nothing," plus figure explanation.

### Diagnosis — why "more SOTA" was worse
1. **Fixed-length Chain-of-Density caused omission.** CoD holds length constant while adding entities — correct for a fixed-length *summary*, wrong for a lose-nothing *reference*. On dense source it dropped whole subsections to make room (e.g. Ch16 §16.6's selection-bias/deflated-Sharpe caveat; ~4 of 8 figures incl. 16.1 and 16.7; Ch3/Ch7 exercises + code provenance). v1 had no length budget, so it kept everything.
2. **Figure fabrication.** v2 stated specific price levels/dates for a chart as if they were facts; the text-only faithfulness gate couldn't catch image-derived numbers.
3. **Process-commentary leakage** ("swap the page labels on Fig 16.4/16.6") — agents narrating instead of distilling.

Two fairness caveats softened it: small n, and judges saw only the source *text* (penalizing v2's richer figure work where it couldn't be verified from text). But dropped subsections and unhedged figure numbers are real regressions.

## The fixes → v3 (shipped)

Each v2 failure mode maps to a concrete v3 change:

| v2 failure | v3 fix |
|---|---|
| CoD fixed-length → dropped subsections | **Completeness-first consolidation**: no length budget; density only via cutting filler / fusing redundancy, never dropping content; explicit coverage check |
| Figure values fabricated | **No-fabrication rule** for vision agents (report only legible values; hedge inferred as "≈ from chart") + a dedicated **gate check #6** for fabricated figure numbers |
| Gate found gaps but they weren't restored | **Finalize now reinstates** every dropped subsection/figure/code/param the gate flags; completeness over brevity |
| Coverage not explicitly checked | Gate **recall arm** now verifies every source subsection/figure/code/param/exercise is present |
| Process commentary leaked | Explicit **no-process-commentary** instruction in consolidate + finalize, and a gate leakage check |

v2's genuine wins were **kept**: the cross-section Links map, Q-cue blocks, qualifier rule, preservation tiers, 5-way inclusion gate, and cross-section synthesis.

## Round 2 — v3 (completeness-first) vs v1

A retune that dropped fixed-length Chain-of-Density, made completeness non-negotiable, added a figure-anti-fabrication rule, and made the gate reinstate dropped content. Same harness.

**Result: v3 also lost 7–2.** But it *moved* the failure, which was diagnostic.

| Dimension | v3 | v1 | winner |
|---|---|---|---|
| Faithfulness | 8.22 | **8.56** | v1 |
| Wisdom / coverage | 8.56 | **8.78** | v1 |
| Qualifier preservation | 8.78 | **9.00** | v1 |
| Figure explanation | 8.33 | 8.33 | tie |
| Density / terseness | **8.44** | 8.00 | v3 |
| Usability | **9.00** | 8.11 | v3 |

- **Fixed:** figure fabrication was gone (v3 hedged chart-read values; here it was *v1* inventing axis numbers).
- **New failure:** v3 **silently "corrected" source bugs/typos** that v1 preserves and flags — e.g. Ch7's known `Φi ∩ Φj = ∅` book typo (v1 reproduces + flags; v3 swapped in `≠ ∅`); an undefined-var line in a code snippet; a missing-tilde formula. Paraphrase ("own words") is right for prose but wrong for code/formulas.
- **Still dropping** worked examples/exercises — traced to a self-inflicted bug: the preservation-tier definition literally listed *"worked examples"* in the crush-or-drop tier.

The margins are tiny (faithfulness 8.22 vs 8.56) and several verdicts were explicit coin-flips — "7–2" overstates near-ties decided by a single source-artifact catch.

## Round 3 — v4 (verbatim-fidelity core + additive wins) vs v1

v4 keeps the original's *winning* behavior — reproduce code/formulas/symbols **verbatim**, keep every subsection/worked-example/exercise, **flag (don't fix)** source typos — and layers on only the additions that independently helped (figure anti-fabrication, cross-section links, Q-cues, qualifier rule). The `TIER-2` "worked examples" bug is fixed (now TIER-0).

**Result: v4 won 9–0** (3–0 in every chapter) — reversing both prior rounds.

| Dimension | v4 | v1 | Δ (v4−v1) |
|---|---|---|---|
| Faithfulness | **9.00** | 7.89 | +1.11 |
| Wisdom / coverage | **9.00** | 8.67 | +0.33 |
| Qualifier preservation | **9.11** | 9.00 | +0.11 |
| Figure explanation | **8.44** | 8.33 | +0.11 |
| Usability | **9.00** | 8.00 | +1.00 |
| Density / terseness | 7.78 | **8.78** | −1.00 |

All three regressions fixed, and each fix was the cited reason judges ruled for v4:
- **Figure fabrication → inverted into a strength.** v4 refuses to invent figure values (flags "≈ from chart; text gives none"); the v1-style output fabricated concrete prices/annotations not in the image-only source.
- **Silent typo correction → fixed.** v4 reproduces source defects verbatim and flags them (`close.index[df0–1]` en-dash bug, `ω′a=1I [sic]`, fi-ligature OCR typos, the printed `sqrt(4T*d)` form).
- **Dropped examples → fixed.** v4 keeps Exercises 3.1–3.5 with their load-bearing params and the named bibliographies.

**The honest cost:** density. v4 is the more verbose side (−1.00) — a direct consequence of verbatim code blocks + keep-everything. Judges ruled for v4 *despite* v1 being terser, on faithfulness/coverage grounds. v4's win is specifically about **not fabricating and not dropping**, at a measurable density cost — not about being better-written. Same small-n / well-known-source / LLM-judge caveats as above apply; verdicts were "medium" confidence and 9–0 overstates per-dimension margins outside faithfulness/usability.

**Conclusion:** v4 is the shipped method — the original's verbatim-fidelity, keep-everything core, plus the three additions that independently helped (figure anti-fabrication, cross-section links, Q-cues). The two-round detour through the "full SOTA stack" is exactly why the method is what it is.

## Machine-mode evaluation — a different scorecard

Machine mode is not validated by the six human-reference dimensions above. A `.min.txt`
prompt artifact has a stricter and narrower job: replace the source as operative
instructions for an LLM while costing fewer tokens.

Evaluate machine mode with this gate:

1. **Atomic directive inventory** — extract every source rule, condition, threshold,
   carve-out, permission, prohibition, priority, file path, command, variable, exact
   string, and role/account/security boundary as a separate checklist item.
2. **Blind reconstruction** — give independent readers only the compressed artifact,
   no source and no decoder key, and have them reconstruct the directive set in plain
   English.
3. **Artifact-aware judging** — compare the checklist against both the artifact text
   and the reconstructions. Mark missing only if genuinely absent, weakened,
   scope-collapsed, contradictory, or garbled; do not chase phantom gaps caused by one
   reader under-enumerating a preserved directive.
4. **Patch loop** — restore genuine gaps and ASCII failures compactly; keep checklist
   IDs internal and fuse directives into compact rule blocks rather than mirroring the
   inventory.
5. **Token gate** — measure source and artifact with `tiktoken` on `cl100k_base` and
   `o200k_base`; require the artifact to be smaller and ASCII-only.

The prototype that motivated this path compressed an operating-agreement-style
instruction document by extracting 161 atomic directives, blind-reconstructing from the
compressed artifact alone, and patching until the judge found **161 / 161 recovered, 0
missing or weakened**, with roughly 20% fewer tokens on the tested OpenAI tokenizers.
Treat that as a worked proof-of-concept, not a universal guarantee. Each new source
document must pass its own directive-recovery and token gates.

## Threats to validity (read honestly)
- **Small n** — 3 chapters, 9 verdicts/round. Chapter-level effects dominate; a different chapter set could move the headline.
- **Familiar source** — *AIFML* is well represented in LLM training data, so judges can lean on parametric memory. This **understates** faithfulness gaps that would appear on an obscure document.
- **LLM judges** — same-family bias, sensitivity to scaffolding/formatting, leniency toward fluent omission. Confidence labels clustered at "medium."
- **Editorial weighting** — the verdict leans on faithfulness/coverage/qualifiers being most important. Under a density-weighted rubric the ranking changes.
- **Machine-mode certification is functional, not formal** — zero missing directives
  after blind reconstruction is strong practical evidence, but not a proof of identical
  behavior across every model, temperature, or downstream prompt wrapper.

## Reproduce it
The comparison is a Workflow: distill the same chapters with two template versions, extract the baseline, run a randomized blind judge panel, de-blind and tally. Point the harness at any document you can stage and at two `workflow-template.js` variants to A/B your own changes.
