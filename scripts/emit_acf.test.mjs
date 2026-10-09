// Proves salt-contract/emit/acf.mjs: byte-stable output, a drift check that fails on a renamed
// field, conditions (filled included) as ACF conditional logic, an ACF mapping for every field
// type the schema allows, keys that follow the contract path, and a slug registry salt-wordpress's
// FLEET07 gate can be regenerated from.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { isFilled, loadContract, siblingValue } from '../salt-contract/emit/_contract.mjs'
import { toPayloadBlocks } from '../salt-contract/emit/payload.mjs'
import { acfSlugRegistry, acfSnapshot, checkAcfSnapshot, conditionalLogic, toAcfFieldGroups } from '../salt-contract/emit/acf.mjs'

const emitter = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'salt-contract', 'emit', 'acf.mjs')
const icons = [{ value: 'star', label: 'Star' }, { value: 'check', label: 'Check' }]
const layoutsOf = (options = {}) => toAcfFieldGroups({ icons, ...options })[0].fields[0].layouts
const layout = (list, name) => list.find((l) => l.name === name)
const field = (fields, dotted) => dotted.split('.').reduce((fs, name, i, all) => {
  const f = fs.find((x) => x.name === name)
  assert.ok(f, `no field ${dotted}`)
  return i === all.length - 1 ? f : f.sub_fields
}, fields)
const HERO = 'groups[group_salt_sections].fields[sections].layouts[hero].sub_fields'

// ACF's own reading of conditional logic: any group whose rules all hold. A true_false holds 1 or
// 0, and an empty value is '', null, 0 or an empty list.
const empty = (v) => v === undefined || v === null || v === '' || v === 0 || (Array.isArray(v) && v.length === 0)
const rule = (r, v) => ({
  '==': () => !empty(v) && String(v) === r.value,
  '!=': () => empty(v) ? r.value !== '' : String(v) !== r.value,
  '==empty': () => empty(v),
  '!=empty': () => !empty(v),
})[r.operator]()
// A sibling never set reads as its default, as ACF fills a new row; a stored null stays no value.
const shows = (f, siblings, all) => {
  if (!f.conditional_logic) return true
  const byKey = Object.fromEntries(all.map((s) => [s.key, s.name]))
  const defaults = Object.fromEntries(all.filter((s) => s.default_value !== undefined).map((s) => [s.name, s.default_value]))
  return f.conditional_logic.some((g) => g.every((r) => rule(r, siblingValue(siblings, byKey[r.field], defaults))))
}

// A contract of one section, for field types and options the real contract does not use yet.
const probe = (fields) => ({
  version: '0.0.0',
  sections: [{ id: 'probe', label: 'Probe' }],
  settings: [],
  fields: { probe: { section: 'probe', fields } },
})
const probed = (fields, options = {}) => toAcfFieldGroups({ contract: probe(fields), ...options })[0].fields[0].layouts[0].sub_fields

test('the same contract gives byte-identical output, in this process and a fresh one', () => {
  const a = acfSnapshot({ icons })
  assert.equal(acfSnapshot({ icons }), a)
  const dir = mkdtempSync(path.join(tmpdir(), 'emit-acf-'))
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
  const snapshot = acfSnapshot({ icons, contract })
  assert.deepEqual(checkAcfSnapshot(snapshot, { icons, contract }), { ok: true, problems: [] })

  const renamed = structuredClone(contract)
  renamed.fields.hero.fields.find((f) => f.name === 'heading').name = 'title'
  const { ok, problems } = checkAcfSnapshot(snapshot, { icons, contract: renamed })
  assert.equal(ok, false)
  assert.ok(problems.includes(`${HERO}[heading] is in the snapshot and no longer generated`), problems.join('\n'))
  assert.ok(problems.includes(`${HERO}[title] is generated and not in the snapshot`), problems.join('\n'))

  const changed = structuredClone(contract)
  changed.fields.hero.fields.find((f) => f.name === 'buttons').max = 3
  assert.deepEqual(checkAcfSnapshot(snapshot, { icons, contract: changed }).problems, [`${HERO}[buttons].max was 2, is now 3`])
  assert.match(checkAcfSnapshot(snapshot.replace(/\n {2}/g, '\n    '), { icons, contract }).problems[0], /only in formatting/)
})

