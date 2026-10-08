// @lightlysaltedhq/design-foundations/type-tokens — the contract's typography rule as code. A type
// scale derived from its inputs, a product's own table read and checked, and a product's
// typography declaration resolved to its text-role tokens, from contract/type-scale.json and
// contract/vocabulary.json alone. It is the ONE implementation anything builds with: emit.py runs it
// (through scripts/type_tokens_cli.mjs) for the design system's own themes, and salt-core imports it.
//
// It imports nothing, Node built-ins included, and reads no argv, so it runs in Node 22 or later,
// a browser, an edge runtime or any bundle (`npm run verify:type-tokens-bundle` bundles it with
// esbuild for --platform=neutral).
//
// Usage, with the contract's JSON exports alongside, is in type_tokens.d.mts and the package README.
// The pack gate fails this file on any word that would load a module or touch a runtime global
// (the list is in check_foundations_pack.sh), comments included.
//
// THE PUBLIC API, all of it: eight names. scripts/type_tokens.d.mts declares each, and
// check_type_scale.py holds the declarations to what the functions actually return. Every value
// returned is plain JSON (strings, numbers, booleans, arrays, objects); no BigInt crosses the API.
//
//   derive(typeScale, inputs) -> Table
//       A scale derived from its inputs (a named scale's entry in typeScale.namedScales, say).
//   parseTable(typeScale, families) -> Table
//       A product's own table, given in contract/scale-shape.json's type families, read and checked.
//   Table = { viewports: [minPx, maxPx] | null, steps: { [stepName]: Step } }
//       Step = { kind: 'fluid', minRem, preferredRem, preferredVw, maxRem } | { kind: 'fixed', sizeRem }
//       Each number is a decimal string in the contract's notation ('1.2', never 1.2 or '1.20').
//       viewports is null only for an all-fixed table, which owes none.
//   cssOf(typeScale, step) -> string
//       The value a consumer writes for --step-<name>: 'clamp(1.2rem, 1.1156rem + 0.3749vw, 1.4062rem)'.
//   stepFamilies(typeScale, table) -> { typeScaleFixed?, typeScaleFluid?, typeScaleViewports? }
//       The table in contract/scale-shape.json's type families, which the scale shape's own
//       implementation turns into --step-* tokens.
//   neutralRungFamilies(typeScale) -> { leading, tracking, weight }
//       The neutral rungs in the scale shape's families: tracking in em, the others as numbers.
//   resolve(vocabulary, typeScale, scaleShape, declaration, product) -> { roles, tokens, table }
//       product = { scale, fontRoles, colourRoles }. roles: { [role]: { step, leading, tracking,
//       weight, font } }, font resolved through the fallback chain. tokens: every text-role token,
//       { id, css, type, value, role, property, overridden }, in emitted order. table: the Table
//       the roles were checked against.
//   Refused (an Error) with `codes`, the contract's names for every rule an input breaks.
//   ContractError (an Error): the contract asks for a rule this implementation does not run.
//
// A VERSIONED API: these names, their arguments and their results are the package's public
// surface, so changing one is a major release (CHANGELOG.md, Versioning). A design-system ruling of
// 25/09/2026 made this the one implementation, after a scale-shape gate that kept a Python emitter
// and a JavaScript consumer equal through probes failed review four rounds running.
// scripts/type_scale.py is kept only as an independent check that contract/type-vectors.json is
// right; nothing builds through it.
//
// EVERY RULE IS READ. The operations, their order, the rounding mode and its operand, and the
// notation are fields in the contract; this implements the values they have today and throws
// ContractError on any other. Invariants are evaluated on exact decimals, never on Numbers.
//
// `scaleShape` is contract/scale-shape.json's document, or anything with the same
// `families.<family>.steps` for the type steps and the leading, tracking and weight rungs.

export class ContractError extends Error {}
export class Refused extends Error {
  constructor(codes, detail = '') {
    const sorted = [...new Set(codes)].sort()
    super(sorted.join(', ') + (detail ? `: ${detail}` : ''))
    this.codes = sorted
  }
}

