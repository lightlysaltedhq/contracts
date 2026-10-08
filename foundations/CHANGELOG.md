# Changelog — @lightlysaltedhq/design-foundations

Newest first. Dates are DD/MM/YYYY. The contract holds structure and rules, never a brand's values
(design-system decision D26), and nothing in this file quotes one either: `check_no_colours.py`
scans it like every other file here.

## Versioning

**One version for the whole package.** Every file in `contract/` carries, in its `version` field, the
version of the release it ships in: the same string as `package.json`, moved in the same commit.
The contracts repository's `npm run verify:foundations-pack` checks this on the packed tarball.
It reads every file under `contract/` and `schema/`, subdirectories included. A key counts as a
version when one of its words is `version`, splitting on camelCase and on any character that is not
a letter or digit: `specVersion`, `$version`, `schema.version` and `VERSION` count, and `inversion`
does not. The check fails when:

- a file there is not JSON, or does not parse;
- a file in `contract/` has no top-level `version`;
- a file's top-level `version` is anything other than the string in `package.json` (a number
  fails with its own message);
- a version key appears anywhere else, with one exception: `schema/token-file.schema.json`'s
  `properties.version`, which defines an emitted file's version field and must be exactly
  `{"type": "string"}`, pinning no value.

Run against the published 2.1.0 tarball, the check names all three contract files. The schema
carries no `version` of its own; its identity is its `$id`,
`https://cdn.jsdelivr.net/npm/@lightlysaltedhq/design-foundations@<major>/schema/token-file.schema.json`.
It names the package and the major rather than a repository, because the package's name outlives
the repository it is built in (D26). The `<major>` is always the package's own: jsDelivr resolves
`@<major>` to the latest release in that major, so an `@N` left behind would name another major's
schema as soon as a release edited it. Like the contract files' `version`, it moves in the release
commit, and `npm run verify:foundations-pack` fails when it is anything but
`https://cdn.jsdelivr.net/npm/<name>@<major>/` followed by the `./schema/token-file` export's path.

The files used to carry their own versions, meaning "the release this file last changed in". That
was kept for `derivation.json` and `vectors.json` and missed for `vocabulary.json` twice (it changed
in 2.0.1 and again in 2.1.0 and said 2.0.0 throughout), because "last changed" cannot be checked
without a previous release to diff against. So the published 2.1.0 tarball's contract files say
2.0.0, 1.0.0 and 1.0.0. Which file changed in which release is recorded here instead, where a
reader looks for it.

**Publishing.** 2.1.0 was published by hand. From 2.1.1, a release is staged from CI with
`npm stage publish` (npm trusted publishing, no token) and becomes public only when the package
owner approves it on npmjs.com with a passkey. 2.1.1 and 3.0.0 carry no provenance attestation:
npm generates one only from a public source repository, and both are published from the private
design-system repository. After 3.0.0 the contract moved to the public repository
`lightlysaltedhq/contracts`, so from 3.0.1 npm attests provenance for every release with no flag.

**What each part of a version means for this package:**

- **Major** — an implementation that conformed can stop conforming, or a consumer of an export can
  break: a role or rule becomes required, a rule is added or tightened for roles an implementation
  already emits, a role, rung or export is renamed, removed or reshaped, the derivation changes
  (which moves every vector), or the fixtures change in a way that could turn a conforming
  implementation red, even with the same shape and counts.
- **Minor** — additive and optional: a new optional role, family or rung; a rule that binds only
  roles nothing could emit before; a new export.
- **Patch** — no conforming implementation's verdict and no export's shape changes: prose,
  metadata and gates. A fixture change is a patch only if no implementation that passed before
  can fail after it; if it could, it is a major.

## 3.0.1 — 08/10/2026

- **The package's source moved to the public repository `lightlysaltedhq/contracts`**, as this
  changelog said it would after 3.0.0. The tree moved byte for byte from `lightlysaltedhq/design-system`
  at `83ae5e4`, where `foundations/` was identical to the 3.0.0 tag; `package.json`'s `repository`
  is the one field that changes. The contract, its vectors and its exports are unchanged, so this
  is a **patch**. 3.0.1, the first release from here, carries an npm provenance attestation.
  `@lightlysaltedhq/salt-contract` will sit beside it in the same repository, versioned on its own.

## 3.0.0 — 25/09/2026

