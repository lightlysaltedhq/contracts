# Changelog — @lightlysaltedhq/salt-contract

Newest first. Dates are DD/MM/YYYY. What each part of a version means, and how a breaking change is
announced and migrated, is in `RELEASE-POLICY.md`. Decisions cited as `SC-nnn` are in Lightly
Salted's decision log for Product Salt.

## 1.0.0 (candidate `1.0.0-rc.5`, prepared 13/10/2026; not published, dated when tagged)

**Semver call: MAJOR, the first release of the contract.** No earlier version was published, so no
implementation conformed to one. Adopting it is still a migration for existing sites, because the
contract renames and folds what Salt for WordPress 5.0.0 and Salt for Next.js 0.11.0 store (below,
*What a site does*). From 1.0.0, each change's part is decided by `RELEASE-POLICY.md`: section 1's
test, applied through section 2's table, where the stricter row wins.

### Added

- The vocabulary (`./sections`): 17 sections (hero, rich-text, call-to-action, media-text,
  features, stats, logos, gallery, process, faq, tabs, collection-showcase, carousel, listing,
  contact, locations, pricing), 29 components and 7 views, each with what each platform calls it
  today.
- Field definitions (`./fields/*`): every section's editor fields and the shared section settings,
  in one platform-neutral form, with each platform's former name and stored value (`formerly`) and
  what it must change (`owes`). The Payload and ACF emitters (`./emit/payload`, `./emit/acf`)
  generate each platform's half from them, byte-stable, with a drift check for the consumer.
- What the Payload drift check leaves to the consumer (SC-023). `PLATFORM_ADDITIONS` in
  `emit/payload.mjs` names the keys a consumer may add to a field: `admin.components`,
  `admin.initCollapsed`, `admin.layout` and `hooks`. `checkPayloadSnapshot` leaves out exactly
  those, on a field at any depth, and compares everything else byte for byte, so any other added
  key and any change to a generated one still fails. An `admin` holding nothing compares as an
  absent one. Admin conditions are not compared in 1.0.0: a condition is a function and is in
  neither snapshot. The check sees the clauses a field records under `custom.salt.condition`,
  and fails a snapshot that drops, adds or changes them; it does not see whether a field has an
  `admin.condition`, or what it does. A comparison may arrive in a later minor.
- The contract says which selects are radios (SC-023). The field schema's select gains an
  optional `control`, whose one value is `radio`; both emitters draw such a select as a radio
  (Payload `radio`, ACF `radio`) with a select's options, default and stored value. A link's
  `type` is the one radio; a collection-query's `mode` is a select, like every other select. A
  radio needs a default or to be required. Its layout is the platform's (`admin.layout` on
  Payload). Where a platform draws another widget today, the field's `owes` records it: Salt for
  Next.js a radio for a query's mode, Salt for WordPress a button group for a query's mode and
  for the gallery's and the showcase's columns.
