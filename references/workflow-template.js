// deep-distill — federated extraction workflow (SOTA-upgraded).
//
// Run with the Workflow tool, passing the staged manifest as `args`:
//   Workflow({ scriptPath: ".../references/workflow-template.js",
//              args: { title, density, sections: [ {id,title,text_file,figures,chars}, ... ] } })
//
// args.sections : array from manifest.json (text_file + figures are ABSOLUTE paths)
// args.density  : "telegraphic" (default) | "readable"
// args.title    : document title
//
// Pipeline per section (pipelined — no barrier between stages):
//   1. Extract     : text agent (5-way inclusion gate) + vision agents (figures), in parallel
//   2. Consolidate : completeness-first merge -> telegraphic draft w/ preservation tiers,
//                    qualifier preservation, molecular sizing, Q-cues, intra-section links
//                    (density comes from cutting filler/fusing redundancy, NEVER from dropping content)
//   3. Verify      : precision+recall FAITHFULNESS GATE on the draft vs the source
//   4. Finalize    : apply the gate's corrections (only if any) -> final section
// Then a document-level synthesizer does context-aware merging with cross-section links.
//
// The technique choices (Chain-of-Density, FActScore/SAFE precision, QuestEval recall,
// PropRAG context-collapse, Molecular Facts, LLMLingua preservation tiers, concept-map
// cross-links, G-Eval self-check) are documented and cited in references/techniques.md.
//
// Returns { title, synthesis, sections: [ {id, title, final}, ... ] } -> feed to assemble.py.

export const meta = {
  name: 'deep-distill',
  description: 'Federated distillation: extract (inclusion gate) + figures -> Chain-of-Density consolidate -> faithfulness gate -> finalize -> cross-linked synthesis',
  phases: [
    { title: 'Extract', detail: 'text digest (5-way gate) + diagram explanation, parallel' },
    { title: 'Consolidate', detail: 'completeness-first merge, preservation tiers, molecular sizing' },
    { title: 'Verify', detail: 'precision+recall faithfulness gate vs source' },
    { title: 'Finalize', detail: 'apply corrections (only if the gate found any)' },
    { title: 'Synthesize', detail: 'context-aware merge, cross-section links, concept-fold' },
  ],
}

const A = args || {}
const SECTIONS = A.sections || []
const DENSITY = (A.density || 'telegraphic').toLowerCase()
const DOCTITLE = A.title || 'Document'

// ---- shared, research-backed rule blocks (kept DRY across stage prompts) -----------------

// Preservation tiers (LLMLingua Budget Controller principle) — spend compression on redundancy,
// never on load-bearing meaning.
const TIERS =
  `PRESERVATION TIERS — TIER-0 (NEVER compress or drop): thesis/claims, definitions, numbers & ` +
  `quantities, conditions/qualifiers, causal mechanisms, named methods/techniques, formulas ` +
  `(verbatim), code/function names + key params. TIER-1 (compress moderately): supporting reasoning, ` +
  `secondary qualifications. TIER-2 (crush or drop): worked examples, restatement, hedging, ` +
  `transitions, anecdote.`

// Qualifier preservation (PropRAG "context collapse"; Molecular Facts) — the single biggest
// guardrail: the qualifiers ARE the wisdom.
const QUALIFIER =
  `QUALIFIER RULE (anti context-collapse): keep every when / where / for-whom / under-what-condition / ` +
  `by-whom / magnitude the source supplies. You MAY drop articles, copulas, connectives. You MUST NOT ` +
  `drop conditional operators (only-if, except-when, in-patients-with, post-2020, n=..). Compact syntax ` +
  `is fine: "X -> Y [when Z]", "claim [ONLY: cond1 + cond2]".`

// Molecular sizing (Molecular Facts; propositions) — minimal but self-contained.
const MOLECULAR =
  `MOLECULAR SIZING: each line is (a) DECONTEXTUAL — standalone-interpretable, no dangling pronouns, ` +
  `scope/condition present; and (b) MINIMAL — no scaffolding beyond what's needed. Prefer your own words ` +
  `over copying source verbatim (except formulas/terms).`

