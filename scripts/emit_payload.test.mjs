// Proves salt-contract/emit/payload.mjs: byte-stable output, a drift check that fails on a renamed
// field, conditions (filled included) that behave as the schema says, and a Payload mapping for
// every field type the schema allows.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Ajv2020 from 'ajv/dist/2020.js'

import { hasVisibleText, loadContract } from '../salt-contract/emit/_contract.mjs'
import { checkPayloadSnapshot, isFilled, payloadSnapshot, toPayloadBlocks } from '../salt-contract/emit/payload.mjs'

const emitter = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'salt-contract', 'emit', 'payload.mjs')
const icons = [{ value: 'star', label: 'Star' }, { value: 'check', label: 'Check' }]
const editor = (allowed) => ({ allowed })
const blocks = (options = {}) => toPayloadBlocks({ icons, richTextEditor: editor, ...options })
const block = (list, slug) => list.find((b) => b.slug === slug)
const field = (fields, dotted) => dotted.split('.').reduce((fs, name, i, all) => {
  const f = fs.find((x) => x.name === name)
  assert.ok(f, `no field ${dotted}`)
  return i === all.length - 1 ? f : f.fields
}, fields)
const shows = (f, siblings) => (f.admin?.condition ? f.admin.condition({}, siblings, {}) : true)

// A contract of one section, for field types and options the real contract does not use yet.
const probe = (fields) => ({
  version: '0.0.0',
  sections: [{ id: 'probe', label: 'Probe' }],
  settings: [],
  fields: { probe: { section: 'probe', fields } },
})