- Postgres enum types, one per vocabulary (SC-023, after Salt for Next.js's BD-035). Selects that
  offer the same values share one type, named in `VOCABULARIES` in `emit/payload.mjs`:
  `enum_grid_columns`, `enum_button_style`, `enum_alignment` and `enum_media_side`. The site's
  icons keep one type per select. Where Salt for Next.js 0.11.0 named a select's type otherwise,
  the field records the former name as `platforms.nextjs.formerlyEnum`, a new optional key of the
  field schema's platform note, keyed by part for a collection-query: 12 records carrying 17
  former names.
- The `settings.anchorId` description states the slug rule in plain words, with no WordPress
  function name and no file path (SC-023). The rule itself is unchanged, in `markup/section.json`.
  No description an editor is shown cites a decision, a file or a platform function:
  `settings.toneDark` and the carousel's `cardStyle` are reworded too, and a test holds every
  emitted description to it on both platforms.
- Markup (`./markup/*`): element order, `salt-*` classes, data attributes, ids, heading rules,
  zero states and priority media for every section, component and view, and the page skeleton.
- The shared stylesheets (`./styles/*`): base, sections, primitives, blocks, chrome and views, and
  `styles/salt.css`, the one minified bundle both platforms serve verbatim after Tailwind v4's
  stylesheet. No colour literals; colours come from the token layer (`./token-layer`).
- Extension points: four dials (`./dials`: corners, shadows, button style, density) mapped to
  token-layer tokens and set per site in `salt-overrides.json`; view props per section
  (`./view-props/*`); the replaced-logic format (`./schema/replaced-logic`).
- Image sizes (`./image-sizes`): each slot's `sizes` per band and column count, the candidate
  widths, and the srcset capped at the upload's intrinsic width (SC-016).
- Fixtures (`./fixtures/*`): 110 cases with their expected HTML, for the 17 sections, the site
  header and footer, the post, service, case-study, archive, search and not-found views, and the
  page (SC-018, SC-019, SC-021); and the normaliser both sides are compared through
  (`./normalise`).
- Three fixture conventions the first conformance run settled (SC-023). Rich text is given in its
  stored form in a view as in a section: `service/full`'s intro holds the stored `h3`, drawn as
  `h2`, and the gate refuses any other heading level in a view's document. A collection is drawn
  in its stored order: a case's `collections` are already ordered, an adapter passes them through,
  and the contract names no sort (`collection-showcase/grid-team-contacts`). The archive and search
  views' pagination is compared without the shape of its addresses, which is routing and stays
  native (SC-003): the runner reads both sides of those views' cases through `routedOf` in
  `normalise.mjs`, which writes each pagination link's `href` as `{{salt:page-href}}`, as
  `archive/topic`'s and `search/results`'s expected HTML do; which links are drawn, their order,
  labels, `rel`, `data-step` and `aria-current` still compare, and a link with no address
  differs. A listing section's pagination compares whole.
- Three rulings on the run against `1.0.0-rc.2` (SC-024). A framework's own attributes on an image
  are not masked: `next/image`'s `data-nimg` and inline `color:transparent` differ, and
  `markup/media.json` records that Salt for Next.js owes its own `img`. The footer's consent
  control is drawn `aria-disabled="true"` until script hydrates and not after:
  `markup/site-footer.json` declares the attribute its note already described, four footer fixtures
  and the four page fixtures expect it, and `consent-panel-open` does not, since only script
  opens the panel. The gate reads the case's `state`: the attribute is refused where
  `consentPanelOpen` is true and required everywhere else. Each state says how the element it
  concerns is drawn, so `drawerOpen` and `themeScheme` say nothing of this control. The gate
  requires each panel's dialog if and only if its state says it is open (`consentPanelOpen`,
  `drawerOpen`). It refuses a `state` that is no object, a state key the README's `state` row
  does not document and a panel's state that is not `true` or `false`, and fails when the states
  it knows and that row disagree. An icon's `fill` and `stroke` are artwork,
  like what is inside it (SC-007): the normaliser drops both from `svg.salt-icon`, so a filled
  mark passes against a stroked fixture, while the svg's every other attribute still compares and
  the gate still holds each of the two to the values `markup/icon.json` allows.
- Seven rulings from bringing Salt for Next.js's core markup to `1.0.0-rc.3` (SC-025), six of
  which change the contract. A section that draws no heading has body base 1, wherever it sits on
  the page, so its body headings and card titles are `h2` and no rank is skipped
  (`section#body-heading-base`); `rich-text/body-only-no-heading`, `carousel/inline-no-name-list`,
  `carousel/inline-quote-label-inverse` and `pricing/one-plan-inverse`, four fixtures, rise a
  level. `markup/pricing.json` declares `headingBeforeOwn`, as every section that can draw a
  heading with none of its own does, which is what puts the page's `h1` first. The gate fails a
  body whose first heading is not base + 1, a title that is not base + 1, a rank skipped on the
  way down a rich-text body, and a section that draws headings with none of its own and no
  `headingBeforeOwn`. A case study's result in a showcase is
  one `stat` string, as the view props have it: `collection-showcase/featured-case-studies` no
  longer splits it into a value and a suffix span. The contact form's challenge field and its two
  tokens come from the form's own response to a send, never from the page as first drawn, so a
  contact page can be cached: `contact/form-open` loses them, `markup/contact-form.json` says
  when they are drawn, and without script the endpoint answers in its own response and never by
  redirecting back to the page. An anchor an editor typed is settled before any id is minted
  (`section#anchors`), so an unanchored section never takes an editor's name, and a minted id is
  numbered over the stored layout, counting sections that draw nothing, so it does not move when
  one above it empties or fills. The phone and email
  links in the contact details and the link in the privacy line carry `salt-contact__link`, which
  `styles/primitives.css` underlines in the band's own ink and gives the focus indicator (WCAG
  1.4.1), so `styles/salt.css` changes and each implementation serves the new bytes. Of the
  header's two logos only the default scheme's is `loading="eager"`; the other scheme's is lazy.
  The other ruling changes no file: a team member's email, phone and social links are drawn
  only when filled, as `markup/card.json` already says.
