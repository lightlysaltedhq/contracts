// Proves each check in check_salt_contract.mjs can fail, on a throwaway copy of a minimal package.
// A gate that has never been seen to fail is not known to check anything.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check_salt_contract.mjs')

function makePackage(edit = () => {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'salt-contract-gate-'))
  const files = {
    'package.json': {
      name: '@lightlysaltedhq/salt-contract',
      version: '0.1.0',
      private: true,
      files: ['contract', 'schema', 'styles', 'fixtures', 'README.md', 'CHANGELOG.md', 'RELEASE-POLICY.md', 'LICENSE'],
      exports: { './sections': './contract/sections.json', './package.json': './package.json' },
    },
    'schema/sections.schema.json': {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'sections.schema.json',
      type: 'object',
      required: ['version', 'sections'],
      properties: {
        $schema: { type: 'string' },
        version: { type: 'string' },
        sections: { type: 'array', items: { type: 'string', pattern: '^[a-z][a-z0-9-]*$' } },
      },
      additionalProperties: false,
    },
    'contract/sections.json': { $schema: '../schema/sections.schema.json', version: '0.1.0', sections: ['hero'] },
  }
  const text = { 'README.md': '# salt-contract\n', 'CHANGELOG.md': '# Changelog\n', 'RELEASE-POLICY.md': '# Policy\n', 'LICENSE': 'MIT\n' }
  edit(files, text)
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    writeFileSync(path.join(dir, rel), JSON.stringify(body, null, 2) + '\n')
  }
  for (const [rel, body] of Object.entries(text)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    writeFileSync(path.join(dir, rel), body)
  }
  return dir
}