Held for this major by the owner's ruling of 25/09/2026, and merged only after 2.1.1 was
published. Nothing here is in 2.1.1.

Taken together this is a **major** on 2.1.1. An implementation or consumer that conformed to 2.1.1
can fail 3.0.0, for these reasons, each set out in its entry below:

- five frozen colour vectors are replaced by a stricter set, which engines that reproduce all of
  2.1.0's vectors can fail;
- the derivation's quantise step rounds half to even where it rounded half away from zero. No hex
  seed's output changes, and all 165 ramp steps stand; only the new synthetic `quantise` vectors
  tell the two rules apart, and an implementation still rounding half away from zero fails them;
- each colour vector's `exercises` is an object of structured claims, not a prose string, and the
  prose moves to `$what`, so a consumer that read `exercises` as text breaks;
- the token-file schema's `$id` changes, from the archived repository's URL to this package's
  `@3` URL on jsDelivr, so a validator that resolves a `$ref` to the old URI must move;
- the `focus` ring is held to 3:1 against `surface`, `surface.alt` and `brand.tint`, roles every
  implementation already emits;
- a product that already declares a text-role property, such as `--text-heading-1`, now owes every
  required text role;
- `./scale-tokens` and `scripts/emit.py` refuse scales that 2.1.1 built: a family without the
  family it requires, a value in a shape no rule reads, and a breakpoint not in `rem`.

The package also declares `"engines": { "node": ">=22" }`, and `scripts/emit.py` needs Node. The
other entries add exports, optional roles that bind nothing until a product emits them, and gates,
or change prose and what `./scale-tokens` writes for inputs none of the design system's own themes
uses.

### Added

- **The `./scale-shape` export** (`contract/scale-shape.json`): the non-colour scale shape as data,
  where it used to exist only as a Python constant in `scripts/emit.py`. It holds the 24 structural
  families, each rung's name, and the custom property each rung emits with its type and group. It
  also holds every rule a consumer needs to derive the scale tokens itself: which families require
  which, what a non-emitting family modifies and sets, that a type rung is fixed or fluid and never
  both, the `space` derivation (rounded half to even, and `of` the exact decimal product, which
  `derive.of` states and the implementation refuses to assume; never exponent notation), the two
  constants every spacing scale ships (`--space-0`, `--space-px`), the fluid `clamp()` template and
  the pixel width recorded beside each breakpoint. It carries no other values. Design-system
  decision D27.
- **The `./scale-tokens` export** (`scripts/scale_tokens.mjs`): the one implementation of the scale
  shape. It is dependency-free JavaScript: `deriveScaleTokens(shape, scales)` returns every scale
  token in written order, and it throws `ScaleRefused` for anything the file forbids. Each token
  carries `property`, `family`, `rung`, `constant`, `type`, `group`, `value`, `dark`, `expr`, `px`,
  and the named record of a slotted family (`fluid`). These fields are the versioned API, and
  `scripts/scale_tokens.d.mts` declares them as the export's `types`. The declarations are checked
  against the implementation's actual output on every gate run. The module imports nothing, not
  even a Node built-in, so it bundles for a browser or edge runtime and loads however Node was
  started. Its command line is `scripts/scale_tokens_cli.mjs`, which is not exported.
  `scripts/emit.py` derives its own scale tokens through it, so an implementation that imports it
  gets exactly what the design system builds.
- **`scripts/check_scale_shape.py`**: data checks on the scale shape, then the implementation against
  it. Every claimed property is derived once and in the file's order, a withheld family removes
  exactly its own properties, the refusals hold, and fixed expectations hold (a rounding tie, a value
  below 1e-4, zero, a product longer than any float, pixel widths).
- **Text roles** (`vocabulary.json#textRoles`, design-system decision D29): how each kind of text is
  set, as names rather than numbers. Eleven required roles (`display`, `heading-1` to `heading-4`,
  `lead`, `body`, `small`, `label`, `caption`, `eyebrow`) and two optional ones (`quote`, `stat`),
  each with a default step, leading rung, tracking rung, weight rung and typography role. Opt-in,
  then complete: a product that emits any text-role property emits every required role, all five
  properties each, in Tailwind v4's `--text-*` shape. The trigger is a text-role property: one of
  the custom properties `properties` gives a role in `required` or `optional` (`--text-heading-1`,
  `--text-heading-1--line-height` and so on). Any other `--text-*` property, Tailwind v4's own
  `--text-sm` among them, is not a text role and triggers nothing. Also: `elementConvention` (h1 to
  h6 and p), the invariants R1 to R6, and a reservation that keeps text-role names off colour-role
  names. `typographyRoles` keeps its roles, ids and properties.
