// The Payload emitter: each section's field half, as the Payload `Block` config Salt for Next.js
// composes into its pages collection, generated from contract/fields.
//
// ── A runtime function, not generated source ─────────────────────────────────────────────────
//
// Payload's conditions are functions (`admin.condition`), so the output cannot be plain JSON. Of
// the two ways round that, this is a function the consumer calls when it builds its config,
// `toPayloadBlocks(options)`, returning config objects whose conditions are closures over the
// contract's clauses. Generated TypeScript was the alternative and costs more for nothing: a
// second artefact to commit and keep formatted, a code printer to maintain, and a generated file
// that can be edited by hand and drift silently. Here the closures are the only thing JSON cannot
// carry, and each field also records the clauses it was built from under `custom.salt`, so
// `payloadSnapshot(options)` is the same objects through JSON.stringify: functions and the rich
// text editor drop out, the declarative condition stays. That snapshot is what the consumer
// commits and `checkPayloadSnapshot` diffs, so a renamed field fails the consumer's check before
// anything type-checks.
//
// Pure data: no Payload import, and nothing read but the contract's own files. What the contract
// leaves to the platform (admin components, hooks, validators, enum names beyond these) is the
// consumer's to add; `custom.salt` says what each field was generated from so it can.
//
// Byte-stable: objects are built in the contract's order with a fixed key order, and nothing reads
// the clock, the environment or the file system's listing order.
import { readFileSync, writeFileSync } from 'node:fs'

import { clauseHolds, clauses, collectionQueryShape, hasVisibleText, isFilled, isMainModule, LINK_SHAPE, loadContract,
  normaliseLineEndings, planSections, siblingValue, sourceValues, SOURCES } from './_contract.mjs'

/**
 * Each source's Payload collection and category taxonomy, as Salt for Next.js names them by
 * default. A site that renames a module passes `sources`. `null`: the source has no categories.
 */
export const SOURCE_DEFAULTS = {
  services: { collection: 'services', taxonomy: 'service-categories' },
  'case-studies': { collection: 'case-studies', taxonomy: 'case-study-types' },
  testimonials: { collection: 'testimonials', taxonomy: null },
  posts: { collection: 'posts', taxonomy: 'topics' },
  team: { collection: 'users', taxonomy: null },
  faqs: { collection: 'faqs', taxonomy: 'faq-categories' },
  locations: { collection: 'locations', taxonomy: null },
}

const HEADING_KINDS = { h2: 'heading-2', h3: 'heading-3', h4: 'heading-4' }

const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/-/g, '_').toLowerCase()
const pascal = (s) => s.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('')

// ── Conditions ─────────────────────────────────────────────────────────────────────────────────

export { hasVisibleText, isFilled }

/** Whether every clause holds for these siblings, each read by siblingValue. */
export function clausesHold(list, siblingData, defaults = {}) {
  return list.every((c) => clauseHolds(c, siblingValue(siblingData, c.field, defaults)))
}

const conditionFor = (list, defaults) => (_data, siblingData) => clausesHold(list, siblingData, defaults)

// ── Fields ─────────────────────────────────────────────────────────────────────────────────────

function sourcesFrom(options) {
  const given = options.sources
  const installed = given ? SOURCES.filter((s) => s in given) : SOURCES
  return Object.fromEntries(installed.map((s) => [s, { ...SOURCE_DEFAULTS[s], ...(given?.[s] ?? {}) }]))
}

function allowedFor(field, headings) {
  if (!headings) return field.allowed
  const contractHeadings = field.allowed.filter((k) => k.startsWith('heading-'))
  if (contractHeadings.length === 0) return field.allowed
  const wanted = headings.map((h) => HEADING_KINDS[h] ?? h)
  for (const k of wanted) {
    if (!contractHeadings.includes(k)) {
      throw new Error(`headings: ${k} is not allowed by the contract, which allows ${contractHeadings.join(', ')}`)
    }
  }
  return field.allowed.filter((k) => !k.startsWith('heading-') || wanted.includes(k))
}

function enumNameFor(ctx, name) {
  if (ctx.enumPrefix) return `${ctx.enumPrefix}_${snake(name)}`
  return `enum_${[ctx.scope, ...ctx.path, name].map(snake).join('_')}`
}

const defaultsOf = (fields) =>
  Object.fromEntries(fields.filter((f) => f.default !== undefined).map((f) => [f.name, f.default]))

