// The ACF emitter: each section's field half, as the Flexible Content layout Salt for WordPress
// registers in its page sections field group, generated from contract/fields.
//
// ── ACF JSON, not generated PHP ─────────────────────────────────────────────────────────────────
//
// ACF's conditions are data (`conditional_logic`), so unlike Payload's the whole field group is
// plain JSON. The output is a list of field groups in the shape ACF JSON uses, which is the same
// array `acf_add_local_field_group()` takes: a PHP consumer reads the committed file with
// `json_decode( $json, true )` and registers each group, or drops it into `acf-json/`. Generated
// PHP was the alternative and costs more for nothing: a printer to maintain for PHP's array
// syntax and `__()` calls, and a second artefact that can be edited by hand and drift silently.
// The snapshot the consumer commits is the output itself, so `checkAcfSnapshot` diffs exactly what
// the site registers.
//
// Names are the contract's: a field's `name` is its canonical id and a layout's `name` its section
// id, which is what the contract's `platforms.wordpress.formerly` notes migrate from. Keys follow
// salt-wordpress's DATA02 convention, derived from the contract path so they never depend on the
// order fields are emitted in: layouts `layout_salt_{section}`, fields
// `field_salt_{section}_{path}`, each part snake_cased (`field_salt_media_text_rows_media_side`).
// Shared settings sit in a group named `settings` on every layout, as the contract stores them.
// Each field records what it was generated from under `salt` (rich text's allowed list, a text
// format, a list's row label, a link's or query's shape); ACF keeps unknown keys on a field, so the
// consumer's renderer and sanitiser can read them.
//
// Pure data: no WordPress, and nothing read but the contract's own files.
//
// Byte-stable: objects are built in the contract's order with a fixed key order, and nothing reads
// the clock, the environment or the file system's listing order. Nothing writes ACF's `modified`
// timestamp, which a consumer loading the groups from code does not need.
import { readFileSync, writeFileSync } from 'node:fs'

import { allowedFor, clauses, collectionQueryShape, diffSnapshots, isMainModule, LINK_SHAPE, loadContract, normaliseLineEndings, resolveSection, SOURCES } from './_contract.mjs'

/**
 * Each source's post type and category taxonomy, as Salt for WordPress registers them by default.
 * A site that renames a module passes `sources`. `null`: the source has no categories.
 */
export const SOURCE_DEFAULTS = {
  services: { postType: 'service', taxonomy: 'service_category' },
  'case-studies': { postType: 'work', taxonomy: 'work_type' },
  testimonials: { postType: 'testimonial', taxonomy: null },
  posts: { postType: 'post', taxonomy: 'category' },
  team: { postType: 'team_member', taxonomy: 'department' },
  faqs: { postType: 'faq', taxonomy: 'faq_category' },
  locations: { postType: 'location', taxonomy: 'location_area' },
}

export const SECTIONS_GROUP_KEY = 'group_salt_sections'
// The container's key predates the contract; changing it would orphan every stored page's sections.
const CONTAINER_KEY = 'field_salt_sections_container'

const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/-/g, '_').toLowerCase()

// ── Conditions ─────────────────────────────────────────────────────────────────────────────────

/**
 * Contract clauses as ACF `conditional_logic`: a list of OR groups, each a list of rules that must
 * all hold. ACF has no "one of", so each `in` multiplies the groups out. `filled: true` is ACF's
 * "has any value" (`!=empty`), `filled: false` its "has no value" (`==empty`); ACF counts text of
 * only spaces as a value, which SC-009's isFilled does not, as the schema's WordPress note records. A true_false stores
 * 1 or 0 and ACF compares it with '1', so `equals: false` is "not checked".
 */
export function conditionalLogic(list, keyOf) {
  let groups = [[]]
  for (const c of list) {
    const field = keyOf(c.field)
    let rules
    if ('filled' in c) rules = [{ field, operator: c.filled ? '!=empty' : '==empty' }]
    else if ('equals' in c) {
      rules = typeof c.equals === 'boolean'
        ? [{ field, operator: c.equals ? '==' : '!=', value: '1' }]
        : [{ field, operator: '==', value: String(c.equals) }]
    } else rules = c.in.map((v) => ({ field, operator: '==', value: String(v) }))
    groups = groups.flatMap((g) => rules.map((r) => [...g, r]))
  }
  return groups
}

// ── Fields ─────────────────────────────────────────────────────────────────────────────────────

function sourcesFrom(options) {
  const given = options.sources
  const installed = given ? SOURCES.filter((s) => s in given) : SOURCES
  return Object.fromEntries(installed.map((s) => [s, { ...SOURCE_DEFAULTS[s], ...(given?.[s] ?? {}) }]))
}

const keyFor = (ctx, name) => `field_salt_${[ctx.scope, ...ctx.path, name].map(snake).join('_')}`