// 5-way inclusion gate (Chain-of-Density missing-entity criteria).
const INCLUSION =
  `INCLUSION GATE — keep an item iff: Relevant (to the section's thesis) + Specific (concrete/named, ` +
  `not vague) + Novel (not already captured) + Faithful (locatable in the source) + from Anywhere ` +
  `(deliberately scan captions, footnotes, tables, mid-section, appendices — not just the opening).`

const STYLE_TELEGRAPHIC =
  `STYLE = grammar-sacrifice / telegraphic / maximally compressed. Symbols ok: -> = + / vs w/ ~ ^ >= <= ` +
  `Σ ∏ √ ∈ ∴ ⇒. Density > prose but must stay unambiguous to an expert. No "in this section" filler.\n` +
  `${TIERS}\n${QUALIFIER}\n${MOLECULAR}`

const STYLE_READABLE =
  `STYLE = compact but readable prose + bullets; plain sentences, no filler.\n${TIERS}\n${QUALIFIER}\n` +
  `MOLECULAR SIZING: each point self-contained and minimal; own words.`

const STYLE = DENSITY === 'readable' ? STYLE_READABLE : STYLE_TELEGRAPHIC

function chunk(a, n) { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }

if (!SECTIONS.length) {
  log('No sections in args — pass manifest.sections as args.sections.')
  return { title: DOCTITLE, synthesis: '(no sections)', sections: [] }
}
log(`Distilling "${DOCTITLE}" — ${SECTIONS.length} sections, ` +
    `${SECTIONS.reduce((n, s) => n + (s.figures ? s.figures.length : 0), 0)} figures, density=${DENSITY}`)