function convertFields(fields, ctx) {
  const defaults = defaultsOf(fields)
  return fields.map((f) => convertField(f, { ...ctx, defaults, siblings: fields }))
}

function convertField(f, ctx) {
  const { options } = ctx
  const salt = {}
  const admin = {}
  const out = { name: f.name }
  if (f.description) admin.description = f.description
  // planSections has validated every condition; this only reads them.
  const list = clauses(f.condition)
  if (list.length) {
    salt.condition = list
    admin.condition = conditionFor(list, ctx.defaults)
  }
  if (f.deprecated) salt.deprecated = f.deprecated
  const below = { ...ctx, path: [...ctx.path, f.name] }

  switch (f.type) {
    case 'text':
    case 'textarea':
      out.type = f.type
      out.label = f.label
      if (f.required) out.required = true
      if (f.maxLength !== undefined) out.maxLength = f.maxLength
      if (f.default !== undefined) out.defaultValue = f.default
      if (f.format) salt.format = f.format
      break
    case 'rich-text': {
      out.type = 'richText'
      out.label = f.label
      if (f.required) out.required = true
      const allowed = allowedFor(f, options.headings)
      salt.allowed = allowed
      if (!ctx.snapshot) {
        if (typeof options.richTextEditor !== 'function') {
          throw new Error(`${ctx.scope}.${[...ctx.path, f.name].join('.')} is rich text: pass richTextEditor(allowed), which returns the Payload editor for that allowed list`)
        }
        out.editor = options.richTextEditor(allowed)
      }
      break
    }
    case 'image':
      out.type = 'upload'
      out.label = f.label
      out.relationTo = options.mediaSlug ?? 'media'
      if (f.required) out.required = true
      if (f.many) {
        out.hasMany = true
        if (f.min !== undefined) out.minRows = f.min
        if (f.max !== undefined) out.maxRows = f.max
      }
      break
    case 'select': {
      out.type = 'select'
      out.label = f.label
      if (f.required) out.required = true
      let opts = f.options
      if (f.optionsFrom === 'icons') {
        if (!Array.isArray(options.icons)) {
          throw new Error(`${ctx.scope}.${[...ctx.path, f.name].join('.')} offers the site's icons: pass icons, a list of { value, label }`)
        }
        salt.optionsFrom = 'icons'
        opts = options.icons
      }
      out.enumName = enumNameFor(ctx, f.name)
      out.options = opts.map((o) => ({ label: o.label, value: o.value }))
      if (f.default !== undefined) out.defaultValue = f.default
      break
    }
    case 'boolean':
      out.type = 'checkbox'
      out.label = f.label
      if (f.required) out.required = true
      if (f.default !== undefined) out.defaultValue = f.default
      break
    case 'number':
      out.type = 'number'
      out.label = f.label
      if (f.required) out.required = true
      if (f.min !== undefined) out.min = f.min
      if (f.max !== undefined) out.max = f.max
      if (f.step !== undefined) admin.step = f.step
      if (f.default !== undefined) out.defaultValue = f.default
      break
    case 'list':
      out.type = 'array'
      out.label = f.label
      if (f.required) out.required = true
      if (f.itemLabel) out.labels = { singular: f.itemLabel, plural: f.label }
      if (f.min !== undefined) out.minRows = f.min
      if (f.max !== undefined) out.maxRows = f.max
      if (f.rowLabel) {
        // A link names its row by its label (schema: rowLabel).
        const child = f.fields.find((c) => c.name === f.rowLabel)
        salt.rowLabel = child?.type === 'link' ? `${f.rowLabel}.label` : f.rowLabel
      }
      out.fields = convertFields(f.fields, below)
      break
    case 'group':
      out.type = 'group'
      out.label = f.label
      out.fields = convertFields(f.fields, below)
      break
    case 'relationship': {
      out.type = 'relationship'
      out.label = f.label
      // A link's document and a collection-query's parts have no `to`; their callers set it.
      if (f.to) {
        out.relationTo = ctx.sources[f.to].collection
        salt.to = f.to
      } else if (ctx.link) {
        out.relationTo = [...(options.linkTo ?? ['pages'])]
      }
      if (f.required) out.required = true
      if (f.many) {
        out.hasMany = true
        if (f.min !== undefined) out.minRows = f.min
        if (f.max !== undefined) out.maxRows = f.max
      }
      break
    }
    case 'link': {
      out.type = 'group'
      out.label = f.label
      const withLabel = f.withLabel !== false
      if (!withLabel) salt.withLabel = false
      salt.link = true
      const shape = LINK_SHAPE.filter((p) => withLabel || p.name !== 'label').map((p) => {
        const { requiredWithLink, ...part } = p
        return requiredWithLink && f.required ? { ...part, required: true } : part
      })
      out.fields = convertFields(shape, { ...below, enumPrefix: 'enum_link', link: true })
      break
    }
    case 'collection-query':
      out.type = 'group'
      out.label = f.label
      Object.assign(salt, collectionQuery(f, out, below))
      break
    default:
      throw new Error(`${ctx.scope}.${f.name}: no Payload mapping for field type ${f.type}`)
  }
  if (Object.keys(admin).length) out.admin = admin
  if (Object.keys(salt).length) out.custom = { salt }
  return out
}