- **`./type-scale`** (`contract/type-scale.json`, D30 and D31): the type scale's derivation rule as
  fields a consumer runs (inputs with their unit in the key, ASCII step names, repeated
  multiplication, rounding to four decimals half to even on the exact binary64 value, preferred
  values from the rounded bounds, plain notation), the invariants T1 to T7 that
  `check_scales.py` held the design system's own table to, `roleFloorRem`, the neutral rung
  numbers, the named scales `quiet`, `balanced` and `dramatic` with their invariants N1 to N3, and
  the shape of a product's typography declaration and its overrides.
- **`./type-vectors`** (`contract/type-vectors.json`, D33): five derivations, two hand-built tables,
  eight kinds of refusal, thirty-three declarations and each named scale's rungs, with the claims
  each one exercises as fields a gate recomputes.
- **`./type-tokens`** (`scripts/type_tokens.mjs`, types in `scripts/type_tokens.d.mts`, D32): the
  typography rule's one implementation, exported so that a consumer imports it rather than writing
  its own. Eight public names (`derive`, `parseTable`, `cssOf`, `stepFamilies`,
  `neutralRungFamilies`, `resolve`, `Refused`, `ContractError`), every result plain JSON, and it
  imports nothing, so it bundles for any platform. Its command line is `scripts/type_tokens_cli.mjs`,
  not part of the export.
- **`scripts/type_scale.py` and `scripts/check_type_scale.py`** (D33): a second implementation kept
  only to check the frozen vectors, and the gate that runs both over every vector, recomputes every
  claim and checks every refusal code has a vector. It runs in `npm run foundations`.
- **Three optional colour roles for the inverted band** (`colorRoles.extended.$inverse`), taking
  the extended set to 51 named and 63 addressable. `ink.muted.inverse` is muted text on
  `surface.inverse`, `border.inverse` a divider there, and `border.strong.inverse` a control's
  outline there. Until now the only roles for that band were `surface.inverse` and `ink.inverse`,
  so the quieter readings took `ink.muted`, `border` and `border.strong`, which are chosen against
  `surface`. Upstreamed from salt-core, which emits all three under the property names these ids
  render to. Optional, so an implementation that emits none of them conforms exactly as before.
  Design-system decision D34.
- **Two conditional contrast rules** that bind only when their roles are emitted:
  `[ink.muted.inverse, surface.inverse]` at 4.5:1 and `[border.strong.inverse, surface.inverse]`
  at 3:1 (WCAG 1.4.11). `border.inverse` binds no rule, for the reason `border` binds none: a
  divider identifies no component. salt-core already emits all three, so both rules bind it from
  3.0.0, and it passes: on its compiled neutral ramp (the ramp every salt-core site gets, since the
  neutral seed is core's and not the editor's) muted text measures 5.456:1 light and 6.207:1 dark,
  and the control outline 5.456:1 light and 4.396:1 dark, the figures salt-core's own register
  (BD-021) and `roles.ts` record.
- `scripts/emit.py` emits the three from `extended.ink["muted.inverse"]` and
  `extended.border["inverse"]` / `["strong.inverse"]`. A border key given as a percentage now
  keeps a valid property name when the key has a dot in it.
- `scripts/contrast_rules.py`, run directly, fails when a rule names a role the vocabulary does not
  declare, or a conditional rule's `when` and `pair` name different roles. A typo in `when` used to
  make a rule skip for every implementation, counted as a legitimate skip.
- **Focus indicator rules** (`contrast.focusIndicator`, design-system decision D35). The `focus`
  ring is held to 3:1 (WCAG 1.4.11) against the ground a control sits on. `surface`,
  `surface.alt` and `brand.tint` are required roles, so those three pairs are in `requirements`
  and bind every implementation. The pairs on `surface.overlay`, `surface.sunken`,
  `surface.deep`, `surface.deep-raised`, `secondary.tint` and `accent.tint` are in
  `conditionalRequirements` and bind once the ground is emitted. The ring is at least 2 CSS px
  thick, which is 2.4.13's area floor (AAA, adopted on purpose: AA sets no thickness), and stands
  at least 1 CSS px clear of the control. On `surface.inverse` the ring is not relied on; the
  indicator there carries a keyline in `ink.inverse`, held to the ring's own 2 CSS px floor
  (`widthAtLeastCssPx`). **This is a major on its own:** the three unconditional pairs are rules
  added for roles every implementation already emits. This repository's gates check the ring's
  colour pairs and its width and offset floors, and all three of the design system's themes pass
  those. The keyline and target size are left to the rendered page: nothing here measures them,
  so nothing here says the themes meet them.
