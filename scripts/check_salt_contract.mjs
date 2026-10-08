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
//    literal argument. Refused in stylesheets: a CSS named colour on a colour property.
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
    // A schema DEFINES the `version` property contract files carry; that definition is not a
    // version, so `properties.version` inside a schema is exempt.
    const definesVersion = isSchema && trail.at(-1) === 'properties' && k === 'version'
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
  const schemaAbs = path.resolve(path.dirname(abs), doc.$schema)
  const validate = schemas.get(schemaAbs)
  if (!validate) { fails.push(`${file} names $schema ${doc.$schema}, which is not a compiled schema in schema/`); continue }
  if (!validate(doc)) {
    for (const err of validate.errors) fails.push(`${file} does not match ${rel(schemaAbs)}: ${err.instancePath || '/'} ${err.message}`)
  }
}

// ── 2b. The three artefacts agree ────────────────────────────────────────────────────────────
// sections.json names the sections, components and views; contract/fields and contract/markup
// describe them. JSON Schema cannot see across files, or inside a file across siblings, so:
// every section has a fields file and every section, component and view a markup file; each
// variant in sections.json is a select field with the same option values; every select's default
// is one of its options; a condition names a sibling field; no two siblings share a name. Applies
// only once contract/sections.json exists.
const read = (p) => { try { return JSON.parse(readFileSync(path.join(dir, p), 'utf8')) } catch { return null } }
const vocab = read('contract/sections.json')
// A vocabulary whose entries are objects; a bare list of ids has nothing to cross-check.
if (vocab && (vocab.sections ?? []).every((x) => x && typeof x === 'object')) {
  const has = (p) => existsSync(path.join(dir, p))
  for (const s of vocab.sections ?? []) {
    if (!has(`contract/fields/${s.id}.json`)) fails.push(`section ${s.id} has no contract/fields/${s.id}.json`)
  }
  for (const e of [...(vocab.sections ?? []), ...(vocab.components ?? []), ...(vocab.views ?? [])]) {
    if (!has(`contract/markup/${e.id}.json`)) fails.push(`${e.id} has no contract/markup/${e.id}.json`)
  }
  const checkFields = (owner, fields) => {
    const names = new Set()
    for (const f of fields ?? []) {
      if (names.has(f.name)) fails.push(`${owner} has two fields named ${f.name}`)
      names.add(f.name)
    }
    for (const f of fields ?? []) {
      if (f.type === 'select' && f.default !== undefined && !(f.options ?? []).some((o) => o.value === f.default)) {
        fails.push(`${owner}.${f.name} default ${f.default} is not one of its options`)
      }
      for (const clause of [f.condition ?? []].flat()) {
        if (!names.has(clause.field)) fails.push(`${owner}.${f.name} condition names ${clause.field}, which is not a sibling field`)
      }
      if (f.fields) checkFields(`${owner}.${f.name}`, f.fields)
    }
  }
  for (const s of vocab.sections ?? []) {
    const doc = read(`contract/fields/${s.id}.json`)
    if (!doc) continue
    checkFields(s.id, doc.fields)
    for (const v of s.variants ?? []) {
      const f = (doc.fields ?? []).find((x) => x.name === v.field)
      const want = v.options.map((o) => o.value).join(', ')
      if (!f || f.type !== 'select') { fails.push(`${s.id} variant ${v.field} has no select field of that name in its fields file`); continue }
      const got = (f.options ?? []).map((o) => o.value).join(', ')
      if (got !== want) fails.push(`${s.id} variant ${v.field} offers ${want} in sections.json but ${got} in its fields file`)
    }
  }
  const settings = read('contract/fields/_section-settings.json')
  if (settings) checkFields('section-settings', settings.fields)
}

// ── 3 ─────────────────────────────────────────────────────────────────────────────────────────
const HEX = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/
const FN = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(\s*[-+.\d]/i
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
const COLOUR_PROPERTY = /(^|[\s;{])(?:color|background(?:-color)?|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-color)?|outline(?:-color)?|fill|stroke|caret-color|accent-color|text-decoration(?:-color)?|column-rule(?:-color)?|box-shadow|text-shadow)\s*:\s*([^;}]*)/gi

for (const abs of [...walk('contract'), ...walk('schema'), ...walk('styles'), ...walk('fixtures')]) {
  const file = rel(abs)
  const lines = readFileSync(abs, 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (HEX.test(line) || FN.test(line)) fails.push(`${file}:${i + 1} carries a colour value: ${line.trim().slice(0, 100)}`)
    if (file.endsWith('.css')) {
      for (const m of line.matchAll(COLOUR_PROPERTY)) {
        const hit = m[2].toLowerCase().match(/[a-z]+/g)?.find((w) => NAMED.has(w))
        if (hit) fails.push(`${file}:${i + 1} sets a named colour (${hit}) on a colour property; reach colour through a custom property`)
      }
    }
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
