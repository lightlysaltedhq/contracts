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
