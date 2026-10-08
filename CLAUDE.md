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

- **Plan of record:** Notion. Work Items (`collection://d4ee0676-be6c-49b2-9d02-90d0bf65bd8d`)
  filtered by the package's Product, and Epics (`collection://93cde8d5-7927-40b3-858f-3d8415cc0c36`).
  Epic Rank and Priority are the owner's.
- **Decisions:** the private `lightlysaltedhq/docs` repository: `salt/DECISIONS.md` (SC-nnn) for the
  Salt contract. design-foundations' history cites design-system decisions (D-nnn), recorded in
  that private repository.

## Rules

- Nothing here may carry a brand's values. `npm run foundations` (its `check_no_colours.py`) and
  `npm run verify:foundations-pack` prove it of the tree and of the tarball.
- Every GitHub Action is pinned to a full commit SHA (`npm run verify:actions-pinned`).
- Publishing is staged from CI by npm trusted publishing and approved by the owner with a passkey.
  No npm token is ever stored here.
- `npm run verify` runs every gate. Run it before review.
- British English, DD/MM/YYYY.