test('the CLI exits 1 on drift and 0 when the snapshot matches', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'emit-acf-'))
  const snap = path.join(dir, 'groups.json')
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
    assert.ok(r.out.includes(`${HERO}[strapline] is in the snapshot and no longer generated`), r.out)
    assert.equal(run().code, 2)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('filled: true is ACF "has any value" and filled: false "has no value"', () => {
  const tabs = layout(layoutsOf(), 'tabs')
  const label = field(tabs.sub_fields, 'label') // { field: 'heading', filled: false }
  assert.deepEqual(label.conditional_logic, [[{ field: 'field_salt_tabs_heading', operator: '==empty' }]])
  assert.equal(shows(label, {}, tabs.sub_fields), true)
  assert.equal(shows(label, { heading: 'Our services' }, tabs.sub_fields), false)

  const bg = field(tabs.sub_fields, 'settings.backgroundImage').sub_fields
  const fit = field(bg, 'fit') // { field: 'image', filled: true }
  assert.deepEqual(fit.conditional_logic, [[{ field: 'field_salt_tabs_settings_background_image_image', operator: '!=empty' }]])
  assert.equal(shows(fit, { image: '' }, bg), false)
  assert.equal(shows(fit, { image: 12 }, bg), true)
  // ACF's reading agrees with the contract's isFilled wherever it can; text of only spaces or
  // zero-width characters is the one place it cannot (SC-009, the schema's WordPress note).
  for (const v of ['', null, 12, 'Our services']) assert.equal(shows(label, { heading: v }, tabs.sub_fields), !isFilled(v), String(v))
  for (const v of ['   ', '\u200B']) assert.equal(shows(label, { heading: v }, tabs.sub_fields), isFilled(v), JSON.stringify(v))
  // Every clause must hold: one group of two rules, the boolean compared as ACF stores it.
  const strength = field(bg, 'scrimStrength')
  assert.deepEqual(strength.conditional_logic, [[
    { field: 'field_salt_tabs_settings_background_image_image', operator: '!=empty' },
    { field: 'field_salt_tabs_settings_background_image_scrim', operator: '==', value: '1' },
  ]])
  assert.equal(shows(strength, { image: 12, scrim: 1 }, bg), true)
  assert.equal(shows(strength, { image: 12, scrim: 0 }, bg), false)
  assert.equal(shows(strength, { scrim: 1 }, bg), false)
})

test('equals and in become ACF rules, each value of an in its own OR group', () => {
  const hero = layout(layoutsOf(), 'hero')
  const image = field(hero.sub_fields, 'image')
  assert.deepEqual(image.conditional_logic, [
    [{ field: 'field_salt_hero_variant', operator: '==', value: 'split' }],
    [{ field: 'field_salt_hero_variant', operator: '==', value: 'stacked' }],
  ])
  for (const [variant, shown] of [['split', true], ['stacked', true], ['minimal', false], ['full-bleed', false]]) {
    assert.equal(shows(image, { variant }, hero.sub_fields), shown, variant)
  }
  // An in beside another clause multiplies out; equals false is "not checked".
  const keyOf = (n) => `k_${n}`
  assert.deepEqual(conditionalLogic([{ field: 'a', in: ['x', 'y'] }, { field: 'b', equals: false }], keyOf), [
    [{ field: 'k_a', operator: '==', value: 'x' }, { field: 'k_b', operator: '!=', value: '1' }],
    [{ field: 'k_a', operator: '==', value: 'y' }, { field: 'k_b', operator: '!=', value: '1' }],
  ])
  assert.throws(() => probed([{ name: 'a', type: 'text', label: 'A', condition: { field: 'nope', filled: true } }]), /names no sibling/)
})

