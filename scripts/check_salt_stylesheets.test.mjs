// Proves each check in check_salt_stylesheets.mjs can fail, on throwaway copies of the package.
// A gate that has never been seen to fail is not known to check anything.
//
// Ported from Salt for Next.js's verify-stylesheet-contracts.test.ts at 1472afdd with its types
// stripped. Its cases run through the `expect` and `itEach` adapters below, which keep vitest's
// spelling over node:assert, so each case reads as it did there. Cases for the five contracts that
// stayed in Salt for Next.js are gone; cases that mutated its theme.css now mutate the token layer.
// The last block holds the checks this gate added, and proves every contract has failed at least
// once in this file.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * The stylesheet contracts, run against stylesheets that are WRONG.
 *
 * ── Why this file exists, which is a defect it would have caught ────────────────
 *
 * `verify-stylesheet-contracts.ts` is the only `verify:*` gate in this repository with no
 * test of its own, and its comments record eight defeats found by editing the committed
 * stylesheets by hand and putting them back. WP6 unit 2 added a ninth class: its hero
 * contract asked `reachesAll(selector, ['.salt-hero'])`, which matches the bare class alone,
 * so `.salt-hero[data-media-side] { display: block }` — the selector shape that stylesheet
 * already uses three times — stopped every split hero being a grid, left `order: -1` applying
 * to nothing, and the gate exited 0. Five more spellings passed the same way.
 *
 * A contract nothing ever runs against a broken stylesheet is a contract whose failure path
 * has never executed. This repository's instructions say that when a class of finding turns
 * up twice, the third time is a gate script's job; this is that, one level up — the gate's own
 * failure paths are now a test's job rather than a reviewer's (BD-108).
 *
 * ── How it runs ─────────────────────────────────────────────────────────────────
 *
 * The stylesheets are copied to a temporary directory, one defect is applied to the copy, and
 * the gate is run against that copy through its test-only root argument. The committed files
 * are never written to, so a crashed run cannot leave the repository with a broken stylesheet
 * — which is exactly what the by-hand method risked every time it was used.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const GATE = path.join(HERE, 'check_salt_stylesheets.mjs')
const PACKAGE = path.resolve(HERE, '../salt-contract')
const { checkStylesheets, isMainModule, memoSize, readPackage, report } = await import(pathToFileURL(GATE).href)

/* vitest's spelling over node:assert, for the cases ported as they were written. */
const expect = (actual) => ({
  toBe: (expected) => assert.equal(actual, expected),
  toContain: (part) => assert.ok(actual.includes(part), `expected to contain:\n  ${String(part)}\nin:\n${String(actual)}`),
  toHaveLength: (length) => assert.equal(actual.length, length),
  not: {
    toContain: (part) => assert.ok(!actual.includes(part), `expected not to contain:\n  ${String(part)}\nin:\n${String(actual)}`),
    toMatch: (pattern) => assert.doesNotMatch(actual, pattern),
  },
})
/* `itEach(rows)(title, fn)`, with each `%s` in the title taking the next value in the row. */
const itEach = (rows) => (title, fn) => {
  for (const row of rows) {
    const values = Array.isArray(row) ? row : [row]
    let at = 0
    it(title.replace(/%s/g, () => String(values[at++])), () => fn(...values))
  }
}

let next = 0
/* Every contract's failure seen by any case, for the coverage case at the end. */
const failed = new Set()


/* The committed package, read once; each case edits a copy of this map in memory. */
const COMMITTED_FILES = readPackage(PACKAGE)

/* A stylesheet is named by its file, `blocks.css`; anything else by its path in the package. */
const target = (file) => (file.includes('/') ? file : `styles/${file}`)

/* The salt-* names in a package's stylesheets, read loosely: over-reading only registers more. */
const saltNames = (files) => new Set([...files].filter(([file]) => file.startsWith('styles/')).flatMap(([, text]) => [...text.matchAll(/\.(salt-[\w-]+)/g)].map((m) => m[1])))
const COMMITTED = saltNames(COMMITTED_FILES)

/**
 * The gate's outcome against a copy of the package with each edit applied: `[file, mutate]`, or a
 * function of the copy's file map, for a case that adds or removes a file.
 *
 * The ported cases write rules for classes no markup draws (`.salt-note`), to test a contract, not
 * the class vocabulary. So unless `raw`, every class a case invents (one the committed stylesheets
 * never name) is put on an element in a throwaway markup file in the copy, and the case sees the
 * contracts' verdict alone. The class vocabulary's own cases run raw.
 */
const runWith = (raw, edits) => {
  next += 1
  const files = new Map(COMMITTED_FILES)
  for (const edit of edits) {
    if (typeof edit === 'function') { edit(files); continue }
    const [file, mutate] = edit
    files.set(target(file), mutate(files.get(target(file))))
  }
  const invented = [...saltNames(files)].filter((name) => !COMMITTED.has(name))
  if (!raw && invented.length > 0) files.set('contract/markup/zz-invented.json', JSON.stringify({ elements: [{ classes: invented }] }))
  const { code, output } = report(files)
  for (const m of output.matchAll(/^✗ [\w.-]+\.css: (.+)$/gm)) failed.add(m[1])
  return { code, output }
}

const run = (...edits) => runWith(false, edits)
const runRaw = (...edits) => runWith(true, edits)

/** The gate's outcome against a copy of the package with `mutate` applied to one file. */
const gate = (file, mutate) => run([file, mutate])

/** The gate against a copy with two files mutated, for a defect that needs both halves. */
const gatePair = (first, mutateFirst, second, mutateSecond) => run([first, mutateFirst], [second, mutateSecond])

/** The token layer with one name taken out of its group. */
const withoutToken = (name) => (text) => {
  const layer = JSON.parse(text)
  for (const group of layer.groups) group.tokens = group.tokens.filter((token) => token.name !== name)
  return JSON.stringify(layer, null, 2)
}

/** Put `css` in front of the hero's image rule, which is the last rule in the file. */
const beforeHeroImage = (addition) => (css) => {
  const anchor = '.salt-hero__image {'
  expect(css.split(anchor)).toHaveLength(2)
  return css.replace(anchor, `${addition}\n${anchor}`)
}

const replacing = (from, to) => (css) => {
  expect(css.split(from)).toHaveLength(2)
  return css.replace(from, to)
}

/*
 * The theme toggle's floor, anchored on the declarations AFTER it as well. The drawer's
 * burger and close button (WP9 unit 3) carry the same two floor lines, so the floor alone is
 * three matches in `chrome.css` and `replacing` would refuse it; `padding: 0; background:
 * none;` straight after is the theme toggle's rule and nobody else's.
 */
const THEME_TOGGLE_FLOOR =
  '  min-inline-size: max(2.75rem, 24px);\n  min-block-size: max(2.75rem, 24px);\n  padding: 0;\n  background: none;'

/** A stylesheet's text, for a case that asserts what the committed file contains. */
const css = (root) => readFileSync(path.join(root, 'styles', 'blocks.css'), 'utf8')

const FLIP = ".salt-hero[data-media-side='left'] .salt-hero__media {\n  order: -1;\n}"
const BAND = '.salt-hero {\n  display: grid;\n  gap: 2rem;\n}'

describe('the gate passes the stylesheets this repository actually ships', () => {
  it('reports every contract intact against an unmodified copy', () => {
    const { code, output } = gate('blocks.css', (css) => css)
    expect(output).toContain('PASS: ')
    expect(code).toBe(0)
  })
})

/**
 * ── The hero's flip: the six spellings that defeated the first version ──────────
 *
 * Each one leaves a left-hand hero drawing its picture exactly where a right-hand one does,
 * so the editor's side toggle does nothing and the markup is byte-identical either way. Every
 * one of them passed the contract as first written.
 */
describe('a left-hand hero flips with a negative `order`', () => {
  itEach([
    [
      'an attribute-qualified `display` takes the grid away from every split',
      beforeHeroImage('.salt-hero[data-media-side] { display: block; }'),
    ],
    [
      'the same rule inside a media query',
      beforeHeroImage('@media (min-width: 48rem) { .salt-hero[data-media-side] { display: block; } }'),
    ],
    [
      'a `:where()` qualifier, which adds no specificity and so reads as harmless',
      beforeHeroImage('.salt-hero:where([data-variant]) { display: block; }'),
    ],
    [
      'a `flex-flow: row-reverse` rewrite that mirrors both variants alike',
      beforeHeroImage('.salt-hero[data-media-side] { display: flex; flex-flow: row-reverse; }'),
    ],
    [
      '`all: revert` on the media, which undoes the flip without the word `order`',
      beforeHeroImage('.salt-hero__media { all: revert; }'),
    ],
    [
      'an `[dir="rtl"]` rule, which takes the grid away in one writing direction',
      beforeHeroImage('[dir="rtl"] .salt-hero { display: block; }'),
    ],
  ])('fails when %s', (_case, mutate) => {
    const { code, output } = gate('blocks.css', mutate)
    expect(output).toContain('a left-hand hero flips')
    expect(code).toBe(1)
  })

  /* The five the contract was written against, kept so a rewrite cannot trade one set for
     the other. Each was proved by hand when the unit was built and is executable here. */
  itEach([
    ['the flip is deleted', replacing(FLIP, ".salt-hero[data-media-side='left'] .salt-hero__media {\n  color: inherit;\n}")],
    ['the flip points the wrong way', replacing(FLIP, ".salt-hero[data-media-side='left'] .salt-hero__media {\n  order: 1;\n}")],
    ['the flip is `!important`, which this contract cannot rank', replacing(FLIP, ".salt-hero[data-media-side='left'] .salt-hero__media {\n  order: -1 !important;\n}")],
    ['the band is not a formatting context `order` reaches', replacing(BAND, '.salt-hero {\n  display: block;\n  gap: 2rem;\n}')],
    ['a narrow viewport quietly undoes the flip', beforeHeroImage("@media (max-width: 48rem) { .salt-hero[data-media-side='left'] .salt-hero__media { order: 0; } }")],
  ])('fails when %s', (_case, mutate) => {
    const { code, output } = gate('blocks.css', mutate)
    expect(output).toContain('a left-hand hero flips')
    expect(code).toBe(1)
  })

  /**
   * The case that made the first version reach for `reachesAll` in the first place, kept as a
   * case so the fix cannot be undone by "simplifying" it back to a plain substring.
   * `.salt-hero__actions` is a flex row of its own and its `display` is not the band's; a
   * plain substring match reads it as a second declaration on the band and fails the
   * repository's own correct stylesheet.
   */
  it('passes the band’s own children declaring `display` for themselves', () => {
    const { output, code } = gate('blocks.css', (css) => css)
    expect(css(PACKAGE)).toContain('.salt-hero__actions {\n  display: flex;')
    expect(output).toContain('PASS: ')
    expect(code).toBe(0)
  })
})

/**
 * The mediaText flip, whose shape the hero's mirrors. One case rather than the full set: this
 * file is about the hero contract's own failure paths, and a contract that has stood since WP4
 * needs a regression guard rather than a sweep.
 */
describe('a right-hand media-and-text row flips with `order`', () => {
  it('fails when the flip is deleted', () => {
    const { code, output } = gate(
      'blocks.css',
      replacing(
        ".salt-media-text__row[data-media-side='right'] .salt-media-text__media {\n  order: 1;\n}",
        ".salt-media-text__row[data-media-side='right'] .salt-media-text__media {\n  color: inherit;\n}",
      ),
    )
    expect(output).toContain('a right-hand media-and-text row flips')
    expect(code).toBe(1)
  })
})

/**
 * ── The intro's margin reset, and the two ways to get its rank wrong ────────────
 *
 * The reset has to beat the user agent's paragraph margins and lose to `blocks.css`'s
 * `.salt-block > * + *`. Both halves are reachable and neither is visible in the selector's
 * text, which is why the contract reads specificity rather than spelling. The first two cases
 * are the bug this tranche shipped and the over-correction its review warned against; both
 * were measured in chrome-headless-shell 148.0.7778.96 before the contract was written.
 */
describe('the intro’s margin reset carries no specificity', () => {
  const RESET = ':where(.salt-intro) {\n  margin: 0;\n}'

  itEach([
    [
      'a bare class, which ties with the owl and lets the import order decide',
      replacing(RESET, '.salt-intro {\n  margin: 0;\n}'),
    ],
    [
      'the scoped selector, which outranks the owl and removes the gap in every order',
      replacing(RESET, '.salt-block > .salt-intro {\n  margin: 0;\n}'),
    ],
    [
      '`!important`, which beats the owl on origin whatever the selector weighs',
      replacing(RESET, ':where(.salt-intro) {\n  margin: 0 !important;\n}'),
    ],
    [
      'a second rule promoting the reset past the owl under another name',
      replacing(RESET, `${RESET}\n.salt-intro {\n  margin-block-start: 0;\n}`),
    ],
    [
      'a media query promoting it at one viewport, which no unconditional read would see',
      replacing(RESET, `${RESET}\n@media (min-width: 48rem) {\n  .salt-intro {\n  margin-top: 0;\n}\n}`),
    ],
    [
      '`all: revert` at a weight that outranks the owl, which resets the margin without the word',
      replacing(RESET, `${RESET}\n.salt-block > .salt-intro {\n  all: revert;\n}`),
    ],
    [
      'the reset deleted outright, leaving the user agent’s paragraph margins in place',
      replacing(RESET, ':where(.salt-intro) {\n  color: inherit;\n}'),
    ],
    [
      'the reset moved inside a media query, which is not a reset',
      replacing(RESET, '@media (min-width: 48rem) {\n:where(.salt-intro) {\n  margin: 0;\n}\n}'),
    ],
    /*
     * The weight is right and the value is not. The owl sets `margin-block-start` alone, so it
     * opposes nothing written BELOW the introduction: these three each leave the gap above
     * intact and put space underneath that no other rule takes back, at a specificity the
     * weight half of this contract is happy with. Found by the re-review of the commit that
     * added the contract, which ran the first of them green.
     */
    [
      'the reset is weightless but sets a real length, which nothing opposes below',
      replacing(RESET, ':where(.salt-intro) {\n  margin: 3rem;\n}'),
    ],
    [
      'a weightless second rule adds space beneath the introduction alone',
      replacing(RESET, `${RESET}\n:where(.salt-intro) {\n  margin-block-end: 1rem;\n}`),
    ],
    [
      'the reset is `margin: 0 auto`, which is a centring rule rather than a reset',
      replacing(RESET, ':where(.salt-intro) {\n  margin: 0 auto;\n}'),
    ],
  ])('fails when %s', (_case, mutate) => {
    const { code, output } = gate('primitives.css', mutate)
    expect(output).toContain('margin reset carries no specificity')
    expect(code).toBe(1)
  })

  /**
   * `!important` is ranked BEFORE specificity, and the message has to say so. A contract that
   * compared weights first would report `:where()` as passing on a declaration that beats the
   * owl outright — the false-claim shape this repository has shipped six times, each one
   * sending somebody to undo correct CSS.
   */
  it('names `!important` rather than the specificity when both could be reported', () => {
    const { output } = gate(
      'primitives.css',
      replacing(RESET, '.salt-block > .salt-intro {\n  margin: 0 !important;\n}'),
    )
    expect(output).toContain('!important')
    expect(output).not.toContain('specificity (0,2,0)')
  })

  /**
   * `all` is the third verdict: a spelling the contract cannot rank, reported as such rather
   * than as "not zero". `all: revert` at no specificity survives the weight check and hands
   * the introduction back the user agent's paragraph margins — the one thing the rule exists
   * to remove — so a message telling its author the value is wrong would send them to write
   * `all: 0`.
   */
  it('refuses `all` by name rather than reporting it as a non-zero value', () => {
    const { code, output } = gate(
      'primitives.css',
      replacing(RESET, ':where(.salt-intro) {\n  all: revert;\n}'),
    )
    expect(output).toContain('cannot rank as a margin reset')
    expect(code).toBe(1)
  })

  /* Zero in another spelling is still zero. `px()` reads px and unitless zero only, and a
     contract keyed on it would report `margin: 0rem` as a defect and tell its author to undo
     a correct declaration — the false-claim shape this file already records twice. */
  it('passes a reset written as `0rem` rather than `0`', () => {
    const { code, output } = gate(
      'primitives.css',
      replacing(RESET, ':where(.salt-intro) {\n  margin: 0rem;\n}'),
    )
    expect(output).toContain('PASS: ')
    expect(code).toBe(0)
  })

  /**
   * A negation MENTIONS the class without reaching it: `:not(.salt-intro)` is every other
   * element, and reading it as a rule on the introduction would fail a correct stylesheet.
   * Both directions of that mistake are already in this gate's history.
   */
  it('passes a rule that merely names the class inside a negation', () => {
    const { code, output } = gate(
      'primitives.css',
      replacing(RESET, `${RESET}\n.salt-block > p:not(.salt-intro) {\n  margin: 2rem;\n}`),
    )
    expect(output).toContain('PASS: ')
    expect(code).toBe(0)
  })

  /* The rename the contract must NOT fail on: the guarantee is the weight, not the spelling. */
  it('passes the reset wrapped in `:where()` however the selector inside it is written', () => {
    const { code, output } = gate(
      'primitives.css',
      replacing(RESET, ':where(.salt-block .salt-intro, .salt-intro) {\n  margin: 0;\n}'),
    )
    expect(output).toContain('PASS: ')
    expect(code).toBe(0)
  })
})

/**
 * ── The ancestor mark, which must not draw on the current page ──────────────────
 *
 * A group page relinked at the top of its own submenu is the current page AND an ancestor of
 * it, so both rules match one element. The ancestor rule is the heavier of the two, so without
 * an exclusion it wins and paints the dotted ancestor treatment on an element announcing
 * `aria-current="page"` — what is drawn contradicting what is said.
 *
 * The exclusion was written, was correct, and nothing executed it: deleting it left the whole
 * suite green, which is the third time in this unit a real fix rested on a comment. The cases
 * below are the ones that distinguish reading the CONDITION from reading the text.
 */
const ANCESTOR = ".salt-nav__item[data-current-section] > .salt-nav__link:not([aria-current='page'])"

describe('the ancestor mark cannot draw on the element that IS the current page', () => {
  it('fails when the exclusion is deleted', () => {
    const { code, output } = gate(
      'chrome.css',
      replacing(ANCESTOR, '.salt-nav__item[data-current-section] > .salt-nav__link'),
    )
    expect(output).toContain('does not exclude it')
    expect(output).toContain('(0,3,0)')
    expect(code).toBe(1)
  })

  /*
   * Spelt differently, meaning the same. A contract keyed on the text would fail all three,
   * and the whole selector is replaced rather than the exclusion alone because the file's own
   * comment quotes the exclusion — so the short string is not unique in it.
   */
  itEach([
    ['double quotes', ':not([aria-current="page"])'],
    ['no quotes', ':not([aria-current=page])'],
    ['a space inside the brackets', ":not([ aria-current='page' ])"],
  ])('passes when the exclusion is written with %s', (_case, exclusion) => {
    const { code, output } = gate(
      'chrome.css',
      replacing(ANCESTOR, `.salt-nav__item[data-current-section] > .salt-nav__link${exclusion}`),
    )
    expect(output).toContain('PASS: ')
    expect(code).toBe(0)
  })

  /**
   * The other way to satisfy it, and the gate has to accept it: a rule that cannot win needs
   * no exclusion. `:where()` carries no weight, so this ancestor selector is lighter than the
   * current-page one and loses the cascade on its own.
   */
  it('passes when the ancestor rule is too light to win instead', () => {
    const { code, output } = gate(
      'chrome.css',
      replacing(ANCESTOR, ':where(.salt-nav__item[data-current-section]) > .salt-nav__link'),
    )
    expect(output).toContain('PASS: ')
    expect(code).toBe(0)
  })

  /* Vacuity: a contract satisfied by finding nothing is satisfied by the feature's removal. */
  it('fails when nothing draws an ancestor mark at all', () => {
    const { code, output } = gate('chrome.css', (source) =>
      source.replace(new RegExp(`${ANCESTOR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[^}]*\\}`), ''),
    )
    expect(output).toContain('no rule draws an ancestor mark at all')
    expect(code).toBe(1)
  })

  /**
   * A shape the reader cannot rank is refused rather than guessed at.
   *
   * NOT `:nth-child(2n of .x)`, which an earlier version of this case used: the shared reader
   * ranks that correctly at class weight plus its argument's, so refusing it would be a false
   * refusal of the same kind as the presence-only exclusion below. The refusals are the
   * malformed shapes — a bracket or a group that never closes, and a character that is
   * neither a combinator nor the start of a name.
   */
  itEach([
    ['an attribute selector that never closes', '.salt-nav__link[aria-current'],
    ['a functional pseudo-class that never closes', '.salt-nav__link:not([aria-current]'],
    ['a character it does not recognise', '.salt-nav__link % .x'],
  ])('refuses %s rather than ranking it short', (_case, broken) => {
    const { code, output } = gate(
      'chrome.css',
      replacing(ANCESTOR, `.salt-nav__item[data-current-section] > ${broken}`),
    )
    expect(output).toContain('no contract here can rank')
    expect(code).toBe(1)
  })

  /**
   * ── The three the re-review found, all of which passed the first version ───────
   */

  /**
   * The exclusion moved one compound to the left. It reads as "an item that is a section
   * ancestor but is not itself current", which sounds correct — and excludes nothing, because
   * a list item never carries `aria-current`. The rule still matches, still ranks (0,4,0)
   * against (0,2,0), still wins, and still paints the ancestor mark over the current page.
   *
   * The first version collected every `:not()` in the whole selector, so it reported the
   * contract intact over the exact defect it exists for. This is the plausible wrong edit —
   * a rearrangement of something still present — rather than the obvious absent one.
   */
  it('fails when the exclusion is moved off the element being drawn', () => {
    const { code, output } = gate(
      'chrome.css',
      replacing(
        ANCESTOR,
        ".salt-nav__item[data-current-section]:not([aria-current='page']) > .salt-nav__link",
      ),
    )
    expect(output).toContain('does not exclude it')
    expect(code).toBe(1)
  })

  /**
   * A presence-only exclusion DOES exclude: every element carrying the attribute, which is a
   * superset of those carrying `page`. Refusing it said "does not exclude it", which is false
   * and would send somebody hunting a defect that is not there.
   */
  it('passes when the exclusion tests for the attribute rather than its value', () => {
    const { code, output } = gate(
      'chrome.css',
      replacing(ANCESTOR, '.salt-nav__item[data-current-section] > .salt-nav__link:not([aria-current])'),
    )
    expect(output).toContain('PASS: ')
    expect(code).toBe(0)
  })

  /**
   * A current-page rule written without a class named no class in its key compound, so the
   * contention test — which compared classes alone — found nothing shared and dropped the
   * pair. Two edits deep, and the contract stopped looking at the conflict entirely.
   */
  it('fails when a current-page rule names no class and the ancestor rule still outranks it', () => {
    const { code, output } = gate('chrome.css', (source) =>
      replacing(ANCESTOR, '.salt-nav__item[data-current-section] > .salt-nav__link')(
        replacing(
          ".salt-nav__link[aria-current='page'],",
          "[aria-current='page'],",
        )(source),
      ),
    )
    expect(output).toContain('does not exclude it')
    expect(code).toBe(1)
  })
})

/**
 * The mount-gated toggles' hit-area floor (WP9 unit 4).
 *
 * The cases that matter are the ones where the rule is still there and still reads as
 * correct: `button.salt-theme-toggle { min-inline-size: … }` is a tidier-looking spelling of
 * exactly the same declaration, it satisfies WCAG 2.5.8 for the control that ships, and it
 * collapses the box the server reserves — so hydration moves every item in the header. That
 * is the preamble's rule about testing the plausible WRONG edit rather than the obvious
 * absent one, and it is why the deletion case below is the least interesting of the four.
 */
