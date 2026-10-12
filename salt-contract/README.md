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

`1.0.0-rc.3` is the release candidate for `1.0.0`: private, never on the registry, held until an
implementation's run of `salt-conformance` against it conforms in full, in a report that names
`1.0.0-rc.3` (SC-017, SC-018, SC-020, SC-022; `RELEASE-POLICY.md` section 5). It follows
`1.0.0-rc.1`, whose first run raised eight questions about the contract itself, and `1.0.0-rc.2`,
whose run raised three more; the owner's rulings on them (SC-023, SC-024) changed contract files,
which each time makes a new candidate and needs a new run. `1.0.0` is the first release, staged
from CI by npm trusted publishing when the owner pushes the `salt-contract-v1.0.0` tag, and
approved by the owner. See `RELEASE-POLICY.md` for what each part
of a version means.

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

**What a consumer may add.** A consumer decorates the generated fields for its own admin, and its
snapshot is of the blocks it hands Payload, so those additions are in it. The check leaves out
exactly the keys `PLATFORM_ADDITIONS` in `emit/payload.mjs` lists, and nothing else (SC-023):

| Key of a field | What it is |
| --- | --- |
| `admin.components` | Payload's admin components for the field: a list's row label, a notice beside an input. |
| `admin.initCollapsed` | Whether a list or group starts collapsed in the admin. |
| `admin.layout` | A radio's layout. |
| `hooks` | The field's hooks. |

Each is left out whole, at any depth of a block's fields, and only on a field: a block's own keys,
an option and `custom.salt` compare in full. Any other added key fails, and so does a change to a
key the contract generates, whatever sits beside it: `admin.description` still compares on a field
that also carries `admin.components`. An `admin` that holds nothing, before or after these keys
are taken out, compares as an absent one on both sides. What is left is compared byte for byte. A
validator is a function, so it never reaches a snapshot.

**Conditions are not compared in 1.0.0** (SC-023). `admin.condition` is a function and drops out
of both the committed and the regenerated snapshot.

- *Seen:* the record. Each conditioned field carries its clauses under `custom.salt.condition`,
  and that is a generated value like any other: a snapshot that drops, adds or changes it fails.
- *Not seen:* the function. Whether a field has an `admin.condition` at all, and what it does,
  are invisible. A consumer that drops a generated condition, adds one to a field the contract
  always shows, or shows a field at other times than the clauses say, passes in each case, and
  the result is the same with or without one of the keys above on that field. (A field whose only
  admin content is a condition serialises as `"admin": {}`, which is why an empty `admin` and an
  absent one are read alike.)

A comparison of conditions may arrive in a later minor version.

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