- Two rulings change the contract after `1.0.0-rc.4` (SC-026, SC-027). The team source has no
  categories, on either platform (SC-027): `contract/sections.json` gives team `categories` false
  in the collection-showcase and the carousel, so a team query offers the automatic and manual
  modes only, with no categories picker, as testimonials do. Both emitters follow from that
  answer, and `SOURCE_DEFAULTS` names no taxonomy for team (`departments` on Payload and
  `department` on ACF are gone); a taxonomy a site names for team gives it no by-category mode.
  Salt for Next.js no longer owes a team taxonomy: a member's job title and department stay free
  text. Salt for WordPress owes dropping by-category and the department picker from its team
  layout's query, which the ACF round trip records as one more difference (403). The priority
  image is the principal image of the first section on the page that has one, not of the first
  section only (SC-026): a page that opens with a text band gives `fetchpriority="high"` to the
  first image below it. That is a rewording of `section#priority-media`, and no fixture changes,
  since a case states its own priority context. The fixtures gate still requires a case at index
  0 to be granted the priority image, and no longer refuses a later section that holds it. No
  fixture case yet shows a later section taking the slot, so a conforming run does not prove
  SC-026.
- The case-study view has fixtures and is required of every implementation (SC-021).
  `fixtures/case-study/` holds four cases (`full`, `aside`, `band` and `minimal`), `case-study`
  joins `REQUIRED_FILES`, and a full conformance run refuses to declare it not shipped. The
  markup closes two gaps: each delivered service's card sits in an `li`, and the view declares its
  priority image (role `image`). The header band, once a note, is the view's `header` variant
  (`plain` or `band`), keyed to a site option through the markup's new `variants[].site`; a band
  draws the header as a section band, with its tones, `md` spacing, the default width, the
  spacing's custom property and its parts in `div.salt-section__content`. A new declared site key,
  `site.caseStudy` (`media`, `header`, `headerTone`, `headerToneDark`), carries the view's layout
  into a fixture's input, and the gate ties it to the HTML: `data-media`, the aside's row count
  and its measure (a rem length, 64rem for a default band) follow the input. The case-study
  image placements in `image-sizes.json` name their img by selector; a delivered service's card
  takes the card slot at three columns in the full band in the flow, and in the aside the new
  `aside-card` slot: the default band from 64rem, where the services keep to the measure, and the
  full band below. Salt for Next.js owes naming the view's four sections and that card slot; Salt for
  WordPress owes the markup, and an ACF options page for the band and the aside layout.
- The conformance runner (`./conformance`, bin `salt-conformance`): fixtures, field snapshots,
  class vocabulary and the served stylesheet, reported as `conformance.json` (format
  `salt-conformance/1`) and `conformance.md`. An implementation conforms only when all four checks
  ran for everything it ships and all pass (SC-017).
- Schemas for every contract file (`./schema/*`).

### What a site does

A site moving onto a platform release that pins this contract migrates its stored content once,
through that platform's own migration. As the first major, 1.0.0 has no earlier major to migrate
from, so it ships no `contract/migrations/` file (`RELEASE-POLICY.md` section 4); what each site
moves from is recorded per item instead, and the platforms' releases carry the migrations:

- Salt for WordPress 5.0.0 sites: `intro` folds into `rich-text`; the `services`, `work`, `team`,
  `blog_teaser` and grid `testimonials` layouts fold into `collection-showcase`, and slider
  `testimonials` and `scroll_carousel` into `carousel`; section settings move from `section_*` to
  the shared settings; several option values are renamed. Each layout slug and field name that
  changes is listed under `formerly` in `contract/sections.json` and `contract/fields/`, and each
  needs a slug-migration entry (FLEET07).
- Salt for Next.js 0.11.0 sites: block slugs and option values that change are listed the same
  way; the Payload migration renames stored blocks and values. It renames the Postgres enum types
  too (SC-023): each select whose type had another name records it as `formerlyEnum`, which
  covers the 52 selects of 0.11.0's blocks whose type name changes, and the mode and order of the
  queries the contract folds. The types that fold into one move their columns to the shared type;
  they are not a plain rename: the three button styles (`enum_hero_button_style`,
  `enum_cta_button_style`, `enum_media_text_button_style`) into `enum_button_style`, the two media
  sides (`enum_hero_media_side`, `enum_media_text_side`) into `enum_media_side`, and the two query
  modes (`enum_content_query_mode`, `enum_content_query_mode_unfiltered`) into `enum_query_mode`. A select
  0.11.0 left to Payload's derived type name (the two alignments, the three icons, the showcase's
  and the carousel's source) has no fixed former name to record, so the migration reads it from
  the site's schema.
