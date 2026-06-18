# Compressing Wisdom, Not Words — the techniques behind deep-distill

This is the research foundation for deep-distill's pipeline. It was produced by a
multi-agent web search (12 lenses + a gap sweep), then **every technique was adversarially
verified against primary sources** before being kept (26 confirmed of 148 surfaced).

When you see a rule in [`workflow-template.js`](workflow-template.js) — the 5-way inclusion
gate, the Chain-of-Density consolidation loop, preservation tiers, the precision+recall
faithfulness gate, qualifier / context-collapse preservation, molecular sizing, the
cross-section link layer, the G-Eval self-check — this document is the *why*, with citations.

---

# State of the Art: Compressing Wisdom, Not Words

A field guide to techniques — LLM-based and non-LLM — for distilling a long document's *wisdom* (its claims, mechanisms, conditions, and cross-cutting insight) into dense, terse, human-readable notes that keep the original's potency. Every technique below is verified against primary sources, with caveats noted where the popular framing overstates the evidence.

---

## TL;DR — the most powerful, verified techniques

1. **Chain-of-Density (CoD)** — iteratively inject 1-3 missing salient entities while holding length fixed; forces fusion/compression instead of padding. Stop near the human-preferred sweet spot (~step 3), not max density. *(arXiv 2309.04269)*
2. **Missing-entity inclusion gate (Relevant / Specific / Novel / Faithful / Anywhere)** — a checkable salience+grounding rubric; "Faithful = locatable in source" is a built-in anti-hallucination guard, "Anywhere" recovers wisdom buried mid-document. *(arXiv 2309.04269)*
3. **Context-aware hierarchical merging** — recursive merge of section summaries, but re-inject original source spans at every merge so deepening compression stays anchored and traceable; counters the documented hallucination/omission amplification of naive recursive merging. *(arXiv 2310.00785; 2502.00977)*
4. **Atomic-fact / molecular-fact faithfulness gate (FActScore + SAFE + Molecular Facts)** — decompose each distilled line into claims, verify each against the source section; size units as *molecular* (minimal but self-contained), never maximally atomic. Precision arm of the faithfulness loop. *(arXiv 2305.14251; 2403.18802; 2406.20079)*
5. **Recall via source-generated questions + saliency weighting (QuestEval principle)** — generate salient questions *from the source*, answer them *only from the note*; unanswerable salient questions = dropped wisdom. The recall arm. *(arXiv 2103.12693)*
6. **Context-preserving propositions, not bare triples ("context collapse," PropRAG)** — never strip the *when / where / for-whom / under-what-condition* qualifiers; those qualifiers ARE the wisdom. Prohibit dropping conditional operators even in telegraphic style. *(arXiv 2504.18070)*
7. **Concept-map propositions with weighted cross-links (Novak/Cañas)** — store each idea as concept—LABELED relation—concept; integrative cross-links score 10x a plain fact and are exactly the cross-section insight a federated pipeline destroys. *(IHMC; Novak & Gowin rubric)*
8. **Role-differentiated preservation tiers (LLMLingua Budget Controller principle)** — never compress thesis/definitions/numbers/mechanisms; spend all compression on examples, restatement, and filler. *(arXiv 2310.05736)*

---

## Techniques by Family

### LLM-prompting

**Chain-of-Density (CoD).** A single prompt generates a sparse summary, then loops ~5 times, each pass adding 1-3 missing salient entities while *holding token count fixed* (~67→72 tokens), pushing entity density from 0.089 to 0.167. **Why it preserves potency:** holding length constant forces the model to *fuse and compress* rather than pad, surfacing salient facts vanilla summaries drop — this is literally "compress wisdom, not shorten text." **Caveat:** the human study preferred step 3 (~0.15 density), not the densest step 5 — chasing max density hurts readability. **Human-readable:** yes (telegraphic rewrite IS the compression mechanism). *Source: arXiv 2309.04269 (Adams et al., 2023).*