function choicesOf(opts, at) {
  const choices = {}
  for (const o of opts) choices[o.value] = o.label
  // A JS object lists integer-like keys first, so a mixed set would come out reordered.
  if (Object.keys(choices).join('\0') !== opts.map((o) => o.value).join('\0')) {
    throw new Error(`${at}: its option values cannot keep their order as ACF choices`)
  }
  return choices
}

function convertFields(fields, ctx) {
  const keyOf = (name) => {
    if (!fields.some((f) => f.name === name)) throw new Error(`${ctx.scope}.${[...ctx.path, name].join('.')}: a condition names no sibling`)
    return keyFor(ctx, name)
  }
  return fields.map((f) => convertField(f, { ...ctx, siblings: fields, keyOf }))
}

function convertField(f, ctx) {
  const { options } = ctx
  const at = `${ctx.scope}.${[...ctx.path, f.name].join('.')}`
  const salt = {}
  const out = { key: keyFor(ctx, f.name), label: f.label, name: f.name }
  if (ctx.keys.has(out.key)) throw new Error(`${at}: key ${out.key} is already taken by ${ctx.keys.get(out.key)}`)
  ctx.keys.set(out.key, at)
  const typed = (type) => {
    out.type = type
    if (f.description) out.instructions = f.description
    if (f.required) out.required = 1
    const list = clauses(f.condition)
    if (list.length) out.conditional_logic = conditionalLogic(list, ctx.keyOf)
  }
  if (f.deprecated) salt.deprecated = f.deprecated
  const below = { ...ctx, path: [...ctx.path, f.name] }

  switch (f.type) {
    case 'text':
      typed(f.format === 'url' ? 'url' : 'text')
      if (f.default !== undefined) out.default_value = f.default
      if (f.maxLength !== undefined) out.maxlength = f.maxLength
      if (f.format) salt.format = f.format
      break
    case 'textarea':
      typed('textarea')
      if (f.default !== undefined) out.default_value = f.default
      if (f.maxLength !== undefined) out.maxlength = f.maxLength
      break
    case 'rich-text': {
      typed('wysiwyg')
      // The allowed list is enforced by the site's sanitiser on save and output; the toolbar only
      // keeps the editor near it. Images are not an element kind, so the media button is off.
      out.toolbar = 'basic'
      out.media_upload = 0
      salt.allowed = allowedFor(f, options.headings)
      break
    }
    case 'image':
      typed(f.many ? 'gallery' : 'image')
      out.return_format = 'id'
      if (f.many) {
        if (f.min !== undefined) out.min = f.min
        if (f.max !== undefined) out.max = f.max
      }
      break
    case 'select': {
      typed('select')
      let opts = f.options
      if (f.optionsFrom === 'icons') {
        if (!Array.isArray(options.icons)) {
          throw new Error(`${at} offers the site's icons: pass icons, a list of { value, label }`)
        }
        salt.optionsFrom = 'icons'
        opts = options.icons
      } else if (ctx.path.length === 0 && ctx.sourceSelects.has(f.name)) {
        // A select that picks a collection-query's source offers only the sources the site has.
        opts = opts.filter((o) => !SOURCES.includes(o.value) || o.value in ctx.sources)
      }
      out.choices = choicesOf(opts, at)
      if (f.default !== undefined) out.default_value = f.default
      // Without a default ACF would preselect the first choice; the contract stores nothing.
      else out.allow_null = 1
      break
    }
    case 'boolean':
      typed('true_false')
      out.ui = 1
      if (f.default !== undefined) out.default_value = f.default ? 1 : 0
      break
    case 'number':
      typed('number')
      if (f.default !== undefined) out.default_value = f.default
      if (f.min !== undefined) out.min = f.min
      if (f.max !== undefined) out.max = f.max
      if (f.step !== undefined) out.step = f.step
      break
    case 'list': {
      typed('repeater')
      out.layout = 'block'
      if (f.min !== undefined) out.min = f.min
      if (f.max !== undefined) out.max = f.max
      if (f.itemLabel) out.button_label = `Add ${f.itemLabel.charAt(0).toLowerCase()}${f.itemLabel.slice(1)}`
      if (f.rowLabel) {
        // A link names its row by its label (schema: rowLabel), so the row collapses to that.
        const child = f.fields.find((c) => c.name === f.rowLabel)
        const labelPath = child?.type === 'link' ? [f.rowLabel, 'label'] : [f.rowLabel]
        out.collapsed = keyFor({ ...below, path: [...below.path, ...labelPath.slice(0, -1)] }, labelPath.at(-1))
        salt.rowLabel = labelPath.join('.')
      }
      if (f.itemLabel) salt.itemLabel = f.itemLabel
      out.sub_fields = convertFields(f.fields, below)
      break
    }
    case 'group':
      typed('group')
      out.layout = 'block'
      out.sub_fields = convertFields(f.fields, below)
      break
    case 'relationship': {
      typed(f.many ? 'relationship' : 'post_object')
      // A link's document and a collection-query's parts have no `to`; their callers set it.
      if (f.to) {
        out.post_type = [(ctx.sources[f.to] ?? SOURCE_DEFAULTS[f.to]).postType]
        salt.to = f.to
      } else if (ctx.link) {
        out.post_type = [...(options.linkTo ?? ['page'])]
      }
      out.return_format = 'id'
      if (f.many) {
        out.filters = ['search']
        if (f.min !== undefined) out.min = f.min
        if (f.max !== undefined) out.max = f.max
      }
      break
    }
    case 'link': {
      typed('group')
      // A group's required flag does nothing in ACF; a required link marks its parts instead.
      delete out.required
      out.layout = 'block'
      const withLabel = f.withLabel !== false
      salt.link = true
      if (!withLabel) salt.withLabel = false
      const shape = LINK_SHAPE.filter((p) => withLabel || p.name !== 'label').map((p) => {
        const { requiredWithLink, ...part } = p
        return requiredWithLink && f.required ? { ...part, required: true } : part
      })
      out.sub_fields = convertFields(shape, { ...below, link: true })
      break
    }
    case 'collection-query':
      typed('group')
      out.layout = 'block'
      Object.assign(salt, collectionQuery(f, out, below))
      break
    default:
      throw new Error(`${at}: no ACF mapping for field type ${f.type}`)
  }
  if (Object.keys(salt).length) out.salt = salt
  return out
}

