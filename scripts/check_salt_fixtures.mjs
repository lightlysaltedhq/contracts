#!/usr/bin/env node
// The Salt contract's fixtures gate: run as `node scripts/check_salt_fixtures.mjs [package-dir]`.
//
// A fixture case is salt-contract/fixtures/<section>/<case>.json (the section's stored field
// values and the page context it renders in) and <case>.html (the default HTML both platforms
// must render for it, or an empty file for a case that renders nothing). The format is in
// salt-contract/README.md, "Fixtures". Four checks, each proved able to fail by
// check_salt_fixtures.test.mjs:
//
// 1. COVERAGE. Every section in contract/sections.json has a fixture set; every option of every
//    variant it declares is the value of at least one case; every section has a case that renders
//    nothing, unless its markup's zeroState says it is never empty; every section has a case on the
//    inverse band; and across all cases every tone, explicit dark tone, spacing and width is used.
// 2. INPUTS. Every case input validates against the section's contract/fields (and the shared
//    settings): known names only, types, options, required, maxLength, list and image limits, url
//    and anchor formats, rich-text elements, and references to the case's media, documents and
//    collections. Its context is well formed.
// 3. MARKUP. Every expected HTML validates against contract/markup, read generically: the section
//    wrapper (section.json) around the section's own tree with its variant applied, components
//    resolved from their own files, element order, optional and repeated elements, tags, exact
//    salt-* classes, required attributes and their values, no undeclared attribute, data
//    attributes. Then the rules no tree states: the naming heading is <anchor>__heading at the
//    plan's level and the wrapper is a section labelled by it (a div without one); nested headings
//    rank below it; every id is the anchor or <anchor>__<part> (SC-012), unique, and every
//    id reference resolves; every img has src, srcset, sizes, width and height, never picture or
//    source (SC-007); at most one img is the priority image, which is never lazy, every other img
//    is lazy, and the priority image is the one the plan and the markup's priorityMedia choose.
// 4. THE NORMALISER (normalise.mjs). It is idempotent on every expected HTML, and removing or
//    changing any one attribute of any element (outside icon artwork, which it drops by design)
//    changes its output.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const dir = path.resolve(process.argv[2] ?? path.join(here, '..', 'salt-contract'))
const fails = []
const fail = (msg) => fails.push(msg)
const readJson = (p) => JSON.parse(readFileSync(path.join(dir, p), 'utf8'))
const { normalise, parse } = await import(pathToFileURL(path.join(dir, 'normalise.mjs')).href)

const vocab = readJson('contract/sections.json')
const markup = new Map()
for (const f of readdirSync(path.join(dir, 'contract/markup')).filter((f) => f.endsWith('.json'))) {
  const doc = readJson(`contract/markup/${f}`)
  markup.set(doc.id, doc)
}
const settingsFile = readJson('contract/fields/_section-settings.json')
const iconContent = new Set(vocab.icons?.content ?? [])
const landmarks = new Set(markup.get('section')?.rules?.anchors?.reserved ?? [])

const arr = (x) => (x === undefined ? [] : Array.isArray(x) ? x : [x])
const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)
const elementsOf = (el) => el.children.filter((c) => c.type === 'element')
const attr = (el, name) => el.attrs.find(([n]) => n === name)?.[1]
const hasAttr = (el, name) => el.attrs.some(([n]) => n === name)
const classesOf = (el) => (attr(el, 'class') ?? '').split(/[ \t\n\r\f]+/).filter(Boolean)
const describe = (el) => `<${el.name}${classesOf(el).length ? '.' + classesOf(el).join('.') : ''}>`
const descendants = (el) => elementsOf(el).flatMap((c) => [c, ...descendants(c)])

// ── Cases ─────────────────────────────────────────────────────────────────────────────────────
const fixturesDir = path.join(dir, 'fixtures')
const cases = []
if (existsSync(fixturesDir)) {
  for (const section of readdirSync(fixturesDir).sort()) {
    const sdir = path.join(fixturesDir, section)
    if (!statSync(sdir).isDirectory()) { fail(`fixtures/${section}: fixtures holds one directory per section`); continue }
    const files = readdirSync(sdir)
    const names = new Set(files.map((f) => f.replace(/\.(json|html)$/, '')))
    for (const name of [...names].sort()) {
      const at = `fixtures/${section}/${name}`
      if (!files.includes(`${name}.json`)) { fail(`${at}.html has no ${name}.json input`); continue }
      if (!files.includes(`${name}.html`)) { fail(`${at}.json has no ${name}.html expected output`); continue }
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) fail(`${at}: a case name is lower-case kebab, describing the state`)
      let input
      try { input = JSON.parse(readFileSync(path.join(sdir, `${name}.json`), 'utf8')) } catch (e) { fail(`${at}.json does not parse (${e.message})`); continue }
      cases.push({ section, name, at, input, html: readFileSync(path.join(sdir, `${name}.html`), 'utf8') })
    }
  }
}