test('the same contract gives byte-identical output, in this process and a fresh one', () => {
  const a = payloadSnapshot({ icons })
  assert.equal(payloadSnapshot({ icons }), a)
  const dir = mkdtempSync(path.join(tmpdir(), 'emit-payload-'))
  try {
    writeFileSync(path.join(dir, 'options.json'), JSON.stringify({ icons }))
    for (const name of ['one.json', 'two.json']) {
      execFileSync(process.execPath, [emitter, '--write', path.join(dir, name), '--options', path.join(dir, 'options.json')])
    }
    const one = readFileSync(path.join(dir, 'one.json'), 'utf8')
    assert.equal(readFileSync(path.join(dir, 'two.json'), 'utf8'), one)
    assert.equal(one, a)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('the drift check passes an unchanged snapshot and fails a renamed field, naming both names', () => {
  const contract = loadContract()
  const snapshot = payloadSnapshot({ icons, contract })
  assert.deepEqual(checkPayloadSnapshot(snapshot, { icons, contract }), { ok: true, problems: [] })

  const renamed = structuredClone(contract)
  renamed.fields.hero.fields.find((f) => f.name === 'heading').name = 'title'
  const { ok, problems } = checkPayloadSnapshot(snapshot, { icons, contract: renamed })
  assert.equal(ok, false)
  assert.ok(problems.includes('blocks[hero].fields[heading] is in the snapshot and no longer generated'), problems.join('\n'))
  assert.ok(problems.includes('blocks[hero].fields[title] is generated and not in the snapshot'), problems.join('\n'))

  const changed = structuredClone(contract)
  changed.fields.hero.fields.find((f) => f.name === 'buttons').max = 3
  assert.deepEqual(checkPayloadSnapshot(snapshot, { icons, contract: changed }).problems, ['blocks[hero].fields[buttons].maxRows was 2, is now 3'])
})

test('the CLI exits 1 on drift and 0 when the snapshot matches', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'emit-payload-'))
  const snap = path.join(dir, 'blocks.json')
  const opts = path.join(dir, 'options.json')
  const run = (...args) => {
    try { return { code: 0, out: execFileSync(process.execPath, [emitter, ...args], { encoding: 'utf8' }) } } catch (e) { return { code: e.status, out: e.stdout } }
  }
  try {
    writeFileSync(opts, JSON.stringify({ icons }))
    run('--write', snap, '--options', opts)
    assert.equal(run('--check', snap, '--options', opts).code, 0)
    writeFileSync(snap, readFileSync(snap, 'utf8').replace('"name": "subheading"', '"name": "strapline"'))
    const r = run('--check', snap, '--options', opts)
    assert.equal(r.code, 1)
    assert.match(r.out, /blocks\[hero\]\.fields\[strapline\] is in the snapshot and no longer generated/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a filled condition shows the field only when the sibling has a value; filled: false the reverse', () => {
  const tabs = block(blocks(), 'tabs')
  const label = field(tabs.fields, 'label') // { field: 'heading', filled: false }
  assert.deepEqual(label.custom.salt.condition, [{ field: 'heading', filled: false }])
  assert.equal(shows(label, {}), true)
  assert.equal(shows(label, { heading: '' }), true)
  assert.equal(shows(label, { heading: '   ' }), true)
  assert.equal(shows(label, { heading: 'Our services' }), false)

  const bg = field(tabs.fields, 'settings.backgroundImage').fields
  const fit = field(bg, 'fit') // { field: 'image', filled: true }
  assert.equal(shows(fit, {}), false)
  assert.equal(shows(fit, { image: null }), false)
  assert.equal(shows(fit, { image: 12 }), true)
  assert.equal(shows(fit, { image: { id: 12, url: '/a.jpg' } }), true)
  // All clauses must hold, and an absent sibling reads as its default (scrim defaults to true).
  const strength = field(bg, 'scrimStrength')
  assert.equal(shows(strength, { image: 12 }), true)
  assert.equal(shows(strength, { image: 12, scrim: false }), false)
  assert.equal(shows(strength, { scrim: true }), false)

  assert.equal(isFilled(0), true)
  assert.equal(isFilled(false), false)
  assert.equal(isFilled([]), false)
  assert.equal(isFilled({ root: { children: [{ type: 'paragraph', children: [] }] } }), false)
  assert.equal(isFilled({ root: { children: [{ type: 'paragraph', children: [{ text: 'Hi' }] }] } }), true)
})

test('text is filled only when something visible is left after whitespace and zero-width characters (SC-009)', () => {
  const label = field(block(blocks(), 'tabs').fields, 'label') // { field: 'heading', filled: false }
  const cases = [
    ['spaces only', ' \t\n ', false],
    ['U+200B only', '\u200B', false],
    ['every zero-width character', '\u200B\u200C\u200D\u2060\uFEFF', false],
    ['zero-width and spaces mixed', ' \u200B \u2060\u00A0', false],
    ['visible text among them', '\u200B Our work \uFEFF', true],
    ['visible text', 'Our work', true],
  ]
  for (const [name, text, visible] of cases) {
    assert.equal(hasVisibleText(text), visible, name)
    assert.equal(isFilled(text), visible, name)
    assert.equal(shows(label, { heading: text }), !visible, name)
  }
  const doc = (...texts) => ({ root: { children: [{ type: 'paragraph', children: texts.map((text) => ({ text })) }] } })
  assert.equal(isFilled(doc('\u200B', '  ')), false)
  assert.equal(isFilled(doc('\u200B', 'Hi')), true)
})

test('equals and in conditions read siblings, with an absent sibling as its default', () => {
  const hero = block(blocks(), 'hero')
  const image = field(hero.fields, 'image')
  assert.equal(shows(image, { variant: 'split' }), true)
  assert.equal(shows(image, { variant: 'stacked' }), true)
  assert.equal(shows(image, { variant: 'minimal' }), false)
  assert.equal(shows(image, {}), false) // default full-bleed
  const side = field(hero.fields, 'mediaSide')
  assert.equal(shows(side, { variant: 'split' }), true)
  assert.equal(shows(side, { variant: 'stacked' }), false)
})

test('text, textarea, select, boolean, number and group map to their Payload types', () => {
  const list = toPayloadBlocks({ contract: probe([
    { name: 'title', type: 'text', label: 'Title', required: true, maxLength: 80, default: 'Hi', format: 'url' },
    { name: 'intro', type: 'textarea', label: 'Intro', maxLength: 300 },
    { name: 'style', type: 'select', label: 'Style', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], default: 'b' },
    { name: 'on', type: 'boolean', label: 'On', default: true },
    { name: 'count', type: 'number', label: 'Count', min: 1, max: 9, step: 1, default: 3 },
    { name: 'box', type: 'group', label: 'Box', fields: [{ name: 'inner', type: 'text', label: 'Inner' }] },
  ]) })
  const [b] = list
  assert.deepEqual(b.fields.map((f) => [f.name, f.type]), [['title', 'text'], ['intro', 'textarea'], ['style', 'select'], ['on', 'checkbox'], ['count', 'number'], ['box', 'group']])
  const [title, intro, style, on, count, box] = b.fields
  assert.deepEqual([title.required, title.maxLength, title.defaultValue, title.custom.salt.format], [true, 80, 'Hi', 'url'])
  assert.equal(intro.maxLength, 300)
  assert.deepEqual(style.options, [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }])
  assert.equal(style.defaultValue, 'b')
  assert.equal(style.enumName, 'enum_probe_style')
  assert.equal(on.defaultValue, true)
  assert.deepEqual([count.min, count.max, count.defaultValue, count.admin.step], [1, 9, 3, 1])
  assert.deepEqual(box.fields.map((f) => f.name), ['inner'])
  assert.deepEqual(b.labels, { singular: 'Probe', plural: 'Probe' })
  assert.equal(b.interfaceName, 'ProbeBlock')
})