function run(dir) {
  try {
    const out = execFileSync(process.execPath, [script, dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status, out: `${e.stdout}${e.stderr}` }
  }
}

function expectFail(edit, pattern) {
  const dir = makePackage(edit)
  try {
    const r = run(dir)
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}:\n${r.out}`)
    assert.match(r.out, pattern)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('a minimal well-formed package passes', () => {
  const dir = makePackage()
  try {
    const r = run(dir)
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /PASS/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a contract file whose version is not the package version fails', () => {
  expectFail((f) => { f['contract/sections.json'].version = '0.0.9' }, /version says 0\.0\.9; package\.json says 0\.1\.0/)
})

test('a contract file with no version fails', () => {
  expectFail((f) => { delete f['contract/sections.json'].version }, /has no top-level version/)
})

test('a version key anywhere but the top level fails', () => {
  expectFail((f) => {
    f['schema/sections.schema.json'].properties.sections.items = { type: 'string' }
    f['contract/sections.json'].sections = ['hero']
    f['contract/sections.json'].specVersion = '1'
  }, /specVersion: a version key this gate does not rank/)
})

test('a contract file that does not declare its schema fails', () => {
  expectFail((f) => { delete f['contract/sections.json'].$schema }, /declares no \$schema/)
})

test('a contract file that breaks its schema fails, naming the path', () => {
  expectFail((f) => { f['contract/sections.json'].sections = ['Hero Banner'] }, /contract\/sections\.json.*\/sections\/0/)
})

test('a schema that does not compile fails', () => {
  expectFail((f) => { f['schema/sections.schema.json'].type = 'not-a-type' }, /does not compile/)
})

test('a colour literal in the contract fails', () => {
  expectFail((f) => { f['contract/sections.json'].note = 'brand is #1a2b3c' }, /colour value/)
})

test('a functional colour in a stylesheet fails', () => {
  expectFail((f, t) => { t['styles/sections.css'] = '.salt-hero { color: oklch(0.5 0.1 150); }\n' }, /styles\/sections\.css:1.*colour value/)
})

test('a named colour on a colour property in a stylesheet fails', () => {
  expectFail((f, t) => { t['styles/sections.css'] = '.salt-hero {\n  background-color: rebeccapurple;\n}\n' }, /styles\/sections\.css:2.*named colour/)
})

test('a stylesheet that reaches colours only through custom properties passes', () => {
  const dir = makePackage((f, t) => {
    t['styles/sections.css'] = '.salt-hero { color: var(--color-ink); background: color-mix(in oklch, var(--color-brand) 10%, transparent); border-color: currentColor; }\n'
  })
  try {
    const r = run(dir)
    assert.equal(r.code, 0, r.out)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an export that is not in the tarball fails', () => {
  expectFail((f) => { f['package.json'].exports['./markup'] = './contract/markup.json' }, /exported path is not in the tarball: contract\/markup\.json/)
})

test('a file outside the declared directories in the tarball fails', () => {
  expectFail((f, t) => { f['package.json'].files.push('scratch'); t['scratch/notes.txt'] = 'x\n' }, /must not ship: package\/scratch\/notes\.txt/)
})

// ── Cross-file integrity: sections.json, contract/fields and contract/markup agree ────────────────
const crossSchemas = {
  'schema/sections.schema.json': { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' },
  'schema/field-definition.schema.json': { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' },
  'schema/markup.schema.json': { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' },
}
function crossPackage(edit) {
  return makePackage((f, t) => {
    delete f['schema/sections.schema.json']; delete f['contract/sections.json']
    f['package.json'].exports = { './package.json': './package.json' }
    Object.assign(f, structuredClone(crossSchemas))
    f['contract/sections.json'] = {
      $schema: '../schema/sections.schema.json', version: '0.1.0',
      sections: [{ id: 'hero', label: 'Hero', tier: 'core', variants: [{ field: 'variant', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], default: 'a' }] }],
      components: [{ id: 'button', label: 'Button' }], views: [],
      icons: { content: ['star'], chrome: ['close'] },
    }
    f['contract/fields/hero.json'] = {
      $schema: '../../schema/field-definition.schema.json', version: '0.1.0', section: 'hero',
      fields: [
        { name: 'variant', type: 'select', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], default: 'a' },
        { name: 'image', type: 'image', condition: { field: 'variant', in: ['b'] } },
      ],
    }
    f['contract/markup/hero.json'] = { $schema: '../../schema/markup.schema.json', version: '0.1.0', id: 'hero', kind: 'section' }
    f['contract/markup/button.json'] = { $schema: '../../schema/markup.schema.json', version: '0.1.0', id: 'button', kind: 'component' }
    edit?.(f, t)
  })
}
function crossRun(edit) {
  const dir = crossPackage(edit)
  try { return run(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}

test('cross-file: a consistent set passes', () => {
  const r = crossRun()
  assert.equal(r.code, 0, r.out)
})
test('cross-file: a section with no fields file fails', () => {
  const r = crossRun((f) => { delete f['contract/fields/hero.json'] })
  assert.equal(r.code, 1); assert.match(r.out, /section hero has no contract\/fields\/hero\.json/)
})
test('cross-file: a section or component with no markup file fails', () => {
  const r = crossRun((f) => { delete f['contract/markup/button.json'] })
  assert.equal(r.code, 1); assert.match(r.out, /button has no contract\/markup\/button\.json/)
})
test('cross-file: a variant whose options differ from its select field fails', () => {
  const r = crossRun((f) => { f['contract/fields/hero.json'].fields[0].options.pop() })
  assert.equal(r.code, 1); assert.match(r.out, /hero variant variant offers a, b in sections\.json but a in its fields file/)
})
test('cross-file: a select whose default is not an option fails', () => {
  const r = crossRun((f) => { f['contract/fields/hero.json'].fields[0].default = 'c' }) 
  assert.equal(r.code, 1); assert.match(r.out, /hero\.variant default c is not one of its options/)
})
test('cross-file: a condition naming a field that is not a sibling fails', () => {
  const r = crossRun((f) => { f['contract/fields/hero.json'].fields[1].condition.field = 'layout' })
  assert.equal(r.code, 1); assert.match(r.out, /hero\.image condition names layout, which is not a sibling field/)
})
test('cross-file: two sibling fields with one name fail', () => {
  const r = crossRun((f) => { f['contract/fields/hero.json'].fields[1].name = 'variant'; delete f['contract/fields/hero.json'].fields[1].condition })
  assert.equal(r.code, 1); assert.match(r.out, /hero has two fields named variant/)
})
test('cross-file: every clause of a list condition must name a sibling', () => {
  const r = crossRun((f) => { f['contract/fields/hero.json'].fields[1].condition = [{ field: 'variant', in: ['b'] }, { field: 'layout', equals: 'x' }] })
  assert.equal(r.code, 1); assert.match(r.out, /hero\.image condition names layout, which is not a sibling field/)
})
test('a subpath-pattern export passes when the tarball has a match, and fails when it has none', () => {
  let dir = makePackage((f) => { f['package.json'].exports['./contract/*'] = './contract/*.json' })
  try { assert.equal(run(dir).code, 0) } finally { rmSync(dir, { recursive: true, force: true }) }
  dir = makePackage((f) => { f['package.json'].exports['./markup/*'] = './contract/markup/*.json' })
  try { const r = run(dir); assert.equal(r.code, 1); assert.match(r.out, /no file in the tarball matches the exported pattern contract\/markup\/\*\.json/) } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ── Review of #2: colour values the first gate let through, and what it wrongly refused ─────────
const cssCase = (name, css, pattern) => test(`colour: ${name} fails`, () => {
  expectFail((f, t) => { t['styles/sections.css'] = css }, pattern)
})
cssCase('a named colour in a custom property', ':root {\n  --brand: red;\n}\n', /named colour \(red\)/)
cssCase('a named colour in a gradient', '.a { background-image: linear-gradient(red, var(--x)); }\n', /named colour \(red\)/)
cssCase('a declaration split across lines', '.a {\n  color:\n    red;\n}\n', /named colour \(red\)/)
cssCase('color() with a colour space', '.a { color: color(srgb 1 0 0); }\n', /colour value/)
cssCase('rgb() starting with none', '.a { color: rgb(none 2 3); }\n', /colour value/)
cssCase('an upper-case colour function', '.a { color: RGB(1, 2, 3); }\n', /colour value/)
test('colour: a styles file that is not CSS fails', () => {
  expectFail((f, t) => { t['styles/sections.scss'] = '.a { color: var(--x); }\n' }, /styles\/sections\.scss: styles\/ holds \.css files only/)
})
test('colour: a named colour in a fixture attribute fails', () => {
  expectFail((f, t) => { t['fixtures/hero/one.html'] = '<svg><path fill="red"/></svg>\n' }, /fixtures\/hero\/one\.html:1.*named colour \(red\)/)
})
test('colour: a named colour in a fixture style attribute fails', () => {
  expectFail((f, t) => { t['fixtures/hero/one.html'] = '<p style="color: red">x</p>\n' }, /named colour \(red\)/)
})
test('colour: token names, url() targets and anchors that contain colour words pass', () => {
  const dir = makePackage((f, t) => {
    t['styles/sections.css'] = '.a {\n  color: var(--salt-tan-surface);\n  background: url(red-arrow.svg) no-repeat;\n  mask: url(a.svg#abc);\n}\n.red:not(.tan) { color: currentColor; }\n'
    t['fixtures/hero/one.html'] = '<a class="salt-red" href="#cafe">x</a>\n'
  })
  try { const r = run(dir); assert.equal(r.code, 0, r.out) } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ── Review of #2: cross-file rules the first gate did not check ──────────────────────────────────
const crossFail = (name, edit, pattern) => test(`cross-file: ${name} fails`, () => {
  const r = crossRun(edit)
  assert.equal(r.code, 1, r.out); assert.match(r.out, pattern)
})
crossFail('a variant default that differs from the select default', (f) => { f['contract/fields/hero.json'].fields[0].default = 'b' }, /hero variant variant defaults to a in sections\.json but b in its fields file/)
crossFail('a variant option label that differs', (f) => { f['contract/fields/hero.json'].fields[0].options[1].label = 'Bee' }, /hero variant variant option b is labelled "B" in sections\.json but "Bee" in its fields file/)
crossFail('a condition value that is not an option of its select', (f) => { f['contract/fields/hero.json'].fields[1].condition = { field: 'variant', in: ['c'] } }, /hero\.image condition expects c, which variant does not offer/)
crossFail('a field conditioned on itself', (f) => { f['contract/fields/hero.json'].fields[1].condition = { field: 'image', equals: 'x' } }, /hero\.image is conditioned on itself/)
crossFail('duplicate option values', (f) => { f['contract/fields/hero.json'].fields[0].options.push({ value: 'b', label: 'B again' }) }, /hero\.variant offers b twice/)
crossFail('a list whose min exceeds its max', (f) => { f['contract/fields/hero.json'].fields.push({ name: 'rows', type: 'list', min: 5, max: 2, fields: [{ name: 'title', type: 'text' }] }) }, /hero\.rows min 5 exceeds max 2/)
crossFail('a rowLabel naming no child', (f) => { f['contract/fields/hero.json'].fields.push({ name: 'rows', type: 'list', rowLabel: 'nope', fields: [{ name: 'title', type: 'text' }] }) }, /hero\.rows rowLabel names nope, which is not one of its fields/)
crossFail('shared.omit naming no shared field', (f) => {
  f['contract/fields/_section-settings.json'] = { $schema: '../../schema/field-definition.schema.json', version: '0.1.0', section: 'section-settings', fields: [{ name: 'tone', type: 'text' }] }
  f['contract/fields/hero.json'].shared = { id: 'section-settings', omit: ['nope'] }
}, /hero shared\.omit names nope, which is not a shared setting/)
crossFail('a fields file whose section is not its file name', (f) => { f['contract/fields/hero.json'].section = 'faq' }, /contract\/fields\/hero\.json declares section faq/)
crossFail('a markup file whose id is not its file name', (f) => { f['contract/markup/hero.json'].id = 'faq' }, /contract\/markup\/hero\.json declares id faq/)
crossFail('a stray markup file', (f) => { f['contract/markup/zzz.json'] = { $schema: '../../schema/markup.schema.json', version: '0.1.0', id: 'zzz', kind: 'component' } }, /contract\/markup\/zzz\.json describes nothing in sections\.json/)
crossFail('a stray fields file', (f) => { f['contract/fields/zzz.json'] = { $schema: '../../schema/field-definition.schema.json', version: '0.1.0', section: 'zzz', fields: [] } }, /contract\/fields\/zzz\.json describes no section in sections\.json/)
crossFail('markup that uses a component with no markup', (f) => { f['contract/markup/hero.json'].uses = ['button', 'nonexistent'] }, /hero uses nonexistent, which has no markup file/)
crossFail('a markup variant option sections.json does not offer', (f) => { f['contract/markup/hero.json'].variants = [{ field: 'variant', options: { a: {}, bogus: {} } }] }, /hero markup describes variant option bogus, which sections\.json does not offer/)
crossFail('a fields file pointing at the markup schema', (f) => { f['contract/fields/hero.json'].$schema = '../../schema/markup.schema.json' }, /contract\/fields\/hero\.json must validate against schema\/field-definition\.schema\.json/)
test('cross-file: an absolute $schema fails', () => {
  expectFail((f) => { f['contract/sections.json'].$schema = '/Users/someone/schema/sections.schema.json' }, /\$schema must be a relative path/)
})
test('version: a properties.version below the top level of a schema fails', () => {
  expectFail((f) => { f['schema/sections.schema.json'].$defs = { x: { properties: { version: { const: '1' } } } } }, /\$defs\.x\.properties\.version: a version key/)
})
test('cross-file: a select whose options come from a registry may carry a default', () => {
  const r = crossRun((f) => { f['contract/fields/hero.json'].fields.push({ name: 'icon', type: 'select', optionsFrom: 'icons', default: 'star' }) })
  assert.equal(r.code, 0, r.out)
})

// ── Re-review of fe0fddb ─────────────────────────────────────────────────────────────────────────
cssCase('a named colour beside a nested rule', '.a {\n  color: red;\n  .b { margin: 0; }\n}\n', /named colour \(red\)/)
cssCase('a named colour after a nested rule', '.a {\n  .b { margin: 0 }\n  background: white;\n}\n', /named colour \(white\)/)
cssCase('a hex value in a nested rule', '.a {\n  .b { color: #fff; }\n}\n', /colour value/)
crossFail('a boolean condition expecting a non-boolean', (f) => {
  f['contract/fields/hero.json'].fields.push({ name: 'scrim', type: 'boolean' }, { name: 'strength', type: 'select', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], condition: { field: 'scrim', equals: 'yes' } })
}, /hero\.strength condition expects yes, but scrim is a boolean/)
crossFail('a condition on a text field', (f) => {
  f['contract/fields/hero.json'].fields.push({ name: 'title', type: 'text' }, { name: 'x', type: 'text', condition: { field: 'title', equals: 'a' } })
}, /hero\.x condition names title, a text field; a condition may name only a select or a boolean/)
crossFail('a markup variant on a field the section does not have', (f) => {
  f['contract/markup/hero.json'].variants = [{ field: 'bogus', options: { a: {} } }]
}, /hero markup describes a variant of bogus, which is not a select in its fields file/)
crossFail('shared settings named but the settings file missing', (f) => {
  f['contract/fields/hero.json'].shared = { id: 'section-settings', omit: ['tone'] }
}, /hero names shared settings, but contract\/fields\/_section-settings\.json is missing/)
test('colour: a <style> element in a fixture is read', () => {
  expectFail((f, t) => { t['fixtures/hero/one.html'] = '<svg><style>.a { fill: red }</style></svg>\n' }, /named colour \(red\)/)
})
test('colour: an unquoted colour attribute in a fixture is read', () => {
  expectFail((f, t) => { t['fixtures/hero/one.html'] = '<svg><path fill=red /></svg>\n' }, /named colour \(red\) in fill/)
})
test('colour: a fixture that is not JSON, HTML or SVG fails', () => {
  expectFail((f, t) => { t['fixtures/hero/one.jsx'] = 'export default () => null\n' }, /fixtures holds \.json, \.html and \.svg files only/)
})
test('colour: words that are not colours on non-colour properties, data attributes, url fragments and id selectors pass', () => {
  const dir = makePackage((f, t) => {
    t['styles/sections.css'] = '#add { margin: 0; }\n.a { content: "White space"; grid-area: tan; }\n'
    t['fixtures/hero/one.html'] = '<svg data-color="white"><path fill="url(#red)"/></svg>\n'
  })
  try { const r = run(dir); assert.equal(r.code, 0, r.out) } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ── SC-006: the `filled` condition clause ────────────────────────────────────────────────────────
// A clause may test that a sibling has a value (filled: true) or has none (filled: false), of any
// field type, instead of comparing it.
test('cross-file: a filled condition on an image sibling passes', () => {
  const r = crossRun((f) => {
    f['contract/fields/hero.json'].fields.push({ name: 'background', type: 'image' }, { name: 'fit', type: 'text', condition: { field: 'background', filled: true } })
  })
  assert.equal(r.code, 0, r.out)
})
test('cross-file: a filled clause inside a list condition passes beside an equals clause', () => {
  const r = crossRun((f) => {
    f['contract/fields/hero.json'].fields.push({ name: 'title', type: 'text' }, { name: 'x', type: 'text', condition: [{ field: 'variant', equals: 'b' }, { field: 'title', filled: true }] })
  })
  assert.equal(r.code, 0, r.out)
})
crossFail('a filled condition naming a field that is not a sibling', (f) => {
  f['contract/fields/hero.json'].fields[1].condition = { field: 'background', filled: true }
}, /hero\.image condition names background, which is not a sibling field/)
crossFail('a filled condition on itself', (f) => {
  f['contract/fields/hero.json'].fields[1].condition = { field: 'image', filled: true }
}, /hero\.image is conditioned on itself/)
test('cross-file: a filled: false condition on a text sibling passes', () => {
  const r = crossRun((f) => {
    f['contract/fields/hero.json'].fields.push({ name: 'heading', type: 'text' }, { name: 'label', type: 'text', condition: { field: 'heading', filled: false } })
  })
  assert.equal(r.code, 0, r.out)
})
crossFail('a filled clause that is not a boolean', (f) => {
  f['contract/fields/hero.json'].fields[1].condition = { field: 'variant', filled: 'yes' }
}, /hero\.image condition on variant: filled is true or false/)
crossFail('a filled clause that also compares a value', (f) => {
  f['contract/fields/hero.json'].fields[1].condition = { field: 'variant', filled: true, equals: 'b' }
}, /hero\.image condition on variant tests filled and compares a value; a clause does one/)

// The real field-definition schema accepts the clause and refuses the malformed ones.
const realFieldSchema = JSON.parse(readFileSync(path.join(path.dirname(script), '..', 'salt-contract', 'schema', 'field-definition.schema.json'), 'utf8'))
function realSchemaRun(condition) {
  return crossRun((f) => {
    f['schema/field-definition.schema.json'] = structuredClone(realFieldSchema)
    f['contract/fields/_section-settings.json'] = { $schema: '../../schema/field-definition.schema.json', version: '0.1.0', section: 'section-settings', fields: [{ name: 'tone', type: 'text', label: 'Tone' }] }
    f['contract/fields/hero.json'] = {
      $schema: '../../schema/field-definition.schema.json', version: '0.1.0', section: 'hero', shared: { id: 'section-settings' },
      fields: [
        { name: 'variant', type: 'select', label: 'Variant', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], default: 'a' },
        { name: 'background', type: 'image', label: 'Background' },
        { name: 'fit', type: 'text', label: 'Fit', condition },
      ],
    }
  })
}
test('schema: the field-definition schema accepts a filled clause', () => {
  const r = realSchemaRun({ field: 'background', filled: true })
  assert.equal(r.code, 0, r.out)
})
test('schema: the field-definition schema accepts filled: false', () => {
  const r = realSchemaRun({ field: 'background', filled: false })
  assert.equal(r.code, 0, r.out)
})
test('schema: the field-definition schema refuses a filled that is not a boolean', () => {
  const r = realSchemaRun({ field: 'background', filled: 'yes' })
  assert.equal(r.code, 1, r.out); assert.match(r.out, /contract\/fields\/hero\.json does not match schema\/field-definition\.schema\.json/)
})
test('schema: the field-definition schema refuses a clause that tests filled and compares', () => {
  const r = realSchemaRun({ field: 'variant', filled: true, equals: 'b' })
  assert.equal(r.code, 1, r.out); assert.match(r.out, /contract\/fields\/hero\.json does not match schema\/field-definition\.schema\.json/)
})

// ── Review of #4: ACF cannot condition on a group, a list, a collection-query or a link ─────────
for (const [type, extra] of [['group', { fields: [{ name: 'a', type: 'text' }] }], ['list', { fields: [{ name: 'a', type: 'text' }] }], ['collection-query', { source: 'posts' }], ['link', {}]]) {
  crossFail(`a filled condition on a ${type} sibling`, (f) => {
    f['contract/fields/hero.json'].fields.push({ name: 'box', type, ...extra }, { name: 'x', type: 'text', condition: { field: 'box', filled: true } })
  }, new RegExp(`hero\\.x condition tests whether box is filled, a ${type} field; filled may not name a group, list, collection-query or link`))
}

// ── 08/10 review deferral: a component's variants are declared in sections.json ─────────────────
// A component has no fields file, so its markup's variants are checked against its vocabulary entry.
const componentVariant = (f) => {
  f['contract/sections.json'].components[0].variants = [{ field: 'style', options: [{ value: 'solid', label: 'Solid' }, { value: 'ghost', label: 'Ghost' }], default: 'solid' }]
}
test('cross-file: component markup describing variant options its entry declares passes', () => {
  const r = crossRun((f) => { componentVariant(f); f['contract/markup/button.json'].variants = [{ field: 'style', options: { solid: {}, ghost: {} } }] })
  assert.equal(r.code, 0, r.out)
})
crossFail('component markup describing a variant option its entry does not offer', (f) => {
  componentVariant(f); f['contract/markup/button.json'].variants = [{ field: 'style', options: { solid: {}, outline: {} } }]
}, /button markup describes variant option outline, which its entry in sections\.json does not offer/)
crossFail('component markup describing a variant its entry does not declare', (f) => {
  f['contract/markup/button.json'].variants = [{ field: 'style', options: { solid: {} } }]
}, /button markup describes a variant of style, which its entry in sections\.json does not declare/)

// ── SC-007: icon names are the union sections.json lists ────────────────────────────────────────
const withIcons = (f) => {
  f['contract/sections.json'].icons = { content: ['star', 'check'], chrome: ['check', 'close'] }
  f['contract/sections.json'].components.push({ id: 'icon', label: 'Icon' })
  f['contract/markup/icon.json'] = { $schema: '../../schema/markup.schema.json', version: '0.1.0', id: 'icon', kind: 'component' }
}
const iconNode = (name) => ({ role: 'glyph', component: 'icon', attributes: { 'data-icon': name } })
test('cross-file: listed icon names in markup and a content default pass', () => {
  const r = crossRun((f) => {
    withIcons(f)
    f['contract/markup/hero.json'].elements = [{ role: 'box', element: 'div', children: [iconNode('close'), iconNode('from:name')] }]
    f['contract/fields/hero.json'].fields.push({ name: 'icon', type: 'select', optionsFrom: 'icons', default: 'star' })
  })
  assert.equal(r.code, 0, r.out)
})
crossFail('a nested icon name sections.json does not list', (f) => {
  withIcons(f); f['contract/markup/hero.json'].elements = [{ role: 'box', element: 'div', children: [iconNode('rocket')] }]
}, /contract\/markup\/hero\.json draws icon rocket, which sections\.json icons does not list/)
crossFail('an unlisted icon name in a variant option', (f) => {
  withIcons(f)
  f['contract/markup/hero.json'].elements = [iconNode('check')]
  f['contract/markup/hero.json'].variants = [{ field: 'variant', options: { b: { elements: { glyph: { attributes: { 'data-icon': 'moon' } } } } } }]
}, /contract\/markup\/hero\.json draws icon moon, which sections\.json icons does not list/)
crossFail('an icon field defaulting to a chrome-only name', (f) => {
  withIcons(f); f['contract/fields/hero.json'].fields.push({ name: 'icon', type: 'select', optionsFrom: 'icons', default: 'close' })
}, /hero\.icon defaults to icon close, which is not a content icon in sections\.json/)

// The real sections schema requires the icon lists and refuses a repeated name.
const realSectionsSchema = JSON.parse(readFileSync(path.join(path.dirname(script), '..', 'salt-contract', 'schema', 'sections.schema.json'), 'utf8'))
const realVocab = (icons) => crossRun((f) => {
  f['schema/sections.schema.json'] = structuredClone(realSectionsSchema)
  const both = { nextjs: { status: 'ships' }, wordpress: { status: 'ships' } }
  f['contract/sections.json'].sections[0].platforms = both
  f['contract/sections.json'].components[0].platforms = both
  if (icons === undefined) delete f['contract/sections.json'].icons
  else f['contract/sections.json'].icons = icons
})
test('schema: the sections schema accepts content and chrome icon lists', () => {
  const r = realVocab({ content: ['star'], chrome: ['close'] })
  assert.equal(r.code, 0, r.out)
})
test('schema: the sections schema requires the icon lists', () => {
  const r = realVocab(undefined)
  assert.equal(r.code, 1, r.out); assert.match(r.out, /contract\/sections\.json does not match schema\/sections\.schema\.json: \/ must have required property 'icons'/)
})
test('schema: the sections schema refuses a name listed twice in one list', () => {
  const r = realVocab({ content: ['star', 'star'], chrome: ['close'] })
  assert.equal(r.code, 1, r.out); assert.match(r.out, /\/icons\/content must NOT have duplicate items/)
})

// SC-007 closed the last open question; the markup schema no longer offers the topic.
const realMarkupSchema = JSON.parse(readFileSync(path.join(path.dirname(script), '..', 'salt-contract', 'schema', 'markup.schema.json'), 'utf8'))
const realMarkupRun = (notes) => crossRun((f) => {
  f['schema/markup.schema.json'] = structuredClone(realMarkupSchema)
  f['contract/markup/hero.json'].root = { element: 'div' }
  f['contract/markup/button.json'].root = { element: 'a' }
  f['contract/markup/hero.json'].notes = notes
})
test('schema: the markup schema accepts a ruling note', () => {
  const r = realMarkupRun([{ topic: 'ruling', text: 'x' }])
  assert.equal(r.code, 0, r.out)
})
test('schema: the markup schema refuses an open-question note', () => {
  const r = realMarkupRun([{ topic: 'open-question', text: 'x' }])
  assert.equal(r.code, 1, r.out); assert.match(r.out, /contract\/markup\/hero\.json does not match schema\/markup\.schema\.json: \/notes\/0\/topic must be equal to one of the allowed values/)
})

// ── Review of #6: one variant rule for sections and components ──────────────────────────────────
crossFail('a component variant whose default is not one of its options', (f) => {
  componentVariant(f); f['contract/sections.json'].components[0].variants[0].default = 'outline'
}, /button variant style defaults to outline, which is not one of its options in sections\.json/)
crossFail('a component variant offering one value twice', (f) => {
  componentVariant(f); f['contract/sections.json'].components[0].variants[0].options.push({ value: 'ghost', label: 'Ghost again' })
}, /button variant style offers ghost twice in sections\.json/)
crossFail('a section variant whose default is not one of its options', (f) => {
  f['contract/sections.json'].sections[0].variants[0].default = 'z'
}, /hero variant variant defaults to z, which is not one of its options in sections\.json/)
crossFail('an unlisted icon name in dataAttributes', (f) => {
  withIcons(f); f['contract/markup/hero.json'].dataAttributes = [{ name: 'data-icon', on: 'glyph', values: ['star', 'rocket'] }]
}, /contract\/markup\/hero\.json draws icon rocket, which sections\.json icons does not list/)
test('cross-file: a data-icon in dataAttributes read from content passes', () => {
  const r = crossRun((f) => { withIcons(f); f['contract/markup/hero.json'].dataAttributes = [{ name: 'data-icon', on: 'glyph', values: 'from:name' }] })
  assert.equal(r.code, 0, r.out)
})
test('schema: the sections schema refuses openQuestions', () => {
  const r = crossRun((f) => {
    f['schema/sections.schema.json'] = structuredClone(realSectionsSchema)
    const both = { nextjs: { status: 'ships' }, wordpress: { status: 'ships' } }
    f['contract/sections.json'].sections[0].platforms = both
    f['contract/sections.json'].components[0].platforms = both
    f['contract/sections.json'].openQuestions = [{ id: 'q', question: 'x' }]
  })
  assert.equal(r.code, 1, r.out); assert.match(r.out, /contract\/sections\.json does not match schema\/sections\.schema\.json: \/ must NOT have additional properties/)
})

// ── Re-review of #6: one icon rule on both paths ─────────────────────────────────────────────────
crossFail('an empty data-icon in dataAttributes', (f) => {
  withIcons(f); f['contract/markup/hero.json'].dataAttributes = [{ name: 'data-icon', on: 'glyph', values: '' }]
}, /contract\/markup\/hero\.json draws icon "", which sections\.json icons does not list/)
crossFail('an empty data-icon on a node', (f) => {
  withIcons(f); f['contract/markup/hero.json'].elements = [iconNode('')]
}, /contract\/markup\/hero\.json draws icon "", which sections\.json icons does not list/)
