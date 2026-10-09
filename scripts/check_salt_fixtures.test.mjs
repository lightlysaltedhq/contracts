// Proves each check in check_salt_fixtures.mjs can fail, on a throwaway copy of the package that
// carries only the fixture sets a test needs. A gate that has never been seen to fail is not known
// to check anything. Also pins the normaliser's rules, each in both directions, and runs the
// reference adapter through the adapter protocol.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compare, normalise } from '../salt-contract/normalise.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const script = path.join(here, 'check_salt_fixtures.mjs')
const adapter = path.join(here, 'salt_fixture_reference_adapter.mjs')
const pkg = path.join(here, '..', 'salt-contract')

function copy(sections, edit = () => {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'salt-fixtures-gate-'))
  cpSync(path.join(pkg, 'contract'), path.join(dir, 'contract'), { recursive: true })
  cpSync(path.join(pkg, 'normalise.mjs'), path.join(dir, 'normalise.mjs'))
  for (const s of sections) cpSync(path.join(pkg, 'fixtures', s), path.join(dir, 'fixtures', s), { recursive: true })
  const file = (rel) => path.join(dir, 'fixtures', rel)
  const io = {
    dir,
    json: (rel, change) => {
      const doc = JSON.parse(readFileSync(file(rel), 'utf8'))
      change(doc)
      writeFileSync(file(rel), JSON.stringify(doc, null, 2) + '\n')
    },
    html: (rel, from, to) => {
      const text = readFileSync(file(rel), 'utf8')
      assert.ok(text.includes(from), `${rel} holds ${from}`)
      writeFileSync(file(rel), text.replace(from, to))
    },
    write: (rel, text) => writeFileSync(path.join(dir, rel), text),
    remove: (rel) => rmSync(file(rel), { recursive: true, force: true }),
  }
  edit(io)
  return dir
}

function run(dir) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [script, dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
  } catch (e) {
    return { code: e.status, out: `${e.stdout}${e.stderr}` }
  }
}

