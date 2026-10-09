#!/usr/bin/env node
// The extension points' gate: run as `node scripts/check_salt_extensions.mjs [package-dir]`.
//
// What JSON Schema cannot see across files, for the ladder's tiers 2, 4 and 5 (README, "The
// customisation ladder"). Each check is proved able to fail by check_salt_extensions.test.mjs.
// check_salt_contract.mjs already validates every file here against its schema.
//
// 1. DIALS (contract/dials.json). Every token a dial sets is named in contract/token-layer.json, so
//    a dial can only move what the stylesheets read. Every rung an option points at is named there
//    too, or is a rung of design-foundations' scale shape (foundations/contract/scale-shape.json,
//    beside this package): the runtime writes the rung's value, so it need not emit the rung. An
//    option sets only its dial's tokens and never a token to itself. A design-foundations rung whose
//    family's values reference other tokens (its requiresTokens) makes the dial require them, so a
//    runtime emits them while it is set: each is in the dial's requires, and requires agrees with
//    the token layer's requiredBy both ways. Dial ids and names are unique,
//    option values are unique within a dial, and the default is one of them.
// 2. VIEW PROPS (contract/view-props/). Every section in contract/sections.json has a file, no file
//    names anything else, and each file's section is its file name (`shared` for _shared.json, which
//    no section may be called). Every `field` names a real field in the section's fields file,
//    through groups and list rows by dots, or a shared setting the section keeps as
//    `settings.<name>`. A `from: field` prop takes its field's name, and an enum drawn from a
//    select offers exactly the select's options, so a generated type cannot drift from the editor.
//    It is nullable whenever its field can clean or resolve to nothing (any text, textarea, rich
//    text, image, link, relationship or number field, required or not, and a select with no
//    default that is not required); a non-null value backed by such a field comes from the logic,
//    with a description saying how the logic guarantees it.
//    Every `of` names a type in the file or in _shared.json; a list may also hold a scalar kind.
// 3. REPLACED LOGIC (schema/replaced-logic.schema.json). Its examples validate against it, name
//    only contract sections, and list no contract section as client-only.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const dir = path.resolve(process.argv[2] ?? path.join(here, '..', 'salt-contract'))
const fails = []
const read = (p) => {
  try { return JSON.parse(readFileSync(path.join(dir, p), 'utf8')) } catch { return null }
}

const vocab = read('contract/sections.json')
const sectionIds = new Set((vocab?.sections ?? []).map((s) => s.id))

