# Changelog — @lightlysaltedhq/salt-contract

Newest first. Dates are DD/MM/YYYY. What each part of a version means, and how a breaking change is
announced and migrated, is in `RELEASE-POLICY.md`. Decisions cited as `SC-nnn` are in Lightly
Salted's decision log for Product Salt.

## Unreleased (0.1.0, drafting)

- The owner's rulings of 09/10/2026 (SC-007, SC-008) are applied, and no open question remains;
  the markup schema drops the `open-question` note topic.
  - An id an editor set is never changed by a generated one. `section#anchors` settles ids at
    render in three steps: the reserved document ids, then editors' anchors (one that equals a
    reserved id takes the suffix, SC-008), then generated ids in the page body, such as
    `<section id>-heading`, form and tab ids and the service view's heading ids. The ids the
    header, footer and consent panel draw are reserved forms, since neither platform draws them
    with sight of the page's sections. A suffix counts up until the id is unique on the page, so `main`
    beside an explicit `main-2` renders `main-3`; it is applied at render and never stored.
  - The post, service, archive and search view bodies are fixed as Salt for Next.js's example app
    writes them (`salt-post__*`, `salt-service__*`, `salt-related`, `salt-archive__*`,
    `salt-search__results`). The post's author is the shared `author-box` component, and Salt for
    Next.js owes the rename (SC-008).
  - Locations' open-now status carries `data-hours`, `data-timezone` and `data-labels` for a script
    that recomputes it on load.
  - An image is one `img` with `srcset`, `sizes`, `width` and `height`, never `picture`.
  - `contract/sections.json` lists the icon names both platforms draw under `icons`, split into
    content and chrome. A platform may draw the shared `globe` glyph for a social mark it does not
    ship, with the platform in the link's accessible name (SC-008).
  - The section has no container element.
  - Salt for WordPress's `owes` records each change, including its `picture_sources` opt-in and the
    glyphs `chevron-right`, `external-link`, `moon` and `sun`.
- The header fixes every id it draws: `site-navigation` and `salt-header-nav-submenu-<n>` in the
  bar, with `-drawer` after each prefix in the drawer. The footer's column ids are
  `salt-footer-column-<n>` and the consent panel's are `salt-consent-*`; all are reserved. A footer social link with no glyph carries
  the profile's name as text.
- `contract/sections.json` declares component variants (card's `style`), and the gate refuses
  component markup that describes a variant or option its entry does not declare, a vocabulary
  variant that offers a value twice or defaults outside its options, an icon name `icons` does not
  list (in attributes or `dataAttributes`), and an icon field whose default is not a content name.
- The sections schema drops `openQuestions`.
- Locations' open-now rule states one order, hours carried past midnight included.
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
  to the field schema; the gate refuses one that names a group, list, collection-query or link,
  which ACF conditional logic cannot target. The background image's fit, position and tint, and
  the tabs and carousel screen-reader names, use it. Pricing stays an edge recipe on both
  platforms. A section anchor that is one of the ids main, content, header, footer, nav,
  site-navigation, search or skip-link, an id the page itself uses, or a repeat takes a numeric
  suffix. The divider draws above the section; a full-bleed hero sets its words over the
  section's background image; the collection-showcase source has no default; team members carry
  categories on both. In the markup, a quote card names its person with a heading; team cards
  carry optional email, phone and social links; the consent banner is drawn only when an
  integration needs consent; share links are same-tab text links; a single flat footer menu is
  one untitled column; the header carries `data-sticky` and its main navigation the id
  `site-navigation`; the contact section keeps an optional form intro; the contact form shows a
  privacy line and, beside a captcha, an arithmetic fallback inside `noscript`; `data-maplibre`
  leaves the map. Each platform's `owes` says what it must change. Left as work: the view body
  classes for archive, post, search and service; which icon names ship; whether locations'
  open-now status moves to the client; picture elements; and a check that no WordPress site
  styles the section's container div.
- The gate now checks the three artefacts against each other: every section has fields and markup,
  each variant is a select field with the same options, a select's default is one of its options,
  a condition names a sibling field, a filled condition names no group, list,
  collection-query or link, and sibling names are unique. The carousel's variant field is
  `cardStyle`, as the fields file names it.

