// What every emitter reads from the contract, and nothing platform-specific: loading the contract
// files, resolving a section's shared settings, normalising a condition to a list of clauses, and
// the two fixed shapes (link and collection-query) the schema describes in prose. The Payload
// emitter (payload.mjs) and the ACF emitter use this one copy, so the two cannot drift apart on
// what a link or a collection-query holds.
//
// Pure data: reads the package's own JSON files and imports nothing outside Node.
import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))

/**
 * The contract as one object: { version, sections, settings, fields }. `sections` is
 * contract/sections.json's list in its own order; `settings` the shared settings file's fields;
 * `fields` a map of section id to its fields file. `dir` is the package directory, for tests.
 */
export function loadContract(dir = packageDir) {
  const vocab = readJson(path.join(dir, 'contract', 'sections.json'))
  const fieldsDir = path.join(dir, 'contract', 'fields')
  const fields = {}
  for (const name of readdirSync(fieldsDir).filter((f) => f.endsWith('.json')).sort()) {
    if (name === '_section-settings.json') continue
    const doc = readJson(path.join(fieldsDir, name))
    fields[doc.section] = doc
  }
  return {
    version: vocab.version,
    sections: vocab.sections,
    settings: readJson(path.join(fieldsDir, '_section-settings.json')).fields,
    fields,
  }
}

/**
 * A section's own fields and its shared settings with the section's `defaults` applied and its
 * `omit` left out. The settings are returned apart: each platform decides where the group lives.
 */
export function resolveSection(contract, id) {
  const section = contract.sections.find((s) => s.id === id)
  const doc = contract.fields[id]
  if (!section || !doc) throw new Error(`the contract has no section ${id}`)
  const omit = new Set(doc.shared?.omit ?? [])
  const defaults = doc.shared?.defaults ?? {}
  const settings = doc.shared
    ? contract.settings
      .filter((f) => !omit.has(f.name))
      .map((f) => (f.name in defaults ? { ...f, default: defaults[f.name] } : f))
    : []
  return { section, fields: doc.fields, settings }
}

/**
 * Whether text holds anything visible (SC-009): what is left after removing whitespace and the
 * zero-width characters U+200B to U+200D, U+2060 and U+FEFF. Text of nothing else is empty, for
 * conditions and for rendering.
 */
export const hasVisibleText = (text) =>
  typeof text === 'string' && text.replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, '') !== ''

// Every text node of a Lexical document, in order, so text split across nodes is judged whole.
const textOf = (node) =>
  !node || typeof node !== 'object' ? ''
    : (typeof node.text === 'string' ? node.text : '') + (Array.isArray(node.children) ? node.children.map(textOf).join('') : '')

/**
 * The schema's `filled`: a value an editor has given, by the sibling's type. Text, textarea and
 * rich text by hasVisibleText; a chosen image, option or relationship; a ticked boolean; any number.
 */
export function isFilled(value) {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return hasVisibleText(value)
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return !Number.isNaN(value)
  if (Array.isArray(value)) return value.length > 0
  // Lexical stores an emptied editor as a root holding an empty paragraph, which is not a value.
  if (typeof value === 'object' && 'root' in value) return hasVisibleText(textOf(value.root))
  return true
}

/**
 * The value a condition reads from a sibling. Only a sibling never set (undefined) takes its
 * contract default, as a new block is stored with it; a stored null is a cleared value and stays
 * no value, so the admin and the render read the same thing.
 */
export const siblingValue = (siblingData, name, defaults = {}) => {
  const raw = siblingData?.[name]
  return raw === undefined ? defaults[name] : raw
}

/**
 * Whether the module at `moduleUrl` is the script Node was asked to run. By real path: run through
 * a symlink (a pnpm or npm bin, a workspace link) argv[1] is the link while import.meta.url is the
 * file it points at, and a plain comparison would skip the CLI and exit 0.
 */
export function isMainModule(moduleUrl) {
  if (!process.argv[1]) return false
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(moduleUrl)) } catch { return false }
}

/** Whether one clause holds for a sibling's value (read by siblingValue; undefined when absent). */
export function clauseHolds(c, value) {
  if ('filled' in c) return isFilled(value) === c.filled
  if ('equals' in c) return value === c.equals
  return c.in.includes(value)
}

/**
 * An emitter CLI's arguments: `--check <snapshot>` or `--write <snapshot>`, not both, and an
 * optional `--options <file>`. Throws on a flag with no value, a flag given as a value, an unknown
 * argument, or neither action, so a typo never runs as something else. Returns
 * { check, write, options }, each a path or undefined.
 */