// ── 2. Inputs against the fields ─────────────────────────────────────────────────────────────
// SC-009: text is filled when something visible is left after white space and zero-width
// characters go.
const filledText = (v) => typeof v === 'string' && v.replace(/[\s​-‍⁠﻿]/g, '') !== ''
const RICH_TAGS = { paragraph: ['p'], bold: ['strong', 'b'], italic: ['em', 'i'], code: ['code'], link: ['a'],
  'unordered-list': ['ul', 'li'], 'ordered-list': ['ol', 'li'], blockquote: ['blockquote'], 'heading-3': ['h3'], 'heading-4': ['h4'] }
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

function filled(field, v) {
  if (v === undefined || v === null) return false
  switch (field.type) {
    case 'text': case 'textarea': return filledText(v)
    case 'rich-text': return typeof v === 'string' && filledText(v.replace(/<[^>]*>/g, ''))
    case 'image': return field.many ? Array.isArray(v) && v.length > 0 : typeof v === 'string' && v !== ''
    case 'link': return isObject(v) && (v.type === 'internal' ? Boolean(v.document) : Boolean(v.url))
    case 'list': return Array.isArray(v) && v.length > 0
    case 'relationship': return field.many ? Array.isArray(v) && v.length > 0 : Boolean(v)
    default: return true
  }
}

function checkFields(fields, obj, at, c) {
  if (!isObject(obj)) { fail(`${at} must be an object`); return }
  const byName = new Map(fields.map((f) => [f.name, f]))
  for (const k of Object.keys(obj)) if (!byName.has(k)) fail(`${at}.${k}: the fields contract has no field of that name`)
  for (const f of fields) {
    const v = obj[f.name]
    const p = `${at}.${f.name}`
    if (v === undefined) { if (f.required) fail(`${p} is required`); continue }
    if (f.required && !filled(f, v)) { fail(`${p} is required and is empty`); continue }
    checkValue(f, v, p, c, obj)
  }
}

function checkCount(n, f, p, what) {
  if (f.min !== undefined && n < f.min) fail(`${p} has ${n} ${what}; the field's min is ${f.min}`)
  if (f.max !== undefined && n > f.max) fail(`${p} has ${n} ${what}; the field's max is ${f.max}`)
}

