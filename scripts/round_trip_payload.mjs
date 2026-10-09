#!/usr/bin/env node
// The Payload round trip: what salt-contract/emit/payload.mjs generates for each section, against
// the field half salt-nextjs ships today. Writes salt-contract/reports/round-trip-payload.md.
//
//   node scripts/round_trip_payload.mjs [--check | --suggest] <salt-nextjs checkout>
//   SALT_NEXTJS_DIR=<salt-nextjs checkout> node scripts/round_trip_payload.mjs [--check | --suggest]
//
// Needs a salt-nextjs checkout, so it is not part of `npm run verify`. The report it writes is
// committed; --check fails when the committed one is stale, when a difference is not on the
// expected list, or when a listed one no longer occurs.
// --suggest prints the unlisted differences as list entries, with the contract note that may
// account for each, for a person to review before adding them.
//
// salt-nextjs's field files are TypeScript that import the Lexical editor. esbuild bundles
// packages/core/src/blocks/index.ts with that editor stubbed (each feature records its key, so
// the allowed element list can be read back) and React's JSX runtime stubbed (a component module
// reached for one constant), and the bundle is imported. Nothing in salt-nextjs is written to.
//
// Compared per field: name, type, option values, default, required, limits (maxLength, min, max,
// minRows, maxRows, hasMany), the rich-text allowed list, and conditions. Conditions are compared
// by behaviour: both are evaluated over every combination of the siblings either reads (salt-
// nextjs's are found by watching which keys it touches), with each contract value translated to
// the one salt-nextjs stores. Labels and descriptions are not compared; see the report's header.
//
// Each difference is EXPECTED only when salt-contract/reports/round-trip-payload.expected.json lists
// it: its section, field path, kind and exact wording, with the evidence that accounts for it. That
// evidence is an owes, note, formerly or values entry from the platform note of that field or a
// field above it, or its section's owes, note or sections.json formerly; --check refuses anything
// else (scripts/_round_trip.mjs). Anything else is UNEXPECTED, so a later
// rename, retype or required change on a field that already owes something is not hidden by it.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

import { isMainModule, loadContract, normaliseLineEndings, resolveSection } from '../salt-contract/emit/_contract.mjs'
import { toPayloadBlocks } from '../salt-contract/emit/payload.mjs'
import { classify, misplacedEvidence } from './_round_trip.mjs'

export { classify }

const here = path.dirname(fileURLToPath(import.meta.url))
const reportPath = path.join(here, '..', 'salt-contract', 'reports', 'round-trip-payload.md')
const expectedPath = path.join(here, '..', 'salt-contract', 'reports', 'round-trip-payload.expected.json')

/**
 * The command line: flags anywhere and at most one positional argument, the salt-nextjs checkout,
 * or SALT_NEXTJS_DIR when there is none. Never guessed: checkouts sit in different places on
 * different machines and in worktrees, and a guess that misses fails late and obscurely.
 */
export function parseArguments(argv, env = process.env) {
  const flags = new Set(['--check', '--suggest'])
  const unknown = argv.filter((a) => a.startsWith('--') && !flags.has(a))
  if (unknown.length) throw new Error(`unknown option ${unknown.join(', ')}`)
  const positional = argv.filter((a) => !a.startsWith('--'))
  if (positional.length > 1) throw new Error(`one salt-nextjs checkout, not ${positional.length}`)
  // --suggest prints and returns before any check, so together they would pass without checking.
  if (argv.includes('--check') && argv.includes('--suggest')) throw new Error('--check and --suggest cannot be used together')
  const given = positional[0] ?? env.SALT_NEXTJS_DIR
  if (!given) throw new Error('pass the salt-nextjs checkout, or set SALT_NEXTJS_DIR')
  const nextjs = path.resolve(given)
  if (!existsSync(path.join(nextjs, 'packages', 'core', 'src', 'blocks', 'index.ts'))) {
    throw new Error(`salt-nextjs checkout not found at ${nextjs} (no packages/core/src/blocks/index.ts)`)
  }
  return { nextjs, check: argv.includes('--check'), suggest: argv.includes('--suggest') }
}

/** Whether the committed report says what the comparison says, CRLF read as LF. */
export const reportIsCurrent = (committed, text) => normaliseLineEndings(committed) === normaliseLineEndings(text)

// ── Load salt-nextjs's field half ──────────────────────────────────────────────────────────────