describe('a mount-gated toggle’s hit-area floor reaches the placeholder', () => {
  itEach([
    [
      'the theme toggle’s floor is qualified by the element type',
      replacing('.salt-theme-toggle {\n  display', 'button.salt-theme-toggle {\n  display'),
    ],
    [
      'the submenu toggle’s floor is qualified by the element type',
      replacing('.salt-nav__toggle {\n  min-inline-size', 'button.salt-nav__toggle {\n  min-inline-size'),
    ],
  ])('fails when %s', (_case, mutate) => {
    const { code, output } = gate('chrome.css', mutate)
    expect(output).toContain('through the element type `button`')
    expect(code).toBe(1)
  })

  /* The other shape of the same move: still present, still a floor, now conditional on a
     state the `<span>` has no way to be in. */
  it('fails when the floor is given only to the hydrated state', () => {
    const { code, output } = gate(
      'chrome.css',
      replacing('.salt-theme-toggle {\n  display', '.salt-theme-toggle[aria-pressed] {\n  display'),
    )
    expect(output).toContain('cannot carry')
    expect(code).toBe(1)
  })

  /* A floor that only applies above a breakpoint is not a floor, and the header is narrowest
     where a thumb is the input. */
  it('fails when the floor is moved inside a media query', () => {
    const { code, output } = gate('chrome.css', (source) =>
      replacing(
        '.salt-theme-toggle {\n  display: inline-flex;',
        '@media (min-width: 40rem) {\n.salt-theme-toggle {\n  display: inline-flex;',
      )(source).replace('button.salt-theme-toggle {', '}\nbutton.salt-theme-toggle {'),
    )
    expect(output).toContain('no unconditional rule gives `.salt-theme-toggle` a minimum size')
    expect(code).toBe(1)
  })

  /* Vacuity: a contract satisfied by finding nothing is satisfied by the feature's removal. */
  it('fails when the floor is deleted outright', () => {
    const { code, output } = gate(
      'chrome.css',
      replacing(THEME_TOGGLE_FLOOR, '  padding: 0;\n  background: none;'),
    )
    expect(output).toContain('no unconditional rule gives `.salt-theme-toggle` a minimum size')
    expect(code).toBe(1)
  })

  /* And the shapes it must NOT refuse: a grouped selector, and the two axis spellings.
     An ancestor-scoped one was on this list and is NOT any more — it is refused, deliberately
     and on a measurement, and the describe below this one holds that. */
  itEach([
    ['grouped with another control', replacing('.salt-theme-toggle {\n  display', '.salt-nav__spacer,\n.salt-theme-toggle {\n  display')],
    ['written in physical properties', replacing(THEME_TOGGLE_FLOOR, '  min-width: max(2.75rem, 24px);\n  min-height: max(2.75rem, 24px);\n  padding: 0;\n  background: none;')],
    /* The reset spelling this repository already uses (`:where(.salt-intro)` in
       `sections.css`). It weighs nothing and it matches exactly the same elements, so the
       placeholder carries it perfectly well — the condition test must not read the `:` in it
       as a condition. */
    ['wrapped in `:where()`', replacing('.salt-theme-toggle {\n  display', ':where(.salt-theme-toggle) {\n  display')],
    ['wrapped in `:is()`', replacing('.salt-theme-toggle {\n  display', ':is(.salt-theme-toggle) {\n  display')],
  ])('passes when the floor is %s', (_case, mutate) => {
    const { code, output } = gate('chrome.css', mutate)
    expect(output).toContain('PASS: ')
    expect(code).toBe(0)
  })
})

/**
 * The same toggles' hit-area VALUE (WP9 unit 4, review round 1).
 *
 * The first version of the contract above pinned the selector and not the number: both
 * `min-inline-size: 1rem` and `0.5rem` exited 0 against a contract whose stated subject is
 * "a mount-gated toggle's hit-area floor". The sibling contract in `primitives.css` had
 * refused a bare rem floor on `.salt-button` for years, for the stated reason that a
 * root-size change breaches 24px — and the two icon-only controls, the shape most at risk
 * under 2.5.8, sat outside it.
 */
describe('a mount-gated toggle’s hit-area floor is pinned to CSS pixels', () => {
  itEach([
    [
      'a bare rem floor on the theme toggle',
      replacing(THEME_TOGGLE_FLOOR, '  min-inline-size: 2.75rem;\n  min-block-size: max(2.75rem, 24px);\n  padding: 0;\n  background: none;'),
      'with no px floor',
    ],
    [
      'a bare rem floor on the submenu toggle',
      replacing('.salt-nav__toggle {\n  min-inline-size: max(2.75rem, 24px);', '.salt-nav__toggle {\n  min-inline-size: 2.75rem;'),
      'with no px floor',
    ],
    /* The header tightened to a 32px control, which is an ordinary later edit and reads as a
       design change rather than as an accessibility one. At a 10px root that is a 20px
       target. */
    [
      'a floor whose px half never reaches 24',
      replacing(THEME_TOGGLE_FLOOR, '  min-inline-size: max(2rem, 20px);\n  min-block-size: max(2.75rem, 24px);\n  padding: 0;\n  background: none;'),
      'never reaches 24 CSS px',
    ],
    /* The same-block cancellation the `.salt-button` contract records being caught by twice:
       both spellings set one used value and the later one wins, so reading the first match
       sees only the good half. */
    [
      'a second spelling of the axis cancelling the floor in the same block',
      replacing(THEME_TOGGLE_FLOOR, '  min-inline-size: max(2.75rem, 24px);\n  min-block-size: max(2.75rem, 24px);\n  min-height: 2rem;\n  padding: 0;\n  background: none;'),
      'with no px floor',
    ],
    /* The shared rule the menu links and the submenu toggle sit in together. Its floor is the
       toggle's block floor, and it is as easy to retune as any other length here. */
    [
      'a bare rem floor on the rule the submenu toggle shares with the links',
      replacing('  min-block-size: max(2.75rem, 24px);\n  padding-inline: 0.75rem;', '  min-block-size: 2.75rem;\n  padding-inline: 0.75rem;'),
      'with no px floor',
    ],
  ])('fails on %s', (_case, mutate, message) => {
    const { code, output } = gate('chrome.css', mutate)
    expect(output).toContain(message)
    expect(code).toBe(1)
  })
})

/**
 * `color-scheme` follows `data-theme` (WP9 unit 4, review round 1).
 *
 * This pair is what made it safe to DELETE the example app's `color-scheme: light` pin rather
 * than move it, and the comment beside the pair claimed this gate held it. It did not:
 * `color-scheme` appeared nowhere in `scripts/`, and all four of the mutations below exited 0
 * with "Stylesheet contracts intact".
 *
 * The order case is the one that would never have been written from the obvious-absence
 * habit. Both selectors are (0,1,0), so the dark rule wins by source order alone; swapping
 * the two blocks is a tidy-up that keeps every declaration, every value and every selector
 * intact and takes the dark canvas away.
 */
const SCHEME_PAIR =
  ":root {\n  color-scheme: light;\n}\n\n[data-theme='dark'] {\n  color-scheme: dark;\n}"

describe('the UA’s own palette follows `data-theme`', () => {
  itEach([
    [
      '`:root` hands the canvas back to the operating system',
      replacing(':root {\n  color-scheme: light;\n}', ':root {\n  color-scheme: light dark;\n}'),
      'follow the operating system',
    ],
    [
      'the dark half is deleted',
      replacing("\n\n[data-theme='dark'] {\n  color-scheme: dark;\n}", ''),
      'nothing declares `color-scheme` on `[data-theme=\'dark\']`',
    ],
    [
      'the light half is deleted',
      replacing(':root {\n  color-scheme: light;\n}\n\n', ''),
      'nothing declares `color-scheme` on `:root`',
    ],
    [
      'the pair is deleted outright',
      replacing(`${SCHEME_PAIR}\n\n`, ''),
      'nothing declares `color-scheme` on `:root`',
    ],
    [
      'the two blocks are swapped',
      replacing(
        SCHEME_PAIR,
        "[data-theme='dark'] {\n  color-scheme: dark;\n}\n\n:root {\n  color-scheme: light;\n}",
      ),
      'does not select the dark theme',
    ],
    [
      'the dark half is set to light',
      replacing("[data-theme='dark'] {\n  color-scheme: dark;\n}", "[data-theme='dark'] {\n  color-scheme: light;\n}"),
      'a canvas that is not dark',
    ],
    /* A floor, a ring or a canvas that only applies above a breakpoint is not one. */
    [
      'the light half is moved inside a media query',
      replacing(
        ':root {\n  color-scheme: light;\n}',
        '@media (min-width: 40rem) {\n:root {\n  color-scheme: light;\n}\n}',
      ),
      'only inside',
    ],
  ])('fails when %s', (_case, mutate, message) => {
    const { code, output } = gate('primitives.css', mutate)
    expect(output).toContain(message)
    expect(code).toBe(1)
  })

  /**
   * The four that defeated the FIRST repair, every one of them leaving a document carrying
   * `data-theme="dark"` computing `color-scheme: light`.
   *
   * Two are plain APPENDS that do not disturb a single existing character, and one of those
   * — re-adding `:root { color-scheme: light }` — is a one-line "restore the pin" edit
   * against the exact declaration this unit deleted from the example app's scaffold. The
   * `:where()` one is made likelier by this same branch, which legitimises `:where()` as the
   * repository's reset spelling in the sibling contract twenty lines up.
   *
   * ── The browser comparison, and what it is ─────────────────────────────────────
   *
   * Each gate verdict here was checked against headless Chromium 148.0.7778.96 on
   * 22/09/2026, reading `getComputedStyle(document.documentElement).colorScheme` on a
   * `<html data-theme="dark">` document carrying the mutated stylesheet. Eight cases, gate
   * and browser agreeing on all eight — including `html { color-scheme: light }` appended,
   * which the gate passes and the browser computes `dark`, because `html` is (0,0,1) and
   * loses to the attribute's (0,1,0) whatever the order.
   *
   * **That comparison was run BY HAND, once, and this is the record of it. Nothing below
   * runs a browser.** These cases assert the gate's exit code and nothing else, so an edit to
   * the resolver that changes a verdict is caught by them only where the expected verdict
   * here is the one that changes. Standing the comparison up as a fixture needs the WP13 DOM
   * harness, which is where a contract that wants to prove a rule APPLIES belongs; until
   * then this paragraph is the evidence and its date is part of it.
   *
   * It covers the RANKING verdicts only. The refusal cases further down were not compared
   * against a browser and two of them deliberately disagree with one — a declaration the
   * contract cannot rank is refused even where the browser happens to resolve it the way the
   * pair intends, because a verdict reached by luck is worth no more than a wrong one.
   */
  itEach([
    [
      'the dark block is wrapped in `:where()` and left second',
      replacing("[data-theme='dark'] {\n  color-scheme: dark;", ":where([data-theme='dark']) {\n  color-scheme: dark;"),
    ],
    [
      'a second `:root { color-scheme: light }` is appended after the pair',
      replacing(SCHEME_PAIR, `${SCHEME_PAIR}\n\n:root {\n  color-scheme: light;\n}`),
    ],
    [
      "a second `[data-theme='dark']` block declaring light is appended",
      replacing(SCHEME_PAIR, `${SCHEME_PAIR}\n\n[data-theme='dark'] {\n  color-scheme: light;\n}`),
    ],
    /* The group is the point: `#salt-admin` is (1,0,0) and reads as the rule's weight, but
       the selector that MATCHES the attribute is (0,1,0) and ties with `:root`, which comes
       later. Weighing the first selector of the group is what passed this. */
    [
      'the dark selector is grouped with a heavier one and moved first',
      replacing(
        SCHEME_PAIR,
        "#salt-admin,\n[data-theme='dark'] {\n  color-scheme: dark;\n}\n\n:root {\n  color-scheme: light;\n}",
      ),
    ],
    /* The same append shape, carrying the original wrong value rather than a plain light. */
    [
      'a second `:root` block hands the canvas back to the operating system',
      replacing(SCHEME_PAIR, `${SCHEME_PAIR}\n\n:root {\n  color-scheme: light dark;\n}`),
    ],
  ])('fails when %s', (_case, mutate) => {
    const { code } = gate('primitives.css', mutate)
    expect(code).toBe(1)
  })

  /* And the spellings it must not refuse. An unquoted attribute value is valid CSS and
     identical in meaning; `html[data-theme='dark']` is (0,1,1), so it OUTRANKS `:root` and
     order stops deciding, which the contract has to allow for rather than trip over; and a
     bare `html` block is (0,0,1), which LOSES to the attribute's (0,1,0) whatever the order,
     so appending one takes nothing away. All three confirmed dark in the browser. */
  itEach([
    [
      'the attribute value is unquoted',
      replacing("[data-theme='dark'] {\n  color-scheme: dark;", '[data-theme=dark] {\n  color-scheme: dark;'),
    ],
    [
      'the dark half outranks `:root` and comes first',
      replacing(
        SCHEME_PAIR,
        "html[data-theme='dark'] {\n  color-scheme: dark;\n}\n\n:root {\n  color-scheme: light;\n}",
      ),
    ],
    [
      'a bare `html` block is appended, which the attribute outranks',
      replacing(SCHEME_PAIR, `${SCHEME_PAIR}\n\nhtml {\n  color-scheme: light;\n}`),
    ],
  ])('passes when %s', (_case, mutate) => {
    const { code, output } = gate('primitives.css', mutate)
    expect(output).toContain('PASS: ')
    expect(code).toBe(0)
  })
})

/**
 * The regression the `:where()` allowance introduced, and the shape of it (WP9 unit 4,
 * review round 2).
 *
 * Unwrapping `:is(X)`/`:where(X)` WHEREVER it appeared rested on "`:where(X)` and `X` match
 * the same elements". True of the leading position and false of every other one: in any
 * other position the pseudo-class NARROWS the compound, and splicing its argument into the
 * neighbouring text hid the narrowing rather than exposing it. `.salt-theme-toggle:where(
 * button)` came out as `.salt-theme-togglebutton`, in which `compoundType` — anchored at the
 * start — finds no element type, and no `[` or `:` survives for the condition test.
 *
 * Three mutations passed at exit 0 because of it, every one the collapsed-placeholder edit
 * this contract exists to refuse. `button:where(.salt-theme-toggle)` was still caught, which
 * is what made it easy to miss: the spelling that reads as obviously wrong was refused and
 * the spelling that reads as tidy was not. And `:where(button)` is the MORE attractive way
 * to write that edit than bare `button`, because it qualifies without raising specificity.
 *
 * Measured in headless Chromium 148.0.7778.96 on 22/09/2026: the server's
 * `<span class="salt-theme-toggle" aria-hidden="true">` is 44.00 x 44.00 under the committed
 * rule and 0.00 x 18.00 under `.salt-theme-toggle:where(button)`.
 */
describe('a functional pseudo-class cannot smuggle a narrowing past the hit-area contract', () => {
  itEach([
    ['`:where(button)`', '.salt-theme-toggle:where(button)'],
    ['`:is(button)`', '.salt-theme-toggle:is(button)'],
    ['a state class in `:where()`', '.salt-theme-toggle:where(.is-mounted)'],
    ['an attribute in `:where()`', '.salt-theme-toggle:where([aria-pressed])'],
    ['two groups in a row', '.salt-theme-toggle:where(button):where(.is-mounted)'],
    ['the class wrapped and the type left bare', 'button:where(.salt-theme-toggle)'],
    ['the class wrapped and the type wrapped separately', ':where(.salt-theme-toggle):is(button)'],
    /* Refused as UNRANKABLE rather than as wrong. The placeholder does carry the first
       argument, so this particular selector would floor it perfectly well — but a
       multi-argument group is a different set of elements from any one of its arguments, and
       nothing here decides which argument was meant. The safe direction. */
    ['a multi-argument group, which this cannot rank', ':is(.salt-theme-toggle, .salt-nav__spacer)'],
    /* Same direction, and a genuine false failure: the browser measures
       `:where(:where(.salt-theme-toggle))` at 44.00 x 44.00. `[^()]*` refuses a nested group
       rather than recursing into it, which costs a spelling nobody writes and buys the
       greedy-read defence. */
    ['a nested group, which the unwrap refuses to recurse into', ':where(:where(.salt-theme-toggle))'],
  ])('fails on %s', (_case, selector) => {
    const { code } = gate(
      'chrome.css',
      replacing('.salt-theme-toggle {\n  display', `${selector} {\n  display`),
    )
    expect(code).toBe(1)
  })
})

/**
 * A floor the class only gets somewhere (WP9 unit 4, review round 3).
 *
 * Pre-existing rather than introduced by the rounds above, and the same failure they
 * repaired: the rule is still there, still reads as correct out loud, and the placeholder
 * collapses. "Scope the floor to the nav" is a tidier-looking edit than any pseudo-class
 * spelling, and in the header's real shape it is wrong — the toggle is a SIBLING of
 * `.salt-nav`, inside `.salt-header__inner`.
 *
 * Measured in the real markup, headless Chromium 148.0.7778.96, 22/09/2026: the committed
 * rule gives the server's placeholder 44.00 x 44.00, and both `.salt-nav .salt-theme-toggle`
 * and `.salt-nav > .salt-theme-toggle` give it 20.00 x 24.00.
 *
 * An ancestor that genuinely does contain the toggle is refused as well. Nothing here can
 * know which ancestors are real, and a floor that depends on where the control is mounted
 * stops being a floor the moment somebody moves it.
 */
describe('a mount-gated toggle’s floor has to be on the class itself', () => {
  itEach([
    ['a descendant of the nav, which the toggle is not', '.salt-nav .salt-theme-toggle'],
    ['a child of the nav, which the toggle is not', '.salt-nav > .salt-theme-toggle'],
    ['a descendant of an ancestor that IS real', '.salt-header__inner .salt-theme-toggle'],
    ['an ancestor plus a wrapped class', '.salt-header__inner > :where(.salt-theme-toggle)'],
    /* A SIBLING combinator, which `hasCombinator` catches as well — and the reason the
       message says "position" rather than "ancestor". There is no ancestor in this one, and
       an author sent looking for a containment problem that is not there is an author being
       sent to undo the wrong thing. */
    ['an adjacent sibling, where no ancestor is involved at all', '.salt-nav__spacer + .salt-theme-toggle'],
  ])('fails on %s', (_case, selector) => {
    const { code, output } = gate(
      'chrome.css',
      replacing('.salt-theme-toggle {\n  display', `${selector} {\n  display`),
    )
    /* The position wording and not only the tail both messages shared: the old "only where an
       ancestor matches" text also ended "the floor has to be on the class itself", so asserting
       the tail alone passed with the message this case exists to keep out. */
    expect(output).toContain('its floor only in a particular position')
    expect(output).toContain('the floor has to be on the class itself')
    expect(code).toBe(1)
  })
})

/**
 * What the `color-scheme` resolver refuses to rank (WP9 unit 4, review round 3).
 *
 * It weighs specificity and breaks ties on source order. The real cascade puts LAYER ORDER
 * above both and IMPORTANCE above that, and the version that tried to rank them anyway was
 * walked past twice, measured on a `data-theme="dark"` document computing `light`:
 *
 *   dark rule inside `@layer theme`, `:root` left unlayered  — gate 0, browser light
 *   both layered, `@layer dark, base;` declaring dark first   — gate 0, browser light
 *
 * An unlayered declaration beats every layered one whatever its weight, which is the whole
 * point of layers and the thing a specificity comparison cannot see. `!important` was noise
 * in both directions: three important spellings were caught only because the VALUE test
 * trips on the string `light !important`, while `dark !important` placed first was reported
 * as a failure although the browser gives `dark`.
 *
 * Refused rather than modelled. Growing a cascade engine inside a gate script is the wrong
 * trade; a refusal is loud, correct, and costs whoever starts layering these stylesheets one
 * conversation about whether `color-scheme` still resolves the way the contract says.
 */
/* Since #190's re-review the parse allows `@media` alone, so each layered case below now fails at that
   allowlist, naming `@layer`, before the resolver is reached. The resolver's own refusal stays as the
   second line of defence if `@layer` is ever allowed. */
describe('the `color-scheme` resolver refuses what it cannot rank', () => {
  itEach([
    [
      'the dark rule is moved inside a layer',
      replacing(
        "[data-theme='dark'] {\n  color-scheme: dark;\n}",
        "@layer theme {\n[data-theme='dark'] {\n  color-scheme: dark;\n}\n}",
      ),
      'an at-rule this gate does not read',
    ],
    [
      'both rules are layered and the layer order is declared',
      replacing(
        SCHEME_PAIR,
        "@layer dark, base;\n\n@layer base {\n:root {\n  color-scheme: light;\n}\n}\n\n@layer dark {\n[data-theme='dark'] {\n  color-scheme: dark;\n}\n}",
      ),
      'an at-rule this gate does not read',
    ],
    [
      'only the light rule is layered',
      replacing(
        ':root {\n  color-scheme: light;\n}',
        '@layer base {\n:root {\n  color-scheme: light;\n}\n}',
      ),
      'an at-rule this gate does not read',
    ],
    /* Refused although the browser resolves this one to `dark`. The contract cannot say so
       for the right reason, and a verdict reached by accident is worth no more than a wrong
       one — this spelling was previously reported as a FAILURE, which was also luck. */
    [
      'the dark rule is marked important and placed first',
      replacing(
        SCHEME_PAIR,
        "[data-theme='dark'] {\n  color-scheme: dark !important;\n}\n\n:root {\n  color-scheme: light;\n}",
      ),
      'importance beats both',
    ],
    [
      'the light rule is marked important',
      replacing(':root {\n  color-scheme: light;', ':root {\n  color-scheme: light !important;'),
      'importance beats both',
    ],
  ])('refuses to rank %s', (_case, mutate, message) => {
    const { code, output } = gate('primitives.css', mutate)
    expect(output).toContain(message)
    expect(code).toBe(1)
  })
})

/**
 * The logo is the header row's give (WP9 unit 4, after the rebase over the phone drawer).
 *
 * The contract fixes one spelling of each governed property in one rule keyed on each element's
 * own class, and refuses every other spelling and every other place. Every case below was a
 * wrong edit that some version of this contract let through, or the plausible one beside it;
 * the lettered ones (A to E) are the second re-review's, each reproduced in Chrome 148 on
 * 22/09/2026 with the page scrolling sideways, the logo drawing over the controls, the logo
 * collapsing to nothing, or — for E — a correct spelling refused with a false reason.
 */
const LOGO_SHRINK = '  flex: 0 1 auto;\n  min-inline-size: 0;\n'
const WORDMARK_WRAP = '  overflow-wrap: anywhere;\n'
const IMAGE_FIT = '  object-fit: contain;\n'
const appending = (addition) => (css) => `${css}\n${addition}\n`

