#!/usr/bin/env node
// The conformance runner an implementation points at itself (README, "Conformance"). It ships in
// the package, so Salt for Next.js and Salt for WordPress each run the contract they pin against
// their own adapter in their own CI, and both are held to the same four checks per section:
//
// 1. FIXTURES. Every case of every section is sent to the implementation's adapter (README, "The
//    adapter protocol"); its HTML and the case's expected HTML go through normalise() and must be
//    equal. A mismatch names the case and the first node that differs, by path.
// 2. FIELD PARITY. The implementation's committed field snapshot (Payload's payloadSnapshot, or
//    ACF's acfSnapshot) is checked with the emitter's own check*Snapshot, against the snapshot the
//    contract generates with the implementation's options. Each problem is filed under its section.
// 3. CLASSES. Every salt-* class in the adapter's output is one an element in contract/markup
//    carries.
// 4. STYLESHEET PIN. The stylesheets the implementation serves are byte-identical to styles/, or it
//    re-exports them from a package version equal to this one.
//
// An implementation conforms only when all four ran for every section it ships and all pass
// (SC-017): a run without a field snapshot or a stylesheet pin fails. A run that leaves a check or
// a section out is allowed only with --partial, and its report says "partial, not conforming".
// It writes a JSON report (the parity matrix's input) and a Markdown one, and exits 1 on any
// mismatch or partial run, 2 on a usage error. Plain Node, no dependencies.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compare, parse } from './normalise.mjs'
import { checkPayloadSnapshot } from './emit/payload.mjs'
import { checkAcfSnapshot } from './emit/acf.mjs'
import { isMainModule } from './emit/_contract.mjs'

const packageDir = path.dirname(fileURLToPath(import.meta.url))
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))

export const REPORT_FORMAT = 'salt-conformance/1'

// ── Arguments ─────────────────────────────────────────────────────────────────────────────────

const FLAGS = ['--platform', '--adapter', '--endpoint', '--payload-snapshot', '--acf-snapshot', '--fields-options',
  '--styles', '--styles-version', '--sections', '--not-shipped', '--implementation-version', '--out', '--jobs', '--timeout']
// Flags that take no value.
const SWITCHES = ['--partial']

/**
 * The runner's arguments, as `parseEmitterArguments` reads an emitter's: every flag takes a value,
 * but the --partial switch, and an unknown flag, a missing or empty value, a flag given as a value
 * or a flag given twice throws, so a typo never runs as a different check. Returns the options runConformance takes.
 */
export function parseConformanceArguments(argv) {
  const values = {}
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    if (!FLAGS.includes(flag) && !SWITCHES.includes(flag)) throw new Error(`unknown argument ${flag}`)
    if (flag in values) throw new Error(`${flag} is given twice`)
    if (SWITCHES.includes(flag)) { values[flag] = true; continue }
    const value = argv[i + 1]
    if (value === undefined) throw new Error(`${flag} needs a value`)
    // An empty value is most often an unset variable; read as absent, it would check the wrong thing.
    if (value === '') throw new Error(`${flag} needs a value, not an empty one`)
    if (value.startsWith('--')) throw new Error(`${flag} needs a value, not the flag ${value}`)
    values[flag] = value
    i++
  }
  const either = (a, b) => { if (values[a] && values[b]) throw new Error(`${a} and ${b} cannot be used together`) }
  either('--adapter', '--endpoint')
  either('--payload-snapshot', '--acf-snapshot')
  either('--styles', '--styles-version')
  if (!values['--platform']) throw new Error('--platform <name> is required (nextjs, wordpress …), to name the implementation in the report')
  if (!values['--adapter'] && !values['--endpoint']) throw new Error('pass --adapter <command> or --endpoint <url>')
  // A run of some sections says nothing of the rest, so it is partial by construction.
  if (values['--sections'] && !values['--partial']) throw new Error('--sections runs only some sections: pass --partial, and the run will not count as conforming')
  if (values['--fields-options'] && !values['--payload-snapshot'] && !values['--acf-snapshot']) {
    throw new Error('--fields-options needs --payload-snapshot or --acf-snapshot')
  }
  const list = (v) => (v === undefined ? undefined : v.split(',').map((s) => s.trim()).filter(Boolean))
  const whole = (flag, min) => {
    const v = values[flag]
    if (v === undefined) return undefined
    if (!/^\d+$/.test(v) || Number(v) < min) throw new Error(`${flag} must be a whole number of at least ${min}`)
    return Number(v)
  }
  return {
    platform: values['--platform'],
    adapter: values['--adapter'] ? { command: values['--adapter'] } : { endpoint: values['--endpoint'] },
    fields: values['--payload-snapshot'] ? { platform: 'payload', snapshot: values['--payload-snapshot'], options: values['--fields-options'] }
      : values['--acf-snapshot'] ? { platform: 'acf', snapshot: values['--acf-snapshot'], options: values['--fields-options'] }
        : undefined,
    styles: values['--styles'] ? { dir: values['--styles'] } : values['--styles-version'] ? { version: values['--styles-version'] } : undefined,
    sections: list(values['--sections']),
    notShipped: list(values['--not-shipped']),
    implementationVersion: values['--implementation-version'],
    partial: values['--partial'] === true,
    out: values['--out'],
    jobs: whole('--jobs', 1),
    timeout: whole('--timeout', 1),
  }
}

