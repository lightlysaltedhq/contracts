# Changelog — @lightlysaltedhq/salt-contract

Newest first. Dates are DD/MM/YYYY. What each part of a version means, and how a breaking change is
announced and migrated, is in `RELEASE-POLICY.md`. Decisions cited as `SC-nnn` are in Lightly
Salted's decision log for Product Salt.

## Unreleased (0.1.0, drafting)

- The owner's rulings of 09/10/2026 (SC-007, SC-008, SC-012 to SC-014) are applied, and no open
  question remains; the markup schema drops the `open-question` note topic.
  - Every id the system draws is `<owner>__<part>` (SC-012). The owner is the component, section or
    view id as `sections.json` names it, or `<anchor>`, the section's settled id, for ids inside a
    section. Parts are numbered from 1: `site-header__submenu-2`, `<anchor>__heading`,
    `<anchor>__tab-2`, `service__benefits-heading`. Only the landmark ids stay plain (`main`,
    `content`, `header`, `footer`, `nav`, `site-navigation`, `search`, `skip-link`). An anchor is
    slugged as WordPress's `sanitize_title` slugs it under the site's locale, then every run of
    underscores or `%xx` octets becomes one hyphen, repeated hyphens collapse and hyphens are
    trimmed (SC-014), on save and again at render, so it never contains `__` and never meets a drawn
    id; an empty slug counts as no anchor. "We're hiring" gives `were-hiring`; 'Straße' gives
    `strase` on en_GB and `strasse` on de_DE; 'contact__form' gives `contact-form`. Anchors settle
    in one pass in page order, as both platforms do (SC-013): an anchor equal to a landmark id
    becomes `<anchor>-section`, an id already taken takes the next free `-2`, `-3`, and a section
    with no anchor mints its id from its section id in the same pass. So `faq, main, faq, faq-2` and
    an unanchored `pricing` render `faq, main-section, faq-2, faq-2-2, pricing`.
  - The post, service, archive and search view bodies are fixed as Salt for Next.js's example app
    writes them (`salt-post__*`, `salt-service__*`, `salt-related`, `salt-archive__*`,
    `salt-search__results`). The post's author is the shared `author-box` component, and Salt for
    Next.js owes the rename (SC-008).
  - Locations' open-now status carries `data-hours`, `data-timezone` and `data-labels` for a script
    that recomputes it on load.
  - An image is one `img` with `srcset`, `sizes`, `width` and `height`, never `picture`.
  - `contract/sections.json` lists the icon names both platforms draw under `icons`, split into
    content and chrome. A platform may draw the shared `globe` glyph for a social mark it does not
    ship, with the platform in the link's accessible name (SC-008).
  - The section has no container element.
  - Salt for WordPress's `owes` records each change, including its `picture_sources` opt-in and the
    glyphs `chevron-right`, `external-link`, `moon` and `sun`.
- The header fixes every id it draws: `site-navigation` (a landmark), and
  `site-header__submenu-<n>`, `site-header__drawer-navigation` and
  `site-header__drawer-submenu-<n>`. The footer's column titles are `site-footer__column-<n>`, and
  the consent panel it draws uses `site-footer__consent-title`, `site-footer__consent-<category>`
  and `site-footer__consent-<category>-description`. A footer social link with no glyph carries the
  profile's name as text.