test('restricted rich text carries its allowed list to the site\'s editor, narrowed by headings', () => {
  const rich = (options) => field(block(blocks(options), 'rich-text').fields, 'body')
  const all = rich()
  assert.equal(all.type, 'richText')
  assert.deepEqual(all.editor.allowed, all.custom.salt.allowed)
  assert.ok(all.custom.salt.allowed.includes('heading-4'))
  assert.deepEqual(rich({ headings: ['h3'] }).custom.salt.allowed.filter((k) => k.startsWith('heading')), ['heading-3'])
  assert.throws(() => rich({ headings: ['h2'] }), /heading-2 is not allowed by the contract/)
  // A field allowing no headings is not given any by a site's heading set.
  const text = field(block(blocks({ headings: ['h3'] }), 'features').fields, 'items.text')
  assert.ok(!text.custom.salt.allowed.some((k) => k.startsWith('heading')))
  assert.throws(() => toPayloadBlocks({ icons }), /pass richTextEditor/)
})

test('image maps to upload, one or many, against the site\'s upload collection', () => {
  const [b] = toPayloadBlocks({ mediaSlug: 'assets', contract: probe([
    { name: 'one', type: 'image', label: 'One', required: true },
    { name: 'many', type: 'image', label: 'Many', many: true, min: 1, max: 6 },
  ]) })
  assert.deepEqual(b.fields[0], { name: 'one', type: 'upload', label: 'One', relationTo: 'assets', required: true })
  assert.deepEqual(b.fields[1], { name: 'many', type: 'upload', label: 'Many', relationTo: 'assets', hasMany: true, minRows: 1, maxRows: 6 })
})

test('a link is the fixed group, its document pointing at linkTo, required parts marked', () => {
  const hero = block(blocks({ linkTo: ['pages', 'posts'] }), 'hero')
  const link = field(hero.fields, 'buttons.link')
  assert.equal(link.type, 'group')
  assert.deepEqual(link.fields.map((f) => [f.name, f.type, !!f.required]), [
    ['label', 'text', true], ['type', 'select', false], ['document', 'relationship', true], ['url', 'text', true], ['newTab', 'checkbox', false],
  ])
  const type = field(link.fields, 'type')
  assert.deepEqual([type.enumName, type.defaultValue], ['enum_link_type', 'internal'])
  const document = field(link.fields, 'document')
  assert.deepEqual(document.relationTo, ['pages', 'posts'])
  assert.equal(shows(document, { type: 'internal' }), true)
  assert.equal(shows(field(link.fields, 'url'), { type: 'internal' }), false)
  assert.equal(shows(field(link.fields, 'url'), { type: 'external' }), true)
  const [b] = toPayloadBlocks({ contract: probe([{ name: 'go', type: 'link', label: 'Go', withLabel: false }]) })
  assert.deepEqual(b.fields[0].fields.map((f) => f.name), ['type', 'document', 'url', 'newTab'])
  assert.ok(b.fields[0].fields.every((f) => !f.required))
})