test('text, textarea, select, boolean, number and group map to their ACF types', () => {
  const [title, address, intro, style, pick, on, count, box] = probed([
    { name: 'title', type: 'text', label: 'Title', required: true, maxLength: 80, default: 'Hi', description: 'Help.' },
    { name: 'address', type: 'text', label: 'Address', format: 'url' },
    { name: 'intro', type: 'textarea', label: 'Intro', maxLength: 300 },
    { name: 'style', type: 'select', label: 'Style', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], default: 'b' },
    { name: 'pick', type: 'select', label: 'Pick', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
    { name: 'on', type: 'boolean', label: 'On', default: true },
    { name: 'count', type: 'number', label: 'Count', min: 1, max: 9, step: 1, default: 3 },
    { name: 'box', type: 'group', label: 'Box', fields: [{ name: 'inner', type: 'text', label: 'Inner' }] },
  ])
  assert.deepEqual(title, { key: 'field_salt_probe_title', label: 'Title', name: 'title', type: 'text', instructions: 'Help.', required: 1, default_value: 'Hi', maxlength: 80 })
  assert.deepEqual([address.type, address.salt], ['text', { format: 'url' }])
  assert.deepEqual([intro.type, intro.maxlength], ['textarea', 300])
  assert.deepEqual([style.type, style.choices, style.default_value, style.allow_null], ['select', { a: 'A', b: 'B' }, 'b', undefined])
  assert.equal(pick.allow_null, 1)
  assert.deepEqual([on.type, on.ui, on.default_value], ['true_false', 1, 1])
  assert.deepEqual([count.type, count.min, count.max, count.step, count.default_value], ['number', 1, 9, 1, 3])
  assert.deepEqual([box.type, box.sub_fields.map((f) => f.key)], ['group', ['field_salt_probe_box_inner']])
  assert.equal(layout(layoutsOf(), 'gallery').sub_fields.find((f) => f.name === 'settings').sub_fields.find((f) => f.name === 'anchorId').salt.format, 'anchor')
  assert.throws(() => probed([{ name: 'n', type: 'select', label: 'N', options: [{ value: 'auto', label: 'Auto' }, { value: '2', label: '2' }] }]), /cannot keep their order/)
})

test('rich text is a wysiwyg carrying its allowed list, narrowed by headings', () => {
  const rich = (options) => field(layout(layoutsOf(options), 'rich-text').sub_fields, 'body')
  const all = rich()
  assert.deepEqual([all.type, all.media_upload], ['wysiwyg', 0])
  assert.ok(all.salt.allowed.includes('heading-4'))
  assert.deepEqual(rich({ headings: ['h3'] }).salt.allowed.filter((k) => k.startsWith('heading')), ['heading-3'])
  assert.throws(() => rich({ headings: ['h2'] }), /heading-2 is not allowed by the contract/)
})

test('image maps to image, or gallery when many, storing ids', () => {
  const [one, many] = probed([
    { name: 'one', type: 'image', label: 'One', required: true },
    { name: 'many', type: 'image', label: 'Many', many: true, min: 1, max: 6 },
  ])
  assert.deepEqual(one, { key: 'field_salt_probe_one', label: 'One', name: 'one', type: 'image', required: 1, return_format: 'id' })
  assert.deepEqual(many, { key: 'field_salt_probe_many', label: 'Many', name: 'many', type: 'gallery', return_format: 'id', min: 1, max: 6 })
})

test('a link is the fixed group, its document a post object of linkTo, required parts marked', () => {
  const hero = layout(layoutsOf({ linkTo: ['page', 'post'] }), 'hero')
  const link = field(hero.sub_fields, 'buttons.link')
  assert.deepEqual([link.type, link.required, link.salt], ['group', undefined, { link: true }])
  assert.deepEqual(link.sub_fields.map((f) => [f.name, f.type, f.required ?? 0]), [
    ['label', 'text', 1], ['type', 'select', 0], ['document', 'post_object', 1], ['url', 'text', 1], ['newTab', 'true_false', 0],
  ])
  const document = field(link.sub_fields, 'document')
  assert.deepEqual(document.post_type, ['page', 'post'])
  assert.equal(shows(document, { type: 'internal' }, link.sub_fields), true)
  assert.equal(shows(field(link.sub_fields, 'url'), { type: 'internal' }, link.sub_fields), false)
  const [go] = probed([{ name: 'go', type: 'link', label: 'Go', withLabel: false }])
  assert.deepEqual(go.sub_fields.map((f) => f.name), ['type', 'document', 'url', 'newTab'])
  assert.equal(go.salt.withLabel, false)
  assert.ok(go.sub_fields.every((f) => !f.required))
})

test('a list is a repeater that collapses to its row label, with its limits', () => {
  const buttons = field(layout(layoutsOf(), 'hero').sub_fields, 'buttons')
  assert.deepEqual([buttons.type, buttons.max, buttons.button_label, buttons.collapsed, buttons.salt.rowLabel],
    ['repeater', 2, 'Add button', 'field_salt_hero_buttons_link_label', 'link.label'])
  const items = field(layout(layoutsOf(), 'features').sub_fields, 'items')
  assert.equal(items.collapsed, 'field_salt_features_items_title')
  assert.ok(items.sub_fields.some((f) => f.key === items.collapsed))
})