export function parseEmitterArguments(argv) {
  const values = { '--check': undefined, '--write': undefined, '--options': undefined }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    if (!(flag in values)) throw new Error(`unknown argument ${flag}`)
    const value = argv[i + 1]
    if (value === undefined) throw new Error(`${flag} needs a value`)
    if (value.startsWith('--')) throw new Error(`${flag} needs a value, not the flag ${value}`)
    values[flag] = value
    i++
  }
  const { '--check': check, '--write': write, '--options': options } = values
  if (check && write) throw new Error('--check and --write cannot be used together')
  if (!check && !write) throw new Error('pass --check <snapshot> or --write <snapshot>')
  return { check, write, options }
}

/** Text with CRLF line endings as LF, so a Windows checkout of a committed snapshot compares equal. */
export const normaliseLineEndings = (text) => text.replace(/\r\n/g, '\n')

/** A condition as a list of clauses, all of which must hold; [] for none. */
export const clauses = (condition) => (condition === undefined ? [] : [condition].flat())

const SCALAR = (v) => ['string', 'boolean', 'number'].includes(typeof v)

/** Whether a clause has the shape the field schema's $defs.clause allows. */
export function isClause(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return false
  if (typeof c.field !== 'string' || !/^[a-z][a-zA-Z0-9]*$/.test(c.field)) return false
  if (Object.keys(c).some((k) => !['field', 'equals', 'in', 'filled'].includes(k))) return false
  const tests = ['equals', 'in', 'filled'].filter((k) => k in c)
  if (tests.length !== 1) return false
  if ('equals' in c) return SCALAR(c.equals)
  if ('filled' in c) return typeof c.filled === 'boolean'
  return Array.isArray(c.in) && c.in.length > 0 && new Set(c.in).size === c.in.length &&
    c.in.every((v) => typeof v === 'string' || typeof v === 'number')
}

/**
 * clauses(), refusing any clause the schema would refuse (isClause). The schema holds the contract
 * files to this; a contract built in code reaches the emitter without it. `where` names the field.
 */
export function checkedClauses(condition, where) {
  if (Array.isArray(condition) && condition.length < 2) {
    throw new Error(`${where} condition: a condition is one clause or a list of at least two`)
  }
  const list = clauses(condition)
  for (const c of list) {
    if (!isClause(c)) {
      throw new Error(`${where} condition: ${JSON.stringify(c)}: a clause is an object with a field name and exactly one of equals, an in list or a true or false filled`)
    }
  }
  return list
}

/** Source ids that hold items (field-definition schema, $defs.source). */
export const SOURCES = ['services', 'case-studies', 'testimonials', 'posts', 'team', 'faqs', 'locations']

/** The source ids among a select's options, in its order; [] for no select. */
export const sourceValues = (select) => (select?.options ?? []).map((o) => o.value).filter((v) => SOURCES.includes(v))

/**
 * What a select that picks a collection-query's source (its sourceField) can offer a site.
 *
 * `select` is the contract's select field; `installed` a Set of the source ids the site has.
 * Returns `options`, the select's options the site can satisfy, in contract order: an installed
 * source, or a value that is not a source at all (the carousel's inline cards); and `sources`, the
 * installed source ids among them, in the same order. An emitter offers `options`, queries
 * `sources`, and cannot carry the section when `options` is empty.
 */
export function offeredSources(select, installed) {
  const options = (select?.options ?? []).filter((o) => !SOURCES.includes(o.value) || installed.has(o.value))
  return { options, sources: sourceValues(select).filter((v) => installed.has(v)) }
}

/** The names of the selects that a sibling collection-query reads its source from. */
export const sourceSelectsOf = (fields) =>
  new Set(fields.filter((f) => f.type === 'collection-query' && f.sourceField).map((f) => f.sourceField))

/**
 * A section's fields fitted to the installed sources. Each source select is replaced by a copy whose
 * options are offeredSources' options, computed once here, so an emitter offers `options` as given
 * and never re-applies the rule; its default is kept only while it is still offered, so it may
 * have none. Left out: a collection-query read from a select that offers no
 * installed source, and a field whose condition names a source select only by values that select
 * no longer offers (the carousel's showTags with no source that has categories), and any field
 * whose condition on a field left out cannot hold with that field absent, or whose source select is
 * left out. A kept field's clauses on a field left out (which hold with it absent) are removed.
 * A select left with no option is unmetSources' to report. Expects fields whose
 * conditions checkedClauses has passed, as planSections ensures; it does not check them again.
 * Top level only: checkFields keeps source selects and their queries there.
 */