test('a list maps to an array with its row label, item label and row limits', () => {
  const hero = block(blocks(), 'hero')
  const buttons = field(hero.fields, 'buttons')
  assert.deepEqual([buttons.type, buttons.maxRows, buttons.labels, buttons.custom.salt.rowLabel], ['array', 2, { singular: 'Button', plural: 'Buttons' }, 'link.label'])
  const features = field(block(blocks(), 'features').fields, 'items')
  assert.equal(features.custom.salt.rowLabel, 'title')
  // A select inside a row is named by its path, which stays inside Postgres's 63 characters.
  assert.equal(field(block(blocks(), 'media-text').fields, 'rows.buttons.style').enumName, 'enum_media_text_rows_buttons_style')
})

test('icons come from the site, and a section that needs them refuses to build without them', () => {
  const icon = field(block(blocks(), 'features').fields, 'items.icon')
  assert.deepEqual(icon.options, icons)
  assert.equal(icon.custom.salt.optionsFrom, 'icons')
  assert.throws(() => toPayloadBlocks({ richTextEditor: editor, sections: ['features'] }), /pass icons/)
  assert.doesNotThrow(() => toPayloadBlocks({ richTextEditor: editor, sections: ['hero'] }))
})

test('a relationship points at its source\'s collection, renamed by the site if it says so', () => {
  const fields = [{ name: 'people', type: 'relationship', label: 'People', to: 'team', many: true, max: 4 }]
  assert.deepEqual(toPayloadBlocks({ contract: probe(fields) })[0].fields[0],
    { name: 'people', type: 'relationship', label: 'People', relationTo: 'users', hasMany: true, maxRows: 4, custom: { salt: { to: 'team' } } })
  assert.equal(toPayloadBlocks({ contract: probe(fields), sources: { team: { collection: 'staff' } } })[0].fields[0].relationTo, 'staff')
})

test('a collection-query with a fixed source is the fixed group against that collection', () => {
  const query = field(block(blocks(), 'faq').fields, 'query')
  assert.deepEqual(query.fields.map((f) => f.name), ['mode', 'categories', 'items', 'order', 'count'])
  const [mode, categories, items, order, count] = query.fields
  assert.deepEqual(mode.options.map((o) => o.value), ['automatic', 'by-category', 'manual'])
  assert.deepEqual([mode.defaultValue, mode.enumName], ['automatic', 'enum_query_mode'])
  assert.deepEqual([categories.relationTo, categories.hasMany], ['faq-categories', true])
  assert.deepEqual([items.relationTo, items.hasMany], ['faqs', true])
  assert.equal(shows(categories, { mode: 'by-category' }), true)
  assert.equal(shows(items, { mode: 'by-category' }), false)
  assert.equal(shows(items, { mode: 'manual' }), true)
  assert.equal(shows(order, { mode: 'manual' }), false)
  assert.equal(shows(order, {}), true)
  assert.deepEqual([count.min, count.max, count.defaultValue], [0, 24, 0])
  // locations has no categories, so by-category is not offered and categories does not exist.
  const loc = field(block(blocks(), 'locations').fields, 'query')
  assert.deepEqual(loc.fields.map((f) => f.name), ['mode', 'items', 'order', 'count'])
  assert.equal(loc.fields[0].enumName, 'enum_query_mode_automatic_manual')
})

test('a collection-query read against a source select offers only the chosen source\'s items', () => {
  const showcase = block(blocks({ sources: { services: {}, testimonials: {}, posts: { collection: 'articles' } } }), 'collection-showcase')
  assert.deepEqual(field(showcase.fields, 'source').options.map((o) => o.value), ['services', 'testimonials', 'posts'])
  const query = field(showcase.fields, 'query')
  assert.deepEqual(query.custom.salt, { sourceField: 'source' })
  const items = field(query.fields, 'items')
  assert.deepEqual(items.relationTo, ['services', 'testimonials', 'articles'])
  assert.equal(items.filterOptions({ relationTo: 'articles', blockData: { source: 'posts' } }), true)
  assert.equal(items.filterOptions({ relationTo: 'services', blockData: { source: 'posts' } }), false)
  assert.equal(items.filterOptions({ relationTo: 'services', blockData: {} }), true)
  assert.deepEqual(field(query.fields, 'categories').relationTo, ['service-categories', 'topics'])
  // The carousel keeps its non-source choice.
  const carousel = block(blocks({ sources: { posts: {} } }), 'carousel')
  assert.deepEqual(field(carousel.fields, 'source').options.map((o) => o.value), ['inline', 'posts'])
})

