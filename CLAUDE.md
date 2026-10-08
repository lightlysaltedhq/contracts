# contracts

Lightly Salted's public contracts. Rules only: no brand values, no implementation code.

## Packages

| Directory | Package | Notion Product | Release tag |
| --- | --- | --- | --- |
| `foundations/` | `@lightlysaltedhq/design-foundations` | Design System | `foundations-v*` |
| `salt-contract/` (to come) | `@lightlysaltedhq/salt-contract` | Salt | `salt-contract-v*` |

Each package is versioned and released on its own. Its own CHANGELOG says what each part of a
version means.

## Plan and records

- **Plan of record:** Lightly Salted's Notion, by the package's Product (Design System or Salt).
  Epic Rank and Priority are the owner's.
- **Decisions:** the private `lightlysaltedhq/docs` repository: `salt/DECISIONS.md` (SC-nnn) for the
  Salt contract. design-foundations' history cites design-system decisions (D-nnn), recorded in
  that private repository.

## Rules

- Nothing here may carry a brand's values. For design-foundations, `npm run foundations` (its
  `check_no_colours.py`, scoped to `foundations/`) and `npm run verify:foundations-pack` prove it
  of the tree and of the tarball. Each package carries its own colour gate; root files are prose
  and tooling and must not hold values either.
- Every GitHub Action is pinned to a full commit SHA (`npm run verify:actions-pinned`).
- Publishing is staged from CI by npm trusted publishing and approved by the owner with a passkey.
  No npm token is ever stored here.
- `npm run verify` runs every gate. Run it before review.
- British English, DD/MM/YYYY.