function checkValue(f, v, p, c, siblings) {
  const { input } = c
  switch (f.type) {
    case 'text': case 'textarea':
      if (typeof v !== 'string') { fail(`${p} must be a string`); return }
      if (f.maxLength !== undefined && v.length > f.maxLength) fail(`${p} is ${v.length} characters; maxLength is ${f.maxLength}`)
      if (f.format === 'url' && v && !/^(https?:\/\/|mailto:|tel:)/.test(v)) fail(`${p} must be an absolute http, https, mailto or tel address`)
      if (f.format === 'anchor' && v && !SLUG.test(v)) fail(`${p} must be a stored anchor slug (lower-case letters, digits, single hyphens)`)
      return
    case 'rich-text': {
      if (typeof v !== 'string') { fail(`${p} must be an HTML string (the fixtures' rich-text interchange form)`); return }
      const allowed = new Set(f.allowed.flatMap((k) => RICH_TAGS[k] ?? []))
      for (const el of descendants(parse(v))) {
        if (!allowed.has(el.name)) fail(`${p} uses <${el.name}>, which the field's allowed list does not offer`)
        if (el.name === 'a' && !/^(https?:\/\/|mailto:|tel:|\/)/.test(attr(el, 'href') ?? '')) fail(`${p} has a link that is not http, https, mailto, tel or a site path`)
      }
      return
    }
    case 'image': {
      const ids = f.many ? v : [v]
      if (f.many && !Array.isArray(v)) { fail(`${p} must be an array of media ids`); return }
      if (f.many) checkCount(v.length, f, p, 'images')
      for (const id of ids) if (typeof id !== 'string' || !isObject(input.media?.[id])) fail(`${p} names media ${JSON.stringify(id)}, which the case's media does not hold`)
      return
    }
    case 'link': {
      if (!isObject(v)) { fail(`${p} must be a link object`); return }
      for (const k of Object.keys(v)) if (!['label', 'type', 'document', 'url', 'newTab'].includes(k)) fail(`${p}.${k}: a link has label, type, document, url and newTab only`)
      if (!['internal', 'external'].includes(v.type)) fail(`${p}.type must be internal or external`)
      if (v.type === 'internal' && !isObject(input.documents?.[v.document])) fail(`${p}.document names ${JSON.stringify(v.document)}, which the case's documents do not hold`)
      if (v.type === 'external' && !/^(https?:\/\/|mailto:|tel:)/.test(v.url ?? '')) fail(`${p}.url must be an absolute http, https, mailto or tel address`)
      if (f.withLabel !== false && !filledText(v.label)) fail(`${p}.label is empty; this link carries its own text`)
      if (v.newTab !== undefined && typeof v.newTab !== 'boolean') fail(`${p}.newTab must be a boolean`)
      return
    }
    case 'select': {
      const options = f.optionsFrom === 'icons' ? iconContent : new Set(f.options.map((o) => o.value))
      if (!options.has(v)) fail(`${p} is ${JSON.stringify(v)}, not one of the field's options`)
      return
    }
    case 'boolean': if (typeof v !== 'boolean') fail(`${p} must be a boolean`); return
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v)) { fail(`${p} must be a number`); return }
      if (f.min !== undefined && v < f.min) fail(`${p} is below the field's min`)
      if (f.max !== undefined && v > f.max) fail(`${p} is above the field's max`)
      return
    case 'list':
      if (!Array.isArray(v)) { fail(`${p} must be an array of rows`); return }
      checkCount(v.length, f, p, 'rows')
      v.forEach((row, i) => checkFields(f.fields, row, `${p}[${i}]`, c))
      return
    case 'group': checkFields(f.fields, v, p, c); return
    case 'relationship': {
      const ids = f.many ? v : [v]
      if (f.many && !Array.isArray(v)) { fail(`${p} must be an array of item ids`); return }
      for (const id of ids) if (!input.collections?.[f.to]?.some((item) => item.id === id)) fail(`${p} names ${JSON.stringify(id)}, not an item of the case's ${f.to} collection`)
      return
    }
    case 'collection-query': {
      if (!isObject(v)) { fail(`${p} must be a collection-query object`); return }
      for (const k of Object.keys(v)) if (!['mode', 'categories', 'items', 'order', 'count'].includes(k)) fail(`${p}.${k}: a collection query has mode, categories, items, order and count only`)
      const modes = f.modes ?? ['automatic', 'by-category', 'manual']
      if (v.mode !== undefined && !modes.includes(v.mode)) fail(`${p}.mode must be one of ${modes.join(', ')}`)
      if (v.order !== undefined && !['default', 'newest', 'title'].includes(v.order)) fail(`${p}.order must be default, newest or title`)
      const max = f.max ?? 24
      if (v.count !== undefined && !(Number.isInteger(v.count) && v.count >= 0 && v.count <= max)) fail(`${p}.count must be a whole number from 0 to ${max}`)
      const source = f.source ?? siblings[f.sourceField]
      if (!Array.isArray(input.collections?.[source])) fail(`${p}: the case's collections hold no ${source} items`)
      for (const id of v.items ?? []) if (!input.collections?.[source]?.some((item) => item.id === id)) fail(`${p}.items names ${JSON.stringify(id)}, not an item of ${source}`)
      return
    }
    default: fail(`${p}: unknown field type ${f.type}`)
  }
}

const CONTEXT_KEYS = ['headingLevel', 'priorityMedia', 'track', 'collapseTop', 'index', 'now']
const INPUT_KEYS = ['$comment', 'section', 'summary', 'values', 'context', 'media', 'documents', 'collections', 'route', 'site']

function settingsFields(fieldsDoc) {
  const omit = new Set(fieldsDoc.shared?.omit ?? [])
  return settingsFile.fields.filter((f) => !omit.has(f.name))
    .map((f) => (fieldsDoc.shared?.defaults?.[f.name] !== undefined ? { ...f, default: fieldsDoc.shared.defaults[f.name] } : f))
}

