#!/usr/bin/env node
// The Salt contract's own gate: run as `node scripts/check_salt_contract.mjs [package-dir]`.
//
// Four checks, each proved able to fail by check_salt_contract.test.mjs:
//
// 1. ONE VERSION. Every JSON file under contract/ carries a top-level `version` equal to
//    package.json's, and no version key appears anywhere else in contract/ or schema/ (a key is a
//    version key when one of its words is `version`). The rule and its reasons are
//    design-foundations' (foundations/CHANGELOG.md, "Versioning"), adopted by RELEASE-POLICY.md.
// 2. EVERY CONTRACT FILE VALIDATES. Each declares `$schema` as a relative path to a file in
//    schema/, every schema compiles under JSON Schema 2020-12, and the file validates against it.
// 3. NO COLOUR VALUES. The contract holds rules and markup, never a brand's values (SC-001), and
//    its stylesheets reach colour only through custom properties (SC-002). Refused anywhere in
//    contract/, schema/, styles/ and fixtures/: hex colours and the CSS colour functions with a
//    literal argument, in any declaration at any nesting depth. Refused in stylesheets and in
//    fixtures' style attributes, <style> elements and colour attributes: a CSS named colour on a
//    property that takes colour, custom properties included. Selectors are never read as values.
//    Allowed: var(), color-mix() over var(), currentColor, transparent, inherit and friends.
// 4. THE TARBALL. `npm pack --dry-run` of the package lists only package.json and files under the
//    directories and documents it declares, and every path in `exports` is in it.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const dir = path.resolve(process.argv[2] ?? path.join(here, '..', 'salt-contract'))
const fails = []
const rel = (abs) => path.relative(dir, abs).split(path.sep).join('/')

function walk(sub, pred = () => true) {
  const abs = path.join(dir, sub)
  if (!existsSync(abs)) return []
  return readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(abs, e.name)
    if (e.isDirectory()) return walk(rel(p), pred)
    return pred(p) ? [p] : []
  })
}

const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))

// ── 1 and 2 ───────────────────────────────────────────────────────────────────────────────────
const words = (k) => k.split(/[^A-Za-z0-9]+/)
  .flatMap((w) => w.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/))
  .filter(Boolean).map((w) => w.toLowerCase())
const isVersionKey = (k) => words(k).includes('version')

function versionKeys(node, trail, file) {
  if (Array.isArray(node)) { node.forEach((v, i) => versionKeys(v, [...trail, `[${i}]`], file)); return }
  if (!node || typeof node !== 'object') return
  for (const [k, v] of Object.entries(node)) {
    const isSchema = file.startsWith('schema/')
    // A schema DEFINES the `version` property contract files carry at their top level; that one
    // definition is not a version, so a schema's top-level `properties.version` is exempt. A
    // `properties.version` anywhere deeper defines something else and is ranked like any key.
    const definesVersion = isSchema && trail.length === 1 && trail[0] === 'properties' && k === 'version'
    if (isVersionKey(k) && !(trail.length === 0 && k === 'version' && !isSchema) && !definesVersion) {
      fails.push(`${file} ${[...trail, k].join('.').replace(/\.\[/g, '[')}: a version key this gate does not rank. ` +
        'The only version a contract file may carry is its top-level "version".')
      continue
    }
    versionKeys(v, [...trail, k], file)
  }
}

const ajv = new Ajv2020({ allErrors: true, strict: false })
const schemas = new Map()
for (const abs of walk('schema', (p) => p.endsWith('.json'))) {
  const file = rel(abs)
  let doc
  try { doc = JSON.parse(readFileSync(abs, 'utf8')) } catch (e) { fails.push(`${file} does not parse as JSON (${e.message})`); continue }
  versionKeys(doc, [], file)
  try { schemas.set(abs, ajv.compile(doc)) } catch (e) { fails.push(`${file} does not compile as a JSON Schema: ${e.message}`) }
}