**Missing-entity inclusion gate.** The exact 5-way test CoD uses to decide what to add: **Relevant** (to thesis), **Specific** (concrete, named), **Novel** (not already present), **Faithful** (verbatim-locatable in source), **Anywhere** (any position, not just the lead). **Why potency:** "Faithful" blocks hallucination; "Anywhere" recovers ideas buried mid-document/in captions/footnotes; "Specific" keeps additions concrete. **Adaptation for wisdom (vs. CoD's named-entity metric):** relax the hard "≤5 words" bound to "concrete and self-contained" so relations, mechanisms, caveats, and conditional claims also qualify; treat "Faithful" as a literal source-span citation requirement. **Human-readable:** yes (it's a prompt fragment). *Source: arXiv 2309.04269; learnprompting.org chain-of-density.*

**Budget Controller — role-differentiated compression (principle only).** LLMLingua assigns near-zero compression to instructions/questions (~85-90% preserved) and aggressive compression to redundant demonstrations. **Why potency:** protects load-bearing tokens so meaning survives at high overall ratios — compression is spent on redundancy, not wisdom. **Adaptation:** deep-distill has no instruction/demo role structure and rewrites rather than deletes, so adopt the *principle* as preservation tiers — TIER-0 (never compress: thesis, definitions, numbers, conditions, causal mechanisms, named techniques), TIER-1 (compress moderately: supporting reasoning, qualifications), TIER-2 (crush/drop: worked examples, restatements, hedging, transitions). **Human-readable:** yes. *Source: arXiv 2310.05736 (Jiang et al., EMNLP 2023).*

**G-Eval (CoT + form-filling LLM judge).** The judge auto-generates explicit evaluation *steps* from a task+criteria definition, then fills a per-criterion score form (reached 0.514 Spearman with humans on summarization). **Why potency:** lets you score the *soft* dimensions that determine whether wisdom survived — faithfulness, coverage of key insights, conciseness — with auditable reasoning rather than a black-box number. **Caveats:** documented bias toward LLM-generated text (acute here, since the notes ARE LLM-written); the 0.514 result is GPT-4-specific and the logprob-weighting needs token logprobs — substitute multi-sample averaging. Mitigate self-preference by judging against the *source* and using a different model family as judge. **Human-readable:** yes. *Source: arXiv 2303.16634 (Liu et al., EMNLP 2023).*

### LLM-architecture

**Hierarchical merging (3-prompt recursive summarization).** (1) summarize each chunk, (2) merge sibling summaries upward, (3) merge with added context from previously-merged summaries — recursing to one summary, each level capped at W − G_l. **Why potency:** lets a document far larger than the context window be distilled with explicit, per-tier control over compression ratio (G_l). **Caveat — do NOT advertise as lossless:** BooookScore measures persistent omission (entity 3.71%, event 2.27%, causal 1.21% of sentences) and long-range-dependency loss; it wins on *coherence*, not completeness. **Human-readable:** yes. *Source: arXiv 2310.00785 (Chang et al., ICLR 2024).*

**Context-aware hierarchical merging (anti-hallucination).** Recursive merging amplifies hallucination because each layer summarizes summaries *without seeing source*. Fix: re-inject retrieved source spans at merge time, refine summaries using source as evidence, and align claims via citations. **Why potency:** keeps distilled notes anchored to the actual document as compression deepens, so wisdom isn't replaced by plausible-but-invented detail; citation-alignment makes every dense claim traceable. **Human-readable:** yes. *Source: arXiv 2502.00977 (Ou & Lapata, ACL 2025 Findings).*

### Knowledge-representation

**Concept-map propositions with weighted cross-links (Novak/Cañas).** Knowledge stored as concept—LABELED linking phrase—concept triples (the "unit of meaning"), hierarchical, anchored by a focus question. **Cross-links** (labeled connections between *different* branches) are the signature feature. **Why potency:** the labeled relation *is* the wisdom ("photosynthesis →requires→ sunlight" encodes the relationship, not co-occurrence); cross-links capture cross-domain integration that bullet lists destroy. Novak & Gowin's rubric scores a synthesizing cross-link **10 pts vs 1 pt** for a plain proposition — an explicit, citable signal of where deep meaning lives. **Human-readable:** yes, as terse labeled-triple prose (NOT ASCII graph art). *Source: IHMC theory paper (Novak & Cañas); Univ. of Waterloo CTE rubric.*