function checkInput(c) {
  const { input, at, section } = c
  if (!isObject(input)) { fail(`${at}.json is not an object`); return false }
  for (const k of Object.keys(input)) if (!INPUT_KEYS.includes(k)) fail(`${at}.json: unknown key ${k}`)
  if (input.section !== section) fail(`${at}.json: section is ${JSON.stringify(input.section)}; its directory says ${section}`)
  if (!filledText(input.summary)) fail(`${at}.json: summary must say what the case shows`)
  const ctx = input.context
  if (!isObject(ctx)) { fail(`${at}.json: context is required`); return false }
  for (const k of Object.keys(ctx)) if (!CONTEXT_KEYS.includes(k)) fail(`${at}.json: context.${k} is not a context key`)
  if (!(Number.isInteger(ctx.headingLevel) && ctx.headingLevel >= 1 && ctx.headingLevel <= 6)) fail(`${at}.json: context.headingLevel must be 1 to 6`)
  if (typeof ctx.priorityMedia !== 'boolean') fail(`${at}.json: context.priorityMedia must be a boolean`)
  if (typeof ctx.track !== 'string' || !new RegExp(`^${section}-[1-9][0-9]*(@.+)?$`).test(ctx.track)) fail(`${at}.json: context.track must be ${section}-<n> (section#data-track)`)
  if (ctx.collapseTop !== undefined && typeof ctx.collapseTop !== 'boolean') fail(`${at}.json: context.collapseTop must be a boolean`)
  if (ctx.index !== undefined && !(Number.isInteger(ctx.index) && ctx.index >= 1)) fail(`${at}.json: context.index counts sections from 1`)
  for (const [id, m] of Object.entries(input.media ?? {})) {
    const p = `${at}.json media.${id}`
    if (typeof m.src !== 'string' || typeof m.sizes !== 'string' || typeof m.alt !== 'string') fail(`${p} needs src, sizes and alt strings`)
    if (!(Number.isInteger(m.width) && m.width > 0 && Number.isInteger(m.height) && m.height > 0)) fail(`${p} needs whole-number width and height`)
    if (!Array.isArray(m.srcset) || !m.srcset.length || m.srcset.some((s) => typeof s.url !== 'string' || !Number.isInteger(s.width))) fail(`${p}.srcset must list { url, width } candidates`)
  }
  for (const [source, items] of Object.entries(input.collections ?? {})) {
    if (!Array.isArray(items) || items.some((i) => !isObject(i) || typeof i.id !== 'string')) fail(`${at}.json collections.${source} must be a list of items with string ids`)
  }
  let fieldsDoc
  try { fieldsDoc = readJson(`contract/fields/${section}.json`) } catch { fail(`${at}: no contract/fields/${section}.json`); return false }
  const values = input.values
  if (!isObject(values)) { fail(`${at}.json: values is required`); return false }
  const { settings, ...own } = values
  checkFields(fieldsDoc.fields, own, `${at}.json values`, c)
  if (!isObject(settings) || !SLUG.test(settings.anchorId ?? '') || landmarks.has(settings.anchorId)) {
    fail(`${at}.json: values.settings.anchorId must be set, a slug and not a landmark id, so the case's ids are known`)
    return false
  }
  if (isObject(settings)) checkFields(settingsFields(fieldsDoc), settings, `${at}.json values.settings`, c)
  c.fieldsDoc = fieldsDoc
  c.anchor = settings?.anchorId
  return true
}

const effective = (c, field) => {
  const f = c.fieldsDoc?.fields.find((x) => x.name === field)
  return c.input.values?.[field] ?? f?.default
}
const effectiveSetting = (c, name) => c.input.values?.settings?.[name] ?? settingsFields(c.fieldsDoc ?? {}).find((f) => f.name === name)?.default

// ── 3. Expected HTML against the markup ──────────────────────────────────────────────────────
const dataRules = (doc, role) => Object.fromEntries((doc?.dataAttributes ?? []).filter((d) => d.on === role).map((d) => [d.name,
  Array.isArray(d.values) ? { enum: d.values, ...(d.when ? { when: d.when } : {}) } : { value: d.values ?? '', ...(d.when ? { when: d.when } : {}) }]))

const clone = (x) => structuredClone(x)

function mapNodes(nodes, fn) {
  return nodes.flatMap((n) => {
    const out = fn(n)
    if (out === null) return []
    return [{ ...out, ...(out.children ? { children: mapNodes(out.children, fn) } : {}) }]
  })
}

function applyDiff(node, diff) {
  const out = { ...node }
  if (diff.element) out.element = diff.element
  if (diff.classes) out.classes = diff.classes
  if (diff.attributes) out.attributes = { ...(node.attributes ?? {}), ...diff.attributes }
  return out
}

// A variant option, applied to a tree: only what differs, by role (markup.schema.json).
function applyOption(root, elements, option) {
  let r = option.root ? applyDiff(root, option.root) : root
  let els = option.tree ? clone(option.tree) : elements
  els = mapNodes(els, (n) => {
    if (option.replace?.[n.role]) return clone(option.replace[n.role])
    const d = option.elements?.[n.role]
    if (!d) return n
    return d.absent ? null : applyDiff(n, d)
  })
  if (option.elements?.root) r = applyDiff(r, option.elements.root)
  return { root: r, elements: els }
}

