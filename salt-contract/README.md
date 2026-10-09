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
- the **extension points** a client site may use (the customisation ladder, below): the design
  dials (`contract/dials.json`), the props each section's view receives
  (`contract/view-props/<section>.json`), and the declaration a site writes when it takes a section
  over (`schema/replaced-logic.schema.json`);
- **fixtures** proving the same content gives the same HTML on both platforms (to come).

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
   rather than repeating it. *On update, all of the section's logic, the section wrapper and the
   shared components still reach the site; core's default view of that section does not. A
   release that changes the section's view props is flagged.*
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
accepted on save (`modeAllowed`), only while the select holds such a source. On Payload each source's `taxonomy` in `options.sources` names the collection holding its
categories, and a source the contract gives categories with no taxonomy named is refused.

Faults in the contract's own shape are refused whatever the site installs: a malformed condition;
a `sourceField` naming no sibling select, or one offering no source; and a collection-query that
reads its source from a select anywhere but the section's top level (in a list, a group or the
settings), where its pickers could not find the select. Conditions read a stored `null` as no
value; only a sibling never set takes its default.

`reports/round-trip-payload.md`, which is not shipped, compares the output with the blocks
salt-nextjs ships today. A difference is expected only when `reports/round-trip-payload.expected.json`
lists it, with the note that accounts for it.

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