const contractFiles = walk('contract', (p) => p.endsWith('.json'))
for (const abs of walk('contract', (p) => !p.endsWith('.json'))) fails.push(`${rel(abs)} is not JSON; contract/ holds JSON only`)
for (const abs of contractFiles) {
  const file = rel(abs)
  let doc
  try { doc = JSON.parse(readFileSync(abs, 'utf8')) } catch (e) { fails.push(`${file} does not parse as JSON (${e.message})`); continue }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) { fails.push(`${file} is not a JSON object`); continue }
  if (!('version' in doc)) fails.push(`${file} has no top-level version; package.json says ${pkg.version}`)
  else if (doc.version !== pkg.version) fails.push(`${file} version says ${doc.version}; package.json says ${pkg.version}`)
  versionKeys(doc, [], file)
  if (typeof doc.$schema !== 'string') { fails.push(`${file} declares no $schema; every contract file names the schema it validates against`); continue }
  if (path.isAbsolute(doc.$schema) || /^[a-z][a-z0-9+.-]*:/i.test(doc.$schema)) {
    fails.push(`${file} $schema must be a relative path to a file in schema/, not ${doc.$schema}`); continue
  }
  const schemaAbs = path.resolve(path.dirname(abs), doc.$schema)
  const family = file.startsWith('contract/fields/') ? 'schema/field-definition.schema.json'
    : file.startsWith('contract/markup/') ? 'schema/markup.schema.json' : null
  if (family && rel(schemaAbs) !== family) { fails.push(`${file} must validate against ${family}, not ${doc.$schema}`); continue }
  const validate = schemas.get(schemaAbs)
  if (!validate) { fails.push(`${file} names $schema ${doc.$schema}, which is not a compiled schema in schema/`); continue }
  if (!validate(doc)) {
    for (const err of validate.errors) fails.push(`${file} does not match ${rel(schemaAbs)}: ${err.instancePath || '/'} ${err.message}`)
  }
}