// ── The adapter ───────────────────────────────────────────────────────────────────────────────

const STDERR_LIMIT = 4000
const clip = (text) => (text.length > STDERR_LIMIT ? `${text.slice(0, STDERR_LIMIT)}…` : text)

/** One case through a command adapter: input on stdin, HTML on stdout; { html } or { error, stderr }. */
function runCommand(command, input, timeout) {
  return new Promise((resolve) => {
    const child = spawn(command, { shell: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const out = []
    const err = []
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, timeout)
    child.stdout.on('data', (d) => out.push(d))
    child.stderr.on('data', (d) => err.push(d))
    // An adapter that exits without reading stdin closes the pipe; its exit status still decides.
    child.stdin.on('error', () => {})
    child.on('error', (e) => { clearTimeout(timer); resolve({ error: `the adapter could not be started: ${e.message}`, stderr: '' }) })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      const stderr = clip(Buffer.concat(err).toString('utf8'))
      if (timedOut) resolve({ error: `the adapter did not finish within ${timeout} ms`, stderr })
      else if (code !== 0) resolve({ error: `the adapter exited ${code ?? signal}`, stderr })
      else resolve({ html: Buffer.concat(out).toString('utf8'), stderr })
    })
    child.stdin.end(input)
  })
}

/** One case through an endpoint adapter: POST the input, expect 200 and the HTML. */
async function runEndpoint(url, input, timeout) {
  let res
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: input, signal: AbortSignal.timeout(timeout) })
  } catch (e) {
    return { error: `the endpoint could not be reached: ${e.cause?.message ?? e.message}`, stderr: '' }
  }
  const body = await res.text()
  if (res.status !== 200) return { error: `the endpoint answered ${res.status}`, stderr: clip(body) }
  return { html: body, stderr: '' }
}

// ── The first difference ──────────────────────────────────────────────────────────────────────

const elementsOf = (el) => el.children.filter((c) => c.type === 'element')
const classesOf = (el) => (el.attrs.find(([n]) => n === 'class')?.[1] ?? '').split(/[ \t\n\r\f]+/).filter(Boolean)
const shapeOf = (node) => (node?.type === 'element' ? `${node.name}.${classesOf(node).join('.')}` : node?.type === 'text' ? '#text' : '')

/** A step of a path: tag and classes, with :nth-of-type(n) when the parent has more than one of the tag. */
function step(parent, el) {
  const same = elementsOf(parent).filter((c) => c.name === el.name)
  const nth = same.length > 1 ? `:nth-of-type(${same.indexOf(el) + 1})` : ''
  return `${el.name}${classesOf(el).map((c) => `.${c}`).join('')}${nth}`
}

const SNIPPET = 200
const startTag = (el) => {
  const tag = `<${el.name}${el.attrs.map(([n, v]) => (v === '' ? ` ${n}` : ` ${n}="${v}"`)).join('')}>`
  return tag.length > SNIPPET ? `${tag.slice(0, SNIPPET)}…` : tag
}
const show = (node) => (node === undefined ? null : node.type === 'text' ? `text ${JSON.stringify(node.value)}` : startTag(node))

