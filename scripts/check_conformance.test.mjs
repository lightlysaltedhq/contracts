// Proves the conformance runner (salt-contract/conformance.mjs) passes a conforming adapter and
// fails each kind of non-conformance, naming the section, the case and the first differing node:
// against the reference adapter, a deliberately broken one, a broken field snapshot, a changed
// stylesheet byte, and the endpoint form of the adapter protocol.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { firstDifference, parseConformanceArguments } from '../salt-contract/conformance.mjs'
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

test('the reference adapter passes every section of every fixture, with the stylesheets pinned', async () => {
  const r = await run(['--platform', 'reference', '--adapter', reference, '--styles', path.join(pkg, 'styles'), '--implementation-version', '9.9.9'])
  assert.equal(r.code, 0, r.out)
  assert.equal(r.report.ok, true)
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
    assert.equal(s.fields.status, 'not checked')
  }
  assert.match(r.out, /^# Salt conformance: reference 9\.9\.9 against @lightlysaltedhq\/salt-contract /)
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
    const r = await run(['--platform', 'broken', '--adapter', adapter.command, '--sections', 'hero'])
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
  const r = await run(['--platform', 'reference', '--adapter', reference, '--sections', 'faq', '--not-shipped', 'pricing,tabs'])
  assert.equal(r.code, 0, r.out)
  assert.deepEqual(r.report.sections.map((s) => [s.id, s.status]), [['faq', 'pass'], ['tabs', 'not shipped'], ['pricing', 'not shipped']])
  assert.deepEqual(r.report.summary, { pass: 1, fail: 0, notShipped: 2 })
  assert.match(r.out, /\| pricing \| not shipped \|/)
})

const ICONS = { icons: [{ value: 'star', label: 'Star' }, { value: 'leaf', label: 'Leaf' }] }

test('field parity: a matching snapshot passes, and a renamed field fails its own section only', async () => {
  const dir = scratch()
  try {
    writeFileSync(path.join(dir, 'options.json'), JSON.stringify(ICONS))
    writeFileSync(path.join(dir, 'blocks.json'), payloadSnapshot(ICONS))
    writeFileSync(path.join(dir, 'acf.json'), acfSnapshot(ICONS))
    const base = ['--platform', 'reference', '--adapter', reference, '--sections', 'hero,faq', '--fields-options', path.join(dir, 'options.json')]
    for (const flag of ['--payload-snapshot', '--acf-snapshot']) {
      const ok = await run([...base, flag, path.join(dir, flag === '--payload-snapshot' ? 'blocks.json' : 'acf.json')])
      assert.equal(ok.code, 0, ok.out)
      assert.deepEqual(ok.report.sections.map((s) => s.fields.status), ['pass', 'pass'])
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

test('stylesheet pin: one changed byte fails, and a version pin passes only at this version', async () => {
  const dir = scratch()
  try {
    cpSync(path.join(pkg, 'styles'), dir, { recursive: true })
    const file = path.join(dir, 'sections.css')
    const bytes = readFileSync(file)
    bytes[100] = bytes[100] === 0x20 ? 0x09 : 0x20
    writeFileSync(file, bytes)
    const base = ['--platform', 'reference', '--adapter', reference, '--sections', 'faq']
    const r = await run([...base, '--styles', dir])
    assert.equal(r.code, 1, r.out)
    assert.equal(r.report.stylesheets.ok, false)
    assert.deepEqual(r.report.stylesheets.files.find((f) => f.file === 'sections.css'), { file: 'sections.css', status: 'differs', firstDifferingByte: 100 })
    assert.ok(r.report.stylesheets.files.filter((f) => f.file !== 'sections.css').every((f) => f.status === 'identical'))
    assert.equal(section(r.report, 'faq').stylesheets.status, 'fail')
    assert.match(r.out, /- sections\.css: differs from byte 100/)

    rmSync(path.join(dir, 'views.css'))
    const gone = await run([...base, '--styles', dir])
    assert.equal(gone.report.stylesheets.files.find((f) => f.file === 'views.css').status, 'missing')

    const pinned = await run([...base, '--styles-version', version])
    assert.equal(pinned.code, 0, pinned.out)
    assert.deepEqual(pinned.report.stylesheets, { mode: 'version', pin: version, contract: version, ok: true, files: [] })
    const behind = await run([...base, '--styles-version', '0.0.1'])
    assert.equal(behind.code, 1)
    assert.equal(section(behind.report, 'faq').stylesheets.status, 'fail')
  } finally {
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
    const r = await run(['--platform', 'endpoint', '--endpoint', `http://127.0.0.1:${server.address().port}/render`, '--sections', 'faq'])
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
  assert.throws(() => parseConformanceArguments([...ok, '--sections', 'hero', '--sections', 'faq']), /--sections is given twice/)
  assert.throws(() => parseConformanceArguments([...ok, '--sections']), /needs a value/)
  assert.throws(() => parseConformanceArguments([...ok, '--sections', '--jobs']), /not the flag --jobs/)
  assert.throws(() => parseConformanceArguments([...ok, '--endpoint', 'http://x']), /cannot be used together/)
  assert.throws(() => parseConformanceArguments([...ok, '--styles', 'a', '--styles-version', '1']), /cannot be used together/)
  assert.throws(() => parseConformanceArguments(['--adapter', 'true']), /--platform/)
  assert.throws(() => parseConformanceArguments(['--platform', 'x']), /--adapter <command> or --endpoint <url>/)
  assert.throws(() => parseConformanceArguments([...ok, '--jobs', '0']), /at least 1/)
  assert.throws(() => parseConformanceArguments([...ok, '--fields-options', 'o.json']), /needs --payload-snapshot or --acf-snapshot/)
  for (const args of [[...ok, '--sections', 'heroes'], [...ok, '--sections', 'hero', '--not-shipped', 'hero'], [...ok, '--bogus', '1']]) {
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