// ── 2b. The three artefacts agree ────────────────────────────────────────────────────────────
// sections.json names the sections, components and views; contract/fields and contract/markup
// describe them. JSON Schema cannot see across files, or inside a file across siblings, so this
// checks: every section has a fields file and every entry a markup file, and no file describes
// something the vocabulary lacks; each file's id is its file name; each variant in sections.json
// is a select field with the same option values, labels and default; markup describes only
// variant options the vocabulary offers (a component, having no fields file, only variants its
// own entry declares), each vocabulary variant offers each value once and defaults to one of them,
// and markup uses only components that have markup; within a
// fields file, sibling names and option values are unique, a select's default is one of its
// options, a condition names a sibling other than itself and expects values that sibling offers
// (or tests whether it is filled, which any type but a group, list, collection-query or link may be),
// a rowLabel names a child, a list's min is not above its max, and shared.omit and
// shared.defaults name shared settings. Every literal data-icon in markup is a name sections.json
// lists under icons (SC-007), and a select whose options come from icons defaults to a content
// name. Every id the markup draws or points at is a landmark id, <anchor>, or <owner>__<part>
// (SC-012). Applies only once contract/sections.json exists.
const read = (p) => { try { return JSON.parse(readFileSync(path.join(dir, p), 'utf8')) } catch { return null } }
const vocab = read('contract/sections.json')
// A vocabulary whose entries are objects; a bare list of ids has nothing to cross-check.
if (vocab && (vocab.sections ?? []).every((x) => x && typeof x === 'object')) {
  const has = (p) => existsSync(path.join(dir, p))
  const sectionIds = new Set((vocab.sections ?? []).map((s) => s.id))
  const entries = [...(vocab.sections ?? []), ...(vocab.components ?? []), ...(vocab.views ?? [])]
  const entryIds = new Set(entries.map((e) => e.id))
  for (const s of vocab.sections ?? []) {
    if (!has(`contract/fields/${s.id}.json`)) fails.push(`section ${s.id} has no contract/fields/${s.id}.json`)
  }
  for (const e of entries) {
    if (!has(`contract/markup/${e.id}.json`)) fails.push(`${e.id} has no contract/markup/${e.id}.json`)
  }
  // Icon names (SC-007): both platforms draw every listed name, so a name outside the list is one
  // a platform may not draw. Editors choose only content names, so a field default must be one.
  // The schema requires icons; a vocabulary without them has already failed, and every name it
  // uses is reported too rather than the gate throwing.
  const { content = [], chrome = [] } = vocab.icons ?? {}
  const iconContent = new Set(content)
  const iconNames = new Set([...content, ...chrome])
  // One rule for a data-icon wherever it is written, a node's attributes or a file's
  // dataAttributes: each name is from:<field> or a listed icon. An empty or non-string value names
  // no icon, so it fails the same way on both paths.
  // The values an attribute may take, whatever shape it is written in: a string, a list, an object
  // with value or enum, or something the schema has already refused. Never throws, so a malformed
  // file prints its schema failure and these checks' lines rather than a stack trace.
  const attributeValues = (v) => {
    if (v === undefined) return []
    if (Array.isArray(v)) return v.flatMap(attributeValues)
    if (v !== null && typeof v === 'object') return [...('value' in v ? [v.value] : []), ...(Array.isArray(v.enum) ? v.enum : [])]
    return [v]
  }
  const checkIcons = (file, v) => {
    for (const n of attributeValues(v)) {
      if (typeof n === 'string' && (n.startsWith('from:') || iconNames.has(n))) continue
      fails.push(`${file} draws icon ${n === '' ? '""' : n}, which sections.json icons does not list`)
    }
  }
  // Drawn ids (SC-012): every id the markup draws, and every id an attribute points at, is a
  // landmark id section#anchors reserves, the section's own <anchor>, or <owner>__<part>, the owner
  // an id in sections.json or <anchor>. A slugged anchor cannot contain __, so such an id never
  // meets one; a plain or from: id could. <anchor> is the section's settled id, so it means
  // something only in a section: the bare <anchor> only on the section wrapper (section.json's
  // root), and <anchor>__<part> only in section and component markup, never in the page, the
  // views, or the header and footer, which are drawn outside every section.
  const OUTSIDE_SECTIONS = new Set(['page', 'site-header', 'site-footer'])
  const landmarks = new Set(read('contract/markup/section.json')?.rules?.anchors?.reserved ?? [])
  const ID_ATTRIBUTES = ['id', 'for', 'aria-controls', 'aria-labelledby', 'aria-describedby']
  const checkIds = (file, attributes, doc, atRoot) => {
    const outside = doc.kind === 'view' || OUTSIDE_SECTIONS.has(doc.id)
    for (const key of ID_ATTRIBUTES) {
      for (const x of attributeValues(attributes?.[key]).filter((x) => typeof x !== 'string')) {
        fails.push(`${file} draws ${key} ${JSON.stringify(x)}, which is not an id`)
      }
      const values = attributeValues(attributes?.[key]).filter((x) => typeof x === 'string')
      for (const id of values.flatMap((x) => x.split(/\s+/)).filter(Boolean)) {
        if (landmarks.has(id)) continue
        if (id === '<anchor>') {
          if (!(doc.id === 'section' && atRoot && key === 'id')) fails.push(`${file} draws ${key} <anchor>, which only the section wrapper (section.json's root) may carry`)
          continue
        }
        const owner = /^(<anchor>|[a-z][a-z0-9-]*)__[a-z0-9<>-]+$/.exec(id)?.[1]
        if (!owner) { fails.push(`${file} draws ${key} ${id}, which is neither a landmark id nor <owner>__<part>`); continue }
        if (owner === '<anchor>' && outside) fails.push(`${file} draws ${key} ${id}, but <anchor> names a section's id and this is drawn outside every section`)
        if (owner !== '<anchor>' && !entryIds.has(owner)) fails.push(`${file} draws ${key} ${id}, whose owner ${owner} is not an id in sections.json`)
      }
    }
  }
  const checkAttributes = (file, attributes, doc, atRoot = false) => {
    checkIcons(file, attributes?.['data-icon'])
    checkIds(file, attributes, doc, atRoot)
  }
  const walkNodes = (file, nodes, doc) => {
    for (const node of nodes ?? []) {
      checkAttributes(file, node.attributes, doc)
      walkNodes(file, node.children, doc)
    }
  }
  // One rule for every variant in sections.json, section or component, so the two paths cannot
  // drift: each value offered once, the default one of them, and markup describing only those.
  // A variant that fails here is not compared with its fields file too, so one defect prints one line.
  const badVariants = new Set()
  const checkVariantDeclared = (owner, v) => {
    const before = fails.length
    const values = (v.options ?? []).map((o) => o.value)
    for (const x of new Set(values.filter((x, i) => values.indexOf(x) !== i))) {
      fails.push(`${owner} variant ${v.field} offers ${x} ${values.filter((y) => y === x).length} times in sections.json`)
    }
    if (!values.includes(v.default)) fails.push(`${owner} variant ${v.field} defaults to ${v.default}, which is not one of its options in sections.json`)
    if (fails.length > before) badVariants.add(`${owner}#${v.field}`)
  }
  const checkVariantOptions = (owner, mv, offered, source) => {
    for (const key of Object.keys(mv.options ?? {})) {
      if (!offered.includes(key)) fails.push(`${owner} markup describes variant option ${key}, which ${source} does not offer`)
    }
  }
  for (const e of entries) for (const v of e.variants ?? []) checkVariantDeclared(e.id, v)
  const settings = read('contract/fields/_section-settings.json')
  const sharedNames = new Set((settings?.fields ?? []).map((f) => f.name))
  const checkFields = (owner, fields) => {
    const byName = new Map()
    for (const f of fields ?? []) {
      if (byName.has(f.name)) fails.push(`${owner} has two fields named ${f.name}`)
      byName.set(f.name, f)
    }
    for (const f of fields ?? []) {
      const values = (f.options ?? []).map((o) => o.value)
      for (const v of values.filter((v, i) => values.indexOf(v) !== i)) fails.push(`${owner}.${f.name} offers ${v} twice`)
      if (f.type === 'select' && f.default !== undefined && !f.optionsFrom && !values.includes(f.default)) {
        fails.push(`${owner}.${f.name} default ${f.default} is not one of its options`)
      }
      for (const clause of [f.condition ?? []].flat()) {
        if (clause.field === f.name) { fails.push(`${owner}.${f.name} is conditioned on itself`); continue }
        const target = byName.get(clause.field)
        if (!target) { fails.push(`${owner}.${f.name} condition names ${clause.field}, which is not a sibling field`); continue }
        // `filled` (SC-006) tests whether the sibling has a value, so it may name most field types;
        // not a group, list, collection-query or link (an ACF group on WordPress), which ACF conditional
        // logic cannot target. JSON Schema cannot see a sibling's type, so only this gate enforces it.
        if ('filled' in clause) {
          if (['group', 'list', 'collection-query', 'link'].includes(target.type)) {
            fails.push(`${owner}.${f.name} condition tests whether ${clause.field} is filled, a ${target.type} field; filled may not name a group, list, collection-query or link`)
          }
          if (typeof clause.filled !== 'boolean') fails.push(`${owner}.${f.name} condition on ${clause.field}: filled is true or false`)
          if ('equals' in clause || 'in' in clause) fails.push(`${owner}.${f.name} condition on ${clause.field} tests filled and compares a value; a clause does one`)
          continue
        }
        const expected = [...('equals' in clause ? [clause.equals] : []), ...(clause.in ?? [])]
        if (target.type === 'select') {
          const offered = (target.options ?? []).map((o) => o.value)
          if (!target.optionsFrom) {
            for (const want of expected) if (!offered.includes(want)) fails.push(`${owner}.${f.name} condition expects ${want}, which ${clause.field} does not offer`)
          }
        } else if (target.type === 'boolean') {
          for (const want of expected) if (typeof want !== 'boolean') fails.push(`${owner}.${f.name} condition expects ${want}, but ${clause.field} is a boolean`)
        } else {
          fails.push(`${owner}.${f.name} condition names ${clause.field}, a ${target.type} field; a condition may name only a select or a boolean`)
        }
      }
      if (f.optionsFrom === 'icons' && f.default !== undefined && !iconContent.has(f.default)) {
        fails.push(`${owner}.${f.name} defaults to icon ${f.default}, which is not a content icon in sections.json`)
      }
      if (typeof f.min === 'number' && typeof f.max === 'number' && f.min > f.max) fails.push(`${owner}.${f.name} min ${f.min} exceeds max ${f.max}`)
      if (f.rowLabel && !(f.fields ?? []).some((c) => c.name === f.rowLabel)) {
        fails.push(`${owner}.${f.name} rowLabel names ${f.rowLabel}, which is not one of its fields`)
      }
      if (f.fields) checkFields(`${owner}.${f.name}`, f.fields)
    }
  }
  for (const abs of walk('contract/fields', (p) => p.endsWith('.json'))) {
    const name = path.basename(abs, '.json')
    const doc = read(rel(abs))
    if (!doc) continue
    const want = name === '_section-settings' ? 'section-settings' : name
    if (doc.section !== want) fails.push(`${rel(abs)} declares section ${doc.section}; its file name says ${want}`)
    if (name !== '_section-settings' && !sectionIds.has(name)) fails.push(`${rel(abs)} describes no section in sections.json`)
  }
  if (settings) checkFields('section-settings', settings.fields)
  for (const s of vocab.sections ?? []) {
    const doc = read(`contract/fields/${s.id}.json`)
    if (!doc) continue
    checkFields(s.id, doc.fields)
    if (doc.shared && !settings) fails.push(`${s.id} names shared settings, but contract/fields/_section-settings.json is missing`)
    for (const key of ['omit', 'defaults']) {
      const named = key === 'omit' ? (doc.shared?.omit ?? []) : Object.keys(doc.shared?.defaults ?? {})
      if (settings) for (const n of named) if (!sharedNames.has(n)) fails.push(`${s.id} shared.${key} names ${n}, which is not a shared setting`)
    }
    for (const v of s.variants ?? []) {
      if (badVariants.has(`${s.id}#${v.field}`)) continue
      const f = (doc.fields ?? []).find((x) => x.name === v.field)
      const want = v.options.map((o) => o.value).join(', ')
      if (!f || f.type !== 'select') { fails.push(`${s.id} variant ${v.field} has no select field of that name in its fields file`); continue }
      const got = (f.options ?? []).map((o) => o.value).join(', ')
      if (got !== want) { fails.push(`${s.id} variant ${v.field} offers ${want} in sections.json but ${got} in its fields file`); continue }
      if (v.default !== f.default) fails.push(`${s.id} variant ${v.field} defaults to ${v.default} in sections.json but ${f.default} in its fields file`)
      for (const o of v.options) {
        const label = f.options.find((x) => x.value === o.value)?.label
        if (label !== o.label) fails.push(`${s.id} variant ${v.field} option ${o.value} is labelled "${o.label}" in sections.json but "${label}" in its fields file`)
      }
    }
  }
  for (const abs of walk('contract/markup', (p) => p.endsWith('.json'))) {
    const name = path.basename(abs, '.json')
    const doc = read(rel(abs))
    if (!doc) continue
    if (doc.id !== name) fails.push(`${rel(abs)} declares id ${doc.id}; its file name says ${name}`)
    if (!entryIds.has(name)) { fails.push(`${rel(abs)} describes nothing in sections.json`); continue }
    checkAttributes(rel(abs), doc.root?.attributes, doc, true)
    walkNodes(rel(abs), doc.elements, doc)
    for (const da of (doc.dataAttributes ?? []).filter((x) => x.name === 'data-icon')) checkIcons(rel(abs), da.values)
    for (const mv of doc.variants ?? []) {
      for (const o of Object.values(mv.options ?? {})) {
        checkAttributes(rel(abs), o.root?.attributes, doc, true)
        for (const diff of Object.values(o.elements ?? {})) checkAttributes(rel(abs), diff.attributes, doc)
        walkNodes(rel(abs), [...Object.values(o.replace ?? {}), ...(o.tree ?? [])], doc)
      }
    }
    for (const u of doc.uses ?? []) {
      const target = String(u).split('#')[0]
      if (!has(`contract/markup/${target}.json`)) fails.push(`${name} uses ${target}, which has no markup file`)
    }
    const section = (vocab.sections ?? []).find((s) => s.id === name)
    if (section) {
      // A section's markup may describe variants of any select in its fields file; the options it
      // describes must be ones that select offers (and, for a vocabulary variant, ones sections.json offers).
      const fieldsDoc = read(`contract/fields/${name}.json`)
      for (const mv of doc.variants ?? []) {
        const sel = (fieldsDoc?.fields ?? []).find((x) => x.name === mv.field && x.type === 'select')
        if (!sel) { fails.push(`${name} markup describes a variant of ${mv.field}, which is not a select in its fields file`); continue }
        const sv = (section.variants ?? []).find((v) => v.field === mv.field)
        const offered = sv ? sv.options.map((o) => o.value) : sel.optionsFrom ? null : (sel.options ?? []).map((o) => o.value)
        if (!offered) continue
        checkVariantOptions(name, mv, offered, sv ? 'sections.json' : 'its fields file')
      }
    } else {
      // A component or view has no fields file, so its entry in sections.json is the only place
      // its variants are declared; without this, card's quote style could grow options unchecked.
      const entry = entries.find((e) => e.id === name)
      for (const mv of doc.variants ?? []) {
        const ev = (entry.variants ?? []).find((v) => v.field === mv.field)
        if (!ev) { fails.push(`${name} markup describes a variant of ${mv.field}, which its entry in sections.json does not declare`); continue }
        checkVariantOptions(name, mv, (ev.options ?? []).map((o) => o.value), 'its entry in sections.json')
      }
    }
  }
}

