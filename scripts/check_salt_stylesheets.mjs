#!/usr/bin/env node
// The shared stylesheets' gate: run as `node scripts/check_salt_stylesheets.mjs [package-dir]`.
//
// salt-contract/styles/ is the one stylesheet set both implementations ship (SC-002), so what it
// declares is checked here, where it is edited. Four checks, each proved able to fail by
// check_salt_stylesheets.test.mjs:
//
// 1. THE PARSE IS WHOLE. Every file in styles/ is read, and refused before any contract runs if it
//    holds what the parse cannot rank: an at-rule other than @media and @keyframes, @property, a
//    backslash outside a string, a declaration outside a rule, a keyframe animating anything but
//    transform or opacity, or fewer rules than declaration blocks.
// 2. THE DECISION CONTRACTS. What Salt for Next.js's verify-stylesheet-contracts.ts held for these
//    stylesheets at 1472afdd, ported with its types stripped. "Core" in the comments below is these
//    files as they lived in salt-nextjs's packages/core; BD-nnn cites that repository's build
//    register. Five of its contracts read its runtime and stay there, run against the files it
//    re-exports: the logo slot against its image sizes, each tone's hairline and the footer's colours
//    against its role routing table, the scriptless header against site-header.tsx, and every @media
//    width against its theme's breakpoint values (design-foundations names breakpoints, never their
//    values). A contract that read theme.css only to see that a token exists reads
//    contract/token-layer.json instead, and the focus ring's geometry is ranked for any values a
//    runtime gives the two ring tokens. The header logo's contract also accepts a classless `img`
//    reached by `>` from a parent provably not the logo link, which SC-011's fill rules need. One
//    contract is the contract's own: every framed image fills its frame (SC-011).
// 3. THE TOKEN LAYER. Every var() the stylesheets read and do not define is named in
//    contract/token-layer.json, everything named there is read, no name is listed twice, and a name
//    is `optional` exactly when every read of it carries a fallback.
// 4. THE CLASS VOCABULARY. Every salt-* class a selector names is on an element in
//    contract/markup/*.json, or is listed in UNMARKED with its reason.
//
// The checks are `checkStylesheets(files)`, over a map of the package's files by path (`styles/x.css`,
// `contract/…json`), so the test runs its cases in memory; run as a script, it reads the package from
// disk and prints the result.
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/* The package being checked, set at the start of each `checkStylesheets` run. */
let FILES = new Map()
const readJson = (file) => {
  try { return JSON.parse(FILES.get(file)) } catch { return null }
}

/* design-foundations' dark-mode selector is `[data-theme="dark"]` (vocabulary.json `darkMode`). */
const THEME_ATTRIBUTE = 'data-theme'

/* The section tones, from the markup contract's `data-tone` vocabulary. */
let TONES = []

/* design-foundations' text roles (vocabulary.json `textRoles`, required and optional), and the five
   declarations that set text in one: each CSS property reading the role's own custom property, in
   the order `textRoles.properties` gives them. */
const TEXT_ROLES = ['display', 'heading-1', 'heading-2', 'heading-3', 'heading-4', 'lead', 'body', 'small', 'label', 'caption', 'eyebrow', 'quote', 'stat']
const textRoleDeclarations = (role) => [
  { property: 'font-size', value: `var(--text-${role})` },
  { property: 'line-height', value: `var(--text-${role}--line-height)` },
  { property: 'letter-spacing', value: `var(--text-${role}--letter-spacing)` },
  { property: 'font-weight', value: `var(--text-${role}--font-weight)` },
  { property: 'font-family', value: `var(--text-${role}--font-family)` },
]

/* The selector helpers below, and the per-file scans further down, are pure functions of their
   arguments, and the same selectors and files are read by many contracts and, in the test, by
   hundreds of runs over one package. Each is memoised. The caches live as long as the process: one
   gate run, or one test file's run, and no longer. Keys are the argument values themselves in
   nested maps, so a cached stylesheet costs a reference to text already held, never a copy. No
   caller modifies a cached result. */
const memo = (fn) => {
  const root = new Map()
  const done = Symbol('result')
  return (...args) => {
    let node = root
    for (const arg of args) {
      if (!node.has(arg)) node.set(arg, new Map())
      node = node.get(arg)
    }
    if (!node.has(done)) node.set(done, fn(...args))
    return node.get(done)
  }
}

/* A selector with every `:not(…)` taken out, nested parentheses included: `:focus-visible` inside a
   negation is the unfocused state. An unbalanced `:not(` is left as it is rather than guessed at. */