// A spec is { role, optional, repeat, alts: [{ tags, classes, attrs, children, doc, componentId }] }.
// A component with variants of its own (the card's style) offers one alternative per option; the
// section's own variant is chosen by the case's value.
function expand(nodes, doc) {
  return nodes.flatMap((n) => {
    if (n.component) {
      const comp = markup.get(n.component)
      if (!comp) { fail(`markup: ${doc.id} uses component ${n.component}, which has no markup`); return [] }
      if (comp.fragment) {
        return expand(comp.elements.map((e) => (n.optional ? { ...e, optional: true } : e)), comp)
      }
      const options = comp.variants?.length ? comp.variants.flatMap((v) => Object.values(v.options)) : [{}]
      const alts = options.map((o) => {
        const { root, elements } = applyOption(comp.root, comp.elements ?? [], o)
        const own = elements.length > 0
        return {
          tags: arr(n.element ?? root.element),
          classes: [...(root.classes ?? []), ...(n.classes ?? [])],
          attrs: { ...(root.attributes ?? {}), ...dataRules(comp, 'root'), ...dataRules(doc, n.role), ...(n.attributes ?? {}), ...(n.extraAttrs ?? {}) },
          children: own ? elements : n.children ?? null,
          doc: own ? comp : doc,
          componentId: comp.id,
        }
      })
      return [{ role: n.role, optional: n.optional, repeat: n.repeat, alts }]
    }
    // A plain img node (the section background) is still an image as media.json draws it:
    // section#priority-media holds every image, the background included, to its rules.
    const media = arr(n.element).includes('img') ? markup.get('media')?.root.attributes ?? {} : {}
    return [{
      role: n.role,
      optional: n.optional,
      repeat: n.repeat,
      alts: [{
        tags: arr(n.element),
        classes: n.classes ?? [],
        attrs: { ...media, ...dataRules(doc, n.role), ...(n.attributes ?? {}), ...(n.extraAttrs ?? {}) },
        children: n.children ?? null,
        doc: n.childDoc ?? doc,
      }],
    }]
  })
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const canonStyle = (v) => v.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
  const i = d.indexOf(':')
  return i === -1 ? d : `${d.slice(0, i).trim()}:${d.slice(i + 1).trim().replace(/\s+/g, ' ')}`
}).join(';')

function templateMatch(tpl, value, name, anchor) {
  if (tpl.startsWith('from:')) return true
  const canon = name === 'style' ? canonStyle : (x) => x
  const re = canon(tpl).split(/(<[^<>]+>)/).map((part) => {
    if (part === '<anchor>') return escapeRe(anchor)
    if (/^<[^<>]+>$/.test(part)) return '.+?'
    return escapeRe(part)
  }).join('')
  return new RegExp(`^${re}$`).test(canon(value))
}

function checkAttrs(alt, el, anchor) {
  const problems = []
  // The parser lower-cases names, as HTML does; the markup writes SVG's viewBox in its own case.
  const rules = Object.fromEntries(Object.entries(alt.attrs).map(([n, r]) => [n.toLowerCase(), r]))
  for (const [name, value] of el.attrs) {
    if (name === 'class') continue
    const rule = rules[name]
    if (rule === undefined) { problems.push(`${describe(el)} carries ${name}, which the markup does not declare`); continue }
    if (typeof rule === 'string') { if (!templateMatch(rule, value, name, anchor)) problems.push(`${describe(el)} ${name}="${value}" is not ${JSON.stringify(rule)}`); continue }
    if (rule.enum) { if (!rule.enum.includes(value)) problems.push(`${describe(el)} ${name}="${value}" is not one of ${rule.enum.join(', ')}`); continue }
    if (!templateMatch(rule.value, value, name, anchor)) problems.push(`${describe(el)} ${name}="${value}" is not ${JSON.stringify(rule.value)}`)
  }
  for (const [name, rule] of Object.entries(rules)) {
    const required = typeof rule === 'string' || rule.when === undefined
    if (required && !hasAttr(el, name)) problems.push(`${describe(el)} lacks ${name}, which the markup requires`)
  }
  const want = [...alt.classes].sort().join(' ')
  const got = [...new Set(classesOf(el))].sort().join(' ')
  if (want !== got) problems.push(`${describe(el)} has classes "${got}"; the markup gives "${want}"`)
  return problems
}

