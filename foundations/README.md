# foundations — the contract

**How Lightly Salted builds design systems: shared rules, never shared colours.**

This directory holds **zero colour values**, and that is the entire point. It was
`otigs/base-design-system` (private, never published, `@lightly-salted/base-design-system`
**v2.0.1**) until 18/08/2026, when it was folded into the private `lightlysaltedhq/design-system`
as `foundations/`. After 3.0.0 it moved again, unchanged, to the public `lightlysaltedhq/contracts`,
so its source can be read by anyone who installs it and its releases carry provenance.

## Published

This directory ships to npm as **`@lightlysaltedhq/design-foundations`**: public, MIT. The
palettes that conform to it (Saltworks, Wakemere and Ezra) stay in the private design-system
repository, which installs this package like any other implementation.

An implementation depends on it for the rules and supplies its own colours:

```js
import vocabulary from '@lightlysaltedhq/design-foundations/vocabulary'
import derivation from '@lightlysaltedhq/design-foundations/derivation'
import vectors from '@lightlysaltedhq/design-foundations/vectors'
import scaleShape from '@lightlysaltedhq/design-foundations/scale-shape'
import { deriveScaleTokens } from '@lightlysaltedhq/design-foundations/scale-tokens'
import typeScale from '@lightlysaltedhq/design-foundations/type-scale'
import typeVectors from '@lightlysaltedhq/design-foundations/type-vectors'
import { derive, stepFamilies, neutralRungFamilies, resolve } from '@lightlysaltedhq/design-foundations/type-tokens'
import { resolveLayoutRoles } from '@lightlysaltedhq/design-foundations/layout-roles'
```

`scale-tokens` is the one implementation of the scale shape: `deriveScaleTokens(scaleShape, scales)`
returns every scale token the design system would build from `scales`, and throws `ScaleRefused` for
what the file forbids. The design system's own build calls it, so importing it gets exactly the same
tokens, and its output fields are a versioned API, declared for TypeScript in
`scripts/scale_tokens.d.mts`. It imports nothing, Node built-ins included, so it runs in Node 22 or
later, a browser, an edge runtime or any bundle.

`layout-roles` is the one implementation of the layout rhythm roles (`vocabulary.layoutRoles`):
`resolveLayoutRoles(vocabulary, scaleShape, deriveScaleTokens(scaleShape, scales), overrides)`
resolves the contract's defaults and any end a product overrides against the tokens its own scale
derives, and throws `LayoutRefused`, naming every invariant that failed. It takes those tokens
rather than deriving them, so the space derivation is written once, and like `scale-tokens` it
loads nothing and touches no runtime global.

`scale-shape` is the one to read before naming a structural custom property of your own. It lists
every non-colour family the contract emits, every rung, and the property each rung becomes, so a
name that collides with one (`--measure-wide` as a page width, say, when the contract's
`--measure-wide` is a text measure) can be caught before it ships rather than after.

`./type-tokens` is code, not data: the typography rule's one implementation, which the design
system's own build also runs. Its public API is eight names, `derive`, `parseTable`, `cssOf`,
`stepFamilies`, `neutralRungFamilies`, `resolve`, `Refused` and `ContractError`, documented at the
top of `scripts/type_tokens.mjs` and declared for TypeScript in `scripts/type_tokens.d.mts`, which
`check_type_scale.py` holds to the functions' actual results. Every result is plain JSON. It imports
nothing, Node built-ins included, so it runs in Node 22 or later (`engines`), a browser, an edge
runtime or any bundle. Changing a name, an argument or a result is a major release.

`npm run verify:foundations-pack` proves the tarball is what that claims. It packs the
package, then checks the shipped bytes rather than the working tree: nothing from `build/`,
`themes/` or `packages/` is present, the colour guard passes on what would actually go
out, and every declared export resolves inside the archive.

That first check keeps the tarball to this directory. npm packs relative to the directory
holding the manifest, and this repository holds more than one package, so a manifest moved to
the repository root would ship everything beside it, permanently: npm unpublish does not recall
what has already been fetched, and the tarball is mirrored the moment it lands. The palettes
that conform to this contract are not in this repository at all; they stay in the private
design-system repository.