/**
 * The first node at which two fragments differ once both are normalised, in document order, or
 * null when they are equivalent. `path` is a CSS-like path to it from the fragment's top
 * (`section.salt-section > … > a.salt-button:nth-of-type(2)`), and `kind` says what differs:
 * `element` (another element or text in its place), `missing` (expected, absent), `unexpected`
 * (present, not expected), `attribute` (with `name`; null for an absent side) or `text`.
 */
export function firstDifference(expectedHtml, actualHtml) {
  const { equal, expected, actual } = compare(expectedHtml, actualHtml)
  if (equal) return null
  const walk = (a, b, at) => {
    const join = (p, s) => (p ? `${p} > ${s}` : s)
    if (a.name !== '#root') {
      const names = [...new Set([...a.attrs, ...b.attrs].map(([n]) => n))].sort()
      for (const name of names) {
        const x = a.attrs.find(([n]) => n === name)?.[1] ?? null
        const y = b.attrs.find(([n]) => n === name)?.[1] ?? null
        if (x !== y) return { path: at, kind: 'attribute', name, expected: x, found: y }
      }
    }
    const n = Math.max(a.children.length, b.children.length)
    for (let i = 0; i < n; i++) {
      const x = a.children[i]
      const y = b.children[i]
      const here = (node, parent) => (node?.type === 'element' ? join(at, step(parent, node)) : join(at, '#text'))
      if (!y) return { path: here(x, a), kind: 'missing', expected: show(x), found: null }
      if (!x) return { path: here(y, b), kind: 'unexpected', expected: null, found: show(y) }
      if (x.type === 'text' && y.type === 'text') {
        if (x.value !== y.value) return { path: here(x, a), kind: 'text', expected: x.value, found: y.value }
        continue
      }
      if (shapeOf(x) !== shapeOf(y)) {
        // One node short or one too many, rather than every later sibling shifted.
        if (shapeOf(y) === shapeOf(a.children[i + 1])) return { path: here(x, a), kind: 'missing', expected: show(x), found: null }
        if (shapeOf(x) === shapeOf(b.children[i + 1])) return { path: here(y, b), kind: 'unexpected', expected: null, found: show(y) }
        // The same element with other classes reads as its class attribute differing.
        if (x.type !== 'element' || y.type !== 'element' || x.name !== y.name) return { path: here(x, a), kind: 'element', expected: show(x), found: show(y) }
      }
      const found = walk(x, y, here(x, a))
      if (found) return found
    }
    return null
  }
  const found = walk(parse(expected), parse(actual), '')
  if (found && expected === '') return { ...found, path: found.path || '(top)', note: 'the case renders nothing, and the adapter wrote HTML' }
  // The trees agree but the canonical strings do not: report the strings rather than claim a match.
  return found ?? { path: '(top)', kind: 'text', expected, found: actual }
}

// ── The contract ──────────────────────────────────────────────────────────────────────────────

/* Keys of a markup file that describe rather than draw (as check_salt_stylesheets.mjs reads them):
   a platform's former markup, a rule, a note, a hook's record, an omitted class. */
const NOT_ELEMENTS = new Set(['platforms', 'rules', 'notes', 'hooks', 'omitted'])

/** Every class an element in contract/markup carries. */
export function markupClasses(dir = packageDir) {
  const classes = new Set()
  const collect = (node) => {
    if (Array.isArray(node)) { node.forEach(collect); return }
    if (!node || typeof node !== 'object') return
    for (const [key, value] of Object.entries(node)) {
      if (NOT_ELEMENTS.has(key)) continue
      if (key === 'classes' && Array.isArray(value)) value.forEach((name) => classes.add(name))
      else collect(value)
    }
  }
  const markupDir = path.join(dir, 'contract', 'markup')
  for (const f of readdirSync(markupDir).filter((f) => f.endsWith('.json')).sort()) collect(readJson(path.join(markupDir, f)))
  return classes
}

function casesOf(dir, section) {
  const sdir = path.join(dir, 'fixtures', section)
  if (!existsSync(sdir)) return []
  return readdirSync(sdir).filter((f) => f.endsWith('.json')).sort().map((f) => {
    const name = f.slice(0, -'.json'.length)
    return { name, input: readFileSync(path.join(sdir, f), 'utf8'), html: readFileSync(path.join(sdir, `${name}.html`), 'utf8') }
  })
}