// ── 1 ─────────────────────────────────────────────────────────────────────────────────────────
const layer = read('contract/token-layer.json')
const layerNames = new Set()
const layerEntries = new Map()
for (const g of layer?.groups ?? []) {
  for (const t of g.tokens ?? []) {
    if (t.name) { layerNames.add(t.name); layerEntries.set(t.name, t) }
    // A text role is five properties, as the token-layer schema says.
    if (t.textRole) {
      for (const s of ['', '--line-height', '--letter-spacing', '--font-weight', '--font-family']) layerNames.add(`--text-${t.textRole}${s}`)
    }
  }
}
// The scale shape is design-foundations', which this repository holds beside the package; a
// family's rungs are its css pattern with each step, or the pattern itself when it has no steps.
const scaleRungs = new Map() // rung -> the properties its family's values reference
try {
  const shape = JSON.parse(readFileSync(path.join(here, '..', 'foundations', 'contract', 'scale-shape.json'), 'utf8'))
  for (const f of Object.values(shape.families ?? {})) {
    if (typeof f.css !== 'string') continue
    // A colour role id is its CSS name with each dot a hyphen (vocabulary.json): color.shadow.sm.
    const needs = (f.requiresTokens ?? []).map((t) => `--${t.replaceAll('.', '-')}`)
    if (f.css.includes('{k}')) for (const k of f.steps ?? []) scaleRungs.set(f.css.replace('{k}', k), needs)
    else scaleRungs.set(f.css, needs)
  }
} catch (e) {
  fails.push(`foundations/contract/scale-shape.json could not be read (${e.message}); a dial's rungs are checked against it`)
}
const dials = read('contract/dials.json')
if (dials) {
  const ids = new Set()
  const names = new Set()
  for (const d of dials.dials ?? []) {
    const at = `contract/dials.json ${d.id}`
    if (ids.has(d.id)) fails.push(`${at}: the dial id is used twice`)
    ids.add(d.id)
    if (names.has(d.name)) fails.push(`${at}: the setting name ${d.name} is used twice`)
    names.add(d.name)
    const own = new Set(d.tokens ?? [])
    for (const t of own) {
      if (!layerNames.has(t)) fails.push(`${at}: sets ${t}, which contract/token-layer.json does not name, so no stylesheet reads it`)
    }
    const values = new Set()
    for (const o of d.options ?? []) {
      if (values.has(o.value)) fails.push(`${at}: offers ${o.value} twice`)
      values.add(o.value)
      for (const [token, to] of Object.entries(o.sets ?? {})) {
        if (!own.has(token)) fails.push(`${at}.${o.value}: sets ${token}, which is not one of the dial's tokens`)
        if (to === token) fails.push(`${at}.${o.value}: sets ${token} to itself`)
        else if (to !== '0' && !layerNames.has(to) && !scaleRungs.has(to)) {
          fails.push(`${at}.${o.value}: points ${token} at ${to}, which neither contract/token-layer.json nor design-foundations' scale shape names`)
        }
      }
    }
    if (!values.has(d.default)) fails.push(`${at}: defaults to ${d.default}, which it does not offer`)
    const requires = new Set(d.requires ?? [])
    for (const o of d.options ?? []) {
      for (const to of Object.values(o.sets ?? {})) {
        for (const need of scaleRungs.get(to) ?? []) {
          if (!requires.has(need)) fails.push(`${at}.${o.value}: points at ${to}, whose value references ${need}, which the dial does not list under requires`)
        }
      }
    }
    for (const t of requires) {
      const entry = layerEntries.get(t)
      if (!entry) fails.push(`${at}: requires ${t}, which contract/token-layer.json does not name`)
      else if (!(entry.requiredBy ?? []).includes(d.id)) fails.push(`${at}: requires ${t}, but contract/token-layer.json does not list ${d.id} in its requiredBy`)
    }
  }
}

for (const [name, t] of layerEntries) {
  for (const id of t.requiredBy ?? []) {
    const dial = (dials?.dials ?? []).find((d) => d.id === id)
    if (!dial || !(dial.requires ?? []).includes(name)) fails.push(`contract/token-layer.json says ${name} is required by ${id}, but no dial ${id} lists it under requires`)
  }
}

// ── 2 ─────────────────────────────────────────────────────────────────────────────────────────
const SCALARS = new Set(['text', 'integer', 'number', 'boolean', 'icon'])
const CAN_BE_EMPTY = new Set(['text', 'textarea', 'rich-text', 'image', 'link', 'relationship', 'number'])
const propsDir = path.join(dir, 'contract/view-props')
const propFiles = existsSync(propsDir) ? readdirSync(propsDir).filter((f) => f.endsWith('.json')) : []
if (vocab) {
  if (sectionIds.has('shared')) fails.push('contract/sections.json names a section shared, which contract/view-props/_shared.json takes')
  for (const id of sectionIds) {
    if (!propFiles.includes(`${id}.json`)) fails.push(`section ${id} has no contract/view-props/${id}.json`)
  }
}
const shared = read('contract/view-props/_shared.json')
const sharedTypes = shared?.types ?? {}
const settings = read('contract/fields/_section-settings.json')

// A dotted path through a fields file: each step a field's name, descending into a group's or a
// list's fields. Returns the field, or null.
function resolve(fields, steps) {
  let here = fields
  let found = null
  for (const step of steps) {
    found = (here ?? []).find((f) => f.name === step) ?? null
    if (!found) return null
    here = found.fields
  }
  return found
}

