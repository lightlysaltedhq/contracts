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

/** Text with CRLF line endings as LF, so a Windows checkout of a committed snapshot compares equal. */
export const normaliseLineEndings = (text) => text.replace(/\r\n/g, '\n')

/** A condition as a list of clauses, all of which must hold; [] for none. */
export const clauses = (condition) => (condition === undefined ? [] : [condition].flat())

/**
 * clauses(), refusing a clause that tests nothing or two things. The schema refuses both (its
 * oneOf); this holds a contract built in code, which no schema sees, to the same rule. `where`
 * names the field in the message.
 */
export function checkedClauses(condition, where) {
  const list = clauses(condition)
  for (const c of list) {
    if (['equals', 'in', 'filled'].filter((k) => k in c).length !== 1) {
      throw new Error(`${where} condition on ${c.field}: a clause tests exactly one of equals, in or filled`)
    }
  }
  return list
}

/** Source ids that hold items (field-definition schema, $defs.source). */
export const SOURCES = ['services', 'case-studies', 'testimonials', 'posts', 'team', 'faqs', 'locations']

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