// ── exact decimals: value = n x 10^e ──────────────────────────────────────────────────────────────
const DECIMAL = /^(-?)([0-9]+)(?:\.([0-9]+))?(?:e([+-]?[0-9]+))?$/i
function dec(text) {
  const m = DECIMAL.exec(String(text))
  if (!m) throw new ContractError(`${text} is not a decimal`)
  const frac = m[3] ?? ''
  const n = BigInt(m[2] + frac)
  return { n: m[1] === '-' ? -n : n, e: -frac.length + Number(m[4] ?? 0) }
}
// A JSON number as the decimal it was written as: String() gives the shortest round trip.
const decOf = (x) => dec(String(x))
function align(a, b) {
  const e = Math.min(a.e, b.e)
  return [a.n * 10n ** BigInt(a.e - e), b.n * 10n ** BigInt(b.e - e), e]
}
const add = (a, b) => { const [x, y, e] = align(a, b); return { n: x + y, e } }
const sub = (a, b) => { const [x, y, e] = align(a, b); return { n: x - y, e } }
const mul = (a, b) => ({ n: a.n * b.n, e: a.e + b.e })
const shift = (a, k) => ({ n: a.n, e: a.e + k })          // a x 10^k, exact
const cmp = (a, b) => { const [x, y] = align(a, b); return x < y ? -1 : x > y ? 1 : 0 }
const abs = (a) => ({ n: a.n < 0n ? -a.n : a.n, e: a.e })

function written(d, notation = 'plain') {
  if (notation !== 'plain') throw new ContractError(`notation ${notation} is not one this consumer writes`)
  let { n, e } = d
  const neg = n < 0n
  if (neg) n = -n
  while (n !== 0n && e < 0 && n % 10n === 0n) { n /= 10n; e += 1 }
  let s = n.toString()
  if (e >= 0) s += '0'.repeat(e)
  else {
    s = s.padStart(-e + 1, '0')
    s = `${s.slice(0, e)}.${s.slice(e)}`
  }
  return neg && n !== 0n ? `-${s}` : s
}

// ── rounding the exact value of a binary64 ───────────────────────────────────────────────────────
// A double's exact value, from its bits: sign, a 53-bit integer and a power of two. `toFixed` would
// round an exact tie upwards, and `Math.round(x * 1e4)` would round a second, binary product.
function exactBinary(x) {
  if (!Number.isFinite(x)) throw new ContractError(`${x} is not finite`)
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, x)
  const bits = view.getBigUint64(0)
  const biased = Number((bits >> 52n) % 2048n)                 // the 11 exponent bits
  let mant = bits % (1n << 52n)                                // the 52 fraction bits
  let exp2 = -1074
  if (biased !== 0) { mant += 1n << 52n; exp2 = biased - 1075 }
  return { neg: bits >> 63n === 1n, mant, exp2 }
}

function rounded(x, rule) {
  if (rule.rounding !== 'halfEven' || rule.of !== 'exactBinary64')
    throw new ContractError(`rounding ${JSON.stringify(rule)} is not one this consumer runs`)
  const places = rule.decimalPlaces
  if (!Number.isInteger(places) || places < 0) throw new ContractError(`decimalPlaces ${places}`)
  const { neg, mant, exp2 } = exactBinary(x)
  let num = mant * 10n ** BigInt(places)
  let den = 1n
  if (exp2 >= 0) num <<= BigInt(exp2)
  else den <<= BigInt(-exp2)
  let q = num / den
  const r = num % den
  if (r * 2n > den || (r * 2n === den && q % 2n === 1n)) q += 1n        // a tie goes to the even digit
  return { n: neg ? -q : q, e: -places }
}

// ── derivation ────────────────────────────────────────────────────────────────────────────────────
const OPS = { multiply: (a, b) => a * b, divide: (a, b) => a / b, subtract: (a, b) => a - b }
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v)
const isAscii = (s) => /^[\x00-\x7f]*$/.test(s)
const stepNameOk = (ts, name) => typeof name === 'string' && isAscii(name) && new RegExp(ts.steps.pattern).test(name)

function preferred(rule, env) {
  const p = rule.preferred
  if (p.from !== 'roundedBounds') throw new ContractError(`preferred.from ${p.from} is not one this consumer runs`)
  const vars = { ...env }
  for (const [name, value] of Object.entries(p.constants)) vars[name] = value
  for (const [result, op, left, right] of p.ops) {
    if (!(op in OPS)) throw new ContractError(`preferred op ${op} is not one this consumer runs`)
    vars[result] = OPS[op](vars[left], vars[right])
  }
  return p.round.map((name) => rounded(vars[name], rule.round))
}

