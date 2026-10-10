# salt-contract — the Salt contract

**What Salt for Next.js and Salt for WordPress both conform to. Neither is the reference.**

Salt is Lightly Salted's platform for client websites, built twice: on Next.js with Payload, and
as a WordPress parent theme. This package is the one thing both implementations pin. It holds:

- the section and component **vocabulary** (`contract/sections.json`): every section's id, its
  variants, and the names each implementation used before;
- platform-neutral **field definitions** (`schema/field-definition.schema.json`,
  `contract/fields/<section>.json`), from which each implementation generates its editor fields
  (Payload blocks, ACF field groups);
- the **markup contract** (`contract/markup/<section>.json`): element order, the `salt-*` class
  vocabulary, data attributes and heading rules;
- the one shared set of **stylesheets** (`styles/`), reaching colour only through custom
  properties;
- **fixtures** (`fixtures/<section>/<case>`): sample content for every section, variant and state,
  with the default HTML both platforms must render for it, and the **normaliser**
  (`normalise.mjs`) both run their output through before comparing;
- the **extension points** a client site may use (the customisation ladder, below): the design
  dials (`contract/dials.json`), the props each section's view receives
  (`contract/view-props/<section>.json`), and the declaration a site writes when it takes a section
  over (`schema/replaced-logic.schema.json`).

It sits on top of `@lightlysaltedhq/design-foundations` (the colour, type and scale rules every
Lightly Salted product follows) and holds no brand values of its own.

## What must match

Decided by the owner on 08/10/2026 (`SC-003` in the decision log): **visitor output** (HTML,
classes, data attributes, stylesheets, accessibility behaviour) and **editor fields** (names,
types, choices, limits, descriptions). Admin screens, logins, form delivery and routing stay
native to each CMS.

## The customisation ladder

A client site customises Salt by climbing this ladder, and stops at the lowest tier that does the
job. The lower the tier, the more of each Salt release still reaches the site. Both platforms
offer every tier under the same names, with the same data and the same choices; only the mechanism
underneath is native (a React component on one, a PHP template on the other). There is no separate
system of slots and hooks: swapping a view does that job, and every hook not built is one less
thing to hold identical. This section is normative, from the owner's decisions of 06/10/2026 on
the Salt page.

1. **Brand settings.** The site's colours, fonts, type scale and logos, set in the admin. *On
   update, everything still reaches the site.*
2. **Design dials and tokens.** Site-wide choices from a scale (corners, shadows, button style
   and density), set in the admin by the admin role only (`contract/dials.json`). Any token in `contract/token-layer.json` may also be overridden in the site's code, for what the
   dials do not cover. A site's own CSS reaches values through tokens, never hard-coded ones, so
   dark mode, the contrast checks and the dials keep working on it. *On update, everything still
   reaches the site.*
3. **Variants.** A section's layout or style option, chosen by an editor (the `variants` in
   `contract/sections.json`). *On update, everything still reaches the site.*
4. **Swap a section's view.** The normal case. The site replaces how one section looks and keeps
   its logic, which hands the new view exactly the props in `contract/view-props/<section>.json`.
   The swap is declared (`tier: "view"`) in the site's `salt-overrides.json`
   (`schema/replaced-logic.schema.json`); on WordPress, the child theme's `OVERRIDES.md` points at it
   rather than repeating it. A view that draws an image at another width declares that slot's
   sizes there too, under `imageSizes` (SC-016); otherwise its images keep the slot's default from
   `contract/image-sizes.json`. *On update, all of the section's logic, the section wrapper and the
   shared components still reach the site; core's default view of that section does not. A
   release that changes the section's view props, or the plan and shared types in
   `contract/view-props/_shared.json`, is flagged.*
5. **Replace a section's logic.** Rare. The site takes the section over entirely and declares it
   (`tier: "logic"`). *On update, nothing reaches that section; it is flagged on every update.*
6. **A client-only section.** A section only this site has, listed under `clientSections` so a
   later contract section of the same id is caught. *Not affected by updates.*

A custom view is written for one platform and will not run on the other; it is that client's own
code. What the contract holds identical is the name of each extension point, the data a view
receives and the choices on offer.

