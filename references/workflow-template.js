// deep-distill — federated extraction workflow.
//
// Modes:
//   human   (default): v4 verbatim-fidelity core + additive wins. Produces a dense study reference.
//   machine          : token-minimized ASCII prompt artifact with blind directive-recovery verification.
//
// Run with the Workflow tool, passing the staged manifest as `args`:
//   Workflow({ scriptPath: ".../references/workflow-template.js",
//              args: { mode, title, density, sections: [ {id,title,text_file,figures,chars}, ... ] } })
//
// args.sections : array from manifest.json (text_file + figures are ABSOLUTE paths)
// args.mode     : "human" (default) | "machine"
// args.density  : human mode only: "telegraphic" (default) | "readable"
// args.title    : document title
//
// Pipeline per section (pipelined — no barrier between stages):
//   1. Extract     : text agent (5-way inclusion gate, verbatim artifacts) + vision agents (figures), parallel
//   2. Consolidate : faithful lossless merge -> telegraphic draft; density via PROSE filler-cut only,
//                    code/formulas/examples/exercises kept VERBATIM and in full; Q-cues, intra-section links
//   3. Verify      : faithfulness gate vs source — precision, recall/coverage, literal-artifact fidelity
//   4. Finalize    : reinstate dropped + restore verbatim artifacts + fix (only if the gate found anything)
// Then a document-level synthesizer does context-aware merging with cross-section links.
//
// Method history (see references/techniques.md + EVALUATION.md): the full "SOTA stack" (v2) and a
// completeness-first retune (v3) each LOST a blind A/B to the simpler original (v1), because Chain-of-Density's
// fixed length dropped content and "own-words" paraphrase silently rewrote code/formulas. v4 keeps the original's
// winning behavior — VERBATIM literal artifacts, keep everything, flag (don't fix) source typos — and layers on
// only the additions that independently helped: figure anti-fabrication, cross-section links, Q-cues.
//
// Human returns { title, synthesis, sections: [ {id, title, final}, ... ] } -> assemble.py.
// Machine returns { title, mode:"machine", status, artifact, verification, sections } -> assemble.py --mode machine.

export const meta = {
  name: 'deep-distill',
  description: 'Federated distillation with human and machine modes: human = dense faithful study reference; machine = token-minimized ASCII prompt artifact with blind directive-recovery verification',
  phases: [
    { title: 'Mode', detail: 'dispatch to human reference or machine prompt compression' },
    { title: 'Extract', detail: 'text digest (verbatim artifacts, 5-way gate) + diagram explanation, parallel' },
    { title: 'Consolidate', detail: 'faithful lossless merge; prose-only compression; verbatim code/formulas' },
    { title: 'Verify', detail: 'faithfulness gate: precision + recall/coverage + literal fidelity vs source' },
    { title: 'Finalize', detail: 'reinstate dropped + restore verbatim (only if the gate found any)' },
    { title: 'Synthesize', detail: 'context-aware merge, cross-section links, concept-fold' },
    { title: 'Machine Certify', detail: 'inventory directives -> compress ASCII -> blind reconstruct -> artifact-aware judge -> patch' },
  ],
}

const A = args || {}
const SECTIONS = A.sections || []
const RAW_MODE = (A.mode || A.distill_mode || A.distillMode || 'human').toLowerCase()
const MODE = ['machine', 'minify', 'prompt', 'llm'].includes(RAW_MODE) ? 'machine' : 'human'
const DENSITY = (A.density || 'telegraphic').toLowerCase()
const DOCTITLE = A.title || 'Document'

// ---- shared, research-backed rule blocks (kept DRY across stage prompts) -----------------