function matcher(anchor) {
  // The most telling failure: the deepest element, then the furthest along its siblings, then a
  // problem with the element itself over a wrong tag over a gap in the sequence.
  let best = { rank: [-1], msg: 'no element matched' }
  const note = (rank, msg) => {
    for (let k = 0; k < rank.length; k++) {
      if (rank[k] > (best.rank[k] ?? -1)) { best = { rank, msg }; return }
      if (rank[k] < (best.rank[k] ?? -1)) return
    }
    best = { rank, msg }
  }
  const memo = new Map()

  // Returns the role bindings of the subtree, or null.
  function one(spec, el, depth, index, where) {
    let byEl = memo.get(el)
    if (!byEl) memo.set(el, (byEl = new Map()))
    if (byEl.has(spec)) return byEl.get(spec)
    let result = null
    for (const alt of spec.alts) {
      if (!alt.tags.includes(el.name)) { note([depth, index, 1], `${where}: ${describe(el)} where the markup has ${spec.role} (${alt.tags.join(' or ')})`); continue }
      const problems = checkAttrs(alt, el, anchor)
      if (problems.length) { note([depth, index, 2], `${where} [${spec.role}]: ${problems[0]}`); continue }
      let bindings = new Map()
      if (alt.children !== null) {
        const kids = seq(expand(alt.children, alt.doc), 0, elementsOf(el), 0, depth + 1, `${where} > ${describe(el)}`)
        if (!kids) continue
        bindings = kids
      }
      bindings.set(spec.role, [el, ...(bindings.get(spec.role) ?? [])])
      result = bindings
      break
    }
    byEl.set(spec, result)
    return result
  }

  function seq(specs, si, els, ei, depth, where) {
    if (si === specs.length) {
      if (ei === els.length) return new Map()
      note([depth, ei, 0], `${where}: ${describe(els[ei])} is not in the markup at this point`)
      return null
    }
    const spec = specs[si]
    const lo = spec.repeat ? (spec.optional ? 0 : spec.repeat.min ?? 0) : spec.optional ? 0 : 1
    const hi = spec.repeat ? spec.repeat.max ?? Infinity : 1
    const taken = []
    while (taken.length < hi && ei + taken.length < els.length) {
      const b = one(spec, els[ei + taken.length], depth, ei + taken.length, where)
      if (!b) break
      taken.push(b)
    }
    for (let k = taken.length; k >= lo; k--) {
      const rest = seq(specs, si + 1, els, ei + k, depth, where)
      if (!rest) continue
      for (const b of taken.slice(0, k)) for (const [role, list] of b) rest.set(role, [...list, ...(rest.get(role) ?? [])])
      return rest
    }
    const at = ei + taken.length
    if (taken.length < lo) note([depth, at, 0], `${where}: the markup requires ${spec.role} here${els[at] ? `, found ${describe(els[at])}` : ''}`)
    return null
  }
  return { one, best: () => best.msg }
}

// The section wrapper (section.json) as one tree, with the section's own tree, its variant
// chosen by the case, in place of the wrapper's block element. The block is read against the
// section's own file, everything around it against section.json.
function wrapperSpec(c) {
  const wrapper = markup.get('section')
  const doc = markup.get(c.section)
  let { root } = doc
  let elements = doc.elements ?? []
  for (const v of doc.variants ?? []) {
    const option = v.options[effective(c, v.field)]
    if (option) ({ root, elements } = applyOption(root, elements, option))
  }
  const children = mapNodes(wrapper.elements, (n) => {
    if (n.role !== 'block') return n
    return {
      role: 'block',
      element: root.element,
      classes: [...new Set([...(n.classes ?? []), ...(root.classes ?? [])])],
      children: elements,
      extraAttrs: { ...dataRules(doc, 'root'), ...(root.attributes ?? {}) },
      attributes: n.attributes,
      childDoc: doc,
    }
  })
  return {
    doc,
    spec: {
      role: 'root',
      alts: [{ tags: arr(wrapper.root.element), classes: wrapper.root.classes ?? [], attrs: { ...dataRules(wrapper, 'root'), ...wrapper.root.attributes }, children, doc: wrapper }],
    },
  }
}

const HEADING = /^h([1-6])$/