## Status

`0.x` is the drafting line and is not published. `1.0.0` is the first release, staged from CI by
npm trusted publishing and approved by the owner. See `RELEASE-POLICY.md` for what each part of a
version means.

## Checks

From the repository root, `npm run salt-contract` runs this package's gate: one version across
every contract file, every contract file valid against its schema, no colour values anywhere, and
a tarball that ships only what it declares. `npm run salt-stylesheets` runs the shared stylesheets'
gate. `node scripts/check_salt_extensions.mjs` runs the extension points' gate: every token a
dial moves is in the token layer, every section has its view props and each prop drawn from a field
names a real one, and the replaced-logic examples hold. `npm run verify` runs every gate in the
repository.

## Generating Payload blocks

`emit/payload.mjs` (`@lightlysaltedhq/salt-contract/emit/payload`) turns each section's field
definitions into the Payload `Block` config Salt for Next.js composes into its pages collection. It
is a pure data transform: it imports nothing from Payload and reads only this package's files.

```js
import { toPayloadBlocks, checkPayloadSnapshot, payloadSnapshot } from '@lightlysaltedhq/salt-contract/emit/payload'

const blocks = toPayloadBlocks({
  mediaSlug: 'media',                 // the upload collection behind every image ('media')
  linkTo: ['pages'],                  // what an internal link may point at (['pages'])
  headings: ['h3', 'h4'],             // narrows rich text's headings; cannot add one the contract refuses
  icons: iconOptions(icons.content),  // [{ value, label }]; required by features, stats and process
  sources: { services: {}, posts: {} }, // the sources the site has, with any renamed slugs
  richTextEditor: (allowed) => lexicalEditor({ features: featuresFor(allowed) }),
  sections: ['hero', 'rich-text'],    // which sections, in order (every one the sources can carry)
})
```

Conditions are functions, so the blocks are not JSON. Each field also records what it was
generated from under `custom.salt` (its condition clauses, rich text's allowed list, a text
format, a list's row label), and `payloadSnapshot(options)` serialises the blocks with the
functions and the editor left out. The same options always give the same bytes.

**The drift check.** A consumer commits that snapshot and checks it on every run:

```js
const { ok, problems } = checkPayloadSnapshot(readFileSync('blocks.snapshot.json', 'utf8'), options)
// problems: ['blocks[hero].fields[heading] is in the snapshot and no longer generated', …]
```

`ok` is true only when the regenerated snapshot is byte-identical; `problems` names each
difference by path. So a contract release that renames, retypes or re-limits a field fails the
consumer's check before anything type-checks, and the fix is to regenerate the snapshot, read its
diff and migrate. Options that JSON can carry also work from the command line:
`node emit/payload.mjs --check <snapshot> [--options <options.json>]` exits 1 on drift, and
`--write <snapshot>` regenerates it. CRLF line endings are read as LF.

**Fitting the site's sources.** `planSections` in `emit/_contract.mjs` decides, for every emitter,
which sections a site gets. A section that needs a source the site does not install is left out,
or refused with the missing source and field named when `sections` lists it (`null` counts as not
listing). It needs one through a fixed collection-query source or a relationship's source, in its
own fields or its shared settings, or through a source select with no option the site can satisfy;
a source select and its query sit only at the section's top level. Where a source select still has
an option to offer, as the carousel's inline cards do, the section stays.
The select offers only what the site can satisfy, with no default when its default is no longer
offered. The query, any field reached only by a missing source, and any field whose condition
cannot hold once such a field is gone are left out; a kept field loses any clause on a field left
out.

**Categories.** A collection-query offers its by-category mode and categories picker only for
sources that `sections.json` says have a category taxonomy (SC-010; `categorySources` in
`emit/_contract.mjs`). With a source select, the picker shows, and by-category is offered and
accepted on save (`modeAllowed`), only while the select holds such a source. On Payload each
source's `taxonomy` in `options.sources` names the collection holding its categories, and on ACF
the WordPress taxonomy; either way a source the contract gives categories with no taxonomy named
is refused. On ACF the picker's `conditional_logic` names the layout's source select, one OR group
per source with categories; ACF cannot hide one mode choice per source, so the mode field records
the rule in `salt.modeRequires` for the site's save check.

Faults in the contract's own shape are refused whatever the site installs: a malformed condition;
a `sourceField` naming no sibling select, or one offering no source; and a collection-query that
reads its source from a select anywhere but the section's top level (in a list, a group or the
settings), where its pickers could not find the select. Conditions read a stored `null` as no
value; only a sibling never set takes its default.