// Preservation tiers (LLMLingua Budget Controller principle) — spend compression on redundant PROSE only.
// NOTE: worked examples + exercises are TIER-0 here. An earlier version put "worked examples" in the
// drop-tier, which authorized exactly the omissions a blind A/B then penalized. Never again.
const TIERS =
  `PRESERVATION TIERS — TIER-0 (NEVER compress or drop): thesis/claims, definitions, numbers & quantities, ` +
  `conditions/qualifiers, causal mechanisms, named methods/techniques, formulas (verbatim), code/snippets ` +
  `(verbatim, name + params), and every worked example or exercise that demonstrates the method. ` +
  `TIER-1 (compress but KEEP): supporting reasoning, secondary qualifications, the prose wrapping examples. ` +
  `TIER-2 (crush or drop — PROSE ONLY): redundant restatement, hedging, transitions, throat-clearing, ` +
  `marketing/anecdote. NEVER place a code line, formula, number, worked example, or exercise in TIER-2.`

// Qualifier preservation (PropRAG "context collapse"; Molecular Facts) — the qualifiers ARE the wisdom.
const QUALIFIER =
  `QUALIFIER RULE (anti context-collapse): keep every when / where / for-whom / under-what-condition / ` +
  `by-whom / magnitude the source supplies. You MAY drop articles, copulas, connectives. You MUST NOT ` +
  `drop conditional operators (only-if, except-when, in-patients-with, post-2020, n=..). Compact syntax ` +
  `is fine: "X -> Y [when Z]", "claim [ONLY: cond1 + cond2]".`

// Fidelity (Molecular Facts for sizing; the decisive A/B finding for verbatim artifacts).
const FIDELITY =
  `SIZING & FIDELITY: each line is DECONTEXTUAL (standalone-readable, no dangling pronouns, scope/condition ` +
  `present) and MINIMAL (no scaffolding). VERBATIM LITERAL ARTIFACTS: reproduce code, formulas, equations, and ` +
  `printed symbols EXACTLY as the source prints them — never paraphrase, normalize, or silently "correct" them. ` +
  `If the source has a bug/typo (undefined var, wrong symbol/operator, missing term, Python-2 syntax), ` +
  `transcribe it AND flag "[sic: source prints X; intended Y]". Use your own words ONLY for prose explanation — ` +
  `never for code, formulas, or quoted text.`

// 5-way inclusion gate (Chain-of-Density missing-entity criteria — kept; the gate, not the fixed length).
const INCLUSION =
  `INCLUSION GATE — keep an item iff: Relevant (to the section's thesis) + Specific (concrete/named, ` +
  `not vague) + Novel (not already captured) + Faithful (locatable in the source) + from Anywhere ` +
  `(deliberately scan captions, footnotes, tables, mid-section, appendices — not just the opening).`

const STYLE_TELEGRAPHIC =
  `STYLE = grammar-sacrifice / telegraphic / maximally compressed PROSE. Symbols ok: -> = + / vs w/ ~ ^ >= <= ` +
  `Σ ∏ √ ∈ ∴ ⇒. Density > prose but must stay unambiguous to an expert. No "in this section" filler.\n` +
  `${TIERS}\n${QUALIFIER}\n${FIDELITY}`

const STYLE_READABLE =
  `STYLE = compact but readable prose + bullets; plain sentences, no filler.\n${TIERS}\n${QUALIFIER}\n${FIDELITY}`

const STYLE = DENSITY === 'readable' ? STYLE_READABLE : STYLE_TELEGRAPHIC

function chunk(a, n) { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }

// ---- machine-mode rule blocks ---------------------------------------------------------

const NO_SIDE_EFFECTS =
  `Return your answer as the tool result ONLY. Do NOT write files. Do NOT run shell commands. ` +
  `Do NOT run git. Do NOT create scratch artifacts.`

const TOKEN_RULES =
  `TOKENIZER FACTS: token cost is measured, never guessed. Common English words often cost about one ` +
  `token, and leading spaces often merge. Rare Unicode glyphs such as ∈, ¬, ∧, ∴, ⇒, Σ, ∏, √, and ` +
  `non-ASCII arrows often cost multiple tokens and are BANNED in machine mode. Use ASCII only. The ` +
  `reliable compression lever is deleting filler, fusing duplicates, and shortening labels without ` +
  `dropping directives, negations, conditions, thresholds, carve-outs, or literal specifics.`

