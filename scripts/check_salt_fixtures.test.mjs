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
  cpSync(path.join(pkg, 'styles'), path.join(dir, 'styles'), { recursive: true })
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
  expectFail(HERO, (io) => io.json('hero/split-image-right-later.json', (d) => { d.context.track = 'hero-4' }), /context\.track hero-4 counts 4 hero sections, but only 3 sections come up to this one/)
})
test('inputs: an h2 with no heading rendered before it fails (section#single-h1)', () => {
  expectFail(HERO, (io) => io.json('hero/split-image-right-later.json', (d) => { delete d.context.headingRendered }), /this section claims the h1/)
})
test('inputs: an h1 after a heading has rendered fails', () => {
  expectFail(HERO, (io) => io.json(`${SPLIT}.json`, (d) => { d.context.headingRendered = true }), /a heading rendered earlier, so this one is 2/)
})
test('inputs: priority media for a later section fails', () => {
  expectFail(HERO, (io) => io.json('hero/split-image-right-later.json', (d) => { d.context.priorityMedia = true }), /the plan grants it to the first section \(index 0\) only/)
})
test('inputs: a context with no index fails', () => {
  expectFail(HERO, (io) => io.json(`${SPLIT}.json`, (d) => { delete d.context.index }), /context\.index, the plan's index/)
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
  expectFail(HERO, (io) => {
    const rel = `fixtures/${SPLIT}.html`
    io.write(rel, readFileSync(path.join(io.dir, rel), 'utf8').replace(/ sizes="[^"]*"/, ''))
  }, /lacks sizes/)
})
test('markup: an img without width fails (SC-007)', () => {
  markupFails(' width="1600"', '', /lacks width/)
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
  expectFail(HERO, (io) => io.html(`${SPLIT}.html`, 'data-track-control="cta"><span class="salt-button__label">See our work', 'data-track-control="cta" rel="noopener noreferrer"><span class="salt-button__label">See our work'), /carries rel, which the markup draws only when newTab/)
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
test('when: an element whose field is set must be drawn', () => {
  markupFails('<p class="salt-eyebrow">Bristol and Bath</p>\n', '', /eyebrow is not drawn, but eyebrow is set/)
})

// Values the case fixes exactly (review G1, G2, G4).
test('values: data-track must be the context\'s track', () => {
  expectFail(HERO, (io) => io.html('hero/split-image-right-later.html', 'data-track="hero-2"', 'data-track="hero-3"'), /data-track="hero-3" disagrees with the case, which gives "hero-2"/)
})
test('values: data-tone and data-tone-dark must be the settings\' tones', () => {
  expectFail(HERO, (io) => io.html('hero/split-image-right-later.html', 'data-tone-dark="surface"', 'data-tone-dark="brand-tint"'), /data-tone-dark="brand-tint" disagrees with the case, which gives "surface"/)
})
test('values: an accordion group named for another section index fails', () => {
  expectFail(['collection-showcase'], (io) => {
    const rel = 'fixtures/collection-showcase/accordion-testimonials.html'
    io.write(rel, readFileSync(path.join(io.dir, rel), 'utf8').replaceAll('name="showcase-3"', 'name="showcase-1"'))
  }, /name="showcase-1" (is not "showcase-<section index>"|disagrees with the case, which gives "showcase-3")/)
})
test('values: alternating media-text sides count from 0', () => {
  expectFail(['media-text'], (io) => {
    const rel = 'fixtures/media-text/alternating-inverse.html'
    const text = readFileSync(path.join(io.dir, rel), 'utf8')
    io.write(rel, text.replaceAll('data-media-side="left"', 'X').replaceAll('data-media-side="right"', 'data-media-side="left"').replaceAll('X', 'data-media-side="right"'))
  }, /data-media-side="right" disagrees with the case, which gives "left"/)
})
test('values: a single-mode row takes its stored side', () => {
  expectFail(['media-text'], (io) => io.html('media-text/single-many-rows.html', 'data-media-side="right"', 'data-media-side="left"'), /data-media-side="left" disagrees with the case, which gives "right"/)
})

// The normaliser's containers follow the stylesheets (review G3).
test('containers: a flex container the normaliser does not list fails', () => {
  expectFail(HERO, (io) => io.write('styles/zz.css', '.salt-new-row {\n  display: flex;\n}\n'), /the stylesheets make \.salt-new-row a flex or grid container, but CONTAINERS lacks it/)
})
test('containers: a listed container the stylesheets do not make one fails', () => {
  expectFail(HERO, (io) => {
    const src = readFileSync(path.join(pkg, 'normalise.mjs'), 'utf8')
    io.write('normalise.mjs', src.replace("export const CONTAINERS = new Set([\n", "export const CONTAINERS = new Set([\n  'salt-hero__text',\n"))
  }, /CONTAINERS lists salt-hero__text, which the stylesheets do not make/)
})
test('containers: a conditional or contextual flex rule is not a container', async () => {
  const { containersFrom } = await import('./salt_normalise_containers.mjs')
  const dir = mkdtempSync(path.join(tmpdir(), 'salt-styles-'))
  try {
    writeFileSync(path.join(dir, 'a.css'), '@layer base { .salt-a { display: grid; } }\n@media (min-width: 40rem) { .salt-b { display: flex; } }\n.salt-grid .salt-c { display: flex; }\n.salt-d[open] { display: flex; }\n.salt-e, .salt-f { display: inline-flex; }\n.salt-g { display: block; }\n')
    assert.deepEqual(containersFrom(dir), ['salt-a', 'salt-e', 'salt-f'])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// The contract gaps the fixtures found, closed (SC-016 unit, item 5) and the counts the case
// fixes (item 6).
test('gaps: a name on the accordion\'s own div fails; it belongs on each details', () => {
  expectFail(['faq'], (io) => io.html('faq/many.html', '<div class="salt-accordion">', '<div class="salt-accordion" name="faq-2">'), /<div\.salt-accordion> carries name, which the markup does not declare/)
})
test('gaps: an aria-label on the tab set\'s generic div fails; it belongs on the radiogroup', () => {
  expectFail(['tabs'], (io) => io.html('tabs/many-tabbed.html', '<div class="salt-tabs" data-tabbed>', '<div class="salt-tabs" data-tabbed aria-label="Services">'), /<div\.salt-tabs> carries aria-label, which the markup does not declare/)
})
test('gaps: a body h2 under a level-2 section heading fails, at base 1 it is right', () => {
  expectFail(['rich-text'], (io) => io.html('rich-text/body-only-no-heading.html', '<h3>Our approach</h3>', '<h2>Our approach</h2>'), /ranks at or above the section heading's level 2/)
})
test('gaps: a lone carousel card granted priority must take it', () => {
  expectFail(['carousel'], (io) => io.html('carousel/inline-one-card.html', ' fetchpriority="high"', ' loading="lazy"'), /the priority image must be in carousel's track,list,single/)
})
test('gaps: a background with no focal point writes the fit alone', () => {
  expectFail(HERO, (io) => io.html('hero/full-bleed-background-no-focal-point.html', 'style="object-fit: cover"', 'style="object-fit: cover; object-position: center"'), /style="object-fit: cover; object-position: center" disagrees with the case, which gives "object-fit: cover"/)
})
test('gaps: a link-form button without the site\'s arrow fails, and one with it on a site with none', () => {
  expectFail(['process'], (io) => io.html('process/timeline-many.html', '<span class="salt-button__label">Book a visit<span class="salt-arrow" aria-hidden="true">&#x2060;→</span></span>', 'Book a visit'), /"Book a visit" draws no arrow, but the site supplies one/)
  expectFail(HERO, (io) => io.html('hero/split-image-right-later.html', '>Aftercare plans</a>', '><span class="salt-button__label">Aftercare plans<span class="salt-arrow" aria-hidden="true">&#x2060;→</span></span></a>'), /draws an arrow, which the site does not supply/)
  expectFail(HERO, (io) => io.html(`${SPLIT}.html`, '<span class="salt-button__label">See our work<span class="salt-arrow" aria-hidden="true">&#x2060;→</span></span>', 'See our work'), /"See our work" draws no arrow, but the site supplies one/)
})
test('gaps: the ungrouped index is one list with no group', () => {
  expectFail(['collection-showcase'], (io) => io.html('collection-showcase/index-posts-ungrouped.html', '<ul class="salt-showcase__index" role="list">', '<div class="salt-showcase__group">\n      <ul class="salt-showcase__index" role="list">'), /index-posts-ungrouped\.html/)
})
test('counts: the pagination window must be the one the page gives', () => {
  expectFail(['listing'], (io) => io.html('listing/cards-pagination-gaps.html', '          <li class="salt-pagination__gap" aria-hidden="true">…</li>\n', ''), /the pagination draws \[previous, 1, 4, 5, 6, gap, 9, next\]; page 5 of 9 gives \[previous, 1, gap, 4, 5, 6, gap, 9, next\]/)
  expectFail(['listing'], (io) => io.html('listing/cards-with-pagination.html', '<li><a class="salt-pagination__link" data-step="next"', '<li><a class="salt-pagination__link" data-step="nextx"'), /cards-with-pagination\.html/)
})
test('counts: a tab set must draw a panel per tab and controls only when tabbed', () => {
  expectFail(['tabs'], (io) => {
    const rel = 'fixtures/tabs/many-tabbed.html'
    const text = readFileSync(path.join(io.dir, rel), 'utf8')
    io.write(rel, text.replace(/\n *<div class="salt-tabs__panel" id="tabs-many__panel-3"[\s\S]*?\n {10}<\/div>(?=\n {8}<\/div>)/, ''))
  }, /tab panels drawn; the case has 3 tabs|many-tabbed\.html/)
  expectFail(['tabs'], (io) => io.html('tabs/no-name-stacked.html', '<div class="salt-tabs">', '<div class="salt-tabs" data-tabbed>'), /carries data-tabbed, which the markup draws only when/)
})

// Display forms (SC-016, section#display-forms).
const LIST = 'collection-showcase/list-posts-dated'
test('display: a case that draws a date names its locale', () => {
  expectFail(['collection-showcase'], (io) => io.json(`${LIST}.json`, (d) => { delete d.context.locale }), /draws a date, time or phone, so context\.locale must say/)
})
test('display: a date not in the locale\'s long form fails', () => {
  expectFail(['collection-showcase'], (io) => io.html(`${LIST}.html`, '>12 March 2026<', '>12/03/2026<'), /reads "12\/03\/2026"; en-GB gives "12 March 2026"/)
})
test('display: a datetime that is not ISO 8601 fails', () => {
  expectFail(['collection-showcase'], (io) => io.html(`${LIST}.html`, 'datetime="2026-03-12"', 'datetime="12/03/2026"'), /is not ISO 8601/)
})
test('display: a phone href not built by the rule fails', () => {
  expectFail(['contact'], (io) => io.html('contact/closed-with-details.html', 'href="tel:01174960123"', 'href="tel:+441174960123"'), /has href tel:\+441174960123; section#display-forms gives tel:01174960123/)
})
test('display: JSON with escaped slashes in an attribute fails', () => {
  expectFail(['locations'], (io) => io.html('locations/one-office-open.html', 'data-timezone="Europe/London"', 'data-timezone="Europe\\/London"'), /escapes a slash/)
})

// The contact form in the fixtures (SC-016, item 4).
test('form: a field whose type does not follow its name fails', () => {
  expectFail(['contact'], (io) => io.html('contact/form-open.html', 'name="email" type="email"', 'name="email" type="text"'), /type="text" disagrees with the case, which gives "email"/)
})
test('form: the message without rows fails', () => {
  expectFail(['contact'], (io) => io.html('contact/form-open.html', ' rows="6"', ''), /<textarea\.salt-contact__input> lacks rows/)
})
test('form: a placeholder written for a value the normaliser does not mask fails the mutation proof', () => {
  expectFail(['contact'], (io) => {
    const src = readFileSync(path.join(pkg, 'normalise.mjs'), 'utf8')
    io.write('normalise.mjs', src
      .replace("['formToken', 'challengeToken'].includes(attrOf(el, 'name'))", "['formToken', 'challengeToken', 'returnTo'].includes(attrOf(el, 'name'))")
      .replace("PLACEHOLDERS[attrOf(el, 'name')]]", "PLACEHOLDERS[attrOf(el, 'name')] ?? '{{salt:return}}']"))
  }, /changing value on <input> does not change normalise's output/)
})

// Image sizes (SC-016, item 1).
test('images: the logo declares its drawn width in px, as Salt for Next.js does', async () => {
  const { drawnSizes, sourcesOf, slotOf } = await import('./salt_image_slots.mjs')
  const table = JSON.parse(readFileSync(path.join(pkg, 'contract/image-sizes.json'), 'utf8'))
  const wordmark = { url: '/u/mark-{width}.png', width: 600, height: 80 }
  // site-logo.tsx's own example: a 600x80 wordmark at logoHeight 48 draws 360px.
  assert.equal(drawnSizes(table, 'logo', wordmark, 48), '360px')
  assert.equal(drawnSizes(table, 'logo', wordmark), '240px')
  assert.deepEqual(slotOf({ attrs: [['class', 'salt-logo__image salt-logo__light']], children: [] }, [], 'site-header', () => undefined), { slot: 'logo', band: false })
  const { srcset, src } = sourcesOf(table, wordmark, '240px')
  assert.equal(src, '/u/mark-600.png')
  assert.ok(srcset.endsWith('/u/mark-384.png 384w, /u/mark-600.png 600w'), srcset)
})

test('images: sizes other than the slot\'s default for the band fails', () => {
  expectFail(HERO, (io) => {
    const rel = `fixtures/${SPLIT}.html`
    const text = readFileSync(path.join(io.dir, rel), 'utf8')
    io.write(rel, text.replace(/sizes="[^"]*"/, 'sizes="100vw"'))
  }, /sizes="100vw"; its slot \(half, band default\) gives/)
})
test('images: a srcset missing a candidate width fails', () => {
  expectFail(HERO, (io) => io.html(`${SPLIT}.html`, 'https://uploads.example/terrace-32.jpg 32w, ', ''), /srcset is not the candidates contract\/image-sizes\.json gives/)
})
test('images: a src that is not the widest width listed fails', () => {
  expectFail(HERO, (io) => io.html(`${SPLIT}.html`, 'src="https://uploads.example/terrace-1600.jpg"', 'src="https://uploads.example/terrace-1200.jpg"'), /is not the widest candidate of any media record/)
})
test('images: a candidate wider than the upload fails, and so does leaving out its own width', () => {
  expectFail(HERO, (io) => io.html(`${SPLIT}.html`, 'https://uploads.example/terrace-1600.jpg 1600w"', 'https://uploads.example/terrace-1600.jpg 1600w, https://uploads.example/terrace-1920.jpg 1920w"'), /srcset is not the candidates contract\/image-sizes\.json gives/)
  expectFail(HERO, (io) => io.json(`${SPLIT}.json`, (d) => { d.media.terrace.width = 1700 }), /src https:\/\/uploads\.example\/terrace-1600\.jpg is not the widest candidate|width is 1600; the media record says 1700/)
})
test('images: a media record that carries its own sizes fails', () => {
  expectFail(HERO, (io) => io.json(`${SPLIT}.json`, (d) => { d.media.terrace.sizes = '100vw' }), /media\.terrace\.sizes: a media record holds url, width, height/)
})
test('images: the srcset rule drops candidates below the viewport floor only for a bare vw share', async () => {
  const { widthsFor } = await import('./salt_image_slots.mjs')
  const table = JSON.parse(readFileSync(path.join(pkg, 'contract/image-sizes.json'), 'utf8'))
  assert.deepEqual(widthsFor(table, '100vw'), [640, 750, 828, 1080, 1200, 1920, 2048, 3840])
  assert.deepEqual(widthsFor(table, '(min-width: 64rem) 19rem, (min-width: 40rem) 50vw, 100vw').at(0), 384)
  assert.deepEqual(widthsFor(table, 'calc(100vw - 2rem)'), table.candidates)
})

test('form: a normaliser that masks an empty token fails the mutation proof', () => {
  expectFail(['contact'], (io) => {
    const src = readFileSync(path.join(pkg, 'normalise.mjs'), 'utf8')
    io.write('normalise.mjs', src.replace(" && attrOf(el, 'value') !== ''\n", '\n'))
  }, /emptying value on <input> does not change normalise's output/)
})
test('display: a phone written with an extension in brackets draws no link', () => {
  expectFail(['contact'], (io) => io.html('contact/closed-with-details.html', '<a href="tel:01174960123">0117 496 0123</a>', '<a href="tel:0117496012323">0117 496 0123 (23)</a>'), /section#display-forms gives no link/)
})
test('arrows: only a section\'s call to action takes the site\'s arrow', () => {
  expectFail(['pricing'], (io) => {
    io.json('pricing/three-plans-featured.json', (d) => { d.site = { ...(d.site ?? {}), arrow: '→' } })
    io.html('pricing/three-plans-featured.html', '>Choose Starter</a>', '><span class="salt-button__label">Choose Starter<span class="salt-arrow" aria-hidden="true">&#x2060;→</span></span></a>')
  }, /"Choose Starter[^"]*" draws an arrow, which only a section's call to action takes/)
})

// The site chrome and the page views (SC-018).
const HEADER = 'site-header/menu-submenus-phone-cta-sticky'
const SWAPS = 'site-header/light-and-dark-logo'
test('chrome: the chrome and the views SC-018 names are required', () => {
  expectFail(HERO, () => {}, /site-header has no fixtures \(fixtures\/site-header\/<case>\.json and \.html\), which SC-018 requires/)
  expectFail(HERO, () => {}, /not-found has no fixtures/)
})
test('chrome: a chrome or view case passes its own checks', () => {
  const dir = copy(['site-header', 'post', 'archive'])
  try {
    const r = run(dir)
    assert.doesNotMatch(r.out, /fixtures\/(site-header|post|archive)\//, r.out)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
test('chrome: a site key that is not declared fails, and logoHeight must be whole px', () => {
  expectFail(['site-header'], (io) => io.json(`${HEADER}.json`, (d) => { d.site.logoHeightPx = 48 }), /site\.logoHeightPx is not a declared site key/)
  expectFail(['site-header'], (io) => io.json(`${HEADER}.json`, (d) => { d.site.logoHeight = '48px' }), /site\.logoHeight is the logo's drawn height, a whole number of px/)
})
test('chrome: the chrome never holds priority media, and a view must say whether it does', () => {
  expectFail(['site-header'], (io) => io.json(`${HEADER}.json`, (d) => { d.context.priorityMedia = false }), /the chrome never holds the priority image/)
  expectFail(['post'], (io) => io.json('post/full.json', (d) => { delete d.context.priorityMedia }), /context\.priorityMedia must say whether the plan grants this view/)
})
test('chrome: a case under the wrong kind key fails', () => {
  expectFail(['post'], (io) => io.json('post/full.json', (d) => { d.chrome = d.view; delete d.view }), /unknown key chrome/)
})
test('chrome: a view with a second h1 fails, and so does an h1 in the chrome', () => {
  // Inside content the markup leaves open (a nested section's block, the drawer's panel), so the
  // heading rule itself is what fails.
  expectFail(['archive'], (io) => io.html('archive/topic.html', 'data-block="listing">', 'data-block="listing">\n          <h1>Again</h1>'), /a view draws exactly one h1, its title \(section#single-h1\); this draws 2/)
  expectFail(['site-header'], (io) => io.html('site-header/drawer-open.html', '<div class="salt-drawer__panel">', '<div class="salt-drawer__panel">\n        <h1>Menu</h1>'), /the site-header draws an h1; the page's h1 belongs to its main/)
})
test('chrome: an id that is no landmark, anchor or vocabulary-owned part fails', () => {
  expectFail(['archive'], (io) => io.html('archive/topic.html', 'data-block="listing">', 'data-block="listing">\n          <p id="intro-1">x</p>'), /id intro-1 is not a landmark id, a section's anchor or <owner>__<part>/)
  expectFail(['archive'], (io) => io.html('archive/topic.html', 'data-block="listing">', 'data-block="listing">\n          <p id="nowhere__intro">x</p>'), /id nowhere__intro is not a landmark id/)
})
test('chrome: the logo\'s sizes is its drawn width at site.logoHeight', () => {
  expectFail(['site-header'], (io) => io.json(`${HEADER}.json`, (d) => { d.site.logoHeight = 40 }), /sizes="180px"; its slot \(logo\) gives "150px"/)
})
test('chrome: a logo is matched to its record by the exact template, never by prefix', () => {
  // The dark image's own record is renamed away; a record whose template is a prefix of its src
  // must not stand in for it.
  expectFail(['site-header'], (io) => io.json(`${SWAPS}.json`, (d) => {
    const dark = d.site.logo.dark
    d.media[dark].url = 'https://uploads.example/hollow-oak-night-{width}.png'
    d.media.prefix = { url: 'https://uploads.example/hollow-oak-{width}.png', width: 480, height: 120, alt: '' }
  }), /src https:\/\/uploads\.example\/hollow-oak-dark-480\.png fills no media record's template exactly/)
})

// Review of #13, 1 and 2: landmark ids on their own elements; owners from this file only.
test('chrome: a nested section anchored with a landmark id fails, and a landmark id off its element', () => {
  expectFail(['archive'], (io) => {
    const rel = 'fixtures/archive/topic.html'
    io.write(rel, readFileSync(path.join(io.dir, rel), 'utf8').replace('id="posts"', 'id="site-navigation"').replaceAll('posts__heading', 'site-navigation__heading'))
    io.json('archive/topic.json', (d) => { d.document.listing.anchorId = 'site-navigation' })
  }, /a section anchored with the landmark id site-navigation renders as site-navigation-section/)
  expectFail(['archive'], (io) => io.html('archive/topic.html', 'data-block="listing">', 'data-block="listing">\n          <p id="main">x</p>'), /the landmark id main is on <p>, not its landmark element/)
})
test('chrome: an id owned by a file this one does not draw fails', () => {
  expectFail(['site-footer'], (io) => io.html('site-footer/consent-panel-open.html', 'id="site-footer__consent-analytics-description">', 'id="site-footer__consent-analytics-description"><span id="site-header__submenu-2">x</span>'), /id site-header__submenu-2 is not a landmark id, a section's anchor or <owner>__<part> owned by site-footer/)
})

test('chrome: a nested section\'s card titles rank below its heading (review of #13, 3)', () => {
  expectFail(['archive'], (io) => {
    const rel = 'fixtures/archive/topic.html'
    io.write(rel, readFileSync(path.join(io.dir, rel), 'utf8').replace(/<h3>/g, '<h2>').replace(/<\/h3>/g, '</h2>'))
  }, /<h2> in the nested section posts ranks at or above its heading's level 2/)
})

test('images: a related service card takes the grid\'s card slot, three columns in the full band (review of #13, 5; SC-019)', async () => {
  const { slotOf, sizesOf } = await import('./salt_image_slots.mjs')
  const table = JSON.parse(readFileSync(path.join(pkg, 'contract/image-sizes.json'), 'utf8'))
  const list = { name: 'ul', attrs: [['class', 'salt-grid salt-showcase salt-related__list']], children: [] }
  const media = { name: 'div', attrs: [['class', 'salt-showcase__media']], children: [] }
  const placed = slotOf({ attrs: [], children: [] }, [media, list], 'service', () => undefined)
  // No shared stylesheet gives a view's main a measure, so the grid spans the full band (SC-019).
  assert.equal(placed.fixedBand, 'full')
  assert.equal(sizesOf(table, placed, placed.fixedBand), table.slots.card.bands.full['3'])
})

test('chrome: aria-current marks the link to context.path, and only it (review of #13, 6)', () => {
  const FOOT = 'site-footer/columns-socials-copyright'
  expectFail(['site-footer'], (io) => io.json(`${FOOT}.json`, (d) => { d.context.path = '/journal/' }), /marks \/about\/ current, but the page's path is \/journal\//)
  expectFail(['site-footer'], (io) => io.html(`${FOOT}.html`, ' aria-current="page">About us', '>About us'), /link to \/about\/, the page's path, lacks aria-current="page"/)
  expectFail(['post'], (io) => io.json('post/full.json', (d) => { delete d.context.path }), /marks a link current, but the case gives no context\.path/)
  expectFail(['site-header'], (io) => io.html('site-header/light-and-dark-logo.html', /<a class="salt-nav__link" href="(\/[a-z]+\/)">/.exec(readFileSync(path.join(pkg, 'fixtures/site-header/light-and-dark-logo.html'), 'utf8'))[0],
    /<a class="salt-nav__link" href="(\/[a-z]+\/)">/.exec(readFileSync(path.join(pkg, 'fixtures/site-header/light-and-dark-logo.html'), 'utf8'))[0].replace('">', '" aria-current="page">')), /marks \/[a-z]+\/ current, but the page's path is \//)
})
test('chrome: a menu that links the current page twice marks both current (review of #13, A)', () => {
  const FOOT = 'site-footer/columns-socials-copyright'
  const dir = copy(['site-footer'], (io) => io.html(`${FOOT}.html`, '<a class="salt-footer__link" href="/about/" aria-current="page">About us</a>',
    '<a class="salt-footer__link" href="/about/" aria-current="page">About us</a></li>\n            <li><a class="salt-footer__link" href="/about/" aria-current="page">Who we are</a>'))
  try {
    const r = run(dir)
    assert.doesNotMatch(r.out, /fixtures\/site-footer\//, r.out)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('chrome: a nested section takes its anchor, spacing and track from document.listing (review of #13, 8)', () => {
  expectFail(['archive'], (io) => io.json('archive/topic.json', (d) => { d.document.listing.anchorId = 'stories' }), /<section\.salt-section> id="posts" is not "<anchor>"/)
  expectFail(['archive'], (io) => io.json('archive/topic.json', (d) => { d.document.listing.settings = { spacing: 'lg' } }), /data-spacing="md" disagrees with the case, which gives "lg"/)
  expectFail(['archive'], (io) => io.json('archive/topic.json', (d) => { d.document.listing.track = 'listing-2' }), /data-track="listing-1" disagrees with the case, which gives "listing-2"/)
  expectFail(['archive'], (io) => io.json('archive/topic.json', (d) => { delete d.document.listing }), /the archive nests a section, so document\.listing must describe it/)
})

test('chrome: a nested section with a background image must draw it, as a section case does (review of #13, B)', () => {
  const withImage = (d) => { d.document.listing.settings = { backgroundImage: { image: 'soil' } }; d.media.soil.focalPoint = { x: 30, y: 60 } }
  const tag = 'data-track="listing-1"'
  // Without data-media: refused, as for a section case.
  expectFail(['archive'], (io) => io.json('archive/topic.json', withImage), /<section\.salt-section> lacks data-media, which the markup requires when a background image is/)
  // With data-media but no background layer: the layer is required.
  expectFail(['archive'], (io) => { io.json('archive/topic.json', withImage); io.html('archive/topic.html', tag, `data-media ${tag}`) }, /background is not drawn, but a background image is set/)
  // With the layer but no focal point in its style: the focal-point style is required.
  expectFail(['archive'], (io) => {
    io.json('archive/topic.json', withImage)
    const u = (w) => `https://uploads.example/soil-health-${w}.jpg`
    const bg = `<img class="salt-section__media" src="${u(800)}" srcset="${u(640)} 640w, ${u(750)} 750w, ${u(800)} 800w" sizes="100vw" width="800" height="600" alt="" aria-hidden="true" loading="lazy" decoding="async">` +
      '\n    <div class="salt-section__scrim" style="--salt-scrim-alpha: var(--scrim-strong)"></div>'
    io.html('archive/topic.html', `${tag} style`, `data-media ${tag} style`)
    io.html('archive/topic.html', '    <div class="salt-section__content">', `    ${bg}\n    <div class="salt-section__content">`)
  }, /<img\.salt-section__media> lacks style, which the markup requires when/)
})

test('chrome: data-current-section marks the item whose submenu links the page, and no other (review of #13, C)', () => {
  expectFail(['site-header'], (io) => {
    io.html(`${HEADER}.html`, '<li class="salt-nav__item" data-current-section>', '<li class="salt-nav__item">')
    io.html(`${HEADER}.html`, '<li class="salt-nav__item">\n          <a class="salt-nav__link" href="/journal/">', '<li class="salt-nav__item" data-current-section>\n          <a class="salt-nav__link" href="/journal/">')
  }, /<li\.salt-nav__item> carries data-current-section, but no link in its submenu is to \/services\/planting-plans\//)
})

test('chrome: document.listing\'s heading is the nested heading\'s text, and its anchor is given once (review of #13, D)', () => {
  expectFail(['archive'], (io) => io.json('archive/topic.json', (d) => { d.document.listing.heading = 'Older posts' }), /the nested section's heading reads "Latest posts"; document\.listing\.heading gives "Older posts"/)
  expectFail(['archive'], (io) => io.json('archive/topic.json', (d) => { d.document.listing.heading = 3 }), /document\.listing\.heading is the nested section's heading text/)
  expectFail(['archive'], (io) => io.json('archive/topic.json', (d) => { d.document.listing.settings = { anchorId: 'stories' } }), /document\.listing\.settings\.anchorId is "stories", but the section's anchor is "posts"/)
})

test('chrome: the gate requires exactly the runner\'s list of chrome and view files, from one place (review of #13, E)', async () => {
  const { REQUIRED_FILES } = await import('../salt-contract/conformance.mjs')
  const dir = copy(HERO)
  try {
    const missing = [...run(dir).out.matchAll(/✗ ([a-z-]+) has no fixtures \(fixtures\/[a-z-]+\/<case>\.json and \.html\), which SC-018 requires/g)].map((m) => m[1])
    assert.deepEqual(missing.sort(), [...REQUIRED_FILES].sort())
  } finally { rmSync(dir, { recursive: true, force: true }) }
  const src = readFileSync(script, 'utf8')
  assert.match(src, /import \{[^}]*\bREQUIRED_FILES\b[^}]*\} from '\.\.\/salt-contract\/conformance\.mjs'/, 'the gate imports the runner\'s list')
  assert.doesNotMatch(src, /\[[^\]]*'not-found'[^\]]*\]/, 'the gate keeps no list of its own')
})

// SC-019's markup gaps, closed.
const SC019_HEADER = 'site-header/menu-submenus-phone-cta-sticky'
test('sc-019: the span form of the submenu toggle carries no type, the button form does', () => {
  expectFail(['site-header'], (io) => io.html(`${SC019_HEADER}.html`, '<span class="salt-nav__toggle" ', '<span class="salt-nav__toggle" type="button" '), /<span\.salt-nav__toggle> carries type, which the markup draws only when button form/)
})
test('sc-019: the theme toggle\'s span server form carries none of the button\'s attributes', () => {
  expectFail(['site-header'], (io) => io.html('site-header/theme-toggle.html', '<span class="salt-theme-toggle" aria-hidden="true"></span>', '<span class="salt-theme-toggle" aria-hidden="true" aria-pressed="false"></span>'), /<span\.salt-theme-toggle> carries aria-pressed, which the markup draws only when button form/)
  expectFail(['site-footer'], (io) => io.html('site-footer/display-preferences.html', '<span class="salt-theme-toggle" aria-hidden="true"></span>', '<button class="salt-theme-toggle" type="button" aria-pressed="false"></button>'), /<button\.salt-theme-toggle> lacks aria-label, which the markup requires when button form/)
})
test('sc-019: the drawer and the consent panel are drawn open', () => {
  expectFail(['site-header'], (io) => io.html('site-header/drawer-open.html', '<dialog class="salt-drawer" open', '<dialog class="salt-drawer"'), /<dialog\.salt-drawer> lacks open, which the markup requires/)
  expectFail(['site-footer'], (io) => io.html('site-footer/consent-panel-open.html', '<dialog class="salt-consent-panel" open', '<dialog class="salt-consent-panel"'), /<dialog\.salt-consent-panel> lacks open, which the markup requires/)
})
test('sc-019: the search input keeps the query', () => {
  expectFail(['search'], (io) => io.html('search/results.html', ' value="hedge"', ''), /<input\.salt-search__input> lacks value, which the markup requires when a query is set/)
  expectFail(['search'], (io) => io.html('search/results.html', ' value="hedge"', ' value="hedges"'), /value="hedges" disagrees with the case, which gives "hedge"/)
})
test('sc-019: an untitled footer column\'s list takes the nav\'s name', () => {
  expectFail(['site-footer'], (io) => io.html('site-footer/single-flat-menu-inverse.html', 'role="list" aria-label="Footer">', 'role="list">'), /<ul\.salt-footer__links> lacks aria-label, which the markup requires when the column has no title/)
  expectFail(['site-footer'], (io) => io.html('site-footer/single-flat-menu-inverse.html', 'role="list" aria-label="Footer">', 'role="list" aria-label="Links">'), /aria-label="Links" disagrees with the case, which gives "Footer"/)
})
test('sc-019: the header logo loads eagerly, the footer\'s lazily', () => {
  expectFail(['site-header'], (io) => {
    const rel = 'fixtures/site-header/light-and-dark-logo.html'
    io.write(rel, readFileSync(path.join(io.dir, rel), 'utf8').replaceAll('loading="eager"', 'loading="lazy"'))
  }, /the header logo is above the fold, so it must be loading="eager"/)
  expectFail(['site-footer'], (io) => {
    const rel = 'fixtures/site-footer/single-flat-menu-inverse.html'
    io.write(rel, readFileSync(path.join(io.dir, rel), 'utf8').replace(/(salt-logo__image[^>]*)loading="lazy"/, '$1loading="eager"'))
  }, /an img that is not the priority image must be loading="lazy"/)
})
test('sc-019: the header phone glyph carries no data-size', () => {
  expectFail(['site-header'], (io) => io.html(`${SC019_HEADER}.html`, 'data-icon="phone" ', 'data-icon="phone" data-size="sm" '), /carries data-size, which the markup draws only when never on the header phone glyph/)
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
test('normalise: white space between the children of a flex or grid container does not count', () => {
  // The three cases the review of #10's fixes raised: a flex actions row, an inline-flex tab
  // control and a grid process step, each written by a template one element to a line.
  same('<div class="salt-hero__actions">\n  <a class="salt-button" href="/a">A</a>\n  <a class="salt-button" href="/b">B</a>\n</div>',
    '<div class="salt-hero__actions"><a class="salt-button" href="/a">A</a><a class="salt-button" href="/b">B</a></div>')
  same('<div class="salt-tabs__control">\n  <input class="salt-tabs__input" type="radio">\n  <label class="salt-tabs__tab">One</label>\n</div>',
    '<div class="salt-tabs__control"><input class="salt-tabs__input" type="radio"><label class="salt-tabs__tab">One</label></div>')
  same('<li class="salt-process__step">\n  <span class="salt-process__number">1</span>\n  <img src="/a.jpg">\n</li>',
    '<li class="salt-process__step"><span class="salt-process__number">1</span><img src="/a.jpg"></li>')
  // Outside a container the same line break is a space a browser draws.
  differ('<div class="salt-hero__text">\n  <a href="/a">A</a>\n  <a href="/b">B</a>\n</div>', '<div class="salt-hero__text"><a href="/a">A</a><a href="/b">B</a></div>')
  differ('<p>Read <a class="salt-button" href="/x">Go</a> now</p>', '<p>Read<a class="salt-button" href="/x">Go</a>now</p>')
})
test('normalise: the contact form\'s per-request values are masked exactly, nothing else', () => {
  const form = (action, token, question, type = 'email', ret = '/contact/', other = 'x') => `<form class="salt-contact__form" action="${action}"><label class="salt-contact__label" for="c__challenge">${question}</label><input class="salt-contact__input" name="email" type="${type}"><input type="hidden" name="formToken" value="${token}"><input type="hidden" name="challengeToken" value="${token}"><input type="hidden" name="returnTo" value="${ret}"><input type="hidden" name="other" value="${other}"></form>`
  same(form('/api/contact', 'abc', 'What is 3 + 4?'), form('/wp-admin/admin-post.php', 'zzz', 'What is 2 + 9?'))
  // A changed field type, the return path and any other hidden value still differ.
  differ(form('/a', 't', 'q'), form('/a', 't', 'q', 'text'))
  differ(form('/a', 't', 'q'), form('/a', 't', 'q', 'email', '/elsewhere/'))
  differ(form('/a', 't', 'q'), form('/a', 't', 'q', 'email', '/contact/', 'y'))
  // Outside the contact form nothing is masked.
  differ('<form action="/a"></form>', '<form action="/b"></form>')
  differ('<div><input type="hidden" name="formToken" value="a"></div>', '<div><input type="hidden" name="formToken" value="b"></div>')
})
test('normalise: the challenge mask takes only the question\'s text, and only non-empty values', () => {
  const label = (q, marker) => `<form class="salt-contact__form" action="/a"><label class="salt-contact__label" for="c__challenge">${q}<span class="salt-contact__optional">${marker}</span></label></form>`
  same(label('What is 3 + 4?', '(required)'), label('What is 2 + 9?', '(required)'))
  differ(label('What is 3 + 4?', '(required)'), label('What is 3 + 4?', '(needed)'))
  const token = (v) => `<form class="salt-contact__form" action="/a"><input type="hidden" name="formToken" value="${v}"></form>`
  same(token('abc'), token('xyz'))
  differ(token(''), token('xyz'))
  differ('<form class="salt-contact__form" action=""></form>', '<form class="salt-contact__form" action="/a"></form>')
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