`reports/round-trip-payload.md`, which is not shipped, compares the output with the blocks
salt-nextjs ships today. A difference is expected only when `reports/round-trip-payload.expected.json`
lists it, with the note that accounts for it.

## Generating ACF field groups

`emit/acf.mjs` (`@lightlysaltedhq/salt-contract/emit/acf`) turns each section's field definitions
into the Flexible Content layout Salt for WordPress registers in its page sections field group
(`group_salt_sections`). The contract defines no other groups yet, so that is the only one; the
custom post types' groups stay in salt-wordpress until the contract defines their fields. Like the
Payload emitter it is a pure data transform, reading only this package's files.

```js
import { toAcfFieldGroups, checkAcfSnapshot, acfSnapshot } from '@lightlysaltedhq/salt-contract/emit/acf'

const groups = toAcfFieldGroups({
  linkTo: ['page'],                   // post types an internal link may point at (['page'])
  headings: ['h3', 'h4'],             // narrows rich text's headings; cannot add one the contract refuses
  icons: iconOptions(),               // [{ value, label }]; required by features, stats and process
  sources: { services: {}, posts: {} }, // the sources the site has, with any renamed post types or taxonomies
  postTypes: ['page'],                // where the sections group shows (['page'])
  sections: ['hero', 'rich-text'],    // which sections, in order (every section in sections.json)
})
```

ACF's conditions are data, so the output is plain JSON in the shape ACF JSON uses, which is also
the array `acf_add_local_field_group()` takes: the site commits `acfSnapshot(options)` and
registers each group from it with `json_decode( $json, true )`. Names are the contract's (a
layout is named by its section id, a field by its canonical name); keys follow salt-wordpress's
DATA02 convention, derived from the contract path, so `rows.mediaSide` on media-text is
`field_salt_media_text_rows_media_side` whatever order the fields are in. Conditions become
`conditional_logic`, with `filled: true` as ACF's "has any value" and `filled: false` as "has no
value". Each field records what it was generated from under `salt` (rich text's allowed list, a
text format, a list's row label, a link's or query's shape), for the site's renderer and
sanitiser.

**The drift check.** As with Payload, the site commits the snapshot and checks it on every run:

```js
const { ok, problems } = checkAcfSnapshot(readFileSync('acf/sections.json', 'utf8'), options)
// problems: ['groups[group_salt_sections].fields[sections].layouts[hero].sub_fields[heading] is in the snapshot and no longer generated', …]
```

Every option is JSON, so the command line takes them all:
`node emit/acf.mjs --check <snapshot> [--options <options.json>]` exits 1 on drift, and `--write
<snapshot>` regenerates it. salt-wordpress's `bin/check-fields-from-contract.php`, which will run
this in its CI, does not exist yet: it is owed by Salt for WordPress's conformance work (EP-72).
As with Payload, a section needing a source the site does not install is left out, or refused when
`sections` names it; a carousel with no collection sources stays, offering its inline cards alone.

**The slug gate still holds.** salt-wordpress's FLEET07 gate (`bin/extract-slugs.php`,
`bin/check-slug-stability.php`) reads the groups the theme registers, not the code that built
them. The emitted groups have the shape it walks (`fields`, `sub_fields`, `layouts[].name`), so
registering them leaves `docs/contracts/slug-registry.json` regenerable as before, and a field or
layout the contract drops disappears from the registry. Without a `slug-migrations.json` entry
that removal still fails the gate on a non-major release. `acfSlugRegistry(groups)` gives the same
layouts and names, for a test that wants to see the effect before the theme does.
`reports/round-trip-acf.md`, which is not shipped either, compares the output with the layouts
salt-wordpress ships today. A difference is expected only when
`reports/round-trip-acf.expected.json` lists it, with the contract record that accounts for it.

