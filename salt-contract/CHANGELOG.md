# Changelog — @lightlysaltedhq/salt-contract

Newest first. Dates are DD/MM/YYYY. What each part of a version means, and how a breaking change is
announced and migrated, is in `RELEASE-POLICY.md`. Decisions cited as `SC-nnn` are in Lightly
Salted's decision log for Product Salt.

## Unreleased (0.1.0, drafting)

- The package exists, with its gate (`npm run salt-contract` at the repository root) and its
  release workflow on the `salt-contract-v*` tag prefix. It stays `private` until 1.0.0.
- `RELEASE-POLICY.md`: one version for the package, what is major, minor and patch for every kind
  of artefact, deprecation over at least one minor, a machine-readable migration file for every
  major, exact pins and the lag rule for implementations, and staged releases with provenance.
- `contract/sections.json` (`./sections`, schema `./schema/sections`): the vocabulary. 17 sections
  (16 core, pricing at the edge), 29 components and 7 page views, each with the names and stored
  option values Salt for Next.js 0.11.0 and salt-wordpress 5.0.0 used before, so each platform's
  renames can be generated. Every current Next.js block and WordPress layout is mapped; WordPress
  `intro` folds into `rich-text`, and its five collection layouts into `collection-showcase`
  (testimonials as a slider into `carousel`). Three open questions are recorded in the file.
- `contract/fields/` (`./fields/<section>`, schema `./schema/field-definition`): every section's
  editor fields, and the section settings every section shares, in one platform-neutral form
  each implementation will generate its fields from. Field types are only those Payload and ACF can
  both express. Where the platforms differed, one canonical definition is chosen and each
  platform's former name and stored value is recorded with what it owes. Nine open questions are
  listed in the schema's description.
- `contract/markup/` (`./markup/<id>`, schema `./schema/markup`): element order, `salt-*` classes,
  data attributes, heading rules, zero state and priority media for all 17 sections, 29 components
  and 7 views; 403 elements and 214 classes. The shared accessibility rules are written once in
  `markup/section`. Every `salt-*` class in salt-nextjs's four section and component stylesheets
  appears on a contract element. Open questions are recorded as notes in the files concerned.
- The gate now checks the three artefacts against each other: every section has fields and markup,
  each variant is a select field with the same options, a select's default is one of its options,
  a condition names a sibling field, and sibling names are unique. The carousel's variant field is
  `cardStyle`, as the fields file names it.