// The section a field problem is about, from its path; null for one about the whole snapshot.
const SECTION_OF = {
  payload: /^blocks\[([^\]]+)\]/,
  acf: /^groups\[group_salt_sections\]\.fields\[sections\]\.layouts\[([^\]]+)\]/,
}

function checkFields(fields) {
  const text = readFileSync(fields.snapshot, 'utf8')
  const options = fields.options ? readJson(fields.options) : {}
  const check = fields.platform === 'payload' ? checkPayloadSnapshot : checkAcfSnapshot
  const { problems } = check(text, options)
  const bySection = new Map()
  const whole = []
  for (const p of problems) {
    const id = SECTION_OF[fields.platform].exec(p)?.[1]
    if (id) bySection.set(id, [...(bySection.get(id) ?? []), p])
    else whole.push(p)
  }
  return { platform: fields.platform, snapshot: fields.snapshot, options: fields.options ?? null, problems: whole, bySection }
}

function checkStyles(styles, version, dir) {
  if (styles.version !== undefined) {
    const ok = styles.version === version
    return { mode: 'version', pin: styles.version, contract: version, ok, files: [] }
  }
  const styleDir = path.join(dir, 'styles')
  const files = readdirSync(styleDir).filter((f) => f.endsWith('.css')).sort().map((file) => {
    const theirs = path.join(styles.dir, file)
    if (!existsSync(theirs)) return { file, status: 'missing' }
    const a = readFileSync(path.join(styleDir, file))
    const b = readFileSync(theirs)
    if (a.equals(b)) return { file, status: 'identical' }
    let at = 0
    while (at < a.length && at < b.length && a[at] === b[at]) at++
    return { file, status: 'differs', firstDifferingByte: at }
  })
  return { mode: 'files', dir: styles.dir, contract: version, ok: files.every((f) => f.status === 'identical'), files }
}

async function pool(items, jobs, work) {
  const results = new Array(items.length)
  let next = 0
  const worker = async () => { while (next < items.length) { const i = next++; results[i] = await work(items[i]) } }
  await Promise.all(Array.from({ length: Math.min(jobs, items.length) }, worker))
  return results
}

// ── The run ───────────────────────────────────────────────────────────────────────────────────

/**
 * Run every check and return the report (the JSON written as conformance.json). Options are what
 * parseConformanceArguments returns: { platform, adapter: { command } | { endpoint }, fields?,
 * styles?, sections?, notShipped?, implementationVersion?, jobs?, timeout? }, plus `dir`, the
 * contract package to run (this one), for tests.
 */