- **A target-size rule** (`contrast.targetSize`, D36): every pointer target at least 24 × 24 CSS px
  (WCAG 2.5.8, AA), with the criterion's five exceptions as fields and the spacing exception's
  circle as a number. It is evaluated on a rendered page by a product's own check, and says so in
  data: `targetSize` and the keyline each carry `"evaluatedBy": "rendered-page"`. Its figures are
  salt-core's measurement, not this package's.
- `scripts/contrast_rules.py`: `evaluate_focus_geometry()` ranks the ring's width and offset from
  the lengths an implementation emits and refuses any it cannot rank at every root font size
  (`rem`, `em`, `%`, `calc()`, `var()`, a keyword, a sign, and any non-ASCII digit or space,
  which CSS does not read). Run directly, it also checks both new blocks' shape, that each geometry
  rule's family, rung and property resolve in `contract/scale-shape.json` and agree, and that the
  keyline's colour really is covered by a required rule as the contract says.
- **Layout rhythm roles** (`vocabulary.layoutRoles`, design-system decision D37): `section-sm`,
  `section-md`, `section-lg` (the block space around a page band, at three weights) and `gutter`
  (the page's inline padding). Each has two ends, `min` at the smallest viewport and `max` at the
  largest, and each end is a rung NAME of a scale-shape family, so the lengths stay a product's own:
  the section weights are `space` rungs (8→14, 16→24 and 20→28 by default) and the gutter is
  `containerPadding` from `base` to `lg`. A product may override any end by naming another rung. Four invariants hold on the result: every end is a rung the product's scale
  emits, under the property its reference names (L1), no role shrinks as the viewport grows (L2), the section weights keep their order
  (L3), and the gutter's `min` end, the rung it names, is at least 16 CSS px (L4). Opt-in, then complete:
  a product that emits none of them owes nothing, and none of the design system's own themes emits
  them yet.
- **The `./layout-roles` export** (`scripts/layout_roles.mjs`): the one implementation of the layout
  roles. `resolveLayoutRoles(vocabulary, shape, scaleTokens, overrides)` takes the tokens
  `./scale-tokens` derives for a product's scale and returns each end's rung, property, value and
  CSS px, and the tokens (`--space-section-md-min: var(--space-16)`). It throws `LayoutRefused`,
  naming every invariant that failed. It never derives a length itself. Like `./scale-tokens` it
  loads nothing, touches no runtime global and ships its
  types (`scripts/layout_roles.d.mts`); its command line, `scripts/layout_roles_cli.mjs`, is not
  exported. `scripts/check_layout_roles.py` runs in `npm run foundations`, and the pack gate
  compiles a strict TypeScript consumer against the export.

- **A vector for the derivation's rounding rule** (`vectors.json#quantise`, design-system
  decision D39). No hex seed makes a scaled channel an exact tie (all 16,777,216 were measured), so
  no ramp can tell one tie-break from another. `exact-ties` starts at step 5 instead: three linear
  sRGB channels whose scaled value is exactly 2.5, 3.5 and 8.5 in binary64, which must quantise to
  the bytes 2, 4 and 8. Half away from zero and `floor(x + 0.5)` give 3 and 9 on the first and
  last; rounding the exact product of the sRGB value and 255 gives 3 on the second; rounding the
  decimal product gives 9 on the last. A second vector, `operation-order`, puts the first channel one
  ulp above its tie: in step 5's order it rounds to 3, and multiplied in either other order (the
  constants first, or 255 before 12.92) it lands on the tie and rounds to 2. An implementation runs
  its step 5 over `linear` and compares `hex`; `scripts/oklch.py` gains `quantise()` for it, and `counts` gains `quantise`.
  The section is frozen from the Python implementation alone, because salt's PHP still rounds
  half away from zero.

### Changed