## Stylesheets

`styles/` is the one shared stylesheet set (SC-002): six sources, `base.css`, `sections.css`,
`primitives.css`, `blocks.css`, `chrome.css` and `views.css`, in that load order. They carry long
comments and are never served as they are. What both platforms serve is the bundle built from them.

**The bundle.** `styles/salt.css` (`@lightlysaltedhq/salt-contract/styles/salt.css`) is the six
sources in load order, minified with every comment stripped, built by
`scripts/build_salt_bundle.mjs` with the lockfile's esbuild, so the same sources always give the
same bytes. `npm run salt-stylesheets` fails when the committed bundle is not what the sources
build, or when `styles/` holds a source the build's load order does not name (or the order names
one it does not hold); rebuild it with `npm run build:salt-bundle` after any change to `styles/`.

**Serving it (normative).** Both platforms serve `styles/salt.css` verbatim, as a stylesheet of its
own: a separate `<link rel="stylesheet">` (or `wp_enqueue_style`) to a copy of the package's file,
never imported into Tailwind, PostCSS or a bundler's CSS pipeline, which would rewrite its bytes.
The conformance runner's stylesheet pin compares the file served with the package's, byte for
byte, so re-processed CSS can never pass. Its place in the page:

- With Tailwind v4: after Tailwind's stylesheet. Tailwind v4's output opens with
  `@layer theme, base, components, utilities;`, and cascade layers are ordered across the whole
  document by their first declaration, so the bundle's `@layer base { … }` joins Tailwind's `base`
  layer rather than starting a new one. Coming later in that layer, its element rules beat
  preflight's on source order, and they yield to every unlayered rule. The rest of the bundle is
  unlayered, so it outranks every Tailwind layer, utilities included.
- With no Tailwind: first, before the site's own CSS. The layer yields to every unlayered rule.

Not supported: Tailwind v3 beside the bundle. v3 emits its preflight unlayered, so it outranks
the bundle's `@layer base` and puts every heading back at body size, and importing the bundle into
v3's pipeline instead re-processes it. Nor is the bundle served before Tailwind v4's stylesheet:
its `base` layer would then come first in the document, ahead of `theme`, and preflight would
follow it in the same layer.

The bundle reads only the custom properties `contract/token-layer.json` names, which each
implementation's runtime emits (its generated `theme.css`).

## Fixtures