function checkInputs(ts, inputs) {
  const spec = ts.inputs
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) throw new Refused(['inputs'])
  for (const key of spec.numbers) if (!isNumber(inputs[key])) throw new Refused(['inputs'], `${key}`)
  for (const key of spec.integers) if (!Number.isInteger(inputs[key])) throw new Refused(['inputs'], `${key}`)
  for (const key of spec.lists) {
    const v = inputs[key]
    if (!Array.isArray(v) || v.length === 0 || !v.every((s) => typeof s === 'string')) throw new Refused(['inputs'], key)
  }
  const bad = inputs.steps.filter((s) => !stepNameOk(ts, s))
  if (bad.length) throw new Refused(['T2'], JSON.stringify(bad))
  return inputs.steps.map((s) => Number.parseInt(s, 10))
}

function deriveExact(ts, inputs) {
  const rule = ts.derivation
  if (rule.arithmetic !== 'binary64') throw new ContractError(`arithmetic ${rule.arithmetic}`)
  if (rule.repeat !== 'stepDistance') throw new ContractError(`repeat ${rule.repeat}`)
  if (rule.fixed.size !== 'min') throw new ContractError(`fixed.size ${rule.fixed.size}`)
  const numbers = checkInputs(ts, inputs)
  const fluidFrom = inputs[rule.fixed.below]
  const steps = {}
  inputs.steps.forEach((name, i) => {
    const n = numbers[i]
    const side = n > 0 ? rule.above : rule.below
    if (side.op !== 'multiply' && side.op !== 'divide') throw new ContractError(`step op ${side.op}`)
    const bound = {}
    for (const end of ['min', 'max']) {
      let v = inputs[rule.base[end]]
      const ratio = inputs[side.by[end]]
      for (let k = 0; k < Math.abs(n); k++) v = OPS[side.op](v, ratio)       // never Math.pow
      bound[end] = rounded(v, rule.round)
    }
    if (n < fluidFrom) { steps[name] = { kind: 'fixed', sizeRem: bound.min }; return }
    const env = Object.fromEntries(ts.inputs.numbers.map((k) => [k, inputs[k]]))
    env.minRem = Number(written(bound.min))
    env.maxRem = Number(written(bound.max))
    const [preferredRem, preferredVw] = preferred(rule, env)
    steps[name] = { kind: 'fluid', minRem: bound.min, preferredRem, preferredVw, maxRem: bound.max }
  })
  // A name given twice is one entry in `steps`, so the duplicate is recorded where T1 can see it.
  const table = { viewports: [decOf(inputs.viewportMinPx), decOf(inputs.viewportMaxPx)], steps,
    repeated: new Set(inputs.steps).size !== inputs.steps.length }
  const codes = tableFailures(ts, table)
  if (codes.length) throw new Refused(codes)
  return table
}

// ── a product's own table ────────────────────────────────────────────────────────────────────────
function strip(ts, s) {
  const ws = ts.table.whitespace
  let a = 0
  let b = s.length
  while (a < b && ws.includes(s[a])) a++
  while (b > a && ws.includes(s[b - 1])) b--
  return s.slice(a, b)
}
function rem(ts, s) {
  if (typeof s !== 'string') return null
  const t = strip(ts, s)
  return new RegExp(ts.table.rem).test(t) ? dec(t.slice(0, -3)) : null
}