- **The derivation's quantise step rounds half to even, of the exact binary64 scaled channel**
  (`derivation.json` step 5: `"rounding": "halfEven", "of": "exactBinary64"`; the owner's
  ruling of 25/09/2026, recorded as design-system decision D39). It rounded half away from zero,
  so the contract had two tie-breaks; now colour matches the type scale and the space scale. **No
  hex seed's output changes:** all 165 frozen ramp steps re-derive byte for byte under both rules,
  and no seed of the 16,777,216 brings a scaled channel within 3.6e-10 of a tie. An implementation
  still rounding half away from zero (PHP's `round()`, JavaScript's `Math.round()`, or
  `floor(x + 0.5)`) passes every ramp and fails `quantise`, which makes this a major. Write the
  rule as a comparison: `floor(x + 0.5)` is also wrong at 0.49999999999999994, where the addition
  rounds up. `scripts/oklch.py` does, and its `_round_half_up` is now `_round_half_even`.
- **Five frozen vectors replaced, because they were Lightly Salted's own palette (D26).** The
  Saltworks theme carries Lightly Salted's brand, and its three brand seeds and two of its slate
  neutrals were fixtures in this public package. Each replacement
  was chosen at round OKLCH coordinates, recorded in its `exercises` as `chosenAt`, for the same kind of case:
  a hue that clips a whole half of the ladder (now a yellow, clipping the dark half 400–950, while
  the blue primary still clips the light half); a green that clips only in the dark middle
  (500–800); a hue with a hole at 400 (now a magenta, whose cusp sits at that rung; white text on
  it measures 3.22:1, under AA); a near-achromatic seed that is not quite C=0; and a very dark,
  low-chroma seed. The other ten vectors are byte-identical. Counts are unchanged at 15 seeds, 11
  steps and 165 assertions, and so is coverage: 55 of the 165 steps go through the gamut search.
- **Re-frozen by `freeze_vectors.py`, which could not run until now.** Its paths still assumed the
  contract's old sibling layout. It now runs this directory's `oklch.py` and salt's PHP, and it
  froze their agreement on all 165 steps. The TypeScript engine in salt-core, which pins 2.1.0,
  reproduces every new vector too: all 17 of its contract tests pass against a tarball of this tree.
- **Why this is a major.** The derivation spec, the file's shape and its counts are unchanged, but
  the new set is stricter than the old one, and the definitions above make that a major.
  Engines that reproduce all 165 of 2.1.0's vectors fail these. Measured:
  - a gamut search that stops once `hi - lo <= 1e-4` misses the magenta seed at steps 300 and 800;
  - one limited to 12 iterations misses step 800;
  - one limited to 10 or 11 iterations that returns the midpoint misses step 800.
  An implementation that follows the spec exactly (20 iterations, keeping the lower bound)
  reproduces both sets.
- **Each colour vector's `exercises` is an object of claims, and its prose moves to `$what`**
  (design-system decision D39). A consumer that printed `exercises` as a string, as salt-core's test
  titles do, prints `$what` instead. `scripts/audit_vectors.py` recomputes every claim from
  `derivation.json` (a seed's coordinates, the rungs it sends through the chroma search, a hue's
  cusp, how far a rung clips, a contrast, a chroma rank, whether the hue moves the ramp) and fails
  on an unknown kind, a vector with no claims, a deleted claim and a figure in `$what`. Two of the
  old notes were wrong: the light pole's chroma is not exactly zero (it is 3.7e-8), and the mild
  blue that clips only at 50 has a chroma of 0.072, not 0.073. No seed or ramp step changes.
- **`scripts/emit.py` derives every scale token through `./scale-tokens`, and so needs Node** (22 or
  later) wherever it runs. There is no Python fallback. The design system's own builds are
  byte-identical through it.
- **A scale family supplied without what it requires is refused**: `space` without `spaceBase`,
  `weightDark` without `weight`, and `typeScaleViewports` without `typeScaleFluid`. 2.1.1 built all
  three without a word; fluid type without its viewports was already refused. A scale that relied on
  that now fails, which makes this a major.