function checkMarkup(c) {
  const { at, input, anchor } = c
  const tree = parse(c.html)
  const top = elementsOf(tree)
  if (top.length === 0) {
    if (c.html.replace(/<!--[\s\S]*?-->/g, '').trim() !== '') fail(`${at}.html holds text but no element`)
    c.renders = false
    return
  }
  c.renders = true
  if (top.length !== 1) { fail(`${at}.html must be one section wrapper; it has ${top.length} top-level elements`); return }
  const root = top[0]
  const { doc, spec } = wrapperSpec(c)
  const m = matcher(anchor)
  const bindings = m.one(spec, root, 0, 0, '')
  if (!bindings) { fail(`${at}.html: ${m.best()}`); return }

  // Headings (section#labelled-by, section#heading-level, section#body-heading-base).
  const all = [root, ...descendants(root)]
  const ctx = input.context
  const headingId = `${anchor}__heading`
  const naming = all.filter((el) => attr(el, 'id') === headingId)
  const headings = all.filter((el) => HEADING.test(el.name))
  if (naming.length) {
    const h = naming[0]
    if (!HEADING.test(h.name)) fail(`${at}.html: ${headingId} is on ${describe(h)}, not a heading`)
    else if (Number(h.name[1]) !== ctx.headingLevel) fail(`${at}.html: the section heading is ${h.name}; the plan gives level ${ctx.headingLevel} (section#heading-level)`)
    if (root.name !== 'section' || attr(root, 'aria-labelledby') !== headingId) fail(`${at}.html: a section with a heading is a section element with aria-labelledby="${headingId}" (section#labelled-by)`)
  } else {
    if (root.name !== 'div' || hasAttr(root, 'aria-labelledby')) fail(`${at}.html: a section with no heading renders as a div with no aria-labelledby (section#labelled-by)`)
    if (doc.headings?.labelledBy && bindings.has(doc.headings.role) && HEADING.test(bindings.get(doc.headings.role)[0].name)) {
      fail(`${at}.html: the ${doc.headings.role} heading carries no id ${headingId}`)
    }
  }
  for (const h of headings) {
    if (naming.includes(h)) continue
    if (Number(h.name[1]) <= ctx.headingLevel) fail(`${at}.html: ${describe(h)} ranks at or above the section heading's level ${ctx.headingLevel} (section#body-heading-base)`)
  }
  if (headings.filter((h) => h.name === 'h1').length > (naming[0]?.name === 'h1' ? 1 : 0)) fail(`${at}.html: an h1 that is not the section heading claiming it (section#single-h1)`)

  // Ids (SC-012).
  const ids = new Map()
  const own = new RegExp(`^${escapeRe(anchor)}__[a-z0-9]+(-[a-z0-9]+)*$`)
  for (const el of all) {
    const id = attr(el, 'id')
    if (id === undefined) continue
    if (ids.has(id)) fail(`${at}.html: id ${id} is drawn twice`)
    ids.set(id, el)
    if (el === root ? id !== anchor : !own.test(id)) fail(`${at}.html: id ${id} is not ${el === root ? `the anchor ${anchor}` : `${anchor}__<part>`} (SC-012)`)
  }
  for (const el of all) {
    for (const name of ['aria-labelledby', 'aria-describedby', 'aria-controls', 'for']) {
      for (const ref of (attr(el, name) ?? '').split(/\s+/).filter(Boolean)) if (!ids.has(ref)) fail(`${at}.html: ${describe(el)} ${name} points at ${ref}, which is not drawn`)
    }
  }

  // Images (SC-007, section#priority-media).
  for (const el of all) if (el.name === 'picture' || el.name === 'source') fail(`${at}.html: <${el.name}> is never drawn; an image is one img (SC-007)`)
  const imgs = all.filter((el) => el.name === 'img')
  for (const img of imgs) {
    for (const name of ['src', 'srcset', 'sizes', 'width', 'height', 'alt']) if (!hasAttr(img, name)) fail(`${at}.html: an img lacks ${name} (SC-007)`)
    for (const name of ['width', 'height']) if (hasAttr(img, name) && !/^[1-9][0-9]*$/.test(attr(img, name))) fail(`${at}.html: an img's ${name} is not a whole number of pixels`)
  }
  const priority = imgs.filter((img) => attr(img, 'fetchpriority') === 'high')
  if (priority.length > 1) fail(`${at}.html: ${priority.length} images claim fetchpriority=high; at most one does (section#priority-media)`)
  for (const img of imgs) {
    const isPriority = priority.includes(img)
    if (isPriority && hasAttr(img, 'loading')) fail(`${at}.html: the priority image carries loading; it is never lazy (SC-007)`)
    if (!isPriority && attr(img, 'loading') !== 'lazy') fail(`${at}.html: an img that is not the priority image must be loading="lazy" (section#priority-media)`)
  }
  const background = bindings.get('background')?.[0]
  const role = doc.priorityMedia?.role
  const within = role ? (bindings.get(role) ?? []).flatMap((el) => (el.name === 'img' ? [el] : descendants(el).filter((d) => d.name === 'img'))) : []
  const expected = !ctx.priorityMedia ? null : background ?? (within.length ? within : null)
  if (!ctx.priorityMedia && priority.length) fail(`${at}.html: the plan grants no priority media, but an img carries fetchpriority=high`)
  if (expected && !(Array.isArray(expected) ? expected.includes(priority[0]) : priority[0] === expected)) {
    fail(`${at}.html: the priority image must be ${background ? 'the section background' : `in ${doc.id}'s ${role}`} (section#priority-media)`)
  }
  if (ctx.priorityMedia && !expected && priority.length) fail(`${at}.html: an img claims priority, but ${doc.id}'s markup gives priority to none here`)
}

// ── 4. The normaliser ─────────────────────────────────────────────────────────────────────────
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
const esc = (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
function raw(node) {
  if (node.type === 'text') return esc(node.value)
  const inner = node.children.map(raw).join('')
  if (node.name === '#root') return inner
  const attrs = node.attrs.map(([n, v]) => ` ${n}="${esc(v)}"`).join('')
  return VOID.has(node.name) ? `<${node.name}${attrs}>` : `<${node.name}${attrs}>${inner}</${node.name}>`
}

function checkNormaliser(c) {
  if (!c.renders) return
  const canonical = normalise(c.html)
  if (normalise(canonical) !== canonical) fail(`${c.at}.html: normalise is not idempotent on it`)
  const tree = parse(c.html)
  if (normalise(raw(tree)) !== canonical) fail(`${c.at}.html: normalise changes its verdict when the same tree is reserialised`)
  const visit = (el) => {
    // Icon artwork is dropped by design (SC-007); everything else must count.
    if (el.name === 'svg' && classesOf(el).includes('salt-icon')) { mutate(el); return }
    mutate(el)
    for (const child of elementsOf(el)) visit(child)
  }
  const mutate = (el) => {
    for (let k = 0; k < el.attrs.length; k++) {
      const saved = el.attrs
      const [name, value] = saved[k]
      for (const [what, attrs] of [
        ['removing', saved.filter((_, x) => x !== k)],
        ['changing', saved.map((a, x) => (x === k ? [name, `${value}-mutated`] : a))],
      ]) {
        el.attrs = attrs
        if (normalise(raw(tree)) === canonical) fail(`${c.at}.html: ${what} ${name} on ${describe(el)} does not change normalise's output; the normaliser hides a real difference`)
        el.attrs = saved
      }
    }
  }
  for (const el of elementsOf(tree)) visit(el)
}

// ── Run ───────────────────────────────────────────────────────────────────────────────────────
for (const c of cases) {
  if (!markup.has(c.section) || !vocab.sections.some((s) => s.id === c.section)) { fail(`${c.at}: ${c.section} is not a section in contract/sections.json`); continue }
  if (!checkInput(c)) continue
  checkMarkup(c)
  checkNormaliser(c)
}

// ── 1. Coverage ───────────────────────────────────────────────────────────────────────────────
const used = { tone: new Set(), toneDark: new Set(), spacing: new Set(), width: new Set() }
for (const s of vocab.sections) {
  const mine = cases.filter((c) => c.section === s.id && c.fieldsDoc)
  if (!mine.length) { fail(`section ${s.id} has no fixtures (fixtures/${s.id}/<case>.json and .html)`); continue }
  for (const v of s.variants ?? []) {
    for (const o of v.options) {
      if (!mine.some((c) => effective(c, v.field) === o.value && c.renders)) fail(`section ${s.id}: no case renders ${v.field} ${o.value}`)
    }
  }
  const zero = markup.get(s.id)?.zeroState ?? ''
  if (!/^Never\b/.test(zero) && !mine.some((c) => c.renders === false)) fail(`section ${s.id}: no case renders nothing (its zero state: ${zero})`)
  if (!mine.some((c) => c.renders && effectiveSetting(c, 'tone') === 'surface-inverse')) fail(`section ${s.id}: no case on the inverse band (tone surface-inverse)`)
  for (const c of mine.filter((x) => x.renders)) for (const k of Object.keys(used)) used[k].add(c.input.values?.settings?.[k] ?? (k === 'toneDark' ? undefined : effectiveSetting(c, k)))
}
for (const f of settingsFile.fields.filter((x) => Object.keys(used).includes(x.name))) {
  for (const o of f.options) if (!used[f.name].has(o.value)) fail(`no case renders settings.${f.name} ${o.value}`)
}

if (fails.length) {
  for (const f of fails) console.log(`✗ ${f}`)
  process.exit(1)
}
const rendering = cases.filter((c) => c.renders).length
console.log(`PASS: ${cases.length} fixture case(s) over ${new Set(cases.map((c) => c.section)).size} section(s) (${rendering} rendering, ` +
  `${cases.length - rendering} rendering nothing): every input valid against its fields, every expected HTML valid against ` +
  'its markup, every variant option covered; normalise is idempotent and no one-attribute change survives it.')