function collectionQuery(f, out, ctx) {
  const salt = {}
  let offered
  if (f.source) {
    offered = [f.source]
    salt.source = f.source
  } else {
    const select = ctx.siblings.find((s) => s.name === f.sourceField)
    offered = (select?.options ?? []).map((o) => o.value).filter((v) => SOURCES.includes(v) && v in ctx.sources)
    salt.sourceField = f.sourceField
  }
  const targets = offered.map((s) => ctx.sources[s] ?? SOURCE_DEFAULTS[s])
  const taxonomies = targets.map((t) => t.taxonomy).filter(Boolean)
  const postTypes = targets.map((t) => t.postType)
  if (f.modes) salt.modes = f.modes
  if (f.max !== undefined) salt.max = f.max
  const shape = collectionQueryShape({ modes: f.modes, max: f.max, hasCategories: taxonomies.length > 0 })
  out.sub_fields = convertFields(shape.map(({ part, ...p }) => p), ctx).map((field) => {
    if (field.name === 'items') {
      const { salt: _drop, ...rest } = field
      return { ...rest, type: 'relationship', post_type: postTypes, filters: ['search'], return_format: 'id' }
    }
    if (field.name !== 'categories') return field
    const { salt: _drop, ...rest } = field
    if (taxonomies.length === 1) {
      return { ...rest, type: 'taxonomy', taxonomy: taxonomies[0], field_type: 'multi_select', return_format: 'id', add_term: 0, save_terms: 0, load_terms: 0 }
    }
    // An ACF taxonomy field reads one taxonomy, and the source is chosen by a select outside this
    // group, which ACF conditions cannot reach. So several taxonomies are a multiple select of term
    // ids whose choices the site fills from the taxonomy of the chosen source.
    return { ...rest, type: 'select', choices: {}, multiple: 1, ui: 1, ajax: 1, return_format: 'value', allow_null: 1, salt: { taxonomies } }
  })
  return salt
}

// ── Field groups ───────────────────────────────────────────────────────────────────────────────

function build(options) {
  const contract = options.contract ?? loadContract()
  const ids = options.sections ?? contract.sections.map((s) => s.id)
  const sources = sourcesFrom(options)
  const keys = new Map()
  const layouts = ids.map((id) => {
    const { section, fields, settings } = resolveSection(contract, id)
    const sourceSelects = new Set(fields.filter((f) => f.type === 'collection-query' && f.sourceField).map((f) => f.sourceField))
    const base = { options, sources, sourceSelects, keys, scope: id, path: [] }
    const shared = settings.length ? [{ name: 'settings', type: 'group', label: 'Section settings', fields: settings }] : []
    return {
      key: `layout_salt_${snake(id)}`,
      name: id,
      label: section.label,
      display: 'block',
      sub_fields: convertFields([...fields, ...shared], { ...base, sourceSelects }),
    }
  })
  return [{
    key: SECTIONS_GROUP_KEY,
    title: 'Page sections',
    fields: [{
      key: CONTAINER_KEY,
      label: 'Sections',
      name: 'sections',
      type: 'flexible_content',
      button_label: 'Add section',
      layouts,
    }],
    location: (options.postTypes ?? ['page']).map((value) => [{ param: 'post_type', operator: '==', value }]),
  }]
}