test('shared settings take the section\'s defaults and omissions, in a group named settings', () => {
  const list = blocks()
  const cta = field(block(list, 'call-to-action').fields, 'settings')
  assert.equal(field(cta.fields, 'tone').defaultValue, 'brand-tint')
  assert.equal(field(block(list, 'hero').fields, 'settings.tone').defaultValue, 'surface')
  assert.equal(field(cta.fields, 'tone').enumName, 'enum_section_tone')
  assert.ok(!field(block(list, 'listing').fields, 'settings').fields.some((f) => f.name === 'firstPageOnly'))
  assert.ok(field(block(list, 'hero').fields, 'settings').fields.some((f) => f.name === 'firstPageOnly'))
})

test('every enum name fits Postgres\'s 63 characters', () => {
  const names = []
  const walk = (fields) => { for (const f of fields) { if (f.enumName) names.push(f.enumName); if (f.fields) walk(f.fields) } }
  for (const b of blocks()) walk(b.fields)
  assert.ok(names.length > 0)
  for (const n of names) assert.ok(n.length <= 63, n)
})

test('R8: a stored null is no value, and only a never-set sibling takes its default', () => {
  const bg = field(block(blocks(), 'hero').fields, 'settings.backgroundImage').fields
  const strength = field(bg, 'scrimStrength') // image filled, scrim equals true; scrim defaults to true
  assert.equal(shows(strength, { image: 12 }), true)
  assert.equal(shows(strength, { image: 12, scrim: null }), false)
  const image = field(block(blocks(), 'hero').fields, 'image') // variant in split, stacked; default full-bleed
  assert.equal(shows(image, { variant: null }), false)
  const showcase = block(blocks(), 'collection-showcase')
  const label = field(showcase.fields, 'viewAllLabel') // viewAll equals true; viewAll defaults to true
  assert.equal(shows(label, {}), true)
  assert.equal(shows(label, { viewAll: null }), false)
})

test('R4: a snapshot checked out with CRLF line endings still matches', () => {
  const snapshot = payloadSnapshot({ icons })
  assert.deepEqual(checkPayloadSnapshot(snapshot.replace(/\n/g, '\r\n'), { icons }), { ok: true, problems: [] })
})