export async function runConformance(options) {
  const dir = options.dir ?? packageDir
  const pkg = readJson(path.join(dir, 'package.json'))
  const ids = readJson(path.join(dir, 'contract', 'sections.json')).sections.map((s) => s.id)
  for (const [flag, list] of [['--sections', options.sections], ['--not-shipped', options.notShipped]]) {
    for (const id of list ?? []) if (!ids.includes(id)) throw new Error(`${flag}: ${id} is not a section in contract/sections.json`)
  }
  if (options.sections && !options.partial) throw new Error('sections runs only some sections: a run of some is partial, so pass partial')
  const notShipped = new Set(options.notShipped ?? [])
  for (const id of options.sections ?? []) {
    if (notShipped.has(id)) throw new Error(`${id} is in --sections and --not-shipped; a section is run or not shipped, not both`)
  }
  const run = ids.filter((id) => (options.sections ? options.sections.includes(id) || notShipped.has(id) : true))
  const timeout = options.timeout ?? 60000
  const jobs = options.jobs ?? availableParallelism()
  const vocabulary = markupClasses(dir)
  const fields = options.fields ? checkFields(options.fields) : null
  const styles = options.styles ? checkStyles(options.styles, pkg.version, dir) : null
  const render = options.adapter.command
    ? (input) => runCommand(options.adapter.command, input, timeout)
    : (input) => runEndpoint(options.adapter.endpoint, input, timeout)

  const tasks = run.filter((id) => !notShipped.has(id)).flatMap((section) => casesOf(dir, section).map((c) => ({ section, ...c })))
  const outcomes = await pool(tasks, jobs, async (t) => ({ ...t, result: await render(t.input) }))

  const sections = run.map((id) => {
    if (notShipped.has(id)) return { id, status: 'not shipped' }
    const mine = outcomes.filter((o) => o.section === id)
    const failures = []
    const unknown = new Map()
    for (const o of mine) {
      if (o.result.error) { failures.push({ case: o.name, kind: 'adapter', error: o.result.error, stderr: o.result.stderr }); continue }
      const difference = firstDifference(o.html, o.result.html)
      if (difference) { const { kind, ...rest } = difference; failures.push({ case: o.name, kind: 'mismatch', difference: kind, ...rest }) }
      const { actual } = compare('', o.result.html)
      for (const m of actual.matchAll(/ class="([^"]*)"/g)) {
        for (const c of m[1].split(' ')) {
          if (c.startsWith('salt-') && !vocabulary.has(c)) unknown.set(c, [...new Set([...(unknown.get(c) ?? []), o.name])])
        }
      }
    }
    const fixtures = { total: mine.length, passed: mine.length - failures.length, failed: failures.length, failures }
    const classes = { status: unknown.size ? 'fail' : 'pass', unknown: [...unknown].sort().map(([name, cases]) => ({ class: name, cases })) }
    const own = fields?.bySection.get(id) ?? []
    const fieldParity = fields ? { status: own.length || fields.problems.length ? 'fail' : 'pass', problems: own } : { status: 'not run', problems: [] }
    const stylesheets = { status: styles ? (styles.ok ? 'pass' : 'fail') : 'not run' }
    // A section with no fixture case cannot be shown to conform.
    const fixturesOk = fixtures.total > 0 && fixtures.failed === 0
    const checks = [fixturesOk ? 'pass' : 'fail', classes.status, fieldParity.status, stylesheets.status]
    // Every check that ran passed, but not all four ran: not a pass (SC-017).
    const status = checks.includes('fail') ? 'fail' : checks.includes('not run') ? 'incomplete' : 'pass'
    return { id, status, fixtures, fields: fieldParity, classes, stylesheets }
  })

  const count = (status) => sections.filter((s) => s.status === status).length
  return {
    format: REPORT_FORMAT,
    contract: { package: pkg.name, version: pkg.version },
    platform: options.platform,
    implementation: { version: options.implementationVersion ?? null },
    adapter: options.adapter.command ? { kind: 'command', target: options.adapter.command } : { kind: 'endpoint', target: options.adapter.endpoint },
    ok: !options.partial && count('fail') === 0 && count('incomplete') === 0 && !(fields?.problems.length) && styles?.ok !== false,
    partial: Boolean(options.partial),
    summary: { pass: count('pass'), fail: count('fail'), incomplete: count('incomplete'), notShipped: count('not shipped') },
    fields: fields ? { platform: fields.platform, snapshot: fields.snapshot, options: fields.options, problems: fields.problems } : null,
    stylesheets: styles,
    sections,
  }
}

// ── The Markdown report ───────────────────────────────────────────────────────────────────────

const code = (v) => (v === null ? 'nothing' : `\`${String(v).replace(/`/g, 'ˋ').replace(/\n/g, '⏎')}\``)
const cell = (v) => String(v).replace(/\|/g, '\\|')

function describeFailure(f) {
  if (f.kind === 'adapter') return `${f.error}${f.stderr ? `; stderr: ${code(f.stderr.trim())}` : ''}`
  const where = `at ${code(f.path)}`
  const note = f.note ? ` (${f.note})` : ''
  switch (f.difference) {
    case 'attribute': return `attribute ${code(f.name)} ${where}: expected ${code(f.expected)}, found ${code(f.found)}`
    case 'text': return `text ${where}: expected ${code(f.expected)}, found ${code(f.found)}`
    case 'missing': return `missing ${where}: expected ${code(f.expected)}, found nothing`
    case 'unexpected': return `unexpected ${where}: expected nothing, found ${code(f.found)}${note}`
    default: return `element ${where}: expected ${code(f.expected)}, found ${code(f.found)}`
  }
}