const LEXICAL_STUB = `
const f = (key) => () => ({ key })
export const lexicalEditor = (o) => ({ features: o.features })
export const ParagraphFeature = f('paragraph'), BoldFeature = f('bold'), ItalicFeature = f('italic'),
  InlineCodeFeature = f('code'), LinkFeature = f('link'), UnorderedListFeature = f('unordered-list'),
  OrderedListFeature = f('ordered-list'), BlockquoteFeature = f('blockquote'), FixedToolbarFeature = f('toolbar')
export const HeadingFeature = (o) => ({ key: 'heading', sizes: o?.enabledHeadingSizes ?? [] })
`
const JSX_STUB = 'export const jsx = () => null, jsxs = () => null, Fragment = null'

async function loadNextjs(nextjs) {
  const work = mkdtempSync(path.join(tmpdir(), 'salt-round-trip-'))
  try {
    const bundle = path.join(work, 'blocks.mjs')
    await build({
      entryPoints: [path.join(nextjs, 'packages', 'core', 'src', 'blocks', 'index.ts')],
      bundle: true,
      format: 'esm',
      platform: 'node',
      outfile: bundle,
      logLevel: 'warning',
      plugins: [{
        name: 'stubs',
        setup(b) {
          b.onResolve({ filter: /^@payloadcms\/richtext-lexical$/ }, () => ({ path: 'lexical', namespace: 'stub' }))
          b.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: 'jsx', namespace: 'stub' }))
          b.onResolve({ filter: /^[^./]/ }, (a) => ({ errors: [{ text: `unexpected runtime import ${a.path}; stub it` }] }))
          b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: a.path === 'lexical' ? LEXICAL_STUB : JSX_STUB, loader: 'js' }))
        },
      }],
    })
    const nx = await import(pathToFileURL(bundle).href)
    const nextjsCommit = execFileSync('git', ['-C', nextjs, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
    const nextjsVersion = JSON.parse(readFileSync(path.join(nextjs, 'packages', 'core', 'package.json'), 'utf8')).version
    return { nx, nextjsCommit, nextjsVersion }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

// ── Compare ────────────────────────────────────────────────────────────────────────────────────

let rows = []
const LIMITS = ['maxLength', 'min', 'max', 'minRows', 'maxRows', 'hasMany']
const allowedOf = (n) => (n.editor?.features ?? []).flatMap((f) =>
  f.key === 'toolbar' ? [] : f.key === 'heading' ? f.sizes.map((s) => `heading-${s.slice(1)}`) : [f.key])
const typeOf = (n) => (n.type === 'radio' ? 'select' : n.type)
const show = (v) => (v === undefined ? 'none' : JSON.stringify(v))

// The contract field definitions beside the emitted ones, so a difference can find its notes.
function defsFor(fields, emittedFields) {
  return new Map(emittedFields.map((e) => [e.name, fields.find((f) => f.name === e.name)]))
}

const formerlyOf = (def) => [def?.platforms?.nextjs?.formerly ?? []].flat().map((p) => p.split('.').at(-1))

// The value salt-nextjs stores for a contract value of this field.
function toNextjs(def, value) {
  const map = def?.platforms?.nextjs?.values ?? {}
  const back = Object.entries(map).find(([, to]) => to === value)
  return back && typeof back[1] === 'string' ? back[0] : value
}

function samplesFor(field) {
  if (!field) return [undefined]
  if (field.type === 'select' || field.type === 'radio') {
    const vals = field.options.map((o) => (typeof o === 'string' ? o : o.value))
    return field.defaultValue === undefined ? [undefined, ...vals] : vals
  }
  if (field.type === 'checkbox') return field.defaultValue === undefined ? [undefined, true, false] : [true, false]
  if (field.type === 'text' || field.type === 'textarea') return [undefined, '', '  ', 'Words']
  if (field.type === 'upload' || field.type === 'relationship') return [undefined, 7]
  if (field.type === 'number') return [undefined, 0, 3]
  return [undefined]
}

function compareConditions(e, n, ctx) {
  const fn = n?.admin?.condition
  const mine = e.admin?.condition
  if (!fn && !mine) return null
  // Which siblings, and whether the parent, salt-nextjs's condition reads.
  const touched = new Set()
  let readsParent = false
  if (fn) {
    const probe = new Proxy({}, { get: (_t, k) => { if (typeof k === 'string') touched.add(k); return undefined } })
    const parent = new Proxy({}, { get: () => { readsParent = true; return undefined } })
    try { fn({}, probe, { blockData: parent, siblingData: probe, user: null }) } catch { /* probed only */ }
  }
  if (readsParent) return 'salt-nextjs decides it from the parent block, which a contract condition cannot read'
  const keys = [...new Set([...(e.custom?.salt?.condition ?? []).map((c) => c.field), ...touched])].sort()
  // Contract values for the emitted siblings; salt-nextjs's sibling names and values.
  let combos = [{}]
  for (const k of keys) {
    const sib = ctx.emittedSiblings.find((s) => s.name === k)
    combos = combos.flatMap((c) => samplesFor(sib).map((v) => ({ ...c, [k]: v })))
  }
  const disagree = []
  for (const combo of combos) {
    const theirs = {}
    for (const [k, v] of Object.entries(combo)) theirs[k] = toNextjs(ctx.defs.get(k), v)
    const a = mine ? mine({}, combo) : true
    let b = true
    try { b = fn ? !!fn({}, theirs, { blockData: {}, siblingData: theirs, user: null }) : true } catch { b = 'throws' }
    if (a !== b) disagree.push(`${JSON.stringify(combo)}: contract ${a ? 'shows' : 'hides'}, salt-nextjs ${b === 'throws' ? 'throws' : b ? 'shows' : 'hides'}`)
  }
  return disagree.length ? `condition differs (${disagree.length} of ${combos.length} cases), e.g. ${disagree.slice(0, 2).join('; ')}` : null
}

// The contract note that may account for a difference: a suggestion for --suggest, never a verdict.
function suggestionFor(note, kind) {
  if (kind === 'values' && note?.values) return `values: ${JSON.stringify(note.values)}`
  if (kind === 'name' && note?.formerly) return `formerly: ${[note.formerly].flat().join(', ')}`
  if (kind === 'condition' && note?.note) return `note: ${note.note}`
  if (note?.owes) return `owes: ${note.owes}`
  if (note?.note) return `note: ${note.note}`
  return ''
}

function record(section, at, def, kind, text, note = def?.platforms?.nextjs) {
  rows.push({ section, at, kind, text, suggestion: suggestionFor(note, kind) })
}

function compareFields(section, emittedFields, nextFields, defs, prefix) {
  const used = new Set()
  for (const e of emittedFields) {
    const def = defs.get(e.name)
    const at = `${prefix}${e.name}`
    let n = nextFields.find((x) => x.name === e.name)
    if (!n) {
      const former = formerlyOf(def).map((f) => nextFields.find((x) => x.name === f)).filter(Boolean)
      if (former.length) {
        n = former[0]
        for (const f of former) used.add(f.name)
        record(section, at, def, 'name', `stored as ${former.map((f) => f.name).join(', ')}`)
      }
    }
    if (!n) { record(section, at, def, 'missing', 'not in salt-nextjs'); continue }
    used.add(n.name)
    compareOne(section, at, e, n, def, { emittedSiblings: emittedFields, defs })
  }
  for (const n of nextFields) {
    if (!n.name || used.has(n.name)) continue
    rows.push({ section, at: `${prefix}${n.name}`, kind: 'extra', text: 'in salt-nextjs, not in the contract', suggestion: '' })
  }
}

function compareOne(section, at, e, n, def, ctx) {
  const inQuery = def?.type === 'collection-query'
  const diffs = []
  if (typeOf(e) !== typeOf(n)) diffs.push(['type', `type ${e.type}; salt-nextjs ${n.type}`])
  if (e.options) {
    const mine = e.options.map((o) => o.value)
    const theirs = (n.options ?? []).map((o) => (typeof o === 'string' ? o : o.value))
    if (mine.join('|') !== theirs.join('|')) {
      const mapped = theirs.map((v) => def?.platforms?.nextjs?.values?.[v] ?? v)
      const why = mapped.join('|') === mine.join('|') ? 'values' : 'options'
      diffs.push([why, `options ${mine.join(', ')}; salt-nextjs ${theirs.map((v) => (v === '' ? '(empty)' : v)).join(', ')}`])
    }
  }
  if (show(e.defaultValue) !== show(n.defaultValue)) {
    const mapped = n.defaultValue === undefined ? undefined : def?.platforms?.nextjs?.values?.[n.defaultValue]
    diffs.push([mapped !== undefined && mapped === e.defaultValue ? 'values' : 'default', `default ${show(e.defaultValue)}; salt-nextjs ${show(n.defaultValue)}`])
  }
  if (!!e.required !== !!n.required) diffs.push(['required', `required ${!!e.required}; salt-nextjs ${!!n.required}`])
  for (const k of LIMITS) if (show(e[k]) !== show(n[k])) diffs.push(['limit', `${k} ${show(e[k])}; salt-nextjs ${show(n[k])}`])
  if (e.type === 'richText') {
    const mine = e.custom.salt.allowed.join(', ')
    const theirs = allowedOf(n).join(', ')
    if (mine !== theirs) diffs.push(['allowed', `allows ${mine}; salt-nextjs ${theirs}`])
  }
  if (e.type === 'upload' && e.relationTo !== n.relationTo) diffs.push(['relation', `relationTo ${show(e.relationTo)}; salt-nextjs ${show(n.relationTo)}`])
  const cond = compareConditions(e, n, ctx)
  if (cond) diffs.push(['condition', cond])
  for (const [kind, text] of diffs) record(section, at, def, kind, text, ctx.note ?? def?.platforms?.nextjs)
  if (e.fields && n.fields) {
    if (inQuery) {
      // The query's parts: salt-nextjs's names, by the field's note.
      const rename = { terms: 'categories', sortBy: 'order', limit: 'count' }
      const theirs = n.fields.map((f) => ({ ...f, name: rename[f.name] ?? f.name }))
      compareQuery(section, `${at}.`, e.fields, theirs, def)
    } else {
      const childDefs = def?.type === 'link' ? new Map() : defsFor(def?.fields ?? [], e.fields)
      compareFields(section, e.fields, n.fields, childDefs, `${at}.`)
    }
  }
}

// The query's parts carry no notes of their own: the query's note covers them, its values keyed by
// part (values.mode, values.sortBy).
function compareQuery(section, prefix, mine, theirs, def) {
  const note = def?.platforms?.nextjs
  const partDef = (name) => {
    const part = { mode: 'mode', order: 'sortBy' }[name]
    return part ? { platforms: { nextjs: { values: note?.values?.[part] ?? {} } } } : undefined
  }
  const defs = new Map(mine.map((m) => [m.name, partDef(m.name)]))
  const used = new Set()
  for (const e of mine) {
    const n = theirs.find((x) => x.name === e.name)
    if (!n) { record(section, `${prefix}${e.name}`, def, 'inside-query', 'not in salt-nextjs'); continue }
    used.add(n.name)
    // A part's values come from the query's note, keyed by part; any other difference is the query's.
    const part = defs.get(e.name)
    const partNote = part ? { ...note, values: part.platforms.nextjs.values } : note
    compareOne(section, `${prefix}${e.name}`, e, n, part, { emittedSiblings: mine, defs, note: partNote })
  }
  for (const n of theirs) if (!used.has(n.name)) record(section, `${prefix}${n.name}`, def, 'inside-query', 'in salt-nextjs, not in the contract')
}
// ── Run ────────────────────────────────────────────────────────────────────────────────────────

async function main({ nextjs, check, suggest }) {
  const { nx, nextjsCommit, nextjsVersion } = await loadNextjs(nextjs)
  rows = []
  // The options salt-nextjs's own example site passes, as near as the contract's options reach.
  const icons = [{ value: 'star', label: 'Star' }, { value: 'check', label: 'Check' }]
  const sources = { services: {}, 'case-studies': {}, testimonials: {}, posts: {}, team: {} }
  const BUILDERS = {
    hero: () => nx.heroBlock(), 'rich-text': () => nx.richTextBlock(), 'call-to-action': () => nx.ctaBlock(),
    'media-text': () => nx.mediaTextBlock(), features: () => nx.featuresBlock({ icons }), stats: () => nx.statsBlock({ icons }),
    logos: () => nx.logosBlock(), gallery: () => nx.galleryBlock(), process: () => nx.processBlock({ icons }),
    faq: () => nx.faqBlock(), tabs: () => nx.tabsBlock(), 'collection-showcase': () => nx.collectionShowcaseBlock({ sources }),
    carousel: () => nx.carouselBlock({ sources }), listing: () => nx.listingBlock(), contact: () => nx.contactBlock(),
  }

  const contract = loadContract()
  // faq's own source, and locations so the report still lists it: the emitter leaves out a section
  // whose source the site lacks.
  const emitted = toPayloadBlocks({ icons, sources: { ...sources, faqs: {}, locations: {} }, richTextEditor: (allowed) => ({ allowed }) })

  const sectionRows = []
  for (const block of emitted) {
    const id = block.slug
    const s = contract.sections.find((x) => x.id === id)
    const build = BUILDERS[id]
    if (!build) {
      sectionRows.push({ id, status: `not in salt-nextjs core (sections.json: ${s.platforms?.nextjs?.status ?? 'none'}${s.platforms?.nextjs?.owes ? `, owes ${s.platforms.nextjs.owes}` : ''})` })
      continue
    }
    const theirs = build()
    const { fields, settings } = resolveSection(contract, id)
    const formerName = s.platforms?.nextjs?.formerly?.[0]?.name
    if (theirs.slug !== id) {
      rows.push({ section: id, at: '(block slug)', kind: 'name', text: `slug ${id}; salt-nextjs ${theirs.slug}`,
        suggestion: formerName === theirs.slug ? `sections.json formerly: ${formerName}` : '' })
    }
    const defs = defsFor([...fields, { name: 'settings', type: 'group', fields: settings }], block.fields)
    compareFields(id, block.fields, theirs.fields, defs, '')
    sectionRows.push({ id, status: `compared with ${theirs.slug}` })
  }


  const list = JSON.parse(readFileSync(expectedPath, 'utf8'))
  const { expected, unexpected, unseen } = classify(rows, list)
  if (suggest) {
    console.log(JSON.stringify(unexpected.map((r) => ({ section: r.section, path: r.at, kind: r.kind, difference: r.text, evidence: r.suggestion })), null, 2))
    return
  }
  const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')
  const lines = [
    '# Payload round trip',
    '',
    `Generated by \`node scripts/round_trip_payload.mjs <salt-nextjs>\`; do not edit. It compares what`,
    '`emit/payload.mjs` generates from this contract with the field half salt-nextjs ships',
    `(@lightlysaltedhq/salt-nextjs ${nextjsVersion}, commit ${nextjsCommit}), section by section.`,
    '',
    'Compared: field names, types, option values, defaults, required, limits, the rich-text allowed',
    'list, and conditions (by behaviour, over every combination of the siblings either side reads).',
    'Not compared: labels and descriptions, which salt-nextjs mostly leaves to Payload or words',
    'differently and SC-003 says must match, so adopting the emitter changes them throughout; and what',
    'stays native to Payload (enum names, admin components, hooks, validators, row-label components).',
    '',
    '**Expected** means `round-trip-payload.expected.json` lists the difference exactly (section, field,',
    'kind and wording), with the contract note or ruling that accounts for it. **Unexpected** means it',
    'is not on that reviewed list; **listed, not found** means the list names a difference that no',
    'longer occurs.',
    '',
    `## Summary`,
    '',
    `${rows.length} differences: ${expected.length} expected, ${unexpected.length} unexpected; ${unseen.length} listed, not found.`,
    '',
    '| Section | Compared |',
    '| --- | --- |',
    ...sectionRows.map((s) => `| ${s.id} | ${cell(s.status)} |`),
    '',
  ]
  if (unexpected.length) {
    lines.push('## Unexpected', '', '| Section | Field | Kind | Difference | Contract note that may account for it |', '| --- | --- | --- | --- | --- |')
    for (const r of unexpected) lines.push(`| ${r.section} | \`${r.at}\` | ${r.kind} | ${cell(r.text)} | ${cell(r.suggestion || 'none')} |`)
    lines.push('')
  }
  if (unseen.length) {
    lines.push('## Listed, not found', '', '| Section | Field | Kind | Difference |', '| --- | --- | --- | --- |')
    for (const e of unseen) lines.push(`| ${e.section} | \`${e.path}\` | ${e.kind} | ${cell(e.difference)} |`)
    lines.push('')
  }
  lines.push('## Expected', '', '| Section | Field | Kind | Difference | Recorded as |', '| --- | --- | --- | --- | --- |')
  for (const r of expected) lines.push(`| ${r.section} | \`${r.at}\` | ${r.kind} | ${cell(r.text)} | ${cell(r.evidence)} |`)
  lines.push('')
  const text = lines.join('\n')

  if (check) {
    let committed = ''
    try { committed = readFileSync(reportPath, 'utf8') } catch { /* missing is stale */ }
    if (!reportIsCurrent(committed, text)) { console.log(`✗ ${path.relative(process.cwd(), reportPath)} is stale; regenerate it`); process.exit(1) }
    const misplaced = misplacedEvidence(contract, list, 'nextjs')
    for (const e of misplaced) console.log(`✗ ${e.section} ${e.path} (${e.kind}) cites evidence that is not a note of that field, its parents or its section: ${e.evidence}`)
    if (misplaced.length) process.exit(1)
    if (unexpected.length || unseen.length) {
      console.log(`✗ ${unexpected.length} unexpected difference(s) and ${unseen.length} listed but not found; see the report`)
      process.exit(1)
    }
    console.log(`PASS: the round-trip report is current: ${expected.length} expected, 0 unexpected`)
  } else {
    writeFileSync(reportPath, text)
    console.log(`wrote ${path.relative(process.cwd(), reportPath)}: ${expected.length} expected, ${unexpected.length} unexpected`)
  }
}

if (isMainModule(import.meta.url)) {
  let args
  try { args = parseArguments(process.argv.slice(2)) } catch (e) { console.error(`✗ ${e.message}`); process.exit(2) }
  await main(args)
}