const MACHINE_STYLE =
  `STYLE = machine-only telegraphic ASCII for LLM prompt replacement, maximum token density. ` +
  `The artifact may be terse and non-prose, but it must be unambiguously decodable by an LLM with NO ` +
  `decoder key, legend, or hidden original. Drop rationale, examples that only justify a rule, articles, ` +
  `copulas, repeated headings, and friendly wording. Preserve every operative directive, condition, ` +
  `exception, threshold, priority, prohibition, permission, role boundary, and verbatim literal specific. ` +
  `Never delete negation or scope words: not, never, only, unless, except, before, after, even-if-asked, ` +
  `>=, <=, exactly, at least, at most.\n${TOKEN_RULES}\n${TIERS}\n${QUALIFIER}\n${FIDELITY}`

const INVENTORY_SCHEMA = {
  type: 'object',
  properties: {
    directives: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          text: { type: 'string' },
          kind: { type: 'string' },
          literal_specifics: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'text'],
      },
    },
  },
  required: ['directives'],
}

const ARTIFACT_SCHEMA = {
  type: 'object',
  properties: {
    artifact: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['artifact'],
}

const RECON_SCHEMA = {
  type: 'object',
  properties: {
    directives: { type: 'array', items: { type: 'string' } },
    reconstruction: { type: 'string' },
  },
  required: ['directives'],
}

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string' },
    total_count: { type: 'integer' },
    recovered_count: { type: 'integer' },
    missing: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          canonical: { type: 'string' },
          issue: { type: 'string' },
          compact_fix: { type: 'string' },
        },
        required: ['id', 'canonical', 'issue'],
      },
    },
    ascii_ok: { type: 'boolean' },
    overcompressed: { type: 'array', items: { type: 'string' } },
  },
  required: ['missing'],
}

function asciiOnly(s) {
  return Array.from(s || '').every(ch => ch.charCodeAt(0) < 128)
}

function artifactOf(x) {
  if (!x) return ''
  if (typeof x === 'string') return x
  return x.artifact || x.compressed || x.minified || x.final || ''
}

function boundedInt(value, fallback, lo, hi) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(lo, Math.min(Math.floor(n), hi))
}

function machineDirectiveLines(rows) {
  const out = []
  for (const row of rows) {
    const sid = row.sec.id
    const title = row.sec.title
    out.push(`## ${sid} ${title}`)
    let i = 0
    for (const d of row.directives || []) {
      i += 1
      const id = d.id || `${sid}.${i}`
      out.push(`- [${id}] ${d.text}`)
      if (d.literal_specifics && d.literal_specifics.length) {
        out.push(`  literals: ${d.literal_specifics.join(' | ')}`)
      }
    }
  }
  return out.join('\n')
}