function expectFail(sections, edit, pattern) {
  const dir = copy(sections, edit)
  try {
    const r = run(dir)
    assert.notEqual(r.code, 0, `expected a failure, got:\n${r.out}`)
    assert.match(r.out, pattern)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const HERO = ['hero']
const SPLIT = 'hero/split-image-left'

test('the package as it stands passes', () => {
  const r = run(pkg)
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /^PASS: \d+ fixture case/)
})

test('a copy of one complete section passes its own checks', () => {
  const dir = copy(HERO)
  try {
    const r = run(dir)
    assert.doesNotMatch(r.out, /fixtures\/hero\/|section hero:/, r.out)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ── 1. Coverage ───────────────────────────────────────────────────────────────────────────────
test('coverage: a section with no fixtures fails', () => {
  expectFail(HERO, (io) => io.remove('hero'), /section hero has no fixtures/)
})
test('coverage: a variant option no case renders fails', () => {
  expectFail(HERO, (io) => {
    for (const c of ['minimal-centre-inverse-dark-alt', 'minimal-left-brand-tint-collapsed']) { io.remove(`hero/${c}.json`); io.remove(`hero/${c}.html`) }
  }, /section hero: no case renders variant minimal/)
})
test('coverage: a section with no case that renders nothing fails', () => {
  expectFail(HERO, (io) => { io.remove('hero/empty.json'); io.remove('hero/empty.html') }, /section hero: no case renders nothing/)
})
test('coverage: a section with no case on the inverse band fails', () => {
  expectFail(HERO, (io) => {
    for (const c of ['full-bleed-background-inverse', 'minimal-centre-inverse-dark-alt']) io.json(`hero/${c}.json`, (d) => { d.values.settings.tone = 'surface' })
  }, /section hero: no case on the inverse band/)
})
test('coverage: a shared setting value no case uses fails', () => {
  expectFail(HERO, (io) => io.json('hero/full-bleed-background-inverse.json', (d) => { d.values.settings.spacing = 'md' }), /no case renders settings\.spacing lg/)
})
test('coverage: an input without its expected HTML fails', () => {
  expectFail(HERO, (io) => io.remove(`${SPLIT}.html`), /split-image-left\.json has no split-image-left\.html/)
})
test('coverage: a case name that is not kebab case fails', () => {
  expectFail(HERO, (io) => { io.write('fixtures/hero/Split_Case.json', readFileSync(path.join(pkg, 'fixtures', `${SPLIT}.json`), 'utf8')); io.write('fixtures/hero/Split_Case.html', readFileSync(path.join(pkg, 'fixtures', `${SPLIT}.html`), 'utf8')) },
    /Split_Case: a case name is lower-case kebab/)
})

// ── 2. Inputs ─────────────────────────────────────────────────────────────────────────────────
test('inputs: a field the contract does not define fails', () => {
  expectFail(HERO, (io) => io.json(`${SPLIT}.json`, (d) => { d.values.title = 'x' }), /values\.title: the fields contract has no field/)
})
test('inputs: a select value outside its options fails', () => {
  expectFail(HERO, (io) => io.json(`${SPLIT}.json`, (d) => { d.values.variant = 'banner' }), /values\.variant is "banner", not one of the field's options/)
})
test('inputs: a list over its max fails', () => {
  expectFail(HERO, (io) => io.json(`${SPLIT}.json`, (d) => { d.values.buttons.push(d.values.buttons[0]) }), /values\.buttons has 3 rows; the field's max is 2/)
})
test('inputs: a required field left out fails', () => {
  expectFail(HERO, (io) => io.json(`${SPLIT}.json`, (d) => { delete d.values.buttons[0].link }), /values\.buttons\[0\]\.link is required/)
})
test('inputs: an image naming media the case lacks fails', () => {
  expectFail(HERO, (io) => io.json(`${SPLIT}.json`, (d) => { d.values.image = 'missing' }), /values\.image names media "missing"/)
})
test('inputs: an internal link to a document the case lacks fails', () => {
  expectFail(HERO, (io) => io.json(`${SPLIT}.json`, (d) => { d.values.buttons[0].link.document = 'nowhere' }), /link\.document names "nowhere"/)
})
test('inputs: a shared setting with a wrong type fails', () => {
  expectFail(HERO, (io) => io.json(`${SPLIT}.json`, (d) => { d.values.settings.divider = 'yes' }), /values\.settings\.divider must be a boolean/)
})
test('inputs: a case with no anchor fails', () => {
  expectFail(HERO, (io) => io.json(`${SPLIT}.json`, (d) => { delete d.values.settings.anchorId }), /anchorId must be set/)
})
test('inputs: an anchor that is a landmark id fails', () => {
  expectFail(HERO, (io) => io.json(`${SPLIT}.json`, (d) => { d.values.settings.anchorId = 'main' }), /anchorId must be set, a slug and not a landmark id/)
})
test('inputs: a context heading level out of range fails', () => {
  expectFail(HERO, (io) => io.json(`${SPLIT}.json`, (d) => { d.context.headingLevel = 7 }), /context\.headingLevel must be 1 to 6/)
})
test('inputs: a track number beyond the section\'s place on the page fails', () => {
  expectFail(HERO, (io) => io.json('hero/split-image-right-later.json', (d) => { d.context.track = 'hero-4' }), /context\.track hero-4 counts 4 hero sections, but the section is number 3/)
})
test('inputs: an h2 with no heading rendered before it fails (section#single-h1)', () => {
  expectFail(HERO, (io) => io.json('hero/split-image-right-later.json', (d) => { delete d.context.headingRendered }), /this section claims the h1/)
})
test('inputs: an h1 after a heading has rendered fails', () => {
  expectFail(HERO, (io) => io.json(`${SPLIT}.json`, (d) => { d.context.headingRendered = true }), /a heading rendered earlier, so this one is 2/)
})
test('inputs: priority media for a later section fails', () => {
  expectFail(HERO, (io) => io.json('hero/split-image-right-later.json', (d) => { d.context.priorityMedia = true }), /the plan grants it to the first section only/)
})
test('inputs: a context with no index fails', () => {
  expectFail(HERO, (io) => io.json(`${SPLIT}.json`, (d) => { delete d.context.index }), /context\.index, the section's place on the page/)
})
test('inputs: rich text with an element its field does not allow fails', () => {
  expectFail(['rich-text'], (io) => io.json('rich-text/left-eyebrow-heading-body.json', (d) => { d.values.body += '<table><tr><td>x</td></tr></table>' }), /values\.body uses <table>/)
})
test('inputs: a text over its maxLength fails', () => {
  expectFail(['features'], (io) => io.json('features/many-items-linked.json', (d) => { d.values.intro = 'x'.repeat(301) }), /values\.intro is 301 characters; maxLength is 300/)
})

// ── 3. Markup ─────────────────────────────────────────────────────────────────────────────────
const markupFails = (from, to, pattern) => expectFail(HERO, (io) => io.html(`${SPLIT}.html`, from, to), pattern)

test('markup: an attribute the markup does not declare fails', () => {
  markupFails('data-track="hero-1"', 'data-track="hero-1" data-theme="x"', /<section\.salt-section> carries data-theme, which the markup does not declare/)
})
test('markup: a required attribute left out fails', () => {
  markupFails(' decoding="async"', '', /<img\.salt-hero__image> lacks decoding, which the markup requires/)
})
test('markup: a data attribute value outside its vocabulary fails', () => {
  markupFails('data-media-side="left"', 'data-media-side="top"', /data-media-side="top" is not one of left, right/)
})
test('markup: a literal attribute with another value fails', () => {
  markupFails('data-block="hero"', 'data-block="banner"', /data-block="banner" is not "hero"/)
})
test('markup: a class the markup does not give fails', () => {
  markupFails('class="salt-hero__subheading"', 'class="salt-hero__subheading salt-lede"', /has classes "salt-hero__subheading salt-lede"; the markup gives "salt-hero__subheading"/)
})
test('markup: a class left out fails', () => {
  markupFails('class="salt-block salt-hero"', 'class="salt-hero"', /has classes "salt-hero"; the markup gives "salt-block salt-hero"/)
})
test('markup: elements out of order fail', () => {
  markupFails('<p class="salt-eyebrow">Bristol and Bath</p>\n        <h1 id="hero-split__heading">Gardens designed to be lived in</h1>',
    '<h1 id="hero-split__heading">Gardens designed to be lived in</h1>\n        <p class="salt-eyebrow">Bristol and Bath</p>', /split-image-left\.html: .*salt-hero__text/)
})
test('markup: an element the markup does not have fails', () => {
  markupFails('<div class="salt-hero__media">', '<hr>\n      <div class="salt-hero__media">', /<hr> is not in the markup at this point|where the markup has media/)
})
test('markup: a wrong tag fails', () => {
  markupFails('<p class="salt-hero__subheading">We plan, plant and look after gardens across the West Country.</p>',
    '<div class="salt-hero__subheading">We plan, plant and look after gardens across the West Country.</div>', /split-image-left\.html: .*salt-hero__subheading/)
})
test('markup: a variant drawing an element its option removes fails', () => {
  expectFail(HERO, (io) => io.json(`${SPLIT}.json`, (d) => { d.values.variant = 'minimal' }), /split-image-left\.html/)
})
test('markup: a section heading at the wrong level fails', () => {
  expectFail(HERO, (io) => io.json(`${SPLIT}.json`, (d) => { d.context.headingLevel = 2 }), /the section heading is h1; the plan gives level 2/)
})
test('markup: a named heading inside a div wrapper fails', () => {
  expectFail(HERO, (io) => { io.html(`${SPLIT}.html`, '<section class="salt-section" id="hero-split" aria-labelledby="hero-split__heading"', '<div class="salt-section" id="hero-split"'); io.html(`${SPLIT}.html`, '</section>', '</div>') },
    /a section with a heading is a section element with aria-labelledby/)
})
test('markup: a section element with no heading fails', () => {
  expectFail(HERO, (io) => io.html('hero/minimal-left-brand-tint-collapsed.html', '<div class="salt-section" id="intro"', '<section class="salt-section" id="intro"'),
    /minimal-left-brand-tint-collapsed\.html: .*(section with no heading renders as a div|where the markup has)/)
})
test('markup: a heading id that is not <anchor>__heading fails', () => {
  markupFails('<h1 id="hero-split__heading">', '<h1 id="hero-split-heading">', /id="hero-split-heading" is not "<anchor>__heading"/)
})
test('markup: an id that is not <anchor>__<part> fails', () => {
  expectFail(['tabs'], (io) => {
    for (const from of ['id="tabs-many__panel-1"', 'aria-controls="tabs-many__panel-1"']) {
      try { io.html('tabs/many-tabbed.html', from, from.replace('tabs-many__panel-1', 'panel-1')) } catch { /* one form is enough */ }
    }
  }, /id panel-1 is not tabs-many__<part>|is not "<anchor>__panel-<n>"/)
})
test('markup: a reference to an id that is not drawn fails', () => {
  markupFails('aria-labelledby="hero-split__heading"', 'aria-labelledby="hero-split__title"', /aria-labelledby/)
})
test('markup: a nested heading at the section heading\'s level fails', () => {
  expectFail(['features'], (io) => {
    const rel = 'features/many-items-linked.html'
    const text = readFileSync(path.join(io.dir, 'fixtures', rel), 'utf8')
    io.write(`fixtures/${rel}`, text.replace(/<h3>/g, '<h2>').replace(/<\/h3>/g, '</h2>'))
  }, /ranks at or above the section heading's level 2/)
})
test('markup: an img without sizes fails', () => {
  markupFails(' sizes="(min-width: 64rem) 30rem, 100vw"', '', /lacks sizes/)
})
test('markup: an img without width fails (SC-007)', () => {
  markupFails(' width="1600"', '', /an img lacks width/)
})
test('markup: a picture element fails (SC-007)', () => {
  markupFails('<img class="salt-hero__image"', '<picture><source srcset="/a.avif"></picture>\n        <img class="salt-hero__image"', /picture|<source>/)
})
test('markup: a lazy priority image fails', () => {
  markupFails('fetchpriority="high"', 'fetchpriority="high" loading="lazy"', /the priority image carries loading; it is never lazy/)
})
test('markup: an eager image that is not the priority image fails', () => {
  expectFail(HERO, (io) => io.html('hero/split-image-right-later.html', ' loading="lazy"', ''), /must be loading="lazy"/)
})
test('markup: a priority image the plan does not grant fails', () => {
  expectFail(HERO, (io) => io.json(`${SPLIT}.json`, (d) => { d.context.priorityMedia = false }), /the plan grants no priority media/)
})
test('markup: the block\'s image taking priority over a section background fails', () => {
  expectFail(HERO, (io) => {
    io.html('hero/full-bleed-background-inverse.html', ' fetchpriority="high"', ' loading="lazy"')
  }, /the priority image must be the section background|must be loading="lazy"/)
})
test('markup: two top-level elements fail', () => {
  expectFail(HERO, (io) => io.write(`fixtures/${SPLIT}.html`, readFileSync(path.join(pkg, 'fixtures', `${SPLIT}.html`), 'utf8') + '<p>x</p>\n'), /must be one section wrapper/)
})

// Conditional attributes and elements: required where the case says the condition holds,
// refused where it says it does not (the seven mutations the review of #10 made).
test('when: a section with a background image must carry data-media', () => {
  expectFail(HERO, (io) => io.html('hero/full-bleed-background-inverse.html', ' data-media ', ' '), /lacks data-media, which the markup requires when/)
})
test('when: a background image with the scrim on must draw the scrim', () => {
  expectFail(HERO, (io) => io.html('hero/full-bleed-background-inverse.html', '  <div class="salt-section__scrim" style="--salt-scrim-alpha: var(--scrim-strong)"></div>\n', ''), /scrim is not drawn, but a background image is drawn and the scrim is on/)
})
test('when: data-divider follows the divider setting, both ways', () => {
  expectFail(HERO, (io) => io.html('hero/stacked-image-divider.html', ' data-divider', ''), /lacks data-divider, which the markup requires when/)
  expectFail(HERO, (io) => io.html(`${SPLIT}.html`, 'data-track="hero-1"', 'data-divider data-track="hero-1"'), /carries data-divider, which the markup draws only when/)
})
test('when: target and rel follow the link\'s newTab, both ways', () => {
  expectFail(HERO, (io) => io.html('hero/split-no-image-new-tab.html', ' target="_blank"', ''), /lacks target, which the markup requires when newTab/)
  expectFail(HERO, (io) => io.html(`${SPLIT}.html`, 'data-track-control="cta">See our work', 'data-track-control="cta" rel="noopener noreferrer">See our work'), /carries rel, which the markup draws only when newTab/)
})
test('when: aria-current marks the current page and no other', () => {
  expectFail(['listing'], (io) => {
    io.html('listing/cards-with-pagination.html', ' aria-current="page">2', '>2')
    io.html('listing/cards-with-pagination.html', 'aria-label="Page 1">1', 'aria-label="Page 1" aria-current="page">1')
  }, /carries aria-current, which the markup draws only when|lacks aria-current, which the markup requires when/)
})
test('when: the first tab is checked and no other', () => {
  expectFail(['tabs'], (io) => {
    io.html('tabs/many-tabbed.html', 'id="tabs-many__tab-1" checked', 'id="tabs-many__tab-1"')
    io.html('tabs/many-tabbed.html', 'id="tabs-many__tab-2"', 'id="tabs-many__tab-2" checked')
  }, /lacks checked, which the markup requires when first panel|carries checked, which the markup draws only when first panel/)
})
test('when: a split hero with an image carries data-media-side', () => {
  markupFails(' data-media-side="left"', '', /lacks data-media-side, which the markup requires when/)
})
test('when: an unnamed tab set carries no aria-label, a named one does', () => {
  expectFail(['tabs'], (io) => io.html('tabs/no-name-stacked.html', '<div class="salt-tabs">', '<div class="salt-tabs" aria-label="">'), /carries aria-label, which the markup draws only when the set is named/)
  expectFail(['tabs'], (io) => io.html('tabs/one-panel-stacked.html', /<div class="salt-tabs" aria-label="[^"]*">/.exec(readFileSync(path.join(pkg, 'fixtures/tabs/one-panel-stacked.html'), 'utf8'))[0], '<div class="salt-tabs">'), /lacks aria-label, which the markup requires when the set is named/)
})
test('when: an element whose field is set must be drawn', () => {
  markupFails('<p class="salt-eyebrow">Bristol and Bath</p>\n', '', /eyebrow is not drawn, but eyebrow is set/)
})

// ── 4. The normaliser ─────────────────────────────────────────────────────────────────────────
test('normaliser: one that drops an attribute fails the mutation check', () => {
  expectFail(HERO, (io) => {
    const src = readFileSync(path.join(pkg, 'normalise.mjs'), 'utf8')
    io.write('normalise.mjs', src.replace("const attrs = node.attrs\n", "const attrs = node.attrs.filter(([n]) => n !== 'data-track')\n"))
  }, /removing data-track on <section\.salt-section> does not change normalise's output/)
})
test('normaliser: one that ignores attribute values fails the mutation check', () => {
  expectFail(HERO, (io) => {
    const src = readFileSync(path.join(pkg, 'normalise.mjs'), 'utf8')
    io.write('normalise.mjs', src.replace("if (name === 'src') return stripOrigin(value.trim())", "if (name === 'src' || name === 'alt') return name === 'alt' ? '' : stripOrigin(value.trim())"))
  }, /changing alt on <img\.salt-hero__image> does not change normalise's output/)
})
test('normaliser: one that is not idempotent fails', () => {
  expectFail(HERO, (io) => {
    const src = readFileSync(path.join(pkg, 'normalise.mjs'), 'utf8')
    io.write('normalise.mjs', src.replace('return serialise(root)\n}', "return serialise(root) + 'x'\n}"))
  }, /normalise is not idempotent/)
})

const same = (a, b) => assert.equal(normalise(a), normalise(b))
const differ = (a, b) => assert.notEqual(normalise(a), normalise(b))

test('normalise: attribute order and name case do not count', () => {
  same('<a href="/x" class="salt-button" data-style="primary">Go</a>', '<A DATA-STYLE="primary" CLASS="salt-button" HREF="/x">Go</A>')
})
test('normalise: white space at block boundaries does not count, between inline elements it does', () => {
  same('<div>\n  <p>One</p>\n  <p>Two</p>\n</div>', '<div><p>One</p><p>Two</p></div>')
  same('<p>\n  Read   more\n</p>', '<p>Read more</p>')
  same('<div>\n  <img src="a">\n</div>', '<div><img src="a"></div>')
  differ('<p><a>x</a> <a>y</a></p>', '<p><a>x</a><a>y</a></p>')
  // A template's line break between two inline elements is a space a browser draws.
  differ('<p><span>£49</span>\n  <span>a month</span></p>', '<p><span>£49</span><span>a month</span></p>')
  same('<p><span>£49</span>\n  <span>a month</span></p>', '<p><span>£49</span> <span>a month</span></p>')
  differ('<li><svg class="salt-icon"></svg>\n  Priority support</li>', '<li><svg class="salt-icon"></svg>Priority support</li>')
  differ('<p>Read more</p>', '<p>Readmore</p>')
})
test('normalise: boolean attribute forms are one form', () => {
  same('<details open="">x</details>', '<details open>x</details>')
  same('<input required="required">', '<input required>')
  same('<div data-divider=""></div>', '<div data-divider></div>')
  differ('<div data-divider></div>', '<div></div>')
  differ('<div data-divider="true"></div>', '<div data-divider></div>')
})
test('normalise: character references are one form', () => {
  same('<p title="it&#39;s">it&#x27;s &amp; that</p>', '<p title="it\'s">it\'s &amp; that</p>')
  differ('<p>it&#39;s</p>', '<p>its</p>')
})
test('normalise: the upload host in src and srcset does not count, the path does', () => {
  same('<img src="https://cms.example/u/a.jpg" srcset="https://cms.example/u/a-640.jpg 640w,https://cms.example/u/a.jpg 1600w">',
    '<img src="/u/a.jpg" srcset="/u/a-640.jpg 640w, /u/a.jpg 1600w">')
  differ('<img src="https://cms.example/u/a.jpg">', '<img src="https://cms.example/u/b.jpg">')
  differ('<img srcset="/u/a.jpg 640w">', '<img srcset="/u/a.jpg 641w">')
  differ('<a href="https://one.example/x">x</a>', '<a href="https://two.example/x">x</a>')
})
test('normalise: class order and spacing do not count, a class does', () => {
  same('<p class="salt-a  salt-b">x</p>', '<p class="salt-b salt-a">x</p>')
  differ('<p class="salt-a">x</p>', '<p class="salt-a salt-b">x</p>')
})
test('normalise: style spacing does not count, a declaration does', () => {
  same('<div style="--salt-section-space: var(--space-section-md);"></div>', '<div style="--salt-section-space:var(--space-section-md)"></div>')
  differ('<div style="object-fit: cover"></div>', '<div style="object-fit: contain"></div>')
})
test('normalise: comments do not count', () => {
  same('<p>One<!-- -->Two</p>', '<p>OneTwo</p>')
})
test('normalise: icon artwork does not count, the icon and its name do', () => {
  same('<svg class="salt-icon" data-icon="check"><path d="M1 2"/></svg>', '<svg class="salt-icon" data-icon="check"><path d="M9 9z"></path><path d="M0 0"></path></svg>')
  differ('<svg class="salt-icon" data-icon="check"></svg>', '<svg class="salt-icon" data-icon="star"></svg>')
  differ('<svg class="other"><path d="M1 2"/></svg>', '<svg class="other"><path d="M2 2"/></svg>')
})
test('normalise: ids are compared as written (SC-012)', () => {
  differ('<h2 id="faq__heading">x</h2>', '<h2 id="faq-heading">x</h2>')
})
test('normalise: compare reports both canonical forms', () => {
  const r = compare('<p class="b a">x</p>', '<p class="a b">y</p>')
  assert.equal(r.equal, false)
  assert.equal(r.expected, '<p class="a b">x</p>')
  assert.equal(r.actual, '<p class="a b">y</p>')
})

// ── The adapter protocol ──────────────────────────────────────────────────────────────────────
test('protocol: the reference adapter turns a case input on stdin into its HTML on stdout', () => {
  const input = readFileSync(path.join(pkg, 'fixtures', `${SPLIT}.json`), 'utf8')
  const out = execFileSync(process.execPath, [adapter], { input, encoding: 'utf8' })
  assert.ok(compare(readFileSync(path.join(pkg, 'fixtures', `${SPLIT}.html`), 'utf8'), out).equal)
})
test('protocol: an input no fixture holds exits non-zero with nothing on stdout', () => {
  const input = JSON.stringify({ section: 'hero', values: {} })
  assert.throws(() => execFileSync(process.execPath, [adapter], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }),
    (e) => e.status !== 0 && e.stdout === '')
})
