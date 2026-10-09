// Proves each check in check_salt_extensions.mjs can fail, on a throwaway copy of the package's
// contract/ and schema/, and that the package as it stands passes (which is how `npm run verify`
// runs this gate until it has a script of its own).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const script = path.join(here, 'check_salt_extensions.mjs')
const pkg = path.join(here, '..', 'salt-contract')

function run(dir) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [script, dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
  } catch (e) {
    return { code: e.status, out: `${e.stdout}${e.stderr}` }
  }
}

// edit(json, dir): json(file, fn) rewrites a JSON file under the copy through fn.
function expectFail(edit, pattern) {
  const dir = mkdtempSync(path.join(tmpdir(), 'salt-extensions-gate-'))
  try {
    cpSync(path.join(pkg, 'contract'), path.join(dir, 'contract'), { recursive: true })
    cpSync(path.join(pkg, 'schema'), path.join(dir, 'schema'), { recursive: true })
    const json = (file, fn) => {
      const p = path.join(dir, file)
      const doc = JSON.parse(readFileSync(p, 'utf8'))
      writeFileSync(p, JSON.stringify(fn(doc) ?? doc, null, 2))
    }
    edit(json, dir)
    const r = run(dir)
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}:\n${r.out}`)
    assert.match(r.out, pattern)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const dial = (doc, id) => doc.dials.find((d) => d.id === id)
const props = (doc, name) => doc.data.find((p) => p.name === name)

test('the package as it stands passes', () => {
  const r = run(pkg)
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /PASS/)
})

// ── 1 ──
test('a dial setting a token the layer does not name fails', () => {
  expectFail((json) => json('contract/dials.json', (d) => { dial(d, 'corners').tokens.push('--radius-xl') }), /sets --radius-xl, which contract\/token-layer\.json does not name/)
})
test('a token the layer drops fails the dial that sets it', () => {
  expectFail((json) => json('contract/token-layer.json', (d) => {
    for (const g of d.groups) g.tokens = g.tokens.filter((t) => t.name !== '--radius-sm')
  }), /corners: sets --radius-sm, which contract\/token-layer\.json does not name/)
})
test('an option pointing at a rung the layer does not name fails', () => {
  expectFail((json) => json('contract/dials.json', (d) => { dial(d, 'corners').options[2].sets['--radius-md'] = '--radius-xl' }), /points --radius-md at --radius-xl, which neither contract\/token-layer\.json nor design-foundations' scale shape names/)
})
test('an option pointing at a rung neither the layer nor the scale shape names fails', () => {
  expectFail((json) => json('contract/dials.json', (d) => { dial(d, 'shadows').options[2].sets['--salt-card-shadow'] = '--shadow-2xl' }), /points --salt-card-shadow at --shadow-2xl/)
})
test('a component token the layer drops fails the dial that sets it', () => {
  expectFail((json) => json('contract/token-layer.json', (d) => {
    for (const g of d.groups) g.tokens = g.tokens.filter((t) => t.name !== '--salt-button-radius')
  }), /button-style: sets --salt-button-radius, which contract\/token-layer\.json does not name/)
})
test('a rung whose value references a token the dial does not require fails', () => {
  expectFail((json) => json('contract/dials.json', (d) => { dial(d, 'shadows').requires = dial(d, 'shadows').requires.filter((t) => t !== '--color-shadow-md') }), /raised: points at --shadow-md, whose value references --color-shadow-md, which the dial does not list under requires/)
})
test('a dial requiring a token the layer does not name fails', () => {
  expectFail((json) => json('contract/dials.json', (d) => { dial(d, 'shadows').requires.push('--color-shadow-xl') }), /requires --color-shadow-xl, which contract\/token-layer\.json does not name/)
})
test('a required token whose layer entry does not name the dial fails', () => {
  expectFail((json) => json('contract/token-layer.json', (d) => {
    for (const g of d.groups) for (const t of g.tokens) if (t.name === '--color-shadow-sm') delete t.requiredBy
  }), /requires --color-shadow-sm, but contract\/token-layer\.json does not list shadows in its requiredBy/)
})
test('a layer entry required by a dial that does not require it fails', () => {
  expectFail((json) => json('contract/token-layer.json', (d) => {
    for (const g of d.groups) for (const t of g.tokens) if (t.name === '--color-shadow-sm') t.requiredBy.push('corners')
  }), /--color-shadow-sm is required by corners, but no dial corners lists it under requires/)
})
test('an option setting a token outside its dial fails', () => {
  expectFail((json) => json('contract/dials.json', (d) => { dial(d, 'corners').options[0].sets['--radius-full'] = '0' }), /sets --radius-full, which is not one of the dial's tokens/)
})
test('an option setting a token to itself fails', () => {
  expectFail((json) => json('contract/dials.json', (d) => { dial(d, 'corners').options[2].sets['--radius-sm'] = '--radius-sm' }), /sets --radius-sm to itself/)
})
test('a default the dial does not offer fails', () => {
  expectFail((json) => json('contract/dials.json', (d) => { dial(d, 'density').default = 'airy' }), /defaults to airy/)
})
test('an option offered twice fails', () => {
  expectFail((json) => json('contract/dials.json', (d) => { dial(d, 'density').options[2].value = 'compact' }), /offers compact twice/)
})
test('a dial id used twice fails', () => {
  expectFail((json) => json('contract/dials.json', (d) => { dial(d, 'density').id = 'corners' }), /the dial id is used twice/)
})

// ── 2 ──
test('a section with no view-props file fails', () => {
  expectFail((_, dir) => unlinkSync(path.join(dir, 'contract/view-props/faq.json')), /section faq has no contract\/view-props\/faq\.json/)
})
test('a view-props file naming another section fails', () => {
  expectFail((json) => json('contract/view-props/faq.json', (d) => { d.section = 'tabs' }), /section says tabs; the file is faq/)
})
test('a view-props file for no section fails', () => {
  expectFail((json, dir) => {
    cpSync(path.join(dir, 'contract/view-props/faq.json'), path.join(dir, 'contract/view-props/team.json'))
    json('contract/view-props/team.json', (d) => { d.section = 'team' })
  }, /team is not a section in contract\/sections\.json/)
})
test('a section called shared fails', () => {
  expectFail((json) => json('contract/sections.json', (d) => { d.sections.push({ ...d.sections[0], id: 'shared' }) }), /names a section shared/)
})
test('a prop naming a field the section lacks fails', () => {
  expectFail((json) => json('contract/view-props/hero.json', (d) => { props(d, 'subheading').field = 'strapline' }), /field strapline is not a field of this section/)
})
test('a prop naming a field inside a list row the row lacks fails', () => {
  expectFail((json) => json('contract/view-props/media-text.json', (d) => {
    d.types.row.props.find((p) => p.name === 'content').field = 'rows.body'
  }), /field rows\.body is not a field of this section/)
})
test('a prop naming a shared setting the section omits fails', () => {
  expectFail((json) => {
    json('contract/fields/faq.json', (d) => { d.shared.omit = ['divider'] })
    json('contract/view-props/faq.json', (d) => { d.data.push({ name: 'divider', kind: 'boolean', from: 'field', field: 'settings.divider' }) })
  }, /field settings\.divider is not a field of this section/)
})
test('a field prop not named for its field fails', () => {
  expectFail((json) => json('contract/view-props/hero.json', (d) => { props(d, 'subheading').name = 'strapline' }), /takes that field's name, subheading/)
})
test('an enum prop offering other values than its select fails', () => {
  expectFail((json) => json('contract/view-props/hero.json', (d) => { props(d, 'variant').values.pop() }), /offers full-bleed\|split\|stacked, but field variant offers/)
})
test('a prop from an optional field that is not nullable fails', () => {
  expectFail((json) => json('contract/view-props/hero.json', (d) => { delete d.data.find((p) => p.name === 'heading').nullable }), /data\.heading: field heading can clean or resolve to nothing, so the prop is nullable/)
})
test('a prop from a required field that is not nullable fails, since SC-009 can empty it', () => {
  expectFail((json) => json('contract/view-props/tabs.json', (d) => {
    const label = d.types.tab.props.find((p) => p.name === 'label')
    label.from = 'field'
    delete label.description
  }), /tab\.label: field tabs\.label can clean or resolve to nothing, so the prop is nullable/)
})
test('a non-null logic prop over an emptiable field that does not say how fails', () => {
  expectFail((json) => json('contract/view-props/logos.json', (d) => { delete d.types.logo.props.find((p) => p.name === 'image').description }), /logo\.image: never null though field items\.image can be empty/)
})
test('an object of an unknown type fails', () => {
  expectFail((json) => json('contract/view-props/hero.json', (d) => { props(d, 'image').of = 'picture' }), /of picture names no type/)
})
test('a list of an unknown kind fails', () => {
  expectFail((json) => json('contract/view-props/contact.json', (d) => {
    d.types['contact-details'].props.find((p) => p.name === 'address').of = 'line'
  }), /of line names no type in the file or in _shared\.json, nor a scalar kind/)
})

// ── 3 ──
test('an example that does not match the replaced-logic schema fails', () => {
  expectFail((json) => json('schema/replaced-logic.schema.json', (d) => { d.examples[0].sections[0].tier = 'markup' }), /examples\[0\] does not match the schema/)
})
test('an example naming no contract section fails', () => {
  expectFail((json) => json('schema/replaced-logic.schema.json', (d) => { d.examples[0].sections[0].section = 'banner' }), /banner is not a section/)
})
test('an example listing a contract section as client-only fails', () => {
  expectFail((json) => json('schema/replaced-logic.schema.json', (d) => { d.examples[0].clientSections[0].id = 'faq' }), /faq is a contract section, so it cannot be client-only/)
})
test('a replaced-logic schema with no example fails', () => {
  expectFail((json) => json('schema/replaced-logic.schema.json', (d) => { delete d.examples }), /carries no example/)
})
