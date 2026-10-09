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
- the **extension points** a client site may use, and **fixtures** proving the same content gives
  the same HTML on both platforms (both to come).

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