const results = await pipeline(
  SECTIONS,

  // ---- STAGE 1: extract digest (inclusion gate) + explain diagrams (parallel) -------------
  async (sec) => {
    const figs = sec.figures || []
    const tasks = []
    tasks.push(() => agent(
      `Extract ALL wisdom from section "${sec.title}" of "${DOCTITLE}".\n` +
      `Read the full section text with the Read tool: ${sec.text_file}\n\n` +
      `${INCLUSION}\n\n${STYLE}\n\n` +
      `Emit dense PROPOSITIONS (atomic, standalone claims) organized by the section's own sub-structure. ` +
      `Capture: motivation/problem, every method + formula, every named code/function (name + purpose + ` +
      `params), every parameter default/threshold/number, every table's numeric results, and every ` +
      `caveat/warning/author-opinion. Do NOT describe figures (separate pass). Output markdown bullets only.`,
      { label: `extract:${sec.id}`, phase: 'Extract' }
    ))
    for (const grp of chunk(figs, 5)) {
      const paths = grp.join('\n')
      tasks.push(() => agent(
        `Explain the figures/diagrams in these image files from section "${sec.title}" of "${DOCTITLE}".\n` +
        `Read EACH image with the Read tool:\n${paths}\n` +
        `For caption/context you may also Read: ${sec.text_file}\n\n` +
        `For EACH figure (identify by number/caption): (a) what it plots = axes + series + what varies; ` +
        `(b) the visual shape/pattern actually visible; (c) the takeaway the author wants; (d) why it ` +
        `matters / actionable implication. ${STYLE}\n` +
        `CRITICAL — NO FABRICATION: report ONLY values/labels you can actually read in the image. If axis ` +
        `numbers, dates, or levels are not clearly legible, do NOT guess them — describe the shape/trend ` +
        `qualitatively and say the exact values aren't legible. Hedge any value you do read as "≈ <val> ` +
        `(from chart)". Never present a figure-derived number as if the text stated it.\n` +
        `If an image is purely a code listing or numeric table (not a plot), note "code/table -> see text". ` +
        `Output markdown, one block per figure.`,
        { label: `figs:${sec.id}`, phase: 'Extract' }
      ))
    }
    const out = await parallel(tasks)
    return {
      sec,
      digest: out[0] || '(extract failed)',
      diagrams: out.slice(1).filter(Boolean).join('\n\n') || '(no figures)',
    }
  },

  // ---- STAGE 2: completeness-first consolidation -> draft (density via filler-cut, never content-cut) ---
  async (r) => {
    const hasFigs = (r.sec.figures || []).length > 0
    const draft = await agent(
      `Consolidate section "${r.sec.title}" of "${DOCTITLE}" into ONE dense reference section.\n\n` +
      `--- EXTRACTED PROPOSITIONS ---\n${r.digest}\n\n--- FIGURE EXPLANATIONS ---\n${r.diagrams}\n--- END ---\n\n` +
      `${STYLE}\n\n` +
      `METHOD — completeness-first densification: (1) draft from the propositions; (2) make it DENSE by ` +
      `cutting filler, fusing redundancy, and telegraphing phrasing — NOT by dropping content. COMPLETENESS ` +
      `IS NON-NEGOTIABLE: never omit a TIER-0 item, a figure, a subsection, a named code/snippet, an ` +
      `exercise, or a numeric parameter to save space. There is NO length budget — the section is exactly as ` +
      `long as completeness requires. Apply the preservation tiers + qualifier rule strictly; de-duplicate.\n` +
      `COVERAGE CHECK before finishing: every subsection, figure, named code/snippet, parameter, and exercise ` +
      `present in the inputs must appear in your output.\n` +
      `SELECTIVITY (foregrounding only, never omission): surface the high-resonance claims (surprising / ` +
      `reframing / load-bearing) first; compress lower-value material harder, but still keep it.\n\n` +
      `Output EXACTLY this markdown structure:\n` +
      `## ${r.sec.title}\n` +
      `**Core idea:** <one own-words line>\n` +
      `**Q:** <3-5 terse questions this section answers — a coverage self-test>\n` +
      `<### subsections with dense proposition bullets — every formula/code-name/param/number/caveat/qualifier preserved>\n` +
      (hasFigs ? `### Figures\n<one tight block per figure: what it shows + the takeaway>\n` : ``) +
      `### Links\n<2-5 concept —LABELED relation— concept propositions capturing this section's key ` +
      `relationships, e.g. "proof-of-work —secures→ ledger [by: making rewrites cost CPU]". Use real ` +
      `labeled verbs, never bare association. No ASCII graph art.>\n\n` +
      `NO PROCESS COMMENTARY: output only distilled content about the subject — never narrate your process, ` +
      `figure page numbers, or label/correction notes.\nOutput only the markdown section.`,
      { label: `consol:${r.sec.id}`, phase: 'Consolidate' }
    )
    return { sec: r.sec, draft: draft || `## ${r.sec.title}\n(consolidation failed)` }
  },

  // ---- STAGE 3: precision + recall faithfulness gate (vs the source) ----------------------
  async (r) => {
    const gate = await agent(
      `FAITHFULNESS GATE for the distilled section "${r.sec.title}" of "${DOCTITLE}".\n` +
      `Read the FULL source with the Read tool: ${r.sec.text_file}\n\n` +
      `--- DISTILLED DRAFT ---\n${r.draft}\n--- END DRAFT ---\n\n` +
      `Run these checks against the source, default to suspicion:\n` +
      `1. PRECISION (FActScore/SAFE): decompose the draft into atomic claims; list every claim that is ` +
      `NOT supported by the source, or that distorts it (overstated, wrong number, correlation stated as ` +
      `causation).\n` +
      `2. RECALL / COVERAGE (QuestEval): generate the salient questions the SOURCE answers; for each, try to ` +
      `answer using ONLY the draft — list every one the draft can't answer. ALSO verify every source ` +
      `subsection, figure, named code/snippet, numeric parameter, and exercise is represented; list any dropped.\n` +
      `3. CONTEXT-COLLAPSE: for each compressed claim, check the source for a dropped conditional ` +
      `(when/where/population/magnitude/only-if). List collapses.\n` +
      `4. TIER-0 SURVIVAL: confirm no thesis, definition, key number, condition, causal mechanism, named ` +
      `technique, or formula was lost. List any missing.\n` +
      `5. DECONTEXTUALIZATION: flag any draft line whose meaning flips or is ambiguous read in isolation.\n` +
      `6. FIGURE FABRICATION + LEAKAGE: flag any specific number/date/level attributed to a figure that is NOT ` +
      `in the source text and NOT hedged as a chart-reading ("≈ … from chart") — a fabrication risk to hedge ` +
      `or cut. Also flag any process commentary or figure page-label notes that leaked into the draft.\n\n` +
      `${STYLE}\n` +
      `Output ONLY the concrete corrections/additions as terse bullets grouped by check. If the draft passes ` +
      `all six with nothing material to fix, output exactly: PASS.`,
      { label: `gate:${r.sec.id}`, phase: 'Verify' }
    )
    return { sec: r.sec, draft: r.draft, gate: (gate || 'PASS').trim() }
  },

  // ---- STAGE 4: finalize — apply corrections only if the gate found any -------------------
  async (r) => {
    const clean = /^pass\b/i.test(r.gate) || r.gate.length < 12
    if (clean) {
      return { id: r.sec.id, title: r.sec.title, final: r.draft }
    }
    const final = await agent(
      `Produce the corrected final of the distilled section "${r.sec.title}" of "${DOCTITLE}" by applying ` +
      `EVERY correction from the gate. Specifically: REINSTATE every dropped item it lists (subsection, ` +
      `figure, code/snippet, parameter, exercise); FIX every unsupported/distorted claim; HEDGE or CUT every ` +
      `fabricated figure value; RESTORE every collapsed qualifier; remove any leaked process commentary. ` +
      `Completeness takes priority over brevity — grow the section as needed; do not drop anything already ` +
      `correct. Keep the same format and dense style.\n\n` +
      `--- DRAFT ---\n${r.draft}\n\n--- CORRECTIONS (from the faithfulness gate) ---\n${r.gate}\n--- END ---\n\n` +
      `${STYLE}\n\nOutput only the corrected markdown section — no process notes.`,
      { label: `final:${r.sec.id}`, phase: 'Finalize' }
    )
    return { id: r.sec.id, title: r.sec.title, final: final || r.draft }
  }
)

