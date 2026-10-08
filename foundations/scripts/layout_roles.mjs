// @lightlysaltedhq/design-foundations/layout-roles — the layout rhythm roles as code. A product's
// declaration (the contract's defaults, plus any override it names) resolved against the scale
// tokens its own scale derives, and every invariant in contract/vocabulary.json#layoutRoles checked
// on the result. The one implementation: scripts/check_layout_roles.py proves it, and a product
// loads it rather than re-deriving the rules. Usage and types are in layout_roles.d.mts, checked
// against its output; the command line is layout_roles_cli.mjs, a separate file.
//
// This file has no module dependencies and touches no runtime global, as scale_tokens.mjs has none:
// the pack gate fails an exported file on any word that would, comments included.
//
// A VERSIONED API: the package's `./layout-roles` export, so the names, arguments and result shapes
// below are public surface and changing one is a major release (CHANGELOG.md, Versioning).
//
//   scaleTokens the list deriveScaleTokens (the `./scale-tokens` export) returns for the product's
//               scale. The caller derives it and hands it in: a role's end is a rung NAME, and what
//               it measures is the product's own value for that rung, which for `space` is the scale
//               shape's own derivation. Deriving it here would be a second implementation of that
//               rule, and the design system has already had two derivations of one rule drift apart
//               through four review rounds.
//   overrides   { <role>: { min?: <rung>, max?: <rung> } }. A product names another rung of the
//               role's family for any end it does not take from the contract's defaults.
//   roles       { <role>: { <end>: { rung, property, value, px } } }: the rung each end points at,
//               the scale token it resolves to, that token's value, and the value in CSS px as a
//               plain decimal string.
//   tokens      [{ property, value, role, end }] in the vocabulary's role order, each end in `ends`
//               order: `--space-section-md-min: var(--space-16)`. A reference, never a length.
//
// EVERY RULE IS READ. The invariant kinds, the ends and the property template are fields in the
// contract. This implements the kinds the contract has today and throws ContractError on any other,
// rather than running its own idea of the rule. Lengths are compared as exact decimals, never as
// binary floating point.

export class ContractError extends Error {}
export class LayoutRefused extends Error {
  constructor(codes, detail) {
    const sorted = [...new Set(codes)].sort()
    super(`${sorted.join(', ')}: ${detail}`)
    this.codes = sorted
  }
}

// ── exact decimals: value = n x 10^e ──────────────────────────────────────────────────────────────
const LENGTH = /^\s*(-?)(\d+)(?:\.(\d+))?(px|rem)\s*$/i
function cssPx(value) {
  // A length in CSS px, as [n, e], or null when it is not px or rem. A rem is 16 px, the initial
  // root font size, which is also the figure the scale shape's `pxAt` reads a breakpoint at.
  const m = LENGTH.exec(String(value))
  if (!m) return null
  let n = BigInt(`${m[1]}${m[2]}${m[3] ?? ''}`)
  const e = -(m[3] ?? '').length
  if (m[4].toLowerCase() === 'rem') n *= 16n
  return [n, e]
}
function cmp([an, ae], [bn, be]) {
  const e = Math.min(ae, be)
  const a = an * 10n ** BigInt(ae - e)
  const b = bn * 10n ** BigInt(be - e)
  return a < b ? -1 : a > b ? 1 : 0
}
function show([n, e]) {
  if (n === 0n) return '0'
  while (e < 0 && n % 10n === 0n) { n /= 10n; e += 1 }
  const neg = n < 0n
  let s = (neg ? -n : n).toString()
  if (e >= 0) s += '0'.repeat(e)
  else {
    s = s.padStart(-e + 1, '0')
    s = `${s.slice(0, e)}.${s.slice(e)}`
  }
  return (neg ? '-' : '') + s
}
const OPS = { '<=': (c) => c <= 0, '<': (c) => c < 0, '>=': (c) => c >= 0, '>': (c) => c > 0 }