function checkProps(file, owner, props, fieldsDoc, types) {
  for (const prop of props ?? []) {
    const at = `${file} ${owner}.${prop.name}`
    if (prop.of !== undefined) {
      const isType = prop.of in types || prop.of in sharedTypes
      if (prop.kind === 'object' && !isType) fails.push(`${at}: of ${prop.of} names no type in the file or in _shared.json`)
      if (prop.kind === 'list' && !isType && !SCALARS.has(prop.of)) fails.push(`${at}: of ${prop.of} names no type in the file or in _shared.json, nor a scalar kind`)
    }
    if (prop.field === undefined) continue
    const steps = prop.field.split('.')
    let field
    if (steps[0] === 'settings') {
      const omitted = new Set(fieldsDoc?.shared?.omit ?? [])
      field = omitted.has(steps[1]) ? null : resolve(settings?.fields, steps.slice(1))
    } else {
      field = fieldsDoc ? resolve(fieldsDoc.fields, steps) : null
    }
    if (!field) { fails.push(`${at}: field ${prop.field} is not a field of this section`); continue }
    if (prop.from === 'field' && prop.name !== steps.at(-1)) fails.push(`${at}: comes from field ${prop.field}, so it takes that field's name, ${steps.at(-1)}`)
    // A field whose value can clean or resolve to nothing gives a nullable prop, required or not:
    // SC-009 empties whitespace-only text, and an image or document can be deleted. Only the logic
    // can promise a value (by dropping the row without one), and it says how in the description.
    const canBeEmpty = !field.many && (CAN_BE_EMPTY.has(field.type) || (!field.required && field.default === undefined && field.type === 'select'))
    if (canBeEmpty && !['list'].includes(prop.kind) && !prop.nullable) {
      if (prop.from === 'field') fails.push(`${at}: field ${prop.field} can clean or resolve to nothing, so the prop is nullable; a value the logic guarantees comes from: logic`)
      else if (prop.from === 'logic' && !prop.description) fails.push(`${at}: never null though field ${prop.field} can be empty, so its description says how the logic guarantees it`)
    }
    if (prop.from === 'field' && prop.kind === 'enum' && field.type === 'select' && Array.isArray(field.options)) {
      const want = field.options.map((o) => o.value)
      const got = prop.values ?? []
      if (want.length !== got.length || want.some((v) => !got.includes(v))) {
        fails.push(`${at}: offers ${got.join('|')}, but field ${prop.field} offers ${want.join('|')}`)
      }
    }
  }
}

for (const name of propFiles) {
  const file = `contract/view-props/${name}`
  const doc = read(file)
  if (!doc) { fails.push(`${file} does not parse as JSON`); continue }
  const stem = name.replace(/\.json$/, '')
  if (stem === '_shared') {
    if (doc.section !== 'shared') fails.push(`${file}: section must be shared`)
  } else {
    if (doc.section !== stem) { fails.push(`${file}: section says ${doc.section}; the file is ${stem}`); continue }
    if (vocab && !sectionIds.has(stem)) { fails.push(`${file}: ${stem} is not a section in contract/sections.json`); continue }
  }
  const fieldsDoc = stem === '_shared' ? { fields: [] } : read(`contract/fields/${stem}.json`)
  const types = doc.types ?? {}
  checkProps(file, 'data', doc.data, fieldsDoc, types)
  for (const [id, t] of Object.entries(types)) checkProps(file, id, t.props, fieldsDoc, types)
}

// ── 3 ─────────────────────────────────────────────────────────────────────────────────────────
const replaced = read('schema/replaced-logic.schema.json')
if (replaced) {
  const examples = replaced.examples ?? []
  if (!examples.length) fails.push('schema/replaced-logic.schema.json carries no example; it is the format\'s documentation')
  let validate = null
  try { validate = new Ajv2020({ allErrors: true, strict: false }).compile(replaced) } catch (e) {
    fails.push(`schema/replaced-logic.schema.json does not compile: ${e.message}`)
  }
  examples.forEach((ex, i) => {
    const at = `schema/replaced-logic.schema.json examples[${i}]`
    if (validate && !validate(ex)) for (const e of validate.errors) fails.push(`${at} does not match the schema: ${e.instancePath || '/'} ${e.message}`)
    for (const s of ex.sections ?? []) {
      if (!sectionIds.has(s.section)) fails.push(`${at}: ${s.section} is not a section in contract/sections.json`)
    }
    for (const c of ex.clientSections ?? []) {
      if (sectionIds.has(c.id)) fails.push(`${at}: ${c.id} is a contract section, so it cannot be client-only`)
    }
  })
}

if (fails.length) {
  for (const f of fails) console.log(`✗ ${f}`)
  process.exit(1)
}
console.log(`PASS: ${(dials?.dials ?? []).length} dial(s) move only tokens the layer names, to rungs that exist; ` +
  `${propFiles.length} view-props file(s), one per section, each field a real one; the replaced-logic examples hold.`)