- **A value in a shape no rule can read is refused by name.** That covers a slotted value that is not
  a list of the right length, a map family given a string, a rung given a list, a derived family that
  is not a list of distinct rungs, and a derivation source that is not a length written as a number
  and a unit the contract names, with no space between: `derive.units` for the source, `pxFrom` for
  a breakpoint, both `rem` for now (`0.25rem`; never `4`, `"0.25"`, `"0.25 rem"`, `1.rem`, `.5rem` or
  `0.25foo`). 2.1.1 wrote some of
  these through (`typeScaleFluid: {"0": "1vw"}` became `clamp(1, v, w)`, and a rung given a list was
  written as the list). Others it refused with a message about the wrong thing: `radius: "8px"` was
  reported as rungs `8`, `p` and `x`.
- **`scripts/emit.py` reads the scale shape from `contract/scale-shape.json`** and holds no copy.
  `emit.SCALE_SHAPE` loses `listOfSteps` and `valueShape`. `derive` replaces the first, and `slots`,
  `valueTemplate` and `recordAs` replace the second.
- **The `space` derivation is computed exactly**, in decimal, where it used Python's six-digit `g`
  format. A value changes only where that format broke the rule: a product that rounds at a tie in
  the sixth significant digit, and a product below 1e-4 or of 1e6 and above, which `g` writes in
  exponent notation. A base of `0.0000625rem` used to give `--space-0-5: 3.125e-05rem` and now gives
  `0.00003125rem`. A derived zero is `0`, whatever the sign of its base. The design system's own
  builds do not change.
- **A map family's tokens are written in its `steps` order**, not the order the scale's own object
  lists them in. 2.1.1 followed the scale: `radius: {"lg": …, "sm": …}` wrote `--radius-lg` first,
  and now writes `--radius-sm` first. Only the order changes, not a name or a value. None of the
  design system's themes is affected, because each lists its rungs in `steps` order already.
- **Numbers come back from `./scale-tokens` as JSON numbers**, so a float that is a whole number is
  written as an integer and a signed zero as `0`: `opacity: {"opaque": 1.0, "invisible": -0.0}`
  gave `1.0` and `-0.0` in 2.1.1, and gives `1` and `0` now. None of the design system's themes is
  affected, because each writes its whole numbers as integers.
- **A breakpoint's recorded pixel width is computed exactly, and only from rem**: the whole pixels at
  a 16px root, truncated. A breakpoint in any other unit is refused, where 2.1.1 multiplied whatever
  it was given (`640px` became `10240px`).
- **The package declares `"engines": { "node": ">=22" }`.** Installing it on an older Node,
  Node 20 included, prints an `EBADENGINE` warning, and with npm's `engine-strict` set it stops
  the install with `EBADENGINE`. 2.1.1 declared no engines, so it installed anywhere without a
  word.
- `scripts/check_no_colours.py` fails on any file it neither reads nor exempts by name, and on a file
  it cannot read as text, where it used to read only the extensions it listed. `.mjs`, `.cjs`,
  `.mts`, `.cts`, `.jsx` and `.tsx` are read. `scripts/selftest_emit.py` uses synthetic scale
  values, where four of its fixtures were one product's own. `emit.py`'s prose no longer names one
  product's page-frame width.
- **`scripts/emit.py` emits text roles when asked** (D32). `generate()` and `build_tokens()` take
  an optional `typography=` declaration; supplied, the role tokens come from
  `scripts/type_tokens.mjs` run through Node, appended to the typography domain; omitted, nothing
  changes. The design system's own three themes now emit them, and their build is otherwise
  byte-identical. A role token whose value points at a property with a dark value (the bold and
  semibold weights) is declared again in the dark block, so a `[data-theme="dark"]` subtree nested
  below the root gets the dark weight too: a `var()` in a custom property is resolved where it is
  declared, and the root's declaration alone carried the light weight down.
- **The display typography role's prose no longer names two pixel sizes** (D29, the proposal's
  decision 17): one of them was a product's own body size, and a brand value has no place in the
  contract's prose.
- **The token-file schema's `$id` names this package, not the archived repository** (D38). It was
  `https://github.com/otigs/base-design-system/schema/token-file.schema.json`, a private repository
  archived on 18/08/2026, so the URI resolved for nobody. In 3.0.0 it is
  `https://cdn.jsdelivr.net/npm/@lightlysaltedhq/design-foundations@3/schema/token-file.schema.json`,
  which resolves to this file in the latest 3.x once 3.0.0 is public, and stays right when the
  contract moves to a public repository of its own after 3.0.0, because the package keeps its name.
  The schema's content is unchanged. A validator that registers the schema under its `$id` and
  resolves a `$ref` to the old URI must use the new one; one that loads the file through
  `./schema/token-file` and validates against it sees no difference. No token file this design
  system emits carries the `$id`, so no theme's build changes. Its `@3` is the package's major,
  and moves with it: `verify:foundations-pack` fails when it does not.