export function withinSources(fields, installed) {
  const selects = sourceSelectsOf(fields)
  const narrow = (f) => {
    const { default: was, ...rest } = f
    const options = offeredSources(f, installed).options
    // A default the select no longer offers is dropped, never emitted as a value it cannot hold.
    return options.some((o) => o.value === was) ? { ...rest, options, default: was } : { ...rest, options }
  }
  const narrowed = fields.map((f) => (selects.has(f.name) ? narrow(f) : f))
  const valuesOf = (name) => narrowed.find((s) => s.name === name).options.map((o) => o.value)
  const reachable = (f) => clauses(f.condition).every((c) => {
    if (!selects.has(c.field) || 'filled' in c) return true
    return ('equals' in c ? [c.equals] : c.in).some((v) => valuesOf(c.field).includes(v))
  })
  const queriesNothing = (f) => f.sourceField && sourceValues(narrowed.find((s) => s.name === f.sourceField)).length === 0
  // A field conditioned on one left out goes too, and so on down the chain, when that clause cannot
  // hold with the field absent; one that can (filled: false) still shows, reading no value there.
  const gone = new Set(narrowed.filter((f) => queriesNothing(f) || !reachable(f)).map((f) => f.name))
  const hidden = (f) => clauses(f.condition).some((c) => gone.has(c.field) && !clauseHolds(c, undefined))
  for (let grew = true; grew;) {
    grew = false
    for (const f of narrowed) {
      // A query whose source select is gone has nothing to read its source from.
      if (!gone.has(f.name) && (hidden(f) || (f.sourceField && gone.has(f.sourceField)))) { gone.add(f.name); grew = true }
    }
  }
  // A kept field's clauses on a field left out hold with it absent; they are removed, so no
  // condition names a sibling that is not there. One clause left stands alone, none drops it.
  return narrowed.filter((f) => !gone.has(f.name)).map((f) => {
    const list = clauses(f.condition)
    const kept = list.filter((c) => !gone.has(c.field))
    if (kept.length === list.length) return f
    const { condition, ...rest } = f
    return kept.length === 0 ? rest : { ...rest, condition: kept.length === 1 ? kept[0] : kept }
  })
}

/**
 * What fields fitted by withinSources need from the site's sources and the site lacks, one line
 * each, naming the field: a collection-query's fixed source or a relationship's source not
 * installed, or a source select left with no option. `unfitted` is the same fields before fitting,
 * which says which selects are source selects and what they offered. Payload refuses to start with
 * a relationship to a collection it does not have, and ACF has nothing to point one at.
 */
export function unmetSources(fields, installed, at, unfitted = fields) {
  const selects = sourceSelectsOf(unfitted)
  return fields.flatMap((f) => {
    const where = `${at}.${f.name}`
    const need = f.type === 'collection-query' ? f.source : f.type === 'relationship' ? f.to : undefined
    const own = need && !installed.has(need) ? [`the source ${need} (${where})`] : []
    if (selects.has(f.name) && f.options.length === 0) {
      own.push(`one of the sources ${sourceValues(unfitted.find((u) => u.name === f.name)).join(', ')} (${where})`)
    }
    const below = unfitted.find((u) => u.name === f.name)?.fields ?? f.fields
    return [...own, ...(f.fields ? unmetSources(f.fields, installed, where, below) : [])]
  })
}

// Every condition and every sourceField at every depth, refused before anything is narrowed, so
// whether a fault is caught never depends on which sources a site installs. `depth` is 0 for a
// section's own fields; its settings start at 1, as they sit in a group.
//
// A query reading its source from a select sits with that select at the section's top level: the
// Payload pickers find the select on the block (blockData), and no section needs it deeper. The
// shape is refused in the contract, for every site, rather than supported with per-site edge cases.
function checkFields(fields, at, depth = 0) {
  for (const f of fields) {
    const where = `${at}.${f.name}`
    checkedClauses(f.condition, where)
    if (f.sourceField && depth > 0) {
      throw new Error(`${where}: a collection-query reading its source from a select must sit, with that select, at the section's top level, not in a list, a group or the settings`)
    }
    if (f.sourceField) {
      const select = fields.find((s) => s.name === f.sourceField && s.type === 'select')
      if (!select) throw new Error(`${where}: sourceField ${f.sourceField} names no sibling select`)
      if (sourceValues(select).length === 0) throw new Error(`${where}: sourceField ${f.sourceField} names no sibling select offering a source`)
    }
    if (f.fields) checkFields(f.fields, where, depth + 1)
  }
}