describe('the logo gives way when the header row runs out of room', () => {
  itEach([
    /* The first round's cases, each still refused. */
    ['the logo is put back to `flex: none`', 'chrome.css', replacing(LOGO_SHRINK, '  flex: none;\n  min-inline-size: 0;\n'), 'spell it as `flex: 0 1 auto` in the `.salt-logo` rule'],
    ['a later `flex-shrink: 0` joins the shorthand', 'chrome.css', replacing(LOGO_SHRINK, `${LOGO_SHRINK}  flex-shrink: 0;\n`), 'declares `flex-shrink`, which this contract does not accept there'],
    [
      'the floor is moved onto the row',
      'chrome.css',
      (css) =>
        replacing('  min-block-size: 4rem;\n}', '  min-block-size: 4rem;\n  min-inline-size: 0;\n}')(replacing(LOGO_SHRINK, '  flex: 0 1 auto;\n')(css)),
      '`.salt-logo` does not declare `min-inline-size`',
    ],
    ['the floor is `auto`', 'chrome.css', replacing(LOGO_SHRINK, '  flex: 0 1 auto;\n  min-inline-size: auto;\n'), 'spell it as `min-inline-size: 0`'],
    ['a phone-only rule puts `flex: none` back', 'chrome.css', replacing('@media (max-width: 48rem) {\n', '@media (max-width: 48rem) {\n  .salt-logo {\n    flex: none;\n  }\n\n'), 'nothing proves it misses `a.salt-logo`'],
    ['a rule scoped to the row puts `flex: none` back', 'chrome.css', appending('.salt-header__inner > .salt-logo {\n  flex: none;\n}'), 'nothing proves it misses `a.salt-logo`'],
    /* An attribute value read as a class: `[href$='.pdf']` named the class `pdf`, which the logo
       link does not carry, so the rule was proved to miss a link it reaches — the logo is an
       `<a href>` like any other. */
    ['a download-link rule puts `flex: none` back through an attribute value', 'blocks.css', appending("a[href$='.pdf'] {\n  flex: none;\n}"), 'nothing proves it misses `a.salt-logo`'],
    ['the shrink is a custom property', 'chrome.css', replacing(LOGO_SHRINK, '  flex: var(--salt-logo-flex);\n  min-inline-size: 0;\n'), 'spell it as `flex: 0 1 auto`'],
    ['the shrink is `!important`', 'chrome.css', replacing(LOGO_SHRINK, '  flex: 0 1 auto !important;\n  min-inline-size: 0;\n'), 'as `!important`'],
    ['the image is uncapped', 'chrome.css', replacing('  max-inline-size: 100%;\n  object-fit', '  max-inline-size: none;\n  object-fit'), 'spell it as `max-inline-size: 100%`'],
    ['the wordmark loses its wrap', 'chrome.css', replacing(WORDMARK_WRAP, ''), 'no unconditional `.salt-logo__wordmark` rule'],
    ['the wordmark breaks with `break-word`', 'chrome.css', replacing(WORDMARK_WRAP, '  overflow-wrap: break-word;\n'), 'spell it as `overflow-wrap: anywhere`'],
    ['the wordmark is `white-space: nowrap`', 'chrome.css', replacing(WORDMARK_WRAP, `${WORDMARK_WRAP}  white-space: nowrap;\n`), 'declares `white-space`, which this contract does not accept there'],
    ['the link is `white-space: nowrap`', 'chrome.css', replacing(LOGO_SHRINK, `${LOGO_SHRINK}  white-space: nowrap;\n`), 'declares `white-space`, which this contract does not accept there'],
    ['the row is `white-space: pre` on phones', 'chrome.css', replacing('@media (max-width: 48rem) {\n', '@media (max-width: 48rem) {\n  .salt-header__inner {\n    white-space: pre;\n  }\n\n'), 'nothing proves it misses `div.salt-header__inner`'],
    ['the shrink is 0 behind a leading basis', 'chrome.css', replacing(LOGO_SHRINK, '  flex: auto 1 0;\n  min-inline-size: 0;\n'), 'spell it as `flex: 0 1 auto`'],
    ['the logo grows', 'chrome.css', replacing(LOGO_SHRINK, '  flex: 1 1 auto;\n  min-inline-size: 0;\n'), 'spell it as `flex: 0 1 auto`'],
    ['`flex-grow: 1` joins the shorthand', 'chrome.css', replacing(LOGO_SHRINK, `${LOGO_SHRINK}  flex-grow: 1;\n`), 'declares `flex-grow`, which this contract does not accept there'],
    ['the image loses `object-fit`', 'chrome.css', replacing(IMAGE_FIT, ''), '`.salt-logo__image` does not declare `object-fit`'],
    ['the image is `object-fit: fill`', 'chrome.css', replacing(IMAGE_FIT, '  object-fit: fill;\n'), 'spell it as `object-fit: contain`'],
    /* A — a property name in another case, which CSS reads and a case-sensitive compare did not. */
    ['A1 `FLEX: NONE`', 'chrome.css', replacing(LOGO_SHRINK, '  FLEX: NONE;\n  min-inline-size: 0;\n'), 'spell it as `flex: 0 1 auto`'],
    ['A2 `Flex-Shrink: 0` joins the shorthand', 'chrome.css', replacing(LOGO_SHRINK, `${LOGO_SHRINK}  Flex-Shrink: 0;\n`), 'declares `flex-shrink`, which this contract does not accept there'],
    ['A3 `WHITE-SPACE: nowrap` on the wordmark', 'chrome.css', replacing(WORDMARK_WRAP, `${WORDMARK_WRAP}  WHITE-SPACE: nowrap;\n`), 'declares `white-space`, which this contract does not accept there'],
    ['A4 `Text-Wrap-Mode: nowrap` on the wordmark', 'chrome.css', replacing(WORDMARK_WRAP, `${WORDMARK_WRAP}  Text-Wrap-Mode: nowrap;\n`), 'declares `text-wrap-mode`, which this contract does not accept there'],
    ['A5 `OBJECT-FIT: fill` after the canonical one', 'chrome.css', replacing(IMAGE_FIT, `${IMAGE_FIT}  OBJECT-FIT: fill;\n`), 'declares `object-fit` more than once'],
    /* B — an invalid second value the browser drops, leaving the first. */
    ['B1 `white-space: nowrap; white-space: pretty`', 'chrome.css', replacing(WORDMARK_WRAP, `${WORDMARK_WRAP}  white-space: nowrap;\n  white-space: pretty;\n`), 'which this contract does not accept there'],
    ['B2 `text-wrap: nowrap; text-wrap: preserve`', 'chrome.css', replacing(WORDMARK_WRAP, `${WORDMARK_WRAP}  text-wrap: nowrap;\n  text-wrap: preserve;\n`), 'which this contract does not accept there'],
    ['B3 `text-wrap-mode: nowrap; text-wrap-mode: balance`', 'chrome.css', replacing(WORDMARK_WRAP, `${WORDMARK_WRAP}  text-wrap-mode: nowrap;\n  text-wrap-mode: balance;\n`), 'which this contract does not accept there'],
    /* C — a rule reaching the wordmark without naming it, or from another stylesheet. */
    ['C1 `.salt-logo > span { white-space: nowrap }`', 'chrome.css', appending('.salt-logo > span {\n  white-space: nowrap;\n}'), 'nothing proves it misses `span.salt-logo__wordmark`'],
    /* The wrapper that the hit-area contract sees through is seen through here too, so it
       reaches the logo rather than hiding from it. */
    ['a `:where()`-wrapped logo rule puts `flex: none` back', 'chrome.css', appending(':where(.salt-logo) {\n  flex: none;\n}'), 'nothing proves it misses `a.salt-logo`'],
    ['a narrowing `:where()` hides what it matches', 'chrome.css', appending('.salt-header__inner:where(div) {\n  white-space: nowrap;\n}'), 'nothing proves it misses'],
    /* A negation names a class the element must NOT have, and read as a required class it
       "proved" these rules disjoint from the logo. Reproduced in Chrome 148 on 22/09/2026:
       the first scrolls a 320px page to 392 with the burger off screen, the second draws the
       wordmark over the toggle and the burger. */
    ['a negated class reaches the logo, `.salt-header__inner > :not(.salt-nav)`', 'chrome.css', appending('.salt-header__inner > :not(.salt-nav) {\n  flex: none;\n}'), 'nothing proves it misses `a.salt-logo`'],
    ['a negated class reaches the wordmark from primitives.css, `a:not(.salt-button)`', 'primitives.css', appending('a:not(.salt-button) {\n  white-space: nowrap;\n}'), 'in primitives.css declares `white-space` and nothing proves it misses'],
    /* The image's other classes. Reproduced in Chrome 148 on 22/09/2026: in dark mode the
       uncapped mark draws 240px wide, over the toggle. */
    ['the dark variant is uncapped, `.salt-logo__dark { max-inline-size: none }`', 'chrome.css', appending('.salt-logo__dark {\n  max-inline-size: none;\n}'), 'nothing proves it misses `img.salt-logo__image.salt-logo__light.salt-logo__dark`'],
    ['the light variant is uncapped, `.salt-logo__light { max-inline-size: none }`', 'chrome.css', appending('.salt-logo__light {\n  max-inline-size: none;\n}'), 'nothing proves it misses `img.salt-logo__image'],
    ['C2 `.salt-header__inner > * { white-space: nowrap }`', 'chrome.css', appending('.salt-header__inner > * {\n  white-space: nowrap;\n}'), 'nothing proves it misses'],
    ['C3 the wordmark `nowrap` in primitives.css', 'primitives.css', appending('.salt-logo__wordmark {\n  white-space: nowrap;\n}'), 'in primitives.css declares `white-space` and nothing proves it misses `span.salt-logo__wordmark`'],
    ['C4 an ancestor, `.salt-header { white-space: nowrap }`', 'chrome.css', appending('.salt-header {\n  white-space: nowrap;\n}'), 'which inherits, and nothing proves it is not an ancestor of the wordmark'],
    ['C5 `body { white-space: nowrap }` in sections.css', 'sections.css', appending('body {\n  white-space: nowrap;\n}'), 'which inherits'],
    /* D — the basis, which a shrink-and-grow reader never looked at: each collapses the logo. */
    ['D1 `flex: 0`', 'chrome.css', replacing(LOGO_SHRINK, '  flex: 0;\n  min-inline-size: 0;\n'), 'spell it as `flex: 0 1 auto`'],
    ['D2 `flex: 0 1`', 'chrome.css', replacing(LOGO_SHRINK, '  flex: 0 1;\n  min-inline-size: 0;\n'), 'spell it as `flex: 0 1 auto`'],
    ['D3 `flex: 0 1 0`', 'chrome.css', replacing(LOGO_SHRINK, '  flex: 0 1 0;\n  min-inline-size: 0;\n'), 'spell it as `flex: 0 1 auto`'],
    ['D4 `flex: 0 1 0%`', 'chrome.css', replacing(LOGO_SHRINK, '  flex: 0 1 0%;\n  min-inline-size: 0;\n'), 'spell it as `flex: 0 1 auto`'],
    /* E — refused, and told what to write, never told something false about what it does. */
    ['E1 `object-fit: var(--fit)`', 'chrome.css', replacing(IMAGE_FIT, '  object-fit: var(--fit);\n'), 'sets `object-fit` to `var(--fit)` — spell it as `object-fit: contain`'],
    ['E2 `object-fit: inherit`', 'chrome.css', replacing(IMAGE_FIT, '  object-fit: inherit;\n'), 'sets `object-fit` to `inherit` — spell it as `object-fit: contain`'],
    ['E3 `object-fit: scale-down`', 'chrome.css', replacing(IMAGE_FIT, '  object-fit: scale-down;\n'), 'sets `object-fit` to `scale-down` — spell it as `object-fit: contain`'],
    ['E4 a longhand BEFORE the shorthand', 'chrome.css', replacing(LOGO_SHRINK, '  flex-shrink: 1;\n  flex: 0 1 auto;\n  min-inline-size: 0;\n'), 'declares `flex-shrink`, which this contract does not accept there'],
    ['E5 `white-space: nowrap; text-wrap-mode: wrap`', 'chrome.css', replacing(WORDMARK_WRAP, `${WORDMARK_WRAP}  white-space: nowrap;\n  text-wrap-mode: wrap;\n`), 'which this contract does not accept there'],
  ])('fails when %s', (_case, file, mutate, message) => {
    const { code, output } = gate(file, mutate)
    expect(output).toContain(message)
    expect(code).toBe(1)
  })

  /* The false-claim guard for E: a correct spelling may be refused, but never as a defect. */
  it('never tells an unusual but proportional `object-fit` that it stretches', () => {
    const { output } = gate('chrome.css', replacing(IMAGE_FIT, '  object-fit: scale-down;\n'))
    expect(output).not.toContain('stretched')
  })

  itEach([
    ['the stylesheets are as committed', 'chrome.css', (css) => css],
    /* Values and names compared without case, as CSS reads them. */
    ['the canonical spelling is in another case', 'chrome.css', replacing(LOGO_SHRINK, '  Flex: 0 1 AUTO;\n  min-inline-size: 0;\n')],
    /* A governed property on a core class that is provably none of the four elements. */
    ['an unrelated component wraps its own way', 'chrome.css', appending('.salt-nav__link {\n  white-space: nowrap;\n}')],
  ])('passes when %s', (_case, file, mutate) => {
    const { code, output } = gate(file, mutate)
    expect(output).toContain('PASS: ')
    expect(code).toBe(0)
  })
})

/**
 * ── A link in body copy is underlined by one rule, and nothing else touches the line ─
 *
 * The contract forbids shapes rather than modelling the cascade, so its failure cases are
 * the edits that took the underline away while the first version exited 0 — (A) to (C) are
 * the three review reproduced in Chrome 148 — and the near relations of each: a reset through
 * `all`, a negation hiding the only distinguishing part, the rule narrowed, moved or given a
 * second declaration. Its passing cases are rules it must NOT refuse: a decoration keyed on a
 * class or a pseudo-element a body link never carries, and the canonical rule in another case.
 */
describe('a link in body copy is underlined by one rule, and nothing else touches the line', () => {
  const RULE = '.salt-rich-text a {\n  text-decoration-line: underline;\n  text-underline-offset: 0.15em;\n}'
  const owner = (rule) => replacing(RULE, rule)

  itEach([
    [
      '(A) a block in blocks.css turns its links’ line off',
      'blocks.css',
      appending(".salt-block[data-block='cta'] .salt-rich-text a {\n  text-decoration: none;\n}"),
      "`.salt-block[data-block='cta'] .salt-rich-text a` in blocks.css declares `text-decoration` and nothing proves it misses a body link",
    ],
    [
      '(B) the footer’s text in chrome.css turns its links’ line off',
      'chrome.css',
      appending('.salt-footer__text a {\n  text-decoration: none;\n}'),
      '`.salt-footer__text a` in chrome.css declares `text-decoration`',
    ],
    [
      '(C) the canonical rule makes its line transparent',
      'primitives.css',
      owner('.salt-rich-text a {\n  text-decoration-line: underline;\n  text-underline-offset: 0.15em;\n  text-decoration-color: transparent;\n}'),
      '`.salt-rich-text a` declares `text-decoration-color`, which this contract does not accept there',
    ],
    [
      '(D) a section resets every link through `all`',
      'sections.css',
      appending('.salt-section a {\n  all: unset;\n}'),
      '`.salt-section a` in sections.css declares `all`',
    ],
    [
      '(E) a negation hides the only part that could prove a miss',
      'blocks.css',
      appending('a:not([data-plain]) {\n  text-decoration: none;\n}'),
      '`a:not([data-plain])` in blocks.css declares `text-decoration`',
    ],
    [
      'an attribute every new-tab body link carries',
      'chrome.css',
      appending("a[target='_blank'] {\n  -webkit-text-decoration: none;\n}"),
      "`a[target='_blank']` in chrome.css declares `-webkit-text-decoration`",
    ],
    [
      'the canonical rule repeated inside a media query',
      'primitives.css',
      appending('@media (max-width: 40rem) {\n  .salt-rich-text a {\n    text-decoration-line: none;\n  }\n}'),
      '`.salt-rich-text a` in primitives.css declares `text-decoration-line`',
    ],
    [
      'the underline removed',
      'primitives.css',
      owner('.salt-rich-text a {\n  text-underline-offset: 0.15em;\n}'),
      '`.salt-rich-text a` does not declare `text-decoration-line`',
    ],
    [
      'the underline swapped for the shorthand',
      'primitives.css',
      owner('.salt-rich-text a {\n  text-decoration: underline;\n  text-underline-offset: 0.15em;\n}'),
      '`.salt-rich-text a` declares `text-decoration`, which this contract does not accept there',
    ],
    [
      'the canonical rule moved inside a media query',
      'primitives.css',
      owner('@media (min-width: 48rem) {\n  .salt-rich-text a {\n    text-decoration-line: underline;\n    text-underline-offset: 0.15em;\n  }\n}'),
      'no unconditional `.salt-rich-text a` rule(s) decorate body links',
    ],
    [
      'the canonical rule scoped to one block',
      'primitives.css',
      owner(".salt-block .salt-rich-text a {\n  text-decoration-line: underline;\n  text-underline-offset: 0.15em;\n}"),
      'no unconditional `.salt-rich-text a` rule(s) decorate body links',
    ],
    [
      'the canonical rule grouped with another selector',
      'primitives.css',
      owner('.salt-rich-text a, .salt-card a {\n  text-decoration-line: underline;\n  text-underline-offset: 0.15em;\n}'),
      'groups `.salt-rich-text a` with another selector',
    ],
    [
      'the underline made `!important`',
      'primitives.css',
      owner('.salt-rich-text a {\n  text-decoration-line: underline !important;\n  text-underline-offset: 0.15em;\n}'),
      '`.salt-rich-text a` declares `text-decoration-line` as `!important`',
    ],
    [
      'the line set to something other than an underline',
      'primitives.css',
      owner('.salt-rich-text a {\n  text-decoration-line: overline;\n  text-underline-offset: 0.15em;\n}'),
      '`.salt-rich-text a` sets `text-decoration-line` to `overline`',
    ],
    /* An attribute value is free text, and each of these reaches a real body link while
       reading, to a class, id or pseudo-element test over the whole compound, as a proof it
       does not: "download links get an icon instead" is an ordinary edit. */
    [
      'download links lose their line, a value that looks like a class',
      'blocks.css',
      appending(".salt-rich-text a[href$='.pdf'] {\n  text-decoration: none;\n}"),
      "`.salt-rich-text a[href$='.pdf']` in blocks.css declares `text-decoration`",
    ],
    [
      'footnote links lose their line, a value that looks like an id',
      'primitives.css',
      appending(".salt-rich-text a[href^='#fn'] {\n  text-decoration-line: none;\n}"),
      "`.salt-rich-text a[href^='#fn']` in primitives.css declares `text-decoration-line`",
    ],
    [
      'links to one site lose their line, a value with a dot in it',
      'chrome.css',
      appending("a[href*='example.com'] {\n  text-decoration: none;\n}"),
      "`a[href*='example.com']` in chrome.css declares `text-decoration`",
    ],
    [
      'a case-insensitive attribute match with a double-quoted value',
      'blocks.css',
      appending('.salt-rich-text a[href$=".pdf" i] {\n  text-decoration: none;\n}'),
      'in blocks.css declares `text-decoration`',
    ],
    [
      'a value that looks like a pseudo-element',
      'blocks.css',
      appending("a[href*='::'] {\n  text-decoration: none;\n}"),
      "`a[href*='::']` in blocks.css declares `text-decoration`",
    ],
    [
      'a second owner rule in the same file',
      'primitives.css',
      appending(RULE),
      '2 unconditional `.salt-rich-text a` rule(s) decorate body links',
    ],
  ])('fails when %s', (_case, file, mutate, message) => {
    const { code, output } = gate(file, mutate)
    expect(output).toContain(message)
    /* Every refusal says what to write, not only what is wrong. */
    expect(output).toContain('underline body links in the `.salt-rich-text a` rule alone')
    expect(code).toBe(1)
  })

  itEach([
    ['a decoration keyed on a core class', 'chrome.css', appending('.salt-nav__link {\n  text-decoration: none;\n}')],
    ['a decoration on a pseudo-element', 'blocks.css', appending('.salt-rich-text a::after {\n  text-decoration: none;\n}')],
    ['a class outside a negation', 'blocks.css', appending('.salt-card__link:not([data-x]) {\n  text-decoration: none;\n}')],
    ['the canonical rule in another case', 'primitives.css', owner('.salt-rich-text a {\n  TEXT-DECORATION-LINE: UNDERLINE;\n  text-underline-offset: 0.15EM;\n}')],
  ])('passes %s', (_case, file, mutate) => {
    const { code, output } = gate(file, mutate)
    expect(output).toContain('PASS: ')
    expect(code).toBe(0)
  })
})

/**
 * The page ground is core's, painted once (BD-162).
 *
 * `primitives.css` paints `body` with `surface` and `ink`, which the example app and salt-site did
 * in their own stylesheets until core took it over. Each case below is a plausible edit that gives
 * the ground a second owner, paints it conditionally or with the wrong pair, or spells it in a way
 * this contract does not read; each is refused with what to write, and the passing cases are the
 * spellings that must not be refused.
 */
describe('core paints the page ground once, on `body`, with the page pair', () => {
  const GROUND = 'body {\n  background-color: var(--color-surface);\n  color: var(--color-ink);\n}'
  const ground = (rule) => replacing(GROUND, rule)

  itEach([
    ['the owner is deleted', 'primitives.css', ground(''), 'nothing in core paints the page ground'],
    ['a second `body` rule is appended', 'primitives.css', appending(GROUND), '2 top-level `body` rules in `primitives.css` paint the ground'],
    ['the root is cleared in another file', 'chrome.css', appending('html {\n  background: transparent;\n}'), '`html` in `chrome.css` declares `background`'],
    ['a dark-mode ground inside a media query', 'sections.css', appending('@media (prefers-color-scheme: dark) {\n  body {\n    background-color: var(--color-surface-inverse);\n  }\n}'), 'inside `@media (prefers-color-scheme: dark)`'],
    ['the theme attribute paints the root', 'primitives.css', appending("[data-theme='dark'] {\n  background-color: var(--color-surface);\n}"), "`[data-theme='dark']` in `primitives.css` declares `background-color`"],
    ['a universal selector paints text', 'blocks.css', appending('* {\n  color: inherit;\n}'), '`*` in `blocks.css` declares `color`'],
    ['`:root` paints a colour', 'primitives.css', appending(':root {\n  color: var(--color-ink);\n}'), '`:root` in `primitives.css` declares `color`'],
    ['the body inside `:is()`', 'blocks.css', appending(':is(body, .salt-page-note) {\n  color: var(--color-ink);\n}'), 'in `blocks.css` declares `color`'],
    ['the ground goes `!important`', 'primitives.css', ground('body {\n  background-color: var(--color-surface) !important;\n  color: var(--color-ink);\n}'), 'as `!important`, which this contract cannot rank'],
    ['the shorthand is written instead', 'primitives.css', ground('body {\n  background: var(--color-surface);\n  color: var(--color-ink);\n}'), 'a spelling this contract does not read'],
    ['a fallback is added to the surface', 'primitives.css', ground('body {\n  background-color: var(--color-surface, Canvas);\n  color: var(--color-ink);\n}'), 'write exactly `var(--color-surface)`'],
    ['the alternate band is painted as the page', 'primitives.css', ground('body {\n  background-color: var(--color-surface-alt);\n  color: var(--color-ink);\n}'), 'with `--color-surface-alt`, not `--color-surface`'],
    ['the ink is dropped', 'primitives.css', ground('body {\n  background-color: var(--color-surface);\n}'), 'does not declare `color`'],
    ['a second colour is declared', 'primitives.css', ground('body {\n  background-color: var(--color-surface);\n  color: var(--color-ink);\n  color: var(--color-ink-muted);\n}'), 'declares `color` 2 times'],
    ['the custom property is renamed by case', 'primitives.css', ground('body {\n  background-color: var(--Color-Surface);\n  color: var(--color-ink);\n}'), 'with `--Color-Surface`'],
  ])('fails when %s', (_case, file, mutate, message) => {
    const { code, output } = gate(file, mutate)
    expect(output).toContain('core paints the page ground once')
    expect(output).toContain(message)
    expect(code).toBe(1)
  })

  itEach([
    ['the owner in capitals', 'primitives.css', ground('BODY {\n  BACKGROUND-COLOR: VAR(--color-surface);\n  Color: var( --color-ink );\n}')],
    ['a pseudo-element box on the body', 'primitives.css', appending('body::before {\n  background-color: var(--color-surface-alt);\n}')],
    ['a class that is not the page', 'blocks.css', appending('.salt-page-note {\n  color: var(--color-ink);\n}')],
    ['an attribute value that names the body', 'blocks.css', appending(".salt-page-note[data-x='body'] {\n  color: var(--color-ink);\n}")],
    /* The hit-area contract's own passing spelling, `:where()` round a class, whose rule sets
       `background: none`. Stripping the `:where()` whole read it as a subject with no class. */
    ['a class wrapped in `:where()`', 'chrome.css', appending(':where(.salt-page-note) {\n  background: none;\n}')],
  ])('passes %s', (_case, file, mutate) => {
    const { code, output } = gate(file, mutate)
    expect(output).toContain('PASS: ')
    expect(code).toBe(0)
  })
})