async function verifyMachineCandidate(candidate, inventoryText, totalCount, label) {
  const artifact = artifactOf(candidate).trim()
  const readerProfiles = [
    'strict small-model reader: reconstruct only what is clearly recoverable',
    'obedience-oriented system-prompt reader: expand terse rules into plain directives',
    'skeptical reviewer: look for hidden lost conditions, negations, exceptions, thresholds',
  ]
  const reconTasks = readerProfiles.map((profile, idx) => () => agent(
    `You are a blind reconstruction reader. You receive ONLY this compressed machine artifact, with no ` +
    `source, no decoder key, and no author notes. Reconstruct the operative directive set in plain English. ` +
    `Split compounds: each rule, condition, threshold, exception, carve-out, prohibition, permission, and ` +
    `literal specific should be separate if it would need separate compliance. If a directive is ambiguous, ` +
    `say the ambiguity instead of guessing.\n\n${NO_SIDE_EFFECTS}\n\n` +
    `--- COMPRESSED ARTIFACT ---\n${artifact}\n--- END ---`,
    { schema: RECON_SCHEMA, label: `recon:${label}:${idx + 1}`, phase: 'Machine Certify' }
  ))
  const recon = await parallel(reconTasks)
  const reconText = recon.map((r, i) => {
    if (!r) return `## reader ${i + 1}\n(no reconstruction)`
    const dirs = Array.isArray(r.directives) ? r.directives.map(x => `- ${x}`).join('\n') : ''
    return `## reader ${i + 1}\n${dirs || r.reconstruction || JSON.stringify(r)}`
  }).join('\n\n')

  const judge = await agent(
    `You are the artifact-aware fidelity judge for machine-mode deep-distill. The compressed artifact is ` +
    `intended to replace the source as operative instructions for an LLM.\n\n` +
    `Canonical checklist (${totalCount} directives) extracted from the source:\n${inventoryText}\n\n` +
    `Compressed artifact:\n${artifact}\n\n` +
    `Blind reconstructions from readers who saw ONLY the artifact:\n${reconText}\n\n` +
    `Judge each canonical directive against BOTH the artifact text itself and the reconstructions. Mark a ` +
    `directive MISSING only if it is genuinely absent, weakened, scope-collapsed, contradictory, or garbled ` +
    `in the artifact. Do NOT mark missing merely because one reader folded it into a neighboring directive. ` +
    `Be especially suspicious of lost negations, only/unless/except/even-if-asked clauses, thresholds, file ` +
    `paths, exact strings, priorities, and role/account/security boundaries. Also check ASCII-only.\n\n` +
    `Return recovered_count, total_count, missing[], ascii_ok, and any overcompressed/ambiguous fragments. ` +
    `If there are no gaps, missing must be [] and status should be "certified".\n\n${NO_SIDE_EFFECTS}`,
    { schema: VERIFY_SCHEMA, label: `judge:${label}`, phase: 'Machine Certify' }
  )
  const missing = Array.isArray(judge && judge.missing) ? judge.missing : []
  return {
    artifact,
    reconstructions: recon,
    verification: {
      status: missing.length === 0 && asciiOnly(artifact) ? 'certified' : 'needs_patch',
      total_count: totalCount,
      recovered_count: Math.max(0, totalCount - missing.length),
      missing,
      ascii_ok: asciiOnly(artifact),
      overcompressed: (judge && judge.overcompressed) || [],
    },
  }
}