// ── 3 ─────────────────────────────────────────────────────────────────────────────────────────
const HEX = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/
// A colour function with a literal inside: a number, `none`, `from` (relative colour) or a colour
// space name followed by a number, as in color(srgb 1 0 0). color-mix() over var() is not one.
const FN = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(\s*(?:[-+.\d]|none\b|from\b|[a-z][\w-]*\s+[-+.\d])/i
const NAMED = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown ' +
  'burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod ' +
  'darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon ' +
  'darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey ' +
  'dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey ' +
  'honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral ' +
  'lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue ' +
  'lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine ' +
  'mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise ' +
  'mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered ' +
  'orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple ' +
  'rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue ' +
  'slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow ' +
  'yellowgreen').split(' '))

const lineAt = (text, index) => text.slice(0, index).split('\n').length
// What a colour check should not read: comments, the names of custom properties inside var()
// (a fallback after the comma is still read), and url() targets, whose file names and fragments
// may contain colour words or hex-looking anchors. Same length out as in, so line numbers hold.
const blank = (m) => m.replace(/[^\n]/g, ' ')
const cssReadable = (css) => css
  .replace(/\/\*[\s\S]*?\*\//g, blank)
  .replace(/url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\)/gi, (m) => 'url(' + blank(m.slice(4, -1)) + ')')
  .replace(/var\(\s*--[\w-]+/g, (m) => 'var(' + blank(m.slice(4)))
const namedIn = (value) => (value.match(/(?<![\w-])[a-z]+(?![\w-])/gi) ?? []).map((w) => w.toLowerCase()).find((w) => NAMED.has(w))
// Every declaration in a stylesheet, at any nesting depth: the text between `{` or `;` and the
// next `;` or `}`, excluding the selectors and at-rule preludes that end in `{`. Native CSS nesting
// puts declarations and child rules in the same block, so innermost blocks alone are not enough.
function declarations(css) {
  const out = []
  let depth = 0, start = 0
  for (let i = 0; i < css.length; i++) {
    const c = css[i]
    if (c === '{') { depth++; start = i + 1 }
    else if (c === ';' || c === '}') {
      if (depth > 0) {
        const text = css.slice(start, i), colon = text.indexOf(':')
        if (colon > 0) out.push({ property: text.slice(0, colon).trim().toLowerCase(), value: text.slice(colon + 1), index: start + colon + 1 })
      }
      if (c === '}') depth = Math.max(0, depth - 1)
      start = i + 1
    }
  }
  return out
}
// Properties whose value can be a colour: custom properties (a named colour there is a colour),
// and the colour, background, border, outline, shadow, SVG paint, decoration and rule families.
const TAKES_COLOUR = /^(?:--|.*color$|background|border|outline|box-shadow|text-shadow|fill$|stroke$|text-decoration|column-rule|mask|scrollbar-color)/
function checkCss(file, text, offset = 0, whole = text) {
  const css = cssReadable(text)
  const block = css.includes('{') ? css : `{${css}}`
  const shift = css.includes('{') ? 0 : 1
  for (const d of declarations(block)) {
    const at = lineAt(whole, offset + Math.max(0, d.index - shift))
    if (HEX.test(d.value) || FN.test(d.value)) fails.push(`${file}:${at} carries a colour value: ${d.property}: ${d.value.trim().slice(0, 80)}`)
    if (!TAKES_COLOUR.test(d.property)) continue
    const hit = namedIn(d.value)
    if (hit) fails.push(`${file}:${at} sets a named colour (${hit}) on ${d.property}; reach colour through a custom property`)
  }
}

for (const abs of walk('styles')) {
  const file = rel(abs)
  if (!file.endsWith('.css')) { fails.push(`${file}: styles/ holds .css files only, so every rule the gate reads is the rule that ships`); continue }
  checkCss(file, readFileSync(abs, 'utf8'))
}
const COLOUR_ATTR = /(?<![\w-])(fill|stroke|color|stop-color|flood-color|lighting-color|bgcolor)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+))/gi
const STYLE_ATTR = /(?<![\w-])style\s*=\s*(?:"([^"]*)"|'([^']*)')/gi
const STYLE_ELEMENT = /<style\b[^>]*>([\s\S]*?)<\/style>/gi
for (const abs of walk('fixtures')) {
  const file = rel(abs)
  const text = readFileSync(abs, 'utf8')
  if (!/\.(json|html?|svg)$/.test(file)) { fails.push(`${file}: fixtures holds .json, .html and .svg files only, so every file is one the gate reads`); continue }
  if (/\.(html?|svg)$/.test(file)) {
    for (const m of text.matchAll(COLOUR_ATTR)) {
      const value = (m[2] ?? m[3] ?? m[4]).replace(/url\([^)]*\)/gi, 'url()')
      const at = lineAt(text, m.index)
      if (HEX.test(value) || FN.test(value)) fails.push(`${file}:${at} carries a colour value in ${m[1]}`)
      const hit = namedIn(value)
      if (hit) fails.push(`${file}:${at} sets a named colour (${hit}) in ${m[1]}`)
    }
    for (const m of text.matchAll(STYLE_ATTR)) checkCss(file, m[1] ?? m[2], m.index, text)
    for (const m of text.matchAll(STYLE_ELEMENT)) checkCss(file, m[1], m.index + m[0].indexOf('>') + 1, text)
    continue
  }
  text.split('\n').forEach((line, i) => {
    if (HEX.test(line) || FN.test(line)) fails.push(`${file}:${i + 1} carries a colour value: ${line.trim().slice(0, 100)}`)
  })
}
for (const abs of [...walk('contract'), ...walk('schema')]) {
  const file = rel(abs)
  readFileSync(abs, 'utf8').split('\n').forEach((line, i) => {
    if (HEX.test(line) || FN.test(line)) fails.push(`${file}:${i + 1} carries a colour value: ${line.trim().slice(0, 100)}`)
  })
}

