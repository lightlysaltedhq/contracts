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
- the **extension points** a client site may use (to come).

It sits on top of `@lightlysaltedhq/design-foundations` (the colour, type and scale rules every
Lightly Salted product follows) and holds no brand values of its own.

## What must match

Decided by the owner on 08/10/2026 (`SC-003` in the decision log): **visitor output** (HTML,
classes, data attributes, stylesheets, accessibility behaviour) and **editor fields** (names,
types, choices, limits, descriptions). Admin screens, logins, form delivery and routing stay
native to each CMS.

## Status

`0.x` is the drafting line and is not published. `1.0.0` is the first release, staged from CI by
npm trusted publishing and approved by the owner. See `RELEASE-POLICY.md` for what each part of a
version means.

## Checks

From the repository root, `npm run salt-contract` runs this package's gate: one version across
every contract file, every contract file valid against its schema, no colour values anywhere, and
a tarball that ships only what it declares. `npm run salt-stylesheets` runs the shared stylesheets'
gate. `npm run verify` runs every gate in the repository.

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

`styles/` is the one shared stylesheet set both implementations serve (SC-002). Load it in this
order: `base.css`, `sections.css`, `primitives.css`, `blocks.css`, `chrome.css`, `views.css`.

`base.css` is one `@layer base` block. Three set-ups are supported:

- Tailwind v4: import it after `@import 'tailwindcss'`. Its rules join Tailwind's `base` layer
  after preflight, beat preflight on source order, and yield to every unlayered rule.
- Tailwind v3: import it into the stylesheet v3 processes. v3 consumes `@layer base` and emits the
  rules unlayered, after its preflight and before its components and utilities. They rank by
  specificity and source order: at (0,0,1) they beat preflight's element rules by coming after
  them and lose to every rule keyed on a class; a host's element rule wins only if it comes later.
- No Tailwind: load it first, as above. The layer yields to every unlayered rule.

Two are not supported: importing it before `tailwindcss` in v4, where preflight comes later in the
same layer and puts every heading back at body size; and serving it as a file of its own beside
v3's output, where the layer survives and v3's unlayered preflight outranks it.

The set reads only the custom properties `contract/token-layer.json` names, which each
implementation's runtime emits (its generated `theme.css`). The files carry long comments: serve
them as one minified bundle, never as six render-blocking requests.

## Fixtures

Modelled on GOV.UK Frontend's component fixtures: one directory per section, and in it a pair of
files per case. `<case>.json` is the input; `<case>.html` is the default HTML for it, or an empty
file when the case renders nothing (section#zero-state). A case's name describes its state
(`split-image-left`, `one-item`, `empty`). From the repository root,
`node scripts/check_salt_fixtures.mjs` proves every input valid against `contract/fields`, every expected HTML valid against
`contract/markup`, every variant option covered, and the normaliser sound.

### The input

| Key | What it holds |
| --- | --- |
| `section` | The section id; the same as the directory. |
| `summary` | What the case shows, in a sentence or two. |
| `values` | The section's stored field values, named and shaped as `contract/fields/<section>.json` says, with the shared settings under `settings`. A field left out takes its default. |
| `context` | What the page plan decides for this band: `headingLevel` (1 to 6, section#heading-level), `priorityMedia` (whether the plan grants this band the priority image, section#priority-media), `track` (its `data-track`, section#data-track), and where they apply `collapseTop` (section#adjacent-collapse), `index` (the section's position on the page from 1, which names an accordion group, `faq-<index>`) and `now` (an ISO 8601 time, for the locations' open-now status). |
| `media` | The images the values name, by id: `src`, `srcset` (a list of `{ url, width }`), `sizes`, `width`, `height`, `alt`, and where set `caption` and `focalPoint` (`{ x, y }` in per cent). |
| `documents` | The pages internal links name, by id: `{ href, title }`. |
| `collections` | The items of each source the section reads (`faqs`, `services`, `team` …), in the collection's usual order, each with a string `id`. |
| `route` | What the route hands a listing: its cards and pagination. |
| `site` | Site-wide data the markup reads: `labels` (the strings `labels.<name>` in the markup refers to), `arrow` (the site's arrow glyph), the organisation's contact details, whether it accepts enquiries, its timezone and map settings. |

Conventions, so that every case is deterministic:

- **The anchor is explicit.** Every case sets `values.settings.anchorId` to a slug that is not a
  landmark id, and renders as the only section with that anchor, so its settled id is the anchor
  and every id inside it is `<anchor>__<part>` (SC-012).
- **Stored forms.** An image field stores a media id, a link stores `{ label, type, document | url,
  newTab }` with `document` a key of `documents`, and a collection query stores `{ mode, categories,
  items, order, count }`. Rich text is an HTML string using only the field's allowed elements: the
  fixtures' interchange form, which each platform's adapter turns into its own (Lexical, the
  WordPress editor's HTML).
- **Images.** `src`, `srcset` and `sizes` are written exactly as the media record gives them. The
  contract fixes neither srcset widths nor a sizes table yet, so the record supplies both, and each
  platform's adapter passes them through. Uploads live on `https://uploads.example`; the
  normaliser drops the host.
- **Dark tone.** `toneDark: auto` is written as `data-tone-dark` equal to the tone: the dark palette,
  not the markup, supplies the counterpart.

### The normaliser

`normalise.mjs` (`@lightlysaltedhq/salt-contract/normalise`) exports `normalise(html)`, which
returns a canonical string, and `compare(expected, actual)`. Both platforms run their output and the
expected HTML through it and compare the results. It removes only what a visitor cannot see or the
contract leaves to each platform: attribute order, class order, insignificant white space,
boolean-attribute forms, character-reference forms, comments, the upload host in `src` and
`srcset`, and the artwork inside `svg.salt-icon` (the glyph names are the contract, the artwork is
each platform's, SC-007). It never touches ids, which SC-012 makes deterministic. The gate proves
that removing or changing any one attribute of any expected HTML changes its output.

### The adapter protocol

Each implementation provides an adapter that takes a case's input and returns that platform's
HTML for it, so the conformance runner can call either platform the same way. The adapter is
written in the implementation's own repository; the contract fixes only its interface.

- **Command.** A command the implementation names. It reads one case input, the whole
  `<case>.json`, as UTF-8 JSON on stdin, and writes the rendered section to stdout: the section
  wrapper and everything in it, as the platform renders it for a page whose plan gives that band
  the case's `context`, and nothing for a case that renders nothing. It exits 0. A non-zero exit
  fails the case; diagnostics go to stderr, never stdout. One process per case.
- **Or an endpoint.** A local HTTP endpoint the implementation names, taking the same input as a
  `POST` with `Content-Type: application/json` and answering `200` with the same HTML as
  `text/html; charset=utf-8`. Any other status fails the case.
- The adapter does not normalise; the runner normalises both sides. It loads the case's media,
  documents, collections and site data into the platform however suits it (fixtures in a test
  database, mocks), and writes `srcset` and `sizes` from the media record.
- Form delivery, routing and admin stay native (SC-003): where a case needs a route's data, the
  case supplies it in `route`.