async function runMachine() {
  phase('Inventory')
  log(`Machine-compressing "${DOCTITLE}" — ${SECTIONS.length} sections`)

  const inventoryRaw = await parallel(SECTIONS.map(sec => () => agent(
    `Inventory EVERY operative directive in section "${sec.title}" of "${DOCTITLE}".\n` +
    `Read the full section text with the Read tool: ${sec.text_file}\n\n` +
    `${INCLUSION}\n\n` +
    `Extract atomic directives, not prose summary. Split compounds so each rule, condition, threshold, ` +
    `exception, carve-out, prohibition, permission, priority, and literal specific is separately checkable. ` +
    `Preserve every exact file path, command, variable, marker, section name, number, and quoted string. ` +
    `Do not compress yet; this is the canonical checklist the minified artifact must recover.\n\n` +
    `${NO_SIDE_EFFECTS}`,
    { schema: INVENTORY_SCHEMA, label: `inventory:${sec.id}`, phase: 'Inventory' }
  )))

  const inventories = inventoryRaw.map((inv, i) => ({
    sec: SECTIONS[i],
    directives: Array.isArray(inv && inv.directives) ? inv.directives : [],
  }))
  const inventoryText = machineDirectiveLines(inventories)
  const totalCount = inventories.reduce((n, row) => n + row.directives.length, 0)

  phase('Compress')
  const sectionArtifacts = await parallel(inventories.map(row => () => agent(
    `Compress section "${row.sec.title}" of "${DOCTITLE}" for MACHINE MODE.\n` +
    `Read the source section with the Read tool: ${row.sec.text_file}\n\n` +
    `Section directive checklist:\n${machineDirectiveLines([row])}\n\n` +
    `${MACHINE_STYLE}\n\n` +
    `Produce the shortest ASCII artifact block for this section that preserves every checklist item. ` +
    `Prefer stable short headings/codes from the source. Fuse duplicate rules only when the fused line still ` +
    `preserves every condition and carve-out. No Markdown flourish. No rationale. No certificate.\n\n` +
    `${NO_SIDE_EFFECTS}`,
    { schema: ARTIFACT_SCHEMA, label: `compress-sec:${row.sec.id}`, phase: 'Compress' }
  )))

  const sectionText = sectionArtifacts.map((a, i) =>
    `## ${SECTIONS[i].id} ${SECTIONS[i].title}\n${artifactOf(a).trim()}`
  ).join('\n\n')
  const levels = [
    { key: 'safe', instruction: 'Conservative: keep more words if needed; zero directive risk beats size.' },
    { key: 'balanced', instruction: 'Balanced: delete filler aggressively while keeping natural decodability.' },
    { key: 'max', instruction: 'Maximum: shortest artifact you believe survives blind reconstruction.' },
  ]
  const maxCandidates = boundedInt(A.machine_candidates, 3, 1, levels.length)
  const candidates = await parallel(levels.slice(0, maxCandidates).map(level => () => agent(
    `Fuse these section-level machine artifacts into ONE complete prompt-replacement artifact for ` +
    `"${DOCTITLE}".\n\n` +
    `Canonical checklist (${totalCount} directives):\n${inventoryText}\n\n` +
    `Section artifacts:\n${sectionText}\n\n` +
    `${MACHINE_STYLE}\n\n${level.instruction}\n` +
    `Global compression rules: delete duplicated headings/rationale, canonicalize repeated terms, fuse duplicate ` +
    `directives, preserve all qualifiers/literals. The artifact must stand alone: no source required, no decoder ` +
    `key, no comments about the process, no certificate. ASCII only.\n\n${NO_SIDE_EFFECTS}`,
    { schema: ARTIFACT_SCHEMA, label: `compress:${level.key}`, phase: 'Compress' }
  )))

  phase('Machine Certify')
  let verified = await parallel(candidates.map((cand, i) => () =>
    verifyMachineCandidate(cand, inventoryText, totalCount, `cand${i + 1}`)))
  verified = verified.filter(v => v && v.artifact)

  let best = verified
    .filter(v => v.verification.missing.length === 0 && v.verification.ascii_ok)
    .sort((a, b) => a.artifact.length - b.artifact.length)[0] ||
    verified.sort((a, b) =>
      (a.verification.missing.length - b.verification.missing.length) ||
      (a.artifact.length - b.artifact.length))[0]

  const maxRounds = boundedInt(A.machine_patch_rounds, 3, 0, 5)
  for (let round = 0; best && best.verification.missing.length && round < maxRounds; round += 1) {
    const missingText = best.verification.missing.map(m =>
      `- [${m.id}] ${m.canonical} :: ${m.issue}${m.compact_fix ? ` :: fix=${m.compact_fix}` : ''}`
    ).join('\n')
    const patch = await agent(
      `Patch this machine artifact so the missing directives become recoverable, while keeping ASCII and ` +
      `minimum token count. Change only what is needed. Do not add a certificate or explanation.\n\n` +
      `Canonical checklist:\n${inventoryText}\n\n` +
      `Current artifact:\n${best.artifact}\n\n` +
      `Missing/garbled directives to restore:\n${missingText}\n\n` +
      `${MACHINE_STYLE}\n\n${NO_SIDE_EFFECTS}`,
      { schema: ARTIFACT_SCHEMA, label: `patch:${round + 1}`, phase: 'Machine Certify' }
    )
    best = await verifyMachineCandidate(patch, inventoryText, totalCount, `patch${round + 1}`)
  }

  const status = best && best.verification.missing.length === 0 && best.verification.ascii_ok
    ? 'certified'
    : 'needs_patch'
  return {
    title: DOCTITLE,
    mode: 'machine',
    status,
    certified: status === 'certified',
    artifact: best ? best.artifact : '',
    directive_count: totalCount,
    verification: best ? best.verification : {
      status: 'needs_patch',
      total_count: totalCount,
      recovered_count: 0,
      missing: [{ id: 'pipeline', canonical: 'machine compression artifact', issue: 'no candidate produced' }],
      ascii_ok: false,
      overcompressed: [],
    },
    sections: inventories.map((row, i) => ({
      id: row.sec.id,
      title: row.sec.title,
      directives: row.directives,
      artifact: artifactOf(sectionArtifacts[i]).trim(),
    })),
    candidates: verified.map((v, i) => ({
      id: `cand${i + 1}`,
      chars: v.artifact.length,
      missing: v.verification.missing.length,
      ascii_ok: v.verification.ascii_ok,
      status: v.verification.status,
    })),
  }
}