**Releasing.** `.github/workflows/release-foundations.yml` stages this package on npmjs.com
with npm trusted publishing (OIDC, no token anywhere) when a `foundations-v<version>` tag is
pushed. Staged is not published: nothing is installable until a maintainer approves it. Each
package in this repository releases on its own tag prefix.

1. On a branch, set one version string in `package.json` and the top-level `version` in each
   `contract/*.json`. In a new major, also move the `@<major>` in
   `schema/token-file.schema.json`'s `$id`. Move `CHANGELOG.md`'s Unreleased section under the
   version, and merge to `main`. CI fails the branch if any of those versions disagrees
   (`verify:foundations-pack`). Each implementation then moves its own exact pin in a reviewed
   pull request; the design-system repository also moves the `contract.version` its themes
   declare.
2. Tag the merge commit on main, `foundations-v<version>`, and push the tag. The workflow
   checks that the tag matches `package.json`, that the commit is on `main` and that its
   `foundations/` is `main`'s, runs the contract's gates and the pack gate, and stages the
   tarball.
3. On npmjs.com, open **Staged Packages** from the account menu and find the version's card.
   Approve it with 2FA only if the card's SHASUM is exactly the shasum in the staging run's
   summary and its USER is GitHub Actions, the trusted publisher. Otherwise reject it. The card
   shows no stage id; `npm stage list` lists the ids from a logged-in terminal.
4. Re-run the tag's workflow run. It finds the version on the registry and passes only if the
   registry serves it with the integrity the tag packs.
5. Once, after the first release has been through steps 1 to 4: in the package's
   **Settings → Publishing access** on npmjs.com, choose **Require two-factor authentication
   and disallow tokens**. No token can publish after that. The trusted publisher keeps working,
   because it uses OIDC rather than a token (docs.npmjs.com/trusted-publishers).

## Why it folded in

Base was reached by every implementation through a `../base-design-system` sibling lookup, which
had two costs the fold-in removes:

- **CI could not run the generator.** Both consumers needed a second checkout — this repo used a
  read-only deploy key for it, Wakemere's CI skipped token verification entirely and said so in
  its README. A gate that cannot run is not a gate.
- **A third implementation's only route to the machinery was a copy**, and a copied generator
  arrives carrying the brand it was copied from. That is the failure this contract was created
  after.

With one repository, `scripts/generate.py` imports `foundations/scripts/emit.py` directly, every
theme is generated by the same code on every push, and there is no second checkout to be missing,
stale, or wrong.

## What is in here