- Both: render the contract's markup and serve `styles/salt.css` byte for byte, then run
  `salt-conformance` in CI. What each platform must change is its `owes` in the contract files.

## 0.x drafting (never published)

The drafting record, newest first: an entry higher up supersedes any below it. Counts, open
questions and "left as work" notes here describe the draft at the time; 1.0.0 above is what ships.

- The page fixture and the chrome markup gaps (SC-019). `page.json`'s head declares the link to
  the served `salt.css`. Page cases (`page` is a required file) compare the body and only Salt's head
  elements, that link read as its `rel` and file name and the scriptless phone layout's `noscript`
  style, through `pageOf` in `normalise.mjs`; the rest of the head, the `html` and `body` elements'
  attributes and the body's `script`, `style` and `link` elements are the platform's. The adapter
  returns the whole document for a page. A section nested in a page or view carries its own field
  `values` and is held to its own markup, variants and priority image. Data attributes that mirror a
  field (`data-align`, `data-media-side`, `data-columns`, `data-greyscale`, `data-source`) are tied to
  that field in every case. Markup: the header's span toggle carries no `type`; the theme toggle is a
  button, fixtured under `state.themeScheme`, or its empty `span[aria-hidden]` server form, in the
  header and the footer; the drawer and consent panel carry `open`; the search input keeps the
  query; an untitled footer column's list takes the nav's name; the header logo of
  the site's default scheme is `loading="eager"`, as it is above the fold, and the other scheme's
  is lazy (SC-025); the header phone glyph carries no `data-size`; the
  service view's related cards declare the card slot for the full band, as no stylesheet gives a
  view's `main` a measure.
- Fixtures for the site chrome and page views (SC-018): 20 cases for `site-header`, `site-footer`
  and the `post`, `service`, `archive`, `search` and `not-found` views, 100 cases in all. A case
  names its kind by its key (`section`, `chrome`, `view`); chrome and view cases read `site`,
  `document`, `route` and `state`, and the adapter renders the header or footer element, or the
  view's `main#main`. The fixtures gate reads them against their own markup: one h1 per view and
  none in the chrome; landmark ids only on their landmark elements; `<owner>__<part>` owners limited
  to the file, the components it draws and its nested sections; a view's nested section described
  by `document.listing` and held to the heading rules; `aria-current` tied to the page's path; view
  images in their slots, related service cards in the grid's card slot. `site` keys are declared,
  `site.logoHeight` among them, and a logo is matched to its media record by its exact template. The
  conformance runner runs the chrome and views too, each reported as a file of its own and counted
  in the verdict; `--sections` and `--not-shipped` take their ids, and a full run refuses the SC-018
  files as not shipped.
- `styles/salt.css` (`./styles/salt.css`): the one stylesheet both platforms serve, byte for byte.
  It is the six shared stylesheets in load order (base, sections, primitives, blocks, chrome,
  views), minified with comments stripped (45 KB), built deterministically by `npm run
  build:salt-bundle` with the lockfile's esbuild. `npm run salt-stylesheets` fails when the
  committed bundle is not what the sources build, or when `styles/` and the build's load order name
  different sources; its other checks still read the six sources. Both platforms serve it verbatim
  as a stylesheet of its own (a separate `<link>` or enqueue of a copy, never through Tailwind or a
  CSS pipeline): after Tailwind v4's stylesheet (both platforms' version), whose `@layer theme,
  base, components, utilities` declaration its `@layer base` joins, or first with none. Tailwind v3
  beside it is not supported.