/**
 * Over a photograph, muted text takes the tone's full ink (BD-163, lightlysaltedhq/salt-core#176).
 *
 * The contrast manifest proves the tone's own ink over the strong scrim and against the worst pixel
 * a photograph can put there; muted ink holds over no photograph at any strength that shows one. So
 * the stylesheet must repoint the muted variable inside an image-backed band, and nothing may read
 * a muted role around that variable. Each case is an edit that leaves an eyebrow, a stat's label or
 * a caption on the muted ink over a photograph, or spells the rule in a way this does not read.
 */
describe('over a photograph, muted text takes the tone’s full ink', () => {
  const MEDIA = '.salt-section[data-media] > .salt-section__content {\n  --salt-section-ink-muted: var(--salt-section-ink);\n}'
  const media = (rule) => replacing(MEDIA, rule)

  itEach([
    ['the rule is deleted', 'sections.css', media(''), 'no unconditional `.salt-section[data-media] > .salt-section__content` rule declares'],
    ['the rule only applies above a breakpoint', 'sections.css', media(`@media (min-width: 48rem) {\n${MEDIA}\n}`), 'no unconditional'],
    ['the rule is widened to every section, which would drop muted ink on flat bands too but is not this rule', 'sections.css', media('.salt-section > .salt-section__content {\n  --salt-section-ink-muted: var(--salt-section-ink);\n}'), 'no unconditional'],
    ['the variable is renamed by case', 'sections.css', media('.salt-section[data-media] > .salt-section__content {\n  --SALT-SECTION-INK-MUTED: var(--salt-section-ink);\n}'), 'no unconditional'],
    ['it points back at the muted ink', 'sections.css', media('.salt-section[data-media] > .salt-section__content {\n  --salt-section-ink-muted: var(--color-ink-muted);\n}'), 'at `--color-ink-muted`, not `--salt-section-ink`'],
    ['it points at the light-band ink, which is the wrong pole on an inverted band', 'sections.css', media('.salt-section[data-media] > .salt-section__content {\n  --salt-section-ink-muted: var(--color-ink);\n}'), 'at `--color-ink`, not `--salt-section-ink`'],
    ['it goes `!important`', 'sections.css', media('.salt-section[data-media] > .salt-section__content {\n  --salt-section-ink-muted: var(--salt-section-ink) !important;\n}'), 'as `!important`, which this contract cannot rank'],
    ['it gains a fallback', 'sections.css', media('.salt-section[data-media] > .salt-section__content {\n  --salt-section-ink-muted: var(--salt-section-ink, var(--color-ink));\n}'), 'a spelling this contract does not read'],
    ['it is declared twice', 'sections.css', media('.salt-section[data-media] > .salt-section__content {\n  --salt-section-ink-muted: var(--salt-section-ink);\n  --salt-section-ink-muted: var(--color-ink-muted);\n}'), 'declared more than once'],
    ['a block re-declares it inside the band', 'blocks.css', appending('.salt-stats {\n  --salt-section-ink-muted: var(--color-ink-muted);\n}'), '`.salt-stats` in `blocks.css` declares `--salt-section-ink-muted` on something that may sit over a photograph'],
    ['an image-backed override brings the muted ink back', 'primitives.css', appending('.salt-section[data-media] .salt-eyebrow {\n  --salt-section-ink-muted: var(--color-ink-muted);\n}'), 'may sit over a photograph'],
    ['the eyebrow reads the muted role directly', 'primitives.css', replacing('.salt-eyebrow {\n  margin: 0;\n  color: var(--salt-section-ink-muted, var(--color-ink-muted));', '.salt-eyebrow {\n  margin: 0;\n  color: var(--color-ink-muted);'), 'reads `--color-ink-muted` in `color` without going through `--salt-section-ink-muted`'],
    ['a caption reads the inverse muted role around the variable', 'blocks.css', appending('.salt-gallery__caption[data-x] {\n  color: VAR(--color-ink-muted-inverse);\n}'), 'reads `--color-ink-muted-inverse`'],
    ['a private variable carries the muted role past the check', 'blocks.css', appending('.salt-stat {\n  --salt-stat-muted: var(--color-ink-muted);\n}'), 'reads `--color-ink-muted` in `--salt-stat-muted`'],
    /* A longer name sharing the variable's prefix is a different property, so its fallback is a
       real read of the muted role; a `\b` boundary took it for the variable and passed it. */
    ['a longer variable name hides a muted read in its fallback', 'blocks.css', appending('.salt-stat__label[data-x] {\n  color: var(--salt-section-ink-muted-strong, var(--color-ink-muted));\n}'), 'reads `--color-ink-muted` in `color`'],
  ])('fails when %s', (_case, file, mutate, message) => {
    const { code, output } = gate(file, mutate)
    expect(output).toContain('over a photograph, muted text takes the tone’s full ink')
    expect(output).toContain(message)
    expect(code).toBe(1)
  })

  itEach([
    ['the function name in capitals', 'sections.css', media('.salt-section[data-media] > .salt-section__content {\n  --salt-section-ink-muted: VAR( --salt-section-ink );\n}')],
    ['the rule written with no space round the combinator', 'sections.css', media('.salt-section[data-media]>.salt-section__content {\n  --salt-section-ink-muted: var(--salt-section-ink);\n}')],
    ['a new tone rule on the wrapper', 'sections.css', appending(".salt-section[data-tone='surface'][data-x] {\n  --salt-section-ink-muted: var(--color-ink-muted);\n}")],
    ['a panel that paints its own surface', 'primitives.css', appending('.salt-note-panel {\n  --salt-section-ink-muted: var(--color-ink-muted);\n  background-color: var(--color-surface-alt);\n}')],
    ['a muted role only as the fallback', 'blocks.css', appending('.salt-note {\n  color: var(--salt-section-ink-muted, var(--color-ink-muted));\n}')],
    /* The header's, since the footer now takes a tone and its own contract refuses a mode role there (BD-204). */
    ['a muted role in the chrome, which no band contains', 'chrome.css', appending('.salt-header__note {\n  color: var(--color-ink-muted);\n}')],
  ])('passes %s', (_case, file, mutate) => {
    const { code, output } = gate(file, mutate)
    expect(output).toContain('PASS: ')
    expect(code).toBe(0)
  })
})

/**
 * A CSS escape outside a string is refused before any contract runs (#181 review). `b\\6f dy` is
 * `body` to a browser and nothing to a contract comparing spellings, so it painted the page ground
 * past the one-owner check; inside a string an escape names a character and is allowed.
 */
describe('a backslash outside a string is refused', () => {
  itEach([
    ['an escaped `body` paints the ground', 'blocks.css', appending('b\\6f dy {\n  background-color: var(--color-surface-alt);\n}')],
    ['an escaped property name', 'primitives.css', appending('.salt-note {\n  \\63 olor: var(--color-ink-muted);\n}')],
  ])('fails when %s', (_case, file, mutate) => {
    const { code, output } = gate(file, mutate)
    expect(output).toContain(`${file}:`)
    expect(output).toContain('carries a backslash outside a string')
    expect(code).toBe(1)
  })

  it('refuses an @property in a hand-written stylesheet, which its parse cannot read', () => {
    const { code, output } = gate('primitives.css', appending("@property --focus-ring-width {\n  syntax: '*';\n  inherits: true;\n  initial-value: 2px;\n}"))
    expect(output).toContain('registers a custom property. `@property` belongs to a runtime\'s token layer')
    expect(code).toBe(1)
  })

  it('passes an escape inside a string', () => {
    const { code, output } = gate('blocks.css', appending('.salt-note::before {\n  content: "\\201C";\n}'))
    expect(output).toContain('PASS: ')
    expect(code).toBe(0)
  })
})

/**
 * ── Nothing outside the focus rules declares an outline or a box-shadow ─────────
 *
 * The four selectors #185's re-review found reaching a control without naming one, each of
 * which passed a check keyed on the rule's subject. Appended, so each is the latest rule in its
 * file, as an override would be. The one in `blocks.css` shows the check reads every sheet.
 */
describe('nothing outside the focus rules declares an outline or a box-shadow', () => {
  const appending = (addition) => (css) => `${css}\n${addition}\n`

  itEach([
    ['primitives.css', 'a {\n  box-shadow: none !important;\n}'],
    ['primitives.css', '* {\n  outline-offset: 0;\n}'],
    ['primitives.css', ".salt-section[data-tone] a {\n  outline-offset: 0;\n}"],
    ['primitives.css', "[class*='salt-button'] {\n  box-shadow: none;\n}"],
    ['blocks.css', '.salt-block a {\n  outline: none;\n}'],
    ['primitives.css', '.salt-card {\n  all: unset;\n}'],
  ])('fails on %s given `%s`', (file, addition) => {
    const { code, output } = gate(file, appending(addition))
    expect(output).toContain('nothing outside the focus rules declares an outline or a box-shadow')
    expect(code).toBe(1)
  })

  it('fails when the invalid field’s inset loses its negation and so is no longer the named exception', () => {
    const { code, output } = gate(
      'primitives.css',
      replacing(".salt-contact__input[aria-invalid='true']:not(:focus-visible) {", ".salt-contact__input[aria-invalid='true'] {"),
    )
    expect(output).toContain('nothing outside the focus rules declares an outline or a box-shadow')
    expect(code).toBe(1)
  })
})

/**
 * ── The image-backed composition names the flat list's controls, whole ─────────
 *
 * `.salt-logo` is a substring of `.salt-logos__frame`, so a check asking whether the image rule's
 * selector contained each control's class passed with `.salt-logo` deleted (#185 re-review).
 */
describe('an image-backed section draws BOTH poles on every control the flat list names', () => {
  it('fails when `.salt-logo` is deleted from the `:is()` list', () => {
    const { code, output } = gate('primitives.css', replacing('.salt-consent-panel__checkbox, .salt-logo, .salt-nav__link', '.salt-consent-panel__checkbox, .salt-nav__link'))
    expect(output).toContain('leaves .salt-logo:focus-visible on the one-pole indicator')
    expect(code).toBe(1)
  })

  it('fails when the `:is()` list names a control the flat list does not', () => {
    const { code, output } = gate('primitives.css', replacing('.salt-consent-panel__checkbox, .salt-logo, .salt-nav__link', '.salt-consent-panel__checkbox, .salt-logo, .salt-unlisted, .salt-nav__link'))
    expect(output).toContain('names .salt-unlisted:focus-visible, which the flat-tone list does not')
    expect(code).toBe(1)
  })
})

/**
 * The scale tokens the stylesheets read (BD-169): a radius, an opacity and the focus ring read their
 * tokens, and the keyline contract ranks the ring through them for any values the ring tokens take.
 * Each case breaks one of those and must fail by name. The breakpoint cases stayed in Salt for
 * Next.js with the contract that reads its theme's values.
 */
describe('the scale tokens the stylesheets read', () => {
  const FLAT = '  box-shadow: 0 0 0 calc(var(--focus-ring-offset) + var(--focus-ring-width) + 2px) var(--salt-section-ink, var(--color-ink));'
  itEach([
    ['a container query', 'blocks.css', appending('@container (max-width: 30rem) {\n  .salt-note {\n    display: none;\n  }\n}'), 'uses `@container`, an at-rule this gate does not read'],
    ['a radius written as a literal', 'primitives.css', appending('.salt-note {\n  border-radius: 0.5rem;\n}'), 'writes `border-radius: 0.5rem`'],
    ['a corner longhand written as a literal', 'blocks.css', appending('.salt-note {\n  border-top-left-radius: 4px;\n}'), 'writes `border-top-left-radius: 4px`'],
    ['a radius on a rung the token layer does not name', 'blocks.css', appending('.salt-note {\n  border-radius: var(--radius-xl);\n}'), 'contract/token-layer.json names no `--radius-xl`'],
    ['a radius !important', 'primitives.css', appending('.salt-note {\n  border-radius: var(--radius-sm) !important;\n}'), 'declares `border-radius` !important'],
    ['an opacity written as a literal', 'primitives.css', replacing('  opacity: var(--opacity-heavy);', '  opacity: 0.6;'), 'writes `opacity: 0.6`'],
    ['an opacity reading another family', 'primitives.css', replacing('  opacity: var(--opacity-medium);', '  opacity: var(--scrim-standard);'), 'reads a `--opacity-*` token'],
    ['a filter opacity()', 'primitives.css', appending('.salt-note {\n  filter: opacity(0.5);\n}'), '`opacity()` is a shape this contract does not rank'],
    ['a *-opacity property', 'blocks.css', appending('.salt-note {\n  fill-opacity: 0.5;\n}'), '`fill-opacity` is a shape this contract does not rank'],
    ['a corner as `round` in inset()', 'blocks.css', appending('.salt-note {\n  clip-path: inset(0 round 4px);\n}'), '`round` is a shape this contract does not rank'],
    ['a round() function on a radius', 'primitives.css', appending('.salt-note {\n  border-radius: round(up, 3px, 2px);\n}'), '`round` is a shape this contract does not rank'],
    ['the scrim exception used twice', 'sections.css', appending('.salt-note {\n  opacity: var(--salt-scrim-alpha);\n}'), 'is written 2 times in sections.css; it is excused once'],
    ['the keyline written back as a literal, which a wider ring outgrows', 'primitives.css', replacing(FLAT, '  box-shadow: 0 0 0 6px var(--salt-section-ink, var(--color-ink));'), 'spread 6px does not clear offset var(--focus-ring-offset) + width var(--focus-ring-width) for every value'],
    ['the keyline no wider than the ring', 'primitives.css', replacing(FLAT, FLAT.replace('+ 2px)', '+ 0px)')), 'spread var(--focus-ring-offset) + var(--focus-ring-width) does not clear'],
    ['the outline written as a literal the keyline cannot be ranked against', 'primitives.css', (css) => css.replace('outline: var(--focus-ring-width) solid var(--color-focus);', 'outline: 2px solid var(--color-focus);'), 'does not clear offset var(--focus-ring-offset) + width 2px for every value'],
    ['the keyline in another calc() order', 'primitives.css', replacing(FLAT, FLAT.replace('var(--focus-ring-offset) + var(--focus-ring-width)', 'var(--focus-ring-width) + var(--focus-ring-offset)')), 'is neither an integer px length nor'],
    ['the keyline in a calc() with a rem term', 'primitives.css', replacing(FLAT, FLAT.replace('+ 2px)', '+ 0.125rem)')), 'is neither an integer px length nor'],
    ['the image band’s outer pole in another calc()', 'primitives.css', replacing('calc(var(--focus-ring-offset) + var(--focus-ring-width) + 4px)', 'calc(var(--focus-ring-width) * 2 + 4px)'), 'has a shadow spread that is neither an integer px length nor'],
  ])('fails %s', (_case, file, mutate, message) => {
    const { code, output } = gate(file, mutate)
    expect(output).toContain(message)
    expect(code).toBe(1)
  })
})

/**
 * Component text on the text roles (BD-173). Each case writes back a shape the contract refuses: a
 * literal, a role read without its family, two roles in one rule, a role's property on the wrong CSS
 * property, an override beside a role, and an exception or a `font: inherit` used once more than it
 * is excused.
 */
describe('component text reads the text roles', () => {
  const EYEBROW_FAMILY = '  font-family: var(--text-eyebrow--font-family);\n'
  itEach([
    ['a literal size', 'primitives.css', appending('.salt-note {\n  font-size: 1rem;\n}'), 'writes `font-size: 1rem`; it reads a text role'],
    ['a literal weight', 'chrome.css', appending('.salt-note {\n  font-weight: 600;\n}'), 'writes `font-weight: 600`; it reads a text role'],
    ['a weight rung the token layer does not name', 'blocks.css', appending('.salt-note {\n  font-weight: var(--weight-black);\n}'), 'contract/token-layer.json names no `--weight-black`'],
    ['a role with a fallback', 'blocks.css', appending('.salt-note {\n  font-size: var(--text-body, 1rem);\n}'), 'writes `font-size: var(--text-body, 1rem)`'],
    ['a role core does not emit', 'blocks.css', appending('.salt-note {\n  font-size: var(--text-hero);\n}'), 'writes `font-size: var(--text-hero)`'],
    ['a role read without its family', 'primitives.css', replacing(EYEBROW_FAMILY, ''), 'reads `eyebrow` without `font-family: var(--text-eyebrow--font-family)`'],
    ['two roles in one rule', 'primitives.css', replacing(EYEBROW_FAMILY, '  font-family: var(--text-label--font-family);\n'), 'mixes the roles `eyebrow` and `label`'],
    ['a role property on the wrong CSS property', 'primitives.css', replacing('  line-height: var(--text-eyebrow--line-height);', '  line-height: var(--text-eyebrow);'), "sets `line-height` from `var(--text-eyebrow)`, which is `eyebrow`'s `font-size`"],
    ['a weight overriding the role beside it', 'primitives.css', replacing(EYEBROW_FAMILY, `${EYEBROW_FAMILY}  font-weight: var(--weight-bold);\n`), 'sets `font-weight` twice beside the `eyebrow` role'],
    ['the font shorthand beside a role', 'primitives.css', replacing(EYEBROW_FAMILY, `${EYEBROW_FAMILY}  font: inherit;\n`), 'writes the `font` shorthand as `inherit`'],
    ['an excused `font: inherit` beside a role', 'primitives.css', replacing('  background-color: transparent;\n  color: var(--salt-section-ink, var(--color-ink));\n  font: inherit;', `  background-color: transparent;\n  color: var(--salt-section-ink, var(--color-ink));\n  font: inherit;\n${['font-size: var(--text-label)', 'line-height: var(--text-label--line-height)', 'letter-spacing: var(--text-label--letter-spacing)', 'font-weight: var(--text-label--font-weight)', 'font-family: var(--text-label--font-family)'].map((d) => `  ${d};`).join('\n')}`), 'writes `font` beside the `label` role'],
    ['a role !important', 'primitives.css', replacing('  font-size: var(--text-eyebrow);', '  font-size: var(--text-eyebrow) !important;'), 'declares `font-size` !important'],
    ['the font shorthand with a size', 'chrome.css', appending('.salt-note {\n  font: 700 1rem/1.2 serif;\n}'), 'writes the `font` shorthand as `700 1rem/1.2 serif`'],
    ['a third `font: inherit`', 'chrome.css', appending('.salt-note {\n  font: inherit;\n}'), 'writes the `font` shorthand as `inherit`; only `font: inherit` on `.salt-contact__input`, `.salt-search__input`, excused by selector'],
    ['`font: inherit` moved from an excused control to a new one (#190 review, nit)', 'primitives.css', (css) => replacing('  background-color: transparent;\n  color: var(--salt-section-ink, var(--color-ink));\n  font: inherit;', '  background-color: transparent;\n  color: var(--salt-section-ink, var(--color-ink));')(css) + '\n.salt-note {\n  font: inherit;\n}\n', 'writes the `font` shorthand as `inherit`'],
    ['an excused `font: inherit` removed', 'primitives.css', replacing('  background-color: transparent;\n  color: var(--salt-section-ink, var(--color-ink));\n  font: inherit;', '  background-color: transparent;\n  color: var(--salt-section-ink, var(--color-ink));'), '`.salt-search__input { font: inherit }` is written 0 times in primitives.css; it is excused once'],
    ['`font: inherit` written back on the copy button, beside its role (BD-185)', 'primitives.css', replacing('.salt-copy-link__button {\n  background: transparent;', '.salt-copy-link__button {\n  background: transparent;\n  font: inherit;'), 'writes the `font` shorthand as `inherit`'],
    ['an excused proportion used twice', 'blocks.css', appending('.salt-stat__suffix {\n  font-size: 0.6em;\n}'), 'is written 2 times in blocks.css; it is excused once'],
    ['`@apply` setting a size and a family (#190 review, MEDIUM 1)', 'blocks.css', appending('.salt-note {\n  @apply text-2xl font-bold font-serif;\n}'), 'uses `@apply`, whose declarations this gate cannot read'],
    ['`@apply` in capitals', 'chrome.css', appending('.salt-note {\n  @APPLY text-2xl;\n}'), 'uses `@apply`'],
    ['a text role redeclared on a component (#190 review, MEDIUM 2)', 'blocks.css', appending('.salt-hero {\n  --text-display: 5rem;\n}'), 'declares `--text-display`, a type token'],
    ['a weight rung redeclared on a component', 'chrome.css', appending('.salt-nav {\n  --weight-semibold: 900;\n}'), 'declares `--weight-semibold`, a type token'],
    ['a role companion redeclared', 'primitives.css', appending('.salt-note {\n  --text-body--font-family: serif;\n}'), 'declares `--text-body--font-family`, a type token'],
    ['a step redeclared', 'sections.css', appending('.salt-note {\n  --step-0: 2rem;\n}'), 'declares `--step-0`, a type token'],
    ['a leading rung redeclared', 'blocks.css', appending('.salt-note {\n  --leading-body: 2;\n}'), 'declares `--leading-body`, a type token'],
    ['a tracking rung redeclared', 'blocks.css', appending('.salt-note {\n  --tracking-caps: 0;\n}'), 'declares `--tracking-caps`, a type token'],
    ['a family redeclared', 'chrome.css', appending('.salt-header {\n  --font-heading: serif;\n}'), 'declares `--font-heading`, a type token'],
    ['a type token in capitals', 'chrome.css', appending('.salt-header {\n  --FONT-heading: serif;\n}'), 'declares `--FONT-heading`, a type token'],
    ['`!important` on a duplicate the last value hides (#190 review, LOW 1)', 'chrome.css', appending('.salt-note {\n  font-weight: 900 !important;\n  font-weight: var(--weight-bold);\n}'), 'declares `font-weight` !important'],
    ['a literal on a duplicate the last value hides', 'blocks.css', appending('.salt-note {\n  font-size: 3rem;\n  font-size: var(--text-body);\n}'), 'writes `font-size: 3rem`'],
    ['`@scope` setting text outside a rule (#190 re-review, LOW)', 'primitives.css', appending('@scope (.salt-card) {\n  font-size: 3rem;\n  font-weight: 900;\n}'), 'uses `@scope`, an at-rule this gate does not read'],
    ['`@utility` setting a size', 'blocks.css', appending('@utility salt-title {\n  font-size: 3rem;\n}'), 'uses `@utility`, an at-rule this gate does not read'],
    ['`@utility` redeclaring a role', 'chrome.css', appending('@utility x {\n  --text-display: 5rem;\n}'), 'uses `@utility`, an at-rule this gate does not read'],
    ['a keyframe moving a colour', 'chrome.css', appending('@keyframes salt-note {\n  from {\n    color: var(--color-ink);\n  }\n}'), 'animates `color` in `@keyframes`'],
    ['a keyframe moving a size, in capitals', 'chrome.css', appending('@KEYFRAMES salt-note {\n  to {\n    INLINE-SIZE: 0;\n  }\n}'), 'animates `INLINE-SIZE` in `@keyframes`'],
    ['a keyframe writing `!important`', 'chrome.css', appending('@keyframes salt-note {\n  50% {\n    transform: none !important;\n  }\n}'), 'A browser ignores `!important` there'],
    ['a class rule inside `@keyframes`', 'chrome.css', appending('@keyframes salt-note {\n  .salt-note {\n    transform: none;\n  }\n}'), 'which is not a keyframe selector this gate reads'],
    ['an at-rule nobody has heard of', 'sections.css', appending('@salt-future (.salt-note) {\n  .salt-note {\n    display: none;\n  }\n}'), 'uses `@salt-future`, an at-rule this gate does not read'],
    ['a bare declaration inside an allowed `@media`', 'blocks.css', appending('@media (max-width: 40rem) {\n  font-size: 3rem;\n}'), 'writes `font-size: 3rem` directly in an at-rule\'s block, outside any rule'],
    ['a bare declaration before a rule inside `@media`', 'primitives.css', appending('@media (max-width: 40rem) {\n  font-weight: 900;\n  .salt-note {\n    display: none;\n  }\n}'), 'writes `font-weight: 900` directly in an at-rule\'s block'],
    ['a variation axis moving the weight', 'primitives.css', appending(".salt-note {\n  font-variation-settings: 'wght' 700;\n}"), 'writes `font-variation-settings`'],
  ])('fails %s', (_case, file, mutate, message) => {
    const { code, output } = gate(file, mutate)
    expect(output).toContain(message)
    expect(code).toBe(1)
  })

  /* The completeness check once asked for `var(--text-eyebrow--font-family)` beside the declaration
     that already read it, spaced inside the parentheses (#190 review, LOW 2). */
  it('passes a role spaced inside its `var()`, which CSS reads the same', () => {
    const { code, output } = gate('primitives.css', replacing(EYEBROW_FAMILY, '  font-family: var( --text-eyebrow--font-family );\n'))
    expect(output).toContain('PASS: ')
    expect(code).toBe(0)
  })

  /* An opacity in a keyframe is still read by the scale-token contract, which is the point of
     reading keyframes as rules: a literal there fails as it would anywhere. */
  itEach(['animation-timing-function: ease-out', 'ANIMATION-COMPOSITION: add'])('passes a keyframe that also sets `%s`', (declaration) => {
    const { code, output } = gate('chrome.css', appending(`@keyframes salt-note {\n  from {\n    transform: scaleX(0);\n    ${declaration};\n  }\n}`))
    expect(output).toContain('PASS: ')
    expect(code).toBe(0)
  })

  it('passes a keyframe that moves only a transform', () => {
    const { code, output } = gate('chrome.css', appending('@keyframes salt-note {\n  from {\n    transform: scaleX(0);\n  }\n\n  62.5% {\n    transform: none;\n  }\n}'))
    expect(output).toContain('PASS: ')
    expect(code).toBe(0)
  })

  it('passes a role written in capitals, which CSS reads the same', () => {
    const { code, output } = gate('primitives.css', replacing('  font-size: var(--text-eyebrow);', '  FONT-SIZE: VAR(--text-eyebrow);'))
    expect(output).toContain('PASS: ')
    expect(code).toBe(0)
  })
})