/** The report as Markdown, for a person reading CI's output. */
export function renderMarkdown(report) {
  const lines = []
  const impl = report.implementation.version ? ` ${report.implementation.version}` : ''
  lines.push(`# Salt conformance: ${report.platform}${impl} against ${report.contract.package} ${report.contract.version}`, '')
  const { pass, fail, incomplete, notShipped } = report.summary
  const verdict = report.partial ? 'Partial, not conforming' : report.ok ? 'Pass' : 'Fail'
  lines.push(`**${verdict}.** ${pass} section(s) pass, ${fail} fail, ${incomplete} incomplete, ${notShipped} not shipped. ` +
    `Adapter: ${report.adapter.kind} ${code(report.adapter.target)}.`, '')
  lines.push('| Section | Fixtures | Field parity | Classes | Stylesheet pin |', '| --- | --- | --- | --- | --- |')
  for (const s of report.sections) {
    if (s.status === 'not shipped') { lines.push(`| ${s.id} | not shipped | not shipped | not shipped | not shipped |`); continue }
    const classes = s.classes.status === 'pass' ? 'pass' : `${s.classes.unknown.length} unknown`
    const fields = s.fields.status === 'fail' ? `fail (${s.fields.problems.length})` : s.fields.status
    lines.push(`| ${s.id} | ${s.fixtures.passed}/${s.fixtures.total} | ${fields} | ${classes} | ${s.stylesheets.status} |`)
  }
  lines.push('')
  const st = report.stylesheets
  lines.push('## Stylesheet pin', '')
  if (!st) lines.push('Not run, so no section conforms (SC-017): pass `--styles <dir>` or `--styles-version <version>`.')
  else if (st.mode === 'version') lines.push(`${st.ok ? 'Pass' : 'Fail'}: the implementation re-exports the stylesheets of version ${code(st.pin)}; this contract is ${code(st.contract)}.`)
  else {
    lines.push(`${st.ok ? 'Pass' : 'Fail'}: ${code(st.dir)} against this contract's \`styles/\` (${st.contract}).`, '')
    for (const f of st.files) lines.push(`- ${f.file}: ${f.status}${f.status === 'differs' ? ` from byte ${f.firstDifferingByte}` : ''}`)
  }
  lines.push('', '## Field parity', '')
  if (!report.fields) lines.push('Not run, so no section conforms (SC-017): pass `--payload-snapshot <file>` or `--acf-snapshot <file>`.')
  else {
    lines.push(`${report.fields.platform} snapshot ${code(report.fields.snapshot)}${report.fields.options ? ` with options ${code(report.fields.options)}` : ''}.`)
    for (const p of report.fields.problems) lines.push(`- ${cell(p)}`)
  }
  const failing = report.sections.filter((s) => s.status === 'fail')
  if (failing.length) lines.push('', '## Failures')
  for (const s of failing) {
    lines.push('', `### ${s.id}`, '')
    if (s.fixtures.total === 0) lines.push('- no fixture cases: the section cannot be shown to conform')
    for (const f of s.fixtures.failures) lines.push(`- \`${s.id}/${f.case}\`: ${describeFailure(f)}`)
    for (const u of s.classes.unknown) lines.push(`- class ${code(u.class)} is on no element in contract/markup (cases: ${u.cases.join(', ')})`)
    for (const p of s.fields.problems) lines.push(`- fields: ${p}`)
  }
  return `${lines.join('\n')}\n`
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────

const USAGE = `usage: conformance.mjs --platform <name> (--adapter <command> | --endpoint <url>)
  [--payload-snapshot <file> | --acf-snapshot <file>] [--fields-options <options.json>]
  [--styles <dir> | --styles-version <version>] [--sections <id,…>] [--not-shipped <id,…>]
  [--implementation-version <version>] [--out <dir>] [--jobs <n>] [--timeout <ms>] [--partial]`

if (isMainModule(import.meta.url)) {
  let options
  let report
  try {
    options = parseConformanceArguments(process.argv.slice(2))
    report = await runConformance(options)
  } catch (e) {
    console.error(`✗ ${e.message}`)
    console.error(USAGE)
    process.exit(2)
  }
  const markdown = renderMarkdown(report)
  if (options.out) {
    mkdirSync(options.out, { recursive: true })
    writeFileSync(path.join(options.out, 'conformance.json'), `${JSON.stringify(report, null, 2)}\n`)
    writeFileSync(path.join(options.out, 'conformance.md'), markdown)
  }
  process.stdout.write(markdown)
  process.exit(report.ok ? 0 : 1)
}