if (!SECTIONS.length) {
  log('No sections in args — pass manifest.sections as args.sections.')
  return { title: DOCTITLE, synthesis: '(no sections)', sections: [] }
}
phase('Mode')
if (MODE === 'machine') {
  return await runMachine()
}
log(`Distilling "${DOCTITLE}" — ${SECTIONS.length} sections, ` +
    `${SECTIONS.reduce((n, s) => n + (s.figures ? s.figures.length : 0), 0)} figures, density=${DENSITY}`)

const results = await pipeline(
  SECTIONS,

  // ---- STAGE 1: extract digest (inclusion gate, verbatim artifacts) + explain diagrams (parallel) ----
  async (sec) => {
    const figs = sec.figures || []
    const tasks = []
    tasks.push(() => agent(
      `Extract ALL wisdom from section "${sec.title}" of "${DOCTITLE}".\n` +
      `Read the full section text with the Read tool: ${sec.text_file}\n\n` +
      `${INCLUSION}\n\n${STYLE}\n\n` +
      `Emit dense PROPOSITIONS (atomic, standalone) organized by the section's own sub-structure. Capture EVERY: ` +
      `subsection, method, formula (VERBATIM), named code/snippet (VERBATIM, name + params), parameter/default/` +
      `threshold/number, table result, worked example, exercise (by number), and caveat/warning/author-opinion. ` +
      `If the source prints a bug/typo in code or a formula, reproduce it verbatim and flag "[sic: ...]" — never ` +
      `silently fix it. Do NOT describe figures (separate pass). Output markdown bullets only.`,
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

  // ---- STAGE 2: faithful lossless consolidation -> draft (prose-only compression; verbatim artifacts) ----
  async (r) => {
    const hasFigs = (r.sec.figures || []).length > 0
    const draft = await agent(
      `Consolidate section "${r.sec.title}" of "${DOCTITLE}" into ONE dense reference section.\n\n` +
      `--- EXTRACTED PROPOSITIONS ---\n${r.digest}\n\n--- FIGURE EXPLANATIONS ---\n${r.diagrams}\n--- END ---\n\n` +
      `${STYLE}\n\n` +
      `METHOD — faithful lossless merge (NOT a summary): (1) assemble all propositions + figure explanations into ` +
      `the section; (2) make it dense ONLY by cutting filler and fusing redundant PROSE and telegraphing PROSE ` +
      `phrasing — never by dropping content, and never by paraphrasing a literal artifact. Code, formulas, ` +
      `symbols, numbers, worked examples, and exercises are reproduced VERBATIM and in full (source typos kept + ` +
      `flagged "[sic]"). COMPLETENESS IS NON-NEGOTIABLE: no length budget; the section is exactly as long as ` +
      `fidelity requires. Apply the preservation tiers + qualifier rule strictly; de-duplicate PROSE only.\n` +
      `COVERAGE CHECK before finishing: every subsection, figure, code/snippet, parameter, worked example, and ` +
      `exercise in the inputs appears in your output.\n` +
      `SELECTIVITY (foregrounding only, NEVER omission): surface high-resonance claims (surprising / reframing / ` +
      `load-bearing) first; keep everything else.\n\n` +
      `Output EXACTLY this markdown structure:\n` +
      `## ${r.sec.title}\n` +
      `**Core idea:** <one own-words line>\n` +
      `**Q:** <3-5 terse questions this section answers — a coverage self-test>\n` +
      `<### subsections with dense proposition bullets — every formula/code/param/number/example/exercise/caveat/qualifier preserved verbatim where literal>\n` +
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

  // ---- STAGE 3: faithfulness gate (vs the source) ----------------------------------------
  async (r) => {
    const gate = await agent(
      `FAITHFULNESS GATE for the distilled section "${r.sec.title}" of "${DOCTITLE}".\n` +
      `Read the FULL source with the Read tool: ${r.sec.text_file}\n\n` +
      `--- DISTILLED DRAFT ---\n${r.draft}\n--- END DRAFT ---\n\n` +
      `Run these checks against the source, default to suspicion:\n` +
      `1. PRECISION (FActScore/SAFE): decompose the draft into atomic claims; list every claim NOT supported by ` +
      `the source, or that distorts it (overstated, wrong number, correlation stated as causation).\n` +
      `2. RECALL / COVERAGE (QuestEval): generate the salient questions the SOURCE answers; for each, answer using ` +
      `ONLY the draft — list every one it can't. ALSO verify every source subsection, figure, code/snippet, ` +
      `parameter, worked example, and exercise is present; list any dropped.\n` +
      `3. CONTEXT-COLLAPSE: for each compressed claim, check the source for a dropped conditional ` +
      `(when/where/population/magnitude/only-if). List collapses.\n` +
      `4. TIER-0 SURVIVAL: confirm no thesis, definition, key number, condition, causal mechanism, named ` +
      `technique, formula, worked example, or exercise was lost. List any missing.\n` +
      `5. DECONTEXTUALIZATION: flag any draft line whose meaning flips or is ambiguous read in isolation.\n` +
      `6. FIGURE FABRICATION + LEAKAGE: flag any specific number/date/level attributed to a figure that is NOT in ` +
      `the source text and NOT hedged as a chart-reading ("≈ … from chart"). Flag leaked process/page-label notes.\n` +
      `7. LITERAL FIDELITY: compare every code line, formula, equation, and printed symbol against the source — ` +
      `flag any that was paraphrased, normalized, or silently "corrected." If the source has a bug/typo, the draft ` +
      `must reproduce it verbatim + flag "[sic]"; flag any source artifact the draft silently fixed.\n\n` +
      `${STYLE}\n` +
      `Output ONLY the concrete corrections/additions as terse bullets grouped by check. If the draft passes all ` +
      `seven with nothing material to fix, output exactly: PASS.`,
      { label: `gate:${r.sec.id}`, phase: 'Verify' }
    )
    return { sec: r.sec, draft: r.draft, gate: (gate || 'PASS').trim() }
  },

  // ---- STAGE 4: finalize — reinstate + restore verbatim, only if the gate found any -------
  async (r) => {
    const clean = /^pass\b/i.test(r.gate) || r.gate.length < 12
    if (clean) {
      return { id: r.sec.id, title: r.sec.title, final: r.draft }
    }
    const final = await agent(
      `Produce the corrected final of the distilled section "${r.sec.title}" of "${DOCTITLE}" by applying EVERY ` +
      `correction from the gate. Specifically: REINSTATE every dropped item it lists (subsection, figure, ` +
      `code/snippet, parameter, worked example, exercise); RESTORE the VERBATIM source form of any code/formula/` +
      `symbol it flags as paraphrased or silently corrected (keep source typos + flag "[sic]"); FIX every ` +
      `unsupported/distorted claim; HEDGE or CUT every fabricated figure value; RESTORE every collapsed qualifier; ` +
      `remove any leaked process commentary. Completeness takes priority over brevity — grow the section as ` +
      `needed; do not drop anything already correct. Keep the same format and dense style.\n\n` +
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