- **No product's reasoning or values left in the prose `scripts/emit.py` writes into a theme's
  build, or in the contract's own** (D38). The page frame's description (`--container-page`) argued
  from one product ("data screens are chart-heavy and read better wide") and now says what the
  token is for any product; the display role's description named one product's display size in
  pixels and now says "the face you want at the largest step", as `contract/vocabulary.json`
  already did. A theme that takes the emitter's descriptions sees those two strings change in its token JSON and nothing else: no
  value, name or CSS moves. In `contract/vocabulary.json`, `$noValues` no longer says which ramp
  step two named products use for their dark surface, `layoutRoles.$css` no longer quotes one
  product's band and gutter lengths, and `layoutRoles.$L4` no longer names the products whose
  gutters set the 16 CSS px floor. The rules are unchanged.
- **`scripts/check_prose_lengths.py`, a guard for lengths and durations in this package's prose**
  (D38, owed under D27). It reads every file here, its own included bar its allowance tables, as
  `check_no_colours.py` does, with JSON, JavaScript and Python escapes and HTML character
  references decoded and invisible format characters dropped. It fails on any figure with a CSS
  length or time unit, attached or after a space, a hyphen or the word `CSS`, or spelled out
  (`pixels`, `seconds`, `milliseconds`), unless the file's allowance names it with an exact count:
  one of the contract's own rule figures (the 0.5px distinctness threshold, the 1px and 2px floors,
  the 16px root, the 24px target, the 0.1em caps tracking default), a length quoted as an example
  of a spelling or a worked conversion, or a value in one of four synthetic fixture corpora held
  to an exact total and a digest of its values. A number in digits CSS does not read fails as unrankable. It runs in the
  design system's `npm run foundations` and again on the packed tarball. On its first run it found
  two more values in shipped prose, both removed: `contrast_rules.py`'s docstring gave the focus
  ring width every theme here uses as its example, and a comment there quoted a theme's type step
  as the length a no-break space once broke.

The text roles are a major by the definitions above, not a minor: they add rules for roles a
product may already emit, since a product whose theme already declares `--text-heading-1` now owes
every required role. They ship in 3.0.0 with the rest of this section.

## 2.1.1 — 25/09/2026

Taken together this is a **patch** on 2.1.0.

### Added

- This changelog, shipped in the tarball (`files` now lists it).

### Fixed

- **The contract contradicted itself about who owes `ink` on `brand.tint`.**
  `contrast.conditionalRequirements.$rule` said that an implementation emitting none of the
  extended roles owes no conditional rule. But the `[ink, brand.tint]` rule added in 2.1.0 names
  two REQUIRED roles, so it binds every conforming implementation. Measured with
  `contrast_rules.evaluate()` on a palette of the 14 required roles alone: 15 of the 16
  conditional rules skip, and that one applies, in both modes. The wording is corrected in
  `$rule`, `$why` and `$v2`, and in `contrast_rules.py`'s docstring. No rule moved, no ratio
  changed and the evaluator is untouched: with the prose set aside the vocabulary is identical, so
  the same rules bind the same implementations. `selftest_emit.py` had asserted the old reading,
  with a fixture that lacked `brand.tint`. It now holds all 14 required roles and asserts that
  exactly `[ink, brand.tint]` applies, in both modes.

### Changed

- **Version fields follow the rule above.** The published 2.1.0 files say 2.0.0
  (`vocabulary.json`), 1.0.0 (`derivation.json`) and 1.0.0 (`vectors.json`); in 2.1.1 all three say
  2.1.1. No content changes with them. `freeze_vectors.py` writes the package's version rather than
  a literal, and `verify:foundations-pack` gains the check.
- **Counts in prose, measured.** `vocabulary.json`'s `$why` and the README gave the extended-role
  counts as 45 and 41; they are given as named and addressable counts per version, as below.
