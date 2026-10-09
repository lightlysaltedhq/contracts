// Proves the conformance runner (salt-contract/conformance.mjs) passes a conforming adapter and
// fails each kind of non-conformance, naming the section, the case and the first differing node:
// against the reference adapter, a deliberately broken one, a broken field snapshot, a changed
// stylesheet byte, and the endpoint form of the adapter protocol.
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { firstDifference, parseConformanceArguments, renderMarkdown } from '../salt-contract/conformance.mjs'
import { payloadSnapshot } from '../salt-contract/emit/payload.mjs'
import { acfSnapshot } from '../salt-contract/emit/acf.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const runner = path.join(here, '..', 'salt-contract', 'conformance.mjs')
const pkg = path.join(here, '..', 'salt-contract')
const reference = `"${process.execPath}" "${path.join(here, 'salt_fixture_reference_adapter.mjs')}"`
const version = JSON.parse(readFileSync(path.join(pkg, 'package.json'), 'utf8')).version

const scratch = () => mkdtempSync(path.join(tmpdir(), 'salt-conformance-'))

/** Run the CLI; returns { code, out, report } with the JSON report it wrote. */
async function run(args) {
  const out = scratch()
  try {
    let code = 0
    let stdout = ''
    try {
      ({ stdout } = await promisify(execFile)(process.execPath, [runner, ...args, '--out', out], { encoding: 'utf8' }))
    } catch (e) {
      code = e.code
      stdout = `${e.stdout}${e.stderr}`
    }
    let report = null
    try { report = JSON.parse(readFileSync(path.join(out, 'conformance.json'), 'utf8')) } catch { /* a usage error writes none */ }
    return { code, out: stdout, report }
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

const section = (report, id) => report.sections.find((s) => s.id === id)
const failure = (report, id, name) => section(report, id).fixtures.failures.find((f) => f.case === name)

// One set of field options, and the snapshots the emitters give for it, as an implementation commits them.
const ICONS = { icons: [{ value: 'star', label: 'Star' }, { value: 'leaf', label: 'Leaf' }] }
const fieldsDir = mkdtempSync(path.join(tmpdir(), 'salt-conformance-fields-'))
writeFileSync(path.join(fieldsDir, 'options.json'), JSON.stringify(ICONS))
writeFileSync(path.join(fieldsDir, 'payload.json'), payloadSnapshot(ICONS))
after(() => rmSync(fieldsDir, { recursive: true, force: true }))
const withFields = ['--payload-snapshot', path.join(fieldsDir, 'payload.json'), '--fields-options', path.join(fieldsDir, 'options.json')]
// The CSS an implementation serves: a copy of the bundle, since the package's own is refused.
cpSync(path.join(pkg, 'styles', 'salt.css'), path.join(fieldsDir, 'served.css'))
const withStyles = ['--styles', path.join(fieldsDir, 'served.css')]

test('the reference adapter conforms: all four checks run and pass for every section', async () => {
  const r = await run(['--platform', 'reference', '--adapter', reference, ...withFields, ...withStyles, '--implementation-version', '9.9.9'])
  assert.equal(r.code, 0, r.out)
  assert.equal(r.report.ok, true)
  assert.equal(r.report.partial, false)
  assert.deepEqual(r.report.problems, [])
  assert.deepEqual(r.report.summary, { pass: r.report.sections.length, fail: 0, incomplete: 0, notShipped: 0 })
  assert.equal(r.report.format, 'salt-conformance/1')
  assert.deepEqual(r.report.contract, { package: '@lightlysaltedhq/salt-contract', version })
  assert.equal(r.report.platform, 'reference')
  assert.equal(r.report.implementation.version, '9.9.9')
  const ids = JSON.parse(readFileSync(path.join(pkg, 'contract', 'sections.json'), 'utf8')).sections.map((s) => s.id)
  assert.deepEqual(r.report.sections.map((s) => s.id), ids)
  for (const s of r.report.sections) {
    assert.equal(s.status, 'pass', s.id)
    assert.ok(s.fixtures.total > 0 && s.fixtures.passed === s.fixtures.total, s.id)
    assert.equal(s.stylesheets.status, 'pass')
    assert.equal(s.fields.status, 'pass')
    assert.equal(s.classes.status, 'pass')
  }
  assert.match(r.out, /^# Salt conformance: reference 9\.9\.9 against @lightlysaltedhq\/salt-contract /)
})

test('a run without a field snapshot fails, every section incomplete (SC-017)', async () => {
  const r = await run(['--platform', 'reference', '--adapter', reference, ...withStyles])
  assert.equal(r.code, 1, r.out)
  assert.equal(r.report.ok, false)
  assert.equal(r.report.partial, false)
  assert.equal(r.report.fields, null)
  for (const s of r.report.sections) assert.deepEqual([s.status, s.fields.status, s.stylesheets.status], ['incomplete', 'not run', 'pass'], s.id)
  assert.match(r.out, /^\*\*Fail\.\*\* 0 section\(s\) pass, 0 fail, 17 incomplete/m)
  assert.match(r.out, /## Field parity\n\nNot run, so no section conforms \(SC-017\)/)
})

test('a run without a stylesheet pin fails, every section incomplete (SC-017)', async () => {
  const r = await run(['--platform', 'reference', '--adapter', reference, ...withFields])
  assert.equal(r.code, 1, r.out)
  assert.equal(r.report.ok, false)
  assert.equal(r.report.stylesheets, null)
  for (const s of r.report.sections) assert.deepEqual([s.status, s.fields.status, s.stylesheets.status], ['incomplete', 'pass', 'not run'], s.id)
  assert.match(r.out, /## Stylesheet pin\n\nNot run, so no section conforms \(SC-017\)/)
})

test('--partial writes the report labelled partial, not conforming, and exits 1 even when all it ran passes', async () => {
  const r = await run(['--platform', 'reference', '--adapter', reference, ...withFields, ...withStyles, '--sections', 'faq', '--partial'])
  assert.equal(r.code, 1, r.out)
  assert.equal(r.report.ok, false)
  assert.equal(r.report.partial, true)
  assert.deepEqual(r.report.sections.map((s) => [s.id, s.status]), [['faq', 'pass']])
  assert.match(r.out, /^\*\*Partial, not conforming\.\*\* 1 section\(s\) pass/m)
  const fixturesOnly = await run(['--platform', 'reference', '--adapter', reference, '--partial'])
  assert.equal(fixturesOnly.code, 1)
  assert.equal(fixturesOnly.report.partial, true)
  assert.ok(fixturesOnly.report.sections.every((s) => s.status === 'incomplete' && s.fixtures.failed === 0))
})

// A broken adapter: the reference adapter's output for a case, changed as `mutations` says.
function brokenAdapter(mutations) {
  const dir = scratch()
  writeFileSync(path.join(dir, 'mutations.json'), JSON.stringify(mutations))
  writeFileSync(path.join(dir, 'adapter.mjs'), `
import { readdirSync, readFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import path from 'node:path'
const pkg = ${JSON.stringify(pkg)}
const mutations = JSON.parse(readFileSync(${JSON.stringify(path.join(dir, 'mutations.json'))}, 'utf8'))
const input = JSON.parse(readFileSync(0, 'utf8'))
const sdir = path.join(pkg, 'fixtures', input.section)
const file = readdirSync(sdir).find((f) => f.endsWith('.json') && isDeepStrictEqual(JSON.parse(readFileSync(path.join(sdir, f), 'utf8')), input))
const name = file.replace(/\\.json$/, '')
let html = readFileSync(path.join(sdir, name + '.html'), 'utf8')
const m = mutations[input.section + '/' + name]
if (m?.exit) { process.stderr.write(m.stderr); process.exit(m.exit) }
if (m?.html !== undefined) html = m.html
else if (m) {
  const next = html.replace(new RegExp(m.from), m.to)
  if (next === html) { process.stderr.write('mutation did not apply: ' + m.from); process.exit(9) }
  html = next
}
process.stdout.write(html)
`)
  return { dir, command: `"${process.execPath}" "${path.join(dir, 'adapter.mjs')}"` }
}

test('a broken adapter fails each case it breaks, naming the section, the case and the first differing node', async () => {
  // The hero's text block, beside a media block (nth-of-type) or alone.
  const top = 'section.salt-section > div.salt-section__content > div.salt-block.salt-hero'
  const text = `${top} > div.salt-hero__text:nth-of-type(1)`
  const adapter = brokenAdapter({
    'hero/split-image-left': { from: 'href="/contact/"', to: 'href="/contacts/"' },
    'hero/split-image-right-later': { from: '<p class="salt-hero__subheading">[^<]*</p>', to: '' },
    'hero/stacked-image-divider': { from: 'class="salt-hero__text"', to: 'class="salt-hero__copy"' },
    'hero/full-bleed-no-background': { from: 'lived in', to: 'loved in' },
    'hero/empty': { html: '<p class="salt-hero">Nothing to see</p>\n' },
    'hero/minimal-centre-inverse-dark-alt': { exit: 3, stderr: 'boom: no template for hero\n' },
  })
  try {
    const r = await run(['--platform', 'broken', '--adapter', adapter.command, '--sections', 'hero', '--partial'])
    assert.equal(r.code, 1, r.out)
    assert.equal(r.report.ok, false)
    assert.deepEqual(r.report.sections.map((s) => s.id), ['hero'])
    const hero = section(r.report, 'hero')
    assert.equal(hero.status, 'fail')
    assert.equal(hero.fixtures.failed, 6)
    assert.equal(hero.fixtures.passed, hero.fixtures.total - 6)

    assert.deepEqual(failure(r.report, 'hero', 'split-image-left'), {
      case: 'split-image-left', kind: 'mismatch', difference: 'attribute',
      path: `${text} > div.salt-hero__actions > a.salt-button:nth-of-type(2)`,
      name: 'href', expected: '/contact/', found: '/contacts/',
    })

    const missing = failure(r.report, 'hero', 'split-image-right-later')
    assert.equal(missing.difference, 'missing')
    assert.equal(missing.path, `${text} > p.salt-hero__subheading`)
    assert.equal(missing.found, null)
    assert.match(missing.expected, /^<p class="salt-hero__subheading">$/)

    const renamed = failure(r.report, 'hero', 'stacked-image-divider')
    assert.equal(renamed.path, text)
    assert.deepEqual([renamed.name, renamed.expected, renamed.found], ['class', 'salt-hero__text', 'salt-hero__copy'])
    assert.deepEqual(hero.classes, { status: 'fail', unknown: [{ class: 'salt-hero__copy', cases: ['stacked-image-divider'] }] })

    const changed = failure(r.report, 'hero', 'full-bleed-no-background')
    assert.equal(changed.difference, 'text')
    assert.equal(changed.path, `${top} > div.salt-hero__text > h1 > #text`)
    assert.deepEqual([changed.expected, changed.found], ['Gardens designed to be lived in', 'Gardens designed to be loved in'])

    const zero = failure(r.report, 'hero', 'empty')
    assert.deepEqual([zero.difference, zero.path, zero.expected, zero.found], ['unexpected', 'p.salt-hero', null, '<p class="salt-hero">'])
    assert.match(zero.note, /renders nothing/)

    const crashed = failure(r.report, 'hero', 'minimal-centre-inverse-dark-alt')
    assert.deepEqual(crashed, { case: 'minimal-centre-inverse-dark-alt', kind: 'adapter', error: 'the adapter exited 3', stderr: 'boom: no template for hero\n' })

    assert.ok(r.out.includes(`- \`hero/split-image-left\`: attribute \`href\` at \`${text} > div.salt-hero__actions > a.salt-button:nth-of-type(2)\`: expected \`/contact/\`, found \`/contacts/\``), r.out)
    assert.ok(r.out.includes('- `hero/minimal-centre-inverse-dark-alt`: the adapter exited 3; stderr: `boom: no template for hero`'), r.out)
    assert.ok(r.out.includes('- class `salt-hero__copy` is on no element in contract/markup (cases: stacked-image-divider)'), r.out)
  } finally {
    rmSync(adapter.dir, { recursive: true, force: true })
  }
})

test('a section the implementation does not ship is reported as not shipped, not failed', async () => {
  const shipped = JSON.parse(readFileSync(path.join(pkg, 'contract', 'sections.json'), 'utf8')).sections.map((s) => s.id).filter((id) => !['pricing', 'tabs'].includes(id))
  const f = snapshotFiles({ ...ICONS, sections: shipped })
  after(() => rmSync(f.dir, { recursive: true, force: true }))
  const r = await run(['--platform', 'reference', '--adapter', reference, ...f.payload, ...withStyles, '--not-shipped', 'pricing,tabs'])
  assert.equal(r.code, 0, r.out)
  assert.equal(r.report.ok, true)
  assert.deepEqual(r.report.sections.filter((s) => s.status !== 'pass').map((s) => s.id), ['tabs', 'pricing'])
  assert.deepEqual(r.report.summary, { pass: 15, fail: 0, incomplete: 0, notShipped: 2 })
  assert.deepEqual(section(r.report, 'pricing'), { id: 'pricing', status: 'not shipped' })
  assert.match(r.out, /\| pricing \| not shipped \|/)
})

test('field parity: a matching snapshot passes, and a renamed field fails its own section only', async () => {
  const dir = scratch()
  try {
    writeFileSync(path.join(dir, 'options.json'), JSON.stringify(ICONS))
    writeFileSync(path.join(dir, 'blocks.json'), payloadSnapshot(ICONS))
    writeFileSync(path.join(dir, 'acf.json'), acfSnapshot(ICONS))
    const base = ['--platform', 'reference', '--adapter', reference, '--sections', 'hero,faq', '--partial', ...withStyles, '--fields-options', path.join(dir, 'options.json')]
    for (const flag of ['--payload-snapshot', '--acf-snapshot']) {
      const ok = await run([...base, flag, path.join(dir, flag === '--payload-snapshot' ? 'blocks.json' : 'acf.json')])
      assert.deepEqual(ok.report.sections.map((s) => [s.status, s.fields.status]), [['pass', 'pass'], ['pass', 'pass']], ok.out)
    }

    const blocks = JSON.parse(payloadSnapshot(ICONS))
    blocks.find((b) => b.slug === 'hero').fields.find((f) => f.name === 'heading').name = 'headline'
    writeFileSync(path.join(dir, 'blocks.json'), JSON.stringify(blocks, null, 2) + '\n')
    const r = await run([...base, '--payload-snapshot', path.join(dir, 'blocks.json')])
    assert.equal(r.code, 1, r.out)
    assert.equal(section(r.report, 'faq').fields.status, 'pass')
    assert.equal(section(r.report, 'faq').status, 'pass')
    const hero = section(r.report, 'hero')
    assert.equal(hero.status, 'fail')
    assert.equal(hero.fields.status, 'fail')
    assert.ok(hero.fields.problems.includes('blocks[hero].fields[headline] is in the snapshot and no longer generated'), hero.fields.problems.join('\n'))
    assert.ok(hero.fields.problems.includes('blocks[hero].fields[heading] is generated and not in the snapshot'))
    assert.match(r.out, /- fields: blocks\[hero\]\.fields\[headline\] is in the snapshot and no longer generated/)

    const groups = JSON.parse(acfSnapshot(ICONS))
    groups[0].fields[0].layouts.find((l) => l.name === 'faq').sub_fields.find((f) => f.name === 'heading').name = 'title'
    writeFileSync(path.join(dir, 'acf.json'), JSON.stringify(groups, null, 2) + '\n')
    const acf = await run([...base, '--acf-snapshot', path.join(dir, 'acf.json')])
    assert.equal(acf.code, 1, acf.out)
    assert.equal(section(acf.report, 'hero').fields.status, 'pass')
    assert.ok(section(acf.report, 'faq').fields.problems.some((p) => p.startsWith('groups[group_salt_sections].fields[sections].layouts[faq].sub_fields[title]')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('stylesheet pin: the served CSS must be styles/salt.css byte for byte, from a file or a URL (review P1)', async () => {
  const dir = scratch()
  const bundle = readFileSync(path.join(pkg, 'styles', 'salt.css'))
  const server = createServer((req, res) => {
    if (req.url === '/salt.css') { res.writeHead(200, { 'content-type': 'text/css' }); res.end(bundle); return }
    res.writeHead(404); res.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  try {
    const base = ['--platform', 'reference', '--adapter', reference, '--sections', 'faq', '--partial', ...withFields]
    const served = path.join(dir, 'app.css')
    const changed = Buffer.from(bundle)
    changed[100] = changed[100] === 0x20 ? 0x09 : 0x20
    writeFileSync(served, changed)
    const r = await run([...base, '--styles', served])
    assert.equal(r.code, 1, r.out)
    assert.deepEqual(r.report.stylesheets, { served, bundle: 'styles/salt.css', contract: version, ok: false, status: 'differs', firstDifferingByte: 100 })
    assert.equal(section(r.report, 'faq').stylesheets.status, 'fail')
    assert.match(r.out, /against this contract's `styles\/salt\.css` \(.+\): differs from byte 100\./)

    writeFileSync(served, bundle)
    const same = await run([...base, '--styles', served])
    assert.equal(same.report.stylesheets.status, 'identical')
    assert.equal(section(same.report, 'faq').stylesheets.status, 'pass')

    const gone = await run([...base, '--styles', path.join(dir, 'nothing.css')])
    assert.equal(gone.report.stylesheets.status, 'missing')
    assert.equal(gone.report.stylesheets.ok, false)

    // The package's own bundle or styles/, however named, is no pin: refused.
    for (const own of [path.join(pkg, 'styles', 'salt.css'), path.join(pkg, 'styles'), path.join(pkg, 'styles', 'sections.css'), path.join(pkg, 'styles', '..', 'styles', 'salt.css')]) {
      const refused = await run([...base, '--styles', own])
      assert.equal(refused.code, 2, `${own}: ${refused.out}`)
      assert.match(refused.out, /is this package's own styles\//)
    }

    const fetched = await run([...base, '--styles-url', `${origin}/salt.css`])
    assert.equal(fetched.report.stylesheets.status, 'identical', fetched.out)
    assert.equal(section(fetched.report, 'faq').stylesheets.status, 'pass')
    const notFound = await run([...base, '--styles-url', `${origin}/other.css`])
    assert.deepEqual([notFound.report.stylesheets.status, notFound.report.stylesheets.error], ['unreachable', 'answered 404'])

    // A version the caller states proves nothing about the bytes served, so it is no pin.
    const stated = await run([...base, '--styles-version', version])
    assert.equal(stated.code, 2, stated.out)
    assert.match(stated.out, /unknown argument --styles-version/)
  } finally {
    server.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the endpoint form: a POSTed case answered 200 passes, any other status fails that case', async () => {
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (d) => { body += d })
    req.on('end', () => {
      const input = JSON.parse(body)
      const sdir = path.join(pkg, 'fixtures', input.section)
      const match = ['empty', 'many', 'one-inverse'].find((n) => readFileSync(path.join(sdir, `${n}.json`), 'utf8') === body)
      if (req.headers['content-type'] !== 'application/json' || !match) { res.writeHead(400); res.end('not a case'); return }
      if (match === 'many') { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('template error'); return }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(readFileSync(path.join(sdir, `${match}.html`)))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const r = await run(['--platform', 'endpoint', '--endpoint', `http://127.0.0.1:${server.address().port}/render`, '--sections', 'faq', '--partial'])
    assert.equal(r.code, 1, r.out)
    const faq = section(r.report, 'faq')
    assert.equal(faq.fixtures.passed, faq.fixtures.total - 1)
    assert.deepEqual(failure(r.report, 'faq', 'many'), { case: 'many', kind: 'adapter', error: 'the endpoint answered 500', stderr: 'template error' })
    assert.equal(r.report.adapter.kind, 'endpoint')
  } finally {
    server.close()
  }
})

test('arguments: unknown, empty, duplicated or contradictory flags are refused with exit 2', async () => {
  const ok = ['--platform', 'x', '--adapter', 'true']
  assert.throws(() => parseConformanceArguments([...ok, '--sectons', 'hero']), /unknown argument --sectons/)
  assert.throws(() => parseConformanceArguments([...ok, '--sections', '']), /not an empty one/)
  assert.throws(() => parseConformanceArguments([...ok, '--sections', 'hero']), /pass --partial/)
  assert.throws(() => parseConformanceArguments([...ok, '--partial', '--partial']), /--partial is given twice/)
  assert.equal(parseConformanceArguments([...ok, '--partial', '--sections', 'hero']).partial, true)
  assert.equal(parseConformanceArguments(ok).partial, false)
  assert.throws(() => parseConformanceArguments([...ok, '--partial', '--sections', 'hero', '--sections', 'faq']), /--sections is given twice/)
  assert.throws(() => parseConformanceArguments([...ok, '--sections']), /needs a value/)
  assert.throws(() => parseConformanceArguments([...ok, '--partial', '--sections', '--jobs']), /not the flag --jobs/)
  assert.throws(() => parseConformanceArguments([...ok, '--endpoint', 'http://x']), /cannot be used together/)
  assert.throws(() => parseConformanceArguments([...ok, '--styles-version', '1']), /unknown argument --styles-version/)
  assert.throws(() => parseConformanceArguments([...ok, '--styles', 'a.css', '--styles-url', 'http://x/a.css']), /cannot be used together/)
  assert.throws(() => parseConformanceArguments(['--adapter', 'true']), /--platform/)
  assert.throws(() => parseConformanceArguments(['--platform', 'x']), /--adapter <command> or --endpoint <url>/)
  assert.throws(() => parseConformanceArguments([...ok, '--jobs', '0']), /at least 1/)
  assert.throws(() => parseConformanceArguments([...ok, '--fields-options', 'o.json']), /needs --payload-snapshot or --acf-snapshot/)
  for (const args of [[...ok, '--partial', '--sections', 'heroes'], [...ok, '--partial', '--sections', 'hero', '--not-shipped', 'hero'], [...ok, '--sections', 'hero'], [...ok, '--bogus', '1']]) {
    const r = await run(args)
    assert.equal(r.code, 2, r.out)
    assert.equal(r.report, null)
  }
})

test('firstDifference reads past what the normaliser removes, and finds an extra element as unexpected', () => {
  assert.equal(firstDifference('<p class="b a">x</p>', '<p  class="a b" >x</p>\n'), null)
  assert.deepEqual(firstDifference('<ul><li>a</li></ul>', '<ul><li>a</li><li>b</li></ul>'),
    { path: 'ul > li:nth-of-type(2)', kind: 'unexpected', expected: null, found: '<li>' })
  assert.deepEqual(firstDifference('<div><p>a</p></div>', '<div><span>a</span></div>'),
    { path: 'div > p', kind: 'element', expected: '<p>', found: '<span>' })
})

// ── Review C1, C2, C6, C7 ─────────────────────────────────────────────────────────────────────

const ids = JSON.parse(readFileSync(path.join(pkg, 'contract', 'sections.json'), 'utf8')).sections.map((s) => s.id)

/** Snapshots and options in a scratch directory, from `options`, optionally edited. */
function snapshotFiles(options, edit = (x) => x) {
  const dir = scratch()
  writeFileSync(path.join(dir, 'options.json'), JSON.stringify(options))
  writeFileSync(path.join(dir, 'payload.json'), JSON.stringify(edit(JSON.parse(payloadSnapshot(options))), null, 2) + '\n')
  writeFileSync(path.join(dir, 'acf.json'), acfSnapshot(options))
  return { dir, payload: ['--payload-snapshot', path.join(dir, 'payload.json'), '--fields-options', path.join(dir, 'options.json')],
    acf: ['--acf-snapshot', path.join(dir, 'acf.json'), '--fields-options', path.join(dir, 'options.json')] }
}

test('field parity: a block that is no contract section fails every shipped section (review C1)', async () => {
  const f = snapshotFiles(ICONS, (blocks) => [...blocks, { ...blocks[0], slug: 'legacy-banner' }])
  try {
    const r = await run(['--platform', 'reference', '--adapter', reference, ...f.payload, ...withStyles])
    assert.equal(r.code, 1, r.out)
    assert.equal(r.report.ok, false)
    assert.ok(r.report.fields.problems.includes('blocks[legacy-banner] is in the snapshot and no longer generated'), r.report.fields.problems.join('\n'))
    assert.ok(r.report.sections.every((s) => s.status === 'fail' && s.fields.status === 'fail'))
  } finally {
    rmSync(f.dir, { recursive: true, force: true })
  }
})

test('field parity: a section declared not shipped but in the snapshot fails the run (review C1, C6)', async () => {
  const f = snapshotFiles(ICONS, (blocks) => { blocks.find((b) => b.slug === 'pricing').fields[0].name = 'drifted'; return blocks })
  try {
    for (const platform of ['payload', 'acf']) {
      const r = await run(['--platform', 'reference', '--adapter', reference, ...f[platform], ...withStyles, '--not-shipped', 'pricing'])
      assert.equal(r.code, 1, r.out)
      assert.equal(r.report.ok, false)
      assert.ok(r.report.fields.problems.some((p) => p.startsWith('pricing is declared not shipped, and its fields are in the snapshot')), r.report.fields.problems.join('\n'))
      assert.ok(r.report.sections.filter((s) => s.status !== 'not shipped').every((s) => s.fields.status === 'fail'))
    }
  } finally {
    rmSync(f.dir, { recursive: true, force: true })
  }
})

test('field parity: a shipped section missing from the snapshot fails (review C2)', async () => {
  const f = snapshotFiles({ ...ICONS, sections: ids.filter((id) => id !== 'faq') })
  try {
    for (const platform of ['payload', 'acf']) {
      const r = await run(['--platform', 'reference', '--adapter', reference, ...f[platform], ...withStyles])
      assert.equal(r.code, 1, r.out)
      assert.deepEqual(section(r.report, 'faq').fields, { status: 'fail', problems: ['faq is not in the field snapshot'] })
      assert.equal(section(r.report, 'hero').status, 'pass')
    }
    // Declared not shipped, its absence is right.
    const r = await run(['--platform', 'reference', '--adapter', reference, ...f.payload, ...withStyles, '--not-shipped', 'faq'])
    assert.equal(r.code, 0, r.out)
  } finally {
    rmSync(f.dir, { recursive: true, force: true })
  }
})

test('a run that ships no section is refused (review C6)', async () => {
  const r = await run(['--platform', 'reference', '--adapter', reference, ...withFields, ...withStyles, '--not-shipped', ids.join(',')])
  assert.equal(r.code, 2, r.out)
  assert.match(r.out, /ships no section/)
})

test('a shipped section drawing a class only a not-shipped section draws fails the run (review C6)', async () => {
  const f = snapshotFiles({ ...ICONS, sections: ids.filter((id) => id !== 'pricing') })
  const adapter = brokenAdapter({ 'faq/many': { from: 'class="salt-intro"', to: 'class="salt-intro salt-pricing__badge"' } })
  try {
    const r = await run(['--platform', 'reference', '--adapter', adapter.command, ...f.payload, ...withStyles, '--not-shipped', 'pricing'])
    assert.equal(r.code, 1, r.out)
    assert.deepEqual(r.report.problems, ['pricing is declared not shipped, and the output uses its class salt-pricing__badge (faq/many)'])
    assert.match(r.out, /pricing is declared not shipped, and the output uses its class salt-pricing__badge \(faq\/many\)/)
  } finally {
    rmSync(f.dir, { recursive: true, force: true })
    rmSync(adapter.dir, { recursive: true, force: true })
  }
})

test('firstDifference reads a class change on the first of several like siblings as that attribute (review C7)', () => {
  const expected = readFileSync(path.join(pkg, 'fixtures', 'tabs', 'many-tabbed.html'), 'utf8')
  const actual = expected.replace('<div class="salt-tabs__control">', '<div class="salt-tabs__choice">')
  const d = firstDifference(expected, actual)
  assert.equal(d.kind, 'attribute', JSON.stringify(d))
  assert.equal(d.name, 'class')
  assert.deepEqual([d.expected, d.found], ['salt-tabs__control', 'salt-tabs__choice'])
  assert.match(d.path, / > div\.salt-tabs__list:nth-of-type\(1\) > div\.salt-tabs__control:nth-of-type\(1\)$/)
  // A sibling really removed is still read as missing, when the next one matches exactly.
  const removed = firstDifference('<ul><li class="a">1</li><li class="a">2</li></ul>', '<ul><li class="a">2</li></ul>')
  assert.deepEqual(removed, { path: 'ul > li.a:nth-of-type(1)', kind: 'missing', expected: '<li class="a">', found: null })
})

// ── Review P2: children are aligned, not compared index by index ─────────────────────────────

test('firstDifference aligns children: a dropped tab panel whose successors renumber is that panel missing (review P2)', () => {
  const expected = readFileSync(path.join(pkg, 'fixtures', 'tabs', 'many-tabbed.html'), 'utf8')
  const at = expected.indexOf('<div class="salt-tabs__panels">')
  const panels = expected.slice(at)
  const first = panels.indexOf('<div class="salt-tabs__panel" id="tabs-many__panel-1"')
  const second = panels.indexOf('<div class="salt-tabs__panel" id="tabs-many__panel-2"')
  const renumbered = (panels.slice(0, first) + panels.slice(second))
    .replace('__panel-2"', '__panel-1"').replace('__label-2"', '__label-1"')
    .replace('__panel-3"', '__panel-2"').replace('__label-3"', '__label-2"')
  const d = firstDifference(expected, expected.slice(0, at) + renumbered)
  assert.equal(d.kind, 'missing', JSON.stringify(d))
  assert.match(d.path, / > div\.salt-tabs__panels:nth-of-type\(2\) > div\.salt-tabs__panel:nth-of-type\(1\)$/)
  assert.match(d.expected, /id="tabs-many__panel-1"/)
  assert.equal(d.found, null)
})

test('firstDifference reports two siblings swapped as order, with both positions (review P2)', () => {
  const expected = readFileSync(path.join(pkg, 'fixtures', 'faq', 'many.html'), 'utf8')
  const eyebrow = expected.match(/<p class="salt-eyebrow">[^<]*<\/p>/)[0]
  const heading = expected.match(/<h2 [^>]*>[^<]*<\/h2>/)[0]
  const swapped = expected.replace(eyebrow, '\u0000').replace(heading, eyebrow).replace('\u0000', heading)
  const d = firstDifference(expected, swapped)
  assert.equal(d.kind, 'order', JSON.stringify(d))
  assert.match(d.path, / > div\.salt-block > p\.salt-eyebrow:nth-of-type\(1\)$/)
  assert.deepEqual([d.expectedAt, d.foundAt], [1, 2])
  assert.equal(d.expected, '<p class="salt-eyebrow">')
  assert.equal(d.found, '<p class="salt-eyebrow">')
  const failures = [{ case: 'many', kind: 'mismatch', difference: d.kind, ...d, kind: 'mismatch' }]
  const markdown = renderMarkdown({ platform: 'x', implementation: { version: null }, contract: { package: 'p', version: '0' }, ok: false, partial: false,
    summary: { pass: 0, fail: 1, incomplete: 0, notShipped: 0 }, adapter: { kind: 'command', target: 'a' }, problems: [], fields: null, stylesheets: null,
    sections: [{ id: 'faq', status: 'fail', fixtures: { total: 1, passed: 0, failed: 1, failures }, fields: { status: 'not run', problems: [] }, classes: { status: 'pass', unknown: [] }, stylesheets: { status: 'not run' } }] })
  assert.match(markdown, /- `faq\/many`: order at `[^`]+p\.salt-eyebrow:nth-of-type\(1\)`: `<p class="salt-eyebrow">` expected at position 1, found at 2/)
})

test('firstDifference descends into an aligned pair for an attribute or text change, past a missing sibling (review P2)', () => {
  assert.deepEqual(firstDifference('<ul><li>a</li><li>b</li><li>c</li></ul>', '<ul><li>a</li><li>c</li></ul>'),
    { path: 'ul > li:nth-of-type(2)', kind: 'missing', expected: '<li>', found: null })
  assert.deepEqual(firstDifference('<ul><li>a</li><li>b</li></ul>', '<ul><li>a</li><li>B</li></ul>'),
    { path: 'ul > li:nth-of-type(2) > #text', kind: 'text', expected: 'b', found: 'B' })
})