test('R1: the CLI runs, and fails on drift, when invoked through a symlink as pnpm and npm link it', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'emit-payload-'))
  const link = path.join(dir, 'salt-emit-payload.mjs')
  const snap = path.join(dir, 'blocks.json')
  const opts = path.join(dir, 'options.json')
  try {
    symlinkSync(emitter, link)
    writeFileSync(opts, JSON.stringify({ icons }))
    writeFileSync(snap, payloadSnapshot({ icons }).replace('"name": "subheading"', '"name": "strapline"'))
    let code = 0
    let out = ''
    try { out = execFileSync(process.execPath, [link, '--check', snap, '--options', opts], { encoding: 'utf8' }) } catch (e) { code = e.status; out = e.stdout }
    assert.equal(code, 1)
    assert.match(out, /strapline/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('R5: a clause with no test, or with two, is refused by the schema and by the emitter', () => {
  const schemaFile = path.join(path.dirname(emitter), '..', 'schema', 'field-definition.schema.json')
  const validate = new Ajv2020({ strict: false }).compile(JSON.parse(readFileSync(schemaFile, 'utf8')))
  const doc = (condition) => ({
    $schema: '../../schema/field-definition.schema.json', version: '0.1.0', section: 'probe', shared: { id: 'section-settings' },
    fields: [{ name: 'on', type: 'boolean', label: 'On' }, { name: 'text', type: 'text', label: 'Text', condition }],
  })
  assert.equal(validate(doc({ field: 'on', equals: true })), true)
  for (const bad of [{ field: 'on' }, { field: 'on', equals: true, in: [true] }, { field: 'on', filled: true, equals: true }]) {
    assert.equal(validate(doc(bad)), false, JSON.stringify(bad))
    const fields = [{ name: 'on', type: 'boolean', label: 'On' }, { name: 'text', type: 'text', label: 'Text', condition: bad }]
    assert.throws(() => toPayloadBlocks({ contract: probe(fields) }), /probe\.text condition: .*exactly one of equals, an in list or a true or false filled/)
  }
})

test('R6: the query pickers keep their conditions in the snapshot, so a change to them is drift', () => {
  const query = JSON.parse(payloadSnapshot({ icons })).find((b) => b.slug === 'faq').fields.find((f) => f.name === 'query')
  assert.deepEqual(field(query.fields, 'categories').custom.salt.condition, [{ field: 'mode', equals: 'by-category' }])
  assert.deepEqual(field(query.fields, 'items').custom.salt.condition, [{ field: 'mode', equals: 'manual' }])
})

test('R2: a section whose fixed source the site lacks is left out, or refused when asked for', () => {
  const slugs = blocks({ sources: { posts: {} } }).map((b) => b.slug)
  assert.ok(!slugs.includes('faq') && !slugs.includes('locations'), slugs.join(', '))
  assert.ok(slugs.includes('hero'))
  assert.throws(() => blocks({ sources: { posts: {} }, sections: ['faq'] }),
    /section faq needs the source faqs \(faq\.query\), which options\.sources does not install/)
  const fields = [{ name: 'people', type: 'relationship', label: 'People', to: 'team' }]
  assert.deepEqual(toPayloadBlocks({ contract: probe(fields), sources: { posts: {} } }), [])
  assert.throws(() => toPayloadBlocks({ contract: probe(fields), sources: { posts: {} }, sections: ['probe'] }),
    /section probe needs the source team \(probe\.people\)/)
})

test('R3, S1: a source select none of whose options the site can satisfy leaves the section out', () => {
  const slugs = blocks({ sources: {} }).map((b) => b.slug)
  assert.ok(!slugs.includes('collection-showcase'), slugs.join(', '))
  assert.throws(() => blocks({ sources: {}, sections: ['collection-showcase'] }),
    /section collection-showcase needs one of the sources services, case-studies, testimonials, posts, team \(collection-showcase\.source\)/)
  assert.ok(blocks({ sources: { team: {} } }).some((b) => b.slug === 'collection-showcase'))
})

test('S1: with no sources the carousel keeps its inline cards and drops what only a source reaches', () => {
  const carousel = block(blocks({ sources: {} }), 'carousel')
  assert.ok(carousel)
  assert.deepEqual(field(carousel.fields, 'source').options.map((o) => o.value), ['inline'])
  const names = carousel.fields.map((f) => f.name)
  assert.ok(names.includes('cards') && names.includes('cardStyle'), names.join(', '))
  assert.ok(!names.includes('query') && !names.includes('showTags'), names.join(', '))
  assert.doesNotThrow(() => blocks({ sources: {}, sections: ['carousel'] }))
  // showTags stays while one of its sources is installed.
  assert.ok(block(blocks({ sources: { posts: {} } }), 'carousel').fields.some((f) => f.name === 'showTags'))
  assert.ok(!block(blocks({ sources: { team: {} } }), 'carousel').fields.some((f) => f.name === 'showTags'))
})

test('S4: the emitter refuses every clause shape the schema refuses, with its own message', () => {
  const bad = [{ equals: true }, { field: 'on', in: 'a' }, { field: 'on', filled: 'yes' }, 'on', null, { field: 7, equals: true }]
  for (const clause of bad) {
    const fields = [{ name: 'on', type: 'boolean', label: 'On' }, { name: 'text', type: 'text', label: 'Text', condition: clause }]
    assert.throws(() => toPayloadBlocks({ contract: probe(fields) }), /probe\.text condition: .*a clause is an object with a field name and exactly one of equals, an in list or a true or false filled/, JSON.stringify(clause))
  }
})

test('S5: sections: null is unset, so a section the sources cannot carry is left out, not refused', () => {
  const slugs = blocks({ sources: { posts: {} }, sections: null }).map((b) => b.slug)
  assert.ok(slugs.includes('hero') && !slugs.includes('faq'), slugs.join(', '))
})

test('S6: a source the shared settings need counts like one the section\'s own fields need', () => {
  const contract = probe([{ name: 'heading', type: 'text', label: 'Heading' }])
  contract.settings = [{ name: 'people', type: 'relationship', label: 'People', to: 'team' }]
  contract.fields.probe.shared = { id: 'section-settings' }
  assert.deepEqual(toPayloadBlocks({ contract, sources: { posts: {} } }), [])
  assert.throws(() => toPayloadBlocks({ contract, sources: { posts: {} }, sections: ['probe'] }), /section probe needs the source team \(probe\.settings\.people\)/)
  assert.equal(field(toPayloadBlocks({ contract, sources: { team: {} } })[0].fields, 'settings.people').relationTo, 'users')
})

test('S9: offeredSources is the one rule for what a source select can offer', async () => {
  const { offeredSources } = await import('../salt-contract/emit/_contract.mjs')
  const carousel = loadContract().fields.carousel.fields.find((f) => f.name === 'source')
  assert.deepEqual(offeredSources(carousel, new Set(['posts', 'team'])), {
    options: carousel.options.filter((o) => ['inline', 'posts', 'team'].includes(o.value)),
    sources: ['posts', 'team'],
  })
  assert.deepEqual(offeredSources(carousel, new Set()).sources, [])
  assert.deepEqual(offeredSources(carousel, new Set()).options.map((o) => o.value), ['inline'])
  // The emitted options are that rule's options.
  const emitted = field(block(blocks({ sources: { team: {} } }), 'carousel').fields, 'source')
  assert.deepEqual(emitted.options.map((o) => o.value), ['inline', 'team'])
})

test('S10: each section is resolved once per build', () => {
  const contract = loadContract()
  const reads = {}
  contract.fields = new Proxy(contract.fields, { get: (t, k) => { if (typeof k === 'string') reads[k] = (reads[k] ?? 0) + 1; return t[k] } })
  blocks({ contract })
  assert.ok(Object.keys(reads).length > 0)
  for (const [id, n] of Object.entries(reads)) assert.equal(n, 1, id)
})

test('U7, U8, U9: planSections is the one plan, its source selects already narrowed', async () => {
  const { planSections, unmetSources, sourceSelectsOf } = await import('../salt-contract/emit/_contract.mjs')
  assert.equal(typeof unmetSources, 'function')
  assert.equal(typeof sourceSelectsOf, 'function')
  const plan = planSections(loadContract(), { installed: new Set(['posts']) })
  const carousel = plan.sections.find((s) => s.id === 'carousel')
  assert.deepEqual(carousel.fields.find((f) => f.name === 'source').options.map((o) => o.value), ['inline', 'posts'])
  assert.deepEqual(plan.leftOut.map((s) => s.id), ['faq', 'locations'])
  assert.deepEqual(plan.leftOut[0].needs, ['the source faqs (faq.query)'])
  assert.deepEqual(plan.sections.map((s) => s.id), blocks({ sources: { posts: {} } }).map((b) => b.slug))
  assert.throws(() => planSections(loadContract(), { installed: new Set(), sections: ['faq'] }), /section faq needs the source faqs/)
})

test('U6: a condition is one clause or a list of at least two, as the schema says', () => {
  const on = { name: 'on', type: 'boolean', label: 'On' }
  for (const condition of [[], [{ field: 'on', equals: true }]]) {
    const fields = [on, { name: 'text', type: 'text', label: 'Text', condition }]
    assert.throws(() => toPayloadBlocks({ contract: probe(fields) }), /probe\.text condition: a condition is one clause or a list of at least two/, JSON.stringify(condition))
  }
  const two = [on, { name: 'n', type: 'boolean', label: 'N' }, { name: 'text', type: 'text', label: 'Text', condition: [{ field: 'on', equals: true }, { field: 'n', equals: true }] }]
  assert.doesNotThrow(() => toPayloadBlocks({ contract: probe(two) }))
})

// A section choosing between inline content and a source, as the carousel does.
const sourced = (extra = []) => [
  { name: 'source', type: 'select', label: 'Show', options: [{ value: 'inline', label: 'Inline' }, { value: 'posts', label: 'Posts' }], default: 'inline' },
  { name: 'query', type: 'collection-query', label: 'Query', sourceField: 'source', condition: { field: 'source', equals: 'posts' } },
  ...extra,
]

test('U3: a malformed clause is refused whatever the site installs', () => {
  const tags = { name: 'tags', type: 'boolean', label: 'Tags', condition: [{ field: 'source', in: ['posts'] }, { field: 'source' }] }
  for (const sources of [{}, { posts: {} }]) {
    assert.throws(() => toPayloadBlocks({ contract: probe(sourced([tags])), sources }), /probe\.tags condition: .*a clause is an object/, JSON.stringify(sources))
  }
})