- The conformance runner (ID-3608), `conformance.mjs` (`./conformance`, bin `salt-conformance`),
  which each implementation points at itself in its own CI. Per section it sends every fixture case
  to the implementation's adapter (a command or a local endpoint), normalises both sides and names
  the case and the first differing node by path; checks the implementation's Payload or ACF field
  snapshot with the emitters' own drift checks, filed per section; checks every `salt-*` class it
  writes against the markup's vocabulary; and checks the stylesheet it serves (a file, or a running
  site's URL) is byte-identical to `styles/salt.css`, refusing a path inside the package itself (a
  link elsewhere to the package's file passes). A fixture mismatch aligns each element's children
  first, identical nodes anchor the alignment, so a moved identical node is `order` (with both
  positions), a replaced sibling `element`, and a dropped or added one `missing` or `unexpected`. An
  implementation conforms only when all four checks ran for every section it ships and all pass
  (SC-017); a run that leaves a section or a check out needs `--partial`, which is reported as
  partial, not conforming, and exits 1. It writes `conformance.json` (format `salt-conformance/1`,
  the parity matrix's input) and `conformance.md`, and exits 1 on any mismatch. `--not-shipped`
  reports a section as not shipped rather than failed. `npm run salt-conformance` (in `verify`, CI
  and the release workflow) runs it against the reference adapter with both emitters' snapshots,
  which must conform.
- Image sizes (SC-016): `contract/image-sizes.json` (`./image-sizes`, schema `./schema/image-sizes`)
  fixes each image slot's default `sizes`, per band and per card column count, the candidate widths
  and the rule that picks them, the srcset capped at the upload's intrinsic width (listed itself
  when it is no candidate), `src` the URL at the intrinsic width, and the site logo's sizes as its
  drawn width in px, from Salt for Next.js's table. `markup/media.json` and the section background
  read it. A site that swaps a view or changes a layout declares its own sizes per slot in
  `salt-overrides.json` under `imageSizes`. Salt for WordPress owes matching sizes and registered
  widths, with auto-sizes disabled and core's default sizes dropped from its srcset; Salt for
  Next.js owes the cap, and width and height on fill images (SC-007). Fixture media records give a
  URL template per width; every image asserts its slot's default.
- `toneDark: auto` writes the section's tone, and the shared stylesheet draws its dark form; the
  label and the markup note say so (SC-016).
- `section#display-forms` (SC-016): dates and times display in the site's locale, `<time datetime>`
  is ISO 8601, a phone link's href follows Salt for Next.js's rule, and a number with an extension
  or a stray bracket draws no link, and JSON in data attributes has no escaped slashes. Fixtures pin
  `en-GB`.
- The contact form is fixtured (SC-016): field names, types, the message's rows, autocomplete and
  redrawn values are in the markup. The normaliser masks only the form's action, its two token
  values and the challenge question (the question's own text only, and only values that are
  present), as declared placeholders. New cases: open, invalid and sent.