const withoutNegationsUnmemoised = (selector) => {
  let text = selector
  for (let at = text.search(/:not\(/i); at !== -1; at = text.search(/:not\(/i)) {
    let depth = 0
    let end = at + ':not'.length
    for (; end < text.length; end += 1) {
      if (text[end] === '(') depth += 1
      else if (text[end] === ')') {
        depth -= 1
        if (depth === 0) break
      }
    }
    if (depth !== 0) return text
    text = `${text.slice(0, at)}${text.slice(end + 1)}`
  }
  return text
}
const withoutNegations = memo(withoutNegationsUnmemoised)

/** Split on a separator that is not inside brackets — selector lists and `var()` both need it. */
const splitTopUnmemoised = (input, separator) => {
  const parts = []
  let depth = 0
  let current = ''
  for (const char of input) {
    if (char === '(' || char === '[') depth += 1
    else if (char === ')' || char === ']') depth -= 1
    if (char === separator && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  parts.push(current)
  return parts.map((part) => part.trim()).filter((part) => part.length > 0)
}
const splitTop = memo(splitTopUnmemoised)

/**
 * Selectors are compared after normalising whitespace and quotes.
 *
 * CSS has several spellings for one selector: `[role='button']`, `[role="button"]` and
 * `[role=button]` are the same thing, and a selector may wrap across lines. A contract
 * keyed on raw text passes or fails on spelling, which is not a property any decision
 * record depends on.
 *
 * (An earlier version of this comment blamed Prettier. This repository has no Prettier
 * dependency, config or CI step — I had been running it from the npx cache against a config
 * that does not exist, which is also where the quote churn in `sections.css` came from. The
 * normalisation is still right; the reason given for it was not.)
 */
const normaliseUnmemoised = (selector) =>
  selector
    .replace(/\s+/g, ' ')
    .replace(/"/g, "'")
    /* `[data-style=link]` is valid CSS and identical in meaning to the quoted form, so a
       contract keyed on quotes would miss it. Nothing in CI emits it; it costs one line. */
    .replace(/\[([\w-]+)=([^'"\]]+)\]/g, "[$1='$2']")
    .trim()
    /* `a>b` and `a > b` are one selector, and a contract comparing the spaced form reported the
       unspaced one as a missing rule (#181 review). Combinators are spaced outside brackets and
       parentheses only, where `~=` and `2n+1` are not combinators. */
    .split('')
    .reduce(
      (acc, char) => {
        const depth = acc.depth + (char === '[' || char === '(' ? 1 : char === ']' || char === ')' ? -1 : 0)
        const text = acc.depth === 0 && (char === '>' || char === '+' || char === '~') ? `${acc.text} ${char} ` : acc.text + char
        return { depth, text }
      },
      { depth: 0, text: '' },
    )
    .text.replace(/\s+/g, ' ')
    .trim()
const normalise = memo(normaliseUnmemoised)

const parseDeclarations = (body) => {
  const declarations = {}
  const order = []
  const values = []
  for (const statement of splitTop(body, ';')) {
    const colon = statement.indexOf(':')
    if (colon === -1) continue
    const property = statement.slice(0, colon).trim()
    declarations[property] = statement.slice(colon + 1).trim()
    order.push(property)
    values.push(statement.slice(colon + 1).trim())
  }
  return { declarations, order, values }
}

/**
 * Comments are stripped before anything is parsed.
 *
 * These stylesheets explain themselves at length and the explanations quote the very
 * declarations being asserted, so the first version's `isolation: isolate` contract was
 * satisfied by the paragraph ABOVE the declaration, which sits inside the same braces.
 * Deleting the rule left the gate green. Third time this repository has met that shape —
 * `verify-no-colour-literals.ts` strips comments, `verify-token-delivery.ts` strips
 * comments and strings, and this one did neither until it was caught doing it.
 *
 * Each rule is `{ at, selectors, declarations, order, values }`: its enclosing at-rule preludes
 * outermost first, its selectors normalised, its declarations keyed by property (the last value
 * written wins), and every property and value in the order written, duplicates and all, because
 * which of two declarations came last is the one thing the cascade decides inside a rule.
 */
const parse = (css) => {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const rules = []
  const bare = []
  const at = []
  let atBlocks = 0
  let braces = 0
  let prelude = ''

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i] ?? ''
    /*
     * A statement at-rule — `@layer primitives;`, `@import …;`, `@charset …;` — has no
     * block. Without this its text merged into the NEXT rule's prelude, that rule was
     * pushed onto the at-rule stack instead of being recorded, and its declarations were
     * discarded. One `@layer primitives;` at the top of `primitives.css` deleted the base
     * focus rule from the parse, after which reverting the spread to 4px passed the gate.
     */
    if (char === ';') {
      if (prelude.trim() !== '' && !prelude.trim().startsWith('@')) bare.push(prelude.trim())
      prelude = ''
      continue
    }
    if (char === '{') {
      braces += 1
      const head = prelude.trim()
      prelude = ''
      if (head.startsWith('@')) {
        at.push(head)
        atBlocks += 1
        continue
      }
      /* A declaration block: consume to its matching brace. Nested rules are not used in
         these files, and a nested block would surface as a parse that finds no declarations
         rather than as a silently wrong one. */
      let depth = 1
      let body = ''
      i += 1
      for (; i < source.length && depth > 0; i += 1) {
        if (source[i] === '{') {
          depth += 1
          braces += 1
        } else if (source[i] === '}') {
          depth -= 1
          if (depth === 0) break
        }
        body += source[i] ?? ''
      }
      const parsed = parseDeclarations(body)
      rules.push({
        at: [...at],
        selectors: splitTop(head, ',').map(normalise),
        declarations: parsed.declarations,
        order: parsed.order,
        values: parsed.values,
      })
      continue
    }
    if (char === '}') {
      if (prelude.trim() !== '') bare.push(prelude.trim())
      at.pop()
      prelude = ''
      continue
    }
    prelude += char
  }
  return { rules, bare, expected: braces - atBlocks }
}

/**
 * A length in CSS pixels, or `null` when it is anything else — `rem`, a keyword, absent.
 *
 * Unitless zero is a length; every other unitless number is not. Missing that cost the
 * link-rule contract its whole purpose: `min-block-size: 0` read as `null`, so the rule
 * that zeroes the floor was not recognised as zeroing anything.
 */
const px = (value) => {
  if (value === undefined) return null
  const trimmed = value.trim()
  if (/^0+(?:\.0+)?$/.test(trimmed)) return 0
  const match = /^(\d+(?:\.\d+)?)px$/.exec(trimmed)
  return match?.[1] === undefined ? null : Number(match[1])
}

/**
 * Every custom property contract/token-layer.json names, with its entry.
 *
 * Read for the contracts that hold a declaration to a token: a radius, an opacity, a text role or a
 * card's rhythm must read a token the runtime emits. Salt for Next.js asked its generated
 * `theme.css`; the contract has no values, so a token exists when the token layer names it, and the
 * token layer check below holds that list to what the stylesheets read.
 */
let TOKEN_LAYER = null
let TOKEN_NAMES = new Map()
const tokenNames = (layer) => new Map(
  (layer?.groups ?? []).flatMap((group) =>
    (group.tokens ?? []).flatMap((token) =>
      token.textRole === undefined
        ? [[token.name, token]]
        : textRoleDeclarations(token.textRole).map(({ value }) => [value.slice('var('.length, -1), token]),
    ),
  ),
)

/** Whether the token layer names a token, or why a contract cannot read it. */
const themeValue = (name) =>
  TOKEN_NAMES.has(name) ? { value: name } : { missing: `contract/token-layer.json names no \`${name}\`` }

/**
 * A focus-ring length, read through the ring's own token where the rule names one.
 *
 * The ring is written `var(--focus-ring-width)` and `var(--focus-ring-offset)` (BD-169), and the
 * keyline contracts below are arithmetic on the two. The contract holds no values, so a length is
 * kept as `px + width × W + offset × O`, with W and O whatever the runtime gives the two tokens, and
 * one length exceeds another only when it does for every W and O of zero or more. Any other `var()`
 * stays unreadable: a name this does not resolve is a value it cannot rank. The custom property's
 * name is case-sensitive, and `var` is not.
 */
const RING_TOKENS = new Map([['--focus-ring-width', { px: 0, width: 1, offset: 0 }], ['--focus-ring-offset', { px: 0, width: 0, offset: 1 }]])
const literal = (value) => {
  const length = px(value)
  return length === null ? null : { px: length, width: 0, offset: 0 }
}
const sum = (...lengths) => lengths.reduce((a, b) => ({ px: a.px + b.px, width: a.width + b.width, offset: a.offset + b.offset }))
const exceeds = (a, b) => a.width >= b.width && a.offset >= b.offset && a.px > b.px
const isNoLength = (a) => a.px === 0 && a.width === 0 && a.offset === 0
const spelt = (a) =>
  [a.offset > 0 ? `${a.offset === 1 ? '' : `${String(a.offset)} × `}var(--focus-ring-offset)` : null,
    a.width > 0 ? `${a.width === 1 ? '' : `${String(a.width)} × `}var(--focus-ring-width)` : null,
    a.px !== 0 || (a.width === 0 && a.offset === 0) ? `${String(a.px)}px` : null].filter(Boolean).join(' + ')

/**
 * A keyline's spread: an integer px length, or exactly
 * `calc(var(--focus-ring-offset) + var(--focus-ring-width) + <n>px)`, which is how both focus rules
 * write it so the keyline follows the ring (#189 review, MEDIUM 2). Any other `calc()`, `var()` or
 * unit is `null`: a spelling the contracts cannot rank.
 */
const KEYLINE_CALC = /^calc\(\s*var\(\s*--focus-ring-offset\s*\)\s*\+\s*var\(\s*--focus-ring-width\s*\)\s*\+\s*(\d+)px\s*\)$/i

const spreadLength = (value) => {
  const derived = KEYLINE_CALC.exec(value?.trim() ?? '')
  if (derived === null) return literal(value)
  return sum(RING_TOKENS.get('--focus-ring-offset'), RING_TOKENS.get('--focus-ring-width'), { px: Number(derived[1]), width: 0, offset: 0 })
}

/** A shadow layer's tokens, split on whitespace outside brackets, so a `calc()` stays one token. */
const layerTokens = (layer) => splitTop(layer.replace(/\s+/g, ' '), ' ')

const ringLength = (value) => {
  const named = /^var\(\s*(--[\w-]+)\s*\)$/i.exec(value?.trim() ?? '')
  if (named === null) return literal(value)
  return RING_TOKENS.get(named[1] ?? '') ?? null
}

/**
 * A zero length in any spelling, and the longhand a shorthand also sets.
 *
 * `px()` reads px and unitless zero only, so `padding-inline-start: 0rem` reads as "not
 * zero" — a correct declaration reported as a defect, with a message telling its author to
 * undo it. And a contract keyed on the longhand alone never sees `padding: 1em`, which
 * restores the indent just as effectively. `AXES` below already records this exact lesson
 * for `min-height` versus `min-block-size`: ask about the effect, not the spelling.
 */
const ZERO = /^0+(?:\.0+)?(?:px|rem|em|%|ch|vw|vh)?$/i

const isZero = (value) =>
  value !== undefined && ZERO.test(value.trim())

/**
 * The value a rule gives a longhand, reading through whichever shorthand also sets it.
 *
 * `settersOf` below returns whichever spelling declares a longhand, which is enough when the
 * shorthand's value IS the longhand's. It is not enough for the flex shorthands, where the
 * longhand is one component of a list: `place-content: center start` sets
 * `justify-content: start`, and `flex-flow: column wrap` sets `flex-direction: column`.
 * Measured in Chromium — both reintroduce the exact failures the actions-row contract names,
 * and both passed it.
 */
/**
 * The LAST of several spellings to be written, read through a per-spelling extractor.
 *
 * Later wins inside a rule, so `justify-content: center; place-content: center start`
 * computes to `start` — and a resolver preferring the longhand wherever it appears reads
 * `center` and passes the defect. Verified in Chromium; it was the one mutation that
 * survived the first version of this contract's override half.
 */
const fromLast = (
  rule,
  spellings,
  extract,
) => {
  let found
  for (const property of rule.order) {
    if (!spellings.includes(property)) continue
    const raw = rule.declarations[property]
    if (raw !== undefined) found = extract(property, raw)
  }
  return found
}

const LONGHANDS = {
  display: (rule) => rule.declarations['display'],

  'justify-content': (rule) =>
    fromLast(rule, ['justify-content', 'place-content'], (property, raw) => {
      if (property === 'justify-content') return raw
      /* `place-content: <align> <justify>`; one value sets both. */
      const parts = raw.trim().split(/\s+/)
      return parts.length > 1 ? parts[1] : parts[0]
    }),

  'flex-wrap': (rule) =>
    fromLast(rule, ['flex-wrap', 'flex-flow'], (property, raw) =>
      property === 'flex-wrap'
        ? raw
        : raw.trim().split(/\s+/).find((part) => /^(?:nowrap|wrap|wrap-reverse)$/.test(part)),
    ),

  'flex-direction': (rule) =>
    fromLast(rule, ['flex-direction', 'flex-flow'], (property, raw) =>
      property === 'flex-direction'
        ? raw
        : raw
            .trim()
            .split(/\s+/)
            .find((part) => /^(?:row|row-reverse|column|column-reverse)$/.test(part)),
    ),

  /* `word-wrap` is not a shorthand but a legacy ALIAS: a browser treats the two names as one
     property, so whichever is written last decides. A resolver preferring `overflow-wrap`
     wherever it appears reads `break-word` from a rule that goes on to say
     `word-wrap: normal`, and passes the defect. Same lesson as `place-content` above. */
  'overflow-wrap': (rule) => fromLast(rule, ['overflow-wrap', 'word-wrap'], (_property, raw) => raw),

  /* `width`/`height` and `inline-size`/`block-size` are separate properties resolving to
     the same used value in a horizontal writing mode, so whichever is written LAST decides —
     the `min-height`/`min-block-size` lesson `AXES` already records, in the other axis. */
  'inline-size': (rule) => fromLast(rule, ['inline-size', 'width'], (_property, raw) => raw),
  'block-size': (rule) => fromLast(rule, ['block-size', 'height'], (_property, raw) => raw),

  /* No shorthand sets these, so the resolver is the plain declaration — read through
     `fromLast` all the same, so a rule declaring one twice reports the one that wins. */
  'overflow-x': (rule) => fromLast(rule, ['overflow-x', 'overflow'], (property, raw) =>
    property === 'overflow-x' ? raw : (raw.trim().split(/\s+/)[0] ?? raw)),
  'scroll-snap-type': (rule) => fromLast(rule, ['scroll-snap-type'], (_property, raw) => raw),
  'overscroll-behavior-x': (rule) =>
    fromLast(rule, ['overscroll-behavior-x', 'overscroll-behavior'], (property, raw) =>
      property === 'overscroll-behavior-x' ? raw : (raw.trim().split(/\s+/)[0] ?? raw)),
  'scroll-behavior': (rule) => fromLast(rule, ['scroll-behavior'], (_property, raw) => raw),
  'scroll-snap-align': (rule) =>
    fromLast(rule, ['scroll-snap-align'], (_property, raw) => raw),

  /* `-webkit-filter` is a legacy ALIAS rather than a shorthand, exactly as `word-wrap` is:
     a browser treats the two names as one property, so `filter: none; -webkit-filter:
     grayscale(1)` computes to the second. */
  filter: (rule) => fromLast(rule, ['filter', '-webkit-filter'], (_property, raw) => raw),

  /* `grid-template` and `grid` both set the columns, in their `rows / columns` form. The
     value after the slash is what matters; without a slash neither sets columns at all. */
  'grid-template-columns': (rule) =>
    fromLast(rule, ['grid-template-columns', 'grid-template', 'grid'], (property, raw) => {
      if (property === 'grid-template-columns') return raw
      const slash = raw.indexOf('/')
      return slash === -1 ? undefined : raw.slice(slash + 1).trim()
    }),
}

/** Every property that sets a given longhand, shorthands included. */
const settersOf = {
  'padding-inline-start': ['padding-inline-start', 'padding-inline', 'padding'],
  'list-style-position': ['list-style-position', 'list-style'],
}

/** The value a rule gives a longhand, through whichever spelling declares it. */
const declared = (rule, longhand) => {
  for (const property of settersOf[longhand] ?? [longhand]) {
    const value = rule.declarations[property]
    if (value !== undefined) return value
  }
  return undefined
}

/**
 * The final compound — the part of a selector that describes the element actually matched.
 *
 * `.salt-card:not([data-icon-only]) .salt-button` says nothing about the button; the
 * negation is a condition on an ANCESTOR. Asking whether `:not([data-icon-only])` appears
 * anywhere in the selector string treats that as an exclusion of icon-only buttons, which is
 * how a rule zeroing the floor on icon-only links inside a card passed two contracts at
 * once. Splitting on the combinators and keeping the last part asks the question of the
 * right element.
 */
const lastCompound = (selector) => {
  let depth = 0
  let start = 0
  for (let i = 0; i < selector.length; i += 1) {
    const char = selector[i]
    if (char === '(' || char === '[') depth += 1
    else if (char === ')' || char === ']') depth -= 1
    else if (depth === 0 && (char === ' ' || char === '>' || char === '+' || char === '~')) {
      start = i + 1
    }
  }
  return selector.slice(start)
}

/**
 * Does this selector target EVERY element of a tag, rather than some of them?
 *
 * Three spellings have to read alike and a fourth must not. `.salt-rich-text ul`,
 * `.salt-rich-text :is(ul, ol)` and `.salt-rich-text ul:not([data-plain])` all govern the
 * general case — the second is what `primitives.css` itself writes four lines from the rule
 * being checked, and exact equality on the last compound saw only the first.
 *
 * `.salt-rich-text ul[data-plain]` does NOT: it is a deliberate opt-out on the elements
 * carrying that attribute, and reporting it as a global override is a false failure telling
 * somebody to undo a narrowing they meant. So `:not()` is stripped — it narrows without
 * changing what the rule generally governs — and anything else left beside the tag
 * disqualifies it.
 *
 * The alternatives inside `:is()`/`:where()` are split depth-aware rather than with
 * `[^()]*`, which fails outright on a nested functional pseudo like
 * `:is(ul:not(.plain), ol:not(.plain))` — where the first tag went missing entirely.
 */
const targetsElement = (selector, tag) => {
  const compound = lastCompound(selector)
  const inner = /^:(?:is|where)\(/.test(compound)
    ? splitTop(compound.slice(compound.indexOf('(') + 1, -1), ',')
    : [compound]
  return inner.some((alternative) => {
    /* An ancestor requirement inside `:is()` narrows it too — `:is(.plain ul, ol)` governs
       `ul` only inside `.plain`, so it is not a general override of `ul`. */
    if (hasCombinator(alternative)) return false
    return stripNegations(alternative).trim() === tag
  })
}

/**
 * Is the element this selector matches a DIRECT CHILD of its nearest ancestor?
 *
 * The question `lastCompound` cannot answer, and the one a scoping contract needs.
 * `.a .b :is(ul, ol)` and `.a .b > :is(ul, ol)` have the same final compound and govern
 * completely different sets — every list at any depth, versus only the outermost — so a
 * contract built on the compound alone cannot tell a scoped rule from an unscoped one.
 */
const isDirectChild = (selector) => {
  let depth = 0
  /* The separator RUN is what has to be read, not each character. `a > b` is one combinator
     written as three characters, and treating the space after `>` as a separate descendant
     combinator makes every child selector read as a descendant one — which is what the first
     version of this did, reporting a correctly scoped rule as unscoped. */
  let run = ''
  let last = ''

  for (const char of selector.trim()) {
    if (char === '(' || char === '[') depth += 1
    else if (char === ')' || char === ']') depth -= 1

    if (depth === 0 && (char === ' ' || char === '>' || char === '+' || char === '~')) {
      run += char
      continue
    }
    if (run !== '') {
      last = /[>+~]/.exec(run)?.[0] ?? ' '
      run = ''
    }
  }

  return last === '>'
}

/** Excludes icon-only controls — the negation is on the matched element, not an ancestor. */
const excludesIconOnly = (selector) => {
  const compound = lastCompound(selector)
  return compound.includes('[data-icon-only]') && !stripNegations(compound).includes('[data-icon-only]')
}

/**
 * Does this selector reach EVERY element of a kind, or only some of them?
 *
 * `lastCompound` answers "what does this rule match", which is the right question for the
 * negation and the wrong one for this. `.salt-card .salt-button` has `.salt-button` as its
 * last compound and reaches only the buttons inside a card — so a floor moved onto it left
 * every button elsewhere with no minimum, and passed a check built on `lastCompound`.
 *
 * Reaching everything means two things: no combinator, so no ancestor is required; and no
 * qualifier beyond the ones named, so nothing narrows it further. `:is()` and `:where()`
 * unwrap first — `:where(.salt-button)` is every button at lower specificity, and failing it
 * would be a false alarm with a message pointing at the wrong fix.
 */
const hasCombinator = (selector) => {
  let depth = 0
  for (const char of selector.trim()) {
    if (char === '(' || char === '[') depth += 1
    else if (char === ')' || char === ']') depth -= 1
    else if (depth === 0 && (char === ' ' || char === '>' || char === '+' || char === '~')) {
      return true
    }
  }
  return false
}

const reachesAll = (selector, parts) => {
  if (hasCombinator(selector)) return false
  /* Negations stripped, as `targetsElement`, `targetsAttribute` and `excludesIconOnly` all
     do and this one did not. `:not(:empty)` narrows a rule without changing what it
     generally governs, and reporting it as "no rule reaches the class" tells its author to
     undo a correct narrowing — the same false failure this file already records twice. */
  let rest = stripNegations(selector).replace(/:(?:is|where)\(([^()]*)\)/g, '$1').trim()
  for (const part of parts) rest = rest.split(part).join('')
  return rest.trim() === ''
}

/**
 * ── The cascade is out of reach here, and pretending otherwise cost five rounds ──
 *
 * This file's own header says it: *"It still is not proof a rule APPLIES — that needs the
 * WP13 DOM harness, and cascade, inheritance and computed values stay out of reach here."*
 * The feature-grid contract ignored that and grew a cascade model — specificity, importance,
 * source order, a media-query evaluator. It was defeated eight times across five iterations,
 * every one of them measured four-across at 320px in a real browser with the gate green:
 * a decoy step that can never match, `!important`, `@media not all and (min-width: …)`, a
 * comma alternation, a hard-coded track list, range syntax (`width >= 30rem`), an unsupported
 * `@supports` wrapper, a cascade layer, and a selector list whose unmatched branch
 * over-scored the rule.
 *
 * The pattern is not that the model was nearly right. It is that a text checker cannot
 * decide which declaration wins without being a browser, and each fix closed the known
 * attacks and opened new ones.
 *
 * **So the contracts below do not model the cascade. They forbid the shapes that would need
 * modelling.** A rule that sets one of the properties under contract must match one of a
 * small set of spellings; anything else fails, loudly, saying the checker cannot reason about
 * it. That is more restrictive than CSS allows and exactly right for two hand-written
 * stylesheets we own — and a false failure is a message telling somebody to extend an
 * allow-list deliberately, which is a far better outcome than a model quietly passing on the
 * defect it was written to catch.
 *
 * Proving a rule APPLIES stays WP13's, where a browser can answer it.
 */

/**
 * The attribute conditions a selector tests, as parsed pairs rather than as text.
 *
 * `normalise` has already collapsed whitespace and single-quoted every value, so this reads
 * the CONDITION — which attribute, which value — and a contract built on it is not keyed to
 * one spelling of the selector that expresses it.
 */
const attributeConditions = (
  selector,
) =>
  [...selector.matchAll(/\[\s*([\w-]+)\s*(?:([~^$*|]?=)\s*'([^']*)')?\s*\]/g)].map((match) => ({
    name: (match[1] ?? '').toLowerCase(),
    value: match[2] === '=' ? (match[3] ?? '') : null,
  }))

/** The arguments of every top-level `:not()` in a selector. */
const negatedParts = (selector) => {
  const parts = []
  const pattern = /:not\(/gi
  let match = pattern.exec(selector)
  while (match !== null) {
    let depth = 0
    let cursor = match.index + match[0].length - 1
    const open = cursor
    for (; cursor < selector.length; cursor += 1) {
      if (selector[cursor] === '(') depth += 1
      else if (selector[cursor] === ')') {
        depth -= 1
        if (depth === 0) break
      }
    }
    if (depth !== 0) return parts
    parts.push(...splitTop(selector.slice(open + 1, cursor), ',').map((part) => part.trim()))
    pattern.lastIndex = cursor
    match = pattern.exec(selector)
  }
  return parts
}

/**
 * Everything after a selector's last top-level combinator.
 *
 * The key compound is the part that decides WHICH element a rule lands on, and it is the only
 * part two questions below can be asked of. A `:not()` sitting further left constrains an
 * ancestor, not the element being drawn — which is the hole the first version of the contract
 * below had: an exclusion moved onto the list item reads as "an item that is a section
 * ancestor but is not itself current", passes for looking right, and excludes nothing,
 * because a list item never carries `aria-current` in the first place.
 */
const keyCompoundUnmemoised = (selector) => {
  let depth = 0
  let start = 0
  for (let i = 0; i < selector.length; i += 1) {
    const char = selector[i] ?? ''
    if (char === '[' || char === '(') depth += 1
    else if (char === ']' || char === ')') depth -= 1
    else if (depth === 0 && (char === ' ' || char === '>' || char === '+' || char === '~')) {
      start = i + 1
    }
  }
  return selector.slice(start)
}
const keyCompound = memo(keyCompoundUnmemoised)

/**
 * A compound with every attribute selector cut out, brackets and all.
 *
 * An attribute VALUE is free text, so a question about classes, ids or pseudo-elements asked
 * of the whole compound reads `a[href$='.pdf']` as naming the class `pdf` and
 * `a[href^='#fn']` as naming the id `fn`. Quotes are tracked so a bracket inside a quoted value
 * (`[title=']']`) does not end the selector early.
 */
const withoutAttributesUnmemoised = (compound) => {
  let kept = ''
  let depth = 0
  let quote = null
  for (const char of compound) {
    if (depth > 0) {
      if (quote !== null) {
        if (char === quote) quote = null
      } else if (char === "'" || char === '"') quote = char
      else if (char === '[') depth += 1
      else if (char === ']') depth -= 1
      continue
    }
    if (char === '[') depth = 1
    else kept += char
  }
  return kept
}
const withoutAttributes = memo(withoutAttributesUnmemoised)

/**
 * The classes a key compound names — read with its attribute selectors cut out, because
 * `a[href$='.pdf']` names no class, and reading `pdf` as one proves a rule misses any element
 * that does not carry it.
 */
const compoundClassesUnmemoised = (compound) =>
  new Set([...withoutAttributes(compound).matchAll(/\.([\w-]+)/g)].map((match) => match[1] ?? ''))
const compoundClasses = memo(compoundClassesUnmemoised)

/**
 * The classes a key compound REQUIRES of its element (#198 re-review, F4). `compoundClasses` counts every
 * class written, so `.salt-nav a:not(.salt-x)` read as naming `.salt-x`, and `.salt-nav :is(a, .salt-x)`
 * as naming it too, though each matches every menu link. A class inside `:not()` or `:where()` is not
 * required, and one inside `:is()` or `:matches()` only when every branch requires it.
 */
const requiredClassesUnmemoised = (compound) => {
  const plain = withoutAttributes(compound)
  const required = new Set()
  let rest = ''
  for (let i = 0; i < plain.length; i += 1) {
    const match = /^:(not|where|is|matches)\(/i.exec(plain.slice(i))
    if (match === null) {
      rest += plain[i] ?? ''
      continue
    }
    let depth = 0
    let end = i + match[0].length - 1
    for (; end < plain.length; end += 1) {
      if (plain[end] === '(') depth += 1
      else if (plain[end] === ')') {
        depth -= 1
        if (depth === 0) break
      }
    }
    const kind = (match[1] ?? '').toLowerCase()
    if (kind === 'is' || kind === 'matches') {
      const branches = splitTop(plain.slice(i + match[0].length, end), ',').map((branch) =>
        hasCombinator(branch) ? new Set() : requiredClasses(branch),
      )
      const [first, ...others] = branches
      for (const name of first ?? []) if (others.every((branch) => branch.has(name))) required.add(name)
    }
    i = end
  }
  for (const found of rest.matchAll(/\.([\w-]+)/g)) required.add(found[1] ?? '')
  return required
}
const requiredClasses = memo(requiredClassesUnmemoised)

/** The element type a key compound names, or `null` for one that names none. */
const compoundType = (compound) =>
  /^([\w-]+)/.exec(compound)?.[1]?.toLowerCase() ?? null

/**
 * Could these two selectors ever draw on ONE element?
 *
 * Deliberately asymmetric in what it concludes. It answers "yes" unless the two can be PROVED
 * disjoint, because the cost of the two answers is not the same: a false "yes" reports a
 * conflict that does not exist, which is loud and gets corrected, and a false "no" drops a
 * real conflict out of the contract silently — which is how a current-page rule written
 * without a class escaped the first version of this test entirely.
 *
 * Two proofs of disjointness, both about the key compound. Naming classes with none in common
 * is one; naming different element types is the other, since `span.x` and `a.x` are never the
 * same element. Anything else — including a compound naming no class at all — is in
 * contention.
 */
const inContention = (a, b) => {
  const left = keyCompound(a)
  const right = keyCompound(b)

  const leftType = compoundType(left)
  const rightType = compoundType(right)
  if (leftType !== null && rightType !== null && leftType !== rightType) return false

  const leftClasses = compoundClasses(left)
  const rightClasses = compoundClasses(right)
  if (leftClasses.size === 0 || rightClasses.size === 0) return true
  return [...leftClasses].some((name) => rightClasses.has(name))
}

/** `!important` outranks everything, so a contract that cannot rank must refuse it. */
const isImportant = (value) =>
  value !== undefined && /!\s*important\s*$/i.test(value)

/** A prelude that is exactly one `max-width` media query, in px — or `null`. */
const maxWidthOnly = (at) => {
  if (at.length !== 1) return null
  const match = /^@media\s*\(\s*max-width:\s*([\d.]+)(rem|px|em)\s*\)$/i.exec((at[0] ?? '').trim())
  if (match?.[1] === undefined) return null
  const size = Number(match[1])
  return match[2]?.toLowerCase() === 'px' ? size : size * 16
}

/**
 * At-rules that make a rule conditional — everything except a cascade layer.
 *
 * This was an allowlist of `@media|@supports|@container`, which is a loosening rather than a
 * fix: `@scope (.salt-card)` restricts a floor to cards and passed, and at-rule keywords are
 * ASCII case-insensitive so `@MEDIA` passed too. A denylist cannot be got at that way — a
 * new conditional at-rule is conditional here by default, which is the safe direction for a
 * gate to be wrong in.
 */
const conditional = (at) =>
  at.filter((query) => !/^@layer\b/i.test(query))

/**
 * One policy for conditional rules, because two contracts took opposite positions on them
 * in the same commit and both were wrong in one direction.
 *
 * PRESENCE — "does this exist" — must be satisfied UNCONDITIONALLY. A floor that only
 * applies inside `@media print` is not a floor.
 *
 * OVERRIDE — "does anything undo it" — must consider conditional rules too, because an
 * override inside a media query is exactly how a value gets undone. Filtering them out let
 * `@media (min-width: 40rem) { .salt-card { border-color: var(--color-border) } }` reinstate
 * BD-033's 10.173:1 outline at every desktop viewport, green.
 *
 * The single exception is forced colours, where the user's palette is meant to win and a
 * rule departing from the tokens is the repair rather than the defect. Anything else is
 * caught. The rich-text contract already had this split; the two added here did not.
 */
/**
 * Applies ONLY under forced colours — the one place a rule may leave the palette behind.
 *
 * Three versions of this. `includes('forced-colors: active')` was true of preludes meaning
 * the opposite: `@media not (…)` applies to everyone NOT in forced colours, and
 * `@media (…), (min-width: 40rem)` applies to everyone above 40rem, so the exemption was the
 * escape. Anchoring the WHOLE prelude closed those and rejected conjunctions, which are
 * strictly NARROWER — `@media (forced-colors: active) and (prefers-contrast: more)` is a
 * legitimate repair, and failing it tells its author to undo the thing making the band
 * visible, which is the outcome the exemption exists to prevent.
 *
 * So: the term must be present, unnegated, and not one branch of an alternation. `and` is
 * fine because it narrows; `not` and `,` are not because they widen.
 */
const forcedColours = (at) =>
  at.some((query) => {
    const prelude = query.trim()
    if (!/^@media\b/i.test(prelude)) return false
    if (/\bnot\b/i.test(prelude) || prelude.includes(',')) return false
    return /\(\s*forced-colors\s*:\s*active\s*\)/i.test(prelude)
  })

/**
 * A selector with its negations removed, brackets and all.
 *
 * `:not\([^()]*\)` cannot match a negation containing parentheses — `:not(:is(a, b))` — and
 * this file's own `targetsElement` docstring records that exact flaw before repeating it in
 * two more helpers. A depth-aware scan handles every spelling rather than the flat one it
 * was written against.
 */
/**
 * Applies ONLY where the reader has NOT asked for reduced motion.
 *
 * Written in `forcedColours`'s shape, and for the lesson that helper records: a substring
 * test on the prelude is true of preludes meaning the opposite. `@media not
 * (prefers-reduced-motion: no-preference)` applies to exactly the readers who asked for less
 * motion, and `@media (prefers-reduced-motion: no-preference), (min-width: 40rem)` applies to
 * everyone above 40rem — so both would have been excused by the obvious `includes` check.
 *
 * The term must be present, unnegated, and not one branch of an alternation — `,` in
 * Media Queries 3 and `or` in Media Queries 4, which widen identically. `or` was missed on
 * the first rewrite: `@media ((prefers-reduced-motion: no-preference) or (min-width: 1px))`
 * left the gate green with the track computing `smooth` under forced reduced motion.
 *
 * `and` is allowed, because it only NARROWS: a second condition is one somebody meant, and
 * the rule still cannot apply to a reader who asked for less motion. (An earlier version of
 * this paragraph said the opposite of the code beneath it — that `and` was rejected — which
 * is how a maintainer comes to believe a correct spelling is refused.)
 */
const welcomesMotion = (at) =>
  at.some((query) => {
    const prelude = query.trim()
    if (!/^@media\b/i.test(prelude)) return false
    /* `not` and `,` WIDEN a query — the first to everyone outside it, the second to everyone
       matching either branch — so neither can be excused. `and` only narrows, and a
       narrowing is a second condition somebody meant. Exactly `forcedColours`'s rule, for
       exactly its reason. */
    if (/\bnot\b/i.test(prelude) || /\bor\b/i.test(prelude) || prelude.includes(',')) return false
    return /\(\s*prefers-reduced-motion\s*:\s*no-preference\s*\)/i.test(prelude)
  })

const stripNegationsUnmemoised = (selector) => {
  let out = ''
  let i = 0
  while (i < selector.length) {
    /* Case-insensitively, as CSS reads pseudo-class names: `:NOT(.salt-card)` is a negation, and
       reading it as naming the card was a false claim (#225 re-review). */
    if (selector.slice(i, i + 5).toLowerCase() === ':not(') {
      let depth = 0
      let j = i + ':not'.length
      for (; j < selector.length; j += 1) {
        if (selector[j] === '(') depth += 1
        else if (selector[j] === ')') {
          depth -= 1
          if (depth === 0) break
        }
      }
      i = j + 1
      continue
    }
    out += selector[i] ?? ''
    i += 1
  }
  return out
}
const stripNegations = memo(stripNegationsUnmemoised)

/**
 * A selector with every `:is()` and `:where()` group removed, brackets and all.
 *
 * `stripNegations` is the same walk over `:not()`, and the reason for a second one is that
 * the two answer opposite questions. A negation is stripped so a rule still reads as reaching
 * what it generally governs. These are stripped so a contract can ask whether what remains
 * names something DIRECTLY: `.salt-gallery:where([data-layout='masonry'])` mentions the
 * attribute without selecting on it at any weight, and a checker reading the raw string
 * cannot tell that from `.salt-gallery[data-layout='masonry']`.
 *
 * Depth-aware, so a nested functional pseudo — `:is(:not(.a), [b])` — is removed whole rather
 * than at the first `)`. The name is matched case-insensitively because CSS pseudo-class
 * names are ASCII case-insensitive, and `:WHERE(` is the same selector: the allowlist-versus-
 * denylist lesson `conditional()` already records, in a second place it could be got at.
 */
const stripMatchesAny = (selector) => {
  const NAMES = [':is(', ':where(']
  let out = ''
  let i = 0
  while (i < selector.length) {
    const name = NAMES.find(
      (candidate) => selector.slice(i, i + candidate.length).toLowerCase() === candidate,
    )
    if (name !== undefined) {
      let depth = 0
      let j = i + name.length - 1
      for (; j < selector.length; j += 1) {
        if (selector[j] === '(') depth += 1
        else if (selector[j] === ')') {
          depth -= 1
          if (depth === 0) break
        }
      }
      i = j + 1
      continue
    }
    out += selector[i] ?? ''
    i += 1
  }
  return out
}

/**
 * `:is(X)` and `:where(X)`, where that group is the WHOLE compound and `X` is one simple
 * selector, replaced by `X`. Everything else is returned untouched.
 *
 * The opposite of `stripMatchesAny`, and wanted for a different question. That one asks what
 * a selector WEIGHS, so it deletes the group. This one asks what a selector MATCHES, and for
 * that `:where(.salt-theme-toggle)` and `.salt-theme-toggle` are the same set of elements.
 * Without it, a reset spelled the way this repository already spells its resets —
 * `:where(.salt-intro)` in `sections.css` — is refused by any check looking for a `:` in the
 * key compound, which reads as "the placeholder cannot carry that condition" when there is
 * no condition at all.
 *
 * ── Why "the whole compound" is the condition, and not a tidy-up of one ─────────
 *
 * The first version of this replaced the group WHEREVER it appeared, on the argument that
 * `:where(X)` and `X` match the same elements. That is true of the case it considered and
 * false of the case it did not. In any position but the first, a functional pseudo-class is
 * a NARROWING of the compound it sits in, and splicing its argument into the neighbouring
 * text hides the narrowing instead of exposing it: `.salt-theme-toggle:where(button)` came
 * out as `.salt-theme-togglebutton`, in which `compoundType` — anchored at the start — sees
 * no element type, and no `[` or `:` survives for the condition test either. Three mutations
 * of `chrome.css` passed at exit 0 because of it, `:where(button)`, `:is(button)` and
 * `:where(.is-mounted)`, every one of them the collapsed-placeholder edit the hit-area
 * contract exists to refuse. `button:where(.salt-theme-toggle)` was still caught, which is
 * what made it easy to miss: the spelling that reads as obviously wrong was refused and the
 * spelling that reads as tidy was not — and `:where(button)` is the MORE attractive way to
 * write that edit, because it qualifies without raising specificity.
 *
 * Measured in headless Chromium 148.0.7778.96 on 22/09/2026: the server's
 * `<span class="salt-theme-toggle" aria-hidden="true">` is 44.00 x 44.00 under the committed
 * rule and 0.00 x 18.00 under `.salt-theme-toggle:where(button)`.
 *
 * So: the group has to BE the compound. Anything with a neighbour is left exactly as it was,
 * and the `[`/`:` test downstream goes on refusing it. Anything with a comma, a combinator,
 * whitespace or a nested group inside is left alone too, because `:is(.a, .b)` and
 * `:where(.a .b)` change what matches.
 */
const unwrapMatchesAnyUnmemoised = (compound) => {
  /* Anchored at both ends: the group is the entire compound or nothing happens. `[^()]*`
     refuses a nested group, which also stops the greedy read of `:where(.a):is(.b)` — two
     compounds' worth of text that would otherwise look like one group's argument.

     One pass, not a loop. `[^()]*` means whatever comes out has no parentheses in it, so a
     second pass can never match and `:where(:where(.salt-theme-toggle))` is refused rather
     than unwrapped twice. That is a false failure — the browser measures that selector at
     44.00 x 44.00 — and it is the safe direction, so it is left rather than recursed into. */
  const inner = /^:(?:is|where)\(([^()]*)\)$/i.exec(compound)?.[1]?.trim()
  if (inner === undefined || inner === '' || /[,>+~\s]/.test(inner)) return compound
  return inner
}
const unwrapMatchesAny = memo(unwrapMatchesAnyUnmemoised)

/**
 * A selector's specificity, as `[id, class, type]`.
 *
 * ── Why a contract needs this rather than the selector's text ───────────────────
 *
 * Specificity is the thing a cascade tie is decided by, and it is not visible in a substring.
 * `.salt-intro`, `:where(.salt-intro)` and `.salt-block > .salt-intro` all mention the same
 * class and rank differently against the same competing rule — which is the defect this file
 * gained a contract for: a reset written at (0,1,0) against an owl at (0,1,0) left the import
 * order deciding, and one order took the gap away. Asserting the literal text instead would
 * fail a rename for the wrong reason and would still pass `.salt-block > .salt-intro`, which
 * is a different wrong answer.
 *
 * ── What it counts ──────────────────────────────────────────────────────────────
 *
 * Selectors Level 4, §17. `#id` is an id; a class, an attribute and a plain pseudo-class are
 * class-level; a type and a pseudo-ELEMENT are type-level; `*` and a combinator are nothing.
 *
 * `:where()` contributes zero whatever is inside it, which is the whole point of the
 * contract. `:is()`, `:not()` and `:has()` contribute the specificity of their MOST specific
 * argument, so `:not(#a)` is an id — a selector that reads as a negation and ranks as an
 * identifier. Names are lower-cased before the comparison because CSS pseudo-class names are
 * ASCII case-insensitive and `:WHERE(` is the same selector, the lesson `stripMatchesAny`
 * already records one function along.
 *
 * `:nth-child(n of S)` adds its argument's specificity to its own, which nothing here uses
 * and which is counted anyway rather than silently dropped.
 *
 * Attribute VALUES are skipped rather than parsed: `[data-block='salt-intro']` must not read
 * as a class, and a `)` or `.` inside a quoted value must not end a group or start one.
 *
 * CSS escapes are not handled — `.a\\.b` is one class and this counts two, and the same goes
 * for an escaped `#` or `[`. Left alone deliberately rather than overlooked: every way an
 * escape is misread ADDS weight, and the only question a caller asks of this function is
 * whether the total is above zero. An over-count can therefore never turn a failing selector
 * into a passing one; at worst it puts a wrong number in a message that is already right
 * about the verdict. Nothing in these stylesheets uses an escape.
 */
/**
 * Does `a` beat `b` on weight alone?
 *
 * One comparison, used by the matches-any arm below and by the contract that has to decide
 * which of two rules wins a cascade. Written out once because the three-column compare is
 * exactly the kind of thing that gets transcribed with one `>` the wrong way round.
 */
const outranks = (
  a,
  b,
) => {
  for (let i = 0; i < 3; i += 1) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0)
    if (difference !== 0) return difference > 0
  }
  return false
}

const specificity = (selector) => {
  const total = [0, 0, 0]
  const add = (other) => {
    total[0] += other[0]
    total[1] += other[1]
    total[2] += other[2]
  }
  /* The most specific of a comma-separated argument list, which is what a matches-any
     pseudo-class contributes. An empty list contributes nothing. */
  const widest = (argument) => {
    let best = [0, 0, 0]
    for (const part of splitTop(argument, ',')) {
      const here = specificity(part)
      /* An argument this cannot rank makes its parent unrankable too, rather than
         contributing nothing and quietly under-counting the whole selector. */
      if (here === null) return null
      if (outranks(here, best)) best = here
    }
    return best
  }
  /* The index just past the group opening at `from`, and the group's contents. */
  const group = (from) => {
    let depth = 0
    let j = from
    for (; j < selector.length; j += 1) {
      const char = selector[j]
      if (char === "'" || char === '"') {
        const quote = char
        j += 1
        while (j < selector.length && selector[j] !== quote) j += 1
        continue
      }
      if (char === '(') depth += 1
      else if (char === ')') {
        depth -= 1
        if (depth === 0) break
      }
    }
    return { inner: selector.slice(from + 1, j), end: j + 1 }
  }

  const ZEROED = ['where']
  const WIDEST = ['is', 'not', 'has', 'matches', '-moz-any', '-webkit-any']
  const NAME = /^[\w\u00a0-\uffff-]+/

  let i = 0
  while (i < selector.length) {
    const char = selector[i]
    if (char === undefined) break

    if (char === '[') {
      /* Quote-aware, so a `]` inside a value does not close the attribute early. */
      let j = i + 1
      while (j < selector.length && selector[j] !== ']') {
        const quote = selector[j]
        if (quote === "'" || quote === '"') {
          j += 1
          while (j < selector.length && selector[j] !== quote) j += 1
        }
        j += 1
      }
      /* Ran off the end without a `]`. The selector is malformed, and counting the fragment
         as one attribute is a number invented from a shape nothing can mean. */
      if (j >= selector.length) return null
      add([0, 1, 0])
      i = j + 1
      continue
    }

    if (char === '#') {
      const name = NAME.exec(selector.slice(i + 1))
      add([1, 0, 0])
      i += 1 + (name?.[0].length ?? 0)
      continue
    }

    if (char === '.') {
      const name = NAME.exec(selector.slice(i + 1))
      add([0, 1, 0])
      i += 1 + (name?.[0].length ?? 0)
      continue
    }

    if (char === ':') {
      /* A pseudo-ELEMENT first: `::before` starts with the same character and ranks as a
         type, and reading it as a pseudo-class would over-count it by a whole column. */
      const isElement = selector[i + 1] === ':'
      const start = i + (isElement ? 2 : 1)
      const name = NAME.exec(selector.slice(start))?.[0] ?? ''
      let after = start + name.length
      let inner = null
      if (selector[after] === '(') {
        const found = group(after)
        /* `group` returns what it found even when the brackets never close, so the
           unbalanced case is caught here rather than ranked on a truncated argument. */
        if (found.end > selector.length) return null
        inner = found.inner
        after = found.end
      }
      const lowered = name.toLowerCase()
      if (isElement) add([0, 0, 1])
      else if (ZEROED.includes(lowered)) {
        /* Nothing, whatever is inside. This is the branch the intro's reset depends on. */
      } else if (WIDEST.includes(lowered)) {
        const inside = widest(inner ?? '')
        if (inside === null) return null
        add(inside)
      } else {
        add([0, 1, 0])
        /* `:nth-child(2 of .a)` is its own class-level weight plus its argument's. */
        const of = /\bof\b([\s\S]+)$/.exec(inner ?? '')
        if (of?.[1] !== undefined) {
          const inside = widest(of[1])
          if (inside === null) return null
          add(inside)
        }
      }
      i = after
      continue
    }

    if (char === '*' || char === '>' || char === '+' || char === '~' || char === ',' || /\s/.test(char)) {
      i += 1
      continue
    }

    const name = NAME.exec(selector.slice(i))?.[0]
    if (name === undefined) {
      /* Anything that is not a combinator, a `*`, or the start of a name. Skipping it was
         the one place this counted silently: the character contributed nothing, the total
         came back short, and a caller compared it against a rival as though it were whole. */
      return null
    }
    /* A bare identifier here is a type selector — or a namespace prefix, which `|` separates
       and which contributes nothing of its own. */
    if (selector[i + name.length] === '|') {
      i += name.length + 1
      continue
    }
    add([0, 0, 1])
    i += name.length
  }
  return total
}

/**
 * Does this selector target an attribute value, rather than merely mention it?
 *
 * `includes("[data-tone='surface']")` is true of `:not([data-tone='surface'])`, which is the
 * rule for every OTHER tone. Both directions were reachable: a dark block rewritten that way
 * left its tone with no hairline and the gate green, and a correct narrowing was reported as
 * a defect.
 */
const targetsAttribute = (selector, attribute, value) =>
  stripNegations(selector).includes(`[${attribute}='${value}']`)

/**
 * The two axes, each with BOTH spellings that set it.
 *
 * `min-height` and `min-block-size` are separate properties resolving to the same used
 * value, so `min-height: 0` on a more specific rule cancels a `min-block-size` floor and a
 * contract keyed on one spelling never sees the declaration at all. Same class as every
 * other defect in this contract's history: asking about a spelling rather than an effect.
 */
const AXES = [
  {
    name: 'the height',
    properties: ['min-block-size', 'min-height'],
    parts: ['.salt-button'],
    who: 'the base `.salt-button` rule',
    because: 'every button needs a height floor, not just the icon-only ones',
  },
  {
    name: 'the width',
    properties: ['min-inline-size', 'min-width'],
    parts: ['.salt-button', '[data-icon-only]'],
    who: 'a rule reaching every `[data-icon-only]` button',
    because: "a button's width comes from its content, and one glyph is not 24px wide",
  },
]

const ALL_PROPERTIES = AXES.flatMap((axis) => axis.properties)

const matching = (rules, predicate) =>
  rules.filter((rule) => rule.selectors.some(predicate))

/* Every declaration of the named properties in a rule, in the order written, duplicates and all. */
const declarationsOf = (rule, names) =>
  rule.order.map((property, at) => ({ property: property.toLowerCase(), value: rule.values[at] ?? '' })).filter(({ property }) => names.has(property))

/**
 * A selector as its compounds, outermost first, and the combinator before each after the first: `' '`,
 * `'>'`, `'+'` or `'~'`. Read from the normalised spelling, which spaces every combinator.
 */
const chainOfUnmemoised = (selector) => {
  const compounds = []
  const combinators = []
  let pending = ' '
  for (const token of splitTop(normalise(selector), ' ')) {
    if (token === '>' || token === '+' || token === '~') {
      pending = token
      continue
    }
    if (compounds.length > 0) combinators.push(pending)
    compounds.push(token)
    pending = ' '
  }
  return { compounds, combinators }
}
const chainOf = memo(chainOfUnmemoised)

/**
 * Can this selector reach an element whose parent is `parent`'s compound, when the element's own
 * compound requires `key`'s classes (#211 re-review, 1)?
 *
 * The first of these pins read the rule that owns a declaration and stopped there, so a later rule,
 * or a more specific one, setting the same property on the same element passed. Answering "which
 * rules reach the element" exactly is a cascade engine, which this file refuses to be; this answers
 * it from the selector's last two compounds, erring towards "reaches". The key compound reaches the
 * element when it requires the element's class or no class at all (`svg`, `*`, `:first-child`). The
 * compound before it reaches the parent through `>` only when it requires the parent's class or none,
 * through a descendant space always, and through `+` or `~` never, since each element pinned here
 * has no element sibling before it. Classes inside `:not()` are taken out first.
 */
const reachesChild = (selector, key, parent) => {
  const { compounds, combinators } = chainOf(stripNegations(selector))
  const own = compounds.at(-1)
  if (own === undefined) return false
  const ownClasses = requiredClasses(own)
  if (key === null ? ownClasses.size > 0 : !(ownClasses.size === 0 || ownClasses.has(key))) return false
  /* One compound names no parent, so it reaches the element wherever it sits: `.salt-icon` is every icon. */
  if (compounds.length === 1) return true
  const combinator = combinators.at(-1)
  if (combinator === '+' || combinator === '~') return false
  if (parent === null) return true
  if (combinator === '>') {
    const above = requiredClasses(compounds.at(-2) ?? '')
    return above.size === 0 || above.has(parent)
  }
  return compounds.slice(0, -1).some((compound) => requiredClasses(compound).has(parent) || requiredClasses(compound).size === 0)
}

/**
 * Every declaration of `names`, in every stylesheet and every at-rule, on a selector that reaches the
 * pinned element and ranks with or above `floor`, the owner's specificity, apart from the owners'
 * own. An `!important` one is returned whatever its rank, and a selector this file cannot rank is
 * returned as if it outranked, so neither passes unread.
 */
const overriders = (
  all,
  reaches,
  owners,
  floor,
  names,
) => {
  const found = []
  for (const [file, rules] of all) {
    for (const rule of rules) {
      if (owners.has(rule)) continue
      for (const selector of rule.selectors) {
        if (!reaches(selector)) continue
        const rank = specificity(selector)
        for (const { property, value } of declarationsOf(rule, names)) {
          if (!isImportant(value) && rank !== null && outranks(floor, rank)) continue
          found.push({ where: `\`${selector}\`${rule.at.length > 0 ? ` inside \`${rule.at.join(' ')}\`` : ''} in ${file}`, property, value })
        }
      }
    }
  }
  return found
}

/**
 * A hit-area floor written as `max(…)`: the expression and its px and rem terms, read with the
 * function, the units and the numbers in any case (#211 re-review, 2), or `null` when there is no
 * `max()`. Three contracts carried their own copy of this regex, lower case only, so `MAX(2.75rem,
 * 24PX)`, which a browser reads as the same floor, was called missing; they share this one now.
 */
const readFloor = (value) => {
  const expression = /\bmax\((?:[^()]|\([^()]*\))*\)/i.exec(value)?.[0]
  if (expression === undefined) return null
  const terms = (unit) =>
    [...expression.matchAll(new RegExp(`(\\d+(?:\\.\\d+)?|\\.\\d+)${unit}(?![\\w-])`, 'gi'))].map((match) => Number(match[1]))
  return { expression, px: terms('px'), rem: terms('rem'), unread: /var\(|calc\(|env\(/i.test(expression) }
}

/** Does a floor reach WCAG 2.5.8's 24 CSS px in its px term, whatever the root size? */
const reachesTargetFloor = (floor) => floor.px.some((px) => px >= 24)

/** One keyword, in any case, or `null` for a value that is not one bare keyword, such as a `var()`. */
const keyword = (value) => {
  const word = value.trim()
  return /^[a-z-]+$/i.test(word) ? word.toLowerCase() : null
}

/**
 * A `scale` as its three factors, `none` being `1 1 1`, one number both axes and a percentage a
 * hundredth, or `null` for a spelling this does not read, a `var()` or a `calc()` (#211 re-review, 2).
 */
const scaleFactors = (value) => {
  if (keyword(value) === 'none') return [1, 1, 1]
  const parts = value.trim().split(/\s+/)
  if (parts.length > 3) return null
  const numbers = parts.map((part) => {
    const match = /^(-?(?:\d+(?:\.\d+)?|\.\d+))(%?)$/.exec(part)
    return match === null ? null : Number(match[1]) / (match[2] === '%' ? 100 : 1)
  })
  if (numbers.some((n) => n === null)) return null
  const [x = 1, y = x, z = 1] = numbers
  return [x, y, z]
}

/**
 * A rule's block-start and block-end margins as it leaves them, reading `margin`, `margin-block`, the
 * two longhands and the physical `margin-top` and `margin-bottom`, later over earlier (#211 re-review,
 * 2), and whether any of them is a spelling this does not read, a `var()` or a `calc()`.
 */
const blockEdges = (rule) => {
  let start
  let end
  let unread = false
  for (const { property, value } of declarationsOf(rule, new Set(['margin', 'margin-block', 'margin-block-start', 'margin-block-end', 'margin-top', 'margin-bottom']))) {
    if (/var\(|calc\(|env\(/i.test(value)) unread = true
    const parts = value.replace(/!\s*important\s*$/i, '').trim().split(/\s+/)
    if (property === 'margin') {
      start = parts[0]
      end = parts.length >= 3 ? parts[2] : parts[0]
    } else if (property === 'margin-block') {
      start = parts[0]
      end = parts[1] ?? parts[0]
    } else if (property === 'margin-block-start' || property === 'margin-top') start = parts[0]
    else end = parts[0]
  }
  return { start, end, unread }
}

/* The five a role sets, and the CSS property each reads, from `textRoleDeclarations` above: the
   spelling base.css is written in, so the two cannot spell a role differently. */
const ROLE_PROPERTIES = new Set(textRoleDeclarations('body').map(({ property }) => property))

/* A `var()` of one custom property, in the one spelling `type.ts` writes, however it is spaced or
   cased: every check reading a role reads through this, so one cannot call a declaration missing
   that another accepted (#190 review, LOW 2). */
const spelled = (value) => {
  const token = /^var\(\s*(--[\w-]+)\s*\)$/i.exec(value.replace(/\s+/g, ' ').trim())
  return token === null ? null : `var(${token[1] ?? ''})`
}

/* Which role, and which of its five properties, each spelling belongs to. */
const ROLE_OWNER = new Map(
  TEXT_ROLES.flatMap((role) =>
    textRoleDeclarations(role).map(({ property, value }) => [value, { role, property }]),
  ),
)

/*
 * The rules allowed to set text on an element they name by no class, each by its selector: the card's
 * title and the hero's headline, whose elements are headings of any level; rich text's blockquote,
 * which an editor's document draws with no class; and inline code's proportion, excused by the contract
 * above. Any other such rule is refused (#198 review, F4): `.salt-nav a { … }` reaches a menu link
 * without naming its class, so the component contract could not see it take the link back to `body`.
 *
 * And base.css's element convention, which Salt for Next.js's `theme.css` applied in `@layer base`:
 * excused only in base.css and only inside its `@layer base` block, where every unlayered rule
 * outranks it. The same selector anywhere else, or unlayered, would set text past every component.
 */
const CLASSLESS_SUBJECTS = new Set(
  ['.salt-card :is(h1, h2, h3, h4, h5, h6)', '.salt-hero__text > :is(h1, h2, h3, h4, h5, h6)', '.salt-rich-text blockquote', '.salt-rich-text code'].map(
    (selector) => normalise(selector),
  ),
)
const BASE = ':where(#main, .salt-header, .salt-footer)'
const BASE_SUBJECTS = new Set(['body', `${BASE} h1`, `${BASE} h2`, `${BASE} h3`, `${BASE} :is(h4, h5, h6)`].map((selector) => normalise(selector)))
const inBaseLayer = (file, rule) => file === 'base.css' && rule.at.length === 1 && /^@layer\s+base$/i.test(rule.at[0].trim())

/* The controls whose `font: inherit` is excused, each by its selector. */
const INHERITING_CONTROLS = ['.salt-contact__input', '.salt-search__input']

/**
 * Every component core sets in a text role, and the role: BD-173's, MR-4's by Ollie's ruling of
 * 26/09/2026, the four his ruling of 28/09/2026 added (BD-185), a case study's detail labels
 * (BD-178), and the footer's column titles and links, moved to `heading-4` and `small` by his ruling
 * of 30/09/2026 (BD-195). The selector is the one the component's own rule is written with, exactly,
 * because the contract asks for that rule rather than modelling which others reach the element.
 */
const COMPONENT_ROLES = [
  { file: 'primitives.css', selector: '.salt-button', role: 'label' },
  { file: 'chrome.css', selector: '.salt-nav__link', role: 'label' },
  { file: 'chrome.css', selector: '.salt-nav__sublink', role: 'label' },
  { file: 'chrome.css', selector: '.salt-header__phone', role: 'label' },
  { file: 'blocks.css', selector: '.salt-gallery__caption', role: 'caption' },
  { file: 'blocks.css', selector: '.salt-showcase__meta', role: 'small' },
  { file: 'blocks.css', selector: '.salt-showcase__quote .salt-showcase__text', role: 'quote' },
  { file: 'primitives.css', selector: '.salt-intro', role: 'lead' },
  { file: 'blocks.css', selector: '.salt-hero__subheading', role: 'lead' },
  { file: 'chrome.css', selector: '.salt-footer__link', role: 'small' },
  { file: 'primitives.css', selector: '.salt-pagination__link', role: 'label' },
  { file: 'primitives.css', selector: '.salt-pagination__gap', role: 'label' },
  { file: 'primitives.css', selector: '.salt-share__link', role: 'label' },
  { file: 'primitives.css', selector: '.salt-copy-link__button', role: 'label' },
  { file: 'primitives.css', selector: '.salt-rich-text blockquote', role: 'quote' },
  { file: 'primitives.css', selector: '.salt-eyebrow', role: 'eyebrow' },
  { file: 'blocks.css', selector: '.salt-stat__value', role: 'stat' },
  { file: 'blocks.css', selector: '.salt-hero__text > :is(h1, h2, h3, h4, h5, h6)', role: 'display' },
  { file: 'primitives.css', selector: '.salt-card :is(h1, h2, h3, h4, h5, h6)', role: 'heading-4' },
  { file: 'primitives.css', selector: '.salt-accordion__summary', role: 'heading-4' },
  { file: 'primitives.css', selector: '.salt-consent-panel__title', role: 'heading-4' },
  { file: 'chrome.css', selector: '.salt-logo__wordmark', role: 'heading-4' },
  { file: 'primitives.css', selector: '.salt-tabs__label', role: 'label' },
  { file: 'primitives.css', selector: '.salt-contact__label', role: 'label' },
  { file: 'chrome.css', selector: '.salt-footer__title', role: 'heading-4' },
  { file: 'primitives.css', selector: '.salt-case-study-view__detail-label', role: 'label' },
]

/**
 * Does this selector match a focused element? `:focus-visible` inside a `:not()` is the opposite
 * state, and the invalid contact field's inset is scoped `:not(:focus-visible)` precisely to stay
 * out of the focus indicator's way (BD-167), so a negation is taken out before asking. Reading the
 * substring alone held that rule to the indicator's whole geometry.
 */
const focuses = (selector) => withoutNegations(selector).includes(':focus-visible')

/**
 * A layout of `.salt-grid` that must run in ONE column, whatever the shared grid is set to.
 *
 * `process`'s timeline was the first, with its contract written inline; `collectionShowcase`'s
 * list is the second, so the check is shared rather than copied — this repository's rule is that
 * a class of finding appearing twice is a gate's job the third time, and a copied contract is two
 * places for the next defeat to be fixed in one of. The checks are the timeline's, unchanged:
 * `layout`, `family` and the two phrases below are the only parts that ever named it.
 */

const oneColumnLayout =
  ({ layout, family, noun, laidOut }) =>
  (rules) => {
    const LAYOUT = `[data-layout='${layout}']`
    const COLUMNS = '--salt-grid-columns'
    /* Every class in the block starts with it, so one substring gathers the family. */
    const FAMILY = family

    const named = matching(rules, (selector) =>
      targetsAttribute(selector, 'data-layout', layout),
    )
    if (named.length === 0) return `no rule names \`${LAYOUT}\``

    /*
     * PRESENCE, unconditional and singular — BD-041's position rather than a cascade
     * model, and the same shape the masonry layout and the media-and-text flip take. A
     * one-column layout that is one column only inside a media query is one at some widths,
     * and two rules setting the count is a rank this checker refuses to attempt.
     */
    const [rule, ...extra] = named.filter(
      (candidate) =>
        conditional(candidate.at).length === 0 && candidate.declarations[COLUMNS] !== undefined,
    )
    if (rule === undefined) return `no unconditional rule declares \`${COLUMNS}\` on \`${LAYOUT}\``
    if (extra.length > 0) {
      return `${String(extra.length + 1)} unconditional rules declare \`${COLUMNS}\` on \`${LAYOUT}\`; it is written once so that no contract here has to decide which of them wins`
    }
    const written = rule.selectors[0] ?? ''
    const value = rule.declarations[COLUMNS] ?? ''

    /* `!important` FIRST, before the value is compared to anything. `--salt-grid-columns:
       1 !important` is correct CSS, and reporting it as a value that does not read `1` is
       the positive false claim this file has shipped six times, each one sending somebody
       to undo a rule that was right. */
    if (isImportant(value)) {
      return `\`${written}\` declares \`${COLUMNS}\` !important, which no contract here can rank`
    }

    /*
     * A plain integer is the only spelling this reads, and the refusal is a THIRD verdict
     * rather than a pass. `var(--steps)`, a `calc()` and the `revert` keywords are all
     * legal here — a custom property takes any token sequence at all — and passing over
     * one would be a claim to have checked something this cannot evaluate.
     *
     * Case-insensitively, for the keyword arms: CSS is ASCII case-insensitive and a
     * `REVERT` refused with a message about integers would be a false claim of a different
     * shape. Trimmed first, because the parser keeps the value as written.
     */
    const count = value.trim().toLowerCase()
    if (!/^\d+$/.test(count)) {
      return `\`${written}\` writes \`${COLUMNS}: ${value}\`, which this contract reads only as a plain integer — widen it deliberately rather than assuming which way it falls`
    }
    if (Number(count) !== 1) {
      return `\`${written}\` declares \`${COLUMNS}: ${value}\`, so ${noun} is laid out in ${count} columns — ${laidOut}`
    }

    /*
     * ── The subject: how the layout is NAMED ──────────────────────────────────────
     *
     * The masonry contract's question, for the reason it records. `.salt-grid` declares
     * the same variable at (0,1,0), so a rule spelled
     * `.salt-process:where([data-layout='timeline'])` scores (0,1,0) too — `:where()`
     * contributes nothing — and a tie is broken by source order alone. This cannot rank a
     * tie; it can read whether the attribute is selected on directly, which is the
     * spelling that makes the tie impossible.
     */
    const softened = rule.selectors.filter(
      (selector) =>
        targetsAttribute(selector, 'data-layout', layout) &&
        !targetsAttribute(stripMatchesAny(selector), 'data-layout', layout),
    )
    if (softened.length > 0) {
      return `\`${softened[0] ?? ''}\` names \`${LAYOUT}\` inside \`:is()\` or \`:where()\` rather than selecting on it. \`:where()\` contributes NO specificity, which ties this rule with \`.salt-grid\` at (0,1,0) and leaves source order to decide; \`:is()\` scores as its most specific argument, a sum this contract does not compute and so does not accept either. Write the attribute selector plainly`
    }

    /*
     * OVERRIDE, over CONDITIONAL rules as well as unconditional ones. A second rule
     * setting the count on this block inside a media query is exactly how a value gets
     * undone, and three contracts in this file shipped without that half and fell to one.
     * The tempting version here is real: a wide-viewport rule putting a long timeline into
     * two columns would be a second `--salt-grid-columns` on the same element.
     */
    for (const other of rules) {
      if (other === rule) continue
      if (!other.selectors.some((selector) => stripNegations(selector).includes(FAMILY))) continue
      const again = other.declarations[COLUMNS]
      if (again === undefined) continue
      const where = other.at.length === 0 ? '' : ` inside \`${other.at.join(' ')}\``
      return `\`${other.selectors[0] ?? ''}\`${where} declares \`${COLUMNS}: ${again}\` as well, and this contract does not rank two rules — the column count of ${noun} is written once, unconditionally`
    }

    /*
     * ── What this cannot see, named rather than half-defended ─────────────────────
     *
     * It does not know that the element also carries `.salt-grid`, that `.salt-grid` sets
     * the same variable to 3, or that the reflow steps set it to 2 and 1 inside media
     * queries. Those rules do not name the block's family, so the sweep above never gathers
     * them, and the argument that this rule beats all three — an attribute selector at
     * (0,2,0) against (0,1,0), with a media query contributing no specificity — is written
     * in the stylesheet rather than modelled here. Ranking it is the cascade, which this
     * file's header rules out and BD-041 records five rounds of failing to fake.
     *
     * It does not know that one column is what the layout's paint needs, such as the
     * timeline's connector. That is a paint question and it stays WP13's, as the masonry
     * contract's own limits say.
     *
     * The timeline's connector itself — the `border-inline-start` beside the steps — is
     * deliberately NOT under contract. It is decoration: deleting it leaves a timeline that is
     * still a single ordered column, which is the property that block's markup depends on, and
     * a contract over every declaration in a block is how a stylesheet becomes unchangeable.
     *
     * And the standing limit of every contract in this file: rules are gathered by looking
     * for a class NAME in a selector, so one reaching this element without naming it is
     * invisible. BD-040 records that as a different tool. Left, and named.
     */
    return null
  }

const CONTRACTS = [
  {
    file: 'blocks.css',
    what: 'the column grid steps down to one column on a narrow viewport',
    why:
      'WCAG 1.4.10 asks for reflow at 320 CSS pixels with no second scrollbar, and 1.4.4 asks ' +
      'the same of 200% zoom, which a browser reports as a narrower viewport. Four cards ' +
      'across 320px gives each 62px \u2014 a title breaking mid-word, an icon wider than ' +
      'its column. The markup is identical at every width, so nothing in the suite can see it ' +
      'and only the paint differs. The editor\u2019s column count is a maximum, and these steps ' +
      'are the reason that is true.',
    check: (rules) => {
      /* Every rule that touches the grid, whatever else its selector carries. */
      const grid = rules.filter((rule) =>
        rule.selectors.some((selector) => stripNegations(selector).includes('.salt-grid')),
      )
      if (grid.length === 0) return 'no rule reaches `.salt-grid`'

      /* PRESENCE, unconditional: it is a grid at all. The track list and the count are
         asserted below, on the one rule the shape walk identifies as the base. */
      const unconditional = grid.filter((rule) => conditional(rule.at).length === 0)
      const isGrid = unconditional.some((rule) => {
        const display = rule.declarations['display']
        return display === 'grid' || display === 'inline-grid'
      })
      if (!isGrid) return 'no unconditional rule makes the grid a grid'

      /**
       * ── The shapes a rule may take, instead of a model of what wins ─────────
       *
       * Every rule that sets the column count or the track list must be spelled one of
       * three ways. Anything else fails, because anything else is a rule this checker
       * cannot rank — and a rule it cannot rank is one it must not silently pass.
       *
       *   the base       `.salt-grid`, no at-rule
       *   an editor's choice  `.salt-grid:where([data-columns='N'])`, no at-rule
       *   a step         `.salt-grid` inside exactly one `max-width` media query
       *
       * `:where()` is required on the choice rules rather than merely allowed: it is what
       * makes them tie with the steps so source order decides, and writing them without it
       * is the defect that shipped — a four-column grid that never reflowed at all.
       *
       * Every one of the eight defeats fails this by construction: a layer, an `@supports`,
       * range syntax, an alternation, a negated `min-width`, `!important`, a selector list
       * with a second branch, and a step selector carrying an attribute are all shapes that
       * are simply not on the list.
       */
      const SETTERS = ['--salt-grid-columns', 'grid-template-columns']
      const CHOICE = /^\.salt-grid:where\(\[data-columns='[234]'\]\)$/
      const BASE = '.salt-grid'

      const shaped = []

      for (const [index, rule] of grid.entries()) {
        const sets = SETTERS.filter((property) => rule.declarations[property] !== undefined)
        if (sets.length === 0) continue

        const label = rule.selectors.join(', ')
        for (const property of sets) {
          if (isImportant(rule.declarations[property])) {
            return `\`${label}\` declares \`${property}\` !important, which no contract here can rank`
          }
        }

        if (rule.selectors.length !== 1) {
          return `\`${label}\` sets the grid through a selector list; the branch that matches decides, and this cannot tell which`
        }

        const selector = rule.selectors[0] ?? ''
        const maxWidth = maxWidthOnly(rule.at)

        if (rule.at.length === 0 && selector === BASE) shaped.push({ rule, index, kind: 'base', maxWidth: null })
        else if (rule.at.length === 0 && CHOICE.test(selector)) shaped.push({ rule, index, kind: 'choice', maxWidth: null })
        else if (maxWidth !== null && selector === BASE) shaped.push({ rule, index, kind: 'step', maxWidth })
        else {
          return (
            `\`${selector}\`${rule.at.length === 0 ? '' : ` inside \`${rule.at.join(' ')}\``} sets the grid ` +
            'in a shape this checker cannot rank — it must be the base rule, a ' +
            "`:where([data-columns='N'])` rule, or a bare `max-width` media query on the base selector"
          )
        }
      }

      /* The base rule carries the mechanism: a grid whose tracks read the count. */
      const baseRule = shaped.find((entry) => entry.kind === 'base')
      if (baseRule === undefined) return 'no unconditional `.salt-grid` rule sets the grid'
      if (!(LONGHANDS['grid-template-columns']?.(baseRule.rule) ?? '').includes('--salt-grid-columns')) {
        return 'the base track list no longer reads `--salt-grid-columns`, so nothing can step it down'
      }

      /* The steps: narrower must come later, because they all tie on specificity and source
         order is the only thing separating them. A 30rem step written before a 48rem one
         leaves a 320px viewport on two columns. */
      const steps = shaped.filter((entry) => entry.kind === 'step')
      /* Reaching 320px is what WCAG 1.4.10 asks of a phone. This read `<= 480` while the step was
         30rem, which held the step to that width rather than to what it is for, and would have
         refused the move to the `sm` breakpoint, 40rem, that Ollie ruled on 26/09/2026 (BD-169). */
      const narrowest = steps.filter(
        (entry) => (entry.maxWidth ?? 0) >= 320 && entry.rule.declarations['--salt-grid-columns']?.trim() === '1',
      )
      if (narrowest.length === 0) {
        return 'nothing steps the grid to a single column at a 320px viewport'
      }

      const ordered = [...steps].sort((a, b) => (b.maxWidth ?? 0) - (a.maxWidth ?? 0))
      for (const [position, entry] of ordered.entries()) {
        if (steps[position] !== entry) {
          return 'the steps are not written widest-first, so a narrower one is overridden by a wider one later in the file'
        }
      }

      return null
    },
  },
  {
    file: 'blocks.css',
    what: 'the shared grid wraps a run of characters too wide for its track',
    why:
      'the tracks are `minmax(0, 1fr)`, so a word wider than one does not widen the document ' +
      '— it paints over the next column. No second scrollbar, no reflow, nothing the ' +
      'suite can see, which is the same class as the steps above. Measured in Chrome at ' +
      '1200px with four across: 282px tracks, and `£1,234,567,890` reports a ' +
      '`scrollWidth` of 361px, `1234567890123456` 476px. One inherited declaration on ' +
      '`.salt-grid` puts both back to 282, and it is one tidy-up away from being deleted as ' +
      'a line that appears to do nothing.',
    check: (rules) => {
      /* `anywhere` is the stronger value and equally correct here; only the two are. */
      const wraps = (value) =>
        value.trim() === 'break-word' || value.trim() === 'anywhere'

      /* PRESENCE, unconditional: a rule reaching EVERY `.salt-grid`. A wrap that applies
         only inside a media query is a wrap at some widths, which is not the guarantee. */
      const declaring = matching(rules, (selector) => reachesAll(selector, ['.salt-grid'])).filter(
        (rule) => conditional(rule.at).length === 0,
      )
      if (declaring.length === 0) return 'no unconditional rule reaches `.salt-grid`'

      const present = declaring.some((rule) => {
        const declared = LONGHANDS['overflow-wrap']?.(rule)
        return declared !== undefined && wraps(declared)
      })
      if (!present) {
        return 'no unconditional `.salt-grid` rule declares `overflow-wrap: break-word` (or `anywhere`)'
      }

      /*
       * OVERRIDE, over the WHOLE file rather than the rules mentioning the grid.
       *
       * `overflow-wrap` is inherited, so what undoes it is a rule on a DESCENDANT — and
       * `.salt-stat__value { white-space: nowrap }` mentions no grid at all. Measured: with
       * `break-word` still declared and computing, that one rule puts the two values back to
       * 361px and 476px in a 282px track, which is the whole defect returned.
       *
       * Telling a descendant from a stranger is exactly the "which element does this selector
       * match" question this file records as out of reach. So the scope is the file:
       * `overflow-wrap` is declared in `blocks.css` only as a wrap, on `.salt-grid` and on the
       * carousel block's card, and none of the other four spellings appears at all, so the
       * whole file is the smallest scope that cannot be walked around, and a rule that genuinely wants `white-space: nowrap` gets a message
       * telling it to widen this list on purpose.
       */
      const suppressors =
        [
          [
            ['overflow-wrap', 'word-wrap'],
            (v) => !wraps(v),
            'stops a long run of characters breaking',
          ],
          /* `white-space` is the shorthand, `text-wrap`/`text-wrap-mode` the modern longhand;
             `nowrap` and `pre` both suppress wrapping, and `overflow-wrap` only creates a
             break opportunity where a break is allowed in the first place. */
          [
            ['white-space', 'text-wrap', 'text-wrap-mode'],
            (v) => v.split(/\s+/).some((token) => token === 'nowrap' || token === 'pre'),
            'suppresses wrapping outright, which `overflow-wrap` cannot undo',
          ],
        ]

      for (const rule of rules) {
        for (const [properties, breaks, what] of suppressors) {
          /* The property is carried alongside the value so the message names the spelling
             actually written — `text-wrap: nowrap` reported as `white-space` sends its author
             looking for a declaration that is not there. */
          const found = fromLast(rule, properties, (property, raw) => `${property}: ${raw}`)
          if (found === undefined) continue
          const colon = found.indexOf(':')
          if (breaks(found.slice(colon + 1).trim())) {
            return `\`${rule.selectors[0] ?? ''}\` ${what} (${found})`
          }
        }
      }

      return null
    },
  },
  {
    file: 'blocks.css',
    what: 'the call-to-action actions are a centred, wrapping row',
    why:
      'delete the rule and the buttons stack vertically hard against the start edge, under ' +
      'centred copy — the failure the rule\u2019s own comment describes. Nothing sees it: the ' +
      'markup is identical, only the paint differs, and the whole rule was removed with 1078 ' +
      'tests and every gate green. `text-align` cannot do this job, because a flex ' +
      'container\u2019s items are not inline content; and `flex-wrap` is what keeps a control ' +
      'above the WCAG 2.5.8 floor on a narrow viewport instead of squeezing it under. Third ' +
      'time this class of defect has been found in this repository, which by its own rule ' +
      'makes it a gate\u2019s job.',
    check: (rules) => {
      const value = (rule, longhand) =>
        LONGHANDS[longhand]?.(rule)

      /* PRESENCE: an unconditional rule reaching EVERY actions row. A floor that applies
         only inside a media query, or only to the rows inside a card, is not a floor. */
      const declaring = matching(rules, (selector) =>
        reachesAll(selector, ['.salt-cta__actions']),
      ).filter((rule) => conditional(rule.at).length === 0)

      if (declaring.length === 0) return 'no unconditional rule reaches `.salt-cta__actions`'

      const required = [
        ['display', (v) => v === 'flex' || v === 'inline-flex', 'display: flex'],
        ['justify-content', (v) => v === 'center', 'justify-content: center'],
        ['flex-wrap', (v) => v === 'wrap', 'flex-wrap: wrap'],
      ]

      const missing = required
        .filter(([longhand, ok]) => !declaring.some((rule) => {
          const declared = value(rule, longhand)
          return declared !== undefined && ok(declared)
        }))
        .map(([, , label]) => `\`${label}\``)

      if (missing.length > 0) {
        return `the actions row no longer declares ${missing.join(' and ')}`
      }

      /* OVERRIDE: every rule that TOUCHES the class, conditional ones included, because an
         override inside a media query is exactly how a value gets undone — and because an
         override lives in the selectors `reachesAll` rejects. `.salt-block
         .salt-cta__actions { justify-content: flex-start }` is not a rule reaching every
         row, which is precisely why the presence half cannot see it. */
      const touching = matching(rules, (selector) =>
        stripNegations(selector).includes('.salt-cta__actions'),
      )

      const undone = [
        ['display', (v) => v !== 'flex' && v !== 'inline-flex', 'stops the row being a flex container'],
        ['justify-content', (v) => v !== 'center', 'moves the row off centre'],
        ['flex-wrap', (v) => v !== 'wrap', 'stops the row wrapping'],
        /* `row` is the initial value, so ABSENCE is correct and only a wrong value is a
           defect. `flex-flow: column wrap` declares the wrap the presence half wants and
           stacks the buttons anyway. */
        ['flex-direction', (v) => v !== 'row', 'stacks the buttons instead of laying them in a row'],
      ]

      for (const rule of touching) {
        for (const [longhand, breaks, what] of undone) {
          const declared = value(rule, longhand)
          if (declared !== undefined && breaks(declared)) {
            return `\`${rule.selectors[0] ?? ''}\` ${what} (${longhand}: ${declared})`
          }
        }
      }

      return null
    },
  },
  {
    file: 'blocks.css',
    what: 'the logo strip gives its colour back to a keyboard as well as a pointer',
    why:
      'greyscale is on by default, and the colour returning under a pointer is the whole ' +
      'reason that is acceptable. Written for `:hover` alone it is a pointer-only ' +
      'affordance: a keyboard user tabbing through a strip of links gets a focus ring and no ' +
      'other change, while a mouse user gets the mark they are pointing at. The markup is ' +
      'byte-identical either way, so nothing in the suite can see it and only the paint ' +
      'differs — the same class as every other contract in this file. Measured in a ' +
      'headless Chrome: the base rule computes `grayscale(1)`, a strip with greyscale off ' +
      'computes `none`, and the reveal rule with its pseudo-classes swapped for attributes ' +
      'computes `none`, so it does beat the base rule where it applies.',
    check: (rules) => {
      const IMAGE = '.salt-logos__image'
      const FRAME = '.salt-logos__frame'
      const ON = "[data-greyscale='true']"

      const mentions = (rule, part) =>
        rule.selectors.some((selector) => stripNegations(selector).includes(part))

      /*
       * Nothing filters the FRAME. A filter applies to everything an element paints, its
       * focus outline included, so a reveal written one level up greys the focus ring on the
       * mark it is colouring — the wrong way round, and invisible to everything but an eye.
       */
      for (const rule of rules) {
        if (mentions(rule, IMAGE) || !mentions(rule, FRAME)) continue
        const declared = LONGHANDS['filter']?.(rule)
        if (declared !== undefined) {
          return `\`${rule.selectors[0] ?? ''}\` filters the frame (filter: ${declared}), which greys its focus ring along with the logo`
        }
      }

      /* Two spellings and no others, so no rule's effect has to be interpreted. */
      const GREYS = /^grayscale\(\s*(?:1|100%)\s*\)$/
      const RESTORES = /^(?:none|grayscale\(\s*0%?\s*\))$/

      const filtered = rules
        .map((rule, index) => ({ rule, index, filter: LONGHANDS['filter']?.(rule) }))
        .filter(
          (entry) =>
            entry.filter !== undefined && mentions(entry.rule, IMAGE),
        )

      for (const entry of filtered) {
        const value = entry.filter.trim()
        if (isImportant(value)) {
          return `\`${entry.rule.selectors[0] ?? ''}\` filters the logo !important, which no contract here can rank`
        }
        if (!GREYS.test(value) && !RESTORES.test(value)) {
          return `\`${entry.rule.selectors[0] ?? ''}\` filters the logo with \`${value}\`, and this contract reads only \`grayscale(1)\` and the values that undo it — widen it deliberately`
        }
        if (conditional(entry.rule.at).length > 0) {
          return `\`${entry.rule.selectors[0] ?? ''}\` filters the logo only inside \`${conditional(entry.rule.at).join(' ')}\`, so the strip greys at some widths and not others`
        }
        /*
         * A cascade LAYER, which `conditional()` deliberately does not count — correctly,
         * for the contracts that only ask whether a rule is unconditional. It matters here
         * because this contract decides the winner by source order, and a layer beats source
         * order outright. Measured: `@layer reveal, grey` with the greying rule physically
         * first inside `@layer grey` leaves both reveals computing `grayscale(1)` — the
         * colour never comes back, on either input, at exit 0. Defeat number six on this
         * file's own BD-041 list.
         */
        const layered = entry.rule.at.filter((query) => /^@layer\b/i.test(query))
        if (layered.length > 0) {
          return `\`${entry.rule.selectors[0] ?? ''}\` filters the logo inside \`${layered.join(' ')}\`, and a cascade layer beats the source order this contract reads — put these two rules in the same layer, or none`
        }
        if (!mentions(entry.rule, ON)) {
          return `\`${entry.rule.selectors[0] ?? ''}\` filters the logo without asking whether greyscale is on, so an editor who turned it off still gets it`
        }
      }

      const [grey, ...extraGrey] = filtered.filter((entry) => GREYS.test(entry.filter.trim()))
      const revealing = filtered.filter((entry) => RESTORES.test(entry.filter.trim()))

      if (grey === undefined) return 'no rule greys the logos, so the greyscale default does nothing'
      if (extraGrey.length > 0) {
        return `${String(extraGrey.length + 1)} rules grey the logos; one does it, so that no contract here has to rank them`
      }
      if (revealing.length === 0) return 'nothing gives the colour back, on any input'

      /* Source order rather than specificity: the reveal is written after the rule it
         undoes, which is a shape this file can check without being a browser. */
      const early = revealing.find((entry) => entry.index < grey.index)
      if (early !== undefined) {
        return `\`${early.rule.selectors[0] ?? ''}\` gives the colour back BEFORE the rule that takes it away, so the greyscale rule wins on source order`
      }

      /*
       * And the reveal answers to both inputs, ON THE FRAME.
       *
       * The first version looked for the bare strings `:hover` and `:focus-visible` anywhere
       * in the joined selector text, which a branch that can never match satisfies:
       * `:is(.salt-logos__frame:hover, .salt-logos__image:focus-visible)` asks for an image
       * that is an ancestor of an image. Measured — hover still reveals, the keyboard half
       * computes `grayscale(1)`, and the gate stayed green. That is defeat number one on
       * this file's own BD-041 list, "a decoy step that can never match", reproduced in a
       * contract written after it was recorded.
       *
       * So the pseudo-class must be attached to the frame, spelled out. Far narrower than
       * CSS allows, which is the point: a false failure here is a message telling somebody
       * to widen an allow-list on purpose.
       */
      const inputs = revealing.flatMap((entry) => entry.rule.selectors).map(stripNegations).join(' ')
      const missing = [':hover', ':focus-visible'].filter(
        (pseudo) => !inputs.includes(`${FRAME}${pseudo}`),
      )
      if (missing.length > 0) {
        return `the colour comes back for nobody on ${missing.join(' and ')} — no reveal attaches ${missing.length === 2 ? 'either' : 'that'} pseudo-class to \`${FRAME}\`, and a branch that names it anywhere else can be one that matches nothing`
      }

      return null
    },
  },
  {
    file: 'blocks.css',
    what: 'a masonry gallery cannot draw one photograph in two pieces',
    why:
      'masonry is CSS multi-column, and a multi-column fragment breaks wherever the column ' +
      'ends — a `<figure>` is as breakable as a paragraph unless it says otherwise. Measured ' +
      'in the headless Chrome (Chrome for Testing 148.0.7778.96) against the committed stylesheet ' +
      'over a 960px container and nine captioned figures of uneven height, with the guard ' +
      'removed: item 6, the tallest, is drawn ' +
      'in TWO pieces across the column boundary (`getClientRects().length === 2`), and column ' +
      'two’s own sequence stops being monotonic, rendering 4, 6, 5. At two columns item 5 ' +
      'splits and column one renders 1, 5, 2, 3, 4. So the guard prevents both a photograph ' +
      'cut in half and a column whose contents are out of order with themselves. It costs ' +
      '26px of container height at three columns — 962px guarded against 936px unguarded, ' +
      '2.7%. The markup is byte-identical either way and only the paint differs, so nothing ' +
      'in the suite can see it go, and it is exactly the shape of declaration a tidy-up ' +
      'removes as a line that appears to do nothing.',
    check: (rules) => {
      const ITEM = '.salt-gallery__item'

      /*
       * The two spellings of one property. `page-break-inside` is a legacy ALIAS — CSS
       * Fragmentation 3 says a browser must treat the two names as one property — so
       * `break-inside: avoid; page-break-inside: auto` computes to the SECOND, and a checker
       * preferring the modern spelling wherever it appears reads `avoid` and passes the
       * defect. Both go through `fromLast`, which returns whichever was written last: the
       * `word-wrap` lesson in `LONGHANDS`, in a third property.
       *
       * `-webkit-column-break-inside` is a THIRD spelling and this contract does not read it.
       * Refused by name below rather than ignored: a checker that passed over a spelling it
       * cannot rank would be claiming to have checked something it had not, which is the
       * failure this file's own header spends four paragraphs on.
       */
      const SPELLINGS = ['break-inside', 'page-break-inside']
      const REFUSED = '-webkit-column-break-inside'

      /* `avoid` and `avoid-column` both forbid a COLUMN break, which is the only kind of
         break a multi-column container makes. `avoid-page` and `avoid-region` do not, and
         `auto` is the default the declaration exists to replace. */
      const GUARDS = ['avoid', 'avoid-column']
      const READS = [...GUARDS, 'auto', 'avoid-page', 'avoid-region']

      /*
       * PRESENCE, unconditional and singular — BD-041's position rather than a cascade model.
       * A guard that applies only inside a media query is a guard at some widths, which is
       * not the guarantee; and two rules reaching the item is a rank this checker refuses to
       * attempt, exactly as the logo frame's box does.
       */
      const [rule, ...extra] = matching(rules, (selector) => reachesAll(selector, [ITEM])).filter(
        (candidate) => conditional(candidate.at).length === 0,
      )
      if (rule === undefined) return `no unconditional rule reaches \`${ITEM}\``
      if (extra.length > 0) {
        return `${String(extra.length + 1)} unconditional rules reach \`${ITEM}\`; the guard is written once so that no contract here has to decide which of them wins`
      }

      /*
       * The refused spelling is refused ON THIS RULE TOO, not only on the others.
       *
       * BD-043 records the forbid-loop that skipped the rule it had just validated, and it
       * cost that contract two defeats. `break-inside: avoid; -webkit-column-break-inside:
       * auto` in one block would read as guarded here and fragment in WebKit, and
       * `-webkit-column-break-inside: avoid` on its own guards WebKit and nothing else. Both
       * are refusals rather than verdicts: this checker does not read the prefix, and saying
       * so is the honest answer.
       */
      const prefixed = fromLast(rule, [REFUSED], (name, raw) => `${name}: ${raw}`)
      if (prefixed !== undefined) {
        return `\`${ITEM}\` declares \`${prefixed}\`, a prefixed spelling this contract does not read — write the guard as \`break-inside\` (or \`page-break-inside\`) instead, or widen the list deliberately`
      }

      const written = fromLast(rule, SPELLINGS, (property, raw) => `${property}: ${raw}`)
      if (written === undefined) {
        return `\`${ITEM}\` declares no break guard, so a tall figure is drawn in two pieces across a column boundary (measured: \`getClientRects().length === 2\`, and the column then renders 4, 6, 5)`
      }

      const colon = written.indexOf(':')
      const property = written.slice(0, colon).trim()
      const value = written.slice(colon + 1).trim()

      /* `!important` FIRST, before any comparison. `break-inside: avoid !important` is
         correct CSS, and reporting it as a value that does not read `avoid` is the positive
         false claim this file has now shipped six times, each one sending somebody to undo a
         rule that was right. */
      if (isImportant(value)) {
        return `\`${ITEM}\` declares \`${property}\` !important, which no contract here can rank`
      }

      /* Case-insensitively: CSS keywords are ASCII case-insensitive, so `AVOID` is the same
         declaration and failing it would be a false claim of a different shape. */
      const keyword = value.toLowerCase()
      if (!READS.includes(keyword)) {
        return `\`${ITEM}\` writes \`${property}: ${value}\`, which this contract reads only as one of ${READS.join(', ')} — widen it deliberately rather than assuming which way it falls`
      }
      if (!GUARDS.includes(keyword)) {
        return `\`${ITEM}\` declares \`${property}: ${value}\`, which does not forbid a COLUMN break — a tall figure is still drawn in two pieces (measured: \`getClientRects().length === 2\`, the column rendering 4, 6, 5)`
      }

      /*
       * OVERRIDE, over CONDITIONAL rules as well as unconditional ones.
       *
       * An override inside a media query is exactly how a value gets undone, and this file
       * records three contracts that shipped without the check and fell to one. A
       * `@media (min-width: 40rem) { .salt-gallery__item { break-inside: auto } }` puts the
       * whole defect back at every desktop viewport, which is where a three-column masonry
       * exists at all.
       */
      for (const other of rules) {
        if (other === rule) continue
        if (!other.selectors.some((selector) => stripNegations(selector).includes(ITEM))) continue

        const found = fromLast(other, [...SPELLINGS, REFUSED], (name, raw) => `${name}: ${raw}`)
        if (found === undefined) continue
        const where = other.at.length === 0 ? '' : ` inside \`${other.at.join(' ')}\``
        return `\`${other.selectors[0] ?? ''}\`${where} also sets the break guard (${found}), and this contract does not rank two rules — put the guard on the base \`${ITEM}\` rule or widen the allow-list deliberately`
      }

      /*
       * ── What this cannot see, named rather than half-defended ─────────────────
       *
       * The sweep gathers rules by looking for the class NAME in a selector, so a rule
       * reaching these figures without naming them is invisible: `.salt-gallery > li
       * { break-inside: auto }` restores the fragmentation at exit 0. Answering that needs
       * the checker to know which ELEMENT a selector matches, which BD-040 records as a
       * different tool and BD-041 records five rounds of trying to fake. Left, and named.
       */
      return null
    },
  },
  {
    file: 'blocks.css',
    what: 'the masonry layout wins its `display` on the selector rather than on source order',
    why:
      'the gallery `<ul>` carries `.salt-grid` and `.salt-gallery` at once, so two rules ' +
      "declare `display` on the same element: `.salt-grid { display: grid }` and masonry's " +
      'own. Spelled `.salt-gallery:where([data-layout=\'masonry\'])` the second scores ' +
      '(0,1,0) — `:where()` contributes nothing — which TIES `.salt-grid`, and a tie is ' +
      'broken by source order alone. Measured against the committed stylesheet with that ' +
      'spelling put back and the gallery section moved to the top of the file: `display` ' +
      'computes to `grid`, `columns` has nothing to apply to, and the top visual row reads ' +
      '1, 2, 3 instead of 1, 4, 7 — every masonry gallery is a three-across grid again. The ' +
      'markup is byte-identical either way and only the paint differs, so nothing in the ' +
      'suite can see it; and the fix was a change of SPELLING, which is what a tidy-up ' +
      'reverts while every other gate stays green.',
    check: (rules) => {
      const LAYOUT = "[data-layout='masonry']"

      /* Every rule naming the layout, whatever else its selector carries. */
      const masonry = matching(rules, (selector) =>
        targetsAttribute(selector, 'data-layout', 'masonry'),
      )
      if (masonry.length === 0) return `no rule names \`${LAYOUT}\``

      /*
       * PRESENCE, unconditional and singular — BD-041's position rather than a cascade model.
       * A layout that only exists inside a media query is a layout at some widths, which is
       * not the guarantee; and two rules setting `display` on it is a rank this checker
       * refuses to attempt, exactly as the break guard above and the logo frame's box do.
       */
      const [rule, ...extra] = masonry.filter(
        (candidate) =>
          conditional(candidate.at).length === 0 && candidate.declarations['display'] !== undefined,
      )
      if (rule === undefined) return `no unconditional rule declares \`display\` on \`${LAYOUT}\``
      if (extra.length > 0) {
        return `${String(extra.length + 1)} unconditional rules declare \`display\` on \`${LAYOUT}\`; it is written once so that no contract here has to decide which of them wins`
      }
      const written = rule.selectors[0] ?? ''
      const value = rule.declarations['display'] ?? ''

      /* `!important` FIRST, before the value is compared to anything. `display: block
         !important` is correct CSS, and reporting it as a value that does not read `block` is
         the positive false claim this file has now shipped six times. */
      if (isImportant(value)) {
        return `\`${written}\` declares \`display\` !important, which no contract here can rank`
      }

      /* Case-insensitively: CSS keywords are ASCII case-insensitive, so `BLOCK` is the same
         declaration and failing it would be a false claim of a different shape. */
      const keyword = value.toLowerCase()
      const BLOCKS = ['block', 'flow-root']
      const READS = [...BLOCKS, 'grid', 'inline-grid', 'flex', 'inline-flex', 'inline-block']
      if (!READS.includes(keyword)) {
        return `\`${written}\` writes \`display: ${value}\`, which this contract reads only as one of ${READS.join(', ')} — widen it deliberately rather than assuming which way it falls`
      }
      if (!BLOCKS.includes(keyword)) {
        return `\`${written}\` declares \`display: ${value}\`, which is not a block container, so \`columns\` has nothing to apply to and the gallery is a grid again (measured: the top row reads 1, 2, 3 instead of 1, 4, 7)`
      }

      /*
       * ── The subject: how the layout is NAMED ──────────────────────────────────
       *
       * A text question inside this file's own posture — forbid the shapes you cannot rank —
       * rather than the cascade model BD-041 records five rounds of failing to build. The
       * defect is a tie broken by source order, and this cannot rank a tie; it can read
       * whether the attribute is selected on directly, which is the spelling that makes the
       * tie impossible.
       */
      const softened = rule.selectors.filter(
        (selector) =>
          targetsAttribute(selector, 'data-layout', 'masonry') &&
          !targetsAttribute(stripMatchesAny(selector), 'data-layout', 'masonry'),
      )
      if (softened.length > 0) {
        return `\`${softened[0] ?? ''}\` names \`${LAYOUT}\` inside \`:is()\` or \`:where()\` rather than selecting on it. \`:where()\` contributes NO specificity, which ties this rule with \`.salt-grid\` at (0,1,0) and leaves source order to decide — measured: with that spelling and the gallery section moved to the top of the file, \`display\` computes to \`grid\` and the top row reads 1, 2, 3 instead of 1, 4, 7. \`:is()\` scores as its most specific argument, a sum this contract does not compute and so does not accept either. Write the attribute selector plainly`
      }

      /*
       * OVERRIDE, over CONDITIONAL rules as well as unconditional ones. A second rule setting
       * `display` on the same layout inside a media query is exactly how a value gets undone,
       * and three contracts in this file shipped without that half and fell to one.
       */
      for (const other of rules) {
        if (other === rule) continue
        if (
          !other.selectors.some((selector) => targetsAttribute(selector, 'data-layout', 'masonry'))
        ) {
          continue
        }
        const again = other.declarations['display']
        if (again === undefined) continue
        const where = other.at.length === 0 ? '' : ` inside \`${other.at.join(' ')}\``
        return `\`${other.selectors[0] ?? ''}\`${where} declares \`display: ${again}\` as well, and this contract does not rank two rules — the masonry layout's display is written once, unconditionally`
      }

      /*
       * ── What this cannot see, named rather than half-defended ─────────────────
       *
       * It does not know that the element also carries `.salt-grid`, that `.salt-grid`
       * declares `display: grid`, or which of the two wins. That is the cascade, and it stays
       * WP13's question. What is asserted here is the SHAPE that makes the ranking
       * unnecessary: the layout selected on directly, once, unconditionally, at a value this
       * contract reads. `.salt-grid` growing an `!important`, a second class or a cascade
       * layer of its own would beat the gallery and pass this — a browser answers that, and
       * another regex does not.
       */
      return null
    },
  },
  {
    file: 'blocks.css',
    what: 'a right-hand media-and-text row flips with `order`, on a row whose children `order` reaches',
    why:
      'the block’s renderer writes the photograph first and the copy second in EVERY row, ' +
      'left-hand and right-hand alike, so that reading order and focus order do not depend on ' +
      'a select an editor set for visual reasons — PLAN §4 calls it the mediaText ' +
      'DOM-invariance precedent and generalises it to WP6’s hero. The whole of the flip is ' +
      'therefore in this stylesheet, and a left row and a right row differ in the markup by ' +
      'one attribute VALUE: no test can see the flip go, because nothing about the DOM ' +
      'changes when it does. Two ways it goes: the `order` declaration is deleted or its ' +
      'value drifts, and every right-hand row draws media-first; or the row stops being a ' +
      'grid, at which point `order` reaches nothing and the declaration is inert while still ' +
      'reading as though it works.',
    check: (rules) => {
      const ROW = '.salt-media-text__row'
      const MEDIA = '.salt-media-text__media'
      /* Every class in this block starts with it, so one substring gathers the family. */
      const FAMILY = '.salt-media-text'

      /*
       * ── First: the row is a formatting context whose children `order` reaches ──────
       *
       * PRESENCE, unconditional and singular — BD-041's position rather than a cascade
       * model, and the same shape the masonry layout and the logo frame above take. A row
       * that is only a grid inside a media query is a row that flips at some widths, and
       * two rules setting `display` on it is a rank this checker refuses to attempt.
       */
      const [row, ...extraRows] = matching(rules, (selector) => reachesAll(selector, [ROW])).filter(
        (candidate) =>
          conditional(candidate.at).length === 0 && candidate.declarations['display'] !== undefined,
      )
      if (row === undefined) return `no unconditional rule declares \`display\` on \`${ROW}\``
      if (extraRows.length > 0) {
        return `${String(extraRows.length + 1)} unconditional rules declare \`display\` on \`${ROW}\`; it is written once so that no contract here has to decide which of them wins`
      }

      const laid = row.declarations['display'] ?? ''

      /* `!important` FIRST, before the value is compared to anything. `display: grid
         !important` is correct CSS, and reporting it as a value that does not read `grid`
         is the positive false claim this file has shipped six times, each one sending
         somebody to undo a rule that was right. */
      if (isImportant(laid)) {
        return `\`${ROW}\` declares \`display\` !important, which no contract here can rank`
      }

      /* Case-insensitively: CSS keywords are ASCII case-insensitive, so `GRID` is the same
         declaration and failing it would be a false claim of a different shape. */
      const container = laid.toLowerCase()
      const ORDERS = ['grid', 'inline-grid', 'flex', 'inline-flex']
      const READS = [...ORDERS, 'block', 'flow-root', 'inline-block', 'contents']
      if (!READS.includes(container)) {
        return `\`${ROW}\` writes \`display: ${laid}\`, which this contract reads only as one of ${READS.join(', ')} — widen it deliberately rather than assuming which way it falls`
      }
      if (!ORDERS.includes(container)) {
        return `\`${ROW}\` declares \`display: ${laid}\`, whose children are not flex or grid items — \`order\` applies to nothing, so the flip below is inert and every right-hand row draws its photograph first`
      }

      /*
       * ── Then the flip itself ──────────────────────────────────────────────────────
       *
       * PRESENCE, unconditional and singular again, and for the second half of the same
       * reason: a flip inside a media query is a flip at some widths, and the whole subject
       * here is that one declaration carries the difference between two layouts.
       */
      const [flip, ...extraFlips] = matching(rules, (selector) =>
        targetsAttribute(selector, 'data-media-side', 'right'),
      ).filter(
        (candidate) =>
          conditional(candidate.at).length === 0 && candidate.declarations['order'] !== undefined,
      )
      if (flip === undefined) {
        return `no unconditional rule declares \`order\` for a right-hand row, so it renders in DOM order — photograph first — which is what a left-hand row renders and leaves the editor's choice with no effect at all`
      }
      if (extraFlips.length > 0) {
        return `${String(extraFlips.length + 1)} unconditional rules declare \`order\` for a right-hand row; the flip is written once so that no contract here has to decide which of them wins`
      }

      /*
       * The SUBJECT has to be the media. The body is written second and already sits at the
       * initial `order: 0`, so a rule moving anything else — the body, the row's own box —
       * cannot put the photograph after the copy, and would read as a flip while doing
       * nothing. `lastCompound` asks the question of the element actually matched rather
       * than of the selector string, which is the lesson its own docstring records.
       */
      const elsewhere = flip.selectors.filter(
        (selector) => lastCompound(stripNegations(selector)) !== MEDIA,
      )
      if (elsewhere.length > 0) {
        return `\`${elsewhere[0] ?? ''}\` sets the flip on something other than \`${MEDIA}\`; the body is written second and already sits at \`order: 0\`, so moving anything else does not put the photograph after it`
      }

      const moved = (flip.declarations['order'] ?? '').trim()

      /* `!important` before the comparison here too, for the reason above. */
      if (isImportant(moved)) {
        return `the flip declares \`order\` !important, which no contract here can rank`
      }

      /* A plain integer is the only spelling this reads. `order: var(--flip)`, a `calc()`
         and the `revert` keywords are all legal CSS whose value this cannot rank, and
         passing over one would be a claim to have checked something it had not — the
         failure this file's own header spends four paragraphs on. */
      if (!/^[+-]?\d+$/.test(moved)) {
        return `the flip writes \`order: ${moved}\`, which this contract reads only as a plain integer — widen it deliberately rather than assuming which way it falls`
      }
      if (Number(moved) <= 0) {
        return `the flip writes \`order: ${moved}\`, which does not move the photograph PAST the copy: the copy is written second and sits at the initial \`order: 0\`, so anything at or below zero leaves the photograph exactly where the DOM already puts it`
      }

      /*
       * ── OVERRIDE, over CONDITIONAL rules as well as unconditional ones ─────────────
       *
       * An override inside a media query is exactly how a value gets undone, and this file
       * records three contracts that shipped without this half and fell to one. The
       * tempting version here is real rather than hypothetical: a narrow-viewport reset
       * evening up the stacking on a phone would be a second `order` on the same element,
       * and the stylesheet's own comment records choosing not to write it for this reason.
       */
      for (const other of rules) {
        if (other === flip) continue
        if (!other.selectors.some((selector) => stripNegations(selector).includes(FAMILY))) continue
        const again = other.declarations['order']
        if (again === undefined) continue
        const where = other.at.length === 0 ? '' : ` inside \`${other.at.join(' ')}\``
        return `\`${other.selectors[0] ?? ''}\`${where} declares \`order: ${again}\` as well, and this contract does not rank two rules — the flip is written once, unconditionally, so that a narrow-viewport reset cannot quietly undo it`
      }

      /* And the same half for the row's `display`, which the presence check above only
         asked of unconditional rules: `@media (max-width: 48rem) { .salt-media-text__row
         { display: block } }` would take `order`'s subject away at every phone width. */
      for (const other of rules) {
        if (other === row) continue
        if (!other.selectors.some((selector) => stripNegations(selector).includes(ROW))) continue
        const again = other.declarations['display']
        if (again === undefined) continue
        const where = other.at.length === 0 ? '' : ` inside \`${other.at.join(' ')}\``
        return `\`${other.selectors[0] ?? ''}\`${where} declares \`display: ${again}\` as well, and this contract does not rank two rules — the row's display is written once, unconditionally, because it is what makes \`order\` apply at all`
      }

      /*
       * ── What this cannot see, named rather than half-defended ─────────────────────
       *
       * It does not know that the photograph is the FIRST child in the DOM. That is the
       * property the whole flip rests on and it lives in `section.tsx`, where the block's
       * own suite asserts the markup; a stylesheet checker has no document to look at.
       *
       * It does not know that `order: 1` actually paints the photograph second. `order`
       * reorders within a container's own children and this cannot confirm the result —
       * that needs a browser, which is WP13's harness, and the stylesheet's comment says
       * the same rather than claiming a measurement nobody made.
       *
       * And the standing limit of every contract in this file: rules are gathered by
       * looking for a class NAME in a selector, so one reaching these elements without
       * naming them is invisible. `.salt-media-text > div > :first-child { order: 2 }`
       * undoes the flip at exit 0. BD-040 records that as a different tool and BD-041
       * records five rounds of trying to fake it. Left, and named.
       */
      return null
    },
  },
  {
    file: 'blocks.css',
    what: 'a left-hand hero flips with a NEGATIVE `order`, on a band whose children `order` reaches',
    why:
      'the hero renders one markup for all four of its variants — the text block first and ' +
      'the picture second, always — and emits `data-media-side` as a value a stylesheet ' +
      'reads, so a left-hand split and a right-hand one differ in the document by one ' +
      'attribute value and in nothing a reader, a keyboard or a screen reader meets. BD-088 ' +
      'names a hero variant that cannot hold that order as the thing that would break the ' +
      'unit, so the whole of the flip is here and no test can see it go. It is the MIRROR of ' +
      'the mediaText rule above: there the photograph is written first and a positive `order` ' +
      'moves it past the copy, here the words are written first and only a value below the ' +
      'initial zero pulls the picture in front of them. Two ways it goes: the declaration is ' +
      'deleted or its value drifts to zero or above, and every left-hand hero draws its ' +
      'picture on the right — which is what a right-hand hero draws, leaving the editor’s ' +
      'choice with no effect at all; or the band stops being a grid, at which point `order` ' +
      'reaches nothing and the declaration is inert while still reading as though it works.',
    check: (rules) => {
      const BAND = '.salt-hero'
      const MEDIA = '.salt-hero__media'

      /*
       * ── Which rules count as speaking about the band ──────────────────────────────
       *
       * `reachesAll(selector, [BAND])` was the first spelling here and it was wrong, in the
       * direction that passes. It requires the selector to be NOTHING BUT the named parts,
       * so `.salt-hero[data-media-side]` — the very shape this stylesheet uses three times —
       * was invisible to it, and appending `.salt-hero[data-media-side] { display: block }`
       * stopped every split hero being a grid, left `order: -1` applying to nothing, and
       * exited 0. Five further spellings passed the same way: that rule inside a media query,
       * a `:where([data-variant])` qualifier, a `display: flex` plus `flex-flow: row-reverse`
       * rewrite that mirrors both variants so the toggle changes nothing, `all: revert` on the
       * media, and `[dir="rtl"] .salt-hero { display: block }`.
       *
       * So the question is asked as a BEM-aware SUBSTRING instead: the band's class, not
       * followed by another name-character. `\w` covers the underscore, so `.salt-hero__media`
       * and `.salt-hero__actions` are excluded — which is the case `reachesAll` was reached for
       * in the first place, `.salt-hero__actions` being a flex row of its own whose `display`
       * is not the band's — while `.salt-hero[…]`, `.salt-hero:where(…)`, `.salt-hero,` and an
       * ancestor-qualified `[dir="rtl"] .salt-hero` all count.
       *
       * Deliberately wider than "what this rule matches": a rule that takes the grid away from
       * SOME heroes is exactly the defect, so narrowing by ancestor or by attribute must count
       * rather than excuse. What it cannot do is rank two such rules against each other, so it
       * refuses a second one rather than deciding — this file's standing position.
       */
      const namesBand = (selector) =>
        new RegExp(`${BAND.replace('.', '\\.')}(?![\\w-])`).test(stripNegations(selector))

      /*
       * `all` resets every property, `display` and `order` among them, so a rule setting it is
       * a rule setting both. It is read alongside each property below rather than instead of
       * it: `all: revert` on the media was the fifth defeat, undoing the flip without the word
       * `order` appearing anywhere.
       */
      const resets = (rule, property) =>
        rule.declarations[property] ?? rule.declarations['all']

      /*
       * ── First: the band is a formatting context whose children `order` reaches ─────
       *
       * PRESENCE, unconditional and singular, as the mediaText contract above takes it and
       * for the reason recorded there: a band that is only a grid inside a media query is a
       * band that flips at some widths, and two rules setting `display` on it is a rank this
       * checker refuses to attempt.
       */
      const [band, ...extraBands] = matching(rules, namesBand).filter(
        (candidate) =>
          conditional(candidate.at).length === 0 && resets(candidate, 'display') !== undefined,
      )
      if (band === undefined) return `no unconditional rule declares \`display\` on \`${BAND}\``
      if (extraBands.length > 0) {
        return `${String(extraBands.length + 1)} unconditional rules declare \`display\` (or \`all\`) for \`${BAND}\`, including \`${extraBands[0]?.selectors[0] ?? ''}\`; it is written once, unqualified, so that no contract here has to decide which of them wins — a rule that narrows by attribute or by ancestor takes the grid away from SOME heroes, and \`order\` then applies to nothing in exactly those`
      }

      const laid = resets(band, 'display') ?? ''

      /* `!important` FIRST, before the value is compared to anything — the positive false
         claim this file has shipped six times, each one sending somebody to undo a rule that
         was right. */
      if (isImportant(laid)) {
        return `\`${BAND}\` declares \`display\` !important, which no contract here can rank`
      }

      /* Case-insensitively: CSS keywords are ASCII case-insensitive, so `GRID` is the same
         declaration and failing it would be a false claim of a different shape. */
      const container = laid.toLowerCase()
      const ORDERS = ['grid', 'inline-grid', 'flex', 'inline-flex']
      const READS = [...ORDERS, 'block', 'flow-root', 'inline-block', 'contents']
      if (!READS.includes(container)) {
        return `\`${BAND}\` writes \`display: ${laid}\`, which this contract reads only as one of ${READS.join(', ')} — widen it deliberately rather than assuming which way it falls`
      }
      if (!ORDERS.includes(container)) {
        return `\`${BAND}\` declares \`display: ${laid}\`, whose children are not flex or grid items — \`order\` applies to nothing, so the flip below is inert and every left-hand hero draws its picture on the right`
      }

      /*
       * ── Then the flip itself ──────────────────────────────────────────────────────
       *
       * PRESENCE, unconditional and singular again: a flip inside a media query is a flip at
       * some widths, and the whole subject here is that one declaration carries the
       * difference between two layouts.
       */
      const [flip, ...extraFlips] = matching(rules, (selector) =>
        targetsAttribute(selector, 'data-media-side', 'left'),
      ).filter(
        (candidate) =>
          conditional(candidate.at).length === 0 && candidate.declarations['order'] !== undefined,
      )
      if (flip === undefined) {
        return `no unconditional rule declares \`order\` for a left-hand hero, so it renders in DOM order — words first — which is what a right-hand hero renders and leaves the editor's choice with no effect at all`
      }
      if (extraFlips.length > 0) {
        return `${String(extraFlips.length + 1)} unconditional rules declare \`order\` for a left-hand hero; the flip is written once so that no contract here has to decide which of them wins`
      }

      /*
       * The SUBJECT has to be the media. The text block is written first and already sits at
       * the initial `order: 0`, so a rule moving anything else cannot put the picture in
       * front of it and would read as a flip while doing nothing. `lastCompound` asks the
       * question of the element actually matched rather than of the selector string.
       */
      const elsewhere = flip.selectors.filter(
        (selector) => lastCompound(stripNegations(selector)) !== MEDIA,
      )
      if (elsewhere.length > 0) {
        return `\`${elsewhere[0] ?? ''}\` sets the flip on something other than \`${MEDIA}\`; the text block is written first and already sits at \`order: 0\`, so moving anything else does not put the picture in front of it`
      }

      const moved = (flip.declarations['order'] ?? '').trim()

      /* `!important` before the comparison here too, for the reason above. */
      if (isImportant(moved)) {
        return `the flip declares \`order\` !important, which no contract here can rank`
      }

      /* A plain integer is the only spelling this reads. `order: var(--flip)`, a `calc()` and
         the `revert` keywords are all legal CSS whose value this cannot rank, and passing
         over one would be a claim to have checked something it had not. */
      if (!/^[+-]?\d+$/.test(moved)) {
        return `the flip writes \`order: ${moved}\`, which this contract reads only as a plain integer — widen it deliberately rather than assuming which way it falls`
      }
      if (Number(moved) >= 0) {
        return `the flip writes \`order: ${moved}\`, which does not move the picture IN FRONT of the words: the text block is written first and sits at the initial \`order: 0\`, so anything at or above zero leaves the picture exactly where the DOM already puts it`
      }

      /*
       * ── OVERRIDE, over CONDITIONAL rules as well as unconditional ones ─────────────
       *
       * An override inside a media query is exactly how a value gets undone, and this file
       * records three contracts that shipped without this half and fell to one. The tempting
       * version is real rather than hypothetical: a narrow-viewport reset evening up the
       * stacking on a phone is a second `order` on the same element, and the stylesheet's own
       * comment records choosing not to write it for this reason.
       */
      for (const other of rules) {
        if (other === flip) continue
        if (!other.selectors.some((selector) => stripNegations(selector).includes(BAND))) continue
        const again = resets(other, 'order')
        if (again === undefined) continue
        const property = other.declarations['order'] === undefined ? 'all' : 'order'
        const where = other.at.length === 0 ? '' : ` inside \`${other.at.join(' ')}\``
        return `\`${other.selectors[0] ?? ''}\`${where} declares \`${property}: ${again}\` as well, and this contract does not rank two rules — the flip is written once, unconditionally, so that a narrow-viewport reset cannot quietly undo it. \`all\` counts because it resets every property, \`order\` among them, without the word appearing`
      }

      /* And the same half for the band's `display`, which the presence check above only asked
         of unconditional rules: `@media (max-width: 48rem) { .salt-hero { display: block } }`
         would take `order`'s subject away at every phone width.
         `namesBand` rather than the plain substring the `order` half uses, because every class
         in this family begins with the band's own — `.salt-hero__actions` is a flex row of its
         own, and a plain substring would read its `display` as a second declaration on the
         band. The `order` half wants the whole family and this half wants the band, however it
         is qualified. */
      for (const other of rules) {
        if (other === band) continue
        if (!other.selectors.some(namesBand)) continue
        const again = resets(other, 'display')
        if (again === undefined) continue
        const property = other.declarations['display'] === undefined ? 'all' : 'display'
        const where = other.at.length === 0 ? '' : ` inside \`${other.at.join(' ')}\``
        return `\`${other.selectors[0] ?? ''}\`${where} declares \`${property}: ${again}\` as well, and this contract does not rank two rules — the band's display is written once, unqualified, because it is what makes \`order\` apply at all`
      }

      /*
       * ── What this cannot see, named rather than half-defended ─────────────────────
       *
       * It does not know that the text block is the FIRST child in the DOM. That is the
       * property the whole flip rests on and it lives in `section.tsx`, where the block's own
       * suite asserts the markup and pins the left/right pair as identical but for the
       * attribute value; a stylesheet checker has no document to look at.
       *
       * And the standing limit of every contract in this file: rules are gathered by looking
       * for a class NAME in a selector, so one reaching these elements without naming them is
       * invisible. BD-040 records that as a different tool and BD-041 records five rounds of
       * trying to fake it. Left, and named.
       */
      return null
    },
  },
  {
    file: 'blocks.css',
    what: 'a process timeline runs in ONE column, whatever the shared grid is set to',
    why:
      'the block renders one markup for both of its layouts and emits `data-layout`, so the ' +
      'whole difference between a timeline and a row of cards is in this stylesheet — which ' +
      'is what makes the resolver falling back to `timeline` in silence honest: a wrong ' +
      'layout is a wrong appearance and moves nothing a reader meets. The list carries ' +
      '`.salt-grid` for the cards, and `.salt-grid` sets `--salt-grid-columns: 3`, so ' +
      'without this declaration a timeline draws three across — the same steps in the same ' +
      'order laid out as the layout the editor did not choose, with the connector running ' +
      'down the side of the whole block instead of beside a column of steps. The markup is ' +
      'byte-identical either way, so nothing in the suite can see it and only the paint ' +
      'differs; and the reflow steps set the same variable inside media queries, which add ' +
      'no specificity, so the spelling of this selector is what keeps it winning at 320px.',
    check: oneColumnLayout({
      layout: 'timeline',
      family: '.salt-process',
      noun: 'a timeline',
      laidOut:
        'which is the cards layout, drawn for the editor who chose the other one, with the connector beside the block rather than beside the steps',
    }),
  },
  {
    file: 'blocks.css',
    what: 'a collection showcase list runs in ONE column, whatever the editor’s column count says',
    why:
      'the block renders one `<ul>` of cards for every layout and emits `data-layout`, so a ' +
      'list and a grid differ in the stylesheet and in a `data-columns` attribute the list ' +
      'leaves off. The list carries `.salt-grid`, which sets `--salt-grid-columns: 3`, so ' +
      'without this declaration a list draws three across — the grid layout, for the editor ' +
      'who chose the other one — and nothing in the suite can see it, since only the paint ' +
      'differs. The reflow steps set the same variable inside media queries, which add no ' +
      'specificity, so the spelling of this selector is what keeps it winning at every width.',
    check: oneColumnLayout({
      layout: 'list',
      family: '.salt-showcase',
      noun: 'a showcase list',
      laidOut: 'which is the grid layout, drawn for the editor who chose a list',
    }),
  },
  {
    file: 'primitives.css',
    what: 'the carousel track scrolls, snaps, and only glides where motion is welcome',
    why:
      'the track is the no-JavaScript base: with no script at all it must still scroll and ' +
      'snap, because the component only ADDS two buttons to something already usable. Delete ' +
      '`overflow-x` and there is no carousel at all, only a row clipped at the band edge — ' +
      'and nothing in the suite sees it, since the markup is identical and only the paint ' +
      'differs. `scroll-behavior` is the subtler half: the track is a tab stop where its ' +
      'slides hold nothing focusable, and a reader on the arrow keys gets the browser’s ' +
      'own scrolling, which obeys that property and nothing else. Written unconditionally, a ' +
      'reader who asked for reduced motion gets a glide on every press. Measured in Chromium ' +
      'against a control: `scrollBy({ left: 344, behavior: ‘auto’ })` moves a track ' +
      'computing `auto` to 344 synchronously and one computing `smooth` to 0.',
    check: (rules) => {
      const TRACK = '.salt-carousel__track'
      const REGION = '.salt-carousel'

      /* PRESENCE, unconditional: the base rule that makes it a scroller at all. */
      const [base, ...extra] = matching(rules, (selector) => reachesAll(selector, [TRACK])).filter(
        (candidate) => conditional(candidate.at).length === 0,
      )
      if (base === undefined) return `no unconditional rule reaches \`${TRACK}\``
      if (extra.length > 0) {
        return `${String(extra.length + 1)} unconditional rules reach \`${TRACK}\`; it is written once so that no contract here has to decide which of them wins`
      }

      /*
       * Three verdicts, not two, and the third is why.
       *
       * A binary predicate has to call everything it does not accept WRONG, and that is a
       * positive false claim the moment a correct spelling arrives: `scroll-snap-type: both
       * mandatory` snaps on the inline axis perfectly well, and reporting it as "not
       * snapping on the inline axis" sends its author to undo something correct. Twice in
       * the logos contract the same shape shipped and had to be fixed in review; here it is
       * separated at the point the check is written. Anything outside both lists is refused
       * as unreadable, which is BD-041's posture said out loud.
       */
      const required
          = [
        {
          property: 'overflow-x',
          accepts: (value) => value === 'auto' || value === 'scroll',
          refuses: (value) => value === 'hidden' || value === 'clip' || value === 'visible',
          what: 'a scroll container — without it the slides are clipped at the band edge and there is no carousel',
        },
        {
          property: 'scroll-snap-type',
          accepts: (value) => /^x(\s|$)/.test(value),
          refuses: (value) => /^y(\s|$)/.test(value) || value === 'none',
          what: 'snapping on the inline axis, so a swipe lands on a slide rather than between two',
        },
        {
          property: 'overscroll-behavior-x',
          accepts: (value) => value === 'contain' || value === 'none',
          refuses: (value) => value === 'auto',
          what: "a swipe that stops at the end of the slides instead of triggering the browser's back gesture",
        },
      ]

      for (const { property, accepts, refuses, what } of required) {
        const declared = LONGHANDS[property]?.(base)
        if (declared === undefined) {
          return `\`${TRACK}\` no longer declares \`${property}\`, so it is not ${what}`
        }
        if (isImportant(declared)) {
          return `\`${TRACK}\` declares \`${property}\` !important, which no contract here can rank`
        }
        const value = declared.trim()
        if (!accepts(value)) {
          return refuses(value)
            ? `\`${TRACK}\` declares \`${property}: ${value}\`, which is not ${what}`
            : `\`${TRACK}\` declares \`${property}: ${value}\`, a spelling this contract does not read — it may well be correct, so widen the list deliberately rather than changing the stylesheet`
        }

        /*
         * OVERRIDE, over every OTHER rule touching the track — conditional ones included,
         * which is where the whole of this half was missing.
         *
         * Presence was checked on the one unconditional rule and `extra` counted only
         * unconditional rules, so nothing looked at a media query at all:
         * `@media (min-width: 1px) { .salt-carousel__track { overflow-x: hidden } }` left
         * the gate at exit 0 with the track not scrollable by pointer, touch, trackpad or
         * keyboard — the no-JavaScript base this contract's own `why` calls "the base, not a
         * fallback". Verified in Chromium, and identically for `scroll-snap-type: none` and
         * `overscroll-behavior-x: auto`.
         *
         * This file's own policy note has said so since BD-033's round: presence must be
         * satisfied unconditionally, and override must consider conditional rules too. The
         * `scroll-behavior` half of this contract does; this half did not.
         *
         * Refused rather than ranked, per BD-041: these three are written once.
         */
        for (const other of rules) {
          if (other === base) continue
          /* Gathered on `.salt-carousel`, the same test the `scroll-behavior` scan below
             uses. Keyed on `TRACK` these two loops disagreed inside one contract:
             `.salt-carousel > ul { scroll-behavior: smooth }` was refused and
             `.salt-carousel > ul { overflow-x: hidden }` passed, leaving the track
             unscrollable at exit 0. Not the class-name limit BD-044 records as rejected —
             that one names no class of ours at all; this one names `.salt-carousel`. */
          if (!other.selectors.some((selector) => stripNegations(selector).includes(REGION))) {
            continue
          }
          const again = LONGHANDS[property]?.(other)
          if (again !== undefined) {
            return `\`${other.selectors[0] ?? ''}\`${other.at.length > 0 ? ` (inside \`${other.at.join(' ')}\`)` : ''} declares \`${property}: ${again.trim()}\` as well, and this contract does not rank two rules — the track's scrolling is written once, unconditionally`
          }
        }
      }

      /*
       * ── The track is a flex row, and the slide does not shrink ────────────────────
       *
       * Both were outside the contract while its own `what` string claimed the track
       * "scrolls, snaps". Measured in Chromium at exit 0: `display: block` on the track and
       * `flex: 1 1 auto` on the slide each give `scrollWidth === clientWidth === 700` — no
       * overflow, so nothing scrolls and both controls sit permanently disabled — and a
       * deleted `scroll-snap-align` leaves `scroll-snap-type: x mandatory` with no snap
       * points at all, so an off-snap `scrollTo(100)` stays at 100.
       */
      const laid = LONGHANDS['display']?.(base)
      if (isImportant(laid)) {
        return `\`${TRACK}\` declares its display !important, which no contract here can rank`
      }
      /* Lower-cased before the comparison. `display: FLEX` was reported as "is not a flex
         row" — CSS values are ASCII case-insensitive, Chromium computes `flex`, and the
         track scrolls perfectly well. The same fact this commit's parent used to fix the
         `scroll-behavior` arm, not carried across to the arm written beside it. */
      const display = laid?.trim().toLowerCase()
      if (display !== 'flex' && display !== 'inline-flex') {
        const NOT_A_ROW = ['block', 'inline', 'grid', 'inline-grid', 'flow-root', 'contents', 'none']
        return display !== undefined && NOT_A_ROW.includes(display)
          ? `\`${TRACK}\` is not a flex row (display: ${display}), so the slides stack instead of overflowing and nothing scrolls`
          : `\`${TRACK}\` declares \`display: ${display ?? 'unset'}\`, a spelling this contract does not read — it may well be correct, so widen the list deliberately`
      }

      const SLIDE = '.salt-carousel__slide'
      const [slide, ...moreSlides] = matching(rules, (selector) =>
        reachesAll(selector, [SLIDE]),
      ).filter((candidate) => conditional(candidate.at).length === 0)

      if (slide === undefined) return `no unconditional rule reaches \`${SLIDE}\``
      if (moreSlides.length > 0) {
        return `${String(moreSlides.length + 1)} unconditional rules reach \`${SLIDE}\`; it is written once so that no contract here has to decide which of them wins`
      }

      /* One of three spellings that all mean "do not shrink", and nothing else. `flex: 1 30px`
         is grow-and-basis rather than grow-and-shrink, so reading the shorthand positionally
         needs unit-awareness this file is not going to grow. */
      const flex = fromLast(slide, ['flex', 'flex-shrink'], (property, raw) =>
        `${property}: ${raw.trim()}`,
      )
      const HOLDS_ITS_WIDTH = ['flex: 0 0 auto', 'flex: none', 'flex-shrink: 0']
      if (flex === undefined || !HOLDS_ITS_WIDTH.includes(flex)) {
        /*
         * Neither arm asserts a measurement, and the first one used to. A slide given
         * `min-inline-size: var(--salt-carousel-slide)` instead of `flex: 0 0 auto` does NOT
         * collapse — the floor beats flex-shrink, and Chromium measures a 320px slide in a
         * 2040px track — so "the slides collapse … (measured: scrollWidth equal to
         * clientWidth)" was a fabricated figure about a stylesheet that works. Fifth and
         * sixth of that class across two units; both arms now say what is true, which is
         * that this contract reads three spellings and no others.
         */
        return `\`${SLIDE}\` ${flex === undefined ? 'declares none of' : `declares \`${flex}\`, and this contract reads only`} ${HOLDS_ITS_WIDTH.map((spelling) => `\`${spelling}\``).join(', ')} — a slide that shrinks collapses to fit the track and leaves nothing to scroll, so widen the list deliberately rather than changing the stylesheet`
      }

      /*
       * OVERRIDE for the three checks this contract added LAST, which shipped with none.
       *
       * The round before this one added an override scan for the track's three scroll
       * properties and then wrote three more presence checks beside it with no scan at all —
       * and the slide's candidate list is filtered to unconditional rules, so a conditional
       * rule was invisible to both halves. Measured at exit 0:
       * `@media (min-width: 1px) { .salt-carousel__slide { flex: 1 1 auto } }` gives a 97px
       * slide in a 700px track with `scrollWidth === clientWidth`, one press moving nothing
       * and both controls permanently disabled; `{ .salt-carousel__track { display: block } }`
       * the same.
       *
       * ── Two gathers, and the difference is what each property can be confused with ──
       *
       * `flex`, `flex-shrink` and `scroll-snap-align` appear on exactly one element in this
       * stylesheet, so the broad `.salt-carousel` gather cannot mistake somebody else's rule
       * for the slide's — and it catches `.salt-carousel > ul`, which names no `__` class.
       *
       * `display` cannot use it. The region, the track and the controls row all declare
       * `display: flex` legitimately, and the broad gather reported the REGION's as an
       * override of the track's. So that one gathers on `__track` only, and
       * `.salt-carousel > ul { display: block }` goes uncaught — the class-name limit BD-040
       * records as needing a different tool, met again in the one place where narrowing to
       * avoid a false failure costs a true one.
       */
      const overrides = [
        [base, 'display', TRACK, TRACK],
        [slide, 'flex', SLIDE, REGION],
        [slide, 'flex-shrink', SLIDE, REGION],
        [slide, 'scroll-snap-align', SLIDE, REGION],
      ]
      for (const [owner, property, target, gather] of overrides) {
        for (const other of rules) {
          if (other === owner) continue
          if (!other.selectors.some((selector) => stripNegations(selector).includes(gather))) {
            continue
          }
          const again = fromLast(other, [property], (_name, raw) => raw)
          if (again !== undefined) {
            return `\`${other.selectors[0] ?? ''}\`${other.at.length > 0 ? ` (inside \`${other.at.join(' ')}\`)` : ''} also declares \`${property}: ${again.trim()}\`, and this contract does not rank two rules — ${target}'s layout is written once, unconditionally`
          }
        }
      }

      const align = LONGHANDS['scroll-snap-align']?.(slide)
      /* Lower-cased, for the third time in this file and the second in this contract:
         `scroll-snap-align: NONE` passed while `none` was caught, and Chromium computes
         `none` for both. */
      if (align === undefined || align.trim().toLowerCase().split(/\s+/).includes('none')) {
        return `\`${SLIDE}\` declares no snap point, so the track's \`scroll-snap-type\` has nothing to snap to and a half-scrolled carousel stays half-scrolled`
      }

      /*
       * And `scroll-behavior: smooth` may exist ONLY inside a bare
       * `prefers-reduced-motion: no-preference` query. Forbidding the shape rather than
       * ranking the rules, per BD-041: anything else — unconditional, a negated query, an
       * alternation, `reduce` — fails and says so.
       */
      for (const rule of rules) {
        if (!rule.selectors.some((selector) => stripNegations(selector).includes('.salt-carousel'))) {
          continue
        }
        const declared = LONGHANDS['scroll-behavior']?.(rule)
        if (declared === undefined) continue
        /* `!important` before the value comparison, and a case-insensitive compare after it.
           The first version tested `!== 'smooth'` and skipped the rule, so `scroll-behavior:
           smooth !important` and `scroll-behavior: SMOOTH` both walked past — verified in
           Chromium under forced reduced motion: both compute `smooth` and the arrow keys
           glide. CSS values are ASCII case-insensitive; the `required` list six lines up had
           its `!important` arm from the start and this loop did not. */
        if (isImportant(declared)) {
          return `\`${rule.selectors[0] ?? ''}\` declares \`scroll-behavior\` !important, which no contract here can rank`
        }
        if (declared.trim().toLowerCase() !== 'smooth') continue
        if (!welcomesMotion(rule.at)) {
          /*
           * Two outcomes, because "not a bare no-preference query" covers both a rule that
           * really does glide under reduce and a correct spelling this cannot read. Saying
           * the first about the second is the false claim BD-043 records three times:
           * `@media (prefers-reduced-motion: no-preference) and (min-width: 40rem)` is
           * strictly NARROWER and correct — measured, it computes `auto` under reduce and
           * jumps — and telling its author it glides sends them to undo something right.
           */
          const unconditional = conditional(rule.at).length === 0
          return unconditional
            ? `\`${rule.selectors[0] ?? ''}\` declares \`scroll-behavior: smooth\` unconditionally, so a reader who asked for reduced motion gets a glide on every arrow press`
            : `\`${rule.selectors[0] ?? ''}\` declares \`scroll-behavior: smooth\` inside \`${rule.at.join(' ')}\`, a shape this contract does not read — it may well be correct, so widen \`welcomesMotion\` deliberately rather than changing the stylesheet`
        }
      }

      return null
    },
  },
  {
    file: 'primitives.css',
    what: 'a carousel slide’s wrapper is as tall as the slide, and a carousel card fills it to its border',
    why:
      'The track stretches every slide to the tallest one, but the slide holds its `role="group"` ' +
      'wrapper rather than the card, so a card’s `block-size: 100%` resolves against the wrapper. ' +
      'With the wrapper at its content’s height, every card in a row was as tall as its own words: ' +
      '471, 309 and 434px in 638px slides on Floorworkz’s /services, measured in Chromium 154 on ' +
      '05/10/2026 (BD-205). And with the card in `content-box`, the 100% leaves out the padding and ' +
      'border, so on a site with no CSS reset each card ran 50px past its slide and the track gained ' +
      'a vertical scroll. Deleting either line reads as a tidy-up and changes nothing in markup.',
    check: (rules, all) => {
      const INNER = '.salt-carousel__slide-inner'
      const HEIGHT = new Set(['block-size', 'height'])
      /* The limits, in both spellings, read in the owning rules as well as everywhere else: a
         `max-height` written into the wrapper's own rule caps it as surely as one in another file. */
      const LIMITS = new Set(['max-block-size', 'max-height', 'min-block-size', 'min-height'])
      const SIZING = new Set([...HEIGHT, ...LIMITS])
      const where = (file, rule) =>
        `\`${rule.selectors[0] ?? ''}\`${rule.at.length > 0 ? ` (inside \`${rule.at.join(' ')}\`)` : ''} in ${file}`
      /*
       * Whether a selector's SUBJECT is the element itself (#225 review, 1 and 2). A substring test
       * read `.salt-grid .salt-card > .salt-icon`, `.salt-card__link::after` and
       * `.salt-carousel__slide-inner > .salt-gallery__figure` as the card or the wrapper, and told their
       * authors to undo correct CSS. So the last compound, negations out, must name the class itself,
       * and a pseudo-element on it is another box. A subject naming no class at all (`.salt-carousel__slide
       * > *`) is not read as the wrapper: the cost is a miss, the same class-name limit BD-040 records.
       *
       * Named anywhere in the compound outside a negation or a `:has()`, not only where it is required (#225
       * re-review): `:where(.salt-carousel__slide-inner)`, which is the shape core writes for
       * `:where(.salt-intro)`, and `:is(.salt-card, .salt-x)` both reach the element, and a rule reading
       * only required classes passed them. A branch naming the class with a combinator inside it
       * (`:is(.salt-x .salt-card)`) matches some cards and not others, which this contract cannot rank,
       * so it is `unread`: the third verdict, never a pass.
       */
      /* A `:has()` argument is a condition on the subject's contents, never the subject, so
         `.salt-grid:has(.salt-card)` is the grid (#225 re-review, 2nd round). Cut out whole, depth-aware
         and case-insensitively, as `stripNegations` cuts `:not()`. */
      const withoutHas = (compound) => {
        let out = ''
        for (let i = 0; i < compound.length; i += 1) {
          if (compound.slice(i, i + 5).toLowerCase() !== ':has(') {
            out += compound[i] ?? ''
            continue
          }
          let depth = 0
          let end = i + 4
          for (; end < compound.length; end += 1) {
            if (compound[end] === '(') depth += 1
            else if (compound[end] === ')') {
              depth -= 1
              if (depth === 0) break
            }
          }
          i = end
        }
        return out
      }
      const subjectOf = (selector, name) => {
        const subject = withoutHas(chainOf(stripNegations(selector)).compounds.at(-1) ?? '')
        if (/::|:(?:before|after|first-line|first-letter|marker)\b/i.test(subject)) return 'no'
        if (!compoundClasses(subject).has(name)) return 'no'
        const mention = new RegExp(`\\.${name}(?![\\w-])`)
        for (const group of subject.matchAll(/:(?:is|where|matches)\(/gi)) {
          let depth = 0
          let end = group.index + group[0].length - 1
          for (; end < subject.length; end += 1) {
            if (subject[end] === '(') depth += 1
            else if (subject[end] === ')') {
              depth -= 1
              if (depth === 0) break
            }
          }
          const inside = subject.slice(group.index + group[0].length, end)
          if (splitTop(inside, ',').some((branch) => hasCombinator(branch) && mention.test(branch))) return 'unread'
        }
        return 'is'
      }
      /* The height a rule gives, as the property that wins in it and its value, so a message names
         what it read (#225 review, 4). */
      const lastHeight = (rule) => declarationsOf(rule, HEIGHT).at(-1)
      const owners = matching(rules, (selector) => reachesAll(selector, [INNER]))
      const [inner, ...more] = owners.filter((candidate) => conditional(candidate.at).length === 0)
      if (inner === undefined) return `no unconditional rule reaches \`${INNER}\`, so a carousel card’s \`block-size: 100%\` resolves against its own content and the cards in a row are as tall as their words`
      if (more.length > 0) return `${String(more.length + 1)} unconditional rules reach \`${INNER}\`; it is written once so that no contract here has to decide which of them wins`
      const height = lastHeight(inner)
      if (height === undefined) return `\`${INNER}\` declares no \`block-size\`, so a carousel card’s \`block-size: 100%\` resolves against its own content and the cards in a row are as tall as their words`
      const read = `${height.property}: ${height.value.trim()}`
      if (isImportant(height.value)) return `\`${INNER}\` declares \`${height.property}\` !important, which no contract here can rank`
      if (height.value.trim().toLowerCase() !== '100%') {
        /* `auto` is the defect itself; anything else might fill the slide and might not, and this
           contract reads one spelling, so it says that rather than calling it wrong. */
        return height.value.trim().toLowerCase() === 'auto'
          ? `\`${INNER}\` declares \`${read}\`, so a carousel card’s \`block-size: 100%\` resolves against its own content and the cards in a row are as tall as their words`
          : `\`${INNER}\` declares \`${read}\`, a spelling this contract does not read; it reads \`100%\`, so widen it deliberately rather than changing the stylesheet`
      }
      const capped = declarationsOf(inner, LIMITS)[0]
      if (capped !== undefined) return `\`${INNER}\` also declares \`${capped.property}: ${capped.value.trim()}\` beside its height, and this contract reads the wrapper’s height as \`100%\` alone`

      /* Anything else sizing the wrapper, in any stylesheet and under any condition, is refused
         rather than ranked against the owner. */
      for (const [file, list] of all) {
        for (const other of list) {
          if (other === inner) continue
          const reach = other.selectors.map((selector) => subjectOf(selector, 'salt-carousel__slide-inner'))
          if (!reach.includes('is') && !reach.includes('unread')) continue
          const sized = declarationsOf(other, SIZING)[0]
          if (sized !== undefined && !reach.includes('is')) {
            return `${where(file, other)} declares \`${sized.property}: ${sized.value.trim()}\` through a selector group naming the slide wrapper beside a combinator, a shape this contract does not read; write the wrapper as the subject, or widen the contract deliberately`
          }
          if (sized !== undefined) {
            return `${where(file, other)} also declares \`${sized.property}: ${sized.value.trim()}\`, and this contract does not rank two rules — the slide wrapper’s height is written once, unconditionally`
          }
        }
      }

      /* The card's half: the carousel card's own rule fills the wrapper in `border-box`. */
      const CARD = normalise(".salt-block[data-block='carousel'] .salt-card")
      const card = (all.get('blocks.css') ?? []).find(
        (rule) => rule.at.length === 0 && rule.selectors.includes(CARD) && lastHeight(rule) !== undefined,
      )
      if (card === undefined) return `no unconditional \`${CARD}\` rule in blocks.css sets the card’s \`block-size\`, so a carousel card does not fill its slide`
      const fill = lastHeight(card)
      if (fill !== undefined && isImportant(fill.value)) return `\`${CARD}\` in blocks.css declares \`${fill.property}\` !important, which no contract here can rank`
      if (fill !== undefined && fill.value.trim().toLowerCase() !== '100%') return `\`${CARD}\` in blocks.css declares \`${fill.property}: ${fill.value.trim()}\`; this contract reads \`100%\`, the card filling its slide`
      const limit = declarationsOf(card, LIMITS)[0]
      if (limit !== undefined) return `\`${CARD}\` in blocks.css also declares \`${limit.property}: ${limit.value.trim()}\` beside its height, and this contract reads the card’s height as \`100%\` alone`
      const box = fromLast(card, ['box-sizing'], (_property, raw) => raw)
      if (box === undefined) return `\`${CARD}\` in blocks.css declares no \`box-sizing\`, so on a site with no CSS reset its \`block-size: 100%\` leaves out the padding and border and the card runs past its slide`
      if (isImportant(box)) return `\`${CARD}\` in blocks.css declares \`box-sizing\` !important, which no contract here can rank`
      if (box.trim().toLowerCase() !== 'border-box') {
        return box.trim().toLowerCase() === 'content-box'
          ? `\`${CARD}\` in blocks.css declares \`box-sizing: content-box\`, so its \`block-size: 100%\` leaves out the padding and border and the card runs past its slide`
          : `\`${CARD}\` in blocks.css declares \`box-sizing: ${box.trim()}\`, a spelling this contract does not read; it reads \`border-box\``
      }
      /* And nothing else re-sizes a carousel card or changes any card's box model, for the reason the
         wrapper's scan gives. Only a rule whose subject is the card itself: a card's icon or its link's
         `::after` is another box. */
      for (const [file, list] of all) {
        for (const other of list) {
          if (other === card) continue
          const reached = other.selectors.filter((selector) => subjectOf(selector, 'salt-card') === 'is')
          const unread = other.selectors.filter((selector) => subjectOf(selector, 'salt-card') === 'unread')
          if (reached.length === 0 && unread.length > 0) {
            const odd = declarationsOf(other, new Set(['box-sizing', ...SIZING]))[0]
            if (odd !== undefined) return `${where(file, other)} declares \`${odd.property}: ${odd.value.trim()}\` through a selector group naming the card beside a combinator, a shape this contract does not read; write the card as the subject, or widen the contract deliberately`
          }
          if (reached.length === 0) continue
          const model = declarationsOf(other, new Set(['box-sizing']))[0]
          if (model !== undefined) return `${where(file, other)} also declares \`box-sizing: ${model.value.trim()}\` on a card, and this contract does not rank two rules`
          if (!reached.some((selector) => stripNegations(selector).includes("[data-block='carousel']"))) continue
          const sized = declarationsOf(other, SIZING)[0]
          if (sized !== undefined) return `${where(file, other)} also declares \`${sized.property}: ${sized.value.trim()}\` on a carousel card, and this contract does not rank two rules — the card fills its slide, written once`
        }
      }
      return null
    },
  },
  {
    file: 'blocks.css',
    what: 'a centred list moves its markers inside the line box',
    why:
      '`list-style-position: outside` puts the marker in the padding at the line box\u2019s ' +
      'start edge, which under `text-align: center` is nowhere near the text it belongs to \u2014 ' +
      'a column of bullets hard against the measure with the items floating in the middle. ' +
      'The markup is byte-identical either way, so no test in the suite can see it and only ' +
      'the paint differs. This is the whole reason the rule exists, and it is one tidy-up ' +
      'away from being deleted as redundant.',
    check: (rules) => {
      /*
       * A selector reaching a list inside centred body copy. `.salt-rich-text` is required
       * as well as the attribute and the element, so a rule matching nothing real —
       * `[data-align='centre'] > :is(ul, ol)`, which reaches no list this markup produces —
       * cannot stand in for the rule that does. That decoy satisfied an earlier version.
       */
      const reaches = (selector) =>
        targetsAttribute(selector, 'data-align', 'centre') &&
        targetsElement(selector, 'ul') &&
        selector.includes('.salt-rich-text')

      /*
       * Rules are carried WITH the subset of their selectors that reach centred lists,
       * because a declaration belongs to a rule and applies to every selector on it. Asking
       * whether *some* selector is scoped is therefore the wrong question, and it is the
       * question the previous version asked: a rule listing both the scoped and the unscoped
       * form satisfied "declares the property" and "has a scoped selector" at once, while
       * the declaration landed on every list at every depth. That is byte-for-byte the
       * defect this contract exists for, and it passed.
       */
      const centred = rules
        .map((rule) => ({ rule, selectors: rule.selectors.filter(reaches) }))
        .filter((entry) => entry.selectors.length > 0)

      if (centred.length === 0) return 'no centred rule reaches the body copy\u2019s lists'

      /*
       * A spelling this cannot read, said plainly rather than discovered: `targetsElement`
       * rejects an `:is()` alternative containing a combinator, so
       * `:is(.salt-rich-text > ul, .salt-rich-text > ol)` is not recognised as reaching a
       * list at all and fails with a message pointing the wrong way. It narrows correctly
       * and no rule here is written that way; widening the parser to tell an ancestor
       * requirement from this would cost more than the spelling is worth.
       */

      /*
       * Two declarations on two DIFFERENT sets, and the scoping is the contract rather
       * than an incidental fact about how the rules are written.
       *
       * The marker moves inside on every list, nested ones included — a sub-list's markers
       * strand themselves as readily as a top-level list's. The indent is given up only by
       * the outermost list, because zeroing it at every depth flattens a nested list onto
       * its parent's items, and in centred text the indent is the only thing telling them
       * apart.
       *
       * Two earlier versions of this check were defeated. The first asserted the marker
       * alone, so deleting `padding-inline-start: 0` left an `inside` marker in a box still
       * inset by the base rule's 1.5em and the whole list sat off-centre from its heading.
       * The second asserted both declarations existed SOMEWHERE among the matching rules,
       * which is satisfied by folding them back into one unscoped rule — exactly the
       * pre-fix state, green. Both were found by review; neither is visible to a test,
       * because the markup is identical and only the paint differs.
       */
      /* PRESENCE is asserted unconditionally — a rule that only applies inside a media
         query is not the rule. OVERRIDE below considers conditional rules too, because an
         override inside one is exactly how a value gets undone. That split is this file's
         stated policy and this contract did not follow it. */
      const unconditional = centred.filter((entry) => conditional(entry.rule.at).length === 0)

      const marker = unconditional.some(
        (entry) =>
          /* `includes`, so `list-style: disc inside` counts as declaring it. */
          (declared(entry.rule, 'list-style-position') ?? '').split(/\s+/).includes('inside') &&
          entry.selectors.some((selector) => !isDirectChild(selector)),
      )
      if (!marker) {
        return 'no unconditional rule puts `list-style-position: inside` on lists at every depth'
      }

      const padding = unconditional.filter((entry) =>
        isZero(declared(entry.rule, 'padding-inline-start')),
      )
      if (padding.length === 0) return 'no unconditional rule declares `padding-inline-start: 0`'

      const leaks = padding.flatMap((entry) => entry.selectors.filter((s) => !isDirectChild(s)))
      if (leaks[0] !== undefined) {
        return `\`${leaks[0]}\` zeroes the indent at every depth, not just the outermost list`
      }

      /* ── Override ─────────────────────────────────────────────────────────────
         Same specificity later in the file, or an unlayered rule against a layered one,
         undoes either declaration with the presence checks above still satisfied. */
      const undone = centred.find((entry) => {
        const position = declared(entry.rule, 'list-style-position')
        const indent = declared(entry.rule, 'padding-inline-start')
        return (
          (position !== undefined && !position.split(/\s+/).includes('inside')) ||
          (indent !== undefined && !isZero(indent))
        )
      })
      if (undone !== undefined) {
        return `\`${undone.selectors[0] ?? ''}\` puts the marker or the indent back`
      }

      return null
    },
  },
  {
    file: 'sections.css',
    what: 'the wrapper establishes a stacking context',
    why:
      'without `isolation: isolate` a block’s z-index escapes its band and paints over the ' +
      'NEXT section’s background image — proven in Chromium, BD-026.',
    check: (rules) => {
      const found = matching(rules, (s) => s === '.salt-section').some(
        (rule) => rule.declarations['isolation'] === 'isolate',
      )
      return found ? null : 'no `.salt-section` rule declares `isolation: isolate`'
    },
  },
  {
    file: 'sections.css',
    what: 'NEITHER background layer paints under forced colours',
    why:
      'forced colours FORCE a background rather than stripping it, so a scrim left in place ' +
      'keeps its opacity and becomes Canvas — a 45% veil over an untouched photograph with ' +
      'forced text on top. The first version of this contract checked the media layer only, ' +
      'so deleting the scrim from the block reinstated exactly the defect BD-026 records.',
    check: (rules) => {
      /* The shared helper, not a fourth private copy. This one was never updated: it lacked
         the `/i` flag and matched `@media not (forced-colors: active)`, so negating the block
         hid the layers for everyone EXCEPT forced-colours users — BD-026's defect, inverted,
         with the gate green. */
      const forced = rules.filter((rule) => forcedColours(rule.at))
      const hidden = new Set(
        forced
          .filter((rule) => rule.declarations['display'] === 'none')
          .flatMap((rule) => rule.selectors),
      )
      const missing = ['.salt-section__media', '.salt-section__scrim'].filter((s) => !hidden.has(s))
      return missing.length === 0
        ? null
        : `${missing.join(' and ')} still paint(s) under forced colours`
    },
  },
  {
    file: 'sections.css',
    what: 'every tone declares BOTH poles, and they are different colours',
    why:
      'the image-backed indicator reads `--salt-section-ink-contra`, and nothing asserted a ' +
      'tone declares it. Deleting all eight left the gate green and the suite green — and ' +
      'the `var()` in `primitives.css` had no fallback, so an undefined value made the whole ' +
      '`box-shadow` invalid at computed-value time and BOTH poles vanished, leaving a bare ' +
      'ring over the photograph: worse than the single-pole version it replaced. The ' +
      'stylesheet comment claimed a forgotten opposite "fails visibly rather than silently", ' +
      'which was the one thing nothing checked.',
    check: (rules) => {
      const declaring = rules.filter((rule) => '--salt-section-ink' in rule.declarations)
      if (declaring.length === 0) return 'no tone declares `--salt-section-ink` at all'
      for (const rule of declaring) {
        const ink = rule.declarations['--salt-section-ink']
        const contra = rule.declarations['--salt-section-ink-contra']
        if (contra === undefined) {
          return `\`${rule.selectors.join(', ')}\` declares an ink with no opposite pole`
        }
        /* Straddling the lightness range is the whole guarantee (BD-023). Two poles that
           are the same token straddle nothing, and the closed form collapses to 1:1. */
        if (contra === ink) {
          return `\`${rule.selectors.join(', ')}\` points both poles at ${ink}`
        }
      }
      return null
    },
  },
  {
    file: 'sections.css',
    what: 'the scrim tints with the section tone, never a literal',
    why: 'at `strong` the composite has to trend back towards the pairing the audit proved.',
    check: (rules) => {
      const scrim = matching(rules, (s) => s === '.salt-section__scrim')
      const tinted = scrim.some((rule) =>
        Object.values(rule.declarations).some((value) => value.includes('var(--salt-section-bg)')),
      )
      return tinted ? null : 'the scrim does not tint from `--salt-section-bg`'
    },
  },
  {
    file: 'sections.css',
    what: 'over a photograph, muted text takes the tone’s full ink',
    why:
      'muted ink is proved on every flat tone and cannot be proved over a photograph at any scrim ' +
      'strength that still shows one: against the worst pixel an image can put under the scrim it ' +
      'needs 0.94 of alpha on the inverted band. On the first client site, measured in ' +
      'chrome-headless-shell 148.0.7778.96, an eyebrow over a photograph read 1.1 to 3.5:1 on the ' +
      'standard scrim and failed 22 of 24 cases on the strong one (lightlysaltedhq/salt-core#176). ' +
      'The contrast manifest proves the tone’s own ink there instead (`text-over-image-on-*`, ' +
      'BD-163), and this is the only place that ties the manifest to what the stylesheet paints, as ' +
      'the focus contract above does for the indicator. It cannot tell which elements sit over a ' +
      'photograph, so it does not try: it requires the one rule that repoints the variable inside an ' +
      'image-backed band, and refuses any other declaration of it, and any read of a muted role ' +
      'around it, in the three stylesheets that draw inside a section. `chrome.css` is not read: the ' +
      'header, the drawer and the footer are rendered outside every band.',
    check: (rules, all) => {
      const MUTED = '--salt-section-ink-muted'
      const INK = '--salt-section-ink'
      const SUBJECT = '.salt-section[data-media] > .salt-section__content'
      const INSIDE_A_SECTION = ['sections.css', 'primitives.css', 'blocks.css']

      /* Custom property names are case-sensitive, so the key is read exactly: `--SALT-SECTION-INK-MUTED`
         is a different property, and a rule declaring it repoints nothing. */
      const owners = rules.filter(
        (rule) =>
          rule.selectors.includes(SUBJECT) && conditional(rule.at).length === 0 && rule.order.includes(MUTED),
      )
      const [owner, ...extra] = owners
      if (owner === undefined) {
        return `no unconditional \`${SUBJECT}\` rule declares \`${MUTED}\`, so an eyebrow, a stat’s label or a caption over a photograph keeps the muted ink; write \`${SUBJECT} { ${MUTED}: var(${INK}) }\``
      }
      if (extra.length > 0 || owner.order.filter((property) => property === MUTED).length > 1) {
        return `\`${MUTED}\` is declared more than once on \`${SUBJECT}\`; write it once, so that no contract here has to decide which one the browser keeps`
      }
      const value = owner.declarations[MUTED] ?? ''
      /* Importance first, before the value is compared to anything. */
      if (isImportant(value)) {
        return `\`${SUBJECT}\` declares \`${MUTED}\` as \`!important\`, which this contract cannot rank; remove it`
      }
      /* `var()` is ASCII case-insensitive; the custom property's name is not. */
      const named = /^var\(\s*(--[\w-]+)\s*\)$/i.exec(value.trim())
      if (named === null) {
        return `\`${SUBJECT}\` writes \`${MUTED}: ${value}\`, a spelling this contract does not read; write exactly \`var(${INK})\``
      }
      if (named[1] !== INK) {
        return `\`${SUBJECT}\` points \`${MUTED}\` at \`${named[1] ?? ''}\`, not \`${INK}\`, the tone’s own ink that the manifest proves over a photograph`
      }

      /*
       * Every other declaration of the variable. On the wrapper it is harmless, whatever its
       * conditions: the rule above declares it on the content, and a child's own declaration
       * replaces what it would inherit. A rule that paints its own surface in the same breath,
       * the consent banner and its panel, puts its muted text on that surface rather than on a
       * photograph. Anything else may sit over an image, and this cannot rank it against the rule
       * above, so it is refused.
       */
      /* The footer's own element is a wrapper too: it takes its tone from these rules (BD-204), and
         it is rendered outside every band, so no photograph is ever under it. */
      const onWrapper = (selector) => /^\.salt-(?:section|footer)(?:\[[^\]]+\])*$/.test(lastCompound(selector))
      const paintsOwnSurface = (rule) =>
        /^var\(\s*--color-surface[\w-]*\s*\)$/i.test((rule.declarations['background-color'] ?? '').trim())
      for (const file of INSIDE_A_SECTION) {
        for (const rule of all.get(file) ?? []) {
          if (rule === owner || !rule.order.includes(MUTED)) continue
          if (rule.selectors.every(onWrapper) || paintsOwnSurface(rule)) continue
          return `\`${rule.selectors.join(', ')}\` in \`${file}\` declares \`${MUTED}\` on something that may sit over a photograph, and this contract cannot rank it against \`${SUBJECT}\`. Declare it on a \`.salt-section\` tone, or in a rule that paints its own \`--color-surface\` ground`
        }
      }

      /* A muted role read around the variable never reaches the rule above. The fallback inside
         `var(--salt-section-ink-muted, …)` is the one read allowed, because it applies only where
         no section declares the variable, which is outside every band. */
      const withoutFallbacks = (input) => {
        let text = input
        for (let match = /var\(\s*--salt-section-ink-muted(?![\w-])/i.exec(text); match !== null; match = /var\(\s*--salt-section-ink-muted(?![\w-])/i.exec(text)) {
          let depth = 0
          let end = match.index
          for (; end < text.length; end += 1) {
            if (text[end] === '(') depth += 1
            else if (text[end] === ')') {
              depth -= 1
              if (depth === 0) break
            }
          }
          text = `${text.slice(0, match.index)}${text.slice(end + 1)}`
        }
        return text
      }
      for (const file of INSIDE_A_SECTION) {
        for (const rule of all.get(file) ?? []) {
          for (const [property, raw] of Object.entries(rule.declarations)) {
            if (property === MUTED) continue
            const read = /--color-ink-muted[\w-]*/i.exec(withoutFallbacks(raw))
            if (read !== null) {
              return `\`${rule.selectors.join(', ')}\` in \`${file}\` reads \`${read[0]}\` in \`${property}\` without going through \`${MUTED}\`, so over a photograph it keeps the muted ink; write \`var(${MUTED}, var(${read[0]}))\``
            }
          }
        }
      }
      return null
    },
  },
  {
    file: 'primitives.css',
    what: "the tab's focus indicator is drawn on the LABEL, not on the clipped input",
    why:
      'focus lands on `.salt-tabs__input`, which `.salt-sr-only` clips to a 1×1 box, so an ' +
      'indicator on the input itself is an indicator nobody can see. Every other entry in ' +
      'the flat-tone list is a bare class, so narrowing this one to `.salt-tabs__input` to ' +
      'match its neighbours reads as tidying — and it exits 0 while removing the indicator ' +
      'from every tab in the palette. Measured: keyboard-focused tab 1 at 1024×900 draws ' +
      '`outline rgb(98,109,123) solid 2px`, offset 2px and a `0 0 0 6px` keyline in the ' +
      'source, and `outline: none` with no keyline once narrowed, with the ring moving onto ' +
      'the clipped input. That is a WCAG 2.4.7 failure, shipped green, which is why the ' +
      'compound is a contract and not a comment.',
    check: (rules) => {
      const focus = matching(rules, focuses)
      if (focus.length === 0) return 'no `:focus-visible` rule at all'

      /* Every selector naming the input, in the flat-tone rule and the image-backed one
         alike — narrowing either leaves a tab with no indicator on that kind of band. */
      const naming = focus
        .flatMap((rule) => rule.selectors)
        .filter((selector) => selector.includes('.salt-tabs__input'))
      if (naming.length === 0) {
        return 'no `:focus-visible` selector reaches `.salt-tabs__input`, so a focused tab draws nothing'
      }
      for (const selector of naming) {
        if (!/\.salt-tabs__input:focus-visible\s*\+\s*\.salt-tabs__tab$/.test(selector.trim())) {
          return `\`${selector.trim()}\` does not end in \`+ .salt-tabs__tab\`, so the indicator is drawn on the clipped input`
        }
      }
      /* Both rules, not one: the flat-tone indicator and the image-backed composition are
         separate rules and a tab can be focused on either kind of band. */
      const scoped = naming.filter((selector) => selector.includes('[data-media]'))
      if (scoped.length === 0) return 'no image-backed rule draws the tab indicator'
      if (naming.length - scoped.length === 0) return 'no flat-tone rule draws the tab indicator'
      return null
    },
  },
  {
    file: 'primitives.css',
    what: 'the focus keyline is the OUTER part of the indicator',
    why:
      'the outline paints over the box-shadow, so a spread no greater than offset+width ' +
      'leaves the RING against the band — 2.775:1 light and 2.235:1 dark on `surface-inverse`, ' +
      'the pairing BD-016 proved no seed can fix. The keyline must be the part adjacent to ' +
      'the tone, which needs spread > offset + width, all three present, and not `inset`.',
    check: (rules) => {
      const focus = matching(rules, focuses)
      if (focus.length === 0) return 'no `:focus-visible` rule at all'
      for (const rule of focus) {
        const { outline, 'outline-offset': offsetRaw, 'box-shadow': shadow } = rule.declarations
        if (outline === undefined) return `\`${rule.selectors.join(', ')}\` declares no outline`
        if (shadow === undefined) return `\`${rule.selectors.join(', ')}\` declares no keyline`
        if (/\binset\b/.test(shadow)) return 'the keyline is `inset`, so it paints inside the border box'
        /* `outline: solid 2px var(--color-focus)` is valid CSS and renders identically, so
           the width is whichever token IS a length, not whichever comes first. Assuming
           position turned a correct stylesheet into a red run. */
        const width = outline.split(/\s+/).map((token) => ringLength(token)).find((value) => value !== null) ?? null
        const offset = ringLength(offsetRaw)
        /*
         * The spread is the fourth length in `0 0 0 <spread> <colour>`, and with several
         * shadows the binding one is the SMALLEST.
         *
         * The outline paints over the shadows, so a layer only shows outside the ring where
         * its spread exceeds `offset + width`. Checking the largest passed a composition
         * whose inner pole was swallowed: spreads of 4px and 8px against a 2px offset and a
         * 2px outline leave the contra pole visible only INSIDE the ring, so the photograph
         * meets a single pole again — the failure this contract exists to prevent.
         */
        const spreads = splitTop(shadow, ',').map((layer) => spreadLength(layerTokens(layer)[3]))
        if (width === null) return `outline width \`${outline}\` is not an integer px length or a ring token`
        if (offset === null) return `outline-offset \`${String(offsetRaw)}\` is not an integer px length or a ring token`
        if (spreads.some((value) => value === null)) return `keyline spread in \`${shadow}\` is neither an integer px length nor \`calc(var(--focus-ring-offset) + var(--focus-ring-width) + <n>px)\``
        /* Every layer, which is the smallest one's test without needing a minimum of unknowns. */
        const ring = sum(offset, width)
        const spread = spreads.find((value) => !exceeds(value, ring))
        if (spread !== undefined) {
          return `spread ${spelt(spread)} does not clear offset ${spelt(offset)} + width ${spelt(width)} for every value of the ring tokens, so the ring can be outermost`
        }
      }
      return null
    },
  },
  {
    file: 'primitives.css',
    what: 'nothing outside the focus rules declares an outline or a box-shadow',
    why:
      'the focus indicator is an outline and a box-shadow, and any later rule reaching a control can ' +
      'replace part of it: the invalid contact field\u2019s inset did exactly that, and the ring met the ' +
      'inverted band alone at 2.775:1 light and 2.235:1 dark (BD-167). What such a rule does to the ' +
      'focused state depends on the cascade, which this gate cannot resolve, so the shape is refused ' +
      'whatever its selector: `a`, `*` and `[class*=\'salt-button\']` reach a control without naming ' +
      'one, which is how a subject-based version of this check was passed three times. The named ' +
      'exceptions are listed one declaration each, and the conformance test holds the same list.',
    check: (_rules, all) => {
      const EXCEPTIONS = ["primitives.css .salt-contact__input[aria-invalid='true']:not(:focus-visible) box-shadow"]
      const found = []
      for (const [file, rules] of all) {
        for (const rule of rules) {
          if (rule.selectors.some((selector) => /:focus(?:-visible|-within)?\b/i.test(withoutNegations(selector)))) continue
          for (const property of Object.keys(rule.declarations)) {
            /* A vendor-prefixed spelling and `all`, which resets both, reach the same properties. */
            const name = property.toLowerCase()
            if (!/^(?:-[a-z]+-)?(?:outline(?:-.*)?|box-shadow)$/.test(name) && name !== 'all') continue
            for (const selector of rule.selectors) found.push(`${file} ${selector} ${name}`)
          }
        }
      }
      const unnamed = found.filter((entry) => !EXCEPTIONS.includes(entry))
      if (unnamed.length > 0) return `${unnamed.join('; ')}: declared outside the focus rules, and named nowhere`
      const missing = EXCEPTIONS.filter((entry) => found.filter((f) => f === entry).length !== 1)
      if (missing.length > 0) return `${missing.join('; ')}: a named exception not found exactly once`
      return null
    },
  },
  {
    file: 'primitives.css',
    what: 'an image-backed section draws BOTH poles, both of them VISIBLE',
    why:
      'BD-023 decided this and it went unimplemented for a unit while `focus-over-image` ' +
      'passed, measuring a composition the stylesheet did not draw. Over a photograph the ' +
      'flat-tone indicator carries the single pole its tone pairs with, and a photograph ' +
      'matching it leaves a keyboard user with no indicator; the ring cannot help because ' +
      'it is interior. `pairings.ts` names this contract as the only place the manifest and ' +
      'the stylesheet are tied together, so it has to assert what is PAINTED. Checking that ' +
      'two pole tokens merely appear was the presence-versus-effect defect one level up: ' +
      'earlier shadows paint over later ones, so listing the ink pole first, or giving the ' +
      'two equal spreads, or zeroing the contra spread, each leaves one pole drawn.',
    check: (rules) => {
      const scoped = matching(
        rules,
        (s) => s.includes('[data-media]') && focuses(s),
      )
      if (scoped.length === 0) return 'no focus rule is scoped to an image-backed section'

      /* The controls the flat-tone indicator covers, as whole selectors. The image composition must
         cover the same ones: narrowing it to `.salt-button` drops `.salt-card__link` back to the
         one-pole rule, and a card link is the main control on an image-backed hero. Compared whole,
         not as text: this read the first class of each flat selector and asked whether the image
         rule's selector CONTAINED it, and `.salt-logo` is a substring of `.salt-logos__frame`, so
         deleting `.salt-logo` from the `:is()` passed (#185 re-review). */
      const controls = matching(rules, (s) => focuses(s) && !s.includes('[data-media]')).flatMap((rule) => rule.selectors)
      const BAND = '.salt-section[data-media] '

      for (const rule of scoped) {
        const selector = rule.selectors.join(', ')
        /* Each selector is `<band> :is(<controls>):focus-visible` or `<band> <one flat selector>`;
           any other shape is refused rather than read. */
        const items = []
        for (const one of rule.selectors) {
          if (!one.startsWith(BAND)) return `\`${one}\` is not scoped by \`${BAND.trim()}\` as its first compound`
          const rest = one.slice(BAND.length)
          const list = /^:is\((.*)\):focus-visible$/.exec(rest)
          items.push(...(list === null ? [rest] : splitTop(list[1] ?? '', ',').map((item) => `${item.trim()}:focus-visible`)))
        }
        const uncovered = controls.filter((control) => !items.includes(control))
        if (uncovered.length > 0) {
          return `\`${selector}\` leaves ${uncovered.join(', ')} on the one-pole indicator`
        }
        const stray = items.filter((item) => !controls.includes(item))
        if (stray.length > 0) {
          return `\`${selector}\` names ${stray.join(', ')}, which the flat-tone list does not`
        }

        /*
         * Identify the pole, not an exact string: both `var()`s carry a fallback, so
         * `var(--salt-section-ink, var(--color-ink))` and the bare form are one pole, and
         * `-contra` must not be read as the plain one. Written out rather than folded into
         * an `?? null`, because that conflated "the plain ink pole" with "no pole named at
         * all" — a layer painting an arbitrary colour would have read as the tone's ink.
         */
        const poleOf = (layer) => {
          const match = /var\(\s*--salt-section-ink(-contra)?\s*[,)]/.exec(layer)
          if (match === null) return null
          return match[1] === undefined ? 'ink' : 'contra'
        }
        const layers = splitTop(rule.declarations['box-shadow'] ?? '', ',').map((layer) => ({
          spread: spreadLength(layerTokens(layer)[3]),
          pole: poleOf(layer),
        }))
        if (layers.length < 2) return `\`${selector}\` draws one shadow layer, not two`
        if (!layers.every((l) => l.pole !== null)) {
          return `\`${selector}\` has a shadow layer that names neither pole`
        }
        if (new Set(layers.map((l) => l.pole)).size < 2) {
          return `\`${selector}\` names one pole twice`
        }
        if (layers.some((l) => l.spread === null)) {
          return `\`${selector}\` has a shadow spread that is neither an integer px length nor \`calc(var(--focus-ring-offset) + var(--focus-ring-width) + <n>px)\``
        }

        /*
         * Strictly increasing, in list order. That is the whole geometry: a layer is only
         * visible in the annulus its spread adds beyond every layer before it, so equal or
         * decreasing spreads mean the later layer is painted over completely.
         */
        const spreads = layers.map((l) => l.spread)
        if (isNoLength(spreads[0])) return `\`${selector}\` gives its innermost layer no extent`
        for (let i = 1; i < spreads.length; i += 1) {
          if (!exceeds(spreads[i], spreads[i - 1])) {
            return `\`${selector}\` spreads ${spreads.map(spelt).join(', ')} are not increasing for every value of the ring tokens, so a pole can be painted over`
          }
        }
        if (layers.at(-1)?.pole !== 'ink') {
          return 'the outermost pole is not the tone’s own ink, so a scrimmed band loses its proven pairing'
        }
      }
      return null
    },
  },
  {
    file: 'primitives.css',
    what: 'each axis is floored once, unconditionally, on the selector that has to carry it',
    why:
      'WCAG 2.5.8 wants 24 CSS px, and the criterion is about what APPLIES. Two questions ' +
      'have to be answered together, and every previous version of this check answered one ' +
      'and dropped the other. Enumerating which rules MAY restate an axis missed `ghost`, ' +
      'and missed a floor moved inside a media query. Counting declarers instead caught ' +
      'those and lost the tie between an axis and the control it must reach, so moving the ' +
      'height floor onto the icon-only rule left every text button unfloored and passed. ' +
      'The floor must exist ON the right selector, and nothing may restate it.',
    check: (rules) => {
      const buttons = rules.filter((rule) => rule.selectors.some((s) => s.includes('.salt-button')))

      /*
       * 2.5.8's own exception, and the only rule permitted to declare an axis besides the
       * floors themselves: an inline link cannot be padded without breaking its line box.
       * It has to exclude icon-only controls ON THE MATCHED ELEMENT to qualify — an
       * icon-only control is not in a sentence — and it may only zero, never set a value.
       */
      const isInlineLinkException = (rule) =>
        rule.selectors.every((s) => s.includes("[data-style='link']") && excludesIconOnly(s)) &&
        ALL_PROPERTIES.every((property) => {
          const value = rule.declarations[property]
          return value === undefined || px(value) === 0
        })

      for (const { name, properties, parts, who, because } of AXES) {
        const declarers = buttons.filter(
          (rule) =>
            properties.some((property) => rule.declarations[property] !== undefined) &&
            !isInlineLinkException(rule),
        )
        if (declarers.length > 1) {
          const names = declarers.map((rule) => `\`${rule.selectors.join(', ')}\``).join(' and ')
          return `${names} both declare ${name}; the more specific one REPLACES the other rather than raising it`
        }
        const only = declarers[0]
        if (only === undefined) return `nothing floors ${name} on a button`
        /* `some`, not `every`. The question is whether the floor reaches every button, and a
           selector list satisfies that if ANY of its selectors does — `.salt-button,
           .salt-nav__cta` shares the box with another control and still floors every button.
           `every` is right for the negation in the exception test, which asks whether a rule
           can EVER reach an icon-only control; that one has to hold for all of them. */
        if (!only.selectors.some((selector) => reachesAll(selector, parts))) {
          return `${name} is floored on \`${only.selectors.join(', ')}\`, which does not reach every button it must — it needs ${who}, because ${because}`
        }

        const inside = conditional(only.at)
        if (inside.length > 0) {
          return `${name} is floored only inside \`${inside.join(' ')}\`, so outside it there is no floor`
        }

        /*
         * EVERY spelling declared on the rule, not the first one found.
         *
         * Both spellings set the same used value, and within one block the LATER one wins.
         * So `min-block-size: max(2.75rem, 24px); min-height: 0;` in the base rule removes
         * the floor from every button — and taking the first match saw only the good half.
         * Bringing `min-height` into the axis closed the cross-rule case and left the
         * same-rule case open, which is the third time in this contract's history that a
         * fix has been applied to one of the two places the property has to hold.
         */
        for (const property of properties) {
          const declared = only.declarations[property]
          if (declared === undefined) continue
          const floor = readFloor(declared)
          if (floor === null) {
            return `\`${only.selectors.join(', ')}\` sets ${property} to \`${declared}\` with no px floor, so a root-size change can breach 2.5.8`
          }
          if (!reachesTargetFloor(floor)) {
            return `\`${only.selectors.join(', ')}\` floors ${property} at \`${floor.expression}\`, which never reaches 24 CSS px`
          }
        }
      }
      return null
    },
  },
  {
    file: 'primitives.css',
    what: 'no link-styled rule can cancel the floor on an icon-only control',
    why:
      'both selectors were (0,2,0), so source order decided — and the link rule, which zeroes ' +
      'the minimum, came later. Asserting the `:not()` appears SOMEWHERE was not enough: ' +
      'splitting the rule in two restores the defect with the `:not()` still present. What ' +
      'has to hold is that no rule zeroing the floor reaches an icon-only control.',
    check: (rules) => {
      const offenders = rules.filter(
        (rule) =>
          rule.selectors.some(
            /* Third site of the same inverted test. `!includes` reads "does not mention
               icon-only", when the question is "does not EXCLUDE icon-only" — so a rule
               written `[data-style='link'][data-icon-only]`, which targets exactly the
               control this contract names, was exempted for mentioning the attribute. */
            (s) => s.includes("[data-style='link']") && !excludesIconOnly(s),
          ) &&
          ['min-inline-size', 'min-block-size'].some((axis) => {
            const value = rule.declarations[axis]
            return value !== undefined && px(value) === 0
          }),
      )
      return offenders.length === 0
        ? null
        : `\`${offenders[0]?.selectors.join(', ') ?? ''}\` zeroes the floor and matches an icon-only control`
    },
  },
  {
    file: 'primitives.css',
    what: 'the card edge takes the band’s hairline, not the light-mode one',
    why:
      '`var(--color-border)` is a mode token on a band-tinted element: 1.435:1 on `surface`, ' +
      'the hairline intended, and 10.173:1 on `surface-inverse`, a hard light outline. The ' +
      'same declaration reading as two different design decisions depending on the band. ' +
      'Not a WCAG failure — a card edge identifies no component and 1.4.11 does not govern ' +
      'it — so no pairing row could ever fail on it, which is exactly why it needs a ' +
      'contract rather than a measurement (BD-033).',
    check: (rules) => {
      const card = rules.filter((rule) => rule.selectors.some((s) => s.trim() === '.salt-card'))
      if (card.length === 0) return 'no `.salt-card` rule at all'

      /* Presence unconditional: a border that only exists inside a media query is not the
         card's edge. */
      if (!card.some((rule) => rule.declarations['border'] !== undefined && conditional(rule.at).length === 0)) {
        return '`.salt-card` declares no unconditional border'
      }

      /* Override across conditional rules too, forced colours aside. Filtering every at-rule
         out — which the first version did, justified by the forced-colours case alone — let
         `@media (min-width: 40rem) { .salt-card { border-color: var(--color-border) } }`
         reinstate the 10.173:1 outline at every desktop viewport with the gate green. The
         rich-text contract states this rule twenty lines below and it was not applied here. */
      const bordered = card.filter(
        (rule) =>
          !forcedColours(rule.at) &&
          (rule.declarations['border'] !== undefined || rule.declarations['border-color'] !== undefined),
      )
      /* `border-color` too. A longhand after the shorthand wins, so
         `.salt-card { border-color: var(--color-border) }` reinstates the full 10.173:1
         defect with a contract checking only `border` reporting intact — the same
         two-spellings-of-one-property shape as `min-height` against `min-block-size`. */
      const offender = bordered.find((rule) => {
        const declared = rule.declarations['border-color'] ?? rule.declarations['border'] ?? ''
        return !declared.includes('var(--salt-section-border')
      })
      return offender === undefined
        ? null
        : `\`.salt-card\` borders with \`${offender.declarations['border-color'] ?? offender.declarations['border'] ?? ''}\`, which does not follow the band`
    },
  },
  {
    file: 'primitives.css',
    what: 'body copy restores the list markers a CSS reset removes',
    why:
      '`.salt-rich-text` was the only class this package emits with no rule at all, and ' +
      'consuming apps import Tailwind, whose preflight sets `ol, ul, menu { list-style: ' +
      'none }` and zeroes every padding in its universal reset — read out of the installed ' +
      '`tailwindcss@4.3.3` rather than paraphrased, after every site in the package that ' +
      'quoted the rule was found repeating one nobody had read. So the one component whose ' +
      'whole job is ' +
      'rendering prose shipped with ' +
      'no bullets, no numbering and no indentation — invisible to every test, because ' +
      'nothing reads a CSS rule (BD-026). Found by review rather than by a gate, which is ' +
      'what earns it one.',
    check: (rules) => {
      /*
       * TWO sets, because the two questions want different ones and the previous version
       * used one for both.
       *
       * "Does a floor exist" must ignore conditional rules — the body-copy block moved
       * inside `@media print` left the gate green while screen rendering had no bullets.
       * "Does anything override it" must NOT, because an override inside a media query is
       * exactly how a marker gets removed. Filtering first made the `at(-1)` search that was
       * added alongside it blind to the case it exists for.
       */
      const all = rules.filter((rule) => rule.selectors.some((s) => s.includes('.salt-rich-text')))
      const prose = all.filter((rule) => conditional(rule.at).length === 0)
      if (prose.length === 0) return '`.salt-rich-text` has no unconditional rule at all'

      /*
       * Per LIST TYPE, not "does any prose rule mention list-style-type anywhere". The first
       * version asked the loose question and passed with the `ul` rule deleted, because the
       * `ol` rule still declared one — the same presence-versus-effect shape this gate has
       * been caught by before.
       */
      for (const [list, marker] of [
        ['ul', 'disc'],
        ['ol', 'decimal'],
      ]) {
        const targets = (rule) =>
          rule.selectors.some((sel) => sel.includes('.salt-rich-text') && targetsElement(sel, list))

        /*
         * `list-style` as well as `list-style-type`. The shorthand resets the longhand, and
         * `ol, ul, menu { list-style: none }` is the exact declaration this contract's own
         * rationale quotes from Tailwind preflight — so the one spelling most likely to
         * reintroduce the defect was the one spelling the check could not see.
         */
        const markerOf = (rule) =>
          rule.declarations['list-style-type'] ??
          rule.declarations['list-style']?.split(/\s+/).find((part) => part !== 'inherit')

        if (!prose.some((rule) => targets(rule) && markerOf(rule) === marker)) {
          return `no unconditional \`.salt-rich-text ${list}\` rule sets ${marker} markers`
        }

        /* …and the last rule to declare it, conditional or not, has to agree. Equal
           specificity means source order wins, so a later `list-style-type: none` — bare, or
           inside `:is(ul, ol)`, or wrapped in a media query — removes every marker. */
        const declaring = all.filter((rule) => targets(rule) && markerOf(rule) !== undefined)
        const last = declaring.at(-1)
        if (last !== undefined && markerOf(last) !== marker) {
          return `\`${last.selectors.join(', ')}\`${
            conditional(last.at).length > 0 ? ` inside \`${conditional(last.at).join(' ')}\`` : ''
          } overrides ${list} markers to ${markerOf(last) ?? 'unset'}`
        }
      }

      /*
       * A VALUE, not a declaration. `!== undefined` passes on `padding-inline-start: 0` and
       * `margin-block-start: 0`, whose failure messages are "markers are clipped" and "every
       * paragraph runs into the next" — which is what those values produce. The same
       * presence-versus-effect escape the file header documents for `outline-offset`.
       */
      /*
       * Rejects zero and negatives; accepts everything it cannot read.
       *
       * Two versions got this wrong in opposite directions. `/^0([a-z%]*)?$/` was
       * case-sensitive and integer-only, so `0.0em`, `0PX` and `-0.5em` all read as a
       * positive indent. Parsing a leading number instead then rejected everything that does
       * not start with a digit — `clamp(1em, 2vw, 2em)`, `var(--space-gutter)`, `calc(…)` —
       * turning a perfectly good indent into a red run whose message says the markers are
       * clipped.
       *
       * A gate should fail on what it can prove wrong, not on what it cannot parse.
       */
      const positive = (value) => {
        if (value === undefined) return false
        const measure = /^(-?\d*\.?\d+)/.exec(value.trim())
        return measure === null || Number(measure[1]) > 0
      }

      const indented = prose.some(
        (rule) =>
          rule.selectors.some((s) => /:is\(ul, ?ol\)|\bul\b|\bol\b/.test(s)) &&
          positive(rule.declarations['padding-inline-start']),
      )
      if (!indented) return 'lists carry no indent, so markers set to `outside` are clipped'

      const spaced = prose.some(
        (rule) =>
          rule.selectors.some((s) => s.includes('> * + *')) &&
          positive(rule.declarations['margin-block-start']),
      )
      return spaced ? null : 'no flow spacing between blocks, so every paragraph runs into the next'
    },
  },
  {
    file: 'primitives.css',
    /* Narrower than it first read. It holds the decoration properties and `all`; a layout
       property can still stop the line being drawn. `display: inline-block` on a body `<code>`
       takes a code-formatted link's underline away, because an atomic inline receives no
       ancestor's decoration: measured in chrome-headless-shell 148.0.7778.96 on 22/09/2026, an
       underlined link around inline `<code>` drew four full-width rows under the glyphs and
       one around inline-block `<code>` drew none. Refusing layout properties on rich-text
       descendants is deferred to section 7. */
    what:
      'a link in body copy is underlined by one rule, and no other rule in any stylesheet ' +
      'declares a text-decoration property that could reach it',
    why:
      'Tailwind’s preflight sets `a { color: inherit; text-decoration: inherit }` and nothing ' +
      'in core styled `.salt-rich-text a`, so an editor’s link drew in the words’ own ' +
      'colour, weight and decoration: measured in chrome-headless-shell 148.0.7778.96 on ' +
      '22/09/2026, a footer link and its paragraph both computed `rgb(78, 86, 97)`, ' +
      '`text-decoration-line: none`, weight 400 — WCAG 1.4.1 failed at Level A in every ' +
      'body `restrictedRichText` renders. The underline is the only cue, because the link ' +
      'keeps the text’s ink on purpose. The first version of this contract read ' +
      '`primitives.css` alone and modelled the cascade inside it, and review walked three ' +
      'edits past it at exit 0, each computing `none` or an invisible line in Chrome 148: ' +
      '`.salt-block[data-block=\'cta\'] .salt-rich-text a { text-decoration: none }` in ' +
      '`blocks.css`, `.salt-footer__text a { text-decoration: none }` in `chrome.css` — both ' +
      'loaded after `primitives.css` — and `text-decoration-color: transparent` on the rule ' +
      'itself. So this models nothing. It fixes one spelling in one rule and refuses every ' +
      'other rule, in every stylesheet the gate reads, that decorates text and cannot be ' +
      'proved to miss a body link.',
    check: (rules, all) => {
      /*
       * ── The element, exactly as `createRichText` renders it ──────────────────────
       *
       * `components/rich-text.tsx` emits `<a href>` with no class and no id, plus `target` and
       * `rel` when the editor ticked a new tab. Nothing else. So a key compound misses it only
       * if it asks for something that element never carries: a class, an id, another element
       * type, or an attribute other than those three. A pseudo-element is a different box, so
       * a rule on `a::after` does not reach the link's own line either. A grouping or negating
       * pseudo-class (`:is`, `:where`, `:has`, `:not`) hides what it matches, so its argument is
       * opaque and never read as proof — W4's rule for the header logo, inherited here.
       */
      const CARRIES = ['href', 'target', 'rel']
      const OWNER = '.salt-rich-text a'
      const CANONICAL = {
        'text-decoration-line': 'underline',
        'text-underline-offset': '0.15em',
      }
      const WRITE =
        'underline body links in the `.salt-rich-text a` rule alone, as ' +
        '`text-decoration-line: underline` and `text-underline-offset: 0.15em`'

      /* Every property that draws, colours, moves or removes a link's line, and `all`, which
         resets every one of them at once. Names are ASCII case-insensitive in CSS. */
      const governedIn = (rule) =>
        rule.order
          .map((property) => property.toLowerCase())
          .filter(
            (property) =>
              property === 'all' ||
              /^(?:-webkit-)?text-decoration(?:-[a-z]+)*$/.test(property) ||
              /^text-underline-(?:offset|position)$/.test(property),
          )

      /* The compound with every parenthesised argument cut out, nesting included, so
         `a:not(.x)` reads as `a:not` and `.y:is(a, b)` as `.y:is`. */
      const stripArguments = (compound) => {
        let depth = 0
        let kept = ''
        for (const char of compound) {
          if (char === '(') depth += 1
          else if (char === ')') depth -= 1
          else if (depth === 0) kept += char
        }
        return kept
      }

      const misses = (key) => {
        /* Classes, ids and pseudo-elements are read with attribute selectors cut out, because an
           attribute's value is free text: `a[href$='.pdf']` names no class, and
           `a[href^='#fn']` no id, and both reach a body link. The attribute NAMES are read from
           the key as written, below. */
        const bare = withoutAttributes(key)
        if (bare.includes('::')) return true
        if (/\.[\w-]/.test(bare) || /#[\w-]/.test(bare)) return true
        const type = compoundType(key)
        if (type !== null && type !== '*' && type !== 'a') return true
        const attributes = [...key.matchAll(/\[\s*([\w-]+)/g)].map((match) => (match[1] ?? '').toLowerCase())
        return attributes.some((name) => !CARRIES.includes(name))
      }

      /* 1. The owner: one unconditional rule, that selector alone, exactly the canonical pair. */
      const own = rules.filter(
        (rule) =>
          conditional(rule.at).length === 0 &&
          rule.selectors.some((selector) => normalise(selector) === OWNER) &&
          governedIn(rule).length > 0,
      )
      if (own.length !== 1) {
        return `${own.length === 0 ? 'no' : String(own.length)} unconditional \`${OWNER}\` rule(s) decorate body links — ${WRITE}, written once`
      }
      const [owner] = own
      if (owner.selectors.length !== 1) {
        return `\`${owner.selectors.join(', ')}\` groups \`${OWNER}\` with another selector — ${WRITE}, on its own`
      }
      const declared = governedIn(owner)
      for (const property of declared) {
        const expected = CANONICAL[property]
        if (expected === undefined) {
          return `\`${OWNER}\` declares \`${property}\`, which this contract does not accept there — ${WRITE} and nothing else`
        }
        if (declared.filter((name) => name === property).length > 1) {
          return `\`${OWNER}\` declares \`${property}\` more than once — declare it once, as \`${property}: ${expected}\``
        }
        const written = owner.order.find((name) => name.toLowerCase() === property) ?? property
        const value = owner.declarations[written] ?? ''
        if (isImportant(value)) {
          return `\`${OWNER}\` declares \`${property}\` as \`!important\` — ${WRITE}, without \`!important\``
        }
        if (value.trim().toLowerCase() !== expected) {
          return `\`${OWNER}\` sets \`${property}\` to \`${value.trim()}\` — ${WRITE}`
        }
      }
      for (const property of Object.keys(CANONICAL)) {
        if (!declared.includes(property)) {
          return `\`${OWNER}\` does not declare \`${property}\` — ${WRITE}`
        }
      }

      /* 2. Nowhere else, in any stylesheet the gate reads, conditional rules included. */
      for (const [file, fileRules] of all) {
        for (const rule of fileRules) {
          if (rule === owner) continue
          const touched = governedIn(rule)
          if (touched.length === 0) continue
          for (const selector of rule.selectors) {
            const key = unwrapMatchesAny(keyCompound(normalise(selector)))
            /*
             * What is inside a grouping or negating pseudo-class is never used as proof: it is
             * opaque, as W4 made it, so `a:not([data-plain])` is refused however plausible the
             * attribute. What sits OUTSIDE one still binds, because a compound is a conjunction
             * — `.salt-button[data-style='link']:not([data-icon-only])` requires `.salt-button`
             * whatever the negation says, and a body link never carries it. So the proof is read
             * from the compound with every parenthesised argument removed, and a compound whose
             * only distinguishing part is inside one is refused.
             */
            if (!misses(stripArguments(key))) {
              return `\`${selector}\` in ${file} declares \`${touched.join('`, `')}\` and nothing proves it misses a body link (an \`<a href>\` with no class, and \`target\` and \`rel\` at most) — ${WRITE}, and key any other decoration on a class or element a body link never carries`
            }
          }
        }
      }
      return null
    },
  },
  {
    file: 'primitives.css',
    what: 'the nested-control rule raises controls, not layout boxes',
    why:
      '`[tabindex]` was in this list and caused the failure the rule prevents: a ' +
      '`<div tabindex="0">` scroll region or a `<div tabindex="-1">` focus target is a layout ' +
      'box that often spans the card, and raising it puts an inert div over the stretched ' +
      'link so the card stops being clickable. This was the one change in its commit with ' +
      'neither a test nor a contract, in the commit arguing that is the defect.',
    check: (rules) => {
      const raised = rules.filter(
        (rule) =>
          rule.declarations['z-index'] === '1' &&
          rule.selectors.some((s) => s.includes('.salt-card ')),
      )
      if (raised.length === 0) return 'nothing inside a card is raised above the stretched link'
      const broad = raised.flatMap((rule) =>
        rule.selectors.filter((s) => /\[tabindex\b/.test(s)),
      )
      return broad.length === 0
        ? null
        : `\`${broad[0] ?? ''}\` matches layout boxes, not just controls`
    },
  },
  {
    file: 'primitives.css',
    what: 'the stretched link is scoped to a card',
    why:
      '`inset: 0` resolves against the nearest positioned ancestor, and `.salt-section__content` ' +
      'is one — so an unscoped rule let a stray CardLink capture the entire section band.',
    check: (rules) => {
      const stretched = matching(rules, (s) => s.includes('.salt-card__link::after'))
      if (stretched.length === 0) return 'no stretched-link rule at all'
      const unscoped = stretched.flatMap((rule) =>
        rule.selectors.filter((s) => s.includes('.salt-card__link::after') && !/\.salt-card\s+/.test(s)),
      )
      return unscoped.length === 0 ? null : `\`${unscoped[0] ?? ''}\` is not scoped to a card`
    },
  },
  {
    file: 'primitives.css',
    what:
      "the intro's margin reset carries no specificity and sets nothing but zero, so the " +
      "block's owl always outranks it and nothing else adds space",
    why:
      'The reset exists to beat the user agent\u2019s paragraph margins in a consuming repository ' +
      'that ships no CSS reset, and it must lose to `blocks.css`\u2019s `.salt-block > * + *`, ' +
      'which is what puts a gap between a heading and the introduction under it. Written as a ' +
      'bare `.salt-intro` the two were both (0,1,0) on the same property, so source order ' +
      'decided \u2014 and the order of these two stylesheets belongs to the consumer, since the ' +
      'README fixes theme before sections before primitives and says only that `blocks.css` goes ' +
      '"alongside" them. Measured in chrome-headless-shell 148.0.7778.96 at 1024 by 700 with no ' +
      'reset: primitives first gave the introduction a `margin-block-start` of 16px and blocks ' +
      'first gave it 0px, so every introduction on all nine blocks sat flush against its heading ' +
      'in half the world. `apps/example` imports primitives first, which is why no other gate ' +
      'sees it, and the fix reads like a typo, so a tidy-up back to a bare class would pass ' +
      'review. The opposite over-correction is a contract failure too: `.salt-block > .salt-intro` ' +
      'at (0,2,0) outranks the owl and was measured at 0px in BOTH orders. The VALUE is ' +
      'asserted beside the weight because weight alone is not the guarantee: the owl sets only ' +
      '`margin-block-start`, so it opposes nothing this rule writes BELOW the introduction, and ' +
      '`:where(.salt-intro) { margin: 3rem }` would put 48px under every introduction on all ' +
      'nine blocks at a specificity this contract is otherwise happy with.',
    check: (rules) => {
      /*
       * Properties, not one spelling of one. `margin-block-start` is what the owl sets and
       * `margin` is what this rule writes; a reset switched to `margin-top`, or to `all:
       * revert`, sets the same thing by another name and a contract keyed on one word would
       * not see it. Case-insensitive, because a property name is ASCII case-insensitive and
       * `MARGIN` is the same declaration.
       */
      const resets = (rule) =>
        rule.order.filter((property) => {
          const name = property.trim().toLowerCase()
          return name === 'all' || name === 'margin' || name.startsWith('margin-')
        })

      /* `stripNegations`, so `:not(.salt-intro)` is not read as reaching it — that rule is
         every OTHER element, and both directions of that mistake are in this file's history. */
      const reaching = rules.filter((rule) =>
        rule.selectors.some((selector) => stripNegations(selector).includes('.salt-intro')),
      )
      if (reaching.length === 0) return 'no rule in this stylesheet reaches `.salt-intro`'

      /* OVERRIDE considers conditional rules too, for the mirror reason: a rule inside a
         media query is exactly how a reset gets promoted past the owl at some viewport. */
      for (const rule of reaching) {
        const properties = resets(rule)
        if (properties.length === 0) continue
        for (const selector of rule.selectors) {
          if (!stripNegations(selector).includes('.salt-intro')) continue

          /*
           * The `!important` arm comes BEFORE the specificity comparison, because an
           * important declaration wins on origin and specificity never enters into it — so
           * a contract that ranked first would report a passing verdict on a rule that beats
           * the owl outright. This file's instructions require that arm on every branch that
           * compares a declaration to an expected value.
           */
          const important = properties.filter((property) =>
            /!\s*important/i.test(rule.declarations[property] ?? ''),
          )
          if (important.length > 0) {
            return (
              `\`${selector}\` sets \`${important[0] ?? ''}\` as \`!important\`, which beats the ` +
              'block\u2019s owl whatever its specificity'
            )
          }

          const rank = specificity(selector)
          /* Unrankable is not zero. A selector this cannot weigh might be above (0,0,0), and
             passing it because the reader gave up is the vacuity this file refuses
             everywhere else. */
          if (rank === null) {
            return `\`${selector}\` is a shape whose specificity no contract here can rank`
          }
          const [ids, classes, types] = rank
          if (ids + classes + types > 0) {
            return (
              `\`${selector}\` is specificity (${String(ids)},${String(classes)},${String(types)}) ` +
              `and sets \`${properties[0] ?? ''}\`. At anything above (0,0,0) it ties with or ` +
              'outranks `.salt-block > * + *`, so the gap above an introduction is decided by ' +
              'the consumer\u2019s import order or removed outright. Wrap the selector in ' +
              '`:where()`.'
            )
          }

          /*
           * The VALUE, which the weight does not imply. The owl sets `margin-block-start` and
           * nothing else, so it opposes nothing this rule writes below the introduction: at
           * (0,0,0) and `margin: 3rem`, the gap above survives and 48px appears beneath every
           * introduction on every block, with the weight half of this contract satisfied.
           */
          for (const property of properties) {
            const name = property.trim().toLowerCase()
            const raw = rule.declarations[property] ?? ''

            /*
             * `all` is the third verdict this file's instructions ask for: a spelling the
             * contract cannot rank. `all: revert` restores the user agent's paragraph margins
             * — the very thing the reset exists to remove — and `all: initial` zeroes them
             * along with every other property on the element, which is not a margin reset in
             * any sense worth passing. Neither is reported as "not zero", because that
             * message would send somebody to write `all: 0`.
             */
            if (name === 'all') {
              return (
                `\`${selector}\` sets \`all: ${raw}\`, which this contract cannot rank as a margin ` +
                'reset: `revert` hands the introduction back the user agent\u2019s paragraph ' +
                'margins, which is what the rule exists to remove. Zero the margin by name.'
              )
            }

            if (!isZero(raw)) {
              return (
                `\`${selector}\` sets \`${property}: ${raw}\`. The reset exists to remove the user ` +
                'agent\u2019s paragraph margins, and the owl opposes only `margin-block-start`, so ' +
                'a non-zero value here is space no other rule takes back.'
              )
            }
          }
        }
      }

      /*
       * PRESENCE, and it is asserted LAST although this file's policy is that it must hold
       * unconditionally. The policy is about what a contract requires, not the order it
       * reports in, and the order matters here: every specific defeat above — `!important`,
       * a weight, `all`, a length — also leaves the rule failing to be a reset, so checking
       * presence first swallowed both diagnostics and answered `margin: 0 !important` with
       * "nothing zeroes the margin". A verdict that is true and sends its reader to the wrong
       * line is the false-claim shape this file already records six times.
       *
       * A reset that only applies inside a media query is not a reset, and neither is a rule
       * that names a margin without zeroing it, so `isZero` is part of this test too.
       */
      const present = reaching.some(
        (rule) =>
          conditional(rule.at).length === 0 &&
          resets(rule).some(
            (property) => property.trim().toLowerCase() !== 'all' && isZero(rule.declarations[property]),
          ),
      )
      if (!present) return 'no unconditional rule zeroes the introduction\u2019s margin'

      return null
    },
  },
  {
    file: 'chrome.css',
    what: 'the ancestor mark cannot draw on the element that IS the current page',
    why:
      'a group page relinked at the top of its own submenu is the current page AND an ' +
      'ancestor of it, so both rules match one element. The ancestor rule is the heavier of ' +
      'the two — three compound parts against two — so without an exclusion it wins the ' +
      'cascade and draws the dotted ancestor treatment on an element carrying ' +
      '`aria-current="page"`, with what is painted contradicting what is announced. The ' +
      'exclusion is correct and nothing executable held it: deleting it left the whole suite ' +
      'green, which is the third time in this unit a real fix rested on a comment.',
    check: (rules) => {
      const named = (rule, name, value) =>
        rule.selectors.filter((selector) =>
          attributeConditions(selector).some(
            (condition) => condition.name === name && condition.value === value,
          ),
        )

      const ancestors = rules.flatMap((rule) =>
        named(rule, 'data-current-section', null).map((selector) => ({ rule, selector })),
      )
      if (ancestors.length === 0) return 'no rule draws an ancestor mark at all'

      const currents = rules.flatMap((rule) =>
        named(rule, 'aria-current', 'page').map((selector) => ({ rule, selector })),
      )
      if (currents.length === 0) return 'no rule draws a current-page mark at all'

      for (const ancestor of ancestors) {
        const ancestorRank = specificity(ancestor.selector)
        if (ancestorRank === null) {
          return `\`${ancestor.selector}\` is a shape whose specificity no contract here can rank`
        }

        for (const current of currents) {
          /* Only rules that can land on ONE element are in contention. A top-level rule and
             a submenu rule name different classes and never meet — and anything this cannot
             prove disjoint is treated as meeting, so a rule that names no class stays in. */
          if (!inContention(ancestor.selector, current.selector)) continue

          const currentRank = specificity(current.selector)
          if (currentRank === null) {
            return `\`${current.selector}\` is a shape whose specificity no contract here can rank`
          }

          /*
           * `!important` FIRST, before any weight is compared. A current-page declaration
           * marked important outranks the ancestor whatever the selectors say, and a rule
           * that cannot be ranked must be refused rather than guessed at.
           */
          const contested = Object.keys(ancestor.rule.declarations).filter((property) =>
            Object.hasOwn(current.rule.declarations, property),
          )
          if (contested.some((property) => isImportant(ancestor.rule.declarations[property]))) {
            return `\`${ancestor.selector}\` declares an ancestor property !important, which no contract here can rank`
          }
          if (
            contested.length > 0 &&
            contested.every((property) => isImportant(current.rule.declarations[property]))
          ) {
            continue
          }

          /* Specificity, then source order — the cascade, for the one case it has to decide. */
          const tied =
            !outranks(ancestorRank, currentRank) && !outranks(currentRank, ancestorRank)
          const ancestorWins =
            outranks(ancestorRank, currentRank) ||
            (tied && rules.indexOf(ancestor.rule) > rules.indexOf(current.rule))
          if (!ancestorWins) continue

          /*
           * It wins, so it has to be unable to match. Read as a CONDITION rather than as a
           * string: any `:not()` naming the `aria-current` the other rule keys on, however
           * that selector happens to be spelt.
           *
           * Over the KEY COMPOUND alone, which is the whole of this fix. A `:not()` further
           * left constrains an ancestor rather than the element being drawn: moved onto the
           * list item the exclusion reads as "a section ancestor that is not itself current",
           * which sounds right, excludes nothing — a list item never carries `aria-current` —
           * and left this contract reporting intact over the exact defect it exists for.
           *
           * A presence-only `:not([aria-current])` counts, and must: it excludes every
           * element carrying the attribute, which is a superset of those carrying `page`.
           * Refusing it said "does not exclude it", which was false and would have sent
           * somebody hunting a defect that was not there.
           */
          const excluded = negatedParts(keyCompound(ancestor.selector)).some((part) =>
            attributeConditions(part).some(
              (condition) =>
                condition.name === 'aria-current' &&
                (condition.value === null || condition.value === 'page'),
            ),
          )
          if (!excluded) {
            return (
              `\`${ancestor.selector}\` (${ancestorRank.join(',')}) outranks ` +
              `\`${current.selector}\` (${currentRank.join(',')}) and does not exclude it, so ` +
              'the ancestor mark draws on the current page'
            )
          }
        }
      }
      return null
    },
  },
  {
    file: 'chrome.css',
    what: 'a mount-gated toggle\u2019s hit-area floor reaches the placeholder the server sends',
    why:
      'both of the header\u2019s toggles are mount-gated \u2014 the submenu\u2019s because a ' +
      'server-rendered `aria-expanded` beside a submenu CSS has already revealed says the ' +
      'opposite of the screen, the theme\u2019s because the server cannot know which mode a ' +
      'reader is in \u2014 so what the document carries until the bundle arrives is a `<span>` ' +
      'of the same class. The floor has to come from a selector that `<span>` matches. ' +
      'Qualifying it with `button` reads as tidier and is the plausible wrong edit: the rule ' +
      'is still there, still correct-looking, and the placeholder collapses to nothing, so ' +
      'the free space `.salt-nav`\u2019s `margin-inline-start: auto` hands the row absorbs a ' +
      '2.75rem control at hydration and every item in the header moves. That is an ' +
      'unprompted layout shift on every page load, inside the window Cumulative Layout ' +
      'Shift is measured over, and no test of the markup can see it. A floor scoped to an ' +
      'ANCESTOR is refused for the same reason and was the same silent pass: the toggle is ' +
      'a sibling of `.salt-nav`, so `.salt-nav .salt-theme-toggle` measured 20.00 x 24.00 ' +
      'against the committed rule\u2019s 44.00 x 44.00. The VALUE is held for ' +
      'the reason the `.salt-button` floor in `primitives.css` already states: 2.75rem is ' +
      '44px only at a 16px root, so a bare rem floor plus a root-size change breaches ' +
      '2.5.8 without touching anything that reads as a hit-area decision. Both of these ' +
      'controls are icon-only, which is the shape most at risk under that criterion, and ' +
      'they sat outside the rule that already knows the argument.',
    check: (rules) => {
      /* Both spellings of each axis. A rule written in the physical properties gives the same
         box and would otherwise be invisible to this. */
      const floors = ['min-inline-size', 'min-width', 'min-block-size', 'min-height']

      for (const name of ['salt-nav__toggle', 'salt-theme-toggle']) {
        const sizing = rules.flatMap((rule) =>
          floors.some((property) => rule.declarations[property] !== undefined)
            ? rule.selectors
                .filter((selector) => compoundClasses(keyCompound(selector)).has(name))
                .map((selector) => ({ rule, selector }))
            : [],
        )

        /* The presence half, and it is unconditional on purpose: a floor that only applies
           inside a media query is not a floor. */
        if (!sizing.some(({ rule }) => conditional(rule.at).length === 0)) {
          return `no unconditional rule gives \`.${name}\` a minimum size`
        }

        for (const { rule, selector } of sizing) {
          /*
           * The floor has to be the class's own, not a floor the class gets somewhere.
           *
           * "Scope it to the nav" is a tidier-looking edit than any of the pseudo-class
           * spellings below and it reads as correct out loud — and in the header's real
           * shape it is wrong, because the toggle is a SIBLING of `.salt-nav` inside
           * `.salt-header__inner` (`site-header.tsx`). Measured in the real markup:
           * `.salt-theme-toggle` gives the placeholder 44.00 x 44.00, and both
           * `.salt-nav .salt-theme-toggle` and `.salt-nav > .salt-theme-toggle` give it
           * 20.00 x 24.00, which is the collapse this whole contract exists to refuse.
           *
           * An ancestor that genuinely does contain the toggle is refused too. That is
           * deliberate: nothing here can know which ancestors are real, the CSS says only
           * what the selector says, and a floor that depends on where the control is mounted
           * stops being a floor the moment somebody moves it. Refused as unverifiable rather
           * than as wrong, which is what the message says.
           *
           * `hasCombinator` catches the sibling combinators too, so the message says
           * "position" rather than "ancestor": `.salt-nav__spacer + .salt-theme-toggle` is
           * refused for the same reason and has no ancestor in it at all, and an author sent
           * looking for a containment problem that is not there is an author being sent to
           * undo the wrong thing.
           */
          if (hasCombinator(selector)) {
            return (
              `\`${selector}\` gives \`.${name}\` its floor only in a particular position, ` +
              'and nothing here can check the placeholder is ever in it — the floor has to ' +
              'be on the class itself'
            )
          }

          const key = unwrapMatchesAny(keyCompound(selector))
          const type = compoundType(key)
          if (type !== null) {
            return (
              `\`${selector}\` gives \`.${name}\` its floor through the element type ` +
              `\`${type}\`, which the server\u2019s placeholder is not`
            )
          }
          /* Anything else narrowing the key compound is refused rather than ranked. A
             placeholder carries the class and nothing else \u2014 no state, no attribute \u2014 so
             a condition here is a condition it cannot meet, whatever it happens to say. */
          if (/[[:]/.test(key)) {
            return (
              `\`${selector}\` gives \`.${name}\` its floor only under a condition the ` +
              'server\u2019s placeholder cannot carry'
            )
          }

          /*
           * The value, on EVERY floor property the rule declares rather than the first one
           * found, because within one block the later spelling of an axis wins: a rule
           * carrying `min-inline-size: max(2.75rem, 24px); min-width: 2rem;` has no floor on
           * that axis at all and the good half would otherwise be the only one read. That is
           * the same trap the `.salt-button` contract records having fallen into twice.
           */
          for (const property of floors) {
            const value = rule.declarations[property]
            if (value === undefined) continue
            const floor = readFloor(value)
            if (floor === null) {
              return (
                `\`${selector}\` sets ${property} to \`${value}\` with no px floor, so a ` +
                `root-size change takes \`.${name}\` under 2.5.8\u2019s 24 CSS px`
              )
            }
            if (!reachesTargetFloor(floor)) {
              return (
                `\`${selector}\` floors ${property} at \`${floor.expression}\`, which never reaches ` +
                '24 CSS px'
              )
            }
          }
        }
      }
      return null
    },
  },
  {
    file: 'chrome.css',
    what: 'the logo is the item that gives way when the header row runs out of room',
    why:
      'below the breakpoint the header row is the logo, the theme toggle and the burger, and ' +
      'the two controls are `flex: none` behind 44px floors. With the logo `flex: none` too the ' +
      'row needed the logo plus 136px, and at 320 wide a logo over 168 CSS px scrolled the page ' +
      'sideways (WCAG 1.4.10) with the burger off screen, measured in chrome-headless-shell ' +
      '148.0.7778.96 on 22/09/2026. What makes the logo give way is a handful of declarations ' +
      'across the link, the image, the wordmark and the row, and two rounds of review walked ' +
      'eleven wrong edits past a version of this contract that tried to read their values the ' +
      'way a browser would: upper-case property names, an invalid second value the browser ' +
      'drops, a selector reaching the wordmark without naming it, a rule in another stylesheet, ' +
      'a flex basis of 0 that collapses the logo to nothing. So this does not read values. It ' +
      'fixes ONE spelling of each governed property, in ONE rule keyed on the element’s own ' +
      'class, and refuses every other place and every other spelling.',
    check: (rules, all) => {
      /*
       * ── Forbid the shapes, do not model the cascade ─────────────────────────────
       *
       * The previous version parsed `flex`, tabled `white-space` keywords and resolved source
       * order, and each piece was a model of something only a browser knows — so each was
       * walked past (22/09/2026, every case reproduced in Chrome 148): case-folded names,
       * `nowrap` followed by an invalid value Chrome drops, `.salt-logo > span`, the same
       * class in `primitives.css`, `flex: 0 1 0`. This file's rule for that is old and was not
       * applied: forbid what cannot be ranked. The table below is the whole contract.
       *
       * The element TYPES are the markup's (`<SiteLogo>` renders an `<a>`, `<Media>` an `<img>`
       * through next/image, the wordmark a `<span>`, `<SiteHeader>` the row as a `<div>`), and
       * they are here so that `inContention` can prove a rule such as `.salt-tabs__panel > p`
       * disjoint. Without them every type-keyed rule anywhere in core would contend.
       */
      const PARTS = [
        { element: 'a.salt-logo', rule: '.salt-logo', canonical: { flex: '0 1 auto', 'min-inline-size': '0' } },
        /* Every class the image can carry: `<SiteLogo>` renders it as `salt-logo__image
           salt-logo__light` and, for a swapping logo, a second `salt-logo__image
           salt-logo__dark`. Modelled as `img.salt-logo__image` alone, `.salt-logo__dark {
           max-inline-size: none }` was "proved" disjoint and the dark-mode mark drew 240px
           over the toggle. The union is not one real element; for a contention test, which
           asks whether a rule could share ANY class with it, it is the right question.
           Its parent is the logo link (contract/markup/site-logo.json), which is the one other
           thing a classless `img` rule can be proved disjoint by: see `missesByParent` below. */
        { element: 'img.salt-logo__image.salt-logo__light.salt-logo__dark', parent: 'a.salt-logo', rule: '.salt-logo__image', canonical: { 'max-inline-size': '100%', 'object-fit': 'contain' } },
        { element: 'span.salt-logo__wordmark', rule: '.salt-logo__wordmark', canonical: { 'overflow-wrap': 'anywhere' } },
        /* The row's own width cap is the one governed property it legitimately declares, and
           it is canonical here rather than exempted, so it is held like the rest. */
        { element: 'div.salt-header__inner', rule: '.salt-header__inner', canonical: { 'max-inline-size': 'var(--container-7xl)' } },
      ]
      const GOVERNED = [
        'flex', 'flex-grow', 'flex-shrink', 'flex-basis', 'min-inline-size', 'min-width',
        'max-inline-size', 'max-width', 'object-fit', 'overflow-wrap', 'word-wrap',
        'white-space', 'text-wrap', 'text-wrap-mode',
      ]
      /* These inherit, so a rule on any ANCESTOR of the wordmark reaches it: `.salt-header`,
         `<body>`, `:root`. Contention with the four elements is not enough for them. */
      const INHERITED = ['overflow-wrap', 'word-wrap', 'white-space', 'text-wrap', 'text-wrap-mode']
      const ANCESTOR_CLASSES = ['salt-logo__wordmark', 'salt-logo', 'salt-header__inner', 'salt-header']
      const ANCESTOR_TYPES = ['span', 'a', 'div', 'header', 'body', 'html']

      /* Property names are ASCII case-insensitive in CSS; the parser keeps them as written. */
      const governedIn = (rule) =>
        rule.order.map((property) => property.toLowerCase()).filter((property) => GOVERNED.includes(property))

      const spell = (rule, canonical) =>
        Object.entries(canonical).map(([property, value]) => `\`${property}: ${value}\``).join(' and ') +
        ` in the \`${rule}\` rule`

      /* 1. Each element's own rule: one unconditional rule, keyed on the class alone. */
      const owners = new Set()
      for (const part of PARTS) {
        const own = rules.filter(
          (rule) =>
            conditional(rule.at).length === 0 &&
            rule.selectors.some((selector) => normalise(selector) === part.rule) &&
            governedIn(rule).length > 0,
        )
        if (own.length !== 1) {
          return `${own.length === 0 ? 'no' : String(own.length)} unconditional \`${part.rule}\` rule(s) declare its governed properties — write them once, as ${spell(part.rule, part.canonical)}`
        }
        const [rule] = own
        if (rule.selectors.length !== 1) {
          return `\`${rule.selectors.join(', ')}\` groups \`${part.rule}\` with another selector — spell it as ${spell(part.rule, part.canonical)}, alone`
        }
        owners.add(rule)

        const declared = governedIn(rule)
        for (const property of declared) {
          const expected = (part.canonical)[property]
          if (expected === undefined) {
            return `\`${part.rule}\` declares \`${property}\`, which this contract does not accept there — spell it as ${spell(part.rule, part.canonical)} and nothing else`
          }
          if (declared.filter((name) => name === property).length > 1) {
            return `\`${part.rule}\` declares \`${property}\` more than once — declare it once, as \`${property}: ${expected}\``
          }
          const written = rule.order.find((name) => name.toLowerCase() === property) ?? property
          const value = rule.declarations[written] ?? ''
          if (isImportant(value)) {
            return `\`${part.rule}\` declares \`${property}\` as \`!important\` — spell it as \`${property}: ${expected}\` in the \`${part.rule}\` rule`
          }
          if (value.trim().toLowerCase() !== expected) {
            return `\`${part.rule}\` sets \`${property}\` to \`${value.trim()}\` — spell it as \`${property}: ${expected}\` in the \`${part.rule}\` rule`
          }
        }
        for (const property of Object.keys(part.canonical)) {
          if (!declared.includes(property)) {
            return `\`${part.rule}\` does not declare \`${property}\` — spell it as ${spell(part.rule, part.canonical)}`
          }
        }
      }

      /* 2. Nowhere else, in any core stylesheet this gate reads. */
      for (const [file, fileRules] of all) {
        for (const rule of fileRules) {
          if (owners.has(rule)) continue
          const declared = governedIn(rule)
          if (declared.length === 0) continue
          for (const selector of rule.selectors) {
            /* A grouping pseudo-class hides what it matches from `compoundClasses`, so one is
               opaque — unless it is the whole compound around one simple selector, which
               matches exactly what that selector matches (`unwrapMatchesAny`, the hit-area
               contract's rule). Without that, the theme toggle's floor spelled as
               `:where(.salt-theme-toggle)`, which the hit-area contract accepts, is refused
               here for a logo it cannot touch. */
            const key = unwrapMatchesAny(keyCompound(normalise(selector)))
            /* `:not()` too: `compoundClasses` reads the classes INSIDE it as if the compound
               required them, so `:not(.salt-nav)` would prove itself disjoint from everything
               that is not the nav — which is the opposite of what it matches. */
            const opaque = /:(?:is|where|has|not)\(/i.test(key)
            /* A framed image carries no class of its own, so `.salt-showcase__media > img` can only
               be proved to miss the logo's image by its parent (SC-011's fill rules): a CHILD
               combinator from a compound that is not in contention with the logo link. A
               descendant, a sibling or an opaque parent proves nothing. */
            const chain = chainOf(selector)
            const parent = chain.combinators.at(-1) === '>' ? chain.compounds.at(-2) : undefined
            const missesByParent = (part) =>
              part.parent !== undefined && parent !== undefined && !/:(?:is|where|has|not)\(/i.test(parent) &&
              !inContention(parent, part.parent)
            for (const part of PARTS) {
              if (opaque || (inContention(key, part.element) && !missesByParent(part))) {
                return `\`${selector}\` in ${file} declares \`${declared.join('`, `')}\` and nothing proves it misses \`${part.element}\` — governed properties live only in the element's own rule: ${spell(part.rule, part.canonical)}`
              }
            }
            const inheritable = declared.filter((property) => INHERITED.includes(property))
            if (inheritable.length === 0) continue
            const classes = [...compoundClasses(key)]
            const type = compoundType(key)
            /* Provably not an ancestor: a core component's own class that is not one of the
               chain's, or an element type that is not in the chain. Anything else — `*`,
               `:root`, an attribute, a class core does not own — may sit above the wordmark. */
            const off =
              !opaque &&
              ((classes.length > 0 && classes.every((name) => name.startsWith('salt-') && !ANCESTOR_CLASSES.includes(name))) ||
                (type !== null && type !== '*' && !ANCESTOR_TYPES.includes(type)))
            if (!off) {
              return `\`${selector}\` in ${file} declares \`${inheritable.join('`, `')}\`, which inherits, and nothing proves it is not an ancestor of the wordmark — write wrapping only as \`overflow-wrap: anywhere\` in the \`.salt-logo__wordmark\` rule`
            }
          }
        }
      }
      return null
    },
  },
  {
    file: 'primitives.css',
    what: 'the UA’s own palette follows `data-theme`, and the dark half WINS the cascade',
    why:
      '`color-scheme` decides the things no stylesheet draws — the canvas behind the ' +
      'document, the scrollbars, the form controls, the caret. Until WP9 unit 4 the example ' +
      'app pinned `color-scheme: light` in its scaffold stylesheet, because declaring ' +
      '`light dark` made the UA paint a dark canvas and dark scrollbars on an OS-dark ' +
      'machine while every section painted `--color-surface` white. That pin was DELETED ' +
      'rather than moved, on the strength of this pair, and nothing held the pair: all four ' +
      'of `:root { color-scheme: light dark }`, deleting either block, and deleting both ' +
      'left the gate at exit 0. ' +
      'The first repair of that held the two blocks and the order between them, and was ' +
      'defeated four more ways: the dark block wrapped in `:where()` and left second, a ' +
      'second `:root { color-scheme: light }` appended after the pair, a second ' +
      '`[data-theme=\'dark\'] { color-scheme: light }` appended after it, and the dark ' +
      'selector grouped `#salt-admin, [data-theme=\'dark\']` and moved first. Each exited 0 ' +
      'and each left a document carrying `data-theme="dark"` computing `color-scheme: ' +
      'light`, measured. Two of them are plain APPENDS that leave every existing block ' +
      'untouched, and one of those — re-adding `:root { color-scheme: light }` — is a ' +
      'one-line "restore the pin" edit against the very declaration this unit deleted. ' +
      'So this no longer asks about two named blocks in an order. It resolves SPECIFICITY ' +
      'AND SOURCE ORDER for a document element carrying the attribute and requires the ' +
      'winner to be a dark-targeting declaration. It is not a cascade engine and does not ' +
      'claim to be one: layer order and importance both outrank everything it models, so a ' +
      '`color-scheme` declaration inside `@layer` or carrying `!important` is REFUSED as ' +
      'unrankable rather than ranked wrongly. Both walked through the version that tried to ' +
      'rank them, measured.',
    check: (rules) => {
      /*
       * Every `color-scheme` declaration, paired with the ONE selector it is being judged
       * by. A rule is a list of selectors and they do not weigh the same: `#salt-admin,
       * [data-theme='dark']` is (1,0,0) in its first spelling and (0,1,0) in the one that
       * matches the attribute, and weighing the first of the group let that rule read as
       * the winner while the browser gave it to `:root`.
       */
      const declared = rules.flatMap((rule) => {
        const value = rule.declarations['color-scheme']
        return value === undefined
          ? []
          : rule.selectors.map((selector) => ({
              rule,
              selector,
              value: value.trim().toLowerCase(),
              dark: targetsAttribute(selector, THEME_ATTRIBUTE, 'dark'),
            }))
      })

      /*
       * Which of them can reach the element the attribute is written on.
       *
       * `document.documentElement`, so: a selector with no descendant combinator and no
       * class. That admits `:root`, `html`, `[data-theme='dark']`, `:where([data-theme=
       * 'dark'])`, `#salt-admin` and `*`, and leaves out a rule scoping `color-scheme` to
       * some component inside the page, which is a different subject and not this contract's.
       * Erring towards admitting is deliberate and is this file's standing rule: a false
       * competitor is reported loudly and corrected, a missed one is silent.
       */
      const onRoot = declared.filter(
        ({ selector }) => !hasCombinator(selector) && !/\.[\w-]/.test(selector),
      )

      /* The presence half first, so a deletion reports as a deletion rather than as a lost
         cascade. `:root` and not `html`: the two have to be able to tie for source order to
         be what decides, which is the property the comment beside the pair leans on. */
      const lightDeclarers = onRoot.filter(({ dark }) => !dark)
      const darkDeclarers = onRoot.filter(({ dark }) => dark)

      if (!lightDeclarers.some(({ selector }) => normalise(selector) === ':root')) {
        return 'nothing declares `color-scheme` on `:root`'
      }
      if (darkDeclarers.length === 0) {
        return `nothing declares \`color-scheme\` on \`[${THEME_ATTRIBUTE}='dark']\``
      }

      /* Unconditional, all of them: a canvas that is only dark above a breakpoint is not a
         canvas that follows the attribute, and a conditional rule cannot be resolved against
         an unconditional one by weight and order alone. */
      for (const { rule } of onRoot) {
        const inside = conditional(rule.at)
        if (inside.length > 0) {
          return `\`${rule.selectors.join(', ')}\` declares \`color-scheme\` only inside \`${inside.join(' ')}\`, so outside it the canvas does not follow \`${THEME_ATTRIBUTE}\``
        }
      }

      /*
       * And the two things this resolver does NOT model, refused rather than ranked.
       *
       * What follows weighs specificity and breaks ties on source order. That is the whole
       * of it. The real cascade puts LAYER ORDER above both and IMPORTANCE above that, and
       * both of them walked straight through: the dark rule moved inside `@layer theme` with
       * `:root` left unlayered exits 0 while a dark document computes `light`, because an
       * unlayered declaration beats every layered one whatever its weight — and so does
       * `@layer dark, base;` with both of them layered. Neither is exotic. The parser comment
       * in this file already records one stray `@layer primitives;` deleting a rule from the
       * parse, so "let us start layering the stylesheets" is an edit this repository has
       * already half-made.
       *
       * `!important` produced noise in both directions. Three important spellings were caught
       * only by accident, because the VALUE test trips on the string `light !important`
       * rather than on any reasoning about importance, while
       * `[data-theme='dark'] { color-scheme: dark !important }` placed first was reported as
       * a failure although the browser gives `dark`.
       *
       * The honest repair is to say so rather than to grow a cascade engine in a gate script.
       * A refusal is loud, it is correct, and it costs whoever does start layering these
       * stylesheets one conversation about whether `color-scheme` still resolves the way this
       * contract says — which is the conversation that should happen.
       */
      for (const { rule, selector } of onRoot) {
        const layered = rule.at.filter((query) => /^@layer\b/i.test(query))
        if (layered.length > 0) {
          return `\`${selector}\` declares \`color-scheme\` inside \`${layered.join(' ')}\`, and this contract ranks specificity and source order only — layer order beats both, so it cannot say which declaration wins`
        }
        if (isImportant(rule.declarations['color-scheme'])) {
          return `\`${selector}\` declares \`color-scheme\` as \`!important\`, and this contract ranks specificity and source order only — importance beats both, so it cannot say which declaration wins`
        }
      }

      /*
       * The cascade, for the two documents that exist.
       *
       * Highest specificity wins; equal specificity goes to the LAST declaration in source
       * order. Taking the first declarer instead is what let both of the append mutants
       * through — neither of them disturbs a single existing character.
       */
      const winner = (candidates) =>
        candidates.reduce((best, candidate) => {
          if (best === null) return candidate
          const challenger = specificity(candidate.selector)
          const holder = specificity(best.selector)
          if (challenger === null || holder === null) return best
          /* The candidate takes it unless the holder beats it outright. Equal weight
             therefore goes to the candidate, which is later in the list, and `flatMap`
             preserved the parse's source order — that is the source-order tie-break, and
             taking the FIRST declarer instead is what both append mutants walked through. */
          return outranks(holder, challenger) ? best : candidate
        }, null)

      const darkWinner = winner(onRoot)
      if (darkWinner === null) return 'no `color-scheme` declaration reaches the document element'
      if (!darkWinner.dark) {
        return `on a document carrying \`${THEME_ATTRIBUTE}="dark"\` the winning \`color-scheme\` is \`${darkWinner.selector}\`, which does not select the dark theme, so the canvas, the scrollbars and the form controls are light behind dark sections`
      }
      if (darkWinner.value !== 'dark') {
        return `\`${darkWinner.selector}\` wins \`color-scheme\` on a dark document and declares \`${darkWinner.value}\`, so a reader in dark mode gets a canvas that is not dark`
      }

      /*
       * And the light document, which is every document with no attribute at all: a site
       * rendering no `<ThemeScript>`, or a reader with JavaScript off. `light dark` here is
       * the plausible wrong edit and the whole reason this contract exists — it reads as
       * "this site supports both now", it keeps the declaration and the selector intact, and
       * it hands the canvas back to the operating system for exactly the parts of the page
       * CSS does not cover.
       */
      const lightWinner = winner(lightDeclarers)
      if (lightWinner === null) return 'no `color-scheme` declaration reaches a document with no theme attribute'
      if (lightWinner.value !== 'light') {
        return `on a document with no \`${THEME_ATTRIBUTE}\` the winning \`color-scheme\` is \`${lightWinner.selector} { color-scheme: ${lightWinner.value} }\`, so the parts of the page no stylesheet draws follow the operating system rather than the attribute`
      }

      return null
    },
  },
  {
    file: 'primitives.css',
    what: 'core paints the page ground once, on `body`, with the page pair',
    why:
      'without a ground the page is the browser’s canvas, which `color-scheme` makes #121212 in ' +
      'dark mode rather than the brand’s dark surface, with text in `CanvasText`. A reader sees ' +
      'enough contrast and axe-core cannot: it resolves a transparent `<html>` and `<body>` to ' +
      'white, and in chrome-headless-shell 148.0.7778.96 it scored text on that ground at 1:1 ' +
      'while the pixel under it was #121212 (BD-149, BD-162). Only the example app and salt-site ' +
      'painted a ground, each in its own `site.css`, so every other site had the canvas. Core owns ' +
      'it now, and a second painter anywhere in core is a second owner, which this refuses rather ' +
      'than ranks.',
    check: (_rules, all) => {
      /* Every property that paints the ground or its text. The shorthand and `background-image`
         are here so that a second painter using them is seen; on the owner they are refused as
         spellings this contract does not read, with an instruction. */
      const GROUND = new Set(['background', 'background-color', 'background-image', 'color'])

      /*
       * Could this selector's subject be the root or the body? Read from the last compound, the
       * element the rule actually styles. A pseudo-element is a box of its own and not the
       * ground. `html`, `body` and `:root` are the ground by name. A compound holding no class,
       * id or other type (`*`, `[data-theme='dark']`, a `:where()` holding only those) cannot be proved to
       * miss it: the document element carries core's theme attribute, and a site's layout may
       * put anything on either. A compound naming a class or another element is taken to miss
       * it, because core's classes sit on elements core renders and the root and body are the
       * site's.
       */
      const reachesGround = (selector) => {
        /* Attribute selectors go first: their values are free text, and `[href*='::']` or
           `[data-x='body']` must not read as a pseudo-element or as the body by name. */
        const subject = lastCompound(selector).replace(/\[[^\]]*\]/g, '[]')
        if (subject.includes('::')) return false
        if (/(^|[^\w.#-])(html|body)(?![\w-])/i.test(subject) || /:root(?![\w-])/i.test(subject)) return true
        /* `:is()` and `:where()` are unwrapped rather than stripped: `:where(.salt-theme-toggle)`
           styles an element carrying that class, which is not the root or the body. */
        const named = stripNegations(subject)
          .replace(/\[\]/g, '')
          .replace(/:(?:is|where)\(([^()]*)\)/gi, '$1')
          .replace(/:[\w-]+(\([^)]*\))?/g, '')
          .replace(/\*/g, '')
        return !/[.#a-z]/i.test(named)
      }

      const painters = [...all].flatMap(([file, rules]) =>
        rules.flatMap((rule) => {
          const properties = rule.order.filter((property) => GROUND.has(property.toLowerCase()))
          return properties.length > 0 && rule.selectors.some(reachesGround) ? [{ file, rule, properties }] : []
        }),
      )

      const owners = painters.filter(
        ({ file, rule }) =>
          file === 'primitives.css' &&
          rule.at.length === 0 &&
          rule.selectors.length === 1 &&
          (rule.selectors[0] ?? '').toLowerCase() === 'body',
      )
      const [owner, ...others] = owners
      if (owner === undefined) {
        return 'nothing in core paints the page ground; `primitives.css` needs a top-level `body { background-color: var(--color-surface); color: var(--color-ink) }`'
      }
      if (others.length > 0) {
        return `${String(owners.length)} top-level \`body\` rules in \`primitives.css\` paint the ground; it is painted once, so that no contract here has to decide which of them wins`
      }
      for (const { file, rule, properties } of painters) {
        if (rule === owner.rule) continue
        const where = rule.at.length === 0 ? '' : ` inside \`${rule.at.join(' ')}\``
        return `\`${rule.selectors.join(', ')}\` in \`${file}\`${where} declares \`${properties.join('`, `')}\` on something that cannot be proved to miss the root or the body. The ground has one owner, \`primitives.css\`’s top-level \`body\` rule; scope this rule to a class if it is not meant for the page`
      }

      /* Importance first, on every painting declaration, before any value is compared: the value
         may be right, and reporting it as wrong would send somebody to undo correct CSS. */
      for (const property of owner.properties) {
        if (isImportant(owner.rule.declarations[property])) {
          return `\`body\` in \`primitives.css\` declares \`${property}\` as \`!important\`, which this contract cannot rank; remove it`
        }
      }
      const expected = {
        'background-color': '--color-surface',
        color: '--color-ink',
      }
      const unread = owner.properties.filter((name) => !(name.toLowerCase() in expected))
      if (unread.length > 0) {
        return `\`body\` in \`primitives.css\` paints with \`${unread.join('`, `')}\`, a spelling this contract does not read; write \`background-color: var(--color-surface)\` and \`color: var(--color-ink)\``
      }
      for (const [property, token] of Object.entries(expected)) {
        const spellings = owner.properties.filter((name) => name.toLowerCase() === property)
        if (spellings.length === 0) {
          return `\`body\` in \`primitives.css\` does not declare \`${property}\`; it needs \`${property}: var(${token})\``
        }
        if (spellings.length > 1) {
          return `\`body\` in \`primitives.css\` declares \`${property}\` ${String(spellings.length)} times; write it once, so that no contract here has to decide which one the browser keeps`
        }
        const value = owner.rule.declarations[spellings[0] ?? ''] ?? ''
        /* `var()` is ASCII case-insensitive; the custom property's name is not. */
        const named = /^var\(\s*(--[\w-]+)\s*\)$/i.exec(value.trim())
        if (named === null) {
          return `\`body\` in \`primitives.css\` writes \`${property}: ${value}\`, a spelling this contract does not read; write exactly \`var(${token})\``
        }
        if (named[1] !== token) {
          return `\`body\` in \`primitives.css\` paints \`${property}\` with \`${named[1] ?? ''}\`, not \`${token}\`, so the ground is not the pair the contrast manifest measures as the page`
        }
      }
      return null
    },
  },
  {
    file: 'primitives.css',
    what: 'every corner radius and opacity reads a scale token',
    why:
      'the radii and the two dimmed controls were literals, which a site could not retune and which ' +
      'drifted apart unseen: four radii in three units. They now read `--radius-*` and `--opacity-*`, ' +
      'core’s values through the contract’s scale shape (BD-169), and a literal written back is the ' +
      'drift this closes.',
    check: (_rules, all) => {
      /* The one opacity that is not a scale rung: the scrim's alpha, a strength the editor picks
         (`--scrim-*`, BD-163), set on the band's own custom property. Counted, so it cannot excuse
         a second opacity by being named once. */
      const SCRIM = { file: 'sections.css', value: 'var(--salt-scrim-alpha)' }
      let scrims = 0
      let read = 0
      for (const [file, rules] of all) {
        for (const rule of rules) {
          for (const property of rule.order) {
            const name = property.toLowerCase()
            const raw = rule.declarations[property] ?? ''
            /* The other spellings of a corner or a transparency, which this contract cannot rank
               against a token and so refuses rather than passing unread (#189 review, LOW 3):
               `filter: opacity(…)`, a `fill-opacity` or other `*-opacity` property, and `round`
               inside `inset()`, `rect()` or `xywh()`, or the `round()` function. */
            const unranked = name.endsWith('-opacity')
              ? `\`${property}\``
              : /\bopacity\(/i.test(raw)
                ? '`opacity()`'
                : /(?:^|[\s(,])round(?=[\s(]|$)/i.test(raw)
                  ? '`round`'
                  : null
            if (unranked !== null) {
              return `\`${rule.selectors.join(', ')}\` in ${file} writes \`${property}: ${raw.trim()}\`; ${unranked} is a shape this contract does not rank, so write the corner as a \`--radius-*\` token on a radius property, or the transparency as \`opacity: var(--opacity-<rung>)\``
            }
            const family = name.endsWith('radius') ? 'radius' : name === 'opacity' ? 'opacity' : null
            if (family === null) continue
            read += 1
            const value = (rule.declarations[property] ?? '').trim()
            const where = `\`${rule.selectors.join(', ')}\` in ${file}`
            if (isImportant(value)) return `${where} declares \`${property}\` !important, which no contract here can rank`
            if (family === 'opacity' && file === SCRIM.file && value === SCRIM.value) {
              scrims += 1
              continue
            }
            const token = /^var\(\s*(--[\w-]+)\s*\)$/i.exec(value)
            if (token === null || !(token[1] ?? '').startsWith(`--${family}-`)) {
              return `${where} writes \`${property}: ${value}\`; it reads a \`--${family}-*\` token, exactly \`var(--${family}-<rung>)\``
            }
            const resolved = themeValue(token[1] ?? '')
            if ('missing' in resolved) return `${where} reads \`${token[1] ?? ''}\`, and ${resolved.missing}`
          }
        }
      }
      if (scrims !== 1) return `the scrim's \`opacity: ${SCRIM.value}\` is written ${String(scrims)} times in ${SCRIM.file}; it is excused once`
      return read === 0 ? 'no radius or opacity was found in any stylesheet, so nothing was ranked' : null
    },
  },
  {
    file: 'primitives.css',
    what: 'every font size, weight, leading, tracking and family reads a text role, or a weight rung for an emphasis',
    why:
      'core’s component text was sizes and weights of its own, which an editor’s type scale and families ' +
      'could not reach (BD-173). A role is five declarations read together, family included, because ' +
      'Tailwind’s `text-*` utility does not set the family (BD-166): a rule that reads four renders in ' +
      'the inherited face whatever the role wears. A literal written back is the drift this closes.',
    check: (_rules, all) => {
      /* Sizes that are not a rank but a proportion of the text around them, and one geometry. Each
         is excused once, by file, selector, property and value, so none excuses a second. */
      const EXCUSED = [
        { file: 'blocks.css', selector: '.salt-stat__suffix', property: 'font-size', value: '0.6em', reason: 'drawn relative to the figure it rides with' },
        { file: 'primitives.css', selector: '.salt-rich-text code', property: 'font-size', value: '0.9em', reason: 'the contract has no mono role; inline code is sized relative to its text' },
        { file: 'blocks.css', selector: '.salt-process__number', property: 'line-height', value: '1', reason: 'the flex centring positions the digit, and a taller line box pushes it off centre' },
        /* `font: inherit` on a control, so a button or a field takes the text it sits in, which is
           how a role reaches it. Keyed by selector like the rest (#190 review, nit): a count alone
           excused a fifth control's `font: inherit` by moving one of the four. `.salt-button` and
           `.salt-copy-link__button` left the list when they took `label` (BD-185), since a role and
           `font` cannot share a rule. */
        ...INHERITING_CONTROLS.map((selector) => ({
          file: 'primitives.css',
          selector,
          property: 'font',
          value: 'inherit',
          reason: 'a control takes the text it sits in',
        })),
      ]
      const excused = EXCUSED.map(() => 0)
      let read = 0
      for (const [file, rules] of all) {
        for (const rule of rules) {
          const selector = rule.selectors.join(', ')
          const where = `\`${selector}\` in ${file}`
          const roles = new Set()
          const seen = new Map()
          for (const [index, property] of rule.order.entries()) {
            const name = property.toLowerCase()
            if (name === 'font-variation-settings' || name === 'font-size-adjust') {
              return `${where} writes \`${property}\`, which moves a size or a weight in a way this contract does not rank; set the text in a role`
            }
            /* A role, rung, step or family redeclared on a component detaches that component from the
               editor's choice: `.salt-hero { --text-display: 5rem }` holds the headline at 5rem under
               every scale (#190 review, MEDIUM 2). Those properties are `theme.css`'s and the runtime
               brand stylesheet's to declare, so any spelling of the namespaces is refused here. */
            if (/^--(?:text|weight|leading|tracking|step|font)-/i.test(property)) {
              return `${where} declares \`${property}\`, a type token; only a runtime's token layer declares those, so the editor's scale and families reach every rule that reads it`
            }
            if (!ROLE_PROPERTIES.has(name) && name !== 'font') continue
            read += 1
            seen.set(name, (seen.get(name) ?? 0) + 1)
            const value = (rule.values[index] ?? '').replace(/\s+/g, ' ').trim()
            if (isImportant(value)) return `${where} declares \`${property}\` !important, which no contract here can rank`
            const exception = EXCUSED.findIndex(
              (entry) =>
                entry.file === file && entry.selector === selector && entry.property === name && entry.value === value.toLowerCase(),
            )
            if (exception !== -1) {
              excused[exception] = (excused[exception] ?? 0) + 1
              continue
            }
            if (name === 'font') {
              return `${where} writes the \`font\` shorthand as \`${value}\`; only \`font: inherit\` on ${INHERITING_CONTROLS.map((control) => `\`${control}\``).join(', ')}, excused by selector, is read, so set the text in a role`
            }
            const token = /^var\(\s*(--[\w-]+)\s*\)$/i.exec(value)
            const reference = spelled(value)
            if (name === 'font-weight' && token !== null && (token[1] ?? '').startsWith('--weight-')) {
              const resolved = themeValue(token[1] ?? '')
              if ('missing' in resolved) return `${where} reads \`${token[1] ?? ''}\`, and ${resolved.missing}`
              continue
            }
            const role = reference === null ? undefined : ROLE_OWNER.get(reference)
            if (role === undefined) {
              return `${where} writes \`${property}: ${value}\`; it reads a text role, exactly \`var(--text-<role>…)\` as design-foundations spells it, or for a weight alone \`var(--weight-<rung>)\``
            }
            if (role.property !== name) {
              return `${where} sets \`${property}\` from \`${reference ?? ''}\`, which is \`${role.role}\`'s \`${role.property}\``
            }
            roles.add(role.role)
          }
          if (roles.size > 1) return `${where} mixes the roles ${[...roles].map((r) => `\`${r}\``).join(' and ')}; a rule sets one`
          const [role] = roles
          if (role === undefined) continue
          const twice = [...seen].find(([, count]) => count > 1)
          if (twice !== undefined) return `${where} sets \`${twice[0]}\` twice beside the \`${role}\` role, so one of them overrides it`
          if (seen.has('font')) return `${where} writes \`font\` beside the \`${role}\` role, which resets it`
          const byName = new Map(Object.entries(rule.declarations).map(([property, value]) => [property.toLowerCase(), value]))
          const missing = textRoleDeclarations(role).filter(({ property, value }) => spelled(byName.get(property) ?? '') !== value)
          if (missing.length > 0) {
            return `${where} reads \`${role}\` without ${missing.map(({ property, value }) => `\`${property}: ${value}\``).join(', ')}; a role is all five, family included`
          }
        }
      }
      const unused = EXCUSED.findIndex((_entry, index) => excused[index] !== 1)
      if (unused !== -1) {
        const entry = EXCUSED[unused]
        return `\`${entry?.selector ?? ''} { ${entry?.property ?? ''}: ${entry?.value ?? ''} }\` is written ${String(excused[unused])} times in ${entry?.file ?? ''}; it is excused once (${entry?.reason ?? ''})`
      }
      return read === 0 ? 'no font size, weight, leading, tracking or family was found in any stylesheet, so nothing was ranked' : null
    },
  },
  {
    file: 'primitives.css',
    what: 'the case study view spaces its header and its sections, each gap a space or layout-rhythm token',
    why:
      'every site’s copy of the case study view drew the title, the client line and the summary, each ' +
      'section’s `h2` and its rich text, and each `h2` and the paragraph before it with 0px between them, ' +
      'measured on Floorworkz’s preview on 28/09/2026 (the mirrored row MR-8); core’s view then still put ' +
      'its title 0px under the site header and a section’s `h2` 16px over an opening `h3` 18px over its ' +
      'text, measured on 04/10/2026 (BD-202). Core’s view fixes those gaps once (BD-179), and a site ' +
      'retunes them through the tokens, so a length written back, a gap removed, or a later rule ' +
      'zeroing or outranking one is the defect returning.',
    check: (_rules, all) => {
      /* Each join MR-8 names, the rule that opens it and the one value it is written as. The
         selectors are pinned whole, because their (0,2,0) is what beats `.salt-grid`'s `margin: 0` in
         `blocks.css`, which a site imports after this file: at (0,1,0) the heading sat on the grid. */
      const GAPS = [
        /* Padding on the article itself, the one gap not between two of its parts (BD-202). */
        { selector: '.salt-case-study-view', edge: 'padding', value: 'var(--space-section-md)', join: 'between the site header and the title', afterReset: false },
        /* A header drawn as a band opens that gap with its own padding, so the article's is zero (BD-206). */
        { selector: ".salt-case-study-view[data-header='band']", edge: 'padding', value: 'var(--space-0)', join: 'above a header drawn as a band', afterReset: false },
        { selector: '.salt-case-study-view > * + *', value: 'var(--space-section-sm)', join: 'above each section', afterReset: false },
        {
          selector: '.salt-case-study-view > .salt-case-study-view__header > * + *',
          value: 'var(--space-4)',
          join: 'between the title, the client line and the summary',
          afterReset: true,
        },
        /* The same lines inside a band's content, one level down (BD-206). */
        {
          selector: '.salt-case-study-view > .salt-case-study-view__header > .salt-section__content > * + *',
          value: 'var(--space-4)',
          join: 'between the title, the client line and the summary on a band',
          afterReset: true,
        },
        {
          selector: '.salt-case-study-view > .salt-case-study-view__header > .salt-section__content > .salt-case-study-view__results',
          value: 'var(--space-8)',
          join: 'above the results on a band',
          afterReset: true,
        },
        {
          selector: '.salt-case-study-view > .salt-case-study-view__header > .salt-section__content > .salt-case-study-view__details',
          value: 'var(--space-8)',
          join: 'above the project details on a band',
          afterReset: true,
        },
        {
          selector: '.salt-case-study-view > .salt-case-study-view__section > * + *',
          value: 'var(--space-4)',
          join: 'between each section’s heading and what it heads',
          afterReset: true,
        },
        {
          selector: '.salt-case-study-view > .salt-case-study-view__header > .salt-case-study-view__results',
          value: 'var(--space-8)',
          join: 'above the results',
          afterReset: true,
        },
        {
          selector: '.salt-case-study-view > .salt-case-study-view__header > .salt-case-study-view__details',
          value: 'var(--space-8)',
          join: 'above the project details',
          afterReset: true,
        },
        /* (0,4,2) through `:has()`, so it outranks the section owl above without coming after it. */
        {
          selector: '.salt-case-study-view > .salt-case-study-view__section > h2 + .salt-rich-text:has(> :first-child:is(h3, h4, h5, h6))',
          value: 'var(--space-8)',
          join: 'between a section’s heading and a heading opening its rich text',
          afterReset: false,
        },
      ]
      /* The reset for a consuming repo without one. It reaches the header's lines and the sections'
         headings at (0,2,0), as the owls inside them do, so it has to come before those, and it is the
         one rule here allowed to write a zero. */
      const RESET = [
        '.salt-case-study-view > .salt-case-study-view__header > *',
        '.salt-case-study-view > .salt-case-study-view__header > .salt-section__content > *',
        '.salt-case-study-view > .salt-case-study-view__section > h2',
        '.salt-case-study-view__detail-value',
      ]
      /* Every declaration that sets a box's block-start margin in a horizontal writing mode, logical
         and physical, longhand and shorthand: the gap is on that edge, and any of these written after
         the longhand replaces it (#201 review). `all` resets every one of them. The article's own
         gap is on the same edge of its padding (BD-202). */
      const START_EDGE = new Set(['margin', 'margin-block', 'margin-block-start', 'margin-top', 'all'])
      const PADDING_EDGE = new Set(['padding', 'padding-block', 'padding-block-start', 'padding-top', 'all'])
      /* The margins that can move a gap between two stacked boxes, either edge, since sibling margins
         collapse into one; the inline ones cannot, so a summary centred with \`margin-inline: auto\` is
         not refused (#222 review, 1). Any other margin spelling gets the third verdict. */
      const BLOCK_MARGIN = new Set(['margin', 'margin-block', 'margin-block-start', 'margin-block-end', 'margin-top', 'margin-bottom'])
      const INLINE_MARGIN = new Set(['margin-inline', 'margin-inline-start', 'margin-inline-end', 'margin-left', 'margin-right'])
      /* Only the article's own gap is a padding (#222 review, 2): padding on a header line or the details
         moves nothing between two boxes. */
      const paddedSelectors = new Set(GAPS.flatMap((gap) => (gap.edge === 'padding' ? [gap.selector] : [])))
      /* And only the others are margins, so a block margin on the article is not called its gap (#222
         re-review): the article's rule sets padding, and a margin there gets the block-margin verdict. */
      const marginSelectors = new Set(GAPS.flatMap((gap) => (gap.edge === 'padding' ? [] : [gap.selector])))
      /* One `var()` of one custom property, however it is spaced and however `var` is cased. The name
         keeps its case, since a custom property's name is case-sensitive. */
      const token = (value) => {
        const match = /^var\(\s*(--[\w-]+)\s*\)$/i.exec(value.trim())
        return match === null ? null : `var(${match[1] ?? ''})`
      }
      /* A length in any unit, once every `var()` name is taken out, so `--space-8`'s digit is not one. */
      const LENGTH = /(?:^|[\s(,*/+-])-?(?:\d+\.?\d*|\.\d+)(?:px|r?em|r?lh|ch|ex|cap|ic|vw|vh|vi|vb|vmin|vmax|[sdl]v[hwib]|cq[whib]|cqmin|cqmax|cm|mm|in|pt|pc|q|%)(?![\w-])/i
      const SPACING = /^(?:margin|padding|gap|row-gap|column-gap|inset|all$)(?:-|$)/i
      const primitives = all.get('primitives.css') ?? []
      /* The rule that owns a gap: unconditional, in primitives.css, the first naming its selector. Every
         other rule naming a pinned selector, in any stylesheet and inside any at-rule, is read below and
         may not touch the edge (#201 review: the first version read this one rule and skipped the rest). */
      const owner = (selector) => primitives.find((rule) => rule.at.length === 0 && rule.selectors.includes(selector))
      const owners = new Set(GAPS.flatMap((gap) => owner(gap.selector) ?? []))
      const resetRule = primitives.find((rule) => rule.at.length === 0 && RESET.every((selector) => rule.selectors.includes(selector)))
      for (const gap of GAPS) {
        const rule = owner(gap.selector)
        if (rule === undefined) return `no unconditional \`${gap.selector}\` rule in primitives.css opens the gap ${gap.join}`
        const longhand = gap.edge === 'padding' ? 'padding-block-start' : 'margin-block-start'
        const edge = gap.edge === 'padding' ? PADDING_EDGE : START_EDGE
        const setters = rule.order.map((property, at) => ({ property: property.toLowerCase(), value: rule.values[at] ?? '' })).filter(({ property }) => edge.has(property))
        const where = `\`${gap.selector}\` in primitives.css`
        const other = setters.find(({ property }) => property !== longhand)
        if (other !== undefined) {
          return `${where} writes \`${other.property}: ${other.value.trim()}\` beside the gap ${gap.join}, which sets the same edge; only \`${longhand}\` sets it there`
        }
        if (setters.length !== 1) {
          return setters.length === 0
            ? `${where} sets no \`${longhand}\`, so nothing opens the gap ${gap.join}`
            : `${where} sets \`${longhand}\` ${String(setters.length)} times; write it once`
        }
        const value = setters[0]?.value ?? ''
        if (isImportant(value)) return `${where} declares \`${longhand}\` !important, which no contract here can rank`
        if (LENGTH.test(value.replace(/var\(\s*--[\w-]+/gi, 'var('))) {
          return `${where} writes \`${longhand}: ${value.trim()}\` for the gap ${gap.join}, a length of its own; write \`${gap.value}\``
        }
        const read = token(value)
        /* The third verdict (CLAUDE.md): a value that is not one `var()` may compute the same, as
           `calc(var(--space-2) * 2)` does, and this contract does not evaluate it; it says so rather
           than calling it wrong (#201 review). */
        if (read === null) {
          return `${where} writes \`${longhand}: ${value.trim()}\` for the gap ${gap.join}, a spelling this contract does not read; it compares one \`var()\`, so write \`${gap.value}\``
        }
        if (read !== gap.value) {
          return `${where} writes \`${longhand}: ${value.trim()}\` for the gap ${gap.join}; write \`${gap.value}\`, the token this contract compares, or change it here with its reason`
        }
        if (gap.afterReset && resetRule !== undefined && primitives.indexOf(resetRule) > primitives.indexOf(rule)) {
          return `\`${RESET.join(', ')}\` comes after \`${gap.selector}\` in primitives.css; at the same specificity it zeroes the gap ${gap.join}`
        }
      }
      /* A header band's content takes back the `margin-inline: auto` the reset takes from it, at
         (0,3,0) over both (0,2,0) rules; deleted, the band's text sits on its left edge and every gap
         above still passes (#226 review, 5). */
      const CENTRED = '.salt-case-study-view > .salt-case-study-view__header > .salt-section__content'
      const centring = primitives.find((rule) => rule.at.length === 0 && rule.selectors.includes(CENTRED))
      if (centring === undefined) {
        return `no unconditional \`${CENTRED}\` rule in primitives.css gives a header band's content \`margin-inline: auto\` back from the reset, so its text sits on the band's left edge`
      }
      const centres = centring.order
        .map((property, at) => ({ property, name: property.toLowerCase(), value: centring.values[at] ?? '' }))
        .filter(({ name }) => INLINE_MARGIN.has(name) || BLOCK_MARGIN.has(name) || name === 'all')
      const centre = centres[0]
      if (centres.length !== 1 || centre === undefined) {
        return `\`${CENTRED}\` in primitives.css sets the content's margins ${String(centres.length)} times; write \`margin-inline: auto\` once`
      }
      if (isImportant(centre.value)) return `\`${CENTRED}\` in primitives.css declares \`${centre.property}\` !important, which no contract here can rank`
      if (centre.name !== 'margin-inline') {
        return `\`${CENTRED}\` in primitives.css writes \`${centre.property}: ${centre.value.trim()}\`, a spelling this contract does not read; it reads \`margin-inline: auto\``
      }
      /* A zero or a length is read, and is wrong; anything else not one keyword is the third verdict. */
      const centreWord = isZero(centre.value.trim()) || LENGTH.test(centre.value) ? 'a length' : keyword(centre.value)
      if (centreWord === null) {
        return `\`${CENTRED}\` in primitives.css writes \`margin-inline: ${centre.value.trim()}\`, a spelling this contract does not read; it reads \`auto\``
      }
      if (centreWord !== 'auto') {
        return `\`${CENTRED}\` in primitives.css writes \`margin-inline: ${centre.value.trim()}\`; write \`auto\`, or a header band's text leaves the band's measure`
      }
      for (const [file, rules] of all) {
        for (const rule of rules) {
          if (!rule.selectors.some((selector) => selector.includes('salt-case-study-view'))) continue
          const where = `\`${rule.selectors.join(', ')}\`${rule.at.length > 0 ? ` inside \`${rule.at.join(' ')}\`` : ''} in ${file}`
          const isOwner = owners.has(rule)
          const isReset = rule === resetRule
          const repeatsPin = rule.selectors.some((selector) => marginSelectors.has(selector))
          const repeatsPadded = rule.selectors.some((selector) => paddedSelectors.has(selector))
          for (const [at, property] of rule.order.entries()) {
            const name = property.toLowerCase()
            if (/^-[a-z]+-(?:margin|padding)/.test(name)) {
              return `${where} writes \`${property}: ${(rule.values[at] ?? '').trim()}\`, a spelling this contract does not read, so it cannot say whether it moves a gap MR-8 owes; write the standard property`
            }
            if (!SPACING.test(name)) continue
            const value = rule.values[at] ?? ''
            if (isImportant(value)) return `${where} declares \`${property}\` !important, which no contract here can rank`
            if (name === 'all') return `${where} writes \`all: ${value.trim()}\`, which resets every margin and this contract cannot rank; set the property by name`
            if (LENGTH.test(value.replace(/var\(\s*--[\w-]+/gi, 'var('))) {
              return `${where} writes \`${property}: ${value.trim()}\`, a length of its own; space the case study with a \`--space-*\` or layout-rhythm token`
            }
            if (isOwner) continue
            if ((repeatsPin && START_EDGE.has(name)) || (repeatsPadded && PADDING_EDGE.has(name))) {
              return `${where} writes \`${property}: ${value.trim()}\` on a gap MR-8 owes, which its own rule in primitives.css sets; only that rule sets the edge`
            }
            /* Any other block margin on the view is refused, whatever its value, rather than ranked. The first
               version refused only a literal zero, so \`var(--space-0)\` or \`calc(var(--space-8) * 0)\`
               on the rich text zeroed a section's gap, and a rule outranking a gap without repeating its
               selector, \`.salt-case-study-view > .salt-case-study-view__section\` at (0,2,0) over the
               (0,1,0) owl, replaced it; all three passed (BD-202 closes the section 7 row). The same
               holds for the article's padding from any rule whose subject is the article. */
            if (rule !== centring && rule.selectors.includes(CENTRED) && INLINE_MARGIN.has(name)) {
              return `${where} writes \`${property}: ${value.trim()}\` on a header band's content, whose \`margin-inline: auto\` its own rule in primitives.css sets; only that rule sets it`
            }
            if (!isReset && BLOCK_MARGIN.has(name)) {
              return `${where} writes \`${property}: ${value.trim()}\` on the case study view; only the gaps MR-8 owes and the reset before them set a block margin there, since this contract cannot rank another against them`
            }
            if (!isReset && name.startsWith('margin') && !INLINE_MARGIN.has(name)) {
              return `${where} writes \`${property}: ${value.trim()}\`, a margin this contract does not read, so it cannot say whether it moves a gap MR-8 owes; write a block or inline margin by name`
            }
            if (PADDING_EDGE.has(name) && rule.selectors.some((selector) => /\.salt-case-study-view(?![\w-])[^\s>+~]*$/.test(selector))) {
              return `${where} writes \`${property}: ${value.trim()}\` on the case study view's article, whose padding opens the gap between the site header and the title; only its own rule in primitives.css sets it`
            }
          }
        }
      }
      return null
    },
  },
  {
    file: 'primitives.css',
    what: 'the arrow after a way onward is drawn in its line',
    why:
      'Tailwind’s preflight makes every `<svg>` a block, which dropped the arrow onto a line of its own ' +
      'under the title’s last word until `.salt-arrow > .salt-icon` set `display: inline-block`, measured ' +
      '(BD-195). A tidy-up removing it, or a later rule setting another display, leaves every test of the ' +
      'markup green (#211 review, 7; re-review, 1 and 2).',
    check: (rules, all) => {
      const icon = rules.find((rule) => rule.at.length === 0 && rule.selectors.includes(normalise('.salt-arrow > .salt-icon')))
      if (icon === undefined) return 'no unconditional `.salt-arrow > .salt-icon` rule in primitives.css'
      const display = declarationsOf(icon, new Set(['display']))
      if (display.length !== 1) return `\`.salt-arrow > .salt-icon\` must set \`display\` once, to \`inline-block\`; it sets it ${String(display.length)} times`
      const written = display[0]?.value ?? ''
      if (isImportant(written)) return '`.salt-arrow > .salt-icon` declares `display` !important, which no contract here can rank'
      const read = keyword(written)
      if (read === null) return `\`.salt-arrow > .salt-icon\` writes \`display: ${written.trim()}\`, a spelling this contract does not read; it reads one keyword, \`inline-block\``
      if (read !== 'inline-block') return `\`.salt-arrow > .salt-icon\` writes \`display: ${written.trim()}\`; write \`inline-block\`, or Tailwind's preflight puts the arrow on a line of its own`
      /* Any other rule reaching the arrow's icon at (0,2,0) or above, in any stylesheet or query. */
      for (const other of overriders(all, (selector) => reachesChild(selector, 'salt-icon', 'salt-arrow'), new Set([icon]), [0, 2, 0], new Set(['display', 'all']))) {
        const word = other.property === 'display' && !isImportant(other.value) ? keyword(other.value) : undefined
        if (word === 'inline-block') continue
        if (word === null) return `${other.where} writes \`display: ${other.value.trim()}\` on the arrow's icon, a spelling this contract does not read, so it cannot say the arrow stays in its line`
        return `${other.where} writes \`${other.property}: ${other.value.trim()}\` on the arrow's icon, over \`.salt-arrow > .salt-icon\`'s \`display: inline-block\`; Tailwind's preflight then puts the arrow on a line of its own`
      }
      return null
    },
  },
  {
    file: 'blocks.css',
    what: 'the arrow after a linked card title takes its words’ colour',
    why:
      '`.salt-grid .salt-icon` paints a card’s icons in the brand colour, which is scoped as a foreground ' +
      'to no tone, so the arrow in a title’s line takes its words’ colour instead (BD-195). A tidy-up ' +
      'removing the rule, or a later one colouring the arrow, leaves every test of the markup green ' +
      '(#211 review, 7; re-review, 1 and 2).',
    check: (rules, all) => {
      const COLOURED = ['.salt-grid .salt-arrow > .salt-icon', ".salt-block[data-block='carousel'] .salt-arrow > .salt-icon"].map(normalise)
      const colour = rules.find((rule) => rule.at.length === 0 && COLOURED.every((selector) => rule.selectors.includes(selector)))
      if (colour === undefined) return `no unconditional \`${COLOURED.join(', ')}\` rule in blocks.css gives the arrow its words' colour, so it takes the card icon's brand colour`
      /* `inherit` and `currentcolor` are one colour for the `color` property, the parent's. */
      const keeps = (value) => {
        const word = keyword(value)
        if (word === 'inherit' || word === 'currentcolor') return true
        return /var\(|env\(|calc\(/i.test(value) ? null : false
      }
      const value = colour.declarations['color']
      if (value === undefined) return `\`${COLOURED.join(', ')}\` in blocks.css sets no \`color\``
      if (isImportant(value)) return `\`${COLOURED.join(', ')}\` declares \`color\` !important, which no contract here can rank`
      const verdict = keeps(value)
      if (verdict === null) return `\`${COLOURED.join(', ')}\` writes \`color: ${value.trim()}\`, a spelling this contract does not read; it reads \`inherit\` or \`currentcolor\``
      if (!verdict) return `\`${COLOURED.join(', ')}\` writes \`color: ${value.trim()}\`; write \`inherit\`, the words' colour`
      /* Any other rule reaching the arrow's icon at the colour rule's (0,3,0) or above. The card
         icon's own brand rule is the colour rule's selectors less `.salt-arrow >`, which the colour
         rule outranks branch for branch by construction, so it alone is set aside. */
      const BRAND = new Set(['.salt-grid .salt-icon', ".salt-block[data-block='carousel'] .salt-icon"].map(normalise))
      const reaches = (selector) => reachesChild(selector, 'salt-icon', 'salt-arrow') && !BRAND.has(normalise(selector))
      for (const other of overriders(all, reaches, new Set([colour]), [0, 3, 0], new Set(['color', 'all']))) {
        const kept = other.property === 'color' && !isImportant(other.value) ? keeps(other.value) : false
        if (kept === true) continue
        if (kept === null) return `${other.where} writes \`color: ${other.value.trim()}\` on the arrow's icon, a spelling this contract does not read, so it cannot say the arrow keeps its words' colour`
        return `${other.where} writes \`${other.property}: ${other.value.trim()}\` on the arrow's icon, over the colour rule's \`color: inherit\`; the arrow then leaves its words' colour`
      }
      return null
    },
  },
  {
    file: 'chrome.css',
    what: 'a footer link keeps a 24 CSS px floor at every width, 44px below `lg` and 32px from it',
    why:
      'WCAG 2.5.8 is stated in CSS pixels and `rem` is not, so a floor written as a bare rem, `2rem` for ' +
      'the 32px rows Ollie ruled from 1024 CSS px up (BD-195), drops under 24px on a site that shrinks its ' +
      'root, as `.salt-button`’s floor records. Every rule sizing a footer link, the `lg` query’s among ' +
      'them, keeps a `max(…, 24px)`, and the row below `lg` stays the 44px touch floor (#211 review, 7).',
    check: (rules, all) => {
      const FLOORS = new Set(['min-block-size', 'min-height'])
      const LG = '@media (min-width: 64rem)'
      /* Every rule sizing a footer link, in any stylesheet, any query and any key the link can match
         (#211 re-review, 1). The last unconditional one decides below `lg`, so every one of them must
         be the 44px floor; only the `lg` query may lower it, to 32px. */
      const sizing = [...all].flatMap(([file, fileRules]) =>
        fileRules
          .filter((rule) => rule.selectors.some((selector) => compoundClasses(keyCompound(selector)).has('salt-footer__link')) && declarationsOf(rule, FLOORS).length > 0)
          .map((rule) => ({ file, rule })),
      )
      if (!sizing.some(({ rule }) => conditional(rule.at).length === 0)) return 'no unconditional rule gives `.salt-footer__link` a height floor'
      let lowered = 0
      for (const { file, rule } of sizing) {
        const where = `\`${rule.selectors.join(', ')}\`${rule.at.length > 0 ? ` inside \`${rule.at.join(' ')}\`` : ''} in ${file}`
        const query = conditional(rule.at).map((at) => at.replace(/\s+/g, ' ').trim())
        for (const { property, value } of declarationsOf(rule, FLOORS)) {
          if (isImportant(value)) return `${where} declares \`${property}\` !important, which no contract here can rank`
          const floor = readFloor(value)
          if (floor === null) return `${where} sets ${property} to \`${value.trim()}\` with no px floor, so a root-size change takes a footer link under 2.5.8's 24 CSS px`
          if (!reachesTargetFloor(floor)) return `${where} floors ${property} at \`${floor.expression}\`, which never reaches 24 CSS px`
          /* The rem term is the row: 2.75rem the 44px touch floor, 2rem the 32px row from `lg`. A
             `var()` or `calc()` inside the `max()` is a spelling this does not read. */
          if (floor.unread || floor.rem.length !== 1) return `${where} floors ${property} at \`${floor.expression}\`, a spelling this contract does not read; it reads \`max(<rem>, <px>)\``
          const rows = floor.rem[0] ?? 0
          if (query.length === 0) {
            if (rows !== 2.75) return `${where} floors ${property} at \`${floor.expression}\` at every width; below \`lg\` a link keeps the 44px touch floor, \`max(2.75rem, 24px)\`, and only \`${LG}\` lowers it`
            continue
          }
          if (rows >= 2.75) continue
          if (query.length !== 1 || query[0]?.toLowerCase() !== LG) return `${where} lowers the footer link's floor to \`${floor.expression}\` outside \`${LG}\`; 32px rows are for 1024 CSS px up, and 44px stands below`
          if (rows !== 2) return `${where} floors ${property} at \`${floor.expression}\`; from \`lg\` up the row is \`max(2rem, 24px)\``
          lowered += 1
        }
      }
      return lowered === 1 ? null : `\`${LG}\` lowers the footer link's floor ${String(lowered)} times; write it once, as \`max(2rem, 24px)\``
    },
  },
  {
    file: 'primitives.css',
    what: 'the arrow after a way onward points the way its line reads',
    why:
      'the arrow is drawn pointing right, and its margin is logical, so in right-to-left text it moves ' +
      'to the left of the word and would still point right, back at the word it follows (#211 review, 4). ' +
      '`:dir()` mirrors it, two attribute rules cover an engine without `:dir()`, a right-to-left page ' +
      'and a left-to-right island in it, and a later `:dir(ltr)` rule puts an island back where `:dir()` ' +
      'is known. A rule removed, reordered or given ' +
      'another value leaves every test of the markup green.',
    check: (rules, all) => {
      const RULES = [
        { selector: normalise("[dir='rtl'] .salt-arrow > .salt-icon"), scale: '-1 1' },
        { selector: normalise(":where([dir='rtl']) [dir='ltr'] .salt-arrow > .salt-icon"), scale: 'none' },
        { selector: normalise('.salt-arrow:dir(rtl) > .salt-icon'), scale: '-1 1' },
        { selector: normalise('.salt-arrow:dir(ltr) > .salt-icon'), scale: 'none' },
      ]
      const at = []
      for (const { selector, scale } of RULES) {
        const found = rules.findIndex((rule) => rule.at.length === 0 && rule.selectors.length === 1 && rule.selectors[0] === selector)
        if (found === -1) return `no unconditional \`${selector}\` rule of its own in primitives.css; each direction rule is its own, so an engine that drops one keeps the others`
        const value = rules[found]?.declarations['scale']
        if (value === undefined) return `\`${selector}\` sets no \`scale\`, so the arrow does not follow the line's direction there`
        if (isImportant(value)) return `\`${selector}\` declares \`scale\` !important, which no contract here can rank`
        /* Read as factors, so `1` and `1 1 1` are `none` and `-1 1 1` is the mirror (#211 re-review, 2). */
        const factors = scaleFactors(value)
        if (factors === null) return `\`${selector}\` writes \`scale: ${value.trim()}\`, a spelling this contract does not read; it reads numbers, percentages or \`none\``
        const wanted = scaleFactors(scale) ?? [1, 1, 1]
        if (factors.some((factor, index) => factor !== wanted[index])) return `\`${selector}\` writes \`scale: ${value.trim()}\`; write \`scale: ${scale}\``
        at.push(found)
      }
      const owners = new Set(at.map((index) => rules[index]).filter((rule) => rule !== undefined))
      for (const other of overriders(all, (selector) => reachesChild(selector, 'salt-icon', 'salt-arrow'), owners, [0, 3, 0], new Set(['scale', 'all']))) {
        return `${other.where} writes \`${other.property}: ${other.value.trim()}\` on the arrow's icon, which the four direction rules alone set; the arrow then points against the line somewhere`
      }
      const [attribute, island, rtl, ltr] = at
      if (!(island > attribute)) return "the `[dir='ltr']` island rule comes before the `[dir='rtl']` fallback, so at the same specificity it cannot put a left-to-right island back where `:dir()` is unknown"
      if (!(rtl > island)) return "the `:dir(rtl)` rule comes before the `[dir='ltr']` island rule, so that rule wins over a right-to-left block inside the island"
      if (!(ltr > rtl && ltr > attribute)) return 'the `:dir(ltr)` rule comes before a rule mirroring the arrow, so at the same specificity it cannot put a left-to-right island back'
      return null
    },
  },
  {
    file: 'blocks.css',
    what: 'a card groups its parts by proximity, each join a card-rhythm token, and a grid of cards spaces its rows by `--space-card-row`',
    why:
      'a card was one flat `gap: 0.75rem`, so its title clung to its photograph while its meta line and ' +
      'summary drifted off, a feature card’s icon sat nearer its title than the title to its text, and ' +
      'the grid’s 1.5rem row gap was smaller than the gaps inside a card, measured on Floorworkz’s ' +
      'preview against opshaug.no on 30/09/2026 (the mirrored row MR-9). Ollie ruled that core fixes it ' +
      'and that a site retunes it as tokens (BD-195), so a gap written back on the card, a join removed ' +
      'or spelled as a length, or a later rule moving a join’s edge is the flat card returning. The ' +
      'second component whose joins are pinned, after the case study view’s (BD-188).',
    check: (_rules, all) => {
      /* Both places a showcase card is drawn: on a grid, and in the carousel block, where a slide or a
         lone card has no grid above it. Each join is written once per place, and each is pinned. */
      const CARDS = ['.salt-grid .salt-card', ".salt-block[data-block='carousel'] .salt-card"].map(normalise)
      const JOINS = [
        { tail: ' > * + *', value: 'var(--space-card-body)', join: 'between a card’s body parts' },
        { tail: ' > :is(h1, h2, h3, h4, h5, h6) + *', value: 'var(--space-card-title)', join: 'after a card’s title' },
        { tail: ' > .salt-showcase__meta + .salt-showcase__meta', value: 'var(--space-card-title)', join: 'between two meta lines' },
        { tail: ' > :is(.salt-showcase__media, .salt-icon) + *', value: 'var(--space-card-media)', join: 'after a card’s picture' },
      ].flatMap((entry) => CARDS.map((card) => ({ ...entry, selector: normalise(card + entry.tail) })))
      const RESETS = CARDS.map((card) => normalise(`${card} > *`))
      const GRID = normalise('.salt-grid:has(> li > .salt-card)')
      /* The start edge in every spelling, as the case study's contract reads it (#201 review), and
         every property that would space the card's parts without a margin. */
      const START_EDGE = new Set(['margin', 'margin-block', 'margin-block-start', 'margin-top', 'all'])
      const GAPS = new Set(['gap', 'row-gap', 'grid-row-gap', 'grid-gap'])
      const token = (value) => {
        const match = /^var\(\s*(--[\w-]+)\s*\)$/i.exec(value.trim())
        return match === null ? null : `var(${match[1] ?? ''})`
      }
      /* A bare length or zero, which is the flat card's spelling. Anything else that is not one
         `var()` gets the third verdict below. */
      const LENGTH = /^-?(?:\d+\.?\d*|\.\d+)(?:[a-z]+|%)?$/i
      const blocks = all.get('blocks.css') ?? []
      const owner = (selector) =>
        blocks.find((rule) => rule.at.length === 0 && rule.selectors.includes(selector))
      const setters = (rule, names) =>
        rule.order.map((property, at) => ({ property: property.toLowerCase(), value: rule.values[at] ?? '' })).filter(({ property }) => names.has(property))

      /* Every token a join reads is declared once in theme.css, or the join computes to nothing. */
      for (const name of new Set([...JOINS.map((j) => j.value), 'var(--space-card-row)'])) {
        const resolved = themeValue(name.slice('var('.length, -1))
        if ('missing' in resolved) return `${resolved.missing}, which the card rhythm reads`
      }

      const owners = new Set()
      for (const { selector, value, join } of JOINS) {
        const rule = owner(selector)
        if (rule === undefined) return `no unconditional \`${selector}\` rule in blocks.css opens the gap ${join}`
        owners.add(rule)
        const where = `\`${selector}\` in blocks.css`
        const start = setters(rule, START_EDGE)
        const other = start.find(({ property }) => property !== 'margin-block-start')
        if (other !== undefined) return `${where} writes \`${other.property}: ${other.value.trim()}\` beside the gap ${join}; only \`margin-block-start\` sets that edge`
        if (start.length !== 1) {
          return start.length === 0 ? `${where} sets no \`margin-block-start\`, so nothing opens the gap ${join}` : `${where} sets \`margin-block-start\` ${String(start.length)} times; write it once`
        }
        const written = start[0]?.value ?? ''
        if (isImportant(written)) return `${where} declares \`margin-block-start\` !important, which no contract here can rank`
        if (LENGTH.test(written.trim())) return `${where} writes \`margin-block-start: ${written.trim()}\` for the gap ${join}, a length of its own; write \`${value}\``
        const read = token(written)
        /* The third verdict: a `calc()` or a `var()` with a fallback may compute the same, and this
           contract compares one `var()`, so it says it cannot read it rather than calling it wrong. */
        if (read === null) return `${where} writes \`margin-block-start: ${written.trim()}\` for the gap ${join}, a spelling this contract does not read; write \`${value}\``
        if (read !== value) return `${where} writes \`margin-block-start: ${written.trim()}\` for the gap ${join}; write \`${value}\`, the card-rhythm token for that join`
      }

      /* The reset is required, and comes before every join it would otherwise zero: it matches each
         part at the carousel's (0,3,0) and the grid's (0,2,0), as the body's owl does, so order
         decides. Without it a site with no CSS reset adds a heading's and a paragraph's user-agent
         margins to every join (#211 review, 7). */
      const reset = blocks.find((rule) => rule.at.length === 0 && RESETS.every((selector) => rule.selectors.includes(selector)))
      if (reset === undefined) return `no unconditional \`${RESETS.join(', ')}\` rule in blocks.css zeroes a card part's own margins, so a site with no CSS reset adds them to every join`
      /* Read as the edges the rule leaves, so `margin-block: 0 0`, the two longhands at zero or
         `margin: 0` are the reset too (#211 re-review, 2). */
      const resetEdges = blockEdges(reset)
      const written = setters(reset, new Set(['margin', 'margin-block', 'margin-block-start', 'margin-block-end', 'margin-top', 'margin-bottom']))
      const spelled = written.map((d) => `\`${d.property}: ${d.value.trim()}\``).join(', ') || 'no block margin'
      if (written.some((d) => isImportant(d.value))) return `\`${RESETS.join(', ')}\` in blocks.css declares a block margin !important, which no contract here can rank`
      if (resetEdges.unread) return `\`${RESETS.join(', ')}\` in blocks.css writes ${spelled}, a spelling this contract does not read; it reads lengths, so write \`margin-block: 0\``
      if (!isZero(resetEdges.start) || !isZero(resetEdges.end)) return `\`${RESETS.join(', ')}\` in blocks.css must leave both block margins at zero; it writes ${spelled}`
      const first = Math.min(...[...owners].map((rule) => blocks.indexOf(rule)))
      if (blocks.indexOf(reset) > first) return `\`${RESETS.join(', ')}\` comes after the card’s joins in blocks.css, so at the same specificity it zeroes them`
      /* And a card's rich text at its outer edges, since a flex item's paragraph margins do not collapse
         through it (#211 review, 5). */
      const END_EDGE = new Set(['margin', 'margin-block', 'margin-block-end', 'margin-bottom', 'all'])
      for (const [edge, property, edges] of [[':first-child', 'margin-block-start', START_EDGE], [':last-child', 'margin-block-end', END_EDGE]]) {
        const selectors = CARDS.map((card) => normalise(`${card} > .salt-rich-text > ${edge}`))
        const rule = blocks.find((candidate) => candidate.at.length === 0 && selectors.every((selector) => candidate.selectors.includes(selector)))
        if (rule === undefined) return `no unconditional \`${selectors.join(', ')}\` rule in blocks.css writes \`${property}: 0\`, so with no CSS reset a card's rich text keeps its paragraph's user-agent margin inside the join`
        const own = setters(rule, edges === START_EDGE ? START_EDGE : new Set(['margin', 'margin-block', 'margin-block-end', 'margin-bottom', 'all']))
        if (own.some((d) => isImportant(d.value))) return `\`${selectors.join(', ')}\` in blocks.css declares ${own.map((d) => `\`${d.property}\``).join(', ')} !important, which no contract here can rank`
        const left = blockEdges(rule)
        const value = edge === ':first-child' ? left.start : left.end
        if (left.unread) return `\`${selectors.join(', ')}\` in blocks.css writes ${own.map((d) => `\`${d.property}: ${d.value.trim()}\``).join(', ')}, a spelling this contract does not read; write \`${property}: 0\``
        if (!isZero(value)) {
          return `no unconditional \`${selectors.join(', ')}\` rule in blocks.css writes \`${property}: 0\`, so with no CSS reset a card's rich text keeps its paragraph's user-agent margin inside the join`
        }
        /* Nothing else reaching a rich-text child at the rule's (0,4,0) or above may move that edge off
           zero, in any stylesheet or query (#211 re-review, 1). */
        for (const other of overriders(all, (selector) => reachesChild(selector, null, 'salt-rich-text'), new Set([rule]), [0, 4, 0], edges)) {
          if (!isImportant(other.value) && isZero(other.value.trim())) continue
          return `${other.where} writes \`${other.property}: ${other.value.trim()}\` on a card's rich text, over the rule that zeroes its ${edge === ':first-child' ? 'first block\'s top' : 'last block\'s foot'}; with no CSS reset the join widens again`
        }
      }

      /* A card's parts themselves: nothing but the reset and the joins may set their block margins at
         the reset's (0,2,0) or above, in any stylesheet or query; a zero foot is harmless. */
      const reachesPart = (selector) => {
        const { compounds, combinators } = chainOf(stripNegations(selector))
        if (compounds.length < 2 || combinators.at(-1) !== '>') return false
        const above = requiredClasses(compounds.at(-2) ?? '')
        return above.size === 0 || above.has('salt-card')
      }
      for (const other of overriders(all, reachesPart, new Set([...owners, reset]), [0, 2, 0], new Set([...START_EDGE, ...END_EDGE]))) {
        const endOnly = END_EDGE.has(other.property) && !START_EDGE.has(other.property)
        if (endOnly && !isImportant(other.value) && isZero(other.value.trim())) continue
        return `${other.where} writes \`${other.property}: ${other.value.trim()}\` on a card's part, which only the reset and the card-rhythm joins space`
      }

      const pinned = new Set([...JOINS.map((j) => j.selector), ...RESETS])
      for (const [file, rules] of all) {
        for (const rule of rules) {
          const where = `\`${rule.selectors.join(', ')}\`${rule.at.length > 0 ? ` inside \`${rule.at.join(' ')}\`` : ''} in ${file}`
          /* The card itself sets no gap: every join is a margin, so a gap would add to all of them. */
          if (rule.selectors.some((selector) => CARDS.includes(selector))) {
            const gap = setters(rule, GAPS)[0]
            if (gap !== undefined) return `${where} writes \`${gap.property}: ${gap.value.trim()}\` on the card, which adds to every join the card-rhythm tokens space`
          }
          if (owners.has(rule) || rule === reset) continue
          if (!rule.selectors.some((selector) => pinned.has(selector))) continue
          const start = setters(rule, START_EDGE)[0]
          if (start !== undefined) return `${where} writes \`${start.property}: ${start.value.trim()}\` on a card join MR-9 owes, which its own rule in blocks.css sets; only that rule sets the edge`
        }
      }

      /* The row gap: one unconditional rule, reading the token, and no other rule setting a gap there. */
      const grid = blocks.filter((rule) => rule.selectors.includes(GRID))
      const own = grid.find((rule) => rule.at.length === 0)
      if (own === undefined) return `no unconditional \`${GRID}\` rule in blocks.css sets the gap between rows of cards`
      const rows = setters(own, GAPS)
      if (rows.length !== 1 || rows[0]?.property !== 'row-gap') {
        return `\`${GRID}\` in blocks.css must set \`row-gap\` alone, once; it writes ${rows.map((r) => `\`${r.property}\``).join(', ') || 'no gap'}`
      }
      const rowValue = rows[0].value
      if (isImportant(rowValue)) return `\`${GRID}\` declares \`row-gap\` !important, which no contract here can rank`
      if (LENGTH.test(rowValue.trim())) return `\`${GRID}\` writes \`row-gap: ${rowValue.trim()}\`, a length of its own; write \`var(--space-card-row)\``
      const rowRead = token(rowValue)
      if (rowRead === null) return `\`${GRID}\` writes \`row-gap: ${rowValue.trim()}\`, a spelling this contract does not read; write \`var(--space-card-row)\``
      if (rowRead !== 'var(--space-card-row)') return `\`${GRID}\` writes \`row-gap: ${rowValue.trim()}\`; write \`var(--space-card-row)\`, the gap between rows of cards`
      const second = grid.find((rule) => rule !== own && setters(rule, GAPS).length > 0)
      if (second !== undefined) return `a second \`${GRID}\` rule${second.at.length > 0 ? ` inside \`${second.at.join(' ')}\`` : ''} sets a gap; the row gap is set once, by the token`
      return null
    },
  },
  {
    file: 'primitives.css',
    what: 'every component the contract names a text role for is set in that role, by its own rule, and nothing else sets its text',
    why:
      'the contract above refuses a literal and half a role, and says nothing when a component’s role is ' +
      'deleted or swapped: the component then falls back to the body text, the state MR-4 left buttons, ' +
      'menu links, captions, meta lines, a testimonial and the two standfirsts in until 0.7.0 (BD-185). ' +
      'The role is asked of the component’s own rule, unconditionally, since a role inside a query leaves ' +
      'the body text below it, and no other rule naming the component sets its text, a weight included, ' +
      'inside a query or out: a state is marked by something other than weight (Ollie’s ruling of ' +
      '28/09/2026), and any override takes the component back from the editor’s scale.',
    check: (_rules, all) => {
      /* A subject naming no class cannot be matched to a component by this gate, so it forbids rather
         than models: text is set on such an element only by the rules listed by name. */
      for (const [file, rules] of all) {
        for (const rule of rules) {
          const property = rule.order.find((name) => ROLE_PROPERTIES.has(name.toLowerCase()) || name.toLowerCase() === 'font')
          if (property === undefined) continue
          const classless = rule.selectors.find((candidate) => requiredClasses(keyCompound(candidate)).size === 0 &&
            !CLASSLESS_SUBJECTS.has(candidate) && !(BASE_SUBJECTS.has(candidate) && inBaseLayer(file, rule)))
          if (classless !== undefined) {
            return `\`${classless}\` in ${file} sets \`${property}\` on an element it names by no class, so no contract here can tell which component it reaches; set text through the component's class, or list the selector beside the card title's and the hero headline's`
          }
        }
      }
      for (const entry of COMPONENT_ROLES) {
        const selector = normalise(entry.selector)
        const where = `\`${entry.selector}\` in ${entry.file}`
        const reading = (all.get(entry.file) ?? []).filter(
          (rule) => rule.selectors.includes(selector) && rule.order.some((property) => ROLE_PROPERTIES.has(property.toLowerCase())),
        )
        const own = reading.filter((rule) => rule.at.length === 0)
        const conditional = reading.find((rule) => rule.at.length > 0)
        if (own.length === 0) {
          return conditional === undefined
            ? `no rule sets ${where} in \`${entry.role}\`, so it falls back to the body text; the contract names \`${entry.role}\` for it`
            : `${where} is set in a role only inside \`${conditional.at.join(' ')}\`, so it falls back to the body text outside it; set it in \`${entry.role}\` unconditionally`
        }
        for (const rule of own) {
          const byName = new Map(Object.entries(rule.declarations).map(([property, value]) => [property.toLowerCase(), value.trim()]))
          /* Four verdicts per property, never two: absent, `!important` (which no contract here can
             rank, so nothing is claimed about the value), a spelling this contract does not read as a
             role, and a role's own spelling, which is then either the named role or another. */
          for (const { property, value } of textRoleDeclarations(entry.role)) {
            const declared = byName.get(property)
            if (declared === undefined) {
              return `${where} does not set \`${property}\`; the contract names \`${entry.role}\` for it, all five: \`${property}: ${value}\``
            }
            if (isImportant(declared)) return `${where} declares \`${property}\` !important, which no contract here can rank`
            const reference = spelled(declared)
            const found = reference === null ? undefined : ROLE_OWNER.get(reference)
            if (found === undefined) {
              return `${where} writes \`${property}: ${declared}\`, a spelling this contract does not read as a role; the contract names \`${entry.role}\` for it: \`${property}: ${value}\``
            }
            if (found.role !== entry.role) return `${where} is set in \`${found.role}\`; the contract names \`${entry.role}\` for it`
            if (reference !== value) {
              return `${where} sets \`${property}\` from \`${reference ?? ''}\`, which is \`${found.role}\`'s \`${found.property}\`; it reads \`${value}\``
            }
          }
        }
        /* Another rule whose subject names the component's class, in any of the four stylesheets.
           A component whose own subject names no class (`.salt-card :is(h1, …)`) cannot be gathered this
           way; its own rule is required above, and no other class-less rule sets text at all. */
        const classes = requiredClasses(keyCompound(selector))
        if (classes.size === 0) continue
        for (const [file, rules] of all) {
          for (const rule of rules) {
            if (own.includes(rule)) continue
            const subject = rule.selectors.find((candidate) => [...requiredClasses(keyCompound(candidate))].some((name) => classes.has(name)))
            if (subject === undefined) continue
            for (const [index, property] of rule.order.entries()) {
              const name = property.toLowerCase()
              if (!ROLE_PROPERTIES.has(name) && name !== 'font') continue
              const value = (rule.values[index] ?? '').trim()
              if (isImportant(value)) return `\`${rule.selectors.join(', ')}\` in ${file} declares \`${property}\` !important on \`${subject}\`, which no contract here can rank`
              /* A weight rung included (#198 review, F1): a state is not marked by weight, so no rung is
                 excused, and a rule inside a query is refused as one outside it is. */
              return `\`${rule.selectors.join(', ')}\` in ${file} sets \`${property}: ${value}\` on \`${subject}\`, which ${where} sets in \`${entry.role}\`; only that rule sets its text, a weight included, inside a query or out`
            }
          }
        }
      }
      return null
    },
  },
  {
    file: 'sections.css',
    what: 'the footer takes its tone from the bands’ own tone rules, and from nowhere else',
    why:
      'a footer can sit on any of the four tones (BD-204), and what makes its text, links, focus keyline and ' +
      'lines AA there is that it reads the roles a band of that tone reads, which the contrast manifest ' +
      'proves. A copy of the routing table for the footer would be a second table nothing ties to the first, ' +
      'the shape BD-033’s hairline defect took; so the footer is named in each tone rule’s own selector list, ' +
      'and a `--salt-section-*` role declared for the footer anywhere else is refused, since it would repoint ' +
      'one of its colours away from the tone it carries.',
    check: (rules, all) => {
      const shared = new Set()
      for (const { attribute, scope } of [
        { attribute: 'data-tone', scope: '' },
        { attribute: 'data-tone-dark', scope: "[data-theme='dark'] " },
      ]) {
        for (const tone of TONES) {
          const band = `${scope}.salt-section[${attribute}='${tone}']`
          const footer = `${scope}.salt-footer[${attribute}='${tone}']`
          const owners = rules.filter(
            (rule) => rule.selectors.includes(band) && conditional(rule.at).length === 0 && rule.order.includes('--salt-section-ink'),
          )
          if (owners.length === 0) return `no unconditional \`${band}\` rule declares the tone’s roles`
          for (const owner of owners) {
            if (!owner.selectors.includes(footer)) {
              return `\`${band}\` declares the tone’s roles without \`${footer}\` in its selector list, so a footer on \`${tone}\` keeps the roles of whatever tone it had; add it to that rule`
            }
            shared.add(owner)
          }
        }
      }
      const FOOTER = /\.salt-footer(?:__[\w-]+)?(?![\w-])/
      for (const [file, fileRules] of all) {
        for (const rule of fileRules) {
          if (shared.has(rule)) continue
          const role = rule.order.find((property) => property.startsWith('--salt-section-'))
          if (role === undefined) continue
          const reaching = rule.selectors.find((selector) => FOOTER.test(withoutAttributes(stripNegations(selector))))
          if (reaching !== undefined) {
            return `\`${reaching}\` in \`${file}\` declares \`${role}\` for the footer outside the tone rules, which repoints a footer colour away from its tone; set the footer’s \`tone\` instead`
          }
        }
      }
      return null
    },
  },
  {
    file: 'sections.css',
    what: 'every framed image fills its frame',
    why:
      'SC-011: a frame whose image fills it relied on Salt for Next.js’s image component writing ' +
      'the fill as inline style, which a plain `img` on Salt for WordPress does not carry. Without the ' +
      'rule the image draws at its intrinsic size, overflowing or under-filling a frame whose ' +
      'proportion was fixed so nothing shifts as it loads. Each image is held to one unconditional ' +
      'rule of its own, and its frame to `position: relative`, the anchor the fill is measured from.',
    check: (_rules, all) => {
      /* Every frame whose image fills it, and the fit it fills with. A new one joins this list. */
      const FRAMES = [
        { file: 'sections.css', image: '.salt-section__media', frame: '.salt-section', fit: 'cover' },
        { file: 'blocks.css', image: '.salt-logos__image', frame: '.salt-logos__frame', fit: 'contain' },
        { file: 'blocks.css', image: '.salt-showcase__media > img', frame: '.salt-showcase__media', fit: 'cover' },
        { file: 'primitives.css', image: '.salt-case-study-view__media > img', frame: '.salt-case-study-view__media', fit: 'cover' },
        { file: 'primitives.css', image: '.salt-case-study-view__frame > img', frame: '.salt-case-study-view__frame', fit: 'cover' },
        { file: 'views.css', image: '.salt-post__media > img', frame: '.salt-post__media', fit: 'cover' },
        { file: 'views.css', image: '.salt-archive__portrait > img', frame: '.salt-archive__portrait', fit: 'cover' },
        { file: 'views.css', image: '.salt-author-box__media > img', frame: '.salt-author-box__media', fit: 'cover' },
      ]
      const owning = (file, selector) =>
        (all.get(file) ?? []).filter((rule) => conditional(rule.at).length === 0 && rule.selectors.includes(normalise(selector)))
      for (const { file, image, frame, fit } of FRAMES) {
        const FILL = { position: 'absolute', inset: '0', 'inline-size': '100%', 'block-size': '100%', 'object-fit': fit }
        const rules = owning(file, image)
        if (rules.length === 0) return `no unconditional \`${image}\` rule in ${file} fills its frame`
        for (const [property, expected] of Object.entries(FILL)) {
          const written = rules.map((rule) => rule.declarations[property]).filter((value) => value !== undefined).at(-1)
          if (written === undefined) return `\`${image}\` in ${file} declares no \`${property}\`; the fill is \`${property}: ${expected}\``
          if (written.trim().toLowerCase() !== expected) return `\`${image}\` in ${file} sets \`${property}: ${written.trim()}\`; the fill is \`${property}: ${expected}\``
        }
        const anchored = owning(file, frame).some((rule) => (rule.declarations['position'] ?? '').trim().toLowerCase() === 'relative')
        if (!anchored) return `\`${frame}\` in ${file} is not \`position: relative\`, so its image fills the nearest positioned ancestor instead`
      }
      return null
    },
  },
]

/* What a stylesheet's text alone can be refused for, found once per text: the test reads the same
   files hundreds of times. */
/* Every `var()` a stylesheet's text reads, and whether that read carries a fallback. Comments and
   strings are blanked first, so neither a paragraph quoting a `var()` nor `content` counts. */
const varReads = memo((text) =>
  [...text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""')
    .matchAll(/var\(\s*(--[\w-]+)\s*(,?)/gi)].map((m) => [m[1], m[2] === ',']))

/* The keys of a markup file that describe rather than draw: a platform's former markup, a rule's
   statement, a note, a hook kept with no rule, an omitted class. The class check and the markup
   writes both skip them, so prose never counts as markup. */
const NOT_ELEMENTS = new Set(['platforms', 'rules', 'notes', 'hooks', 'omitted'])

/* Every attribute value an element in a markup file writes: a plain string, or an entry's `value`. */
const attributeValuesIn = (node) => {
  if (Array.isArray(node)) return node.flatMap(attributeValuesIn)
  if (!node || typeof node !== 'object') return []
  const own = node.attributes && typeof node.attributes === 'object'
    ? Object.values(node.attributes).flatMap((value) => (typeof value === 'string' ? [value] : typeof value?.value === 'string' ? [value.value] : []))
    : []
  return [...own, ...Object.entries(node).filter(([key]) => !NOT_ELEMENTS.has(key) && key !== 'attributes').flatMap(([, value]) => attributeValuesIn(value))]
}

/* Every `var()` in a written value, nested ones and fallbacks included: its name, split at a
   `<placeholder>` if it has one, and whether it carries a fallback. */
const varsWritten = (value) =>
  [...value.matchAll(/var\(\s*(--[\w-]*?)(?:<([\w-]+)>([\w-]*))?\s*(,|\))/g)]
    .map((m) => ({ name: m[1], placeholder: m[2], rest: m[3] ?? '', fallback: m[4] === ',' }))

/* A field of that name anywhere in a fields file. */
const fieldNamed = (node, name) => {
  if (!node || typeof node !== 'object') return null
  if (!Array.isArray(node) && node.name === name && node.type !== undefined) return node
  for (const value of Object.values(node)) {
    const found = fieldNamed(value, name)
    if (found) return found
  }
  return null
}

const parseOnce = memo(parse)

const sourceFindings = memo((file, text) => {
  const out = []
  const source = text
    /* Comments blanked line for line, so the line reported is the file's own. */
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""')
  /* `@property` belongs in a runtime's token layer, which registers the two ring tokens beside their
     values (#189 re-review). Here the parse would read its block as an at-rule holding no rules, so
     its descriptors would pass unread; it is refused instead. */
  const registration = source.split('\n').findIndex((text) => /@property\b/i.test(text))
  if (registration !== -1) {
    out.push(`${file}:${String(registration + 1)} registers a custom property. \`@property\` belongs to a runtime's token ` +
      'layer, beside the values it registers; this gate cannot read one here.')
  }
  /* An allowlist of at-rules, because each one this gate has not been taught hides declarations from
     it. `@apply` wrote a utility's size and family into a rule where the parse saw none (#190 review,
     MEDIUM 1), and `@scope (.salt-card) { font-size: 3rem }` or `@utility salt-title { … }` did the
     same from outside a rule (#190 re-review, LOW); an unknown at-rule could do either. Inventoried on
     26/09/2026, the four stylesheets use `@media` and nothing else, so that is the list. `@property`
     is refused above with its own reason; every other name is refused here, `@apply` with its own.

     `@keyframes` joined it on 06/10/2026 for the burger's morph (BD-207), and only because what a
     keyframe may declare is narrowed below to motion: a keyframe is a rule this parse reads, so its
     declarations are not hidden, but no contract expects to find a colour or a size in a `from`. */
  /* `property` only so the refusal above is not reported twice. `layer` only as base.css's one
     `@layer base { … }` block, which is the base layer's whole point (checked below), and which every
     contract reads like any other rule: `conditional()` does not count a layer. */
  const AT_RULES = new Set(['media', 'keyframes', 'property', ...(file === 'base.css' ? ['layer'] : [])])
  for (const [index, text] of source.split('\n').entries()) {
    for (const match of text.matchAll(/@([\w-]+)/g)) {
      const name = (match[1] ?? '').toLowerCase()
      if (AT_RULES.has(name)) continue
      out.push(
        name === 'apply'
          ? `${file}:${String(index + 1)} uses \`@apply\`, whose declarations this gate cannot read. Write the ` +
              'declarations out, a text role for text, so the contracts below rank them.'
          : `${file}:${String(index + 1)} uses \`@${match[1] ?? ''}\`, an at-rule this gate does not read. The shared ` +
              'stylesheets use `@media` and `@keyframes` alone, and an at-rule nobody taught the gate can hide declarations ' +
              'from every contract; add it to the allowlist with its reason, or write the rules without it.',
      )
    }
  }
  const line = source.split('\n').findIndex((text) => text.includes('\\'))
  if (line !== -1) {
    out.push(
      `${file}:${String(line + 1)} carries a backslash outside a string. A CSS escape spells a selector or a ` +
        'property in a way no contract here reads, so it could satisfy or dodge one unseen. Write the name plainly.',
    )
  }
  /* base.css is one `@layer base` block and nothing else: a rule outside it would be unlayered and
     outrank Tailwind's utilities and a host's own rules, which is what the layer exists to stop. */
  if (file === 'base.css') {
    const preludes = [...source.matchAll(/@layer\b([^{;]*)([{;])/gi)].map((m) => `${m[1].trim()}${m[2]}`)
    const outside = parseOnce(text).rules.filter((rule) => !rule.at.some((prelude) => /^@layer\b/i.test(prelude)))
    if (preludes.length !== 1 || preludes[0] !== 'base{') {
      out.push(`base.css holds ${preludes.length === 0 ? 'no `@layer base` block' : preludes.map((p) => `\`@layer ${p.slice(0, -1)}\``).join(', ')}; it is one \`@layer base { … }\` block`)
    } else if (outside.length > 0) {
      out.push(`base.css writes \`${outside[0].selectors.join(', ')}\` outside its \`@layer base\` block, where it outranks every utility and host rule`)
    }
  }
  return out
})

/**
 * Every check, over the package's files: a map from each path in the package (`styles/blocks.css`,
 * `contract/token-layer.json`, `contract/markup/hero.json`) to its text. Returns the failures, one
 * line each, and the summary a passing run prints.
 */
export function checkStylesheets(files) {
  FILES = files
  TONES = readJson('contract/markup/section.json')?.root?.attributes?.['data-tone']?.enum ?? []
  TOKEN_LAYER = readJson('contract/token-layer.json')
  TOKEN_NAMES = tokenNames(TOKEN_LAYER)

  // ── 1. The parse is whole ───────────────────────────────────────────────────────────────────
  const fails = []
  const listed = [...files.keys()].filter((file) => /^styles\/[^/]+\.css$/.test(file)).map((file) => file.slice('styles/'.length)).sort()
  /* The four the contracts are written against must be there; every other stylesheet is read too, so
     a rule added in a new file is seen by every contract that sweeps all of them. */
  for (const file of ['sections.css', 'primitives.css', 'blocks.css', 'chrome.css']) {
    if (!listed.includes(file)) fails.push(`styles/${file} is missing, and the contracts below are written against it`)
  }
  const sources = new Map(listed.map((file) => [file, files.get(`styles/${file}`)]))
  const parsed = new Map([...sources].map(([file, css]) => [file, parseOnce(css)]))

  /*
   * The parse checks itself, because a contract that passes by finding no offender is
   * satisfied by a parser that finds nothing at all.
   *
   * The first version compared the rule count against a floor of 5 and justified it as
   * covering "two of the seven" contracts. Both halves were wrong: exactly one of the nine is
   * vacuity-shaped, and a floor cannot see a parse that loses ONE rule of fourteen — which is
   * what a statement at-rule did, and the rule it lost was the base focus indicator.
   *
   * So the count is derived rather than guessed. Every `{` in the source opens either an
   * at-rule block or a declaration block, so the declaration blocks are the difference, and
   * anything the walk drops shows up as a mismatch.
   */
  /*
   * A backslash outside a string is refused before any contract runs. CSS escapes let one selector
   * or property be spelled many ways: `b\\6f dy` is `body` to a browser and an unknown element to
   * every contract here, so it painted the page ground past the one-owner check (#181 review). The
   * contracts compare spellings, so the spellings they cannot read are forbidden rather than decoded,
   * the same rule the salt theme's gate uses. Inside a string, `content: "\\201C"` for one, an escape
   * names a character and selects nothing, so strings are skipped.
   */
  for (const [file, text] of sources) fails.push(...sourceFindings(file, text))

  for (const [file, { rules, bare, expected }] of parsed) {
    if (bare.length > 0) {
      fails.push(
        `${file} writes \`${bare[0] ?? ''}\` directly in an at-rule's block, outside any rule. No contract reads a ` +
          'declaration there, so it could set text or anything else unseen. Put it inside a rule.',
      )
    }
    if (rules.length !== expected) {
      fails.push(
        `Parsed ${String(rules.length)} rules from ${file} but the source contains ` +
          `${String(expected)} declaration blocks. The parse is dropping rules, so every ` +
          `contract below is reading an incomplete stylesheet.`,
      )
    }
    /* A keyframe moves things and does nothing else. Each one is read as a rule under its
       `@keyframes`, and may declare `transform` or `opacity` only: a colour there would animate the
       page off its paired roles where the colour contracts never look, and a size or a margin would
       move layout every contract here assumes is still. `!important` is refused by name, because a
       browser ignores it in a keyframe and a reader would not; a selector that is not `from`, `to` or
       a percentage is not a keyframe at all, and is refused rather than guessed at. */
    for (const rule of rules) {
      if (!rule.at.some((prelude) => /^@keyframes\b/i.test(prelude))) continue
      const selector = rule.selectors.find((text) => !/^(?:from|to|\d+(?:\.\d+)?%)$/i.test(text))
      if (selector !== undefined) {
        fails.push(`${file} holds \`${selector}\` inside \`@keyframes\`, which is not a keyframe selector this gate reads.`)
      }
      for (const [index, property] of rule.order.entries()) {
        const value = rule.values[index] ?? ''
        if (/!\s*important/i.test(value)) {
          fails.push(`${file} writes \`${property}: ${value}\` in a keyframe. A browser ignores \`!important\` there; write it plainly.`)
          continue
        }
        const name = property.toLowerCase()
        /* Not animated properties but how the next stretch is animated, legal in a keyframe and
           moving nothing on their own, so they pass rather than being called a defect (#230
           re-review). */
        if (name === 'animation-timing-function' || name === 'animation-composition') continue
        if (!['transform', 'opacity'].includes(name)) {
          fails.push(
            `${file} animates \`${property}\` in \`@keyframes\`. The shared keyframes animate \`transform\` or \`opacity\` only, ` +
              'so a colour, a size or a margin cannot change where the contracts below do not look; this gate reads ' +
              'no other animated property there.',
          )
        }
      }
    }
  }

  /* Every contract below reads the parse, so a parse that is not whole stops here. */
  if (fails.length > 0) return { fails, summary: '' }

  // ── 2. The decision contracts ───────────────────────────────────────────────────────────────
  const all = new Map([...parsed].map(([file, { rules }]) => [file, rules]))
  for (const contract of CONTRACTS) {
    const reason = contract.check(parsed.get(contract.file)?.rules ?? [], all)
    if (reason !== null) fails.push(`${contract.file}: ${contract.what}\n    found: ${reason}\n    why it matters: ${contract.why}`)
  }

  // ── 3. The token layer ──────────────────────────────────────────────────────────────────────
  // Every var() read, with whether that read has a fallback, and every custom property declared.
  // A declared name is the runtime's no longer: sections.css sets the band's own.
  const markupFiles = [...files.keys()].filter((file) => /^contract\/markup\/[^/]+\.json$/.test(file))
  const reads = new Map()
  const declaredHere = new Set()
  const addRead = (name, file, fallback) => {
    const entry = reads.get(name) ?? { files: new Set(), withFallback: 0, count: 0 }
    entry.files.add(file)
    entry.count += 1
    if (fallback) entry.withFallback += 1
    reads.set(name, entry)
  }
  for (const [file, text] of sources) {
    for (const [name, fallback] of varReads(text)) addRead(name, file, fallback)
    for (const rule of parsed.get(file).rules) for (const property of rule.order) if (property.startsWith('--')) declaredHere.add(property)
  }
  /* What the markup writes on an element (`--salt-scrim-alpha: var(--scrim-<strength>)` on the
     scrim's style) reaches the stylesheets too, so every `var()` in a written value is a read,
     fallbacks and nested `var()`s included. Only what elements write counts: attribute values on
     the nodes the class check reads, never a note, a rule's statement, an omitted class or a
     platform's former markup, whose prose could otherwise satisfy it. A `<placeholder>` stands for
     a setting's options, which the written property's token entry names in `values`
     (`_section-settings#scrimStrength`): each option is a token the runtime must emit. */
  const markupWrites = new Map()
  for (const file of markupFiles) {
    for (const text of attributeValuesIn(readJson(file))) {
      for (const m of text.matchAll(/(--[a-z][\w-]*)\s*:\s*([^;]+)/g)) {
        if (!markupWrites.has(m[1])) markupWrites.set(m[1], [])
        markupWrites.get(m[1]).push({ file, value: m[2].trim() })
      }
    }
  }
  if (!TOKEN_LAYER) fails.push('contract/token-layer.json is missing or not JSON; it names what a runtime emits for these stylesheets')
  else {
    for (const group of TOKEN_LAYER.groups ?? []) {
      for (const token of group.tokens ?? []) {
        if (token.values && !markupWrites.has(token.name)) {
          fails.push(`contract/token-layer.json gives ${token.name} values, but only a property the markup writes has them`)
        }
        if (token.source === 'markup' && !markupWrites.has(token.name)) {
          fails.push(`contract/token-layer.json says the markup writes ${token.name}, but no file in contract/markup/ does`)
        }
      }
    }
    for (const [property, writes] of markupWrites) {
      const token = TOKEN_NAMES.get(property)
      for (const { file, value } of writes) {
        for (const { name, placeholder, rest, fallback } of varsWritten(value)) {
          if (placeholder === undefined) { addRead(name, file, fallback); continue }
          const spelt = `var(${name}<${placeholder}>${rest})`
          if (!token?.values) { fails.push(`${file} writes ${property} as ${spelt}, and contract/token-layer.json gives no values for <${placeholder}>`); continue }
          const [fieldFile, fieldName] = String(token.values.field).split('#')
          const field = fieldNamed(readJson(`contract/fields/${fieldFile}.json`), fieldName)
          if (!field || !Array.isArray(field.options)) { fails.push(`contract/token-layer.json takes ${property}'s values from ${token.values.field}, which is not a field with options`); continue }
          for (const option of field.options) {
            if ((token.values.except ?? []).includes(option.value)) continue
            addRead(`${name}${option.value}${rest}`, file, fallback)
          }
        }
      }
    }
    const seen = new Set()
    for (const group of TOKEN_LAYER.groups ?? []) {
      for (const token of group.tokens ?? []) {
        const names = token.textRole === undefined ? [token.name] : textRoleDeclarations(token.textRole).map(({ value }) => value.slice('var('.length, -1))
        for (const name of names) {
          if (seen.has(name)) { fails.push(`contract/token-layer.json names ${name} twice`); continue }
          seen.add(name)
          const read = reads.get(name)
          if (declaredHere.has(name)) { fails.push(`contract/token-layer.json names ${name}, which the stylesheets declare themselves; it is not the runtime's to emit`); continue }
          if (!read) { fails.push(`contract/token-layer.json names ${name}, which neither a stylesheet nor a value the markup writes reads`); continue }
          const optional = read.withFallback === read.count
          if ((token.optional === true) !== optional) {
            fails.push(optional
              ? `${name} has a fallback at every read (${[...read.files].join(', ')}), so contract/token-layer.json marks it optional`
              : `contract/token-layer.json marks ${name} optional, but ${read.count - read.withFallback} of its ${read.count} read(s) have no fallback`)
          }
        }
      }
    }
    for (const [name, read] of [...reads].sort()) {
      if (!declaredHere.has(name) && !seen.has(name)) fails.push(`${[...read.files].join(', ')} read(s) ${name}, which contract/token-layer.json does not name`)
    }
  }

  // ── 4. The class vocabulary ─────────────────────────────────────────────────────────────────
  // A class the stylesheets style that no markup draws is a rule for nothing on one platform at
  // least, or a class the markup contract has yet to record. Classes are read where the markup puts
  // them on an element: a root, an element and its children, and a variant's tree. Not a rule's or a
  // note's mention, a platform's former name, a hook (kept with no rule) or an omitted class.
  const UNMARKED = [
    /* PENDING the view-body classes SC-007 gives the archive, post and service views (less the post's
       author block, which SC-008 makes the shared author-box), which a parallel branch adds to
       contract/markup/{archive,post,search,service}.json. views.css styles them now. Remove this block
       once both have merged: the gate fails on an entry the markup already carries. */
    ...['salt-archive__portrait', 'salt-archive__profile', 'salt-archive__strapline', 'salt-post__adjacent',
      'salt-post__adjacent-label', 'salt-post__breadcrumb', 'salt-post__byline', 'salt-post__category',
      'salt-post__footer', 'salt-post__media', 'salt-post__meta', 'salt-post__tags', 'salt-service__intro', 'salt-service__price-label',
      'salt-service__summary', 'salt-related__list'].map((name) => ({ class: name, pending: true, reason: 'SC-007 view body, pending its markup' })),
  ]
  const onElements = new Set()
  const collect = (node) => {
    if (Array.isArray(node)) { node.forEach(collect); return }
    if (!node || typeof node !== 'object') return
    for (const [key, value] of Object.entries(node)) {
      if (NOT_ELEMENTS.has(key)) continue
      if (key === 'classes' && Array.isArray(value)) value.forEach((name) => onElements.add(name))
      else collect(value)
    }
  }
  for (const file of markupFiles) collect(readJson(file))
  const styled = new Map()
  for (const [file, { rules }] of parsed) {
    for (const rule of rules) {
      for (const selector of rule.selectors) {
        // Attribute selectors are blanked: `[class*='salt-button']` names no class.
        for (const m of selector.replace(/\[[^\]]*\]/g, '').matchAll(/\.(salt-[\w-]+)/g)) {
          if (!styled.has(m[1])) styled.set(m[1], new Set())
          styled.get(m[1]).add(file)
        }
      }
    }
  }
  if (markupFiles.length === 0) fails.push('contract/markup/ holds no markup files, so no styled class can be found on an element')
  const unmarked = new Map(UNMARKED.map((entry) => [entry.class, entry]))
  for (const [name, files] of [...styled].sort()) {
    if (onElements.has(name) || unmarked.has(name)) continue
    fails.push(`${[...files].join(', ')} style(s) .${name}, which no element in contract/markup/ carries; add it to the markup or to UNMARKED with its reason`)
  }
  for (const entry of UNMARKED) {
    if (!styled.has(entry.class)) fails.push(`UNMARKED lists .${entry.class}, which no stylesheet styles; take it out`)
    else if (onElements.has(entry.class)) fails.push(`UNMARKED lists .${entry.class}, which contract/markup/ now carries; take it out${entry.pending ? ' (the pending view classes have landed)' : ''}`)
  }

  const named = [...reads.keys()].filter((name) => !declaredHere.has(name))
  return {
    fails,
    summary: `PASS: ${String(parsed.size)} stylesheet(s) parse whole; ${String(CONTRACTS.length)} decision contract(s) hold; ` +
      `the token layer names the ${String(named.length)} custom properties they and the markup read (${String(named.filter((n) => reads.get(n).withFallback === reads.get(n).count).length)} optional); ` +
      `${String(styled.size)} salt-* classes styled, ${String(UNMARKED.length)} of them listed in UNMARKED.`,
  }
}

/** The run as the command line reports it: each failure on a line of its own, or the summary. */
export function report(files) {
  const { fails, summary } = checkStylesheets(files)
  return fails.length > 0 ? { code: 1, output: fails.map((f) => `✗ ${f}`).join('\n') + '\n' } : { code: 0, output: `${summary}\n` }
}

/** The package's files from disk: its stylesheets and every contract file. */
export function readPackage(dir) {
  const files = new Map()
  const walk = (sub) => {
    const abs = path.join(dir, sub)
    if (!existsSync(abs)) return
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const rel = `${sub}/${entry.name}`
      if (entry.isDirectory()) walk(rel)
      else files.set(rel, readFileSync(path.join(dir, rel), 'utf8'))
    }
  }
  walk('styles')
  walk('contract')
  return files
}

/*
 * Whether this module is the script being run. Real paths, because a symlinked invocation names the
 * link, and comparing URLs then read as "imported", printed nothing and exited 0. The same check as
 * `isMainModule` in #5's `emit/_contract.mjs`; one copy once both have merged.
 */
const isMainModule = (moduleUrl) => {
  if (!process.argv[1]) return false
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(moduleUrl)) } catch { return false }
}

if (isMainModule(import.meta.url)) {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const { code, output } = report(readPackage(path.resolve(process.argv[2] ?? path.join(here, '..', 'salt-contract'))))
  process.stdout.write(output)
  process.exit(code)
}
