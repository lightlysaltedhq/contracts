#!/usr/bin/env node
// The ACF round trip: what salt-contract/emit/acf.mjs generates for each section, against the
// Flexible Content layouts salt-wordpress ships today. Writes salt-contract/reports/round-trip-acf.md.
//
//   node scripts/round_trip_acf.mjs <salt-wordpress checkout> [--check]
//
// Needs a salt-wordpress checkout and `php` on the path, so it is not part of `npm run verify`; the
// report it writes is committed, and --check fails when the committed one is stale.
//
// salt-wordpress's field files are PHP that build their arrays with `__()` and helper functions,
// so they are loaded, not parsed: a short PHP script does what its own bin/extract-slugs.php does
// (its test shims, acf_add_local_field_group() captured, the acf/init hook fired) and prints the
// captured groups as JSON. Nothing in salt-wordpress is written to.
//
// Compared per field: name, type, choices (values and order), default, required, limits
// (maxlength, min, max, step), the post types and taxonomy a relation reads, and conditional
// logic. Conditional logic is compared by behaviour: both sides are ACF rules, evaluated as ACF
// does over every combination of the siblings either side reads, with each contract value
// translated to the one salt-wordpress stores. Labels and instructions are not compared; see the
// report's header.
//
// Each difference is EXPECTED when the contract field (or its section in sections.json) carries a
// platforms.wordpress note that accounts for it (formerly, values, owes, or a note on the
// condition), and UNEXPECTED otherwise.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { clauses, loadContract, resolveSection, siblingValue } from '../salt-contract/emit/_contract.mjs'
import { toAcfFieldGroups } from '../salt-contract/emit/acf.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const reportPath = path.join(here, '..', 'salt-contract', 'reports', 'round-trip-acf.md')
const wordpress = path.resolve(process.argv[2] ?? path.join(here, '..', '..', '..', 'Products', 'Salt', 'salt-wordpress'))
const check = process.argv.includes('--check')

// ── Load salt-wordpress's field groups ─────────────────────────────────────────────────────────