| | |
|---|---|
| `contract/vocabulary.json` | The tier model, the role vocabulary (20 required · 51 named extended · 3 companion suffixes on each of the 4 status roles, so 63 extended addressable), the typography roles, the layout rhythm roles, the text roles (11 required and 2 optional, opt-in, with their default steps and rungs and the invariants R1 to R6), the contrast requirements and `conditionalRequirements`, the focus indicator's rules and the target-size rule, and the shadcn adapter mapping. |
| `contract/type-scale.json` | The type scale's derivation rule as data (inputs, operations, rounding, notation), its invariants T1 to T7, the text roles' size floor, the neutral rung numbers, three named scales (`quiet`, `balanced`, `dramatic`) and how a product declares its typography and overrides a role. No product's values. |
| `contract/type-vectors.json` | Frozen typography vectors: five derivations, two hand-built tables, refusals, declarations and overrides, and each named scale's expected rungs. Each vector's `exercises` is a structured claim `check_type_scale.py` recomputes. |
| `contract/derivation.json` | The gamut-mapped OKLCH derivation spec — how a seed becomes an 11-step ladder. |
| `contract/vectors.json` | 15 frozen reference vectors, each a seed and the 11-step ramp it must derive: 165 asserted ramp steps (180 hex values counting the seeds), chosen for the gamut branches they exercise, and one quantise vector whose channels are exact ties, which pins the rounding rule no seed can reach. Each vector's `exercises` is a structured claim `audit_vectors.py` recomputes. The independent truth the derivation is proven against. |
| `contract/scale-shape.json` | The shape of the non-colour scales: 24 families, their rung names, the custom property each rung emits with its type and group, and the structural rules as fields: which families require which, what each non-emitting family modifies, which families share rungs exclusively, the `space` derivation, and the colour roles a family depends on. No values, apart from the two constants every spacing scale ships (`--space-0`, `--space-px`). Enough to derive every scale token without reading `emit.py`, including how each value is written (the `space` derivation with its rounding, the fluid `clamp()`, the dark-mode weights, the recorded viewports and pixel widths). |
| `schema/token-file.schema.json` | The shape an emitted token file must have. |
| `scripts/type_tokens.mjs` · `type_tokens.d.mts` | The typography rule's one implementation, exported as `./type-tokens` with its types: derives a scale, reads a product's table and resolves a declaration to its `--text-*` tokens. |
| `scripts/type_tokens_cli.mjs` | Its command line, a batch of jobs in and results out, kept out of the export. `emit.py` and the gates run it through Node. |
| `scripts/type_scale.py` · `check_type_scale.py` | A second, independent implementation that exists only to check the frozen vectors, and the gate that runs both over every vector and recomputes every claim. Nothing is built with `type_scale.py`. |
| `scripts/emit.py` | The generator core. A preset in, a conforming token package out. Reads which non-colour scale families exist from `contract/scale-shape.json` (loaded as `SCALE_SHAPE`) and derives every scale token by calling `scripts/scale_tokens.mjs`, so it needs Node. It carries none of their values. |
| `scripts/oklch.py` | OKLab/OKLCH maths and the ramp derivation. Pure coordinate maths. |
| `scripts/validate_palette.py` | The categorical/ordinal palette instrument — CVD simulation, ΔE, lightness bands, chroma floors, contrast against a surface. |
| `scripts/contrast_rules.py` | Evaluates the contract's contrast section generically, so a rule added here starts binding on the next run with no code change downstream. Run directly, it refuses a rule that names a role the vocabulary does not declare, which would otherwise be skipped by everyone for ever. `evaluate_focus_geometry()` ranks the focus ring's width and offset, and refuses a length it cannot rank. |
| `scripts/check_no_colours.py` | The founding property, as a gate: **scoped to this directory**, it fails if a colour value gets in. |
| `scripts/check_prose_lengths.py` | The same property for lengths and durations: every one stated anywhere in this directory, its own file included, is a rule figure the contract names, an example of a spelling, or part of a fixture corpus pinned by its count and a digest of its values. It reads units attached, spaced, hyphenated or spelled out, through escapes, HTML entities and invisible format characters, and fails on anything else, and on a number written in digits CSS does not read. |
| `scripts/check_derivation.py` · `audit_vectors.py` · `freeze_vectors.py` | The derivation's own gates and the tool that froze its fixtures. |
| `scripts/selftest_emit.py` | A minimal conformant preset emits a package and every guard still fires. |
| `scripts/scale_tokens.mjs` | The one implementation of `contract/scale-shape.json`, exported as `./scale-tokens`: dependency-free JavaScript that derives every scale token from the file and a scale's values, and refuses what the file forbids. `emit.py` builds through it. |
| `scripts/scale_tokens.d.mts` | The types of `./scale-tokens`. `check_scale_shape.py` checks them against the implementation's actual output, so they cannot drift. |
| `scripts/scale_tokens_cli.mjs` | The command line for `scale_tokens.mjs` (a batch of scales on stdin, JSON on stdout), which `emit.py` calls. Not exported, so the export itself stays free of Node built-ins. |
| `scripts/layout_roles.mjs` | The one implementation of the layout rhythm roles, exported as `./layout-roles`: a product's declaration resolved against its own scale through `scale_tokens.mjs`, and every invariant checked. It imports no Node built-in. |
| `scripts/layout_roles.d.mts` | The types of `./layout-roles`. `check_layout_roles.py` checks them against the implementation's actual output. |
| `scripts/layout_roles_cli.mjs` | The command line for `layout_roles.mjs`, which `check_layout_roles.py` calls. Not exported. |
| `scripts/check_layout_roles.py` | Every layout-role default names a rung of its role's family in `contract/scale-shape.json`, then the implementation against the vocabulary: the defaults' lengths, each invariant refused under its own code, and the refusals. It breaks a copy of the implementation one way at a time on every run, and must notice each break. |
| `scripts/check_scale_shape.py` | Data checks on `contract/scale-shape.json` (one owner per property; consistent dependencies, modifications, exclusions and templates), then the implementation against it. Every claimed property is derived once and in the file's order, a withheld family removes exactly its own, the refusals hold, and fixed expectations hold (a rounding tie, a value below 1e-4, zero, a product longer than any float, pixel widths). |
| `scripts/prove_byte_identity.py` | Runs a theme's build and diffs it against what is committed, byte for byte. |
| `CHANGELOG.md` | What changed in each release, and the versioning rule: every contract file carries the package's version. |