// ── resolution ────────────────────────────────────────────────────────────────────────────────────
export function resolveLayoutRoles(vocabulary, shape, scaleTokens, overrides = {}) {
  const L = vocabulary?.layoutRoles
  // A vocabulary with no readable layoutRoles is a contract this cannot read, and says so as one,
  // rather than failing on whichever field it happens to touch first with a TypeError.
  if (L === null || typeof L !== 'object' || !Array.isArray(L.roles) || !Array.isArray(L.ends)
      || !Array.isArray(L.invariants) || typeof L.css !== 'string')
    throw new ContractError('vocabulary.layoutRoles needs roles, ends and invariants as lists and css as a template')
  // Each role names the scale-shape family its ends are rungs of: the section weights are `space`
  // rungs, and the gutter is `containerPadding`'s, the kit's edge inset.
  const familyOf = {}
  for (const spec of L.roles) {
    const fam = shape.families[spec.family]
    if (!fam || !String(fam.css ?? '').includes('{k}') || !Array.isArray(fam.steps))
      throw new ContractError(`${spec.id}: family ${spec.family} is not a scale-shape family with a property per rung`)
    familyOf[spec.id] = fam
  }
  const ends = L.ends
  const roleIds = L.roles.map((r) => r.id)

  // The declaration first: a role, an end or a rung the contract does not know is refused by name
  // before anything is resolved, so no failure downstream can be blamed on a typo upstream.
  const unknown = []
  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides))
    throw new LayoutRefused(['declaration'], 'overrides map a role to { min?, max? }')
  for (const [role, given] of Object.entries(overrides)) {
    if (!roleIds.includes(role)) { unknown.push(['unknownRole', `${role} is not a layout role`]); continue }
    if (given === null || typeof given !== 'object' || Array.isArray(given)) {
      unknown.push(['declaration', `${role} maps each end to a rung, not ${JSON.stringify(given)}`]); continue
    }
    for (const [end, rung] of Object.entries(given)) {
      if (!ends.includes(end)) unknown.push(['unknownEnd', `${role}.${end} is not an end (${ends.join(', ')})`])
      else if (typeof rung !== 'string' || !familyOf[role].steps.includes(rung))
        unknown.push(['unknownRung', `${role}.${end}: ${JSON.stringify(rung)} is not a rung of ${L.roles.find((r) => r.id === role).family}`])
    }
  }
  if (unknown.length) throw new LayoutRefused(unknown.map((u) => u[0]), unknown.map((u) => u[1]).join('; '))

  if (!Array.isArray(scaleTokens)) throw new LayoutRefused(['declaration'], 'scaleTokens is the list deriveScaleTokens returns')
  const byRung = new Map(scaleTokens.filter((t) => t.rung !== undefined).map((t) => [`${t.family} ${t.rung}`, t]))

  const roles = {}
  const tokens = []
  for (const spec of L.roles) {
    roles[spec.id] = {}
    for (const end of ends) {
      // Own properties only, as the validation above reads them: an inherited override was never
      // validated, so it must not be applied either.
      const given = Object.hasOwn(overrides, spec.id) ? overrides[spec.id] : undefined
      const rung = given && Object.hasOwn(given, end) ? given[end] : spec.defaults[end]
      const property = familyOf[spec.id].css.replace('{k}', rung)
      // The token must be the property the role's reference names, not merely the same family and
      // rung: tokens derived under one scale shape and resolved under another, or built by hand,
      // can carry the rung under another name, and then var(property) points at nothing.
      const found = byRung.get(`${spec.family} ${rung}`)
      const t = found?.property === property ? found : undefined
      const px = t ? cssPx(t.value) : null
      roles[spec.id][end] = { rung, property, value: t?.value ?? null, px: px ? show(px) : null }
      tokens.push({ property: L.css.replace('{role}', spec.id).replace('{end}', end),
        value: `var(${property})`, role: spec.id, end })
    }
  }

  // Every invariant, every failure, in one refusal: a product fixing its declaration should see
  // all of what is wrong at once rather than one line per run.
  const failed = []
  const endPx = (role, end) => {
    const r = roles[role][end]
    if (r.value === null) return null
    const px = cssPx(r.value)
    if (!px) failed.push(['unrankable', `${role}.${end} resolves to ${r.value}, which is not px or rem`])
    return px
  }
  for (const inv of L.invariants) {
    if (inv.kind === 'emitted') {
      for (const role of roleIds) for (const end of ends)
        if (roles[role][end].value === null)
          failed.push([inv.id, `${role}.${end} points at ${roles[role][end].property}, which this scale does not emit`])
    } else if (inv.kind === 'ends') {
      if (!OPS[inv.op]) throw new ContractError(`${inv.id}: op ${inv.op} is not one this implementation knows`)
      for (const role of roleIds) {
        const [a, b] = [endPx(role, ends[0]), endPx(role, ends[ends.length - 1])]
        if (a && b && !OPS[inv.op](cmp(a, b)))
          failed.push([inv.id, `${role}: ${ends[0]} ${roles[role][ends[0]].value} is not ${inv.op} ${ends[ends.length - 1]} ${roles[role][ends[ends.length - 1]].value}`])
      }
    } else if (inv.kind === 'order') {
      for (const [x, op, y] of inv.pairs) {
        if (!OPS[op]) throw new ContractError(`${inv.id}: op ${op} is not one this implementation knows`)
        if (!roleIds.includes(x) || !roleIds.includes(y)) throw new ContractError(`${inv.id} names a role that is not declared`)
        for (const end of ends) {
          const [a, b] = [endPx(x, end), endPx(y, end)]
          if (a && b && !OPS[op](cmp(a, b)))
            failed.push([inv.id, `${end}: ${x} ${roles[x][end].value} is not ${op} ${y} ${roles[y][end].value}`])
        }
      }
    } else if (inv.kind === 'floor') {
      if (!roleIds.includes(inv.role) || !ends.includes(inv.end)) throw new ContractError(`${inv.id} names an undeclared role or end`)
      const a = endPx(inv.role, inv.end)
      const floor = cssPx(`${inv.atLeastCssPx}px`)
      if (!floor) throw new ContractError(`${inv.id}: atLeastCssPx ${inv.atLeastCssPx} is not a number`)
      if (a && cmp(a, floor) < 0)
        failed.push([inv.id, `${inv.role}.${inv.end} is ${show(a)} CSS px, under the ${inv.atLeastCssPx} px floor`])
    } else {
      throw new ContractError(`invariant ${inv.id} is of kind ${inv.kind}, which this implementation does not know`)
    }
  }
  if (failed.length) throw new LayoutRefused(failed.map((f) => f[0]), [...new Set(failed.map((f) => f[1]))].join('; '))
  return { roles, tokens }
}