const LOADER = `<?php
$salt_root = $argv[1];
require $salt_root . '/tests/wp-shims.php';
$GLOBALS['salt_captured_groups'] = array();
function acf_add_local_field_group( array $group ): void { $GLOBALS['salt_captured_groups'][] = $group; }
if ( ! function_exists( 'salt_log' ) ) { function salt_log( string $message ): void { fwrite( STDERR, $message . "\\n" ); } }
require_once $salt_root . '/inc/helpers.php';
require_once $salt_root . '/inc/modules.php';
require_once $salt_root . '/inc/acf.php';
require_once $salt_root . '/inc/query/resolver.php';
require_once $salt_root . '/inc/query/controls.php';
$files = glob( $salt_root . '/inc/fields/*.php' );
sort( $files );
foreach ( $files as $file ) { require_once $file; }
salt_test_do_action( 'acf/init' );
salt_test_do_action( 'init' );
echo json_encode( $GLOBALS['salt_captured_groups'], JSON_UNESCAPED_SLASHES );
`
const work = mkdtempSync(path.join(tmpdir(), 'salt-round-trip-acf-'))
let wpGroups
try {
  writeFileSync(path.join(work, 'load.php'), LOADER)
  wpGroups = JSON.parse(execFileSync('php', [path.join(work, 'load.php'), wordpress], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))
} finally { rmSync(work, { recursive: true, force: true }) }
const wpCommit = execFileSync('git', ['-C', wordpress, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
const wpVersion = /^Version:\s*(\S+)/m.exec(readFileSync(path.join(wordpress, 'style.css'), 'utf8'))?.[1] ?? 'unknown'
const wpSections = wpGroups.find((g) => g.key === 'group_salt_sections')
const wpLayouts = [wpSections.fields[0].layouts].flat().flatMap((l) => (Array.isArray(l) ? l : [l]))

// Every source salt-wordpress registers, with its own slugs (the emitter's defaults).
const icons = [{ value: 'star', label: 'Star' }, { value: 'check', label: 'Check' }]
const contract = loadContract()
const emitted = toAcfFieldGroups({ icons })[0].fields[0].layouts

// ── Compare ────────────────────────────────────────────────────────────────────────────────────

const rows = []
const keyRows = []
const FAMILY = { radio: 'select', button_group: 'select' }
const family = (t) => FAMILY[t] ?? t
const named = (fields) => (fields ?? []).filter((f) => f.name)
const show = (v) => (v === undefined || v === '' ? 'none' : JSON.stringify(v))
const wpNote = (def) => def?.platforms?.wordpress
const formerlyOf = (def) => [wpNote(def)?.formerly ?? []].flat().map((p) => p.split('.').at(-1))

// The value salt-wordpress stores for a contract value of this field.
function toWordpress(values, value) {
  const back = Object.entries(values ?? {}).find(([, to]) => to === value)
  return back && typeof back[1] === 'string' ? back[0] : value
}

function record(section, at, def, kind, text, parent) {
  const note = wpNote(def)
  let verdict = 'unexpected'
  let evidence = ''
  // The most specific record first: a former name for a name, a note for a condition.
  if (kind === 'name' && note?.formerly) { verdict = 'expected'; evidence = `formerly: ${[note.formerly].flat().join(', ')}` }
  else if (kind === 'condition' && note?.note) { verdict = 'expected'; evidence = `note: ${note.note}` }
  else if (note?.owes) { verdict = 'expected'; evidence = `owes: ${note.owes}` }
  // A part added or dropped inside a list or group whose own note owes its new shape.
  else if ((kind === 'missing' || kind === 'extra') && wpNote(parent)?.owes) { verdict = 'expected'; evidence = `parent owes: ${wpNote(parent).owes}` }
  rows.push({ section, at, kind, text, verdict, evidence })
}

// ACF's reading of a rule, not the contract's isFilled: both sides here are ACF rules, so they are
// judged as ACF judges them. A true_false holds 1 or 0; empty is '', null, 0 or an empty list.
const isEmpty = (v) => v === undefined || v === null || v === '' || v === 0 || (Array.isArray(v) && v.length === 0)
function holds(r, v) {
  switch (r.operator) {
    case '==': return !isEmpty(v) && String(v) === String(r.value)
    case '!=': return isEmpty(v) ? String(r.value ?? '') !== '' : String(v) !== String(r.value)
    case '==empty': return isEmpty(v)
    case '!=empty': return !isEmpty(v)
    case '==contains': return String(v ?? '').includes(String(r.value))
    default: throw new Error(`no reading for operator ${r.operator}`)
  }
}
const logicOf = (f) => (Array.isArray(f?.conditional_logic) && f.conditional_logic.length ? f.conditional_logic : null)
const shown = (logic, valueOf) => !logic || logic.some((g) => g.every((r) => holds(r, valueOf(r.field))))

function samplesFor(field) {
  switch (field?.type) {
    case 'select': case 'radio': case 'button_group':
      return [...(field.allow_null ? [''] : []), ...Object.keys(field.choices ?? {})]
    case 'true_false': return [1, 0]
    case 'text': case 'url': case 'textarea': case 'wysiwyg': return ['', 'Words']
    case 'number': return ['', 0, 3]
    case 'image': case 'gallery': case 'post_object': case 'relationship': case 'taxonomy': return ['', 7]
    default: return ['']
  }
}

// ctx: { mine: emitted siblings, theirs: salt-wordpress siblings, pairs: Map(emitted name → wp
// field), defs: Map(emitted name → contract def or part def) }
function compareConditions(e, n, ctx) {
  const mineLogic = logicOf(e)
  const theirLogic = logicOf(n)
  if (!mineLogic && !theirLogic) return null
  ctx = { fixed: {}, ...ctx }
  const byKey = new Map(ctx.mine.map((s) => [s.key, s]))
  const wpByKey = new Map(ctx.theirs.map((s) => [s.key, s]))
  const pairedName = new Map([...ctx.pairs].map(([name, wp]) => [wp.key, name]))
  const vars = new Map()
  for (const g of mineLogic ?? []) for (const r of g) vars.set(byKey.get(r.field).name, byKey.get(r.field))
  for (const g of theirLogic ?? []) {
    for (const r of g) {
      const wp = wpByKey.get(r.field)
      if (!wp) return `salt-wordpress decides it from ${r.field}, which is not a sibling`
      const name = pairedName.get(wp.key)
      if (name) vars.set(name, ctx.mine.find((s) => s.name === name))
      else vars.set(`wp:${wp.name}`, wp)
    }
  }
  let combos = [{}]
  // A layout folded into a section with a source select holds that source and no select for it.
  for (const [name, f] of vars) {
    const samples = name in ctx.fixed ? [ctx.fixed[name]] : samplesFor(f)
    combos = combos.flatMap((c) => samples.map((v) => ({ ...c, [name]: v })))
  }
  // Read as the emitter's tests read them: only a sibling never set takes its default.
  const defaults = Object.fromEntries(ctx.mine.filter((s) => s.default_value !== undefined).map((s) => [s.name, s.default_value]))
  const disagree = []
  for (const combo of combos) {
    const a = shown(mineLogic, (key) => siblingValue(combo, byKey.get(key).name, defaults))
    const b = shown(theirLogic, (key) => {
      const wp = wpByKey.get(key)
      const name = pairedName.get(wp.key)
      return name ? toWordpress(ctx.defs.get(name)?.platforms?.wordpress?.values, siblingValue(combo, name, defaults)) : combo[`wp:${wp.name}`]
    })
    if (a !== b) disagree.push(`${JSON.stringify(combo)}: contract ${a ? 'shows' : 'hides'}, salt-wordpress ${b ? 'shows' : 'hides'}`)
  }
  return disagree.length ? `condition differs (${disagree.length} of ${combos.length} cases), e.g. ${disagree.slice(0, 2).join('; ')}` : null
}

const clausesOf = (def) => clauses(def?.condition)

const QUERY_PARTS = { source: 'mode', taxonomy_terms: 'categories', manual: 'items', orderby: 'order', order: 'direction', count: 'count' }

// entries: [{ e, def, at, siblings }] at one level; theirs: salt-wordpress's fields at that level.
function compareLevel(section, entries, theirs, prefix, parentDef, fixed = {}) {
  const wp = named(theirs)
  const claimed = new Map()
  const resolved = new Map()
  for (const entry of entries) {
    if (wp.some((n) => n.name === entry.e.name)) continue
    const former = formerlyOf(entry.def).map((f) => wp.find((n) => n.name === f)).filter((n) => n && !claimed.has(n.name))
    for (const n of former) claimed.set(n.name, entry)
    if (former.length) resolved.set(entry, former)
  }
  for (const entry of entries) {
    if (resolved.has(entry)) continue
    const n = wp.find((x) => x.name === entry.e.name)
    if (n && !claimed.has(n.name)) { claimed.set(n.name, entry); resolved.set(entry, [n]) }
  }
  // Conditions read siblings; pair each emitted sibling with the field salt-wordpress stores it in.
  const pairs = new Map([...resolved].map(([entry, ns]) => [entry.e.name, ns[0]]))
  const defs = new Map(entries.map((x) => [x.e.name, x.def]))
  for (const entry of entries) {
    const { e, def } = entry
    const at = `${prefix}${entry.at}`
    const found = resolved.get(entry)
    if (!found) { record(section, at, def, 'missing', 'not in salt-wordpress', parentDef); continue }
    if (found[0].name !== e.name) record(section, at, def, 'name', `stored as ${found.map((n) => n.name).join(', ')}`)
    if (def?.type === 'collection-query') { compareQuery(section, `${at}.`, e, found, def); continue }
    const ctx = { mine: entry.siblings, theirs: wp, pairs, defs, fixed }
    if (found[0].key && found[0].name === e.name && found[0].key !== e.key) keyRows.push({ section, at, mine: e.key, theirs: found[0].key })
    compareOne(section, at, e, found[0], def, ctx)
  }
  for (const n of wp) {
    if (claimed.has(n.name)) continue
    if (fixed.selector === n.name) {
      rows.push({ section, at: `${prefix}${n.name}`, kind: 'extra', text: 'in salt-wordpress, not in the contract', verdict: 'expected', evidence: `sections.json formerly: ${fixed.when}` })
      continue
    }
    record(section, `${prefix}${n.name}`, undefined, 'extra', 'in salt-wordpress, not in the contract', parentDef)
  }
}

function compareOne(section, at, e, n, def, ctx) {
  const values = wpNote(def)?.values
  const diffs = []
  const sameType = family(e.type) === family(n.type)
  if (!sameType) diffs.push(['type', `type ${e.type}; salt-wordpress ${n.type}`])
  if (e.choices && n.choices) {
    const mine = Object.keys(e.choices)
    const theirs = Object.keys(n.choices)
    if (mine.join('|') !== theirs.join('|')) {
      const mapped = theirs.map((v) => (typeof values?.[v] === 'string' ? values[v] : v))
      const why = mapped.join('|') === mine.join('|') ? 'values' : 'options'
      diffs.push([why, `choices ${mine.join(', ')}; salt-wordpress ${theirs.map((v) => (v === '' ? '(empty)' : v)).join(', ')}`])
    }
  }
  const norm = (f) => {
    const v = f.default_value
    if (f.type === 'true_false') return v === undefined || v === '' ? 0 : Number(v)
    return v === undefined || v === null ? '' : v
  }
  if (sameType && JSON.stringify(norm(e)) !== JSON.stringify(norm(n))) {
    const mapped = typeof values?.[n.default_value] === 'string' ? values[n.default_value] : undefined
    diffs.push([mapped !== undefined && mapped === e.default_value ? 'values' : 'default', `default ${show(norm(e))}; salt-wordpress ${show(norm(n))}`])
  }
  if (!!e.required !== !!n.required) diffs.push(['required', `required ${!!e.required}; salt-wordpress ${!!n.required}`])
  if (sameType) {
    for (const k of ['maxlength', 'min', 'max', 'step']) if (show(e[k]) !== show(n[k])) diffs.push(['limit', `${k} ${show(e[k])}; salt-wordpress ${show(n[k])}`])
    for (const k of ['post_type', 'taxonomy']) if (show(e[k]) !== show(n[k])) diffs.push(['relation', `${k} ${show(e[k])}; salt-wordpress ${show(n[k])}`])
  }
  const cond = compareConditions(e, n, ctx)
  if (cond) {
    // A condition on a sibling salt-wordpress does not have yet is owed with that sibling.
    const owed = clausesOf(def).map((c) => ctx.defs.get(c.field)).find((d) => !ctx.pairs.has(d?.name) && wpNote(d)?.owes)
    if (owed) rows.push({ section, at, kind: 'condition', text: cond, verdict: 'expected', evidence: `${owed.name} owes: ${wpNote(owed).owes}` })
    else diffs.push(['condition', cond])
  }
  for (const [kind, text] of diffs) {
    // A difference the field's values map explains is expected whatever else the note says.
    if (kind === 'values') rows.push({ section, at, kind, text, verdict: 'expected', evidence: `values: ${JSON.stringify(values)}` })
    else record(section, at, def, kind, text)
  }
  if (sameType && e.sub_fields && n.sub_fields) {
    const childDefs = def?.type === 'link' ? [] : def?.fields ?? []
    const entries = e.sub_fields.map((c) => ({ e: c, def: childDefs.find((d) => d.name === c.name), at: c.name, siblings: e.sub_fields }))
    compareLevel(section, entries, n.sub_fields, `${at}.`, def)
  }
}

// salt-wordpress stores a query as six fields on the layout; the query's note covers its parts,
// its values keyed by part (values.source for mode, values.orderby for order).
function compareQuery(section, prefix, e, found, def) {
  const note = wpNote(def)
  const theirs = found.map((n) => ({ ...n, name: QUERY_PARTS[n.name] ?? n.name }))
  const partDef = (name) => {
    const part = { mode: 'source', order: 'orderby' }[name]
    return part ? { platforms: { wordpress: { values: note?.values?.[part] ?? {} } } } : undefined
  }
  const before = rows.length
  const entries = e.sub_fields.map((c) => ({ e: c, def: partDef(c.name), at: c.name, siblings: e.sub_fields }))
  compareLevel(section, entries, theirs, prefix, def)
  for (const r of rows.slice(before)) {
    if (r.verdict === 'unexpected' && note) { r.verdict = 'expected'; r.evidence = `note: ${note.note ?? note.owes}` }
  }
}

const sectionRows = []
const used = new Set()
for (const layout of emitted) {
  const id = layout.name
  const s = contract.sections.find((x) => x.id === id)
  const formerly = s.platforms?.wordpress?.formerly ?? []
  const names = formerly.length ? formerly.map((f) => f.name) : [id]
  const theirs = names.map((n) => wpLayouts.find((l) => l.name === n)).filter(Boolean)
  if (!theirs.length) {
    const w = s.platforms?.wordpress
    sectionRows.push({ id, status: `not in salt-wordpress (sections.json: ${w?.status ?? 'none'}${w?.owes ? `, owes ${w.owes}` : ''})` })
    continue
  }
  const { fields, settings } = resolveSection(contract, id)
  for (const wl of theirs) {
    used.add(wl.name)
    const label = theirs.length > 1 ? `${id} (${wl.name})` : id
    if (wl.name !== id) {
      rows.push({ section: label, at: '(layout name)', kind: 'name', text: `name ${id}; salt-wordpress ${wl.name}`, verdict: 'expected', evidence: `sections.json formerly: ${wl.name}` })
    }
    // A layout folded into a section with a source select (sections.json: "source testimonials",
    // or the select's values keyed by layout) holds that one source; fields the contract hides
    // for it do not apply, and the field its `when` names is the one that chose the fold.
    const former = formerly.find((f) => f.name === wl.name)
    const sourceDef = fields.find((d) => d.name === 'source' && d.type === 'select')
    const fixed = {}
    if (sourceDef) {
      const value = /^source (\S+)$/.exec(former?.note ?? '')?.[1] ?? wpNote(sourceDef)?.values?.[wl.name]
      if (value) fixed.source = value
    }
    if (former?.when) Object.assign(fixed, { selector: former.when.split(' ')[0], when: `${wl.name} when ${former.when}` })
    const applies = (def) => clausesOf(def).every((c) => !(c.field in fixed) || ('equals' in c ? c.equals === fixed[c.field] : 'in' in c ? c.in.includes(fixed[c.field]) : true))
    // The settings group's fields are stored on the layout itself today, so they are matched there.
    const settingsGroup = layout.sub_fields.find((f) => f.name === 'settings')
    const entries = [
      ...layout.sub_fields.filter((f) => f !== settingsGroup && applies(fields.find((d) => d.name === f.name))).map((f) => ({ e: f, def: fields.find((d) => d.name === f.name), at: f.name, siblings: layout.sub_fields })),
      ...(settingsGroup?.sub_fields ?? []).map((f) => ({ e: f, def: settings.find((d) => d.name === f.name), at: `settings.${f.name}`, siblings: settingsGroup.sub_fields })),
    ]
    compareLevel(label, entries, wl.sub_fields, '', undefined, fixed)
    sectionRows.push({ id: label, status: `compared with ${wl.name}` })
  }
}
const unmatched = wpLayouts.filter((l) => !used.has(l.name)).map((l) => l.name)
const otherGroups = wpGroups.filter((g) => g.key !== 'group_salt_sections').map((g) => g.key)

// ── Report ─────────────────────────────────────────────────────────────────────────────────────

const expected = rows.filter((r) => r.verdict === 'expected')
const unexpected = rows.filter((r) => r.verdict === 'unexpected')
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')
const lines = [
  '# ACF round trip',
  '',
  'Generated by `node scripts/round_trip_acf.mjs <salt-wordpress>`; do not edit. It compares what',
  '`emit/acf.mjs` generates from this contract with the Flexible Content layouts salt-wordpress ships',
  `(salt ${wpVersion}, commit ${wpCommit}), section by section. salt-wordpress's field files were`,
  'loaded with `php` under its own test shims, as its bin/extract-slugs.php loads them, not parsed.',
  '',
  'Compared: field names, types (select, radio and button_group count as one: the widget stays',
  'native), choices, defaults, required, limits, the post types and taxonomy a relation reads, and',
  'conditional logic (by behaviour, over every combination of the siblings either side reads).',
  'Not compared: labels and instructions, which salt-wordpress words differently and SC-003 says',
  'must match, so adopting the emitter changes them throughout; and what stays native to ACF',
  '(return formats, wrapper widths, tabs, toolbars, row layouts).',
  '',
  '**Expected** means the contract records the difference in the field\'s `platforms.wordpress`',
  'note (`formerly`, `values`, `owes`, or a note on the condition), or sections.json records the',
  'layout\'s former name. **Unexpected** means nothing in the contract accounts for it. As in the',
  'Payload round trip, a field whose note owes something counts every difference on it as expected,',
  'so read the evidence column: it says which record covers each row. A part added or dropped inside',
  'a list, group or query is covered by its parent\'s note.',
  '',
  'Matching: the shared settings are stored on the layout itself today (section_spacing and the',
  'rest), so the contract\'s `settings.*` fields are matched there. Where several salt-wordpress',
  'layouts fold into one section, each is compared on its own; a layout that stands for one source',
  '(sections.json: "source testimonials", or the source select\'s values keyed by layout) is compared',
  'with that source chosen, so fields the contract hides for it are left out.',
  '',
  '## Summary',
  '',
  `${rows.length} differences: ${expected.length} expected, ${unexpected.length} unexpected.`,
  '',
  '| Section | Compared |',
  '| --- | --- |',
  ...sectionRows.map((s) => `| ${s.id} | ${cell(s.status)} |`),
  '',
  `salt-wordpress layouts no contract section claims: ${unmatched.length ? unmatched.join(', ') : 'none'}.`,
  '',
  `Field groups not compared, because the contract defines no fields for them: ${otherGroups.join(', ')}.`,
  '',
]
if (unexpected.length) {
  lines.push('## Unexpected', '', '| Section | Field | Difference |', '| --- | --- | --- |')
  for (const r of unexpected) lines.push(`| ${r.section} | \`${r.at}\` | ${cell(r.text)} |`)
  lines.push('')
}
lines.push('## Expected', '', '| Section | Field | Difference | Recorded as |', '| --- | --- | --- | --- |')
for (const r of expected) lines.push(`| ${r.section} | \`${r.at}\` | ${cell(r.text)} | ${cell(r.evidence)} |`)
lines.push('')
lines.push(
  '## Keys',
  '',
  'Fields matched by name (query parts by their mapped name) whose ACF key changes. ACF stores each',
  'value\'s key beside it (`_<name>`), so the migration that renames fields should rewrite those rows',
  'too, or they point at a key that no longer exists until the post is saved again.',
  '',
  '| Section | Field | Emitted key | salt-wordpress key |',
  '| --- | --- | --- | --- |',
  ...keyRows.map((r) => `| ${r.section} | \`${r.at}\` | \`${r.mine}\` | \`${r.theirs}\` |`),
  '',
)
const text = lines.join('\n')

if (check) {
  let committed = ''
  try { committed = readFileSync(reportPath, 'utf8') } catch { /* missing is stale */ }
  if (committed !== text) { console.log(`✗ ${path.relative(process.cwd(), reportPath)} is stale; regenerate it`); process.exit(1) }
  console.log('PASS: the round-trip report is current')
} else {
  writeFileSync(reportPath, text)
  console.log(`wrote ${path.relative(process.cwd(), reportPath)}: ${expected.length} expected, ${unexpected.length} unexpected`)
}