function collectionQuery(f, out, ctx) {
  const salt = {}
  let offered
  if (f.source) {
    offered = [f.source]
    salt.source = f.source
  } else {
    // The select comes narrowed by planSections, so its source values are the installed ones.
    offered = sourceValues(ctx.siblings.find((s) => s.name === f.sourceField))
    salt.sourceField = f.sourceField
  }
  const slugs = offered.map((s) => ctx.sources[s])
  const taxonomies = slugs.map((s) => s.taxonomy).filter(Boolean)
  const collections = slugs.map((s) => s.collection)
  if (f.modes) salt.modes = f.modes
  if (f.max !== undefined) salt.max = f.max
  const shape = collectionQueryShape({ modes: f.modes, max: f.max, hasCategories: taxonomies.length > 0 })
  const modeValues = shape[0].options.map((o) => o.value)
  // One Postgres type per vocabulary (salt-nextjs BD-035): the full mode set shares one name, a
  // narrowed set is named by its values.
  const modeEnum = modeValues.length === 3 ? 'enum_query_mode' : `enum_query_mode_${modeValues.map(snake).join('_')}`
  out.fields = convertFields(shape.map(({ part, ...p }) => p), { ...ctx, enumPrefix: 'enum_query' }).map((field) => {
    if (field.name === 'mode') return { ...field, enumName: modeEnum }
    if (field.name !== 'categories' && field.name !== 'items') return field
    const targets = field.name === 'categories' ? taxonomies : collections
    const relation = { ...field, relationTo: targets.length === 1 ? targets[0] : targets }
    if (targets.length > 1) {
      // Several collections are offered by a sibling source select, so a picker offers only the
      // collection that select names. Its value lives on the block, a level above this group.
      const pick = (source) => (field.name === 'categories' ? ctx.sources[source]?.taxonomy : ctx.sources[source]?.collection)
      relation.filterOptions = ({ relationTo, blockData }) => {
        const chosen = blockData?.[f.sourceField]
        return chosen === undefined || chosen === null || relationTo === pick(chosen)
      }
    }
    return relation
  })
  return salt
}

// ── Blocks ─────────────────────────────────────────────────────────────────────────────────────

function build(options, snapshot) {
  const contract = options.contract ?? loadContract()
  const sources = sourcesFrom(options)
  const plan = planSections(contract, { installed: new Set(Object.keys(sources)), sections: options.sections })
  return plan.sections.map(({ id, section, fields, settings }) => {
    const base = { options, snapshot, sources, scope: id, path: [] }
    const out = convertFields(fields, base)
    if (settings.length) {
      out.push({
        name: 'settings',
        type: 'group',
        label: 'Section settings',
        fields: convertFields(settings, { ...base, scope: 'section' }),
      })
    }
    return {
      slug: id,
      interfaceName: `${pascal(id)}Block`,
      labels: { singular: section.label, plural: section.label },
      fields: out,
    }
  })
}

/**
 * Every section's Payload block config, conditions as functions.
 *
 * options:
 *   mediaSlug       the upload collection behind every image field ('media')
 *   linkTo          collections an internal link may point at (['pages'])
 *   headings        the body heading levels a site offers, as ['h3', 'h4']; narrows each rich
 *                   text field that allows headings, and may not add one the contract refuses
 *   icons           the site's icon registry, [{ value, label }]; required when a section uses it
 *   sources         { [source id]: { collection?, taxonomy? } } for the sources the site has;
 *                   all of them, with SOURCE_DEFAULTS' slugs, when left out
 *   richTextEditor  (allowed) => the Payload editor for that allowed list; required for rich text
 *   sections        the section ids to emit, in this order; one the site's sources cannot carry
 *                   throws. Left out or null: every section in sections.json the sources can
 *                   carry. planSections in _contract.mjs decides, for every emitter
 *   contract        a loaded contract (loadContract()), for tests
 */