const ordered = results.filter(Boolean).sort((a, b) => a.id.localeCompare(b.id))

// ---- STAGE 5: context-aware document synthesis with cross-section links -------------------
phase('Synthesize')
const allFinals = ordered.map(c => `<<SECTION ${c.id}: ${c.title}>>\n${c.final}`).join('\n\n---\n\n')
const synthesis = await agent(
  `You have the verified, distilled per-section notes of the ENTIRE document "${DOCTITLE}" (each tagged with ` +
  `its section id). Write the connective tissue a reader needs to USE this as a system.\n\n${allFinals}\n\n` +
  `${STYLE}\n\n` +
  `Treat the sections as EVIDENCE: when you assert something, cite the section id(s) it comes from, and do ` +
  `not introduce claims absent from them. Where the same concept recurs across sections, CONCEPT-FOLD it into ` +
  `one accumulated note with an assertion-style title (a claim, not a topic). Maintain a canonical vocabulary ` +
  `(collapse synonyms) but never merge two genuinely distinct claims (keep hedged-vs-absolute, ` +
  `correlation-vs-causation distinct).\n\n` +
  `Produce, as markdown:\n` +
  `# ${DOCTITLE} — Synthesis\n` +
  `## Core Theses — the author's central arguments / worldview.\n` +
  `## How It Fits Together — the end-to-end method or argument flow, section -> step, WITH the dependency/why.\n` +
  `## Cross-Section Links — the HIGHEST-VALUE output: integrative concept —relation— concept links BETWEEN ` +
  `different sections, each with a one-clause why. These capture the cross-section insight the federated split ` +
  `would otherwise lose; spend real effort here.\n` +
  `## Cross-Cutting Themes & Pitfalls — recurring ideas + mistakes the author warns against + the defense for each.\n` +
  `## Key Formulas / Results Index — one line each w/ section ref (omit if not technical).\n` +
  `## Code / Tool Index — name -> purpose -> section (omit if none).\n` +
  `## If You Remember N Things — the highest-leverage takeaways.\n\n` +
  `Before finalizing, self-check (G-Eval style) against the sections on Faithfulness (no unsupported claim), ` +
  `Wisdom-Coverage (key insights present), Self-containment, Conciseness — and fix any gap. Output only the markdown.`,
  { label: 'synthesis', phase: 'Synthesize' }
)

return { title: DOCTITLE, synthesis, sections: ordered }