function parseExact(ts, families) {
  const [fFixed, fFluid, fVps] = ts.table.families
  const fixed = families[fFixed] ?? {}
  const fluid = families[fFluid] ?? {}
  const vps = families[fVps]
  const isMap = (o) => o && typeof o === 'object' && !Array.isArray(o)
  if (!isMap(fixed) || !isMap(fluid)) throw new Refused(['T3'])
  const strings = (v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : [])
  const names = [...Object.keys(fixed), ...Object.keys(fluid)]
  const values = [...Object.values(fixed), ...Object.values(fluid), vps].flatMap(strings)
  if (!names.every((n) => stepNameOk(ts, n)) || !values.every(isAscii)) throw new Refused(['T2'])

  let viewports = null
  if (Array.isArray(vps) && vps.length === 2 && vps.every((v) => typeof v === 'string' &&
      new RegExp(ts.table.viewport).test(strip(ts, v))))
    viewports = vps.map((v) => dec(strip(ts, v).slice(0, -2)))
  const steps = {}
  for (const name of new Set(names)) {
    if (name in fixed && name in fluid) steps[name] = { kind: 'both' }
    else if (name in fixed) {
      const size = rem(ts, fixed[name])
      steps[name] = size ? { kind: 'fixed', sizeRem: size } : { kind: 'unreadable' }
    } else {
      const rung = fluid[name]
      const ok = Array.isArray(rung) && rung.length === 3 && rung.every((v) => typeof v === 'string')
      const lo = ok ? rem(ts, rung[0]) : null
      const hi = ok ? rem(ts, rung[2]) : null
      const m = ok ? new RegExp(ts.table.preferred).exec(strip(ts, rung[1])) : null
      steps[name] = lo && hi && m
        ? { kind: 'fluid', minRem: lo, preferredRem: dec(m[1]), preferredVw: dec(m[3]), maxRem: hi }
        : { kind: 'unreadable' }
    }
  }
  const table = { viewports, steps }
  const codes = tableFailures(ts, table)
  if (codes.length) throw new Refused(codes)
  return table
}

// ── T1 to T7 ─────────────────────────────────────────────────────────────────────────────────────
function tableFailures(ts, table) {
  const inv = ts.invariants
  const root = decOf(ts.units.rootPx)
  const steps = table.steps
  const codes = new Set()
  const entries = Object.entries(steps)
  const numbers = Object.keys(steps).map((n) => Number.parseInt(n, 10)).sort((a, b) => a - b)
  const contiguous = numbers.every((n, i) => n === numbers[0] + i)
  if (table.repeated || entries.some(([, e]) => e.kind === 'both') || !numbers.includes(0) || !contiguous) codes.add('T1')
  const vps = table.viewports
  const vpsOk = vps !== null && cmp(vps[0], { n: 0n, e: 0 }) > 0 && cmp(vps[0], vps[1]) < 0
  const readable = Object.fromEntries(entries.filter(([, e]) => e.kind === 'fixed' || e.kind === 'fluid'))
  const nonBoth = entries.filter(([, e]) => e.kind !== 'both').length
  // Viewports are owed only by a table that has a fluid step: an all-fixed table has nothing to
  // interpolate, and contract/scale-shape.json refuses viewports without a fluid step.
  const needsVps = entries.some(([, e]) => e.kind === 'fluid')
  if ((needsVps && !vpsOk) || Object.keys(readable).length !== nonBoth) codes.add('T3')
  const zero = { n: 0n, e: 0 }
  for (const e of Object.values(readable)) {
    const bounds = e.kind === 'fixed' ? [e.sizeRem] : [e.minRem, e.maxRem]
    if (bounds.some((b) => cmp(b, zero) <= 0)) codes.add('T3')
  }
  const tol = decOf(inv.T4.tolerancePx)
  for (const e of Object.values(readable)) {
    if (e.kind !== 'fluid') continue
    if (vpsOk) {
      for (const [vp, want] of [[vps[0], e.minRem], [vps[1], e.maxRem]]) {
        const got = add(mul(e.preferredRem, root), shift(mul(e.preferredVw, vp), -2))
        if (cmp(abs(sub(got, mul(want, root))), tol) > 0) codes.add('T4')
      }
    }
    if (cmp(mul(sub(e.maxRem, e.minRem), root), decOf(inv.T6.minMovePx)) < 0) codes.add('T6')
    if (cmp(e.maxRem, mul(decOf(inv.T7.maxOverMin), e.minRem)) > 0) codes.add('T7')
  }
  if (!codes.has('T1') && Object.keys(readable).length === entries.length) {
    const order = Object.keys(readable).sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
    for (const i of [0, 1]) {
      const size = (n) => (readable[n].kind === 'fixed' ? readable[n].sizeRem : readable[n][i === 0 ? 'minRem' : 'maxRem'])
      for (let k = 1; k < order.length; k++)
        if (cmp(mul(sub(size(order[k]), size(order[k - 1])), root), decOf(inv.T5.minGapPx)) < 0) codes.add('T5')
    }
  }
  return [...codes].sort()
}