**Context-preserving propositions over lossy triples ("context collapse," PropRAG).** Bare S-P-O triples are a *lossy* compression that silently discards conditionality, provenance, and n-ary relations (e.g. a drug result that holds "only in patients <50 with the KRAS mutation" collapses to "drug showed promise"). **Why potency:** the dropped qualifiers (when/where/under-what-condition/by-whom/with-what-magnitude) ARE the wisdom; a claim shorn of its scope condition is *worse than omission* because it reads as universal. **Critical for telegraphic style:** dropping subordinate/conditional clauses to save tokens is the fastest path to confidently-wrong notes. **Human-readable:** yes, with a qualifier-preserving syntax (e.g. `drug → tumor shrink [ONLY: <50yo + KRAS mut]`). *Source: arXiv 2504.18070 (Wang & Han, EMNLP 2025).*

**Molecular facts — decontextuality + minimality (Gunjal & Durrett).** Fully atomic facts are the *wrong* granularity: stripped too far they become ambiguous and unverifiable. A *molecular* fact adds the minimal context needed to stand alone, optimizing two criteria simultaneously: **decontextuality** (interpretable in isolation) and **minimality** (no redundant scaffolding). **Why potency:** formalizes the smallest unit that is still TRUE and INTERPRETABLE — the precise sweet spot telegraphic notes aim for, preventing over-compression into technically-shorter-but-meaningless lines. **Caveat:** the paper's gain is modest (~74.7% vs 73.4% SAFE vs 68.7% atomic) and scoped to entity-disambiguation in bios — adopt as a *framing* and critic check, not the literal method. **Human-readable:** yes. *Source: arXiv 2406.20079 (Findings of EMNLP 2024).*

**Atomic/decontextualized propositions ("propositionizer," Chen et al.).** Decompose text into propositions meeting three criteria — minimal, unsplittable, self-contained. An expert audit of 408 GPT-4 propositions found only 0.7% unfaithful, 2.9% not minimal, **4.9% not standalone** (the dominant failure). **Why potency:** standalone-ness forces each unit to rehydrate its own referents ("it," "this method"), so meaning isn't silently lost when surrounding text is stripped; the % of faithful/standalone propositions is a quantitative faithfulness handle. **Caveat:** do NOT over-atomize — that destroys the cross-fact synthesis carrying wisdom; borrow the *criteria/audit rubric*, not the granularity or the Wikipedia-tuned model. **Human-readable:** yes. *Source: arXiv 2312.06648 (Chen et al., Dense X Retrieval, EMNLP 2024).*

**Extract–Define–Canonicalize (EDC) — canonicalization + verify-before-merge.** Federated agents independently coin synonyms ("authored/wrote/penned," "model/architecture/network") and restate the same fact across sections. EDC merges near-duplicate relations/entities *after an LLM validity check* into one canonical vocabulary. **Why potency:** states each piece of wisdom *once, consistently*, so cross-references actually resolve — and the **verify-before-merge** step prevents over-generalization (meaning loss from collapsing "correlation" with "causation," or a hedged with an absolute claim). Schema grounding measurably cuts hallucination (ODKE+: −35% hallucinated extractions). **Adaptation:** do NOT build a KG — adopt a running canonical glossary + verify-before-merge as a prompt instruction. **Human-readable:** yes. *Source: arXiv 2404.03868 (Zhang & Soh); 2509.04696 (ODKE+).*

### Faithfulness & evaluation

**FActScore (atomic-fact precision over a source).** Breaks a generation into atomic facts and computes % supported by a reliable source via verification (automated estimator <2% error vs human). **Why potency:** forces every distilled claim to be individually traceable, so compression can't smuggle in invented "wisdom"; atomic granularity catches *partial* meaning-corruption a whole-section pass glosses over. **Critical pairing:** FActScore is **precision-only** — it cannot detect dropped wisdom. Pair with a recall metric. **Adaptation:** verify against the *original section text* (the custom-knowledge-source mode), not Wikipedia; reuse the prompts, skip the retrieval/embedding machinery. **Human-readable:** yes. *Source: arXiv 2305.14251 (Min et al., EMNLP 2023).*

**SAFE-style decompose → decontextualize → verify.** The now-standard long-form factuality pipeline. **Why potency:** the **decontextualize** step is exactly what a telegraphic note needs *in reverse* — it tests whether a terse fragment still carries its full original proposition or has become ambiguous (lost coreferent, dropped qualifier, stranded comparative). **Adaptation:** verify against the in-hand source section, not web search; treat each consolidated line as a decontextualization stress test. **Human-readable:** yes. *Source: arXiv 2403.18802 (Wei et al., NeurIPS 2024); DnDScore arXiv 2412.13175 for the named decontextualization stage.*