/**
 * Every ACF field group the contract defines, in ACF JSON's shape. Today that is one: the page
 * sections group, a Flexible Content field with a layout per section.
 *
 * options:
 *   linkTo     post types an internal link may point at (['page'])
 *   headings   the body heading levels a site offers, as ['h3', 'h4']; narrows each rich text
 *              field that allows headings, and may not add one the contract refuses
 *   icons      the site's icon registry, [{ value, label }]; required when a section uses it
 *   sources    { [source id]: { postType?, taxonomy? } } for the sources the site has; all of
 *              them, with SOURCE_DEFAULTS' slugs, when left out
 *   postTypes  where the sections group shows (['page'])
 *   sections   the section ids to emit, in this order (every section in sections.json)
 *   contract   a loaded contract (loadContract()), for tests
 */
export function toAcfFieldGroups(options = {}) {
  return build(options)
}

/** The groups as deterministic JSON: what a consumer commits and registers. */
export function serialiseAcfFieldGroups(groups) {
  return JSON.stringify(groups, null, 2) + '\n'
}

/** The snapshot of the groups these options give. */
export function acfSnapshot(options = {}) {
  return serialiseAcfFieldGroups(build(options))
}

/**
 * The layout slugs and field names in these groups, as salt-wordpress's bin/extract-slugs.php
 * collects them into docs/contracts/slug-registry.json (FLEET07): every `name` under a group's
 * fields, sub_fields and layouts, sorted and de-duplicated per group key, and every layout name.
 */
export function acfSlugRegistry(groups) {
  const layouts = new Set()
  const fields = {}
  const walk = (list, names) => {
    for (const f of list) {
      if (f.name) names.add(f.name)
      if (f.sub_fields) walk(f.sub_fields, names)
      for (const l of f.layouts ?? []) {
        layouts.add(l.name)
        walk(l.sub_fields ?? [], names)
      }
    }
  }
  for (const g of groups) {
    const names = new Set()
    walk(g.fields, names)
    fields[g.key] = [...names].sort()
  }
  const sortedFields = Object.fromEntries(Object.keys(fields).sort().map((k) => [k, fields[k]]))
  return { layouts: [...layouts].sort(), fields: sortedFields }
}

// ── Drift ──────────────────────────────────────────────────────────────────────────────────────

const keyOf = (item) => (item && typeof item === 'object' && !Array.isArray(item) ? item.name ?? item.key : undefined)

/**
 * Regenerate with `options` and compare with a committed snapshot (its text). `ok` is true only
 * when the two are byte-identical; `problems` names each difference by path, as
 * `groups[group_salt_sections].fields[sections].layouts[hero].sub_fields[heading] is in the
 * snapshot and no longer generated`.
 */
export function checkAcfSnapshot(snapshot, options = {}) {
  const now = normaliseLineEndings(acfSnapshot(options))
  snapshot = normaliseLineEndings(snapshot)
  if (now === snapshot) return { ok: true, problems: [] }
  let was
  try { was = JSON.parse(snapshot) } catch (e) { return { ok: false, problems: [`the snapshot is not JSON: ${e.message}`] } }
  const problems = []
  diffSnapshots(was, JSON.parse(now), 'groups', keyOf, problems)
  // Same structure, different bytes: formatting, which a regenerated snapshot fixes.
  if (!problems.length) problems.push('the snapshot differs from the generated text only in formatting; regenerate it')
  return { ok: false, problems }
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────
// node emit/acf.mjs --check <snapshot.json> [--options <options.json>]   exit 1 on drift
// node emit/acf.mjs --write <snapshot.json> [--options <options.json>]
// Every option but `contract` is JSON, so the options file can hold them all.

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2)
  const flag = (name) => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1] }
  const optionsFile = flag('--options')
  const options = optionsFile ? JSON.parse(readFileSync(optionsFile, 'utf8')) : {}
  const check = flag('--check')
  const write = flag('--write')
  if (write) {
    writeFileSync(write, acfSnapshot(options))
    console.log(`wrote ${write}`)
  } else if (check) {
    const { ok, problems } = checkAcfSnapshot(readFileSync(check, 'utf8'), options)
    if (!ok) {
      for (const p of problems) console.log(`✗ ${p}`)
      console.log(`${check} has drifted from @lightlysaltedhq/salt-contract; regenerate it with --write and review the change`)
      process.exit(1)
    }
    console.log(`PASS: ${check} matches the contract`)
  } else {
    console.error('usage: acf.mjs --check <snapshot.json> | --write <snapshot.json> [--options <options.json>]')
    process.exit(2)
  }
}