const byNumber = (a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10)

// The public form of a table: every exact decimal written in the contract's notation.
function publicTable(ts, table) {
  const steps = {}
  for (const name of Object.keys(table.steps).sort(byNumber)) {
    const e = table.steps[name]
    steps[name] = { kind: e.kind, ...Object.fromEntries(ts.output[e.kind].map((f) => [f, written(e[f], ts.derivation.notation)])) }
  }
  return { viewports: table.viewports ? table.viewports.map((v) => written(v)) : null, steps }
}

export function derive(ts, inputs) {
  return publicTable(ts, deriveExact(ts, inputs))
}

export function parseTable(ts, families) {
  return publicTable(ts, parseExact(ts, families))
}

export function cssOf(ts, step) {
  let text = ts.output.css[step.kind]
  for (const field of ts.output[step.kind]) text = text.replace(`{${field}}`, step[field])
  return text
}

// A table in contract/scale-shape.json's type families, which is how a consumer writes its
// `--step-*` rungs (scripts/scale_tokens.mjs takes exactly this) and how a product's own table is read.
export function stepFamilies(ts, table) {
  const [fFixed, fFluid, fVps] = ts.table.families
  const out = {}
  for (const name of Object.keys(table.steps).sort(byNumber)) {
    const e = table.steps[name]
    if (e.kind === 'fixed') (out[fFixed] ??= {})[name] = `${e.sizeRem}rem`
    else (out[fFluid] ??= {})[name] = [`${e.minRem}rem`, `${e.preferredRem}rem + ${e.preferredVw}vw`, `${e.maxRem}rem`]
  }
  if (out[fFluid]) out[fVps] = table.viewports.map((v) => `${v}px`)
  return out
}

// The neutral rungs (contract/type-scale.json#rungDefaults) in contract/scale-shape.json's families,
// for a product that declares none of its own: tracking is written in em, the others as numbers.
export function neutralRungFamilies(ts) {
  const out = {}
  for (const [key, fam] of Object.entries(ts.rungFamilies)) {
    out[fam] = Object.fromEntries(Object.entries(ts.rungDefaults[key]).map(([rung, v]) =>
      [rung, key === 'trackingEm' ? `${written(decOf(v))}em` : v]))
  }
  return out
}

// ── text roles: a product's declaration, resolved ──────────────────────────────────────────────────
function colourNames(vocab) {
  const cr = vocab.colorRoles
  const statuses = cr.status.required
  const ids = [...cr.required.map((r) => r.id), ...statuses]
  const walk = (o) => {
    if (Array.isArray(o)) o.forEach(walk)
    else if (o && typeof o === 'object') {
      if (typeof o.id === 'string') ids.push(o.id)
      for (const [k, v] of Object.entries(o)) if (!k.startsWith('$')) walk(v)
    }
  }
  walk(cr.extended)
  const out = ids.flatMap((i) => (i.startsWith('<status>') ? statuses.map((s) => i.replace('<status>', s)) : [i]))
  return [...new Set(out.map((n) => n.replaceAll('.', '-')))].sort()
}

const reasonOk = (r) => typeof r === 'string' && [...r].some((c) => !' \t\n\r\f'.includes(c))
const own = (o) => Object.keys(o).filter((k) => !k.startsWith('$'))
const customOk = (v) => v && typeof v === 'object' && !Array.isArray(v) && v.custom === true &&
  own(v).every((k) => k === 'custom' || k === 'reason')

function neutralValue(fam, v) {
  if (fam === 'tracking') {
    const m = typeof v === 'string' ? /^(-?[0-9]+(?:\.[0-9]+)?)em$/.exec(v) : null
    return m ? dec(m[1]) : null
  }
  return isNumber(v) ? decOf(v) : null
}

