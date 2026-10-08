// Every scale token, derived from contract/scale-shape.json and the values a scale supplies. The one
// implementation: emit.py builds its scale tokens by calling this, and any other implementation
// loads it rather than re-deriving the rules. Usage is in scale_tokens.d.mts; the command line is
// scale_tokens_cli.mjs, a separate file.
//
// This file has no module dependencies and touches no runtime global: the pack gate fails it on
// any occurrence of the words that would (the list is in check_foundations_pack.sh), comments
// included, so that a comment cannot hide one either.
//
// A VERSIONED API (the package's `./scale-tokens` export), so semver applies to everything below
// marked as the output. deriveScaleTokens returns the tokens in the order they are written: family
// order as the file lists it, then each family's rungs in the order its `steps` declare (never the
// order a scale's object happens to list its keys in; JavaScript puts "0" before "-1" regardless).
// Each token is:
//
//   property   the custom property, e.g. "--space-0-5"
//   family     the family that owns it
//   rung       the rung it was written for; absent for a scalar family's own property
//   constant   true for a property the family always writes with a fixed value (alsoEmits)
//   type       the family's token type        group   the family's group
//   value      the value: as supplied, filled into the family's valueTemplate, derived, or constant
//   dark       the dark-mode value, where a family that `sets` "dark" supplies one for this rung
//   expr       for a derived value, the same value as a CSS expression over the source property
//   px         for a family with `pxAt`, the rem value in whole pixels at that root size
//   <recordAs> for a family with slots, the supplied positions by name, plus any family's that
//              `sets` "record" on it (the type scale's is "fluid")
//
// It throws ScaleRefused for exactly what the contract forbids, and for a value in a shape no rule
// can read: a family or rung the file does not declare, a family without one it requires, a rung
// given to two exclusive families, a slotted value that is not a list of the right length, a rung
// value that is not a string or a number, a derived family that is not a list of distinct rungs, a
// derivation source that is not a length written as a number and its unit with no space between
// ("0.25rem", never 4, "0.25" or "0.25 rem"), and a `pxAt` value not in rem.
//
// No dependencies and no Node built-ins, so it runs in a browser, an edge runtime or any bundle,
// however the host was started. Arithmetic on derived values is exact decimal (BigInt), never binary floating
// point, so the rounding the file names is applied to the true product, whatever its length.

export class ScaleRefused extends Error {}

// A number and its unit, nothing around them and nothing between: "0.25rem". A bare number, a
// number with a space before its unit, or any padding is refused, not guessed at.
const DIMENSION = /^(-?\d+(?:\.\d+)?)([a-z%]+)$/

// A family counts as supplied when its value is present and not empty, the same test for every rule.
const supplied = (v) => !(v === undefined || v === null || v === '' || v === 0 || v === false ||
  (typeof v === 'object' && Object.keys(v).length === 0))

const isPlainValue = (v) => (typeof v === 'string' && v !== '') || (typeof v === 'number' && Number.isFinite(v))
const isMap = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

// ── exact decimal arithmetic ──────────────────────────────────────────────────────────────────────
// A decimal string is held as a BigInt of its digits and a power of ten.
function decimal(text) {
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(text)
  if (!m || (m[2] + (m[3] ?? '')) === '') throw new ScaleRefused(`${text} is not a number`)
  return { neg: m[1] === '-', n: BigInt((m[2] + (m[3] ?? '')) || '0'), e: -(m[3] ?? '').length }
}

function round({ neg, n, e }, digits, mode) {
  if (mode !== 'halfEven') throw new ScaleRefused(`rounding ${mode} is not one this consumer knows`)
  const length = n.toString().length
  if (n === 0n || length <= digits) return { neg, n, e }
  const p = 10n ** BigInt(length - digits)
  let q = n / p
  const r = n % p
  if (r * 2n > p || (r * 2n === p && q % 2n === 1n)) q += 1n     // a tie goes to the even digit
  return { neg, n: q, e: e + (length - digits) }
}

// Plain decimal, no trailing zeros. Zero is "0" whatever its sign or scale: a length of zero has no
// direction, and "-0" or "0.00" would be a second spelling of the same value.
function plain({ neg, n, e }, notation = 'plain') {
  if (notation !== 'plain') throw new ScaleRefused(`notation ${notation} is not one this consumer knows`)
  if (n === 0n) return '0'
  while (n % 10n === 0n) { n /= 10n; e += 1 }
  let s = n.toString()
  if (e >= 0) s += '0'.repeat(e)
  else {
    s = s.padStart(-e + 1, '0')
    s = `${s.slice(0, e)}.${s.slice(e)}`
  }
  return (neg ? '-' : '') + s
}

function length(fam, text, units) {
  const m = DIMENSION.exec(String(text))
  if (!m) throw new ScaleRefused(`${fam}: ${JSON.stringify(text)} is not a length: digits, an optional point with digits after it, then its unit, with no space`)
  if (!units.includes(m[2]))
    throw new ScaleRefused(`${fam}: ${JSON.stringify(text)} is in ${m[2]}, and the contract names only ${units.join(', ')} here`)
  return { number: decimal(m[1]), unit: m[2] }
}