**QuestEval — recall + saliency weighting (anti-omission).** Unifies precision (questions from summary, checked on source) AND recall (questions *from source*, checked on summary), plus a learned query-weighter that scores question *saliency*. **Why potency:** recall questions generated from the source detect salient ideas the distillation *dropped*, and saliency weighting ensures you measure loss of the *important* material, not trivia — the exact "did we preserve potency, not just avoid lies" direction. **Adaptation:** the official package is heavyweight and its weighter is documented-broken — reimplement as an LLM-judge (generate N salient source-questions, score importance 1-5, answer each only from the note). **Human-readable:** yes. *Source: arXiv 2103.12693 (Scialom et al., EMNLP 2021).*

**SummaC (sentence-level NLI entailment matrix).** Splits source and summary into sentences, builds a pairwise entailment matrix, aggregates (SOTA 74.4% balanced accuracy). **Why potency:** each distilled line is checked for whether *some* source sentence entails it — a cheap meaning-preservation test; the matrix itself is a readable artifact showing which source sentence backs each line. **Caveats:** ~1-in-4 calls wrong at the operating point (a tripwire, not an oracle); NLI is tuned on news prose and degrades on telegraphic fragments — run on a lightly re-expanded form or calibrate the threshold to catch only egregious misses. **Human-readable:** yes (interpretable matrix). *Source: arXiv 2111.09525 (Laban et al., TACL 2022).*

**BooookScore — 8 coherence-error taxonomy + error-free-unit rate.** An LLM judge checks each sentence against 8 error types: Entity/Event/Causal Omission, Discontinuity, Salience, Language, Inconsistency, Duplication. **Why potency:** a built-in failure-mode checklist — omissions catch wisdom-loss, Salience catches kept trivia, Inconsistency/Duplication catch merge artifacts. **Critical caveat:** BooookScore is **source-free** — it measures *internal* coherence, NOT source fidelity. Split the taxonomy: give the omission checks (reframed as "dropped from SOURCE?") to the source-reading critic, and Discontinuity/Language/Inconsistency/Duplication/Salience to a cheap source-free pass on the merged notes. **Human-readable:** yes. *Source: arXiv 2310.00785 (Chang et al., ICLR 2024).*