- **Prose that named the archived `base-design-system` as the contract's home now names this
  package.** The strings `scripts/emit.py` writes into a generated token package (each derived
  ramp step's note, the default tree-source and derivation notes, the default palette-source
  sentence, the app-tokens preamble) and one message in `prove_byte_identity.py`. Each names a
  specifier that resolves through this package's `exports` (`/derivation`, `/vocabulary`), not a
  path inside it, which a consumer's `require` would refuse. No emitted value, name or order
  changes; in the design system's own build the diff is those strings and nothing else.

## 2.1.0 — 03/09/2026

**The first published version, and the first under this name.** Before it the contract was
`@lightly-salted/base-design-system`, private and `UNLICENSED`, last at 2.0.1 (16/08/2026). It was
folded into `lightlysaltedhq/design-system` as `foundations/` on 18/08/2026 and published from
there, public and MIT, by hand. Reconstructed from git: the tarball on npmjs.com matches
`foundations/` at design-system commit `80bfb16` byte for byte, all 17 files.

Released as a minor. By the definitions above one addition made it a major: the `[ink,
brand.tint]` rule names two required roles, so it binds every implementation, including one that
emits no extended role, and the vocabulary's own text said the opposite (fixed in 2.1.1).
Everything else here is optional or binds only roles that did not exist before.

### Added

- **Seven optional colour roles**, taking the extended set to 48 named and 60 addressable.
  `highlight.on-dark` joins the non-flipping family (eight
  members now). `secondary.fill`, `secondary.tint` and `accent.tint` give the secondary and accent
  hues the fill and wash `brand` already had. `on-brand-tint`, `on-secondary-tint` and
  `on-accent-tint` are the glyph drawn on each wash: a tint stays a dark wash in dark mode and the
  glyph on it is what inverts.
- **Eight conditional contrast rules**, each binding when its roles are emitted, all at 4.5:1:
  `highlight.on-dark` against `surface.deep` and `surface.deep-raised`; each `on-*-tint` against its
  tint; and plain `ink` against each tint, the pair a message bubble or a chip actually paints.
  `ink` and `brand.tint` are both required roles, so that one rule binds every implementation.
- **An optional `lead` typography role** (`--font-lead`): which family a standfirst wears, apart
  from `body`, because one implementation sets it in a serif and another in its sans.
- **`scripts/emit.py`:** an optional fourth family slot, `fontSystem.display`, emitting
  `--font-display-family` with the `display` role aliasing it; an optional, theme-extensible
  `durationExtended` family for ambient motion measured in tens of seconds, emitted at the end of
  its domain; the preset keys for every role above; and a `build_dir` parameter.
- **The package itself:** exports `./vocabulary`, `./derivation`, `./vectors` and
  `./schema/token-file`, the same specifiers the private package used, and
  `publishConfig["@lightlysaltedhq:registry"]` pinning the publish target to npmjs.com from any
  directory.

### Changed

- The shadcn adapter maps `--badge-outline` to `border`. It was an alpha of `ink`, which was
  invisible in dark mode.
- `scripts/prove_byte_identity.py` gains `--theme`, exports contract and theme from one commit and
  rebuilds them together. `--impl` is still accepted, but it is no longer required: it defaults to
  the repository holding the script, where it used to have to name a sibling checkout.
- `scripts/emit.py` writes `GENERATED from themes/` in the header of every `tokens.css`, where it
  wrote `GENERATED from presets/`.

### Unchanged

- `contract/derivation.json`, `contract/vectors.json` and `schema/token-file.schema.json` are
  byte-identical to 2.0.1, as are `oklch.py`, `validate_palette.py`, `contrast_rules.py` and the
  remaining gates.

## Before 2.1.0 — `@lightly-salted/base-design-system`, never published

- **2.0.1 (16/08/2026).** An adversarial review's blockers fixed: the palette instrument could no
  longer be told not to look, every emitted `var()` must resolve or the build fails, and
  `contrast_rules.py` evaluates `conditionalRequirements`, which nothing had run.
- **2.0.0 (15/08/2026).** The machinery joined the contract: `oklch.py`, `emit.py`,
  `validate_palette.py`, and 37 named optional extended roles, 49 addressable once the three
  companion suffixes on each of the four status roles are counted (41 named and 53 addressable by
  2.0.1, with the non-flipping family).
  `required` was untouched, so every 1.0.0 implementation still conformed.
- **1.0.0 (16/07/2026).** The contract: the tier model and role vocabulary, the gamut-mapped OKLCH
  derivation spec, 165 frozen vectors, the token-file schema, and no colour values.