/**
 * Every component core sets in a role keeps it (BD-185). The contract above refused a literal and half
 * a role and passed a role deleted or swapped for `body`, which is how a component falls back to the
 * body text MR-4 took buttons, menu links, captions, meta lines, a testimonial and the two standfirsts
 * off. Each case edits the component's own rule, found by where it is written and which role it reads.
 */
describe('each component keeps the role the contract names for it', () => {
  /* The component's own rule: the one block opening `head` that reads `role`, edited by `edit`. */
  const inRule = (head, role, edit) => (css) => {
    const starts = [...css.matchAll(new RegExp(`^${head.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{$`, 'gm'))].map((match) => match.index)
    const blocks = starts
      .map((start) => ({ start, end: css.indexOf('\n}', start) }))
      .filter(({ start, end }) => css.slice(start, end).includes(`var(--text-${role})`))
    expect(blocks).toHaveLength(1)
    const [{ start, end }] = blocks
    return css.slice(0, start) + edit(css.slice(start, end)) + css.slice(end)
  }
  const toBody = (role) => (block) => block.replaceAll(`--text-${role}`, '--text-body')
  const withoutRole = (role) => (block) =>
    block
      .split('\n')
      .filter((line) => !line.includes(`--text-${role}`))
      .join('\n')

  /* Selector as the gate names it, the file, the rule's head as written, and the role. */
  const COMPONENTS = [
    ['.salt-button', 'primitives.css', '.salt-button', 'label'],
    ['.salt-nav__link', 'chrome.css', '.salt-nav__link,\n.salt-nav__sublink', 'label'],
    ['.salt-header__phone', 'chrome.css', '.salt-header__phone', 'label'],
    ['.salt-gallery__caption', 'blocks.css', '.salt-gallery__caption', 'caption'],
    ['.salt-showcase__meta', 'blocks.css', '.salt-showcase__meta', 'small'],
    ['.salt-showcase__quote .salt-showcase__text', 'blocks.css', '.salt-showcase__quote .salt-showcase__text', 'quote'],
    ['.salt-intro', 'primitives.css', '.salt-intro', 'lead'],
    ['.salt-hero__subheading', 'blocks.css', '.salt-hero__subheading', 'lead'],
    ['.salt-footer__link', 'chrome.css', '.salt-footer__link', 'small'],
    ['.salt-pagination__link', 'primitives.css', '.salt-pagination__link,\n.salt-pagination__gap', 'label'],
    ['.salt-share__link', 'primitives.css', '.salt-share__link,\n.salt-copy-link__button', 'label'],
    ['.salt-rich-text blockquote', 'primitives.css', '.salt-rich-text blockquote', 'quote'],
    ['.salt-eyebrow', 'primitives.css', '.salt-eyebrow', 'eyebrow'],
    ['.salt-stat__value', 'blocks.css', '.salt-stat__value', 'stat'],
    ['.salt-hero__text > :is(h1, h2, h3, h4, h5, h6)', 'blocks.css', '.salt-hero__text > :is(h1, h2, h3, h4, h5, h6)', 'display'],
    ['.salt-card :is(h1, h2, h3, h4, h5, h6)', 'primitives.css', '.salt-card :is(h1, h2, h3, h4, h5, h6)', 'heading-4'],
    ['.salt-accordion__summary', 'primitives.css', '.salt-accordion__summary', 'heading-4'],
    ['.salt-consent-panel__title', 'primitives.css', '.salt-consent-panel__title', 'heading-4'],
    ['.salt-logo__wordmark', 'chrome.css', '.salt-logo__wordmark', 'heading-4'],
    ['.salt-tabs__label', 'primitives.css', '.salt-tabs__label', 'label'],
    ['.salt-contact__label', 'primitives.css', '.salt-contact__label', 'label'],
    ['.salt-footer__title', 'chrome.css', '.salt-footer__title', 'heading-4'],
    ['.salt-case-study-view__detail-label', 'primitives.css', '.salt-case-study-view__detail-label', 'label'],
  ]

  itEach(COMPONENTS)('fails `%s` swapped from its role to `body`', (selector, file, head, role) => {
    const { code, output } = gate(file, inRule(head, role, toBody(role)))
    expect(output).toContain(`\`${selector}\` in ${file} is set in \`body\`; the contract names \`${role}\` for it`)
    expect(code).toBe(1)
  })

  /* The eleven rules BD-185 adds, each with its role deleted outright, which leaves nothing the first
     contract reads. */
  itEach(COMPONENTS.slice(0, 11))('fails `%s` with its role deleted', (selector, file, head, role) => {
    const { code, output } = gate(file, inRule(head, role, withoutRole(role)))
    expect(output).toContain(`no rule sets \`${selector}\` in ${file} in \`${role}\`, so it falls back to the body text`)
    expect(code).toBe(1)
  })

  /* BD-178: a detail's label, with nothing else to set its text, falls back to the body text. */
  it('fails a case study detail’s label with its role deleted', () => {
    const { code, output } = gate('primitives.css', inRule('.salt-case-study-view__detail-label', 'label', withoutRole('label')))
    expect(output).toContain('no rule sets `.salt-case-study-view__detail-label` in primitives.css in `label`, so it falls back to the body text')
    expect(code).toBe(1)
  })

  itEach([
    ['.salt-pagination__gap', '.salt-pagination__link,\n.salt-pagination__gap {\n  font-size', '.salt-pagination__link {\n  font-size'],
    ['.salt-copy-link__button', '.salt-share__link,\n.salt-copy-link__button {\n  font-size', '.salt-share__link {\n  font-size'],
  ])('fails `%s` when its shared rule drops it', (selector, from, to) => {
    const { code, output } = gate('primitives.css', replacing(from, to))
    expect(output).toContain(`no rule sets \`${selector}\` in primitives.css in \`label\``)
    expect(code).toBe(1)
  })

  /* #198 review, F4: a subject naming no class reached a component unseen. */
  itEach([
    ['a menu link reached by its element (#198 review, F4)', 'chrome.css', '.salt-nav a'],
    ['a paragraph in rich text', 'primitives.css', '.salt-rich-text p'],
    ['a heading of any level in a card, spelt another way', 'primitives.css', '.salt-card h3'],
  ])('fails %s', (_case, file, selector) => {
    const { code, output } = gate(file, appending(`${selector} {\n${['font-size: var(--text-body)', 'line-height: var(--text-body--line-height)', 'letter-spacing: var(--text-body--letter-spacing)', 'font-weight: var(--text-body--font-weight)', 'font-family: var(--text-body--font-family)'].map((d) => `  ${d};`).join('\n')}\n}`))
    expect(output).toContain(`\`${selector}\` in ${file} sets \`font-size\` on an element it names by no class`)
    expect(code).toBe(1)
  })

  /* #198 re-review, F4: a class written only inside `:not()` or `:where()`, or in one branch of `:is()`, is
     not one the element must carry, and each of these reaches every menu link. */
  itEach([['.salt-nav a:not(.salt-x)'], ['.salt-nav :is(a, .salt-x)'], ['.salt-nav :where(.salt-nav__link)']])(
    'fails `%s` setting a weight through a class it does not require',
    (selector) => {
      const { code, output } = gate('chrome.css', appending(`${selector} {\n  font-weight: var(--weight-regular);\n}`))
      expect(output).toContain(`\`${selector}\` in chrome.css sets \`font-weight\` on an element it names by no class`)
      expect(code).toBe(1)
    },
  )

  it('still reads a class every branch of `:is()` requires', () => {
    const { code, output } = gate('chrome.css', appending('.salt-nav :is(.salt-nav__link.salt-x, .salt-nav__link) {\n  font-weight: var(--weight-regular);\n}'))
    expect(output).toContain('which `.salt-nav__link` in chrome.css sets in `label`')
    expect(code).toBe(1)
  })

  it('fails `.salt-nav__sublink` when the menu rule names the top-level link alone', () => {
    const { code, output } = gate('chrome.css', replacing('.salt-nav__link,\n.salt-nav__sublink {\n  font-size', '.salt-nav__link {\n  font-size'))
    expect(output).toContain('no rule sets `.salt-nav__sublink` in chrome.css in `label`')
    expect(code).toBe(1)
  })

  itEach([
    [
      'the role only inside a query',
      'blocks.css',
      inRule('.salt-hero__subheading', 'lead', (block) => `@media (min-width: 48rem) {\n${block}\n}`),
      '`.salt-hero__subheading` in blocks.css is set in a role only inside `@media (min-width: 48rem)`',
    ],
    [
      'the role on a `:where()` of the class, which a site’s `p` rule outranks',
      'primitives.css',
      inRule('.salt-intro', 'lead', (block) => block.replace('.salt-intro {', ':where(.salt-intro) {')),
      '`:where(.salt-intro)` in primitives.css sets `font-size` on an element it names by no class',
    ],
    [
      'a literal in place of the role',
      'blocks.css',
      inRule('.salt-gallery__caption', 'caption', (block) => block.replace('font-size: var(--text-caption);', 'font-size: 0.75rem;')),
      '`.salt-gallery__caption` in blocks.css writes `font-size: 0.75rem`, a spelling this contract does not read as a role',
    ],
    [
      'the role read with a fallback',
      'primitives.css',
      inRule('.salt-intro', 'lead', (block) => block.replace('font-size: var(--text-lead);', 'font-size: var(--text-lead, 1.2rem);')),
      '`.salt-intro` in primitives.css writes `font-size: var(--text-lead, 1.2rem)`, a spelling this contract does not read as a role',
    ],
    [
      'the role `!important`, which is not claimed missing',
      'chrome.css',
      inRule('.salt-nav__link,\n.salt-nav__sublink', 'label', (block) => block.replace('font-size: var(--text-label);', 'font-size: var(--text-label) !important;')),
      '`.salt-nav__link` in chrome.css declares `font-size` !important, which no contract here can rank',
    ],
    [
      'a weight rung `!important` on a state',
      'chrome.css',
      appending(".salt-nav__link[data-note] {\n  font-weight: var(--weight-bold) !important;\n}"),
      "declares `font-weight` !important on `.salt-nav__link[data-note]`, which no contract here can rank",
    ],
    [
      'a role property on the wrong CSS property',
      'blocks.css',
      inRule('.salt-hero__subheading', 'lead', (block) => block.replace('line-height: var(--text-lead--line-height);', 'line-height: var(--text-lead);')),
      "`.salt-hero__subheading` in blocks.css sets `line-height` from `var(--text-lead)`, which is `lead`'s `font-size`",
    ],
    [
      'a property of the role missing',
      'blocks.css',
      inRule('.salt-showcase__meta', 'small', (block) => block.replace('\n  font-family: var(--text-small--font-family);', '')),
      '`.salt-showcase__meta` in blocks.css does not set `font-family`; the contract names `small` for it, all five',
    ],
    [
      'a second rule of its own in another role',
      'blocks.css',
      appending(
        `.salt-showcase__meta {\n${['font-size: var(--text-body)', 'line-height: var(--text-body--line-height)', 'letter-spacing: var(--text-body--letter-spacing)', 'font-weight: var(--text-body--font-weight)', 'font-family: var(--text-body--font-family)'].map((d) => `  ${d};`).join('\n')}\n}`,
      ),
      '`.salt-showcase__meta` in blocks.css is set in `body`; the contract names `small` for it',
    ],
    [
      'another rule taking a button back to the body text',
      'blocks.css',
      appending(
        `.salt-cta .salt-button {\n${['font-size: var(--text-body)', 'line-height: var(--text-body--line-height)', 'letter-spacing: var(--text-body--letter-spacing)', 'font-weight: var(--text-body--font-weight)', 'font-family: var(--text-body--font-family)'].map((d) => `  ${d};`).join('\n')}\n}`,
      ),
      "sets `font-size: var(--text-body)` on `.salt-cta .salt-button`, which `.salt-button` in primitives.css sets in `label`",
    ],
    [
      'another rule resizing a menu link',
      'chrome.css',
      appending(".salt-nav__link[aria-current='page'] {\n  letter-spacing: var(--text-body--letter-spacing);\n}"),
      "on `.salt-nav__link[aria-current='page']`, which `.salt-nav__link` in chrome.css sets in `label`",
    ],
  ])('fails %s', (_case, file, mutate, message) => {
    const { code, output } = gate(file, mutate)
    expect(output).toContain(message)
    expect(code).toBe(1)
  })

  /* No weight for a state (Ollie's ruling of 28/09/2026, and #198 review, F1): the first version excused
     any `--weight-*` rung on a rule naming the component, and the two review cases passed with it. */
  itEach([
    ['a weight rung on a component for a state', 'primitives.css', appending(".salt-button[aria-pressed='true'] {\n  font-weight: var(--weight-bold);\n}"), "sets `font-weight: var(--weight-bold)` on `.salt-button[aria-pressed='true']`, which `.salt-button` in primitives.css sets in `label`"],
    ['a weight on a menu link inside a query (#198 review, F1)', 'chrome.css', appending('@media (min-width: 48rem) {\n  .salt-nav__link {\n    font-weight: var(--weight-regular);\n  }\n}'), 'sets `font-weight: var(--weight-regular)` on `.salt-nav__link`, which `.salt-nav__link` in chrome.css sets in `label`'],
    ['a weight on a button inside a band (#198 review, F1)', 'blocks.css', appending('.salt-hero .salt-button {\n  font-weight: var(--weight-regular);\n}'), 'sets `font-weight: var(--weight-regular)` on `.salt-hero .salt-button`, which `.salt-button` in primitives.css sets in `label`'],
    ['the current menu item made bold again', 'chrome.css', replacing(".salt-nav__sublink[aria-current='page'] {\n  text-decoration: underline;", ".salt-nav__sublink[aria-current='page'] {\n  font-weight: var(--weight-bold);\n  text-decoration: underline;"), "sets `font-weight: var(--weight-bold)` on `.salt-nav__link[aria-current='page']`"],
    ['the current page number made bold again', 'primitives.css', replacing(".salt-pagination__link[aria-current='page'] {\n  border-color: currentColor;", ".salt-pagination__link[aria-current='page'] {\n  border-color: currentColor;\n  font-weight: var(--weight-bold);"), "sets `font-weight: var(--weight-bold)` on `.salt-pagination__link[aria-current='page']`"],
  ])('fails %s', (_case, file, mutate, message) => {
    const { code, output } = gate(file, mutate)
    expect(output).toContain(message)
    expect(code).toBe(1)
  })
})

/**
 * The case study view's gaps (BD-179, the mirrored row MR-8). Each case writes back a shape that
 * puts a join back to 0px or takes it off the tokens: a gap deleted or respelled, a length of its
 * own, the owl dropped to a specificity `.salt-grid`'s `margin: 0` beats, a shorthand after the
 * longhand, the reset moved after the owls, and a later rule zeroing or outranking a gap.
 */