// ── the derivation ────────────────────────────────────────────────────────────────────────────────
export function deriveScaleTokens(shape, scales) {
  const F = shape.families
  const rungsOf = (fam) => F[fam].steps ?? F[F[fam].stepsFrom].steps
  const given = (fam) => supplied(scales[fam])
  if (!isMap(scales)) throw new ScaleRefused('a scale is an object of families')

  // Every value in a shape some rule can read, before any rule reads it.
  const checkValue = (fam, where, v) => {
    const slots = F[fam].slots
    if (slots) {
      if (!Array.isArray(v) || v.length !== slots.length || !v.every(isPlainValue))
        throw new ScaleRefused(`${where} takes (${slots.join(', ')}), not ${JSON.stringify(v)}`)
    } else if (!isPlainValue(v)) {
      throw new ScaleRefused(`${where} must be a string or a number, not ${JSON.stringify(v)}`)
    }
  }
  for (const [fam, value] of Object.entries(scales)) {
    // Own properties only: `in` also finds Object.prototype, so "constructor" or "valueOf" passed
    // as a family name used to be taken for a declared family and crashed with a TypeError.
    if (!Object.hasOwn(F, fam)) throw new ScaleRefused(`unknown scale family ${fam}`)
    const spec = F[fam]
    if (!supplied(value)) continue
    if (spec.scalar) { checkValue(fam, fam, value); continue }
    if (spec.derive) {
      if (!Array.isArray(value) || !value.every((r) => typeof r === 'string') || new Set(value).size !== value.length)
        throw new ScaleRefused(`${fam} lists the rungs it uses, each once, not ${JSON.stringify(value)}`)
    } else if (!isMap(value)) {
      throw new ScaleRefused(`${fam} maps each rung to its value, not ${JSON.stringify(value)}`)
    }
    const names = Array.isArray(value) ? value : Object.keys(value)
    const bad = names.filter((r) => !rungsOf(fam).includes(r))
    if (bad.length) throw new ScaleRefused(`${fam} has rung(s) ${bad} that the contract does not declare`)
    if (!spec.derive) for (const [rung, v] of Object.entries(value)) checkValue(fam, `${fam}.${rung}`, v)
  }
  for (const [fam, spec] of Object.entries(F)) {
    if (!given(fam)) continue
    const missing = (spec.requires ?? []).filter((r) => !given(r))
    if (missing.length) throw new ScaleRefused(`${fam} is supplied without ${missing}, which it requires`)
    for (const other of spec.exclusiveWith ?? []) {
      const both = Object.keys(scales[fam]).filter((r) => given(other) && Object.hasOwn(scales[other], r))
      if (both.length) throw new ScaleRefused(`rung(s) ${both} are supplied to both ${fam} and ${other}`)
    }
  }

  const named = (fam, value) => Object.fromEntries(F[fam].slots.map((s, i) => [s, value[i]]))
  const tokens = []
  for (const [fam, spec] of Object.entries(F)) {
    if (!given(fam) || spec.noEmit) continue
    const add = (property, value, extra) =>
      tokens.push({ property, family: fam, ...extra, type: spec.type, group: spec.group, value })
    const one = (property, raw, rung) => {
      const extra = rung === undefined ? {} : { rung }
      let value = raw
      if (spec.slots) {
        const slots = named(fam, raw)
        value = spec.valueTemplate.replace(/\{(\w+)\}/g, (_, s) => String(slots[s]))
        if (spec.recordAs) extra[spec.recordAs] = slots
      }
      if (spec.pxAt) {
        const { number } = length(`${fam}.${rung}`, raw, [spec.pxFrom])
        const scaled = number.n * BigInt(spec.pxAt)
        const whole = number.e >= 0 ? scaled * 10n ** BigInt(number.e) : scaled / 10n ** BigInt(-number.e)
        extra.px = `${plain({ neg: number.neg, n: whole, e: 0 })}px`      // truncated toward zero
      }
      add(property, value, extra)
    }
    if (spec.scalar) one(spec.css, scales[fam])
    else if (spec.derive) {
      const d = spec.derive
      const { number: base, unit } = length(d.from, scales[d.from], d.units)
      if (d.op !== 'multiply') throw new ScaleRefused(`derive op ${d.op} is not one this consumer knows`)
      // What the rounding applies to. Two contracts in this package say "halfEven" of different
      // operands, so a missing or unknown `of` is refused rather than assumed.
      if (d.of !== 'exactDecimal')
        throw new ScaleRefused(`${fam}.derive.of is ${JSON.stringify(d.of)}; this implementation rounds only the exact decimal product ("exactDecimal")`)
      for (const rung of rungsOf(fam)) {
        if (!scales[fam].includes(rung)) continue
        const factor = decimal(rung.split(d.decimalSeparator).join('.'))
        const product = { neg: base.neg !== factor.neg, n: base.n * factor.n, e: base.e + factor.e }
        add(spec.css.replace('{k}', rung), plain(round(product, d.significantDigits, d.rounding), d.notation) + unit,
          { rung, expr: `calc(var(${F[d.from].css}) * ${plain(factor)})` })
      }
    } else {
      for (const rung of rungsOf(fam))
        if (Object.hasOwn(scales[fam], rung)) one(spec.css.replace('{k}', rung), scales[fam][rung], rung)
    }
    for (const [property, value] of Object.entries(spec.alsoEmits ?? {})) add(property, value, { constant: true })
  }

  // What a non-emitting family does to the family it modifies.
  for (const [fam, spec] of Object.entries(F)) {
    if (!spec.noEmit || !given(fam)) continue
    for (const target of spec.modifies) {
      const theirs = tokens.filter((t) => t.family === target && !t.constant)
      if (spec.sets === 'dark') {
        for (const t of theirs) if (Object.hasOwn(scales[fam], t.rung)) t.dark = scales[fam][t.rung]
      } else if (spec.sets === 'record') {
        const slots = named(fam, scales[fam])
        const key = F[target].recordAs
        for (const t of theirs) t[key] = { ...t[key], ...slots }
      } else throw new ScaleRefused(`${fam} sets ${spec.sets}, which this consumer does not know`)
    }
  }
  return tokens
}