Modelled on GOV.UK Frontend's component fixtures: one directory per section, per chrome component
(`site-header`, `site-footer`), per page view (`post`, `service`, `archive`, `search`,
`not-found`; SC-018) and for the page skeleton (`page`; SC-019), and in it a pair of files per
case. `<case>.json` is the input; `<case>.html` is the default HTML for it, or an empty
file when the case renders nothing (section#zero-state). A case's name describes its state
(`split-image-left`, `one-item`, `empty`). An implementation reads them from the package as
`@lightlysaltedhq/salt-contract/fixtures/<section>/<case>.json` and `.html` (the `./fixtures/*`
export). From the repository root, `node scripts/check_salt_fixtures.mjs` proves every input valid
against `contract/fields`, every expected HTML valid against `contract/markup`, every variant
option covered, and the normaliser sound.

### The input

| Key | What it holds |
| --- | --- |
| `section`, `chrome`, `view` or `page` | Which kind the case is, holding its id, the same as the directory: a section, a chrome component (`site-header`, `site-footer`), a view (`post`, `service`, `archive`, `search`, `not-found`) or the page (`page`). A chrome, view or page case has no `values` (no fields file describes them): it reads `site`, `document`, `route` and `state`. A page's one section is `document.sections`, shaped as `document.listing` below with its `section` id and the `headingLevel` the plan gives it (1 when it claims the page's h1); the page's priority image is that section's, by its own markup's rule. |
| `summary` | What the case shows, in a sentence or two. |
| `values` | The section's stored field values, named and shaped as `contract/fields/<section>.json` says, with the shared settings under `settings`. A field left out takes its default. |
| `context` | For a chrome or view case: `priorityMedia` (a view: whether the plan grants it the priority image; the chrome never takes it), `locale`, `now` and `path` (the page's path, which sets `aria-current`). For a section, what the page plan decides for this band, describing a page that can exist: `index` (the plan's index, the section's position among the page's sections from 0, view-props/_shared.json, which also names an accordion group, `faq-<index>`), `track` (its `data-track`, `<section>-<n>` with n no more than `index` + 1, section#data-track), `headingLevel` (1 when no heading has rendered before the section, otherwise 2, section#single-h1), `headingRendered` (true when a heading rendered earlier on the page), `priorityMedia` (true for the first section, index 0, only, section#priority-media), and where they apply `collapseTop` (section#adjacent-collapse, never on the first section) `now` (an ISO 8601 time, for the locations' open-now status) and `locale` (a BCP 47 locale, `en-GB` in every case that draws a date, a time or a phone, which display as section#display-forms says). |
| `media` | The images the values name, by id: `url` (the upload's address with `{width}` where each listed width goes), `width` and `height` (the upload's intrinsic size), `alt`, and where set `caption` and `focalPoint` (`{ x, y }` in per cent). Never `sizes` or `srcset`: those are the image slot's. |
| `documents` | The pages internal links name, by id: `{ href, title }`. |
| `collections` | The items of each source the section reads (`faqs`, `services`, `team` …), in the collection's usual order, each with a string `id`. |
| `route` | What the route hands a listing: its cards and pagination. |
| `site` | Site-wide data the markup reads, under declared keys only (the gate refuses any other): `labels` (the strings `labels.<name>` in the markup refers to), `arrow` (the site's arrow glyph), `name`, `home`, `organisation`, `acceptsEnquiries`, `contactForm`, `timezone`, `maps`, `collectionIndexes`, `logo` (`{ light, dark }`, media ids), `logoHeight` (the logo's drawn height in px, the logo slot's input; no other key names it), `header` (menu, phone, call to action, sticky), `footer` (tone, columns, text, socials, copyright, whether it shows the logo), `consent`, `themeToggle`, `displayPreferences` and `search`. |
| `document` | A view's document: the post, service, archive term or author, search query and results, as the view reads them. A section the view nests (the archive's listing) is `document.listing`: its `values` (the section's field values, shaped and checked as a section case's, with its settled anchor in `values.settings.anchorId`), `track` (its `data-track`), `index` (from 0, for `<section index>`) and `headingLevel`. Its block is read against that section's own markup, its variant and conditions answered by its values, so its id, heading, spacing, data attributes and content are fixed by the case. |
| `state` | A state the case draws that only a visitor brings about, such as the consent panel open (`consentPanelOpen`), or that the platform knows only sometimes when it renders: `themeScheme` (`light` or `dark`), the stored scheme, with which the theme toggle is its button form, pressed for dark and showing the sun or the moon; without it, its empty span server form. |

Conventions, so that every case is deterministic:

- **The anchor is explicit.** Every case sets `values.settings.anchorId` to a slug that is not a
  landmark id, and renders as the only section with that anchor, so its settled id is the anchor
  and every id inside it is `<anchor>__<part>` (SC-012).
- **Stored forms.** An image field stores a media id, a link stores `{ label, type, document | url,
  newTab }` with `document` a key of `documents`, and a collection query stores `{ mode, categories,
  items, order, count }`. Rich text is an HTML string using only the field's allowed elements: the
  fixtures' interchange form, which each platform's adapter turns into its own (Lexical, the
  WordPress editor's HTML).
- **Images.** Each image declares its slot's default `sizes` for its section's band and the
  `srcset` the candidate rule gives for them, both from `contract/image-sizes.json` (SC-016),
  capped at the upload's intrinsic width (the record's `width`, listed itself when it is no
  candidate), so `src` is always the URL at the intrinsic width. The case's media record gives each candidate's URL through its
  `{width}` template; the adapter makes its pipeline serve those URLs. Uploads live on
  `https://uploads.example`, and the normaliser drops the host.
- **Dark tone.** `toneDark: auto` is written as `data-tone-dark` equal to the tone: the shared
  stylesheet, not the markup, draws its dark form (SC-016).

### The normaliser

`normalise.mjs`, imported as `@lightlysaltedhq/salt-contract/normalise` (the `./normalise`
export), exports `normalise(html)`, which returns a canonical string, and
`compare(expected, actual)`. Both platforms run their output and the expected HTML through it and
compare the results. It removes only what a visitor cannot see or the contract leaves to each
platform: attribute order, class order, white space a browser does not draw (at block boundaries,
and between the children of a flex or grid container, a list `scripts/salt_normalise_containers.mjs`
derives from `styles/`; between two inline elements in normal flow a run is one space and counts),
boolean-attribute forms, character-reference forms, comments, the upload host in `src` and
`srcset`, and the artwork inside `svg.salt-icon` (the glyph names are the contract, the artwork is
each platform's, SC-007), and in the contact form, exactly four per-request values, which the
expected HTML writes as declared placeholders: the form's `action` as `{{salt:form-action}}`, the
hidden `formToken` and `challengeToken` values as `{{salt:form-token}}` and
`{{salt:challenge-token}}`, and the challenge question (its label's text) as
`{{salt:challenge-question}}` (SC-016). Each is matched by element, class and name, so a field's
type and every other attribute still compares. It never touches ids, which SC-012 makes deterministic. The gate proves
that removing or changing any one attribute of any expected HTML changes its output.

### The adapter protocol

Each implementation provides an adapter that takes a case's input and returns that platform's
HTML for it, so the conformance runner can call either platform the same way. The adapter is
written in the implementation's own repository; the contract fixes only its interface.

- **Command.** A command the implementation names. It reads one case input, the whole
  `<case>.json`, as UTF-8 JSON on stdin, and writes what the case's kind names to stdout, as the
  platform renders it on the server, before any script runs:
  - a `section`: the section wrapper and everything in it, for a page whose plan gives that band
    the case's `context`, or nothing for a case that renders nothing;
  - a `chrome` component: the `header.salt-header` or `footer.salt-footer` element and
    everything in it, as the page draws it, from the case's `site` (and `state`);
  - a `view`: the `main#main` element and everything in it, as `page.json` places it, for the
    case's `document`;
  - the `page`: the whole document, from `<!doctype html>`, as the platform serves it, with its
    header, its sections (`document.sections`) and its footer. The runner compares it through
    `pageOf` (normalise.mjs): only the head elements the contract owns (the link to the served
    `salt.css`, read as its `rel` and its file name only, so a platform's `id`, `media`, `data-precedence` or `?ver=` query does not count, and the scriptless phone layout's `noscript`
    style) and the body, without its own attributes and the `script`, `style` and `link`
    elements the platform delivers there (the contract's body markup draws none); the rest of
    head, and the `html` element's attributes, are the platform's (SC-019).

  It exits 0. A non-zero exit
  fails the case; diagnostics go to stderr, never stdout. One process per case.
- **Or an endpoint.** A local HTTP endpoint the implementation names, taking the same input as a
  `POST` with `Content-Type: application/json` and answering `200` with the same HTML as
  `text/html; charset=utf-8`. Any other status fails the case.
- The adapter does not normalise; the runner normalises both sides. It loads the case's media,
  documents, collections and site data into the platform however suits it (fixtures in a test
  database, mocks). It renders as the platform renders: it never writes an image's `sizes`,
  `srcset`, `src`, width or height itself, so the platform's own image code must produce the
  values `contract/image-sizes.json` gives, and the comparison fails when it does not. The one
  thing it may set is where the pipeline's URLs point: each candidate's URL comes from the media
  record's `{width}` template (a custom loader on Next.js, an upload URL filter on WordPress), so
  the URLs compare and the widths are the platform's own.
- Form delivery, routing and admin stay native (SC-003): where a case needs a route's data, the
  case supplies it in `route`.

## Conformance

`conformance.mjs` (`@lightlysaltedhq/salt-contract/conformance`, and the `salt-conformance` bin) is
the runner each implementation points at itself, in its own CI, against the contract version it
pins. For every section it ships it checks four things:

- **Fixtures.** Every case goes to the implementation's adapter (above), one process or request
  per case, and the adapter's HTML and the case's expected HTML both go through `normalise`. A
  mismatch names the section, the case and the first node that differs, by a CSS-like path
  (`… > div.salt-hero__actions > a.salt-button:nth-of-type(2)`), with what was expected and what
  was found: a missing or unexpected element, one out of order, another in its place, an attribute
  or text. Each element's children are aligned first: identical nodes anchor the alignment, an
  identical node at another position is `order`, and between anchors the rest pair by tag (the
  most alike first), the nth left out with the nth found as one replaced by another. So a dropped,
  added or moved sibling is reported as itself, not as every later one changed. A case that
  renders nothing expects empty output. An adapter that exits non-zero, times out or answers other
  than 200 fails that case, with its stderr (or the response body) in the report.
- **Field parity.** The implementation's committed field snapshot is checked with the emitter's own
  `checkPayloadSnapshot` or `checkAcfSnapshot` (the drift checks above), using the implementation's
  real options, and each problem is filed under its section. Every shipped section must be in the
  snapshot ("not in the field snapshot" otherwise). A problem under a block or layout that is no
  contract section, or under a section declared not shipped, is about the whole snapshot and fails
  every shipped section; so does a section declared not shipped whose fields are in the snapshot,
  since shipped fields make it shipped.
- **Classes.** Every `salt-*` class in the adapter's output is one an element in `contract/markup`
  carries.
- **Stylesheet pin.** The file the implementation serves as its Salt stylesheet (above,
  "Serving it"), or that file fetched from a running site, is byte-identical to
  `styles/salt.css`. A path inside the package itself is refused, since comparing the package's
  file with itself proves nothing; a link elsewhere to it (a site's `public/salt.css`) serves the
  right bytes and passes. There is no version form: a version the caller states says nothing of
  the bytes served.

An implementation conforms only when all four checks ran for every section it ships and all pass
(SC-017). A section passes only when all four hold for it; one whose checks that ran all passed,
but with a check left out, is `incomplete`. So a run without a field snapshot or a stylesheet pin
fails. A run of some sections (`--sections`) or some checks is allowed only with `--partial`, and
its report says "partial, not conforming": `ok` is false, `partial` is true and it exits 1. A run
must ship at least one section, and a section declared not shipped (`--not-shipped`) must stay
out of the output: a class only its markup draws, written by another section, fails the run.

The site chrome (`site-header`, `site-footer`), the page views with fixtures (`post`,
`service`, `archive`, `search`, `not-found`; SC-018) and the page (`page`, compared through
`pageOf`; SC-019) are run too, each reported as a file of its
own under `files` in the JSON report and in its own table in the Markdown one. They have no fields,
so each is held to the fixtures and class checks; the stylesheet pin is the run's. A run conforms
only when every file it runs passes as well. `--sections` and `--not-shipped` take their ids like
a section's, but the chrome, these five views and the page are required of every implementation
(SC-018, SC-019):
only a `--partial` run may declare one not shipped, and the summary counts it.

Salt for Next.js copies or links the package's file to a static path (`public/salt.css`), links
it after Tailwind's stylesheet, and passes that file (or `--styles-url` with its URL on a preview):

```sh
npx salt-conformance --platform nextjs --implementation-version "$VERSION" \
  --adapter "node scripts/salt-adapter.mjs" \
  --payload-snapshot src/blocks.snapshot.json --fields-options src/blocks.options.json \
  --styles public/salt.css \
  --out conformance
```

or `node node_modules/@lightlysaltedhq/salt-contract/conformance.mjs` with the same flags. Salt for
WordPress copies the package's file into its theme, enqueues that copy, and passes it with its
snapshot:

```sh
npx salt-conformance --platform wordpress --implementation-version "$VERSION" \
  --adapter "php bin/salt-adapter.php" \
  --acf-snapshot acf/sections.json --fields-options acf/sections.options.json \
  --styles assets/salt.css \
  --out conformance
```

| Flag | What it takes |
| --- | --- |
| `--platform <name>` | Required. The implementation's name in the report (`nextjs`, `wordpress`). |
| `--adapter <command>` | The adapter command, run through the shell once per case. |
| `--endpoint <url>` | Or the adapter endpoint, POSTed each case. One of the two is required. |
| `--payload-snapshot <file>` | The committed `payloadSnapshot(options)`. |
| `--acf-snapshot <file>` | Or the committed `acfSnapshot(options)`. |
| `--fields-options <file>` | The JSON options the snapshot was generated with (`{}` when left out). |
| `--styles <file>` | The Salt stylesheet the implementation serves, compared byte for byte with `styles/salt.css`. |
| `--styles-url <url>` | Or that file's URL on a running site, fetched and compared the same way. |
| `--sections <id,…>` | Run only these sections. Needs `--partial`. |
| `--not-shipped <id,…>` | Sections the implementation does not ship: reported "not shipped", not failed. |
| `--implementation-version <v>` | The implementation's own version, for the report. |
| `--out <dir>` | Write `conformance.json` and `conformance.md` there. The Markdown also goes to stdout. |
| `--jobs <n>` | Cases run at once (the machine's parallelism by default; 1 for an adapter that cannot share). |
| `--timeout <ms>` | How long one case may take (60000). |
| `--partial` | Allow a run that leaves sections or checks out; it never conforms. Takes no value. |

Every flag but `--partial` takes one value; an unknown, empty or repeated flag is refused. Exit 0
is a conforming run, 1 any mismatch, missing check or partial run, 2 a usage error (and no
report).

**The report.** `conformance.json` is the parity matrix's input:

```json
{
  "format": "salt-conformance/1",
  "contract": { "package": "@lightlysaltedhq/salt-contract", "version": "0.1.0" },
  "platform": "nextjs",
  "implementation": { "version": "0.4.0" },
  "adapter": { "kind": "command", "target": "node scripts/salt-adapter.mjs" },
  "ok": false,
  "partial": false,
  "summary": { "pass": 15, "fail": 1, "incomplete": 0, "notShipped": 1 },
  "fields": { "platform": "payload", "snapshot": "…", "options": "…", "problems": [] },
  "problems": [],
  "stylesheets": { "served": "…", "bundle": "styles/salt.css", "contract": "0.1.0", "ok": true, "status": "identical" },
  "sections": [
    {
      "id": "hero",
      "status": "fail",
      "fixtures": { "total": 9, "passed": 8, "failed": 1, "failures": [
        { "case": "split-image-left", "kind": "mismatch", "difference": "attribute",
          "path": "section.salt-section > … > a.salt-button:nth-of-type(2)",
          "name": "href", "expected": "/contact/", "found": "/contacts/" }
      ] },
      "fields": { "status": "pass", "problems": [] },
      "classes": { "status": "pass", "unknown": [] },
      "stylesheets": { "status": "pass" }
    },
    { "id": "pricing", "status": "not shipped" }
  ]
}
```

A section's `status` is `pass`, `fail`, `incomplete` or `not shipped`, and each check's `status`
is `pass`, `fail` or `not run`. A failure's `kind` is `mismatch` (with
`difference`: `missing`, `unexpected`, `order` (an identical node moved) with `expectedAt` and
`foundAt` (its position among its siblings on each side, from 1), `element`, `attribute` with its `name`, or `text`; an
absent side is `null`) or `adapter` (with `error` and `stderr`). `fields.problems` at the top holds what is
about the whole snapshot (not JSON, sections out of order, formatting); a section's own are under
it. `problems` holds what fails the run as a whole (a section declared not shipped whose classes
the output uses). `stylesheets.status` is `identical`, `differs` (with `firstDifferingByte`),
`missing` (no such file) or `unreachable` (the URL failed, with `error`). `conformance.md` is the same report for a person: a table of
sections, then each failure on a line.

The runner is also importable: `runConformance(options)` returns the report, `renderMarkdown(report)`
its Markdown, and `firstDifference(expected, actual)` the first differing node of two fragments, for
an implementation's own tests. `npm run salt-conformance` (`scripts/salt_conformance_self.mjs`)
runs it here against `scripts/salt_fixture_reference_adapter.mjs` with all four checks, once with
the Payload snapshot and once with the ACF snapshot the emitters give for one set of options, and
both runs must conform.