describe('the case study view spaces its header and its sections', () => {
  const SECTION_GAP = '.salt-case-study-view > .salt-case-study-view__section > * + * {\n  margin-block-start: var(--space-4);\n}'
  const HEADER_OWL = '.salt-case-study-view > .salt-case-study-view__header > * + *,\n.salt-case-study-view > .salt-case-study-view__header > .salt-section__content > * + *,\n.salt-case-study-view > .salt-case-study-view__section > * + * {'
  itEach([
    ['the gap above each section deleted', replacing('.salt-case-study-view > * + * {\n  margin-block-start: var(--space-section-sm);\n}', ''), 'no unconditional `.salt-case-study-view > * + *` rule'],
    ['a gap written as a length', replacing('  margin-block-start: var(--space-section-sm);', '  margin-block-start: 3rem;'), 'writes `margin-block-start: 3rem` for the gap above each section, a length of its own'],
    ['a gap on another token', replacing('__details {\n  margin-block-start: var(--space-8);', '__details {\n  margin-block-start: var(--space-12);'), 'write `var(--space-8)`, the token this contract compares'],
    ['a gap !important', replacing('  margin-block-start: var(--space-section-sm);', '  margin-block-start: var(--space-section-sm) !important;'), 'declares `margin-block-start` !important'],
    ['the owls dropped to (0,1,0)', replacing(HEADER_OWL, '.salt-case-study-view__header > * + *,\n.salt-case-study-view__header > .salt-section__content > * + *,\n.salt-case-study-view__section > * + * {'), 'no unconditional `.salt-case-study-view > .salt-case-study-view__header > * + *` rule'],
    ['a shorthand after the longhand', replacing('__details {\n  margin-block-start: var(--space-8);\n', '__details {\n  margin-block-start: var(--space-8);\n  margin: 0;\n'), 'writes `margin: 0` beside the gap above the results'],
    ['the reset moved after the owls', (css) => appending('.salt-case-study-view > .salt-case-study-view__header > *,\n.salt-case-study-view > .salt-case-study-view__header > .salt-section__content > *,\n.salt-case-study-view > .salt-case-study-view__section > h2,\n.salt-case-study-view__detail-value {\n  margin: 0;\n}')(replacing('.salt-case-study-view > .salt-case-study-view__header > *,\n.salt-case-study-view > .salt-case-study-view__header > .salt-section__content > *,\n.salt-case-study-view > .salt-case-study-view__section > h2,\n.salt-case-study-view__detail-value {\n  margin: 0;\n}', '')(css)), 'comes after'],
    ['a later rule zeroing a gap', appending('.salt-case-study-view .salt-rich-text {\n  margin-block-start: 0;\n}'), 'only the gaps MR-8 owes and the reset before them set a block margin there'],
    ['a padding length on the view', appending('.salt-case-study-view__client {\n  padding-block: 4px;\n}'), 'a length of its own'],
    ['a length inside calc()', replacing('  margin-block-start: var(--space-4);\n}\n\n.salt-case-study-view > .salt-case-study-view__header > .salt-case-study-view__results', '  margin-block-start: calc(var(--space-4) + 1rem);\n}\n\n.salt-case-study-view > .salt-case-study-view__header > .salt-case-study-view__results'), 'writes `margin-block-start: calc(var(--space-4) + 1rem)`'],
    /* #201 review, 1: a physical longhand sets the same edge, and the first version never read it. */
    ['`margin-top: 0` inside a pinned rule', replacing('__details {\n  margin-block-start: var(--space-8);\n', '__details {\n  margin-block-start: var(--space-8);\n  margin-top: 0;\n'), 'writes `margin-top: 0` beside the gap above the results'],
    ['`all` on the view', appending('.salt-case-study-view__client {\n  all: unset;\n}'), 'writes `all: unset`'],
    /* #201 review, 2: spellings that may compute the same, which the gate does not evaluate. */
    ['a gap as `calc(var(--spacing)*4)`', replacing('  margin-block-start: var(--space-4);', '  margin-block-start: calc(var(--spacing)*4);'), 'a spelling this contract does not read; it compares one `var()`, so write `var(--space-4)`'],
    ['a gap as `calc(4 * var(--spacing))`', replacing('  margin-block-start: var(--space-4);', '  margin-block-start: calc(4 * var(--spacing));'), 'a spelling this contract does not read'],
    ['a gap with a fallback', replacing('__details {\n  margin-block-start: var(--space-8);', '__details {\n  margin-block-start: var(--space-8, var(--space-12));'), 'a spelling this contract does not read'],
    /* BD-178: the details are a band of their own under the results, and their `<dd>` loses the
       user agent's 40px indent only through the reset. */
    [
      'the gap above the details deleted',
      replacing(',\n.salt-case-study-view > .salt-case-study-view__header > .salt-case-study-view__details,\n', ',\n'),
      'no unconditional `.salt-case-study-view > .salt-case-study-view__header > .salt-case-study-view__details` rule',
    ],
    [
      'the details’ values dropped from the reset',
      replacing('.salt-case-study-view > .salt-case-study-view__section > h2,\n.salt-case-study-view__detail-value {', '.salt-case-study-view > .salt-case-study-view__section > h2 {'),
      'writes `margin: 0` on the case study view; only the gaps MR-8 owes',
    ],
    ['a gap naming the token in capitals, which is another property', replacing('__details {\n  margin-block-start: var(--space-8);', '__details {\n  margin-block-start: var(--SPACE-8);'), 'write `var(--space-8)`, the token this contract compares'],
    /* BD-202: the title off the site header, the article's own padding. */
    ['the gap under the site header deleted', replacing('.salt-case-study-view {\n  padding-block-start: var(--space-section-md);\n}', ''), 'no unconditional `.salt-case-study-view` rule'],
    ['the gap under the site header as a length', replacing('  padding-block-start: var(--space-section-md);', '  padding-block-start: 3rem;'), 'writes `padding-block-start: 3rem` for the gap between the site header and the title, a length of its own'],
    ['the gap under the site header on another token', replacing('  padding-block-start: var(--space-section-md);', '  padding-block-start: var(--space-section-sm);'), 'write `var(--space-section-md)`, the token this contract compares'],
    ['a shorthand beside the article’s padding', replacing('  padding-block-start: var(--space-section-md);', '  padding-block-start: var(--space-section-md);\n  padding: 0;'), 'writes `padding: 0` beside the gap between the site header and the title'],
    ['the article’s padding zeroed by an outranking rule', appending('main > .salt-case-study-view {\n  padding-block: 0;\n}'), "writes `padding-block: 0` on the case study view's article"],
    /* BD-202: a section's heading off a heading opening its rich text. */
    ['the gap over an opening heading deleted', replacing('.salt-case-study-view > .salt-case-study-view__section > h2 + .salt-rich-text:has(> :first-child:is(h3, h4, h5, h6)) {\n  margin-block-start: var(--space-8);\n}', ''), 'no unconditional `.salt-case-study-view > .salt-case-study-view__section > h2 + .salt-rich-text:has(> :first-child:is(h3, h4, h5, h6))` rule'],
    ['the gap over an opening heading back on the section owl’s token', replacing(':first-child:is(h3, h4, h5, h6)) {\n  margin-block-start: var(--space-8);', ':first-child:is(h3, h4, h5, h6)) {\n  margin-block-start: var(--space-4);'), 'for the gap between a section’s heading and a heading opening its rich text; write `var(--space-8)`'],
    /* BD-206: a header drawn as a band. */
    ['the band’s zero for the article’s padding deleted', replacing(".salt-case-study-view[data-header='band'] {\n  padding-block-start: var(--space-0);\n}", ''), "no unconditional `.salt-case-study-view[data-header='band']` rule"],
    ['the band’s zero for the article’s padding on another token', replacing('  padding-block-start: var(--space-0);', '  padding-block-start: var(--space-4);'), 'write `var(--space-0)`, the token this contract compares'],
    ['the band’s lines left out of the owl', replacing('.salt-case-study-view > .salt-case-study-view__header > .salt-section__content > * + *,\n', ''), 'no unconditional `.salt-case-study-view > .salt-case-study-view__header > .salt-section__content > * + *` rule'],
    ['the band’s lines left out of the reset', replacing('.salt-case-study-view > .salt-case-study-view__header > .salt-section__content > *,\n', ''), 'only the gaps MR-8 owes and the reset before them set a block margin there'],
    /* #226 review, 5: the band's content centred again after the reset. */
    ['the band’s centring deleted', replacing('.salt-case-study-view > .salt-case-study-view__header > .salt-section__content {\n  margin-inline: auto;\n}', ''), 'gives a header band’s content'.replace('’', "'")],
    ['the band’s centring as a length', replacing('  margin-inline: auto;\n}\n\n/*\n * (0,2,0), and it has to be', '  margin-inline: 0;\n}\n\n/*\n * (0,2,0), and it has to be'), 'write `auto`'],
    ['the band’s centring !important', replacing('  margin-inline: auto;\n}\n\n/*\n * (0,2,0), and it has to be', '  margin-inline: AUTO !important;\n}\n\n/*\n * (0,2,0), and it has to be'), 'declares `margin-inline` !important'],
    ['the band’s centring as physical margins', replacing('  margin-inline: auto;\n}\n\n/*\n * (0,2,0), and it has to be', '  margin-left: auto;\n}\n\n/*\n * (0,2,0), and it has to be'), 'a spelling this contract does not read; it reads `margin-inline: auto`'],
    ['the band’s centring through a var()', replacing('  margin-inline: auto;\n}\n\n/*\n * (0,2,0), and it has to be', '  margin-inline: var(--x);\n}\n\n/*\n * (0,2,0), and it has to be'), 'a spelling this contract does not read; it reads `auto`'],
    ['the band’s centring overridden by a later rule', appending('.salt-case-study-view > .salt-case-study-view__header > .salt-section__content {\n  margin-inline: 0;\n}'), 'on a header band’s content'.replace('’', "'")],
    /* The section 7 row BD-202 closes: a zero spelled as a token or a `calc()`, and a rule naming the
       view that outranks a gap without repeating its selector. Each rendered a wrong gap and passed. */
    ['a zero spelled as a token', appending('.salt-case-study-view__section > .salt-rich-text {\n  margin-block-start: var(--space-0);\n}'), 'writes `margin-block-start: var(--space-0)` on the case study view; only the gaps MR-8 owes'],
    ['a zero spelled as a calc()', appending('.salt-case-study-view__section > .salt-rich-text {\n  margin-block-start: calc(var(--space-8) * 0);\n}'), 'writes `margin-block-start: calc(var(--space-8) * 0)` on the case study view; only the gaps MR-8 owes'],
    ['a rule outranking the article owl without repeating it', appending('.salt-case-study-view > .salt-case-study-view__section {\n  margin-block-start: var(--space-8);\n}'), 'writes `margin-block-start: var(--space-8)` on the case study view; only the gaps MR-8 owes'],
  ])('fails %s', (_case, mutate, message) => {
    const { code, output } = gate('primitives.css', mutate)
    expect(output).toContain(message)
    expect(code).toBe(1)
  })

  /* #201 review, 1: a rule repeating a pinned selector in another stylesheet was skipped whole. */
  itEach([
    ['the section owl zeroed in blocks.css', 'blocks.css', appending('.salt-case-study-view > .salt-case-study-view__section > * + * {\n  margin-block-start: 0;\n}'), 'in blocks.css writes `margin-block-start: 0` on a gap MR-8 owes'],
    ['the article owl retuned inside a query', 'chrome.css', appending('@media (max-width: 40rem) {\n  .salt-case-study-view > * + * {\n    margin-top: var(--space-8);\n  }\n}'), 'inside `@media (max-width: 40rem)` in chrome.css writes `margin-top: var(--space-8)` on a gap MR-8 owes'],
    ['the article’s padding zeroed in blocks.css', 'blocks.css', appending('.salt-case-study-view {\n  padding-top: 0;\n}'), 'in blocks.css writes `padding-top: 0` on a gap MR-8 owes'],
  ])('fails %s', (_case, file, mutate, message) => {
    const { code, output } = gate(file, mutate)
    expect(output).toContain(message)
    expect(code).toBe(1)
  })

  it('fails a gap zeroed from another stylesheet', () => {
    const { code, output } = gate('blocks.css', appending('.salt-case-study-view > .salt-case-study-view__section > * {\n  margin: 0;\n}'))
    expect(output).toContain('in blocks.css writes `margin: 0`')
    expect(code).toBe(1)
  })

  /* #222 review, 1 and 2: an inline margin, or padding on a part that is not the article, moves no gap. */
  itEach([
    ['a summary centred with an inline margin', appending('.salt-case-study-view__summary {\n  margin-inline: auto;\n}')],
    ['a summary centred, cased differently', appending('.salt-case-study-view__summary {\n  MARGIN-LEFT: auto;\n}')],
    ['padding on the project details, a pinned gap that is a margin', appending('.salt-case-study-view > .salt-case-study-view__header > .salt-case-study-view__details {\n  padding-block-start: var(--space-4);\n}')],
  ])('passes %s', (_case, mutate) => {
    const { code, output } = gate('primitives.css', mutate)
    expect(output).toContain('PASS: ')
    expect(code).toBe(0)
  })

  itEach([
    ['a block-end margin on a part', appending('.salt-case-study-view__client {\n  margin-block-end: var(--space-8);\n}'), 'writes `margin-block-end: var(--space-8)` on the case study view; only the gaps MR-8 owes'],
    ['a block-end margin, cased differently', appending('.salt-case-study-view__client {\n  Margin-Bottom: var(--space-8);\n}'), 'writes `Margin-Bottom: var(--space-8)` on the case study view'],
    ['an inline margin !important', appending('.salt-case-study-view__summary {\n  margin-inline: auto !important;\n}'), 'declares `margin-inline` !important'],
    ['a margin spelling the contract does not read', appending('.salt-case-study-view__client {\n  margin-trim: block;\n}'), 'a margin this contract does not read'],
    ['a prefixed margin', appending('.salt-case-study-view__client {\n  -webkit-margin-before: 0;\n}'), 'a spelling this contract does not read'],
    ['padding on the article repeated', appending('.salt-case-study-view {\n  padding-block: 0;\n}'), 'writes `padding-block: 0` on a gap MR-8 owes'],
    /* #222 re-review: the article's gap is a padding, so a margin on it is a block margin, not its gap. */
    ['a margin shorthand on the article', appending('.salt-case-study-view {\n  margin: 0 auto;\n}'), 'writes `margin: 0 auto` on the case study view; only the gaps MR-8 owes and the reset before them set a block margin there'],
    ['a block-start margin on the article', appending('.salt-case-study-view {\n  margin-top: var(--space-8);\n}'), 'writes `margin-top: var(--space-8)` on the case study view; only the gaps MR-8 owes and the reset before them set a block margin there'],
  ])('fails %s', (_case, mutate, message) => {
    const { code, output } = gate('primitives.css', mutate)
    expect(output).toContain(message)
    expect(code).toBe(1)
  })

  it('passes a gap spaced and cased differently, which CSS reads the same', () => {
    const { code, output } = gate('primitives.css', replacing(SECTION_GAP, SECTION_GAP.replace('var(--space-4)', 'VAR( --space-4 )')))
    expect(output).toContain('PASS: ')
    expect(code).toBe(0)
  })
})

/**
 * The card rhythm (BD-195, the mirrored row MR-9). Each case writes back a shape that puts a card
 * back to one flat gap or takes a join off its token: the gap on the card, a join deleted, written as
 * a length or on another token, the reset after the joins, a later rule moving a join's edge, and the
 * grid of cards' row gap as a length, a shorthand, a second rule or a token the token layer no longer names.
 */
describe('a card groups its parts by proximity, in the card-rhythm tokens', () => {
  const CARD = ".salt-grid .salt-card,\n.salt-block[data-block='carousel'] .salt-card {\n  display: flex;\n  flex-direction: column;\n"
  const RESET = ".salt-grid .salt-card > *,\n.salt-block[data-block='carousel'] .salt-card > * {\n  margin-block: 0;\n}"
  const MEDIA = ".salt-grid .salt-card > :is(.salt-showcase__media, .salt-icon) + *,\n.salt-block[data-block='carousel'] .salt-card > :is(.salt-showcase__media, .salt-icon) + * {\n  margin-block-start: var(--space-card-media);\n}"
  itEach([
    ['the flat gap written back on the card', replacing(CARD, `${CARD}  gap: 0.75rem;\n`), 'writes `gap: 0.75rem` on the card, which adds to every join'],
    ['the join after the picture deleted', replacing(MEDIA, ''), 'no unconditional `.salt-grid .salt-card > :is(.salt-showcase__media, .salt-icon) + *` rule in blocks.css opens the gap after a card’s picture'],
    ['a body join written as a length', replacing('  margin-block-start: var(--space-card-body);', '  margin-block-start: 0.75rem;'), 'writes `margin-block-start: 0.75rem` for the gap between a card’s body parts, a length of its own'],
    ['the title join on the body’s token', replacing('  margin-block-start: var(--space-card-title);', '  margin-block-start: var(--space-card-body);'), 'write `var(--space-card-title)`, the card-rhythm token for that join'],
    ['a join !important', replacing('  margin-block-start: var(--space-card-media);', '  margin-block-start: var(--space-card-media) !important;'), 'declares `margin-block-start` !important'],
    ['a join as a `calc()`', replacing('  margin-block-start: var(--space-card-body);', '  margin-block-start: calc(var(--space-card-body) * 1);'), 'a spelling this contract does not read; write `var(--space-card-body)`'],
    ['a shorthand beside a join', replacing('  margin-block-start: var(--space-card-media);\n', '  margin-block-start: var(--space-card-media);\n  margin: 0;\n'), 'writes `margin: 0` beside the gap after a card’s picture'],
    ['the reset moved after the joins', (css) => appending(RESET)(replacing(RESET, '')(css)), 'comes after the card’s joins in blocks.css'],
    ['a later rule moving a join’s edge', appending('.salt-grid .salt-card > * + * {\n  margin-top: 0;\n}'), 'writes `margin-top: 0` on a card join MR-9 owes'],
    ['the row gap as a length', replacing('  row-gap: var(--space-card-row);', '  row-gap: 2.5rem;'), 'writes `row-gap: 2.5rem`, a length of its own'],
    ['the row gap as the `gap` shorthand', replacing('  row-gap: var(--space-card-row);', '  gap: var(--space-card-row);'), 'must set `row-gap` alone, once; it writes `gap`'],
    ['the row gap on another token', replacing('  row-gap: var(--space-card-row);', '  row-gap: var(--space-card-body);'), 'write `var(--space-card-row)`, the gap between rows of cards'],
    ['the row gap deleted', replacing('.salt-grid:has(> li > .salt-card) {\n  row-gap: var(--space-card-row);\n}', ''), 'no unconditional `.salt-grid:has(> li > .salt-card)` rule in blocks.css'],
    ['a second rule retuning the row gap', appending('@media (max-width: 40rem) {\n  .salt-grid:has(> li > .salt-card) {\n    row-gap: 1rem;\n  }\n}'), 'a second `.salt-grid:has(> li > .salt-card)` rule inside `@media (max-width: 40rem)` sets a gap'],
  ])('fails %s', (_case, mutate, message) => {
    const { code, output } = gate('blocks.css', mutate)
    expect(output).toContain(message)
    expect(code).toBe(1)
  })

  it('fails a join’s edge moved from another stylesheet', () => {
    const { code, output } = gate('chrome.css', appending(".salt-block[data-block='carousel'] .salt-card > * + * {\n  margin-block-start: 0;\n}"))
    expect(output).toContain('in chrome.css writes `margin-block-start: 0` on a card join MR-9 owes')
    expect(code).toBe(1)
  })

  /* The conditional path: a rule inside a query is read as well as one outside (#211 review, 8). */
  it('fails a join’s edge moved from another stylesheet, inside a query', () => {
    const { code, output } = gate('chrome.css', appending("@media (max-width: 40rem) {\n  .salt-block[data-block='carousel'] .salt-card > * + * {\n    margin-block-start: 0;\n  }\n}"))
    expect(output).toContain("inside `@media (max-width: 40rem)` in chrome.css writes `margin-block-start: 0` on a card join MR-9 owes")
    expect(code).toBe(1)
  })

  it('fails a card-rhythm token the token layer no longer names', () => {
    const { code, output } = gate('contract/token-layer.json', withoutToken('--space-card-row'))
    expect(output).toContain('contract/token-layer.json names no `--space-card-row`, which the card rhythm reads')
    expect(code).toBe(1)
  })

  it('passes a join spaced and cased differently, which CSS reads the same', () => {
    const { code, output } = gate('blocks.css', replacing('  margin-block-start: var(--space-card-media);', '  margin-block-start: VAR( --space-card-media );'))
    expect(output).toContain('PASS: ')
    expect(code).toBe(0)
  })
})

/* The arrow's direction (BD-195, #211 review 4): each rule removed, reordered or retuned fails by name. */
describe('the arrow points the way its line reads', () => {
  const RTL = ".salt-arrow:dir(rtl) > .salt-icon {\n  scale: -1 1;\n}"
  const LTR = '.salt-arrow:dir(ltr) > .salt-icon {\n  scale: none;\n}'
  const ISLAND = ":where([dir='rtl']) [dir='ltr'] .salt-arrow > .salt-icon {\n  scale: none;\n}"
  itEach([
    ['the `:dir(rtl)` rule deleted', replacing(RTL, ''), 'no unconditional `.salt-arrow:dir(rtl) > .salt-icon` rule of its own'],
    ['the attribute fallback deleted', replacing("[dir='rtl'] .salt-arrow > .salt-icon {\n  scale: -1 1;\n}", ''), "no unconditional `[dir='rtl'] .salt-arrow > .salt-icon` rule of its own"],
    ['the mirror given another value', replacing(RTL, RTL.replace('scale: -1 1', 'scale: 1 -1')), 'writes `scale: 1 -1`; write `scale: -1 1`'],
    ['the left-to-right undo moved before the mirror', (css) => replacing(RTL, `${LTR}\n\n${RTL}`)(replacing(LTR, '')(css)), 'the `:dir(ltr)` rule comes before a rule mirroring the arrow'],
    ['the island fallback deleted', replacing(ISLAND, ''), "no unconditional `:where([dir='rtl']) [dir='ltr'] .salt-arrow > .salt-icon` rule of its own"],
    ['the island fallback moved after `:dir(rtl)`', (css) => replacing(LTR, `${ISLAND}\n\n${LTR}`)(replacing(ISLAND, '')(css)), 'the `:dir(rtl)` rule comes before the `[dir=\'ltr\']` island rule'],
    ['the two direction rules folded into one list', (css) => replacing(RTL, ".salt-arrow:dir(rtl) > .salt-icon,\n[dir='rtl'] .salt-arrow > .salt-icon {\n  scale: -1 1;\n}")(replacing("[dir='rtl'] .salt-arrow > .salt-icon {\n  scale: -1 1;\n}", '')(css)), "no unconditional `[dir='rtl'] .salt-arrow > .salt-icon` rule of its own"],
  ])('fails %s', (_case, mutate, message) => {
    const { code, output } = gate('primitives.css', mutate)
    expect(output).toContain(message)
    expect(code).toBe(1)
  })
})

/* What BD-195 depends on and a tidy-up could remove with everything green (#211 review, 7). */
describe('the card reset, the arrow’s line and colour, and the footer link floor are held', () => {
  const RESET = ".salt-grid .salt-card > *,\n.salt-block[data-block='carousel'] .salt-card > * {\n  margin-block: 0;\n}"
  const FIRST = ".salt-grid .salt-card > .salt-rich-text > :first-child,\n.salt-block[data-block='carousel'] .salt-card > .salt-rich-text > :first-child {\n  margin-block-start: 0;\n}"
  const COLOUR = ".salt-grid .salt-arrow > .salt-icon,\n.salt-block[data-block='carousel'] .salt-arrow > .salt-icon {\n  color: inherit;\n}"
  itEach([
    ['blocks.css', 'the card reset deleted', replacing(RESET, ''), 'zeroes a card part’s own margins'.replace('’', "'")],
    ['blocks.css', 'the card reset set to a length', replacing(RESET, RESET.replace('margin-block: 0', 'margin-block: 0.5rem')), 'must leave both block margins at zero; it writes `margin-block: 0.5rem`'],
    ['blocks.css', 'the rich text’s first edge left alone', replacing(FIRST, ''), 'writes `margin-block-start: 0`, so with no CSS reset'],
    ['blocks.css', 'the arrow’s colour rule deleted', replacing(COLOUR, ''), "gives the arrow its words' colour"],
    ['blocks.css', 'the arrow given the brand token', replacing(COLOUR, COLOUR.replace('color: inherit', 'color: var(--color-brand)')), 'writes `color: var(--color-brand)`, a spelling this contract does not read; it reads `inherit` or `currentcolor`'],
    ['primitives.css', 'the arrow’s display deleted', replacing('  display: inline-block;\n  margin-inline-start: 0.3em;', '  margin-inline-start: 0.3em;'), 'must set `display` once, to `inline-block`; it sets it 0 times'],
    ['primitives.css', 'the arrow made a block', replacing('  display: inline-block;\n  margin-inline-start: 0.3em;', '  display: block;\n  margin-inline-start: 0.3em;'), 'writes `display: block`; write `inline-block`'],
    ['chrome.css', 'the lg footer floor written as a bare rem', replacing('    min-block-size: max(2rem, 24px);', '    min-block-size: 2rem;'), 'sets min-block-size to `2rem` with no px floor'],
    ['chrome.css', 'the lg footer floor under 24px', replacing('    min-block-size: max(2rem, 24px);', '    min-block-size: max(2rem, 20px);'), 'which never reaches 24 CSS px'],
    ['chrome.css', 'the base footer floor lowered to the lg row', replacing('  min-block-size: max(2.75rem, 24px);\n  color: inherit;\n  font-size: var(--text-small);', '  min-block-size: max(2rem, 24px);\n  color: inherit;\n  font-size: var(--text-small);'), 'below `lg` a link keeps the 44px touch floor'],
  ])('%s: fails %s', (file, _case, mutate, message) => {
    const { code, output } = gate(file, mutate)
    expect(output).toContain(message)
    expect(code).toBe(1)
  })
})

/*
 * The re-review's seven mutations (#211 re-review, 1): each overrides a pinned declaration from a rule
 * the first version of these contracts never read, a later one or a more specific one, and each left
 * the gate at exit 0. Each now fails, and so does the same override from another stylesheet or a query.
 */
describe('a pinned declaration overridden by a later or more specific rule fails', () => {
  itEach([
    ['primitives.css', 'the arrow made a block by a later rule', appending('.salt-arrow > .salt-icon {\n  display: block;\n}'), "writes `display: block` on the arrow's icon"],
    ['primitives.css', 'the button arrow made a block', replacing('  margin-inline-start: 0.625em;\n', '  display: block;\n  margin-inline-start: 0.625em;\n'), "`.salt-button .salt-arrow > .salt-icon` in primitives.css writes `display: block` on the arrow's icon"],
    ['blocks.css', 'the arrow given the brand colour by a later rule', appending('.salt-grid .salt-arrow > .salt-icon {\n  color: var(--color-brand);\n}'), "writes `color: var(--color-brand)` on the arrow's icon"],
    ['primitives.css', 'the right-to-left mirror undone by a later rule', appending('.salt-arrow:dir(rtl) > .salt-icon {\n  scale: none;\n}'), "writes `scale: none` on the arrow's icon, which the four direction rules alone set"],
    ['blocks.css', 'a card’s rich text given back a top margin', appending('.salt-grid .salt-card > .salt-rich-text > :first-child {\n  margin-block-start: 1em;\n}'), "writes `margin-block-start: 1em` on a card's rich text"],
    ['chrome.css', 'a second unconditional footer floor of 32px', appending('.salt-footer__link {\n  min-block-size: max(2rem, 24px);\n}'), 'below `lg` a link keeps the 44px touch floor'],
    ['chrome.css', 'the lg query flipped to max-width', replacing('@media (min-width: 64rem) {\n  .salt-footer__link', '@media (max-width: 64rem) {\n  .salt-footer__link'), 'outside `@media (min-width: 64rem)`; 32px rows are for 1024 CSS px up'],
    ['chrome.css', 'the arrow made a block from another stylesheet, inside a query', appending('@media (max-width: 40rem) {\n  .salt-card .salt-arrow > .salt-icon {\n    display: block;\n  }\n}'), "inside `@media (max-width: 40rem)` in chrome.css writes `display: block` on the arrow's icon"],
    ['chrome.css', 'a card part’s top margin set from another stylesheet', appending('.salt-grid .salt-card > .salt-showcase__text {\n  margin-block-start: 2rem;\n}'), "writes `margin-block-start: 2rem` on a card's part, which only the reset and the card-rhythm joins space"],
    ['blocks.css', 'a card part given a foot by a rule outranking the reset', appending('.salt-grid .salt-card > .salt-showcase__meta {\n  margin-block-end: 1rem;\n}'), "writes `margin-block-end: 1rem` on a card's part"],
  ])('%s: fails %s', (file, _case, mutate, message) => {
    const { code, output } = gate(file, mutate)
    expect(output).toContain(message)
    expect(code).toBe(1)
  })

  itEach([
    ['a lower-ranked rule setting the arrow’s display', 'primitives.css', appending('svg {\n  display: block;\n}')],
    ['a card part’s zero foot', 'blocks.css', appending('.salt-grid .salt-card > .salt-showcase__meta {\n  margin-block-end: 0;\n}')],
    ['the header phone’s own icon rule, which cannot reach an arrow', 'chrome.css', appending('.salt-header__phone > .salt-icon {\n  display: inline-block;\n  color: var(--color-brand);\n}')],
  ])('passes %s', (_case, file, mutate) => {
    const { code, output } = gate(file, mutate)
    expect(output).toContain('PASS: ')
    expect(code).toBe(0)
  })
})

/*
 * Spellings (#211 re-review, 2): an equivalent spelling passes, in any case; a wrong value fails with
 * what to write; a spelling the contract does not read, a `var()` or a `calc()`, fails as unread
 * rather than with an instruction that may be wrong; and the shared floor reader is case-insensitive
 * in all three contracts that read a floor.
 */