export function toPayloadBlocks(options = {}) {
  return build(options, false)
}

/** The blocks as deterministic JSON: what a consumer commits, and what drift is measured against. */
export function serialisePayloadBlocks(blocks) {
  return JSON.stringify(blocks, (key, value) => (key === 'editor' ? undefined : value), 2) + '\n'
}

/** The snapshot of the blocks these options give. Needs no richTextEditor. */
export function payloadSnapshot(options = {}) {
  return serialisePayloadBlocks(build(options, true))
}

// ── Drift ──────────────────────────────────────────────────────────────────────────────────────

const keyOf = (item) => (item && typeof item === 'object' ? item.slug ?? item.name ?? item.value : undefined)

function diff(was, now, at, out) {
  if (Array.isArray(was) && Array.isArray(now) && [...was, ...now].every((x) => keyOf(x) !== undefined)) {
    const a = new Map(was.map((x) => [keyOf(x), x]))
    const b = new Map(now.map((x) => [keyOf(x), x]))
    for (const k of a.keys()) if (!b.has(k)) out.push(`${at}[${k}] is in the snapshot and no longer generated`)
    for (const k of b.keys()) if (!a.has(k)) out.push(`${at}[${k}] is generated and not in the snapshot`)
    const common = [...a.keys()].filter((k) => b.has(k))
    if (common.join('\0') !== [...b.keys()].filter((k) => a.has(k)).join('\0')) out.push(`${at} is in a different order`)
    for (const k of common) diff(a.get(k), b.get(k), `${at}[${k}]`, out)
    return
  }
  const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x)
  if (isObj(was) && isObj(now)) {
    for (const k of new Set([...Object.keys(was), ...Object.keys(now)])) {
      if (!(k in now)) out.push(`${at}.${k} is in the snapshot and no longer generated`)
      else if (!(k in was)) out.push(`${at}.${k} is generated and not in the snapshot`)
      else diff(was[k], now[k], `${at}.${k}`, out)
    }
    return
  }
  if (JSON.stringify(was) !== JSON.stringify(now)) out.push(`${at} was ${JSON.stringify(was)}, is now ${JSON.stringify(now)}`)
}

/**
 * Regenerate with `options` and compare with a committed snapshot (its text). `ok` is true only
 * when the two are byte-identical; `problems` names each difference by path, as
 * `blocks[hero].fields[heading] is in the snapshot and no longer generated`.
 */
export function checkPayloadSnapshot(snapshot, options = {}) {
  const now = normaliseLineEndings(payloadSnapshot(options))
  snapshot = normaliseLineEndings(snapshot)
  if (now === snapshot) return { ok: true, problems: [] }
  let was
  try { was = JSON.parse(snapshot) } catch (e) { return { ok: false, problems: [`the snapshot is not JSON: ${e.message}`] } }
  const problems = []
  diff(was, JSON.parse(now), 'blocks', problems)
  // Same structure, different bytes: formatting, which a regenerated snapshot fixes.
  if (!problems.length) problems.push('the snapshot differs from the generated text only in formatting; regenerate it')
  return { ok: false, problems }
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────
// node emit/payload.mjs --check <snapshot.json> [--options <options.json>]   exit 1 on drift
// node emit/payload.mjs --write <snapshot.json> [--options <options.json>]
// The options file holds the JSON-expressible options (mediaSlug, linkTo, headings, icons, sources,
// sections). A consumer with its options in code calls checkPayloadSnapshot instead.

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2)
  const flag = (name) => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1] }
  const optionsFile = flag('--options')
  const options = optionsFile ? JSON.parse(readFileSync(optionsFile, 'utf8')) : {}
  const check = flag('--check')
  const write = flag('--write')
  if (write) {
    writeFileSync(write, payloadSnapshot(options))
    console.log(`wrote ${write}`)
  } else if (check) {
    const { ok, problems } = checkPayloadSnapshot(readFileSync(check, 'utf8'), options)
    if (!ok) {
      for (const p of problems) console.log(`✗ ${p}`)
      console.log(`${check} has drifted from @lightlysaltedhq/salt-contract; regenerate it with --write and review the change`)
      process.exit(1)
    }
    console.log(`PASS: ${check} matches the contract`)
  } else {
    console.error('usage: payload.mjs --check <snapshot.json> | --write <snapshot.json> [--options <options.json>]')
    process.exit(2)
  }
}
