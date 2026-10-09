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
a tarball that ships only what it declares. `npm run verify` runs every gate in the repository.

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
`emit/_contract.mjs`). With a source select, the picker shows only while the select holds such a
source. On Payload each source's `taxonomy` in `options.sources` names the collection holding its
categories, and a source the contract gives categories with no taxonomy named is refused.

Faults in the contract's own shape are refused whatever the site installs: a malformed condition;
a `sourceField` naming no sibling select, or one offering no source; and a collection-query that
reads its source from a select anywhere but the section's top level (in a list, a group or the
settings), where its pickers could not find the select. Conditions read a stored `null` as no
value; only a sibling never set takes its default.

`reports/round-trip-payload.md`, which is not shipped, compares the output with the blocks
salt-nextjs ships today. A difference is expected only when `reports/round-trip-payload.expected.json`
lists it, with the note that accounts for it.