describe('the pins read equivalent spellings, and say so when they cannot', () => {
  const RESET = ".salt-grid .salt-card > *,\n.salt-block[data-block='carousel'] .salt-card > * {\n  margin-block: 0;\n}"
  const COLOUR_DECL = '  color: inherit;\n}'
  itEach([
    ['blocks.css', 'the arrow’s colour as `currentcolor`', replacing(COLOUR_DECL, '  color: currentcolor;\n}')],
    ['blocks.css', 'the arrow’s colour as `INHERIT`', replacing(COLOUR_DECL, '  color: INHERIT;\n}')],
    ['primitives.css', 'the arrow’s display as `INLINE-BLOCK`', replacing('  display: inline-block;\n  margin-inline-start: 0.3em;', '  display: INLINE-BLOCK;\n  margin-inline-start: 0.3em;')],
    ['primitives.css', 'the left-to-right undo as `scale: 1`', replacing('.salt-arrow:dir(ltr) > .salt-icon {\n  scale: none;', '.salt-arrow:dir(ltr) > .salt-icon {\n  scale: 1;')],
    ['primitives.css', 'the mirror as `scale: -1 1 1`', replacing('.salt-arrow:dir(rtl) > .salt-icon {\n  scale: -1 1;', '.salt-arrow:dir(rtl) > .salt-icon {\n  scale: -1 1 1;')],
    ['blocks.css', 'the reset as `margin-block: 0 0`', replacing(RESET, RESET.replace('margin-block: 0', 'margin-block: 0 0'))],
    ['blocks.css', 'the reset as its two longhands', replacing(RESET, RESET.replace('margin-block: 0', 'margin-block-start: 0;\n  margin-block-end: 0px'))],
    ['chrome.css', 'the footer floors in capitals', (css) => replacing('    min-block-size: max(2rem, 24px);', '    min-block-size: MAX(2REM, 24PX);')(replacing('  min-block-size: max(2.75rem, 24px);\n  color: inherit;\n  font-size: var(--text-small);', '  min-block-size: MAX(2.75REM, 24PX);\n  color: inherit;\n  font-size: var(--text-small);')(css))],
    ['chrome.css', 'the theme toggle’s floor in capitals', replacing('  min-inline-size: max(2.75rem, 24px);\n  min-block-size: max(2.75rem, 24px);\n  padding: 0;\n  background: none;', '  min-inline-size: MAX(2.75rem, 24PX);\n  min-block-size: max(2.75rem, 24px);\n  padding: 0;\n  background: none;')],
    ['primitives.css', 'the button’s floor in capitals', replacing('  min-block-size: max(2.75rem, 24px);\n  padding-inline: 1.25rem;', '  min-block-size: MAX(2.75rem, 24PX);\n  padding-inline: 1.25rem;')],
  ])('%s: passes %s', (file, _case, mutate) => {
    const { code, output } = gate(file, mutate)
    expect(output).toContain('PASS: ')
    expect(code).toBe(0)
  })

  itEach([
    ['blocks.css', 'the arrow’s colour as a `var()`', replacing(COLOUR_DECL, '  color: var(--arrow);\n}'), 'writes `color: var(--arrow)`, a spelling this contract does not read; it reads `inherit` or `currentcolor`'],
    ['primitives.css', 'the arrow’s display as a `var()`', replacing('  display: inline-block;\n  margin-inline-start: 0.3em;', '  display: var(--d);\n  margin-inline-start: 0.3em;'), 'writes `display: var(--d)`, a spelling this contract does not read'],
    ['primitives.css', 'the mirror as a `var()`', replacing('.salt-arrow:dir(rtl) > .salt-icon {\n  scale: -1 1;', '.salt-arrow:dir(rtl) > .salt-icon {\n  scale: var(--flip);'), 'writes `scale: var(--flip)`, a spelling this contract does not read'],
    ['blocks.css', 'the reset as a `var()`', replacing(RESET, RESET.replace('margin-block: 0', 'margin-block: var(--z)')), 'a spelling this contract does not read; it reads lengths'],
    ['chrome.css', 'the footer floor’s rem as a `var()`', replacing('    min-block-size: max(2rem, 24px);', '    min-block-size: max(var(--row), 24px);'), 'a spelling this contract does not read; it reads `max(<rem>, <px>)`'],
    ['blocks.css', 'the arrow given the brand colour', replacing(COLOUR_DECL, '  color: blue;\n}'), 'writes `color: blue`; write `inherit`, the words\' colour'],
    ['primitives.css', 'the button’s floor under 24px in capitals', replacing('  min-block-size: max(2.75rem, 24px);\n  padding-inline: 1.25rem;', '  min-block-size: MAX(2.75rem, 20PX);\n  padding-inline: 1.25rem;'), 'which never reaches 24 CSS px'],
  ])('%s: fails %s', (file, _case, mutate, message) => {
    const { code, output } = gate(file, mutate)
    expect(output).toContain(message)
    expect(code).toBe(1)
  })

  /* The colour rule is in blocks.css, and a failure about it names blocks.css in its header. */
  it('names the stylesheet the failing rule is in', () => {
    const { output } = gate('blocks.css', replacing(COLOUR_DECL, '  color: blue;\n}'))
    expect(output).toContain('blocks.css: the arrow after a linked card title takes its words’ colour')
    expect(output).not.toContain('primitives.css: the arrow after a way onward is drawn in its line')
  })
})

/* The `:last-child` edge and every `!important` arm the pins added, each failing by name (#211 re-review, 8). */
describe('the last-child edge and each !important arm fail', () => {
  const LAST = ".salt-grid .salt-card > .salt-rich-text > :last-child,\n.salt-block[data-block='carousel'] .salt-card > .salt-rich-text > :last-child {\n  margin-block-end: 0;\n}"
  const FIRST = ".salt-grid .salt-card > .salt-rich-text > :first-child,\n.salt-block[data-block='carousel'] .salt-card > .salt-rich-text > :first-child {\n  margin-block-start: 0;\n}"
  const RESET = ".salt-grid .salt-card > *,\n.salt-block[data-block='carousel'] .salt-card > * {\n  margin-block: 0;\n}"
  itEach([
    ['blocks.css', 'the last-child edge deleted', replacing(LAST, ''), 'writes `margin-block-end: 0`, so with no CSS reset'],
    ['blocks.css', 'the last-child edge given a length', replacing(LAST, LAST.replace('margin-block-end: 0', 'margin-block-end: 1em')), 'writes `margin-block-end: 0`, so with no CSS reset'],
    ['blocks.css', 'a later rule giving the last block a foot', appending(".salt-grid .salt-card > .salt-rich-text > :last-child {\n  margin-bottom: 1em;\n}"), "writes `margin-bottom: 1em` on a card's rich text, over the rule that zeroes its last block's foot"],
    ['blocks.css', 'the reset !important', replacing(RESET, RESET.replace('margin-block: 0', 'margin-block: 0 !important')), 'declares a block margin !important'],
    ['blocks.css', 'the first-child edge !important', replacing(FIRST, FIRST.replace('margin-block-start: 0', 'margin-block-start: 0 !important')), 'declares `margin-block-start` !important'],
    ['blocks.css', 'the last-child edge !important', replacing(LAST, LAST.replace('margin-block-end: 0', 'margin-block-end: 0 !important')), 'declares `margin-block-end` !important'],
    ['blocks.css', 'the row gap !important', replacing('  row-gap: var(--space-card-row);', '  row-gap: var(--space-card-row) !important;'), 'declares `row-gap` !important'],
    ['primitives.css', 'the arrow’s display !important', replacing('  display: inline-block;\n  margin-inline-start: 0.3em;', '  display: inline-block !important;\n  margin-inline-start: 0.3em;'), 'declares `display` !important'],
    ['blocks.css', 'the arrow’s colour !important', replacing('  color: inherit;\n}', '  color: inherit !important;\n}'), 'declares `color` !important'],
    ['primitives.css', 'the mirror !important', replacing('.salt-arrow:dir(rtl) > .salt-icon {\n  scale: -1 1;', '.salt-arrow:dir(rtl) > .salt-icon {\n  scale: -1 1 !important;'), 'declares `scale` !important'],
    ['chrome.css', 'the footer floor !important', replacing('    min-block-size: max(2rem, 24px);', '    min-block-size: max(2rem, 24px) !important;'), 'declares `min-block-size` !important'],
    /* An override at any rank, once !important. */
    ['primitives.css', 'a low-ranked display !important on the arrow', appending('.salt-icon {\n  display: block !important;\n}'), "`.salt-icon` in primitives.css writes `display: block !important` on the arrow's icon"],
    ['blocks.css', 'a low-ranked colour !important on the arrow', appending('.salt-icon {\n  color: red !important;\n}'), "`.salt-icon` in blocks.css writes `color: red !important` on the arrow's icon"],
    ['primitives.css', 'a low-ranked scale !important on the arrow', appending('.salt-icon {\n  scale: 1 !important;\n}'), "`.salt-icon` in primitives.css writes `scale: 1 !important` on the arrow's icon"],
    ['blocks.css', 'a low-ranked rich-text margin !important', appending('.salt-rich-text > :first-child {\n  margin-top: 1em !important;\n}'), "writes `margin-top: 1em !important` on a card's rich text"],
    ['blocks.css', 'a low-ranked card part margin !important', appending('.salt-card > .salt-showcase__text {\n  margin-block-start: 0 !important;\n}'), "writes `margin-block-start: 0 !important` on a card's part"],
  ])('%s: fails %s', (file, _case, mutate, message) => {
    const { code, output } = gate(file, mutate)
    expect(output).toContain(message)
    expect(code).toBe(1)
  })
})

/* A carousel card fills its slide (BD-205): the wrapper's height and the card's box model, each
   removed, retuned or overridden from another file, fails by name. */
describe('a carousel card fills its slide', () => {
  const INNER = '.salt-carousel__slide-inner {\n  block-size: 100%;\n}'
  itEach([
    ['primitives.css', 'the wrapper’s rule deleted', replacing(INNER, ''), 'no unconditional rule reaches `.salt-carousel__slide-inner`'],
    ['primitives.css', 'the wrapper at its content’s height', replacing(INNER, '.salt-carousel__slide-inner {\n  block-size: auto;\n}'), 'declares `block-size: auto`'],
    ['primitives.css', 'the wrapper’s height !important', replacing(INNER, '.salt-carousel__slide-inner {\n  block-size: 100% !important;\n}'), 'declares `block-size` !important'],
    ['primitives.css', 'the wrapper’s height as a `calc()`', replacing(INNER, '.salt-carousel__slide-inner {\n  block-size: calc(100% - 1px);\n}'), 'a spelling this contract does not read; it reads `100%`'],
    /* The property read is the one named (#225 review, 4). */
    ['primitives.css', 'the wrapper’s height written last as `height`', replacing(INNER, '.salt-carousel__slide-inner {\n  block-size: 100%;\n  height: auto;\n}'), 'declares `height: auto`'],
    /* A limit inside the owning rules is read too (#225 review, 3). */
    ['primitives.css', 'a limit inside the wrapper’s own rule', replacing(INNER, '.salt-carousel__slide-inner {\n  block-size: 100%;\n  max-height: 10rem;\n}'), 'also declares `max-height: 10rem` beside its height'],
    ['primitives.css', 'a floor inside the wrapper’s own rule', replacing(INNER, '.salt-carousel__slide-inner {\n  block-size: 100%;\n  min-block-size: 10rem;\n}'), 'also declares `min-block-size: 10rem` beside its height'],
    ['blocks.css', 'a limit inside the card’s own rule', replacing('  box-sizing: border-box;\n  padding: 1.5rem;\n  block-size: 100%;', '  box-sizing: border-box;\n  padding: 1.5rem;\n  block-size: 100%;\n  max-block-size: 30rem;'), 'also declares `max-block-size: 30rem` beside its height'],
    /* The subject is the element itself, so another box inside it passes (#225 review, 1 and 2): each
       was reported as the card or the wrapper by the substring test. */
    ['chrome.css', 'a card’s icon in `content-box`', appending('.salt-grid .salt-card > .salt-icon {\n  box-sizing: content-box;\n}'), 'PASS: '],
    ['chrome.css', 'a carousel card link’s `::after` at full height', appending(".salt-block[data-block='carousel'] .salt-card__link::after {\n  height: 100%;\n}"), 'PASS: '],
    ['chrome.css', 'a carousel card’s own `::after` at full height', appending(".salt-block[data-block='carousel'] .salt-card::after {\n  height: 100%;\n}"), 'PASS: '],
    ['chrome.css', 'a gallery figure in the wrapper capped', appending('.salt-carousel__slide-inner > .salt-gallery__figure {\n  max-block-size: 30rem;\n}'), 'PASS: '],
    ['chrome.css', 'the wrapper itself capped by a descendant selector', appending('.salt-gallery .salt-carousel__slide-inner {\n  max-block-size: 30rem;\n}'), 'also declares `max-block-size: 30rem`'],
    ['chrome.css', 'the wrapper capped through `:is()`', appending('.salt-carousel__slide > :is(.salt-carousel__slide-inner) {\n  max-height: 30rem;\n}'), 'also declares `max-height: 30rem`'],
    /* Named inside a selector group, as core writes `:where(.salt-intro)` (#225 re-review): read, and a
       branch with a combinator in it is the third verdict, never a pass. */
    ['chrome.css', 'the wrapper capped through `:where()`', appending(':where(.salt-carousel__slide-inner) {\n  max-height: 3rem;\n}'), 'also declares `max-height: 3rem`, and this contract does not rank two rules'],
    ['chrome.css', 'a carousel card capped through `:where()`', appending(".salt-block[data-block='carousel'] :where(.salt-card) {\n  max-block-size: 3rem;\n}"), 'also declares `max-block-size: 3rem` on a carousel card'],
    ['chrome.css', 'a carousel card capped through one branch of `:is()`', appending(".salt-block[data-block='carousel'] :is(.salt-card, .salt-x) {\n  max-height: 3rem;\n}"), 'also declares `max-height: 3rem` on a carousel card'],
    ['chrome.css', 'a card’s box model through `:where()`', appending(':where(.salt-card) {\n  box-sizing: content-box;\n}'), 'also declares `box-sizing: content-box` on a card'],
    ['chrome.css', 'a carousel card capped through a branch with a combinator', appending(".salt-block[data-block='carousel'] :is(.salt-x .salt-card) {\n  max-height: 3rem;\n}"), 'through a selector group naming the card beside a combinator, a shape this contract does not read'],
    ['chrome.css', 'the wrapper capped through a branch with a combinator', appending(':is(.salt-x .salt-carousel__slide-inner) {\n  max-height: 3rem;\n}'), 'through a selector group naming the slide wrapper beside a combinator, a shape this contract does not read'],
    ['chrome.css', 'a gallery figure under `:where()` of the wrapper', appending(':where(.salt-carousel__slide-inner) > .salt-gallery__figure {\n  max-block-size: 30rem;\n}'), 'PASS: '],
    ['chrome.css', 'an icon under one branch of `:is()` naming the card', appending(".salt-block[data-block='carousel'] :is(.salt-card, .salt-x) > .salt-icon {\n  max-height: 3rem;\n}"), 'PASS: '],
    ['chrome.css', 'a card link under `:where()` of the card', appending(":where(.salt-card) .salt-card__link::after {\n  height: 100%;\n}"), 'PASS: '],
    /* A `:has()` names the subject's contents, not the subject (#225 re-review, 2nd round). */
    ['chrome.css', 'a grid holding a card in `content-box`', appending('.salt-grid:has(.salt-card) {\n  box-sizing: content-box;\n}'), 'PASS: '],
    ['chrome.css', 'a carousel slide holding a card given a floor', appending(".salt-block[data-block='carousel'] .salt-carousel__slide:has(.salt-card) {\n  min-height: 20rem;\n}"), 'PASS: '],
    ['chrome.css', 'a slide holding the wrapper given a floor', appending('.salt-carousel__slide:has(> .salt-carousel__slide-inner) {\n  min-block-size: 0;\n}'), 'PASS: '],
    ['chrome.css', 'a grid excluding cards, its negation in capitals', appending('.salt-grid:NOT(.salt-card) {\n  box-sizing: content-box;\n}'), 'PASS: '],
    ['chrome.css', 'a carousel card capped under a negation', appending(".salt-block[data-block='carousel'] .salt-card:not(.salt-x) {\n  max-height: 30rem;\n}"), 'also declares `max-height: 30rem` on a carousel card'],
    ['chrome.css', 'the wrapper re-sized in another file, inside a query', appending('@media (max-width: 40rem) {\n  .salt-carousel__slide-inner {\n    max-height: 20rem;\n  }\n}'), 'in chrome.css also declares `max-height: 20rem`'],
    ['blocks.css', 'the card’s box model deleted', replacing('  box-sizing: border-box;\n  padding: 1.5rem;\n  block-size: 100%;', '  padding: 1.5rem;\n  block-size: 100%;'), 'declares no `box-sizing`'],
    ['blocks.css', 'the card in `content-box`', replacing('  box-sizing: border-box;\n  padding: 1.5rem;', '  box-sizing: content-box;\n  padding: 1.5rem;'), 'declares `box-sizing: content-box`'],
    ['blocks.css', 'the card’s box model in capitals', replacing('  box-sizing: border-box;\n  padding: 1.5rem;', '  box-sizing: BORDER-BOX;\n  padding: 1.5rem;'), 'PASS: '],
    ['chrome.css', 'a card’s box model changed in another file', appending('.salt-card {\n  box-sizing: content-box;\n}'), 'also declares `box-sizing: content-box` on a card'],
    ['blocks.css', 'a carousel card re-sized by a later rule', appending(".salt-block[data-block='carousel'] .salt-card {\n  block-size: auto;\n}"), 'also declares `block-size: auto` on a carousel card'],
  ])('%s: %s', (file, _case, mutate, message) => {
    const { code, output } = gate(file, mutate)
    expect(output).toContain(message)
    expect(code).toBe(message === 'PASS: ' ? 0 : 1)
  })
})

/* The footer's tone (BD-204): it resolves through the bands' own tone rules. That every colour it paints is a tone role
   reads Salt for Next.js's routing table, so that contract and its cases stayed there. */
describe('the footer is on its tone’s roles, and nowhere else', () => {
  const INVERSE = ".salt-section[data-tone='surface-inverse'],\n.salt-footer[data-tone='surface-inverse'] {"
  const DARK_SURFACE = "[data-theme='dark'] .salt-section[data-tone-dark='surface'],\n[data-theme='dark'] .salt-footer[data-tone-dark='surface'] {"
  itEach([
    ['sections.css', 'the footer left out of the inverted tone', replacing(INVERSE, ".salt-section[data-tone='surface-inverse'] {"), "without `.salt-footer[data-tone='surface-inverse']` in its selector list"],
    ['sections.css', 'the footer left out of a dark tone', replacing(DARK_SURFACE, "[data-theme='dark'] .salt-section[data-tone-dark='surface'] {"), "without `[data-theme='dark'] .salt-footer[data-tone-dark='surface']` in its selector list"],
    ['sections.css', 'the footer named without its dark scope', replacing(DARK_SURFACE, "[data-theme='dark'] .salt-section[data-tone-dark='surface'],\n.salt-footer[data-tone-dark='surface'] {"), "without `[data-theme='dark'] .salt-footer[data-tone-dark='surface']`"],
    ['sections.css', 'a footer-only tone rule beside the shared one', appending(".salt-footer[data-tone='surface-inverse'] {\n  --salt-section-ink-muted: var(--color-ink-muted);\n}"), 'declares `--salt-section-ink-muted` for the footer outside the tone rules'],
    ['chrome.css', 'the footer repointing a role of its own', appending('.salt-footer {\n  --salt-section-ink: var(--color-ink);\n}'), 'declares `--salt-section-ink` for the footer outside the tone rules'],
    ['chrome.css', 'a footer part repointing its hairline', appending('.salt-footer__base {\n  --salt-section-border: var(--color-border);\n}'), 'declares `--salt-section-border` for the footer outside the tone rules'],
  ])('%s: fails %s', (file, _case, mutate, message) => {
    const { code, output } = gate(file, mutate)
    expect(output).toContain('the footer takes its tone from the bands’ own tone rules')
    expect(output).toContain(message)
    expect(code).toBe(1)
  })
})

/*
 * ── The contracts Salt for Next.js proved by hand ──────────────────────────────────────────
 *
 * Its test file mutated the stylesheets for the contracts a review had defeated; the rest were
 * proved by editing the committed files and putting them back. Each gets one mutation here, which
 * must fail it by name.
 */
describe('each remaining contract fails when the property it holds is taken away', () => {
  itEach([
    ['blocks.css', 'the column grid steps down to one column on a narrow viewport', appending('.salt-grid.salt-x {\n  --salt-grid-columns: 3;\n}'), 'sets the grid in a shape this checker cannot rank'],
    ['blocks.css', 'the shared grid wraps a run of characters too wide for its track', replacing('   * about what happens when something later is.\n   */\n  overflow-wrap: break-word;', '   * about what happens when something later is.\n   */\n  overflow-wrap: normal;'), 'declares `overflow-wrap: break-word`'],
    ['blocks.css', 'the call-to-action actions are a centred, wrapping row', appending('.salt-cta__actions {\n  flex-wrap: nowrap;\n}'), 'stops the row wrapping'],
    ['blocks.css', 'the logo strip gives its colour back to a keyboard as well as a pointer', appending('.salt-logos__frame {\n  filter: grayscale(1);\n}'), 'greys its focus ring along with the logo'],
    ['blocks.css', 'a masonry gallery cannot draw one photograph in two pieces', replacing('  break-inside: avoid;\n', ''), 'declares no break guard'],
    ['blocks.css', 'the masonry layout wins its `display` on the selector rather than on source order', appending(".salt-gallery[data-layout='masonry'] {\n  display: grid;\n}"), '2 unconditional rules declare `display`'],
    ['blocks.css', 'a process timeline runs in ONE column, whatever the shared grid is set to', replacing(".salt-process[data-layout='timeline'] {\n  --salt-grid-columns: 1;", ".salt-process[data-layout='timeline'] {\n  --salt-grid-columns: 2;"), 'a timeline is laid out in 2 columns'],
    ['blocks.css', 'a collection showcase list runs in ONE column, whatever the editor’s column count says', replacing(".salt-showcase[data-layout='list'] {\n  --salt-grid-columns: 1;", ".salt-showcase[data-layout='list'] {\n  --salt-grid-columns: 2;"), 'a showcase list is laid out in 2 columns'],
    ['primitives.css', 'the carousel track scrolls, snaps, and only glides where motion is welcome', appending('.salt-carousel__track {\n  scroll-behavior: smooth;\n}'), '2 unconditional rules reach `.salt-carousel__track`'],
    ['blocks.css', 'a centred list moves its markers inside the line box', replacing('  list-style-position: inside;\n', '  list-style-position: outside;\n'), 'puts `list-style-position: inside` on lists at every depth'],
    ['sections.css', 'the wrapper establishes a stacking context', replacing('  isolation: isolate;\n', ''), 'declares `isolation: isolate`'],
    ['sections.css', 'NEITHER background layer paints under forced colours', replacing('@media (forced-colors: active) {\n  .salt-section__media,\n  .salt-section__scrim {', '@media (forced-colors: active) {\n  .salt-section__media {'), '.salt-section__scrim still paint(s) under forced colours'],
    ['sections.css', 'every tone declares BOTH poles, and they are different colours', replacing(".salt-footer[data-tone='surface'] {\n  --salt-section-bg: var(--color-surface);\n  --salt-section-ink: var(--color-ink);\n  --salt-section-ink-contra: var(--color-ink-inverse);", ".salt-footer[data-tone='surface'] {\n  --salt-section-bg: var(--color-surface);\n  --salt-section-ink: var(--color-ink);\n  --salt-section-ink-contra: var(--color-ink);"), 'points both poles at var(--color-ink)'],
    ['sections.css', 'the scrim tints with the section tone, never a literal', replacing('  background-color: var(--salt-section-bg);\n  opacity: var(--salt-scrim-alpha);', '  background-color: var(--color-surface);\n  opacity: var(--salt-scrim-alpha);'), 'the scrim does not tint from `--salt-section-bg`'],
    ['primitives.css', "the tab's focus indicator is drawn on the LABEL, not on the clipped input", replacing('.salt-tabs__input:focus-visible + .salt-tabs__tab,\n', '.salt-tabs__input:focus-visible,\n'), 'so the indicator is drawn on the clipped input'],
    ['primitives.css', 'no link-styled rule can cancel the floor on an icon-only control', appending(".salt-button[data-style='link'] {\n  min-block-size: 0;\n}"), 'zeroes the floor and matches an icon-only control'],
    ['primitives.css', 'the card edge takes the band’s hairline, not the light-mode one', replacing('  border: 1px solid var(--salt-section-border, var(--color-border));\n  border-radius: var(--radius-lg);', '  border: 1px solid var(--color-border);\n  border-radius: var(--radius-lg);'), 'which does not follow the band'],
    ['primitives.css', 'body copy restores the list markers a CSS reset removes', replacing('  list-style-type: disc;', '  list-style-type: none;'), 'rule sets disc markers'],
    ['primitives.css', 'the nested-control rule raises controls, not layout boxes', replacing('.salt-card :is(a, button, input, select, textarea, summary, label):not(.salt-card__link) {', '.salt-card :is(a, button, input, select, textarea, summary, label, [tabindex]):not(.salt-card__link) {'), 'matches layout boxes, not just controls'],
    ['primitives.css', 'the stretched link is scoped to a card', replacing('.salt-card .salt-card__link::after {', '.salt-card__link::after {'), 'is not scoped to a card'],
  ])('%s: %s', (file, what, mutate, message) => {
    const { code, output } = gate(file, mutate)
    expect(output).toContain(`✗ ${file}: ${what}\n`)
    expect(output).toContain(message)
    expect(code).toBe(1)
  })
})