## The rules that bind anything touching this

1. **No colour value lives here.** Not a default, not a fixture, not a helpful example.
   `check_no_colours.py` enforces it and its allowlist narrows to exact counts and exact keywords,
   never whole files.
2. **No non-colour value either.** `contract/scale-shape.json` declares that a `radius` family
   exists and that its rungs are `sm/md/lg/full`; `scales.json` at the repository root says what
   they are. v2.0.0 briefly shipped `DEFAULT_SCALES` with real numbers, which handed one product's
   page frame and type ramp to every future implementation *and* made the byte-identity proof
   circular — it passed with no `scales=` argument at all. `scales=` is required and has no
   default. The prose is held to the same line: `check_prose_lengths.py` fails on a length or
   duration the contract does not name, in any file here.
3. **Rung names are shared vocabulary.** That is what lets two themes swap a component, so a new
   rung is a change to `contract/scale-shape.json` with a reason, never a value passed in quietly.
4. **Order is structure.** The emitted CSS is ordered by insertion, so the sequence of blocks in
   `emit.py` is part of the contract's output shape. Moving one to make a source file read better
   changes a shipping stylesheet.
5. **Gates fail closed and have no skip flag.** A gate that passes when it did not run launders
   the absence of evidence into a green tick.

## What changed on the way in (18/08/2026)

Two additions, both of which were live workarounds in Wakemere's own generator and are now the
contract catching up. A theme declares them or does not; a theme that does not is unaffected, and
`build/saltworks` proved that by regenerating byte-for-byte.

- **A fourth typography family slot.** The contract had a display *role* (`--font-display`) but
  only three family *slots* (sans/serif/mono), so a fourth face had nowhere to land. `fontSystem`
  may now declare `display`, which emits `--font-display-family`, and the `display` role aliases
  it. The family cannot simply be called `--font-display`: that is the role's own property and the
  two sharing it would be circular.
- **`durationExtended`** — an optional set of duration rungs above `ambient`, for motion measured
  in tens of seconds rather than hundreds of milliseconds. Declared in `SCALE_SHAPE` after the
  core motion families, so it appends to the end of the motion domain exactly where a wrapper used
  to put it.

Both are emitted only if a theme supplies them. `themes/saltworks` supplies neither.

## Running the gates

From the repository root:

```bash
npm run foundations        # audit_vectors · check_derivation · check_no_colours ·
                           # check_prose_lengths · oklch selftest ·
                           # contrast_rules · selftest_emit · check_scale_shape · check_type_scale ·
                           # check_layout_roles   (needs Node 22+)
```

`scripts/prove_byte_identity.py` ships in the package for implementations to run against their
own repository (the design-system runs it as `npm run prove`). It takes `--impl` and `--theme`,
the latter defaulting to `saltworks`. Its `--claim promotion`
(the default) fails unless the generator genuinely *imports* `emit.py`, because identical bytes
from a generator that **copied** the machinery prove nothing at all.