test('a relationship is a post object, or a relationship when many, of its source\'s post type', () => {
  const [one, people] = probed([
    { name: 'lead', type: 'relationship', label: 'Lead', to: 'services', required: true },
    { name: 'people', type: 'relationship', label: 'People', to: 'team', many: true, max: 4 },
  ], { sources: { services: {}, team: { postType: 'staff' } } })
  assert.deepEqual([one.type, one.post_type, one.salt], ['post_object', ['service'], { to: 'services' }])
  assert.deepEqual([people.type, people.post_type, people.max, people.filters], ['relationship', ['staff'], 4, ['search']])
})

test('icons come from the site, and a section that needs them refuses to build without them', () => {
  const icon = field(layout(layoutsOf(), 'features').sub_fields, 'items.icon')
  assert.deepEqual([icon.choices, icon.salt.optionsFrom], [{ star: 'Star', check: 'Check' }, 'icons'])
  assert.throws(() => toAcfFieldGroups({ sections: ['features'] }), /pass icons/)
  assert.doesNotThrow(() => toAcfFieldGroups({ sections: ['hero'] }))
})

test('a collection-query with a fixed source is the fixed group against its post type and taxonomy', () => {
  const query = field(layout(layoutsOf(), 'faq').sub_fields, 'query')
  assert.deepEqual(query.sub_fields.map((f) => [f.name, f.type]), [['mode', 'select'], ['categories', 'taxonomy'], ['items', 'relationship'], ['order', 'select'], ['count', 'number']])
  const [mode, categories, items, order, count] = query.sub_fields
  assert.deepEqual([mode.default_value, Object.keys(mode.choices)], ['automatic', ['automatic', 'by-category', 'manual']])
  assert.deepEqual([categories.taxonomy, categories.field_type], ['faq_category', 'multi_select'])
  assert.deepEqual(items.post_type, ['faq'])
  assert.equal(shows(items, { mode: 'manual' }, query.sub_fields), true)
  assert.equal(shows(order, { mode: 'manual' }, query.sub_fields), false)
  assert.equal(shows(order, { mode: 'by-category' }, query.sub_fields), true)
  assert.deepEqual([count.min, count.max, count.default_value], [0, 24, 0])
  // A source with no categories offers no by-category mode and no categories field.
  const loc = field(layout(layoutsOf({ sources: { locations: { taxonomy: null } } }), 'locations').sub_fields, 'query')
  assert.deepEqual(loc.sub_fields.map((f) => f.name), ['mode', 'items', 'order', 'count'])
})

test('a collection-query read against a source select offers every chosen source\'s post types', () => {
  const showcase = layout(layoutsOf({ sources: { services: {}, testimonials: {}, posts: { postType: 'article' } } }), 'collection-showcase')
  assert.deepEqual(Object.keys(field(showcase.sub_fields, 'source').choices), ['services', 'testimonials', 'posts'])
  const query = field(showcase.sub_fields, 'query')
  assert.deepEqual(query.salt, { sourceField: 'source' })
  assert.deepEqual(field(query.sub_fields, 'items').post_type, ['service', 'testimonial', 'article'])
  const categories = field(query.sub_fields, 'categories')
  assert.deepEqual([categories.type, categories.multiple, categories.salt.taxonomies], ['select', 1, ['service_category', 'category']])
})

test('shared settings take the section\'s defaults and omissions, in a group named settings', () => {
  const list = layoutsOf()
  const cta = field(layout(list, 'call-to-action').sub_fields, 'settings')
  assert.equal(field(cta.sub_fields, 'tone').default_value, 'brand-tint')
  assert.equal(field(layout(list, 'hero').sub_fields, 'settings.tone').default_value, 'surface')
  assert.equal(field(cta.sub_fields, 'divider').default_value, 0)
  assert.ok(!field(layout(list, 'listing').sub_fields, 'settings').sub_fields.some((f) => f.name === 'firstPageOnly'))
})

