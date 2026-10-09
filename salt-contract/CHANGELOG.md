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
  (testimonials as a slider into `carousel`). Its three open questions are ruled (SC-006).
- `contract/fields/` (`./fields/<section>`, schema `./schema/field-definition`): every section's
  editor fields, and the section settings every section shares, in one platform-neutral form
  each implementation will generate its fields from. Field types are only those Payload and ACF can
  both express. Where the platforms differed, one canonical definition is chosen and each
  platform's former name and stored value is recorded with what it owes. The nine open questions
  once listed in the schema's description are ruled (SC-006).
- `contract/markup/` (`./markup/<id>`, schema `./schema/markup`): element order, `salt-*` classes,
  data attributes, heading rules, zero state and priority media for all 17 sections, 29 components
  and 7 views. The shared accessibility rules are written once in
  `markup/section`. Every `salt-*` class in salt-nextjs's four section and component stylesheets
  appears on a contract element. Notes marked `open-question` now record only the work SC-006
  leaves open.
- The owner's rulings of 08/10/2026 (SC-006) are applied. A field condition may test whether a
  sibling is filled (`{ "field": "…", "filled": true }`, or `false` for empty), a MINOR addition
  to the field schema that the gate checks (it may not name a group, list, collection-query or
  link, which ACF conditional logic cannot target); the background image's fit, position and tint, and
  the tabs and carousel screen-reader names, use it. Pricing stays an edge recipe on both
  platforms; a section anchor that is one of the ids main, content, header, footer, nav,
  site-navigation, search or skip-link, or an id the page itself uses, takes a numeric suffix; the divider draws above the section; a full-bleed hero
  sets its words over the section's background image; the collection-showcase source has no
  default; team members carry categories on both. In the markup, a quote card names its person
  with a heading; team cards carry optional email, phone and social links; the consent banner is
  drawn only when an integration needs consent; share links are same-tab text links; a single
  flat footer menu is one untitled column; the header carries `data-sticky` and its main
  navigation the id `site-navigation`; the contact section keeps an optional form intro; the
  contact form shows a privacy line and, beside a captcha, an arithmetic fallback inside
  `noscript`; `data-maplibre` leaves the map. 12 elements and four classes are added, and each
  platform's `owes` says what it must change. Left as work: the view body classes for archive,
  post, search and service; which icon names ship; whether locations' open-now status moves to
  the client; picture elements; and a check that no WordPress site styles the section's
  container div.
- The gate now checks the three artefacts against each other: every section has fields and markup,
  each variant is a select field with the same options, a select's default is one of its options,
  a condition names a sibling field, and sibling names are unique. The carousel's variant field is
  `cardStyle`, as the fields file names it.