- `contract/sections.json` declares component variants (card's `style`), and the gate refuses
  component markup that describes a variant or option its entry does not declare, a vocabulary
  variant that offers a value more than once or defaults outside its options, an icon name `icons` does not
  list (in attributes or `dataAttributes`), an icon field whose default is not a content name,
  and any id the markup draws or points at (every id-referencing attribute, `href` fragments
  included) that is not a landmark id, `<anchor>` (only inside sections), or `<owner>__<part>`.
- The markup records the custom properties the shared stylesheets read (the case study's aside rows
  and measure, and the header's scriptless phone layout, a `noscript` style in the document head,
  drawn in page.json's head), and that fit and focal point reach the `img` as inline `object-fit`
  and `object-position` (SC-011).
- The case study names its four sections by `case-study__<part>-heading`, and the contact form's
  honeypot is `<anchor>__website`.
- The sections schema drops `openQuestions`.
- Locations' open-now rule states one order, hours carried past midnight included.
- Each collection source in `contract/sections.json` states whether it has a category taxonomy
  (`categories`, SC-010): services, case studies, posts, team, FAQs and locations do; testimonials
  do not. The sections schema requires it of every source with items, and the gate refuses a
  source that answers two ways or a source a collection-query can read with no answer. Both
  emitters read it (`categorisedSources` and `categorySources` in `emit/_contract.mjs`): a
  collection-query offers its by-category mode and categories picker only for a source with
  categories, and with a source select the picker shows only while the select holds one. Salt for
  Next.js owes a location-area taxonomy with its locations section; its team categories were
  already owed (SC-006). The Payload emitter names team's and locations' taxonomies `departments`
  and `areas` by default; a site names its own through `sources`.
- `emit/acf.mjs` (`./emit/acf`): generates the ACF page-sections field group from
  `contract/fields`, as ACF JSON (what `acf_add_local_field_group()` takes): one Flexible Content
  layout per section, keys following DATA02 from the contract path so reordering never changes
  them, and conditions as `conditional_logic` (`filled` as "has any value" / "has no value"; ACF
  cannot express SC-009's visible-text rule, which the field schema records). `acfSnapshot` and
  `checkAcfSnapshot` (or `node emit/acf.mjs --check`) are the consumer's drift check, and
  `acfSlugRegistry` feeds Salt for WordPress's slug gate. `reports/round-trip-acf.md` (not shipped)
  compares the output with salt-wordpress 5.0.0: 390 differences, every one recorded in the
  contract.
- `emit/payload.mjs` (`./emit/payload`): generates each section's Payload block config from
  `contract/fields`, as `toPayloadBlocks(options)` (upload collection, link targets, heading set,
  icon registry, installed sources, the site's rich-text editor). `payloadSnapshot` serialises it
  deterministically and `checkPayloadSnapshot` (or `node emit/payload.mjs --check`) fails a
  consumer's committed snapshot when a contract change renames, retypes or re-limits a field.
  `emit/_contract.mjs` holds what every emitter shares. `reports/round-trip-payload.md` (not
  shipped) compares the output with Salt for Next.js 0.11.0's blocks: 118 differences, every one
  recorded in the contract (SC-008 rules the two shared booleans' false default).
- `styles/` (`./styles/<file>`): the one shared stylesheet set (SC-002). `sections.css`,
  `primitives.css`, `blocks.css` and `chrome.css` come from Salt for Next.js's
  `packages/core/styles` at 1472afdd, which it will re-export; `theme.css` stays with each
  implementation. Changed from that source: `sections.css` names the token layer as what it needs,
  and framed images fill their frames from CSS alone (SC-011: section media, showcase cards and
  avatars, logos contained, case-study frames). `base.css` sets design-foundations' element
  convention in `@layer base` (headings in their text roles inside the page's landmarks, running
  text on `body`). With Tailwind v4 (imported after `tailwindcss`) and with no Tailwind it yields to
  every unlayered rule; with Tailwind v3 (imported into the stylesheet v3 processes) v3 emits it
  unlayered after preflight, where its (0,0,1) rules beat preflight on source order and lose to
  every class-keyed rule. Importing it before `tailwindcss` in v4, or serving it beside v3's output,
  is not supported (see the README). `views.css` styles the post, archive and service view bodies in
  the classes SC-007 adopts (the search view's body is its form and a listing, styled elsewhere),
  the service's related list, and the shared `author-box` (SC-008). Load order: base, sections,
  primitives, blocks, chrome, views.
- `contract/token-layer.json` (`./token-layer`, schema `./schema/token-layer`): the 126 custom
  properties the stylesheets read, or the markup writes into one they read, and a runtime emits,
  grouped, each with its meaning and source. A `writes` list gives each property the markup writes
  with a `<placeholder>` the setting that fills it, by placeholder name. Names only, never values.
- `npm run salt-stylesheets`: the stylesheets parse whole; 46 decision contracts hold, 45 ported
  from Salt for Next.js (five that read its runtime stay there) and one new (every framed image
  fills its frame); the token layer names exactly what the stylesheets read and every `var()` a
  markup element writes (attribute values, each value of an enum, and a `style` element's CSS),
  fallbacks included, each placeholder through its named value map; every token said to come from
  the markup is written by a markup element; every styled class is on a markup element.
- The package exists, with its gate (`npm run salt-contract` at the repository root) and its
  release workflow on the `salt-contract-v*` tag prefix. It stays `private` until 1.0.0.
- `RELEASE-POLICY.md`: one version for the package, what is major, minor and patch for every kind
  of artefact, deprecation over at least one minor, a machine-readable migration file for every
  major, exact pins and the lag rule for implementations, and staged releases with provenance.
- `contract/sections.json` (`./sections`, schema `./schema/sections`): the vocabulary. 17 sections
  (16 core, pricing at the edge), 29 components and 7 page views, each with the names and stored
  option values Salt for Next.js 0.11.0 and salt-wordpress 5.0.0 used before, so each platform's
  renames can be generated. Every current Next.js block and WordPress layout is mapped; WordPress
  `intro` folds into `rich-text`, and its five collection layouts into `collection-showcase`
  (testimonials as a slider into `carousel`). Its three open questions are ruled (SC-006).
- `contract/fields/` (`./fields/<section>`, schema `./schema/field-definition`): every section's
  editor fields, and the section settings every section shares, in one platform-neutral form
  each implementation will generate its fields from. Field types are only those Payload and ACF can
  both express. Where the platforms differed, one canonical definition is chosen and each
  platform's former name and stored value is recorded with what it owes. The nine open questions
  once listed in the schema's description are ruled (SC-006).
- `contract/markup/` (`./markup/<id>`, schema `./schema/markup`): element order, `salt-*` classes,
  data attributes, heading rules, zero state and priority media for all 17 sections, 29 components
  and 7 views. The shared accessibility rules are written once in
  `markup/section`. Every `salt-*` class in salt-nextjs's four section and component stylesheets
  appears on a contract element. Notes marked `open-question` now record only the work SC-006
  leaves open.
- The owner's rulings of 08/10/2026 (SC-006) are applied. A field condition may test whether a
  sibling is filled (`{ "field": "…", "filled": true }`, or `false` for empty), a MINOR addition
  to the field schema; the gate refuses one that names a group, list, collection-query or link,
  which ACF conditional logic cannot target. The background image's fit, position and tint, and
  the tabs and carousel screen-reader names, use it. Pricing stays an edge recipe on both
  platforms. A section anchor that is one of the ids main, content, header, footer, nav,
  site-navigation, search or skip-link, an id the page itself uses, or a repeat takes a numeric
  suffix. The divider draws above the section; a full-bleed hero sets its words over the
  section's background image; the collection-showcase source has no default; team members carry
  categories on both. In the markup, a quote card names its person with a heading; team cards
  carry optional email, phone and social links; the consent banner is drawn only when an
  integration needs consent; share links are same-tab text links; a single flat footer menu is
  one untitled column; the header carries `data-sticky` and its main navigation the id
  `site-navigation`; the contact section keeps an optional form intro; the contact form shows a
  privacy line and, beside a captcha, an arithmetic fallback inside `noscript`; `data-maplibre`
  leaves the map. Each platform's `owes` says what it must change. Left as work: the view body
  classes for archive, post, search and service; which icon names ship; whether locations'
  open-now status moves to the client; picture elements; and a check that no WordPress site
  styles the section's container div.
- The gate now checks the three artefacts against each other: every section has fields and markup,
  each variant is a select field with the same options, a select's default is one of its options,
  a condition names a sibling field, a filled condition names no group, list,
  collection-query or link, and sibling names are unique. The carousel's variant field is
  `cardStyle`, as the fields file names it.