test('keys follow DATA02 from the contract path, are unique, and do not move when fields reorder', () => {
  const list = layoutsOf()
  assert.equal(layout(list, 'rich-text').key, 'layout_salt_rich_text')
  assert.equal(field(layout(list, 'media-text').sub_fields, 'rows.mediaSide').key, 'field_salt_media_text_rows_media_side')
  assert.equal(field(layout(list, 'hero').sub_fields, 'settings.backgroundImage.scrimStrength').key, 'field_salt_hero_settings_background_image_scrim_strength')
  const keys = []
  const walk = (fs) => { for (const f of fs) { keys.push(f.key); if (f.sub_fields) walk(f.sub_fields) } }
  for (const l of list) walk(l.sub_fields)
  assert.equal(new Set(keys).size, keys.length)
  for (const k of keys) assert.match(k, /^field_salt_[a-z0-9_]+$/)

  const contract = loadContract()
  const reordered = structuredClone(contract)
  reordered.fields.hero.fields.reverse()
  const keyMap = (c) => Object.fromEntries(layout(layoutsOf({ contract: c }), 'hero').sub_fields.map((f) => [f.name, f.key]))
  assert.deepEqual(keyMap(reordered), keyMap(contract))
  // Two paths that snake_case alike would share a key, which ACF cannot tell apart: refused.
  assert.throws(() => probed([
    { name: 'aB', type: 'group', label: 'A', fields: [{ name: 'c', type: 'text', label: 'C' }] },
    { name: 'a', type: 'group', label: 'A', fields: [{ name: 'bC', type: 'text', label: 'C' }] },
  ]), /already taken/)
})

test('the slug registry salt-wordpress regenerates holds every layout and name, so a removal shows', () => {
  const contract = loadContract()
  const registry = acfSlugRegistry(toAcfFieldGroups({ icons, contract }))
  assert.deepEqual(registry.layouts, contract.sections.map((s) => s.id).sort())
  const names = registry.fields.group_salt_sections
  for (const n of ['sections', 'heading', 'mediaSide', 'settings', 'scrimStrength', 'newTab', 'categories']) assert.ok(names.includes(n), n)
  assert.deepEqual(names, [...names].sort())

  const removed = structuredClone(contract)
  removed.fields.contact.fields = removed.fields.contact.fields.filter((f) => f.name !== 'formIntro')
  assert.ok(!acfSlugRegistry(toAcfFieldGroups({ icons, contract: removed })).fields.group_salt_sections.includes('formIntro'))
})