**LLMLingua-2 reconstruction test (methodology only).** A token-classification compressor (skip as a stage — it's extractive, machine-facing, can't synthesize). **The transferable asset:** its faithfulness-validation trick — ask a model to *reconstruct* the original from the compressed version and diff for information loss. **Why potency:** a strong, cheap faithfulness probe the completeness critic can adopt to catch dropped wisdom. **Human-readable:** N/A (it's an eval method). *Source: arXiv 2403.12968 (Pan et al., 2024).*

### Human note-taking systems

**Atomicity — one-idea-per-note (Zettelkasten).** Each note holds exactly one self-contained idea, restated *in your own words*, with distinct knowledge-block types (concept, argument, counter-argument, model, hypothesis, empirical observation). Completeness test: nothing removable without breaking the idea, nothing load-bearing missing. **Why potency:** own-words reformulation is the act that produces genuine understanding (not copying); one-idea granularity makes units recombinable like LEGO bricks; the completeness test IS a faithfulness check. **Adaptation:** tag atoms by type for the synthesis agent to recombine across sections; do NOT force one-atom-per-note as a rigid pre-split (atomicity emerges through use). **Human-readable:** yes. *Source: zettelkasten.de (atomicity guide, introduction).*

**Concept-oriented organization + "titles are like APIs" (Matuschak).** Factor notes by *concept*, not by source/section — source-based notes scatter and never accumulate. A precise declarative title acts like an API: a stable handle other notes compose against. **Why potency:** concentrating everything known about a concept into one whole creates "pressure to synthesize," surfacing tensions and distillations visible only when all related ideas sit together — exactly where cross-section wisdom lives. **Caveat:** for a *single* document the cross-source accumulation benefit is weaker; scope the win to cross-*section* synthesis and keep source anchors for traceability. **Human-readable:** yes. *Source: notes.andymatuschak.org (concept-oriented; titles-are-like-APIs).*

**Densely-linked associative network — link-with-a-reason (Evergreen/Zettelkasten).** Each cross-reference carries a one-clause justification of *why* two notes connect. **Why potency:** the link-with-reason is itself distilled wisdom — it encodes the *relationship* between ideas, not just the ideas. **Adaptation:** ADOPT the link-with-reason primitive (`[see §3 — same failure mode under different load]`); SKIP the "associative > hierarchical / grows-with-size / conversation-partner" macro-claim (it needs a persistent growing corpus that a one-shot per-document run doesn't have — keep the hierarchical spine, overlay a thin justified-cross-link layer). **Human-readable:** yes. *Source: notes.andymatuschak.org; zettelkasten.de/introduction.*

**Progressive Summarization — graded layers + own-words L4 (Forte).** L0 source → L1 captured → L2 bold → L3 highlight → L4 own-words executive summary → L5 remix. **Why potency (what transfers):** the L4 own-words restatement step (restating > excerpting forces comprehension) and the graded-density scaffold. **Critical mismatch:** PS is "lossless-by-*retention*" — it keeps L0-L3 alongside the summary. deep-distill *discards* the source, so the dense note is irreducibly lossy — do NOT use this to justify aggressive compression "because nothing is lost." Replace retention with lightweight provenance anchors (each claim carries a section/page pointer). Also reject PS's System-1 "resonance" selection — it conflicts with the adversarial completeness critic. **Human-readable:** yes. *Source: fortelabs.com (Progressive Summarization I & III).*

**Resonance + power-law selectivity (Forte).** Select by resonance (surprising / reframing / goal-relevant) and apply a power law — a tiny fraction holds most insight; over-highlighting dilutes signal. **Why potency:** targets compression effort at the highest-wisdom-density material instead of flattening everything uniformly. **Adaptation:** adopt resonance as a *foregrounding* heuristic and variable compression density (a tunable "selectivity" knob), plus an anti-dilution cap on emphasis — but scope resonance to the *consolidation* stage only (what to foreground / how densely), keeping the completeness critic on a coverage criterion, so the lossy/subjective resonance doesn't fight completeness. Do NOT hardcode Forte's 25/20/5/1% figures. **Human-readable:** yes. *Source: fortelabs.com (Progressive Summarization III).*

**Cornell Method — interrogable cues + own-words summary.** Note zones: telegraphic body, a cue column of questions, a bottom own-words summary. **Why potency:** the cue column converts passive notes into question-answer pairs, encoding the *interrogable* structure of knowledge (what should I be able to answer from this?) and exposing coverage gaps; the own-words summary is a forced synthesis. **Adaptation:** borrow the *mechanisms*, not the 3-zone geometry (literature shows the layout itself is not magic — the win is forced retrieval-orientation + own-words synthesis). Emit per-section interrogable cues (which double as a completeness diagnostic) and a 1-2-sentence own-words micro-summary (an anti-copy comprehension check). **Human-readable:** yes. *Source: subjectguides.york.ac.uk/note-taking/cornell; otter.ai cornell-note-taking-method.*

### Metric / tunable knobs

**Entity-density target as a calibrated tripwire (not a hardcoded 0.15).** Human-preferred news summaries cluster at ~0.15 entities/token; a "Density Score" penalizes distance from the optimum. **Why potency:** turns "dense but readable" into a measurable signal — flags both under-distillation (too sparse, padding survived) and over-stuffing (past readability). **Critical caveats:** 0.15 is for fluent ~67-token news prose; grammar-sacrifice notes mechanically sit higher (likely 0.20-0.30+), so *re-anchor* the band by measuring a handful of hand-written gold telegraphic notes. Compute cheaply (spaCy NER ÷ tokens), frame as one signal among many (Goodhart risk — never a reward to optimize directly). **Human-readable:** yes. *Source: arXiv 2309.04269; towardsdatascience.com LLM-summarization-eval.*

---

## What This Means for deep-distill — prioritized upgrade plan

### Tier 1 — highest leverage, low cost

1. **Make the proposition (not the bullet, not the triple) the atomic compression unit, and forbid dropping qualifiers.** Add an explicit consolidator rule: every retained claim carries its *when / where / for-whom / under-what-condition / by-whom / with-what-magnitude* when the source supplies them. Permit dropping articles/copulas/connectives; **prohibit** dropping conditional operators (only-if, except-when, in-patients-with, post-2020). Provide a compact qualifier-preserving syntax (`drug → tumor shrink [ONLY: <50yo + KRAS mut]`). *(PropRAG "context collapse"; Molecular Facts.)* — **This is the single highest-value "what NOT to do" guardrail for telegraphic compression.**

2. **Add a precision+recall faithfulness gate after the consolidator.**
   - *Precision arm:* decompose each telegraphic section into atomic claims, verify each against the **source section** (FActScore protocol — reuse prompts, skip retrieval); any unsupported atom routes back to the critic. *(FActScore; SAFE decompose→decontextualize→verify.)*
   - *Recall arm:* upgrade the completeness critic to QuestEval-style — generate N salient questions *from the source section*, score each 1-5 for importance, then answer each *only from the note*; unanswerable salient questions = dropped wisdom to reinstate. *(QuestEval principle.)*
   - *Optional cheap tripwire:* SummaC entailment matrix on lightly re-expanded lines to catch egregious unsupported lines. *(SummaC.)*

3. **Bake the 5-way inclusion gate into both the section extractor and the completeness critic.** Flag an item only if Relevant / Specific / Novel / **Faithful (cite a source span)** / **Anywhere (deliberately scan captions, footnotes, mid-section, appendices)**. The Faithful check is the anti-hallucination guard; Anywhere recovers buried wisdom. *(CoD missing-entity criteria.)*

4. **Give the consolidator role-differentiated preservation tiers.** TIER-0 never-compress (thesis, definitions, numbers, conditions, causal mechanisms, named techniques) / TIER-1 moderate / TIER-2 crush-or-drop (examples, restatements, hedging, transitions). Have the critic verify TIER-0 survival as a faithfulness check. *(LLMLingua Budget Controller principle.)*

### Tier 2 — structural upgrades to the merge/synthesis tier

5. **Formalize consolidation as context-aware hierarchical merging.** Replace ad-hoc "merge into one section" with per-section → merge-siblings-upward → recurse, with an explicit per-level budget G_l (looser at leaf sections to preserve detail, tighter at the document synthesis). At **every merge level**, let the agent re-consult original source spans (not just child summaries) and require inline section/source citations — this hardens the stage most prone to drift and counters recursive-merge hallucination/omission. *(Hierarchical merging + context-aware merging.)*

6. **Emit a relationship/cross-link layer.** Alongside the telegraphic prose, require each section to emit concept—LABELED relation—concept propositions under the section's focus question, and mandate ≥N **cross-links** to OTHER sections with a one-clause *why*. Make the document-synthesis agent's primary deliverable these integrative cross-links (weight them ~10x plain facts in self-eval) — they are exactly the cross-section insight the federated split destroys. Render as terse labeled-triple prose, NOT ASCII graph art. *(Concept maps; link-with-a-reason.)*

7. **Add canonicalization + verify-before-merge to the consolidator/synthesis.** Maintain a running canonical glossary (collapse "authored/wrote/penned" → one term document-wide so cross-references resolve), but **never merge two statements unless genuinely the same claim** — preserve hedged-vs-absolute and correlation-vs-causation distinctions. *(EDC.)*

8. **Concept-fold across sections.** Detect recurring concepts across sections and merge their treatments into one accumulated concept-note with a crisp declarative *assertion* title ("Margin requirements rise nonlinearly near expiry," not "Margins") that later sections compose against. Keep per-claim source anchors so traceability survives the reorganization. *(Concept-oriented organization; titles-are-like-APIs.)*

### Tier 3 — register, density, and evaluation polish

9. **Adopt a bounded Chain-of-Density densification loop inside the consolidator.** Generate a sparse draft, then run 2-3 passes that absorb the critic's missing-entity list *without growing the section budget*. Do NOT chase max density; stop when no high-salience misses remain. *(CoD.)*

10. **Set a controlled-telegraphic register with a molecular sizing contract.** Each line must be (a) **decontextual** — standalone-interpretable, every referent/scope/condition present; no dangling pronouns — and (b) **minimal** — no scaffolding beyond what's needed. Add a critic "decontextualization audit" that flags lines whose meaning flips or goes ambiguous when read in isolation. Require own-words restatement (flag high verbatim overlap as extractive leakage). *(Molecular Facts; propositions; Atomicity; Cornell own-words summary.)*

11. **Add Cornell-style interrogable cues + an own-words micro-summary per section.** A terse `Q:` list of the questions the section answers (doubles as a coverage diagnostic for the critic) plus a 1-2-sentence own-words summary (anti-copy comprehension check). *(Cornell Method; Atomicity.)*

12. **Calibrate an entity-density tripwire and a G-Eval final gate.** Compute entities/token per section (cheap NER) against an *empirically re-anchored* band (measure your own gold telegraphic notes — expect ~0.20-0.30+, not 0.15); flag outliers, never optimize toward the number. Score the final synthesis with a G-Eval-style CoT judge on Faithfulness / Wisdom-Coverage / Self-containment / Conciseness, judging against the **source** and using a different model family to blunt self-preference bias. *(Entity-density knob; G-Eval; LLMLingua-2 reconstruction test as an optional faithfulness probe.)*

### Apply selectivity throughout
Layer Forte's **resonance + power-law selectivity** over the consolidator: rank claims by resonance (surprising / reframing / load-bearing), allocate density accordingly, and cap emphasis (anti-dilution: if >~30% of a section is marked critical, force re-ranking) — but scope this to *foregrounding*, leaving the completeness critic on a strict coverage criterion so subjective resonance never overrides completeness. *(Resonance + power-law.)*

---

## Key Sources

**LLM prompting / architecture**
- Chain-of-Density: https://arxiv.org/abs/2309.04269 · https://learnprompting.org/docs/advanced/self_criticism/chain-of-density
- LLMLingua (Budget Controller, coarse-to-fine): https://arxiv.org/abs/2310.05736
- LLMLingua-2 (reconstruction test): https://arxiv.org/abs/2403.12968
- Hierarchical merging / BooookScore: https://arxiv.org/abs/2310.00785
- Context-aware hierarchical merging: https://arxiv.org/abs/2502.00977
- G-Eval: https://arxiv.org/abs/2303.16634

**Knowledge representation**
- Concept maps (Novak & Cañas): https://cmap.ihmc.us/publications/researchpapers/theoryunderlyingconceptmaps.pdf · rubric: https://uwaterloo.ca/centre-for-teaching-excellence/catalogs/tip-sheets/rubric-assessing-concept-maps
- PropRAG / "context collapse": https://arxiv.org/abs/2504.18070
- Molecular Facts (Gunjal & Durrett): https://arxiv.org/abs/2406.20079
- Propositions / Dense X Retrieval (Chen et al.): https://arxiv.org/abs/2312.06648
- Extract–Define–Canonicalize: https://arxiv.org/abs/2404.03868 · ODKE+: https://arxiv.org/abs/2509.04696

**Faithfulness & evaluation**
- FActScore: https://arxiv.org/abs/2305.14251 · code: https://github.com/shmsw25/factscore
- SAFE (long-form factuality): https://arxiv.org/abs/2403.18802 · DnDScore: https://arxiv.org/abs/2412.13175
- QuestEval: https://aclanthology.org/2021.emnlp-main.529/
- SummaC: https://arxiv.org/abs/2111.09525 · code: https://github.com/tingofurro/summac
- Entity-density / Density Score: https://towardsdatascience.com/how-to-evaluate-llm-summarization-18a040c3905d/

**Human note-taking systems**
- Zettelkasten atomicity: https://zettelkasten.de/atomicity/guide/ · https://zettelkasten.de/introduction/
- Concept-oriented notes / titles-as-APIs: https://notes.andymatuschak.org/Evergreen_notes_should_be_concept-oriented · https://notes.andymatuschak.org/Evergreen_note_titles_are_like_APIs
- Associative ontologies: https://notes.andymatuschak.org/Prefer_associative_ontologies_to_hierarchical_taxonomies
- Progressive Summarization: https://fortelabs.com/blog/progressive-summarization-a-practical-technique-for-designing-discoverable-notes/ · https://fortelabs.com/blog/progressive-summarization-iii-guidelines-and-principles/
- Cornell Method: https://subjectguides.york.ac.uk/note-taking/cornell