/**
 * The one entry point every emitter plans its sections with, so the emitters cannot disagree about
 * which sections a site gets or what their source selects offer.
 *
 *   installed  a Set of the source ids the site has (every source when left out)
 *   sections   the section ids asked for, in order; null or left out means every section in
 *              sections.json, each left out when the site cannot carry it
 *
 * Returns { sections: [{ id, section, fields, settings }], leftOut: [{ id, needs }] }: fields and
 * settings fitted by withinSources. A section asked for by name that the site cannot carry throws,
 * naming what it needs. A fault in the contract's own shape (checkFields) throws for every site.
 * Each section is resolved once.
 */
export function planSections(contract, { installed = new Set(SOURCES), sections } = {}) {
  const named = sections != null
  const kept = []
  const leftOut = []
  for (const id of sections ?? contract.sections.map((s) => s.id)) {
    // The section's own fields and its shared settings, treated alike.
    const { section, fields: all, settings: allSettings } = resolveSection(contract, id)
    checkFields(all, id)
    checkFields(allSettings, `${id}.settings`, 1)
    const fields = withinSources(all, installed)
    const settings = withinSources(allSettings, installed)
    const needs = [
      ...unmetSources(fields, installed, id, all),
      ...unmetSources(settings, installed, `${id}.settings`, allSettings),
    ]
    if (needs.length && named) throw new Error(`section ${id} needs ${needs.join(', ')}, which options.sources does not install`)
    if (needs.length) leftOut.push({ id, needs })
    else kept.push({ id, section, fields, settings })
  }
  return { sections: kept, leftOut }
}

/**
 * The link's fixed shape (field-definition schema, "link"). `withLabel: false` drops `label`.
 * `requiredWithLink` marks the parts a required link must have.
 */
export const LINK_SHAPE = [
  { name: 'label', type: 'text', label: 'Label', description: 'The visible text of the link.', requiredWithLink: true },
  {
    name: 'type',
    type: 'select',
    label: 'Type',
    options: [
      { value: 'internal', label: 'A page on this site' },
      { value: 'external', label: 'An external address' },
    ],
    default: 'internal',
  },
  {
    name: 'document',
    type: 'relationship',
    label: 'Document',
    condition: { field: 'type', equals: 'internal' },
    requiredWithLink: true,
  },
  {
    name: 'url',
    type: 'text',
    format: 'url',
    label: 'Address',
    condition: { field: 'type', equals: 'external' },
    requiredWithLink: true,
  },
  { name: 'newTab', type: 'boolean', label: 'Open in a new tab' },
]

/**
 * The collection-query's fixed shape (field-definition schema, "COLLECTION-QUERY"). `categories`
 * exists only where the source has categories; `modes` narrows mode's options; `max` is count's
 * ceiling, 24 unless the field says otherwise.
 */
export const COLLECTION_QUERY_MAX = 24
export const COLLECTION_QUERY_MODES = [
  { value: 'automatic', label: 'Automatic (the collection’s usual order)' },
  { value: 'by-category', label: 'By category' },
  { value: 'manual', label: 'Chosen by hand' },
]
export const COLLECTION_QUERY_ORDERS = [
  { value: 'default', label: 'The collection’s usual order' },
  { value: 'newest', label: 'Newest first' },
  { value: 'title', label: 'Title (A to Z)' },
]

export function collectionQueryShape({ modes, max = COLLECTION_QUERY_MAX, hasCategories }) {
  const offered = COLLECTION_QUERY_MODES
    .filter((m) => !modes || modes.includes(m.value))
    .filter((m) => m.value !== 'by-category' || hasCategories)
  const notManual = offered.filter((m) => m.value !== 'manual').map((m) => m.value)
  // "Shown unless mode is manual": written as the modes that are not manual, the only form a
  // contract condition has. With manual the only mode there is nothing to show it for.
  const unlessManual = notManual.length ? { field: 'mode', in: notManual } : null
  return [
    { name: 'mode', type: 'select', label: 'Mode', options: offered, default: offered[0].value },
    ...(offered.some((m) => m.value === 'by-category')
      ? [{ name: 'categories', type: 'relationship', label: 'Categories', many: true, part: 'categories', condition: { field: 'mode', equals: 'by-category' } }]
      : []),
    ...(offered.some((m) => m.value === 'manual')
      ? [{ name: 'items', type: 'relationship', label: 'Items', many: true, part: 'items', condition: { field: 'mode', equals: 'manual' } }]
      : []),
    ...(unlessManual
      ? [
        { name: 'order', type: 'select', label: 'Order', options: COLLECTION_QUERY_ORDERS, default: 'default', condition: unlessManual },
        { name: 'count', type: 'number', label: 'How many', description: `0 uses the section’s default. At most ${max}.`, min: 0, max, step: 1, default: 0, condition: unlessManual },
      ]
      : []),
  ]
}