/* SC-011: every framed image fills its frame, and the header logo's contract tells a frame's image
   from the logo's by its parent. */
describe('every framed image fills its frame', () => {
  itEach([
    ['sections.css', 'the band media loses its cover', replacing('  block-size: 100%;\n  object-fit: cover;\n}', '  block-size: 100%;\n}'), '`.salt-section__media` in sections.css declares no `object-fit`'],
    ['blocks.css', 'a logo covers its frame', replacing('  block-size: 100%;\n  object-fit: contain;\n}', '  block-size: 100%;\n  object-fit: cover;\n}'), 'sets `object-fit: cover`; the fill is `object-fit: contain`'],
    ['blocks.css', 'the card photograph is no longer absolutely positioned', replacing('.salt-showcase__media > img {\n  position: absolute;', '.salt-showcase__media > img {\n  position: static;'), '`.salt-showcase__media > img` in blocks.css sets `position: static`'],
    ['primitives.css', 'the case study gallery loses its fill rule', replacing('.salt-case-study-view__media > img,\n.salt-case-study-view__frame > img {', '.salt-case-study-view__media > img {'), 'no unconditional `.salt-case-study-view__frame > img` rule in primitives.css fills its frame'],
    ['views.css', 'the post media frame is no longer an anchor', replacing('  margin-block: 2rem;\n  position: relative;', '  margin-block: 2rem;'), '`.salt-post__media` in views.css is not `position: relative`'],
    ['views.css', 'the fill moves inside a query', (css) => css.replace('.salt-post__media > img,\n', '').concat('\n@media (min-width: 40rem) {\n  .salt-post__media > img {\n    position: absolute;\n    inset: 0;\n    inline-size: 100%;\n    block-size: 100%;\n    object-fit: cover;\n  }\n}\n'), 'no unconditional `.salt-post__media > img` rule in views.css fills its frame'],
  ])('%s: fails when %s', (file, _case, mutate, message) => {
    const { code, output } = gate(file, mutate)
    expect(output).toContain('✗ sections.css: every framed image fills its frame\n')
    expect(output).toContain(message)
    expect(code).toBe(1)
  })

  itEach([
    ['an image rule keyed on the logo link', '.salt-logo > img {\n  object-fit: cover;\n}'],
    ['a frame image reached by a descendant combinator', '.salt-showcase__media img {\n  object-fit: cover;\n}'],
    ['a frame image under an opaque parent', ':is(.salt-showcase__media) > img {\n  object-fit: cover;\n}'],
  ])('the header logo contract still refuses %s', (_case, addition) => {
    const { code, output } = gate('blocks.css', appending(addition))
    expect(output).toContain('the logo is the item that gives way when the header row runs out of room')
    expect(output).toContain('nothing proves it misses `img.salt-logo__image')
    expect(code).toBe(1)
  })
})

/*
 * ── The checks this gate adds ───────────────────────────────────────────────────────────────
 *
 * Each runs raw where the class vocabulary is the subject, so a class a case invents is not
 * registered for it.
 */
const addFile = (file, text) => (files) => files.set(target(file), text)
const removeFile = (file) => (files) => files.delete(target(file))
const tokenLayer = (edit) => ['contract/token-layer.json', (text) => {
  const layer = JSON.parse(text)
  edit(layer)
  return JSON.stringify(layer, null, 2)
}]
const tokenNamed = (layer, name) => layer.groups.flatMap((group) => group.tokens).find((token) => token.name === name)
const writeOf = (layer, property) => layer.writes.find((entry) => entry.property === property)

describe('the parse is whole, across every stylesheet in styles/', () => {
  itEach([
    ['a stylesheet the contracts are written against is missing', [removeFile('sections.css')], 'styles/sections.css is missing'],
    /* An unclosed string ends at its line, as in a browser, so the rules after it are still read. */
    ['an unclosed string hides a keyframe on the next line', [['blocks.css', appending(".salt-a::after { content: 'oops; }\n@keyframes zz { from { color: red; } }")]], 'Parsed 86 rules from blocks.css but the source contains 88 declaration blocks'],
    ['a rule nested inside another, which the parse cannot read', [['blocks.css', appending('.salt-note {\n  .salt-x {\n    margin: 0;\n  }\n}')]], 'The parse is dropping rules'],
    ['a declaration written straight into a media block', [['blocks.css', appending('@media (min-width: 48rem) {\n  margin: 0;\n}')]], "directly in an at-rule's block"],
    ['a new stylesheet that drops a focus outline, which a contract sweeping every file reads', [addFile('extra.css', '.salt-button {\n  outline: none;\n}\n')], 'extra.css .salt-button outline: declared outside the focus rules'],
    /* base.css is one `@layer base` block (T1): unlayered, its headings beat Tailwind v4's utilities. */
    ['base.css loses its layer, so its rules outrank every utility', [['base.css', (css) => css.replace('@layer base {', '@media all {')]], 'base.css holds no `@layer base` block'],
    ['base.css writes a rule outside its layer', [['base.css', appending(':where(#main) h2 {\n  font-size: var(--text-heading-2);\n}')]], 'base.css writes `:where(#main) h2` outside its `@layer base` block'],
    ['base.css names another layer', [['base.css', (css) => css.replace('@layer base {', '@layer salt-base {')]], 'base.css holds `@layer salt-base`'],
    ['base.css declares a layer order as well', [['base.css', (css) => `@layer reset, base;\n${css}`]], 'base.css holds `@layer reset, base`, `@layer base`'],
    ['another stylesheet uses a layer', [['views.css', (css) => `@layer base {\n${css}\n}`]], 'views.css:1 uses `@layer`, an at-rule this gate does not read'],
    /* The base's classless text rules are excused only inside base.css's layer (W2). */
    ['body text set in another stylesheet', [['views.css', appending('body {\n  font-size: var(--text-body);\n}')]], '`body` in views.css sets `font-size` on an element it names by no class'],
    ['body text set unlayered in base.css, refused before any contract runs', [['base.css', appending('body {\n  font-size: var(--text-body);\n}')]], 'base.css writes `body` outside its `@layer base` block'],
  ])('fails when %s', (_case, edits, message) => {
    const { code, output } = run(...edits)
    expect(output).toContain(message)
    expect(code).toBe(1)
  })
})

describe('the token layer names exactly what the stylesheets read', () => {
  itEach([
    ['a stylesheet reads a property the token layer does not name', [['views.css', appending('.salt-service__summary {\n  padding-block: var(--space-12);\n}')]], 'views.css read(s) --space-12, which contract/token-layer.json does not name'],
    ['a role is dropped, and its five properties go with it', [tokenLayer((layer) => { for (const g of layer.groups) g.tokens = g.tokens.filter((t) => t.textRole !== 'stat') })], 'blocks.css read(s) --text-stat--font-family, which contract/token-layer.json does not name'],
    ['the token layer names a property nothing reads', [tokenLayer((layer) => layer.groups[0].tokens.push({ name: '--color-accent', meaning: 'Unread.', source: 'design-foundations' }))], 'names --color-accent, which neither a stylesheet nor a value the markup writes reads'],
    ['the token layer names a property twice', [tokenLayer((layer) => layer.groups[0].tokens.push({ ...tokenNamed(layer, '--color-ink') }))], 'names --color-ink twice'],
    ['the token layer names a property the stylesheets declare', [tokenLayer((layer) => layer.groups[0].tokens.push({ name: '--salt-section-bg', meaning: 'The band.', source: 'salt' }))], 'names --salt-section-bg, which the stylesheets declare themselves'],
    ['a property read without a fallback is marked optional', [tokenLayer((layer) => { tokenNamed(layer, '--header-height').optional = true })], 'marks --header-height optional, but 1 of its 1 read(s) have no fallback'],
    ['a property with a fallback at every read is not marked optional', [tokenLayer((layer) => { delete tokenNamed(layer, '--salt-rating-fill').optional })], '--salt-rating-fill has a fallback at every read (blocks.css), so contract/token-layer.json marks it optional'],
    ['a read loses its fallback', [['chrome.css', replacing('var(--duration-moderate, 200ms)', 'var(--duration-moderate)')]], 'marks --duration-moderate optional, but 1 of its 1 read(s) have no fallback'],
    ['the token layer is not JSON', [['contract/token-layer.json', (text) => text.slice(1)]], 'contract/token-layer.json is missing or not JSON'],
    /* What the markup writes is read too (T2), through each placeholder's value map. */
    ['a token the markup writes into a band is dropped', [tokenLayer((layer) => { for (const g of layer.groups) g.tokens = g.tokens.filter((t) => t.name !== '--scrim-strong') })], 'contract/markup/section.json read(s) --scrim-strong, which contract/token-layer.json does not name'],
    ['a spacing the markup writes is dropped', [tokenLayer((layer) => { for (const g of layer.groups) g.tokens = g.tokens.filter((t) => t.name !== '--space-section-lg') })], 'contract/markup/section.json read(s) --space-section-lg, which contract/token-layer.json does not name'],
    ['the value map loses its exception, so `none` would be a token', [tokenLayer((layer) => { delete writeOf(layer, '--salt-section-space').values.spacing.except })], 'read(s) --space-section-none, which contract/token-layer.json does not name'],
    ['a placeholder the token layer gives no values for', [tokenLayer((layer) => { layer.writes = layer.writes.filter((entry) => entry.property !== '--salt-scrim-alpha') })], "writes --salt-scrim-alpha as var(--scrim-<strength>), and contract/token-layer.json's writes give no values for <strength>"],
    ['a value map naming no field', [tokenLayer((layer) => { writeOf(layer, '--salt-scrim-alpha').values.strength.field = '_section-settings#strength' })], "fills --salt-scrim-alpha's <strength> from _section-settings#strength, which is not a field with options"],
    ['value maps for a property no markup writes', [tokenLayer((layer) => { layer.writes.push({ property: '--color-ink', values: { spacing: { field: '_section-settings#spacing' } } }) })], 'lists writes for --color-ink, which no markup element writes'],
    /* Each placeholder by name (Z4): one map does not stand in for another, and a stale one fails. */
    ['a placeholder named differently from its map', [tokenLayer((layer) => { const entry = writeOf(layer, '--salt-scrim-alpha'); entry.values = { alpha: entry.values.strength } })], "give no values for <strength>"],
    ['a map for a placeholder the markup does not write', [tokenLayer((layer) => { writeOf(layer, '--salt-scrim-alpha').values.opacity = { field: '_section-settings#scrimStrength' } })], 'fills <opacity> in --salt-scrim-alpha, which no markup element writes'],
    ['a second placeholder in one value, with no map of its own', [addFile('contract/markup/zz-write.json', JSON.stringify({ root: { attributes: { style: '--salt-scrim-alpha: var(--scrim-<strength>, var(--scrim-<fallback>))' } } }))], 'give no values for <fallback>'],
    ['writes listed twice for one property', [tokenLayer((layer) => { layer.writes.push(structuredClone(writeOf(layer, '--salt-scrim-alpha'))) })], 'lists writes for --salt-scrim-alpha twice'],
    /* What a markup element writes (Z1, Z3): a style element's CSS, and each value of an enum. */
    ['a style element writes a token the layer does not name', [addFile('contract/markup/zz-write.json', JSON.stringify({ elements: [{ element: 'noscript', children: [{ element: 'style', text: '.salt-header { --salt-header-phone-menu: var(--phone-unnamed); }' }] }] }))], 'contract/markup/zz-write.json read(s) --phone-unnamed, which contract/token-layer.json does not name'],
    ['an enum value writes a token the layer does not name', [addFile('contract/markup/zz-write.json', JSON.stringify({ root: { attributes: { style: { enum: ['--salt-rating-fill: 0%', '--salt-rating-fill: var(--rating-enum)'] } } } }))], 'read(s) --rating-enum, which contract/token-layer.json does not name'],
    ["an element's text is not a write, unless the element is a style", [addFile('contract/markup/zz-write.json', JSON.stringify({ elements: [{ element: 'p', text: '--header-height: 4rem' }] })), tokenLayer((layer) => { tokenNamed(layer, '--header-height').source = 'markup' })], 'says the markup writes --header-height, but no file in contract/markup/ does'],
    /* Every write the markup makes is read, into any property, fallbacks and nested var()s included. */
    ['a markup write reads a token only in its fallback', [addFile('contract/markup/zz-write.json', JSON.stringify({ root: { attributes: { style: '--salt-rating-fill: var(--rating-unnamed, 0%)' } } }))], 'contract/markup/zz-write.json read(s) --rating-unnamed, which contract/token-layer.json does not name'],
    ['a markup write reads a token nested in a fallback', [addFile('contract/markup/zz-write.json', JSON.stringify({ root: { attributes: { style: '--salt-rating-fill: var(--salt-x, var(--rating-nested))' } } }))], 'read(s) --rating-nested, which contract/token-layer.json does not name'],
    ['a markup write into a property the stylesheets declare', [addFile('contract/markup/zz-write.json', JSON.stringify({ root: { attributes: { style: { value: '--logo-height: var(--logo-unnamed)' } } } }))], 'contract/markup/zz-write.json read(s) --logo-unnamed, which contract/token-layer.json does not name'],
    ['a placeholder written into a property with no value map', [addFile('contract/markup/zz-write.json', JSON.stringify({ root: { attributes: { style: '--logo-height: var(--logo-<size>)' } } }))], "writes --logo-height as var(--logo-<size>), and contract/token-layer.json's writes give no values for <size>"],
    /* Prose never counts as a write: a note, a rule, a platform's former markup. */
    ['a token whose only "write" is a note', [addFile('contract/markup/zz-write.json', JSON.stringify({ notes: [{ text: '--header-height: 4rem' }], rules: { r: { statement: '--header-height: 4rem' } }, platforms: { nextjs: { formerly: [{ attributes: { style: '--header-height: 4rem' } }] } } })), tokenLayer((layer) => { tokenNamed(layer, '--header-height').source = 'markup' })], 'says the markup writes --header-height, but no file in contract/markup/ does'],
    /* A token said to come from the markup is written by some markup file (T5). */
    ['a token the markup is said to write and none does', [tokenLayer((layer) => { tokenNamed(layer, '--header-height').source = 'markup' })], 'says the markup writes --header-height, but no file in contract/markup/ does'],
  ])('fails when %s', (_case, edits, message) => {
    const { code, output } = run(...edits)
    expect(output).toContain(message)
    expect(code).toBe(1)
  })

  it('reads neither a comment nor a string as a read', () => {
    const { code, output } = run(['views.css', appending("/* var(--space-99) */\n.salt-service__price-label::after {\n  content: 'var(--space-98)';\n}")])
    expect(output).toContain('PASS: ')
    expect(code).toBe(0)
  })
})

describe('every class the stylesheets style is on an element in the markup contract', () => {
  const formerOnly = addFile('contract/markup/zz-former.json', JSON.stringify({ root: { classes: ['salt-shown'] }, platforms: { nextjs: { formerly: [{ classes: ['salt-former'] }] } }, rules: { x: { classes: ['salt-ruled'] } }, notes: [{ classes: ['salt-noted'] }], hooks: [{ class: 'salt-hooked' }], omitted: [{ class: 'salt-omitted' }] }))
  itEach([
    ['a class no markup draws', [['blocks.css', appending('.salt-invented {\n  margin: 0;\n}')]], 'blocks.css style(s) .salt-invented, which no element in contract/markup/ carries'],
    ['a class only a platform formerly wrote', [formerOnly, ['blocks.css', appending('.salt-former {\n  margin: 0;\n}')]], 'style(s) .salt-former, which no element'],
    ['a class only a rule statement mentions', [formerOnly, ['blocks.css', appending('.salt-ruled {\n  margin: 0;\n}')]], 'style(s) .salt-ruled, which no element'],
    ['a class only a note mentions', [formerOnly, ['blocks.css', appending('.salt-noted {\n  margin: 0;\n}')]], 'style(s) .salt-noted, which no element'],
    ['a class the markup omits', [formerOnly, ['blocks.css', appending('.salt-omitted {\n  margin: 0;\n}')]], 'style(s) .salt-omitted, which no element'],
    ['a class in a descendant of a selector', [['blocks.css', appending('.salt-card .salt-invented-child {\n  margin: 0;\n}')]], 'style(s) .salt-invented-child'],
  ])('fails %s', (_case, edits, message) => {
    const { code, output } = runRaw(...edits)
    expect(output).toContain(message)
    expect(code).toBe(1)
  })

  itEach([
    ['a class on a markup element', [addFile('contract/markup/zz-former.json', JSON.stringify({ root: { classes: ['salt-shown'] } })), ['blocks.css', appending('.salt-shown {\n  margin: 0;\n}')]]],
    ['a class named only inside an attribute selector', [['blocks.css', appending("[class*='salt-anything'] {\n  margin: 0;\n}")]]],
  ])('passes %s', (_case, edits) => {
    const { code, output } = runRaw(...edits)
    expect(output).toContain('PASS: ')
    expect(code).toBe(0)
  })
})

/* The command line, end to end: the cases above call the checks in memory, so two run the script as
   CI does, on the committed package and on a copy on disk with one defect. */
describe('the script, run as CI runs it', () => {
  const passes = (args) => {
    const result = spawnSync(process.execPath, args, { encoding: 'utf8' })
    expect(result.stdout).toContain('PASS: ')
    expect(result.status).toBe(0)
  }

  it('passes the committed package', () => passes([GATE]))

  it('runs when invoked through a symlink, as an installed bin would be', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'salt-stylesheet-gate-link-'))
    try {
      const link = path.join(dir, 'gate.mjs')
      symlinkSync(GATE, link)
      passes([link, PACKAGE])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails a copy on disk with one defect, naming it', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'salt-stylesheet-gate-'))
    try {
      for (const part of ['styles', 'contract']) cpSync(path.join(PACKAGE, part), path.join(root, part), { recursive: true })
      const file = path.join(root, 'styles', 'sections.css')
      writeFileSync(file, readFileSync(file, 'utf8').replace('  isolation: isolate;\n', ''))
      const result = spawnSync(process.execPath, [GATE, root], { encoding: 'utf8' })
      expect(result.stdout).toContain('✗ sections.css: the wrapper establishes a stacking context')
      expect(result.status).toBe(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('the fixes a value map and a layered base allow', () => {
  itEach([
    /* A placeholder written into a property the stylesheets declare has a fix: a value map in writes (Z5). */
    ['a placeholder written into a stylesheet-declared property, with its value map', [addFile('contract/markup/zz-write.json', JSON.stringify({ root: { attributes: { style: '--logo-height: var(--space-section-<spacing>)' } } })), tokenLayer((layer) => { layer.writes.push({ property: '--logo-height', values: { spacing: { field: '_section-settings#spacing', except: ['none'] } } }) })]],
    /* A body or heading rule under a query inside base.css's layer is still in the layer (Z10). */
    ['a heading rule under a media query inside the base layer', [['base.css', (css) => css.replace('@layer base {\n', '@layer base {\n  @media (min-width: 48rem) {\n    :where(#main, .salt-header, .salt-footer) h1 {\n      font-size: var(--text-heading-1);\n      line-height: var(--text-heading-1--line-height);\n      letter-spacing: var(--text-heading-1--letter-spacing);\n      font-weight: var(--text-heading-1--font-weight);\n      font-family: var(--text-heading-1--font-family);\n    }\n  }\n\n')]]],
    /* A brace in a string does not end the layer (Z8). */
    ['a brace inside a string in the base layer', [['base.css', (css) => css.replace('@layer base {\n', "@layer base {\n  :where(#main, .salt-header, .salt-footer) h1::after {\n    content: '}';\n  }\n\n")]]],
  ])('passes %s', (_case, edits) => {
    const { code, output } = run(...edits)
    expect(output).toContain('PASS: ')
    expect(code).toBe(0)
  })

  /* Z2: the memoised helpers key on the arguments they use, so the cache stops growing. */
  it('holds the caches steady across repeated runs and maps', () => {
    const files = readPackage(PACKAGE)
    checkStylesheets(files)
    const before = memoSize()
    for (let i = 0; i < 3; i += 1) checkStylesheets(new Map(files))
    expect(memoSize()).toBe(before)
  })
})

/* Z9: the main-module check never skips the gate silently. */
describe('the gate knows when it is the script being run', () => {
  const self = pathToFileURL(GATE).href
  it('runs when the entry is this file', () => expect(isMainModule(self, GATE)).toBe(true))
  it('does not run when imported, with another entry', () => expect(isMainModule(self, path.join(HERE, 'check_salt_contract.mjs'))).toBe(false))
  it('does not run with no entry', () => expect(isMainModule(self, undefined)).toBe(false))
  it('runs when a real path cannot be read, rather than passing silently', () => {
    const broken = () => { throw new Error('EACCES') }
    expect(isMainModule(self, path.join(HERE, 'elsewhere.mjs'), broken)).toBe(true)
    expect(isMainModule(self, GATE, broken)).toBe(true)
  })
})

/*
 * Every decision contract has failed in a case above. The contracts are read from the gate's own
 * source, so one added without a failing case fails here, by name.
 */
describe('every contract is seen to fail', () => {
  it('has a failing case for each decision contract', () => {
    const source = readFileSync(GATE, 'utf8')
    const literal = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/
    const whats = [...source.matchAll(new RegExp(`^    what:\\s*((?:${literal.source})(?:\\s*\\+\\s*(?:${literal.source}))*)`, 'gm'))]
      .map((m) => new Function(`return ${m[1]}`)())
    const contracts = (source.match(/^const CONTRACTS = \[/m) ? source.split(/^const CONTRACTS = \[/m)[1].split(/^\]$/m)[0] : '')
      .split('\n').filter((line) => line === '  {').length
    expect(whats.length).toBe(contracts)
    const unseen = whats.filter((what) => !failed.has(what))
    assert.deepEqual(unseen, [], `no case above makes these contracts fail:\n${unseen.join('\n')}`)
  })
})