export function resolve(vocab, ts, shape, declaration, product) {
  const TR = vocab.textRoles
  const D = ts.declaration
  const rdef = ts.rungDefaults
  const famKey = Object.fromEntries(Object.entries(ts.rungFamilies).map(([key, fam]) => [fam, key]))
  const required = TR.required.map((r) => r.id)
  const optional = TR.optional.map((r) => r.id)
  const defaults = Object.fromEntries([...TR.required, ...TR.optional].map((r) => [r.id, r.defaults]))
  const scale = product.scale ?? {}
  const typeFams = ts.table.families
  const isMap = (o) => o && typeof o === 'object' && !Array.isArray(o)

  // ── stage 1: the declaration itself ──
  const codes = []
  if (!isMap(declaration)) throw new Refused(['shape'])
  if (own(declaration).some((k) => !D.keys.includes(k))) codes.push('shape')
  const sc = declaration.scale
  let form = null
  const sk = isMap(sc) ? own(sc).sort() : null
  if (sk && sk.length === 1 && sk[0] === 'named' && ts.namedScales.order.includes(sc.named)) form = 'named'
  else if (sk && (sk.join() === 'custom' || sk.join() === 'custom,reason') && sc.custom === true) {
    form = 'custom'
    if (!reasonOk(sc.reason)) codes.push('reason')
  } else codes.push('shape')
  const carried = typeFams.filter((f) => f in scale)
  if (form === 'named' && carried.length) codes.push('table')
  if (form === 'custom') {
    const names = new Set([...Object.keys(scale[typeFams[0]] ?? {}), ...Object.keys(scale[typeFams[1]] ?? {})])
    const ladder = shape.families[typeFams[1]].steps
    if (names.size !== ladder.length || !ladder.every((n) => names.has(n))) codes.push('table')
  }
  let rungs = declaration.rungs ?? {}
  const custom = new Set()
  if (!isMap(rungs)) { codes.push('shape'); rungs = {} }
  for (const [fam, v] of Object.entries(rungs)) {
    if (fam.startsWith('$')) continue
    if (!D.rungs.families.includes(fam) || !customOk(v)) { codes.push('shape'); continue }
    custom.add(fam)
    if (!reasonOk(v.reason)) codes.push('reason')
    const values = scale[fam]
    if (D.rungs.overlays.includes(fam)) { if (!isMap(values) || !Object.keys(values).length) codes.push('partialFamily') }
    else if (!isMap(values) || shape.families[fam].steps.some((r) => !(r in values))) codes.push('partialFamily')
  }
  for (const [fam, key] of Object.entries(famKey)) {
    if (custom.has(fam) || !(fam in scale)) continue
    // No rung beyond the neutral ones either: a rung the contract has no number for is a value
    // somebody chose, and an overlay (weightDark) has no neutral numbers at all.
    const values = scale[fam]
    if (!isMap(values) || Object.keys(values).length !== Object.keys(rdef[key]).length ||
      Object.entries(rdef[key]).some(([rung, want]) => {
        if (!(rung in values)) return true
        const got = neutralValue(fam, values[rung])
        return got === null || cmp(got, decOf(want)) !== 0
      })) codes.push('undeclaredCustom')
  }
  for (const fam of D.rungs.overlays) {
    const v = scale[fam]
    if (!custom.has(fam) && v && (typeof v !== 'object' || Object.keys(v).length)) codes.push('undeclaredCustom')
  }
  let opt = declaration.optionalRoles ?? []
  if (!Array.isArray(opt) || !opt.every((o) => typeof o === 'string')) { codes.push('shape'); opt = [] }
  if (opt.some((o) => !optional.includes(o))) codes.push('unknownRole')
  if (new Set(opt).size !== opt.length) codes.push('shape')
  const overrides = declaration.overrides ?? []
  const fields = [...D.overrides.fields].sort().join()
  if (!Array.isArray(overrides) || !overrides.every((o) => isMap(o) && own(o).sort().join() === fields)) codes.push('shape')
  if (codes.length) throw new Refused(codes)

  // ── stage 2: the table ──
  let table
  if (form === 'named') {
    const named = ts.namedScales[sc.named]
    table = deriveExact(ts, Object.fromEntries([...ts.inputs.numbers, ...ts.inputs.lists].map((k) => [k, named[k]])))
  } else table = parseExact(ts, Object.fromEntries(typeFams.map((f) => [f, scale[f]])))

  // ── stage 3: the rung sets ──
  const rungSet = {}
  for (const [fam, key] of Object.entries(famKey)) rungSet[fam] = custom.has(fam) ? [...shape.families[fam].steps] : Object.keys(rdef[key])
  const typo = [...vocab.typographyRoles.required, ...vocab.typographyRoles.optional]
  const domain = { steps: Object.keys(table.steps), typographyRoles: typo.map((r) => r.id), ...rungSet }

  // ── stage 4: each override ──
  const emitted = [...required, ...optional.filter((o) => opt.includes(o))]
  const props = TR.properties
  const seen = []
  for (const o of overrides) {
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
    if (seen.some((s) => same(s, [o.role, o.property]))) codes.push('duplicate')
    seen.push([o.role, o.property])
    const structural = TR.structural.some((s) => same(s.role, o.role) && same(s.property, o.property))
    if (!TR.overridable.includes(o.property) || structural) codes.push('structural')
    else if (!emitted.includes(o.role)) codes.push('unknownRole')
    else if (typeof o.value !== 'string') codes.push('numeric')
    else if (!domain[props[o.property].domain].includes(o.value)) codes.push('unknownRung')
    else if (o.replaces !== defaults[o.role][o.property]) codes.push('stale')
    else if (o.value === o.replaces) codes.push('unchanged')
    else if (!reasonOk(o.reason)) codes.push('reason')
  }
  if (codes.length) throw new Refused(codes)

  // ── stage 5: the roles, and R1 to R6 on them ──
  const roles = Object.fromEntries(emitted.map((r) => [r, { ...defaults[r] }]))
  const changed = new Set()
  for (const o of overrides) { roles[o.role][o.property] = o.value; changed.add(`${o.role}\u0000${o.property}`) }
  const inv = TR.invariants
  if (roles[inv.R1.role][inv.R1.property] !== inv.R1.equals) codes.push('R1')
  const CMP = { '>': (a, b) => a > b, '>=': (a, b) => a >= b, '<': (a, b) => a < b, '<=': (a, b) => a <= b }
  for (const code of ['R2', 'R3']) {
    if (inv[code].compare !== 'step') throw new ContractError(`${code} compares ${inv[code].compare}`)
    for (const [a, op, b] of inv[code].pairs)
      if (!CMP[op](Number.parseInt(roles[a].step, 10), Number.parseInt(roles[b].step, 10))) codes.push(code)
  }
  const floor = decOf(ts[inv.R4.floor])
  const sizeAtMin = (e) => (e.kind === 'fixed' ? e.sizeRem : e.minRem)
  if (emitted.some((r) => cmp(sizeAtMin(table.steps[roles[r].step]), floor) < 0)) codes.push('R4')
  const fonts = new Set(product.fontRoles ?? [])
  const resolved = {}
  for (const r of emitted) {
    let f = roles[r].font
    let hops = 0
    while (f != null && !fonts.has(f) && hops <= Object.keys(TR.fontFallback).length) { f = TR.fontFallback[f]; hops++ }
    if (f == null || !fonts.has(f)) codes.push('R5')
    resolved[r] = f
  }
  const colours = new Set([...colourNames(vocab), ...(product.colourRoles ?? [])])
  if (emitted.some((r) => colours.has(r))) codes.push('R6')
  if (codes.length) throw new Refused(codes)

  // ── stage 6: the tokens ──
  const fontCss = Object.fromEntries(typo.map((r) => [r.id, r.css]))
  const tokens = []
  const outRoles = {}
  for (const r of emitted) {
    outRoles[r] = { ...roles[r], font: resolved[r] }
    for (const [prop, spec] of Object.entries(props)) {
      if (prop.startsWith('$')) continue
      const css = spec.css.replace('{role}', r)
      const value = prop === 'font' ? `var(${fontCss[resolved[r]]})` : `var(${spec.references.replace('{value}', roles[r][prop])})`
      tokens.push({ id: `typography.text.${css.slice('--text-'.length).replace('--', '.')}`, css, type: spec.type, value,
        role: r, property: prop, overridden: changed.has(`${r}\u0000${prop}`) })
    }
  }
  return { roles: outRoles, tokens, table: publicTable(ts, table) }
}