**Radios.** The contract says which selects are radios (SC-023): a select marked
`"control": "radio"` in its field definition is a Payload `radio` and an ACF `radio`, offering and
storing what a select would, and the snapshot checks compare the type. One field is marked today,
the `type` of every link (internal or external), which is part of the link's fixed shape in
`emit/_contract.mjs`. It is the only one: every other select, a collection-query's `mode` among
them, is a drop-down, and a radio needs a default or to be required, since it cannot be cleared.
A radio's layout stays the platform's: on Payload it is `admin.layout`, one of the keys a consumer
may add. Where an implementation draws another widget today (Salt for Next.js a radio for a
query's mode; Salt for WordPress a button group for a query's mode and for the gallery's and the
showcase's columns), the field's `owes` says so and the round trips list the difference.

**Enum names.** Every select carries the name of its Postgres enum type (`enumName`), and the
snapshot check compares it. There is one type per vocabulary (SC-023, after Salt for Next.js's
BD-035): selects that offer the same values in the same order share a type, named in
`VOCABULARIES` in `emit/payload.mjs` (`enum_grid_columns`, `enum_button_style`, `enum_alignment`,
`enum_media_side`), so the name does not change with the sections a site emits. The shared
settings, a link's parts and a collection-query's parts are one type each, named by their scope
(`enum_section_tone`, `enum_link_type`, `enum_query_mode`), and any other select is named by its
section and path. The site's icons are the exception: the options are the site's, so each icon
select keeps its own type. Where Salt for Next.js 0.11.0 gave a select's type another name, the
field records it as `platforms.nextjs.formerlyEnum` (keyed by part for a collection-query; 12
records carrying 17 former names), so a
migration generated from the contract renames or folds every such type. A select that 0.11.0 left
to Payload's derived name has no fixed former name to record; the site's own schema gives it.

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
`not-found`; SC-018, and `case-study`; SC-021) and for the page skeleton (`page`; SC-019), and in it a pair of files per
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
| `section`, `chrome`, `view` or `page` | Which kind the case is, holding its id, the same as the directory: a section, a chrome component (`site-header`, `site-footer`), a view (`post`, `service`, `case-study`, `archive`, `search`, `not-found`) or the page (`page`). A chrome, view or page case has no `values` (no fields file describes them): it reads `site`, `document`, `route` and `state`. A page's one section is `document.sections`, shaped as `document.listing` below with its `section` id; its heading level is derived (1: a page's one section is its first and claims the h1, so no fallback heading is drawn beside its heading), and a `headingLevel`, if given, must agree; the page's priority image is that section's, by its own markup's rule. |
| `summary` | What the case shows, in a sentence or two. |
| `values` | The section's stored field values, named and shaped as `contract/fields/<section>.json` says, with the shared settings under `settings`. A field left out takes its default. |
| `context` | For a chrome or view case: `priorityMedia` (a view: whether the plan grants it the priority image; the chrome never takes it), `locale`, `now` and `path` (the page's path, which sets `aria-current`). For a section, what the page plan decides for this band, describing a page that can exist: `index` (the plan's index, the section's position among the page's sections from 0, view-props/_shared.json, which also names an accordion group, `faq-<index>`), `track` (its `data-track`, `<section>-<n>` with n no more than `index` + 1, section#data-track), `headingLevel` (1 when no heading has rendered before the section, otherwise 2, section#single-h1), `headingRendered` (true when a heading rendered earlier on the page), `priorityMedia` (true for the first section, index 0, only, section#priority-media), and where they apply `collapseTop` (section#adjacent-collapse, never on the first section) `now` (an ISO 8601 time, for the locations' open-now status) and `locale` (a BCP 47 locale, `en-GB` in every case that draws a date, a time or a phone, which display as section#display-forms says). |
| `media` | The images the values name, by id: `url` (the upload's address with `{width}` where each listed width goes), `width` and `height` (the upload's intrinsic size), `alt`, and where set `caption` and `focalPoint` (`{ x, y }` in per cent). Never `sizes` or `srcset`: those are the image slot's. |
| `documents` | The pages internal links name, by id: `{ href, title }`. |
| `collections` | The items of each source the section reads (`faqs`, `services`, `team` …), each with a string `id`, already in the collection's stored order: an adapter passes them through as given and never sorts them, and a query in its default order draws them in that order (SC-023). How an implementation orders a collection on a real site is its own. |
| `route` | What the route hands a listing: its cards and pagination. |
| `site` | Site-wide data the markup reads, under declared keys only (the gate refuses any other): `labels` (the strings `labels.<name>` in the markup refers to), `arrow` (the site's arrow glyph), `name`, `home`, `organisation`, `acceptsEnquiries`, `contactForm`, `timezone`, `maps`, `collectionIndexes`, `logo` (`{ light, dark }`, media ids), `logoHeight` (the logo's drawn height in px, the logo slot's input; no other key names it), `header` (menu, phone, call to action, sticky), `footer` (tone, columns, text, socials, copyright, whether it shows the logo), `consent`, `themeToggle`, `displayPreferences`, `search` and `caseStudy` (the case study view's layout, which a site sets once for all its case studies: `{ media, header, headerTone, headerToneDark }`, where `media` is `flow` by default or `aside`, and `header` is `plain` by default or `band`, which draws the header as a toned section band and alone takes `headerTone` and the optional `headerToneDark`; Salt for Next.js sets these in code, and Salt for WordPress on an ACF options page, so editors can change them). A view's variant a site sets this way names its key in its markup (`variants[].site`), and every option its entry in `sections.json` offers needs a case. |
| `document` | A view's document: the post, service, archive term or author, search query and results, as the view reads them. A section the view nests (the archive's listing) is `document.listing`: its `values` (the section's field values, shaped and checked as a section case's, with its settled anchor in `values.settings.anchorId`), `track` (its `data-track`), `index` (from 0, required, for `<section index>`; its track counts no more sections than come up to it) and, if given, `headingLevel`, which must agree with the derived level (2 in a view, under its h1). Its block is read against that section's own markup, its variant and conditions answered by its values, so its id, heading, spacing, data attributes and content are fixed by the case. |
| `state` | What the case knows beyond its content. Each key says how the one element it concerns is drawn and nothing of any other: a case is not before or after script as a whole. `consentPanelOpen` (`true` or `false`): the visitor has opened the footer's consent panel, which only script does, so its dialog is drawn, as it is in no other case, and the consent control beside it has hydrated and carries no `aria-disabled`; in every other case it carries `aria-disabled="true"` (SC-024). `drawerOpen` (`true` or `false`): the visitor has opened the header's drawer, so its dialog is drawn, as it is in no other case. `themeScheme` (`light` or `dark`): the stored scheme, which the platform knows only sometimes when it renders, with which the theme toggle is its button form, pressed for dark and showing the sun or the moon; without it, its empty span server form. The gate refuses a state this row does not document, and fails when the row documents one it does not know, or when this row or this file is missing. |
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
  "contract": { "package": "@lightlysaltedhq/salt-contract", "version": "1.0.0-rc.3" },
  "platform": "nextjs",
  "implementation": { "version": "0.4.0" },
  "adapter": { "kind": "command", "target": "node scripts/salt-adapter.mjs" },
  "ok": false,
  "partial": false,
  "summary": { "pass": 15, "fail": 1, "incomplete": 0, "notShipped": 1 },
  "fields": { "platform": "payload", "snapshot": "…", "options": "…", "problems": [] },
  "problems": [],
  "stylesheets": { "served": "…", "bundle": "styles/salt.css", "contract": "1.0.0-rc.3", "ok": true, "status": "identical" },
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