// ── 4 ─────────────────────────────────────────────────────────────────────────────────────────
if (statSync(dir).isDirectory()) {
  let packed = []
  try {
    const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    // npm 10 and 11 print an array of results; npm 12 prints an object keyed by package name.
    const json = JSON.parse(out)
    packed = (Array.isArray(json) ? json[0] : Object.values(json)[0]).files.map((f) => f.path)
  } catch (e) {
    fails.push(`npm pack --dry-run failed: ${(e.stderr || e.message).toString().trim().split('\n').at(-1)}`)
  }
  const isDir = (f) => existsSync(path.join(dir, f)) && statSync(path.join(dir, f)).isDirectory()
  const allowedDirs = (pkg.files ?? []).filter(isDir)
  const allowedDocs = new Set(['package.json', ...(pkg.files ?? []).filter((f) => !isDir(f))])
  const permitted = new Set(['contract', 'schema', 'styles', 'fixtures'])
  for (const f of packed) {
    const top = f.split('/')[0]
    if (allowedDocs.has(f)) continue
    if (f.includes('/') && permitted.has(top) && allowedDirs.includes(top)) continue
    fails.push(`the tarball carries a file that must not ship: package/${f}`)
  }
  const targets = Object.values(pkg.exports ?? {}).flatMap((t) => typeof t === 'string' ? [t] : Object.values(t))
  for (const t of targets) {
    const p = t.replace(/^\.\//, '')
    if (p.includes('*')) {
      // A subpath pattern: one `*` standing for any run of characters, as Node resolves it.
      const [pre, post] = p.split('*')
      if (!packed.some((f) => f.startsWith(pre) && f.endsWith(post) && f.length >= pre.length + post.length)) {
        fails.push(`no file in the tarball matches the exported pattern ${p}`)
      }
    } else if (!packed.includes(p)) fails.push(`exported path is not in the tarball: ${p}`)
  }
}

if (fails.length) {
  for (const f of fails) console.log(`✗ ${f}`)
  process.exit(1)
}
console.log(`PASS: ${pkg.name}@${pkg.version}: ${contractFiles.length} contract file(s) at one version, each valid against its schema; ` +
  'no colour values; the tarball ships only what it declares.')