- Markup corrections: images always carry width and height (SC-007); a rich-text body may draw h2 at
  base level 1; the accordion's group name is only on each `details`, and the tab set's name only on
  its radiogroup; pagination draws its window with gaps; the showcase index has an ungrouped form; a
  lone carousel card may take the priority image (`priorityMedia.role` may list roles, a MINOR
  schema loosening); which buttons take the site's arrow (a section's calls to action only), the
  section index counted from 0 (the plan's index, as both platforms count it) and a background with
  no focal point are stated. The fixtures gate also checks tab counts and the pagination window
  against the case. 80 fixture cases.
- The extension points (ID-3606), with the customisation ladder as normative text in the README:
  brand settings, dials and tokens, variants, swap a view, replace logic, a client-only section,
  each saying what still reaches a site on update. No separate slots-and-hooks system.
  - `contract/dials.json` (`./dials`, schema `./schema/dials`): the four admin-only design dials
    1.0.0 ships (SC-015). Corners (`--radius-sm`, `-md`, `-lg`: square, soft, round), shadows
    (`--salt-card-shadow`: none, subtle, raised, on design-foundations' `--shadow-sm` and
    `--shadow-md`, requiring the shadow colour roles `--color-shadow-sm`, `-md` and `-lg`, which a
    runtime emits while the dial is set), button style (`--salt-button-radius`, read by buttons,
    pagination links and the copy-link button: square, soft, pill) and density
    (`--space-section-sm`, `-md`, `-lg`: compact, comfortable, spacious). Each option points a token
    at a rung, or 0, and the runtime writes that rung's value. Both platforms owe all four.
  - Two component tokens the stylesheets read, both optional, so nothing changes until an admin
    turns a dial: `.salt-card` reads `--salt-card-shadow` (fallback `none`) and `.salt-button`,
    `.salt-pagination__link` and `.salt-copy-link__button` read `--salt-button-radius` (fallback
    `--radius-md`). The token layer names 131 properties: the 128 the stylesheets and markup read,
    and three a dial requires, each marked `requiredBy` (a new optional key in
    `./schema/token-layer`).
  - `contract/view-props/` (`./view-props/<section>`, schema `./schema/view-props`): the props each
    section's view receives, as `data` per section and the page `plan` once in `_shared`, in kinds
    both a TypeScript type and a PHP array shape can be generated from. A prop drawn from a field
    takes the field's canonical name (SC-015) and is nullable whenever its field can come out empty
    (SC-009 cleaning, a deleted upload), required or not; a value only the logic guarantees, by
    dropping the row, comes from the logic. A team card carries its contact and social links, and a
    carousel, gallery or tab set says whether it is named.
  - `schema/replaced-logic.schema.json` (`./schema/replaced-logic`): the `salt-overrides.json` a
    client site writes when it swaps a view or takes a section over, which the update flag reads. On
    WordPress, `OVERRIDES.md` points at it (SC-015). A view swap is flagged when the section's view
    props or `_shared.json` change.
  - `npm run salt-extensions` (in `verify`, CI and the release workflow): every token a dial moves
    is in the token layer, and every rung it points at is there or in design-foundations' scale
    shape, and every token a rung's value references is required by the dial and named in the token
    layer; every section has view props; every prop drawn from a field names a real one, takes its
    name, is nullable whenever its field can come out empty, and offers its select's options; the
    replaced-logic examples hold. `npm run salt-stylesheets` names the card's shadow as a focus-rule
    exception and accepts a dial's radius token in front of a rung, and passes a token no stylesheet
    reads only when a dial requires it, and the release workflow now runs it too.
- Fixtures (`fixtures/<section>/<case>.json` and `.html`, `./fixtures/*`, ID-3604): 73 cases over
  the 17 sections. Each pairs a section's stored field values and its page context with the
  default HTML both platforms must render. Together they cover every variant option, the zero
  state, the inverse band and every value of the shared tone, dark tone, spacing and width
  settings. Every case sets its anchor, so every drawn id is known (SC-012), and its context is a
  page that could exist (track numbers, the single h1, priority media, collapse).
- `normalise.mjs` (`./normalise`): the one normaliser both platforms compare through. It folds
  attribute and class order, white space at block boundaries (between inline elements any run is
  one space and counts), boolean-attribute and character-reference forms, comments, the upload host
  in `src` and `srcset`, and icon artwork (SC-007). It never touches ids.
- The README defines the fixture input and the adapter protocol the conformance runner calls: a
  case's JSON on stdin and the section's HTML on stdout, or a local endpoint.
- `npm run salt-fixtures` (in `verify`, CI and the release workflow) proves coverage, every input
  against `contract/fields`, every expected HTML against `contract/markup` (element order, classes,
  required and undeclared attributes, conditional attributes and elements the case switches on or
  off, data attributes, headings and `aria-labelledby`, ids, and SC-007's image rules), every case
  context, and that the normaliser is idempotent and no one-attribute change survives it.
- `markup/media-text.json` counts alternating rows from 0; `markup/tabs.json` draws the tab set's
  `aria-label` only when it is named.
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
    in two steps (SC-013, SC-025). The anchors editors typed come first, in page order: an anchor
    equal to a landmark id becomes `<anchor>-section`, and an id already taken takes the next free
    `-2`, `-3`. Each section with no anchor then mints its id from its section id, from what is
    left. So `faq, main, faq, faq-2` and an unanchored `pricing` render
    `faq, main-section, faq-2, faq-2-2, pricing`, and an unanchored `faq` section above a section
    anchored `faq` renders `faq-2, faq`. A minted id's number counts every unanchored section of
    its section id in the stored layout, drawn or not: of two unanchored `faq` sections, the
    first with no items, the one drawn is `faq-2`.
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
  (`categories`, SC-010): services, case studies, posts, FAQs and locations do; testimonials and
  team (SC-027) do not. The sections schema requires it of every source with items, and the gate refuses a
  source that answers two ways or a source a collection-query can read with no answer. Both
  emitters read it (`categorisedSources` and `categorySources` in `emit/_contract.mjs`): a
  collection-query offers its by-category mode and categories picker only for a source with
  categories, and with a source select the picker shows only while the select holds one. Salt for
  Next.js owes a location-area taxonomy with its locations section. The Payload emitter names
  locations' taxonomy `areas` by default; a site names its own through `sources`.
- The collection-showcase and carousel queries' Salt for WordPress notes owe an
  `acf/validate_value` check refusing by-category for a source without categories, and an admin
  check of the categories field's conditional logic (SC-010); the ACF emitter records the rule as
  `salt.modeRequires`.
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
  section's background image; the collection-showcase source has no default. Team members were
  to carry categories on both; SC-027 withdraws that. In the markup, a quote card names its person with a heading; team cards
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