test('R1: the CLI runs, and fails on drift, when invoked through a symlink as pnpm and npm link it', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'emit-acf-'))
  const link = path.join(dir, 'salt-emit-acf.mjs')
  const snap = path.join(dir, 'groups.json')
  const opts = path.join(dir, 'options.json')
  try {
    symlinkSync(emitter, link)
    writeFileSync(opts, JSON.stringify({ icons }))
    writeFileSync(snap, acfSnapshot({ icons }).replace('"name": "subheading"', '"name": "strapline"'))
    let code = 0
    let out = ''
    try { out = execFileSync(process.execPath, [link, '--check', snap, '--options', opts], { encoding: 'utf8' }) } catch (e) { code = e.status; out = e.stdout }
    assert.equal(code, 1)
    assert.match(out, /strapline/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('R4: a snapshot checked out with CRLF line endings still matches', () => {
  const snapshot = acfSnapshot({ icons })
  assert.deepEqual(checkAcfSnapshot(snapshot.replace(/\n/g, '\r\n'), { icons }), { ok: true, problems: [] })
})

test('R5: a clause with no test, or with two, is refused by the emitter', () => {
  for (const bad of [{ field: 'on' }, { field: 'on', equals: true, in: [true] }, { field: 'on', filled: true, equals: true }]) {
    const fields = [{ name: 'on', type: 'boolean', label: 'On' }, { name: 'text', type: 'text', label: 'Text', condition: bad }]
    assert.throws(() => probed(fields), /probe\.text condition: .*a clause is an object with a field name and exactly one of/, JSON.stringify(bad))
  }
})

test('R8: a stored null is no value, and only a never-set sibling takes its default', () => {
  const bg = field(layout(layoutsOf(), 'hero').sub_fields, 'settings.backgroundImage').sub_fields
  const strength = field(bg, 'scrimStrength') // image filled, scrim equals true; scrim defaults to 1
  assert.equal(shows(strength, { image: 12 }, bg), true)
  assert.equal(shows(strength, { image: 12, scrim: null }, bg), false)
  const hero = layout(layoutsOf(), 'hero').sub_fields
  assert.equal(shows(field(hero, 'image'), { variant: null }, hero), false)
  assert.equal(shows(field(hero, 'image'), {}, hero), false) // default full-bleed
  const showcase = layout(layoutsOf(), 'collection-showcase').sub_fields
  const label = field(showcase, 'viewAllLabel') // viewAll equals true; viewAll defaults to 1
  assert.equal(shows(label, {}, showcase), true)
  assert.equal(shows(label, { viewAll: null }, showcase), false)
})

test('R2: a section whose fixed source the site lacks is left out, or refused when asked for', () => {
  const names = layoutsOf({ sources: { posts: {} } }).map((l) => l.name)
  assert.ok(!names.includes('faq') && !names.includes('locations'), names.join(', '))
  assert.ok(names.includes('hero'))
  assert.throws(() => layoutsOf({ sources: { posts: {} }, sections: ['faq'] }),
    /section faq needs the source faqs \(faq\.query\), which options\.sources does not install/)
  const fields = [{ name: 'people', type: 'relationship', label: 'People', to: 'team' }]
  assert.deepEqual(toAcfFieldGroups({ contract: probe(fields), sources: { posts: {} } })[0].fields[0].layouts, [])
  assert.throws(() => toAcfFieldGroups({ contract: probe(fields), sources: { posts: {} }, sections: ['probe'] }),
    /section probe needs the source team \(probe\.people\)/)
})

test('R3: a source-select section with none of its sources is left out, unless it offers inline items', () => {
  const list = layoutsOf({ sources: {} })
  assert.ok(!list.some((l) => l.name === 'collection-showcase'), list.map((l) => l.name).join(', '))
  assert.throws(() => layoutsOf({ sources: {}, sections: ['collection-showcase'] }),
    /section collection-showcase needs one of the sources services, case-studies, testimonials, posts, team \(collection-showcase\.source\)/)
  assert.ok(layoutsOf({ sources: { team: {} } }).some((l) => l.name === 'collection-showcase'))
  // The carousel's cards are written in place, so it stays, offering only that, with no query.
  const carousel = layout(list, 'carousel')
  assert.ok(carousel, 'carousel is kept')
  assert.deepEqual(Object.keys(field(carousel.sub_fields, 'source').choices), ['inline'])
  assert.ok(!carousel.sub_fields.some((f) => f.name === 'query'))
  assert.ok(carousel.sub_fields.some((f) => f.name === 'cards'))
  assert.doesNotThrow(() => layoutsOf({ sources: {}, sections: ['carousel'] }))
})

test('R6: no field loses its provenance or its condition on the way into the snapshot', () => {
  const contract = loadContract()
  const snap = JSON.parse(acfSnapshot({ icons, contract }))[0].fields[0].layouts
  const checked = []
  const walk = (defs, fields, at) => {
    for (const def of defs) {
      const f = fields.find((x) => x.name === def.name)
      assert.ok(f, `${at}.${def.name} is emitted`)
      const where = `${at}.${def.name}`
      if (def.condition) assert.ok(f.conditional_logic?.length, `${where} keeps its condition`)
      if (def.deprecated) assert.deepEqual(f.salt?.deprecated, def.deprecated, where)
      if (def.format) assert.equal(f.salt?.format, def.format, where)
      if (def.type === 'rich-text') assert.ok(f.salt?.allowed?.length, where)
      if (def.optionsFrom) assert.equal(f.salt?.optionsFrom, def.optionsFrom, where)
      if (def.rowLabel) assert.ok(f.salt?.rowLabel?.startsWith(def.rowLabel), where)
      if (def.type === 'link') assert.equal(f.salt?.link, true, where)
      if (def.type === 'relationship') assert.equal(f.salt?.to, def.to, where)
      if (def.type === 'collection-query') {
        assert.ok(f.salt?.source ?? f.salt?.sourceField, where)
        // The pickers and the controls that follow mode keep their conditions.
        for (const part of f.sub_fields.filter((p) => p.name !== 'mode')) assert.ok(part.conditional_logic?.length, `${where}.${part.name}`)
      }
      if (def.type === 'link') for (const part of ['document', 'url']) assert.ok(field(f.sub_fields, part).conditional_logic?.length, `${where}.${part}`)
      checked.push(where)
      if (def.fields && (def.type === 'list' || def.type === 'group')) walk(def.fields, f.sub_fields, where)
    }
  }
  for (const l of snap) {
    const { fields, settings } = { fields: contract.fields[l.name].fields, settings: l.sub_fields.find((f) => f.name === 'settings') }
    walk(fields, l.sub_fields, l.name)
    if (settings) walk(contract.settings.filter((d) => settings.sub_fields.some((f) => f.name === d.name)), settings.sub_fields, `${l.name}.settings`)
  }
  assert.ok(checked.length > 100, String(checked.length))
  // A deprecation on a field the contract builds in code is kept too.
  const [old] = probed([{ name: 'old', type: 'text', label: 'Old', deprecated: { since: '0.2.0', replacedBy: null } }])
  assert.deepEqual(old.salt, { deprecated: { since: '0.2.0', replacedBy: null } })
})

test('Payload and ACF leave out and keep the same sections, and offer the same sources, for the same sources', () => {
  const sets = [undefined, {}, { posts: {} }, { team: {} }, { faqs: {} }, { locations: {} }, { testimonials: {} }, { services: {}, testimonials: {} }]
  for (const sources of sets) {
    const payload = toPayloadBlocks({ icons, richTextEditor: (allowed) => ({ allowed }), sources })
    const acf = layoutsOf({ sources })
    const at = JSON.stringify(sources)
    assert.deepEqual(acf.map((l) => l.name), payload.map((b) => b.slug), at)
    for (const b of payload) {
      const l = layout(acf, b.slug)
      // The same top-level fields survive withinSources, and a source select offers the same values.
      assert.deepEqual(l.sub_fields.map((f) => f.name), b.fields.map((f) => f.name), `${at} ${b.slug}`)
      const select = b.fields.find((f) => f.name === 'source')
      if (select) assert.deepEqual(Object.keys(field(l.sub_fields, 'source').choices), select.options.map((o) => o.value), `${at} ${b.slug}.source`)
    }
    for (const id of ['faq', 'collection-showcase', 'carousel', 'locations']) {
      let payloadError = null
      let acfError = null
      try { toPayloadBlocks({ icons, richTextEditor: (allowed) => ({ allowed }), sources, sections: [id] }) } catch (e) { payloadError = e.message }
      try { layoutsOf({ sources, sections: [id] }) } catch (e) { acfError = e.message }
      assert.equal(acfError, payloadError, `${at} sections: [${id}]`)
    }
  }
  // A query reading its source from a select below the top level is a contract shape both refuse,
  // the same way, whatever the site installs.
  const pair = [
    { name: 'source', type: 'select', label: 'Show', options: [{ value: 'posts', label: 'Posts' }, { value: 'team', label: 'Team' }] },
    { name: 'query', type: 'collection-query', label: 'Query', sourceField: 'source' },
  ]
  const nested = probe([{ name: 'rows', type: 'list', label: 'Rows', fields: pair }])
  for (const sources of [undefined, { posts: {}, team: {} }, { team: {} }]) {
    let payloadError = null
    let acfError = null
    try { toPayloadBlocks({ contract: nested, sources }) } catch (e) { payloadError = e.message }
    try { toAcfFieldGroups({ contract: nested, sources }) } catch (e) { acfError = e.message }
    assert.equal(acfError, payloadError, JSON.stringify(sources))
    assert.match(acfError, /probe\.rows\.query: a collection-query reading its source from a select must sit, with that select, at the section's top level/)
  }
  // The carousel keeps its inline cards with no sources, on both.
  assert.ok(toPayloadBlocks({ icons, richTextEditor: (allowed) => ({ allowed }), sources: {} }).some((b) => b.slug === 'carousel'))
})

test('Y2: rich text keeps the visual editor\'s full toolbar, as salt-wordpress has it, with media off', () => {
  const body = field(layout(layoutsOf(), 'rich-text').sub_fields, 'body')
  assert.deepEqual([body.tabs, body.toolbar, body.media_upload], ['visual', 'full', 0])
  assert.ok(body.salt.allowed.length)
})

test('Y3: a url-format text is an ACF text, since ACF\'s url field refuses mailto: and tel:', () => {
  const url = field(field(layout(layoutsOf(), 'hero').sub_fields, 'buttons.link').sub_fields, 'url')
  assert.deepEqual([url.type, url.salt], ['text', { format: 'url' }])
})

test('Y4: a single relationship that is not required can be cleared', () => {
  const [lead, must] = probed([
    { name: 'lead', type: 'relationship', label: 'Lead', to: 'services' },
    { name: 'must', type: 'relationship', label: 'Must', to: 'services', required: true },
  ])
  assert.deepEqual([lead.type, lead.allow_null], ['post_object', 1])
  assert.equal(must.allow_null, undefined)
  const [go] = probed([{ name: 'go', type: 'link', label: 'Go' }])
  assert.equal(field(go.sub_fields, 'document').allow_null, 1)
  const button = field(field(layout(layoutsOf(), 'hero').sub_fields, 'buttons.link').sub_fields, 'document')
  assert.equal(button.allow_null, undefined) // the button's link is required
})

test('Y5: sources sharing a post type or taxonomy are offered once, so one taxonomy is the native field', () => {
  const sources = { services: {}, posts: { taxonomy: 'service_category', postType: 'service' } }
  const query = field(layout(layoutsOf({ sources }), 'collection-showcase').sub_fields, 'query')
  const categories = field(query.sub_fields, 'categories')
  assert.deepEqual([categories.type, categories.taxonomy], ['taxonomy', 'service_category'])
  assert.deepEqual(field(query.sub_fields, 'items').post_type, ['service'])
})

test('Y10: a repeater\'s button keeps an acronym as given', () => {
  const [faqs, cards] = probed([
    { name: 'faqs', type: 'list', label: 'FAQs', itemLabel: 'FAQ', fields: [{ name: 'q', type: 'text', label: 'Q' }] },
    { name: 'cards', type: 'list', label: 'Cards', itemLabel: 'Card', fields: [{ name: 'title', type: 'text', label: 'Title' }] },
  ])
  assert.equal(faqs.button_label, 'Add FAQ')
  assert.equal(cards.button_label, 'Add card')
})

test('Y6, Y7: the docs claim no drift check salt-wordpress lacks, and no Local JSON loading', () => {
  const root = path.join(path.dirname(emitter), '..')
  const readme = readFileSync(path.join(root, 'README.md'), 'utf8')
  assert.doesNotMatch(readme, /check-fields-from-contract\.php` runs/)
  assert.match(readme, /check-fields-from-contract\.php`[^.]*owed[^.]*EP-72/)
  // ACF Local JSON reads one group object per file, not the list the emitter writes.
  assert.doesNotMatch(readFileSync(emitter, 'utf8'), /acf-json/)
})

test('finding 1: a kept field conditioned on a field left out builds, its rule on that field gone', () => {
  const fields = [
    { name: 'source', type: 'select', label: 'Show', options: [{ value: 'inline', label: 'Inline' }, { value: 'posts', label: 'Posts' }], default: 'inline' },
    { name: 'query', type: 'collection-query', label: 'Query', sourceField: 'source', condition: { field: 'source', equals: 'posts' } },
    { name: 'flag', type: 'boolean', label: 'Flag' },
    { name: 'showTags', type: 'boolean', label: 'Tags', condition: { field: 'source', equals: 'posts' } },
    { name: 'note', type: 'text', label: 'Note', condition: { field: 'showTags', filled: false } },
    { name: 'aside', type: 'text', label: 'Aside', condition: [{ field: 'showTags', filled: false }, { field: 'flag', equals: true }] },
  ]
  const subs = probed(fields, { sources: {} })
  assert.ok(!subs.some((f) => f.name === 'showTags' || f.name === 'query'))
  assert.equal(field(subs, 'note').conditional_logic, undefined)
  assert.deepEqual(field(subs, 'aside').conditional_logic, [[{ field: 'field_salt_probe_flag', operator: '==', value: '1' }]])
  const keys = new Set(subs.map((f) => f.key))
  for (const f of subs) for (const g of f.conditional_logic ?? []) for (const r of g) assert.ok(keys.has(r.field), `${f.name} reads ${r.field}`)
})

test('finding 9: the CLI refuses a flag where a value belongs, an unknown argument, and --check with --write', () => {
  const run = (...args) => {
    try { execFileSync(process.execPath, [emitter, ...args], { encoding: 'utf8', stdio: 'pipe' }); return { code: 0, err: '' } } catch (e) { return { code: e.status, err: e.stderr } }
  }
  for (const [args, message] of [
    [['--check', '--options', 'o.json'], /--check needs a value, not the flag --options/],
    [['--check', 'a.json', '--verbose'], /unknown argument --verbose/],
    [['--check', 'a.json', '--write', 'b.json'], /--check and --write cannot be used together/],
    [[], /pass --check <snapshot> or --write <snapshot>/],
  ]) {
    const r = run(...args)
    assert.equal(r.code, 2, args.join(' '))
    assert.match(r.err, message, args.join(' '))
  }
})
