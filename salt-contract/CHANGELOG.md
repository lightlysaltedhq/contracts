# Changelog — @lightlysaltedhq/salt-contract

Newest first. Dates are DD/MM/YYYY. What each part of a version means, and how a breaking change is
announced and migrated, is in `RELEASE-POLICY.md`. Decisions cited as `SC-nnn` are in Lightly
Salted's decision log for Product Salt.

## 1.0.0 (candidate `1.0.0-rc.9`, prepared 23/11/2026; not published, dated when tagged)

**Semver call: MAJOR, the first release of the contract.** No earlier version was published, so no
implementation conformed to one. Adopting it is still a migration for existing sites, because the
contract renames and folds what Salt for WordPress 5.0.0 and Salt for Next.js 0.11.0 store (below,
*What a site does*). From 1.0.0, each change's part is decided by `RELEASE-POLICY.md`: section 1's
test, applied through section 2's table, where the stricter row wins.

### Added

- The vocabulary (`./sections`): 17 sections (hero, rich-text, call-to-action, media-text,
  features, stats, logos, gallery, process, faq, tabs, collection-showcase, carousel, listing,
  contact, locations, pricing), 29 components and 7 views, each with what each platform calls it
  today.
- Field definitions (`./fields/*`): every section's editor fields and the shared section settings,
  in one platform-neutral form, with each platform's former name and stored value (`formerly`) and
  what it must change (`owes`). The Payload and ACF emitters (`./emit/payload`, `./emit/acf`)
  generate each platform's half from them, byte-stable, with a drift check for the consumer.
- What the Payload drift check leaves to the consumer (SC-023). `PLATFORM_ADDITIONS` in
  `emit/payload.mjs` names the keys a consumer may add to a field: `admin.components`,
  `admin.initCollapsed`, `admin.layout` and `hooks`. `checkPayloadSnapshot` leaves out exactly
  those, on a field at any depth, and compares everything else byte for byte, so any other added
  key and any change to a generated one still fails. An `admin` holding nothing compares as an
  absent one. Admin conditions are not compared in 1.0.0: a condition is a function and is in
  neither snapshot. The check sees the clauses a field records under `custom.salt.condition`,
  and fails a snapshot that drops, adds or changes them; it does not see whether a field has an
  `admin.condition`, or what it does. A comparison may arrive in a later minor.
- The contract says which selects are radios (SC-023). The field schema's select gains an
  optional `control`, whose one value is `radio`; both emitters draw such a select as a radio
  (Payload `radio`, ACF `radio`) with a select's options, default and stored value. A link's
  `type` is the one radio; a collection-query's `mode` is a select, like every other select. A
  radio needs a default or to be required. Its layout is the platform's (`admin.layout` on
  Payload). Where a platform draws another widget today, the field's `owes` records it: Salt for
  Next.js a radio for a query's mode, Salt for WordPress a button group for a query's mode and
  for the gallery's and the showcase's columns.
- Postgres enum types, one per vocabulary (SC-023, after Salt for Next.js's BD-035). Selects that
  offer the same values share one type, named in `VOCABULARIES` in `emit/payload.mjs`:
  `enum_grid_columns`, `enum_button_style`, `enum_alignment` and `enum_media_side`. The site's
  icons keep one type per select. Where Salt for Next.js 0.11.0 named a select's type otherwise,
  the field records the former name as `platforms.nextjs.formerlyEnum`, a new optional key of the
  field schema's platform note, keyed by part for a collection-query: 12 records carrying 17
  former names.
- The `settings.anchorId` description states the slug rule in plain words, with no WordPress
  function name and no file path (SC-023). The rule itself is unchanged, in `markup/section.json`.
  No description an editor is shown cites a decision, a file or a platform function:
  `settings.toneDark` and the carousel's `cardStyle` are reworded too, and a test holds every
  emitted description to it on both platforms.
- Markup (`./markup/*`): element order, `salt-*` classes, data attributes, ids, heading rules,
  zero states and priority media for every section, component and view, and the page skeleton.
- The shared stylesheets (`./styles/*`): base, sections, primitives, blocks, chrome and views, and
  `styles/salt.css`, the one minified bundle both platforms serve verbatim after Tailwind v4's
  stylesheet. No colour literals; colours come from the token layer (`./token-layer`).
- Extension points: four dials (`./dials`: corners, shadows, button style, density) mapped to
  token-layer tokens and set per site in `salt-overrides.json`; view props per section
  (`./view-props/*`); the replaced-logic format (`./schema/replaced-logic`).
- Image sizes (`./image-sizes`): each slot's `sizes` per band and column count, the candidate
  widths, and the srcset capped at the upload's intrinsic width (SC-016).
- Fixtures (`./fixtures/*`): 129 cases with their expected HTML, for the 17 sections, the site
  header and footer, the post, service, case-study, archive, search and not-found views, and the
  page (SC-018, SC-019, SC-021); and the normaliser both sides are compared through
  (`./normalise`).
- Three fixture conventions the first conformance run settled (SC-023). Rich text is given in its
  stored form in a view as in a section: `post/full`'s body holds the stored `h3`, drawn as
  `h2`, and the gate refuses any other heading level in a view's document. A collection is drawn
  in its stored order: a case's `collections` are already ordered, an adapter passes them through,
  and the contract names no sort (`collection-showcase/grid-team-contacts`). The archive and search
  views' pagination is compared without the shape of its addresses, which is routing and stays
  native (SC-003): the runner reads both sides of those views' cases through `routedOf` in
  `normalise.mjs`, which writes each pagination link's `href` as `{{salt:page-href}}`, as
  `archive/topic`'s and `search/results`'s expected HTML do; which links are drawn, their order,
  labels, `rel`, `data-step` and `aria-current` still compare, and a link with no address
  differs. A listing section's pagination compares whole.
- Three rulings on the run against `1.0.0-rc.2` (SC-024). A framework's own attributes on an image
  are not masked: `next/image`'s `data-nimg` and inline `color:transparent` differ, and
  `markup/media.json` records that Salt for Next.js owes its own `img`. The footer's consent
  control is drawn `aria-disabled="true"` until script hydrates and not after:
  `markup/site-footer.json` declares the attribute its note already described, four footer fixtures
  and the four page fixtures expect it, and `consent-panel-open` does not, since only script
  opens the panel. The gate reads the case's `state`: the attribute is refused where
  `consentPanelOpen` is true and required everywhere else. Each state says how the element it
  concerns is drawn, so `drawerOpen` and `themeScheme` say nothing of this control. The gate
  requires each panel's dialog if and only if its state says it is open (`consentPanelOpen`,
  `drawerOpen`). It refuses a `state` that is no object, a state key the README's `state` row
  does not document and a panel's state that is not `true` or `false`, and fails when the states
  it knows and that row disagree. An icon's `fill` and `stroke` are artwork,
  like what is inside it (SC-007): the normaliser drops both from `svg.salt-icon`, so a filled
  mark passes against a stroked fixture, while the svg's every other attribute still compares and
  the gate still holds each of the two to the values `markup/icon.json` allows.
- Seven rulings from bringing Salt for Next.js's core markup to `1.0.0-rc.3` (SC-025), six of
  which change the contract. A section that draws no heading has body base 1, wherever it sits on
  the page, so its body headings and card titles are `h2` and no rank is skipped
  (`section#body-heading-base`); `rich-text/body-only-no-heading`, `carousel/inline-no-name-list`,
  `carousel/inline-quote-label-inverse` and `pricing/one-plan-inverse`, four fixtures, rise a
  level. `markup/pricing.json` declares `headingBeforeOwn`, as every section that can draw a
  heading with none of its own does, which is what puts the page's `h1` first. The gate fails a
  body whose first heading is not base + 1, a title that is not base + 1, a rank skipped on the
  way down a rich-text body, and a section that draws headings with none of its own and no
  `headingBeforeOwn`. A case study's result in a showcase is
  one `stat` string, as the view props have it: `collection-showcase/featured-case-studies` no
  longer splits it into a value and a suffix span. The contact form's challenge field and its two
  tokens come from the form's own response to a send, never from the page as first drawn, so a
  contact page can be cached: `contact/form-open` loses them, `markup/contact-form.json` says
  when they are drawn, and without script the endpoint answers in its own response and never by
  redirecting back to the page. An anchor an editor typed is settled before any id is minted
  (`section#anchors`), so an unanchored section never takes an editor's name, and a minted id is
  numbered over the stored layout, counting sections that draw nothing, so it does not move when
  one above it empties or fills. The phone and email
  links in the contact details and the link in the privacy line carry `salt-contact__link`, which
  `styles/primitives.css` underlines in the band's own ink and gives the focus indicator (WCAG
  1.4.1), so `styles/salt.css` changes and each implementation serves the new bytes. Of the
  header's two logos only the default scheme's is `loading="eager"`; the other scheme's is lazy.
  The other ruling changes no file: a team member's email, phone and social links are drawn
  only when filled, as `markup/card.json` already says.
- Two rulings change the contract after `1.0.0-rc.4` (SC-026, SC-027). The team source has no
  categories, on either platform (SC-027): `contract/sections.json` gives team `categories` false
  in the collection-showcase and the carousel, so a team query offers the automatic and manual
  modes only, with no categories picker, as testimonials do. Both emitters follow from that
  answer, and `SOURCE_DEFAULTS` names no taxonomy for team (`departments` on Payload and
  `department` on ACF are gone); a taxonomy a site names for team gives it no by-category mode.
  Salt for Next.js no longer owes a team taxonomy: a member's job title and department stay free
  text. Salt for WordPress owes dropping by-category and the department picker from its team
  layout's query, which the ACF round trip records as one more difference (403). The priority
  image is the principal image of the first section on the page that has one, not of the first
  section only (SC-026): a page that opens with a text band gives `fetchpriority="high"` to the
  first image below it. That is a rewording of `section#priority-media`, and no fixture changes,
  since a case states its own priority context. The fixtures gate still requires a case at index
  0 to be granted the priority image, and no longer refuses a later section that holds it. No
  fixture case yet shows a later section taking the slot, so a conforming run does not prove
  SC-026.
- Two rulings change the contract after `1.0.0-rc.5` (SC-028). The drawer's close button draws the
  burger's three bars (`markup/site-header.json`'s `drawer-close`), which `styles/chrome.css`
  already turned into the cross at rest and animated from bars as the drawer opens; it had been
  drawn empty, so the rules had nothing to move. No stylesheet changes for it, and
  `site-header/drawer-open` draws the bars. The normaliser drops the children of `svg.salt-icon`,
  since artwork is each platform's own (SC-007), so a conforming run does not prove the bars; the
  markup file and the stylesheet name them. A team member's email and phone links on a card carry
  `salt-showcase__contact-link` (`markup/card.json`, where they were owed), which
  `styles/blocks.css` underlines in the band's own ink as `salt-contact__link` is (SC-025), and
  which both focus indicator lists in `styles/primitives.css` and `section#focus-ring` name. The
  social links keep `salt-showcase__social-link`. `collection-showcase/grid-team-contacts` draws
  the class. `styles/salt.css` changes, so each implementation serves the new bytes: 45,331
  bytes, SHA-256 `4f3bca26398e6153aa0eda8ad09e048bc48a1a63feb56606dd718d2098f907ec`.
- The owner's rulings of 18/11/2026 change the contract after `1.0.0-rc.6` (ID-3944, ID-3949,
  ID-3950; recorded with the decision log's next SC numbers when the log is written up). Each is
  part of the first major, so the semver call stays MAJOR; on its own, by `RELEASE-POLICY.md`
  section 2, each would be MAJOR too: new required fields and limits (ID-3944), a changed heading
  rule (ID-3950) and changed post markup (ID-3949).
  - **Collection fields** (`./collections/*`, `contract/collections/`): one file per item source
    (services, case-studies, testimonials, posts, team, faqs, locations) and three shared shapes
    (`_person`, `_address`, `_topic`), validated by the field-definition schema, which now
    describes a section, a collection or a shape. The names and limits are the rulings': flat
    person fields (`name`, `role` 80, `bio` 600, `photo`, `email`, `phone`, `socials` 0 to 10 as
    `{ name, url }`); a post's `author` a relationship to team; a post's `layout` limited to
    rich-text, media-text, gallery, call-to-action and faq (video waits for ID-3951);
    `publishedAt` a date and time; `topics` the one stored category name, with a post's
    `primaryTopic` and a topic's `description`; `summary` of 300 characters everywhere; the
    Next.js address names (`street` up to two lines, `locality`, `region`, `postalCode`,
    `country`); `lat` -90 to 90, `lng` -180 to 180, `zoom` 1 to 20 defaulting to 14; ratings 1 to
    5 in half stars; opening hours stored HH:MM; titles 120 characters; the ruled list sizes.
    `companyLogo`, the testimonial's `service` and the six unread extras are dropped (each file's
    `dropped`). Every field records each platform's `formerly` and `owes`; a field WordPress keeps
    in its own place (title, body, excerpt, featured image, categories, date) says so in
    `platforms.wordpress.native`.
  - **The schema** gains the types `topics`, `date-time`, `time` and `sections`, the text format
    `email`, a textarea's `maxLines`, a group's `shape`, and a collection's `display`: which
    stored field fills each part of its card, FAQ item or office. The package gate refuses a
    release that ships a `draft` display; the owner approved every collection's mapping on
    18/11/2026, so each is `approved`.
  - **The socials host table** (`./socials`, `contract/socials.json`): which host means which
    network, with an example address for each, from Salt for Next.js's table; Salt for
    WordPress owes the hosts its own lacks.
  - **Emitters.** `emit/acf.mjs` adds a group per installed collection, located on its post type,
    generating no field for what WordPress stores natively (named under `salt.native`), and a
    Settings tab, storing nothing, before every layout's `settings` group. `emit/payload.mjs`
    adds `toPayloadCollections`, `payloadCollectionsSnapshot` and
    `checkPayloadCollectionsSnapshot`. The page blocks' and layouts' output is otherwise
    unchanged, apart from rich text's headings.
  - **Headings 2 to 6** (ID-3950): rich text's `body` allows `heading-2` to `heading-6`, and
    `section#body-heading-base` says how a stored level draws: the highest-ranked heading in a
    body at base + 1, the others keeping their distance, a skipped rank closed up, nothing below
    h6. A body storing only h3 and h4 draws as before. A view's document may now hold h2 to h6.
    Two rich-text fixtures show it.
  - **Sections in a post** (ID-3949): `section#sections-in-a-post` and `markup/post.json` say how
    a post's layout draws. A rich-text section that is prose alone draws bare in the article; every
    other section draws as a band, as on a page, with the shared `width` setting and its heading at
    h2 under the post's h1. Four fixtures (`post/band-*`) show a band of each other allowed
    section after prose, a single image as a gallery of one among them.
  - The service, case-study and post fixtures' comments point at the collection files in place
    of describing the documents. `scripts/round_trip_acf.mjs` matches a layout by its contract id
    as well as its former names, which salt-wordpress now ships; both round-trip reports are
    regenerated.
- The founder's rulings of 18/11/2026 and 19/11/2026 change the contract after `1.0.0-rc.7`
  (ID-3968, ID-3969, ID-3970). Each is part of the first major, so the semver call stays MAJOR. On
  its own, by `RELEASE-POLICY.md` section 1's test, the limits rule would be MAJOR: until now the
  contract did not say how a limit is held, and from this candidate an implementation that refuses
  a draft, cuts what an editor wrote (as the browser's `maxlength` attribute on ACF's input does)
  or refuses text over its target no longer conforms. Turning a limit into a target loosens it,
  and adding the `target` keyword is a new optional schema keyword: each MINOR on its own. The
  service example's change is PATCH: an implementation that drew the old case correctly draws the
  new one.
  - **The limits rule** (ID-3968; 18/11/2026, amended 19/11/2026). The field schema states it in
    its own words and in every limit keyword's description, and `RELEASE-POLICY.md` section 2
    states it: *A limit never stops a draft from saving and never cuts what an editor wrote: the
    editor sees it as they edit, and it is checked when content is published. A write from outside
    the editor (the API, an import, code) that breaks a limit is refused with a message to whoever
    sent it. A length or a number the design only prefers is a target, shown to the editor with a
    count and never refused, by the editor or by any other write. A value over its target or its
    limit is always drawn in full, never cut off or clamped.* As accepted on 18/11/2026 a write
    that could not show an editor the message was refused or stored and flagged; on 19/11/2026 the
    founder ruled that such a write breaking a limit is refused with a message and one over a
    target saves, so nothing is left stored and flagged and the rule no longer says it. The rulings
    of 19/11/2026 also say: a list at its maximum may refuse to add a row, with a message; every
    length and target counts Unicode code points, a CRLF as one (the fixtures gate counts so);
    checks that are not limits (email and url formats, the time field, pricing's one featured plan,
    a rating's half steps) follow the same rule, a draft always saving and publishing checked, and
    the schema, `pricing.json` and the url owes now say *on publish* in place of *on save*; a value
    over its target or limit is drawn in full; and this editor behaviour counts towards
    conformance, checked by each platform's own tests, not by `salt-conformance`.
  - **Which numbers stay limits** (the founder's ruling of 19/11/2026: *target only for all
    platforms*, except what a page breaks without). These stay checked limits, unchanged: the tabs'
    8, the buttons' 2 (the call-to-action's, the hero's and a media-text row's), a rating's 1 to 5,
    a location's `lat` (-90 to 90) and `lng` (-180 to 180), and its map `zoom` (1 to 20). These
    stay as they were, with no soft version: a street's two lines (`maxLines`), a rating's half
    steps from 1, the minimum of one on a list that has one (a service's benefits, a case study's
    results and gallery), and a collection-query's count, 0 to 24. Every other number is now a
    target, its `maxLength` or `max` renamed to `target` and its number unchanged:
    every section's `intro` (300: carousel, collection-showcase, contact, faq, features, gallery,
    listing, logos, process, stats, tabs); a service's `title`, `summary` (300), `benefits` (12)
    and `relatedServices` (6); a case study's `title`, `summary` (300), `gallery` (24), `results`
    (6) and `details` (12); a post's `title` and `summary` (300); an FAQ's `question` (120); a
    location's `title` (120) and `hours` (14); a testimonial's `name` (120) and `role` (80); a
    person's (a team member's) `name` (120), `role` (80), `bio` (600) and `socials` (10); and a
    topic's `title` (120). The help text of the list fields that said *up to* now says *aim for no
    more than*. No field carries a `maxLength` any longer.
  - **Targets** (ID-3969; 18/11/2026 and 19/11/2026). A text, textarea, list, gallery or
    relationship may carry `target`: one number, or an ascending pair `[hint, target]`, the gate
    refusing a pair whose hint is not the lower. It is shown with a count and never refused. A
    title whose record has a page of its own (a service, a case study, a post) carries `[60, 120]`:
    the count notes a title past about 60, measured with the site name joined as the page's
    `<title>` draws it, and more strongly one past 120, and neither blocks. An FAQ's question, a
    testimonial's and a team member's name, a location's title and a topic's name show the 120
    only (19/11/2026). ACF records a target under the field's `salt.target`, and the title's and
    summary's that WordPress stores in its own place under the group's `salt.targets`
    (19/11/2026); Payload under `custom.salt.target`. Neither is a setting that refuses anything,
    so a target draws no length attribute on either platform. `RELEASE-POLICY.md`: changing a
    target's numbers is PATCH; adding or removing one, or turning a limit into one, is MINOR
    (19/11/2026).
  - **What each platform owes.** Salt for WordPress: a count beside every target; a draft always
    saving, on an options page and a term screen too; an outside write (REST, import) that breaks
    a limit refused with a message and one over a target saved (lifting WordPress's own REST
    refusal is its detail, 19/11/2026); the remaining limits held by ACF's own `min` and `max`,
    which ACF checks on publish; and the other checks made on publish. With JavaScript off, a
    failed update drops ACF's fields silently: a known gap the founder accepted on 19/11/2026.
    Salt for Next.js: a draft always saves, by whatever means (19/11/2026); every count in code
    points with a CRLF as one, where Payload's `maxLength` counts UTF-16 units; the title's two
    notes; an outside write that breaks a limit refused with a message, and one over a target
    saved. Each section intro owes its 300 as a target in place of Payload's `maxLength`, which
    the Payload round trip now lists (11 expected differences).
  - **The service example** (ID-3970, 18/11/2026). `service/full`'s intro allows no headings, so
    it is two paragraphs: the stored `<h3>How it works</h3>` and the `h2` it drew are gone from the
    case and its HTML, and the note in `markup/service.json` and the case's comments no longer
    speak of a stored `h3`. The intro's allowed list is unchanged.
  - **View-all addresses** (the founder's ruling of 18/11/2026: left to the platform, by the same
    principle on both). The showcase's `viewAll` view prop
    (`contract/view-props/collection-showcase.json`) says so: each platform builds the address its
    native way; a collection's view-all link points at that collection's own index (archive) page;
    and a collection with no index page draws no link. A description of a view prop, so no
    verdict changes.
  - Both emitters' output for a limit is as at rc.7. An ACF Pro 6.8.11 probe showed that ACF's own
    setting is what checks a limit on publish: with it removed nothing checked at all. The
    founder answered every question on limits and targets on 19/11/2026.
  - **Team members' pages** (19/11/2026). A team tick on the existing user makes their profile
    public. Posts credit users independently of the tick. Editors can maintain public profiles
    without managing accounts or roles; the public contact email never falls back to login email.
    A team member needs no admin access. Both platforms use one address, `/team/{slug}/`;
    bylines, author boxes and team cards link directly there, and existing public author URLs
    for that person redirect permanently (301). The public slug survives a display-name change.
    `team.json` no longer says team has no page, and the dropped `post_content`'s note says the
    page reads the `bio` field. The page's profile draws the role as the strapline, the bio, the
    photo, and the email, phone and social links as the team card draws them (`card.json`'s
    `contact` and `socials`, with their classes), each only when set; `archive/author` draws them.
    A member with no posts draws nothing where the listing would be, no heading and no empty
    message, on the author page only: the new case `archive/author-no-posts`. A team member's
    name carries `[60, 120]`, as the other titles of a page of their own do. No page lists the
    whole team: team has no index page, so a team section draws no view-all link (the `viewAll`
    field's help and view prop say so).
  - **Other rulings of 19/11/2026.** A post's topics are drawn with the primary topic first, then
    the rest A to Z by title (`markup/post.json`, `posts.json`), which is `post/full`'s order
    already. On a grouped index an entry under two or more topics is listed under each
    (`markup/collection-showcase.json`). The carousel's card style is shown only for the inline
    source, as its condition already says, so `carousel.json` is unchanged. By-category with a
    category that does not belong to the chosen source is refused on publish, with a message
    (both platforms' query owes in `carousel.json` and `collection-showcase.json`).
  - Team is a linked source for showcase and carousel. The Index layout can list members'
    individual pages; this neither creates a whole-team archive nor adds a view-all link.
- The rulings and proposals of 23/11/2026 change the contract after `1.0.0-rc.8` (EP-72 M4, Salt
  for WordPress's conformance; SC-029 to SC-032, with SC-033 and SC-034 below). The founder ruled SC-029's principle (no style
  attributes in the contract), both points of SC-030 and SC-031. SC-029's attribute design (the
  value sets, their steps and rounding, the fixed measure and the logo height's place) was approved
  by the coordinator, and SC-032's four sidebar parts come from Salt for WordPress's reading: both
  are proposed, for the founder's approval at contract review. Each is part of the first major, so
  the semver call stays MAJOR. On its own each of the first four would be MAJOR by
  `RELEASE-POLICY.md` section 1's test: markup an implementation drew correctly at rc.8 no longer
  conforms. **Breaking for both targets, Salt for WordPress (EP-72) and Salt for Next.js
  (EP-73)**; what each must change is listed under each item. Every stylesheet change below is in
  `styles/salt.css`, so both serve the new bytes when they move their pin.
  - **No inline style attributes** (SC-029). Salt for WordPress's Content-Security-Policy has no
    `'unsafe-inline'` for styles, so a browser ignored every `style="…"` the contract drew: bands
    lost their spacing, ratings did not fill and the case study's aside grid broke. Nothing the
    contract draws now carries a style attribute (`section#no-inline-style`); a value the design
    varies is a data attribute from a fixed set, styled in `styles/`. `markup.schema.json` refuses
    a `style` attribute in any markup file, and the conformance runner gains a fifth check,
    **inline styles**, which fails any element carrying one in an adapter's output, in every case,
    with its own column in the report. The fixtures drew 87 style attributes; none remains. The
    attribute design below is proposed, for the founder's approval at contract review.
    - A band's spacing: the style goes, and `sections.css` sets `--salt-section-space` from the
      `data-spacing` the band already carries (sm, md, lg; none draws none). This covers the case
      study's header band.
    - The scrim: `data-strength` (subtle, standard or strong, the setting's three) on
      `div.salt-section__scrim`, which `sections.css` maps to `--scrim-<strength>`.
    - A background image: `data-fit` (cover or contain), always written, with cover the
      stylesheet's default; and the position as `data-focal-x` and `data-focal-y`, each 0 to 100
      in steps of 5 (42 rules), mapped to `object-position` through `--salt-focal-x` and
      `--salt-focal-y`, the centre when neither is written (`section#background-position`). A
      stored focal point snaps on each axis to `min(100, max(0, 5 × floor(v ÷ 5 + 0.5)))`, so a
      value halfway between two steps takes the higher (32.5 gives 35). The nine named positions
      take their steps (left and top 0, centre 50, right and bottom 100). Both are left out only
      for the focal-point position with no stored focal point. The new cases
      `hero/full-bleed-background-focal-snapped` (32.5 and 2.4 draw 35 and 0) and
      `hero/full-bleed-background-named-position` (top right draws 100 and 0) show it.
    - A rating: `data-fill` on `span.salt-showcase__stars`, 0 to 100 in steps of 10, which
      `blocks.css` maps to `--salt-rating-fill`: the rating ÷ 5 × 100 rounded to the nearest
      step, halves up, held to 0 to 100. A stored rating (1 to 5 in half stars) always lands on a
      step; the new case `carousel/testimonials-half-star` draws 4.5 as 90. The fixtures gate now
      compares each quote's fill and rating label with its item, and every drawn label with the
      site's.
    - The case study's image aside: `data-aside-rows` (1 to 4) on the article, with the measure
      fixed in `primitives.css`. Withdrawn later in this candidate with the image aside itself
      (SC-034, below): neither attribute, property nor measure remains.
    - The logo's height leaves the markup. `chrome.css` keeps `--logo-height: 2rem` on
      `.salt-logo`, and a site that sets a height sets it once, site-wide, in its own stylesheet
      loaded after `salt.css` (`.salt-logo { --logo-height: 48px; }`). `site.logoHeight` stays a
      case's input, since the logo's `sizes` are computed from it.
    - `contract/token-layer.json` drops `writes` and the five properties the markup used to write
      (`--salt-section-space`, `--salt-scrim-alpha`, `--salt-rating-fill`,
      `--salt-case-study-view-aside-rows`, `--salt-case-study-view-measure`), which the
      stylesheets now set themselves. The stylesheet gate's value maps, which filled a
      `<placeholder>` in a written style from a setting's options, are removed with the schema's
      `writes`: the markup writes fixed values only, and the gate refuses a placeholder in one.
      The one style element the contract draws, the scriptless style in the head, stays; a target
      with a strict Content-Security-Policy allows it by a hash or a nonce and keeps its contents
      byte for byte (`page.json`).
    - **What each target changes.** Both: draw no `style` attribute anywhere; write the data
      attributes above; serve the new `salt.css`. Salt for Next.js: drop the inline
      `--salt-section-space` on every band and the case study's header band, `--salt-scrim-alpha`
      on the scrim, `--salt-rating-fill` on the stars, the aside's two properties (its `measure`
      prop leaves the markup), and `<SiteLogo>`'s `--logo-height` (the brand global's height goes
      to the site's stylesheet); `objectPosition()` writes the data attributes in place of
      `object-fit` and `object-position` inline, and no image keeps next/image's inline style. Salt
      for WordPress: the same attributes in place of the same inline styles, and the logo height
      from its brand options into its own stylesheet.
  - **The footer's consent control is optional** (SC-030). `div.salt-footer__consent`, the
    control and its status line, is drawn only when the site has a consent mechanism wired: on
    Salt for WordPress an active WP Consent API plugin, on Salt for Next.js its consent store with
    an integration that needs consent. A case's `site.consent` says one is wired, and the gate
    requires the control exactly when it is. The new cases `site-footer/consent-wired` and
    `site-footer/consent-not-wired` show it with and without; `columns-socials-copyright` gains
    the `site.consent` its comment described, and the seven other cases that drew the
    control with no mechanism wired (`display-preferences`, `single-flat-menu-inverse`,
    `theme-toggle-button` and the four page cases) no longer draw it. **One condition for the
    banner and the control** (proposed, for founder approval at contract review): both are drawn
    only when the site runs an integration that needs consent, and on Salt for WordPress only
    when a WP Consent API plugin is also wired; without one, WordPress keeps every such
    integration denied, failing closed as `salt_consent()` already does, and draws neither. A
    wired mechanism with no category in use draws no control, no banner and no panel, so
    `site.consent.categories` may now be empty, and the gate requires the control only when it
    is not; the new case `site-footer/consent-no-categories` shows it. **What
    each target changes.** Both: draw the banner and the control on that one condition. Salt for
    WordPress: only when `wp_has_consent` exists, denied otherwise.
  - **The consent panel's boxes are grouped by WP Consent API category** (SC-030). One box per API
    category the site's integrations use, in the API's order (functional, preferences,
    statistics, statistics-anonymous, marketing), its id, name and `<category>` the API category,
    and ticking it sets every Salt category in its group: analytics is the statistics box, and
    embeds, marketing and WordPress's own `maps` share the marketing box. Only an API category a
    Salt category maps to can be a box, statistics and marketing, so functional and preferences
    are refused; `statistics-anonymous` is never drawn, and is written with the statistics box's
    verdict (proposed, for founder approval at contract review). The gate checks the open panel's
    boxes even when it draws none, and the new case `site-footer/consent-panel-maps` is a
    WordPress site with a map. No two boxes share a setting, so the hydrated WordPress
    panel's *Shares one setting with …* note goes. `site.consent.categories` gains `covers`, and
    the gate checks the order, the ids and that each Salt category is in the box its API category
    names. `consent-panel-open` draws `site-footer__consent-statistics` where it drew
    `-analytics`. **What each target changes.** Salt for Next.js: two boxes (statistics,
    marketing) in place of three (analytics, embeds, marketing); its cookie keeps Salt's
    categories. Salt for WordPress: boxes from `salt_consent_api_category`, one per API category.
  - **Labels carry their values as named placeholders** (SC-031). The contract drew some values by
    replacing a placeholder (`readTime`, the search's `results` and `noResults`) and others by
    appending to a prefix (`slide`, `rating`, `directions`, `byline`, and in the listing and
    archive cases `page`). Every label that carries a number, a query or a name now uses named
    placeholders, replaced where they stand, so a translation places the value itself; README
    *Labels* states the rule once: the names (`{n}`, `{N}`, `{q}`, `{kind}`, `{name}`), that an
    unknown placeholder is drawn as written, and that a label without one is drawn as written with
    nothing appended, so no label has anything appended. The markup notation lists them:
    `labels.page ({n})`, `labels.slide ({n}, {N})`, `labels.rating ({n}, {N})`,
    `labels.readTime ({n})`, `labels.results ({n}, {q})`, `labels.noResults ({q})`,
    `labels.kind ({kind})`, `labels.directions ({name})` and `labels.byline ({name})`; the
    byline's `{name}` is the author's name as text or the link to their archive. The fixtures give
    `Page {n}`, `Slide {n} of {N}`, `Rated {n} of {N}`, `Directions to {name}` and `By {name}`;
    no expected HTML changes. The new case `carousel/testimonials-labels-as-written` draws a slide
    label with no placeholder (`Slide`) and a rating label with an unknown one (`{stars}`), each as
    written. Three cases put the placeholder first, so a renderer that strips it and appends the
    value fails: `listing/page-number-first` (`{n}. page`), `locations/directions-name-first`
    (`{name}: directions`) and `post/byline-name-first` (`{name} wrote this`). The fixtures gate
    compares each placeholder with the value the case gives where it gives one (the page's
    number, the office's and the author's names, the reading time, the results' count and the
    query); `{kind}` matches any text. 129 cases in all. **Breaking for both targets.** **What each
    target changes.** Both: replace the placeholders in those nine labels and append nothing; a
    site's `page`, `slide`, `rating`, `directions` and `byline` labels hold their placeholders
    (`Page {n}`, `Slide {n} of {N}`, `Rated {n} of {N}`, `Directions to {name}`, `By {name}`).
  - **The case study's sidebar parts are defined** (SC-032; proposed, for the founder's approval
    at contract review; superseded in this candidate by SC-034, which removes the image aside
    they counted). *Media aside, an image and a sidebar part* now says which parts are
    sidebar parts: exactly the challenge (filled), the solution (filled), the gallery (with an
    image that resolves) and the live-site link (a safe URL), the four Salt for WordPress counts
    and the gate already counted. The header, results, details and delivered services never are.
    `data-aside-rows` is how many are drawn. No verdict changes.
- A rendering rule closes the first body heading's gap (`section#body-heading-base`, after
  `1.0.0-rc.8`). The no-skipped-rank rule now covers a body that stores only h3 or h4, with the
  body base as the rank before the first heading: under a section heading at h2, stored h3 then
  h4 draw h3 then h4, and stored h4 then h3 draw h3 then h3. Stored ranks and the editor's
  picker do not change. The new case `rich-text/h4-first-under-h2` shows it. **What each target
  changes.** Both: draw a body's first heading at most one rank below the body base.
- The shared stylesheets supply every rule the markup owed (the founder's ruling of 23/11/2026,
  option A). Fourteen markup files recorded classes they drew with no rule (`stylesheet-owes`), and
  a platform that matched the fixtures byte for byte served them unstyled: Salt for WordPress drew
  *Bristol studioOpen now* with no gap. `blocks.css`, `chrome.css` and `views.css` gain rules for
  the 50 classes that had none, structural only (layout, spacing, gaps, alignment, text roles and
  the band's own ink and hairline from existing tokens), and the 14 `stylesheet-owes` notes go,
  with the 19 classes `views.css` already styled. The markup schema drops the `stylesheet-owes`
  topic, and the stylesheet gate now requires the other direction too: every class the markup puts
  on an element is drawn by a rule, or its markup file declares it a hook kept with no rule. A rule
  draws a class only when the class is in its selector's subject (not an ancestor, and not inside
  `:not()` or `:has()`), declares something, and is not for print alone. A hook may have no rule of
  its own, and its reason may not say a rule is owed. So two hooks that recorded a debt became
  rules: the skip link (`salt-skip-link`), visually hidden until it takes focus, then drawn at the
  top of the viewport above the sticky header with the focus ring, and the share row's optional
  heading (`salt-share__heading`, the `label` role). Nine classes styled only through their
  children or state are declared hooks with their reasons: `salt-case-study-view__section`,
  `salt-hero__text`, `salt-logos`, `salt-media-text__body`, `salt-post__breadcrumb`,
  `salt-post__byline`, `salt-tabs__input`, `salt-pricing` and `salt-pricing__price` (the price
  line stays running text, so its amount and period keep the markup's space and read as one
  phrase copied, spoken or unstyled). No markup or
  fixture changes. The visual choices (measures, gaps, which text role each part takes, the map
  facade's 16:9 box) are proposed, for founder approval at contract review.
  - Classes that gained rules: `salt-locations`, `__name`, `__status`, `__office`, `__address`,
    `__line`, `__contact`, `__directions`; `salt-opening-hours`, `__day`, `__span`; `salt-map`,
    `__label`, `__load`; `salt-pricing__plan`, `__badge`, `__amount`, `__period`, `__features`;
    `salt-contact__details`, `__organisation`, `__address`, `__line`, `__privacy`;
    `salt-showcase__contact`, `__socials`, `__social-link`; `salt-footer__copyright`;
    `salt-display-preferences`, `__panel`, `__summary`, `__controls`, `__group`, `__label`;
    `salt-post`, `__header`; `salt-service`, `__header`, `__benefits`, `__price`, `__cta`;
    `salt-related`; `salt-search__results`; `salt-archive__bio`; `salt-author-box`, `__body`,
    `__label`, `__bio`; `salt-skip-link`; `salt-share__heading`. `salt-post__adjacent` gains the
    post's measure.
  - A post's and a service's parts that are not section bands are centred at the reading measure
    inside the gutter, the service's related cards at the default band's; a band in a post keeps
    its own width. The map's facade is a 16:9 flex box on `--salt-section-border` and
    `--radius-md`, its label with no margin. What script draws into it, a notice and the map's
    canvas, is not in the markup, so it is styled where it is drawn (Salt for WordPress's own
    stylesheet) until a markup change records it.
  - Sixteen of the classes are now flex or grid containers, so `normalise.mjs`'s `CONTAINERS`
    gains them (`scripts/salt_normalise_containers.mjs --write`): white space between their
    children, which a browser does not draw, is dropped on both sides of a comparison. Nothing that
    matched before stops matching.
  - A team member's links on a linked card already sit above its stretched link, through
    `primitives.css`'s raise of every nested link (`.salt-card :is(a, …)`); `card.json`'s note said
    no rule did.
  - Not reached: the archive's and the search view's own headings and forms sit in unclassed
    elements, so they keep the platform's page measure; giving them the reading measure needs a
    class in the markup.
  - **Semver: MAJOR**, by `RELEASE-POLICY.md`'s stylesheets row: a change to how unchanged markup
    renders is MAJOR. It lands in the 1.0.0 candidate series as rc.9, so the semver call stays
    MAJOR. **What each target changes.** Both: serve the new `styles/salt.css`. Salt for
    WordPress may drop its own rules for these classes from `app.css`, keeping the map's notice
    and canvas.
- **The case study's image aside goes; the featured image is the hero and a new optional image
  sits in the flow** (SC-034; the founder's ruling of 23/11/2026, option 4B. The field's shape,
  the duplicate rule and the placement details are implementation details of that ruling, agreed
  with the coordinator). **Breaking for both targets.** Semver: MAJOR by `RELEASE-POLICY.md`
  section 1's test (rc.8 markup no longer conforms), in the candidate series as rc.9.
  - The featured image is the hero image: `div.salt-case-study-view__media` is the header's last
    part, inside `div.salt-section__content` when the header is a band, and it is the view's only
    priority image (role `hero-image`). Its sizes are the content slot, unbanded in a plain header
    and the default band's in a band.
  - A new optional collection field, `caseStudyImage` (one image reference: a WordPress attachment
    ID, a Payload upload; alt by the media's normal rules, no caption), drawn in
    `div.salt-case-study-view__flow-media` after the challenge's place and before the solution's,
    lazy, in the content slot. It is not framed: it keeps its own proportion at the content width,
    uncropped (a square photograph is drawn square), its width and height reserving the space; the
    hero's 16:9 frame and the gallery's 4:3 frames are unchanged. It keeps that place when the challenge, the solution or the
    featured image is absent, is never promoted to the hero, and leaves no wrapper when absent or
    unresolved. When both fields name one media item (by media identity, never alt text or file
    name) it is drawn once, in the hero. `featuredImage` and `gallery` are unchanged.
  - Removed: `data-media` and `data-aside-rows` on the article, the aside grid and its four rules
    in `primitives.css`, the site key `site.caseStudy.media` (and the ACF options page's aside
    layout), the `aside` and `aside-card` image slots (no other markup used them), and
    `--header-height` from `contract/token-layer.json`, which only the sticky aside read. Only the
    image aside goes: a separate sidebar of related details (sector, client, services) is not ruled
    out, and nothing about one is modelled or drawn until its fields and presentation are settled.
  - Fixtures: `case-study/aside` becomes `flow-only` (no featured image), and `full` (both images),
    `band` (the hero inside a band, no case-study image), `no-challenge`, `no-solution` and
    `duplicate` cover each image and each narrative section absent on its own. 132 cases in all.
    The fixtures gate checks each image's presence, place and media item, and its tests refuse a
    promoted, duplicated, misplaced or wrongly sourced image.
  - **What each target changes.** Both: draw the featured image last in the header, as the
    priority image; add the `caseStudyImage` field and draw it as above; drop `data-media`,
    `data-aside-rows` and the aside layout setting; serve the new `salt.css`. Salt for Next.js:
    the `media` prop and the aside sizes go. (Where the images sit and their sizes are revised by
    SC-036, below.) Salt for WordPress: the field as an ACF image returning an attachment ID, and
    the options page loses its aside layout.
- **Clients and sectors: two name-only record collections, each off by default** (SC-035; the
  founder's ruling of 23/11/2026; the identifiers and the fallback rules were set by the
  coordinator and are proposed, for the founder's approval at contract review). New collections
  `clients` and `sectors` (`contract/collections/`), each a `title` and nothing else, with no
  route, page or public address. A case study gains `sector` (free text, beside the unchanged
  `client`) and `clientRecord` and `sectorRecord`, one optional relationship each. Both emitters
  install `clients` and `sectors` only when a site names them in `sources`; left out, the case
  study's record field is left out too (`leftOut`), and the free text stays. Wherever the client is
  drawn (the card's meta, and the case study's aside, SC-036), the chosen record's name is drawn when
  clients is enabled and the record resolves, otherwise the free text, and nothing when both are
  empty. No new public slot, link or sidebar draws a sector or a record yet, pending the
  presentation ruling. No record is created, matched by name or deleted automatically, and
  switching a collection off writes nothing. Semver: MINOR on its own (optional fields and opt-in
  collections; the default output gains only the `sector` field); it ships in the rc.9 candidate.
  **What each target changes.** Both: the two switches, off by default; the `sector` field; the
  record fields while enabled, keeping a stored ID and the free text separately across switch
  changes, and offering the chosen name as the free text's initial value when a switch is turned
  off with no free text stored. Salt for WordPress: `client` and `sector` post types, not public,
  with no archive or rewrite. Salt for Next.js: `clients` and `sectors` collections with no route,
  kept permanently in its Payload config and switched at run time, so switching never changes the
  schema or drops a stored ID; the emitters' `sources` option is a WordPress-style install list,
  and Salt for Next.js passes both always.
- **The case study is a story column and an aside of the project's facts** (SC-036; the founder's
  ruling of 23/11/2026 on the layout; the class names, the slots and the label names are proposed,
  for the founder's approval at contract review). **Breaking for both targets.** Semver: MAJOR by
  `RELEASE-POLICY.md` section 1's test, in the candidate series as rc.9.
  - The article holds, in order, `header.salt-case-study-view__header` (back link, title and
    summary; in a band, inside its content), `div.salt-case-study-view__story` and the aside. The
    story holds, in order, the hero image (moved out of the header, the story's first part), the
    challenge, the case-study image, the solution, the results (moved from the header, after the
    solution), the gallery and the live-site link, and is drawn only when one of them is.
    `aside.salt-case-study-view__aside` (`aria-label` from `labels.details`) holds one
    `dl.salt-case-study-view__details`: the project details, then Client, Sector and Services
    (`labels.client`, `labels.sector`, `labels.services`), each row only when it has a value, and
    the aside only when one row does. Client and sector are the record's title when its collection
    is enabled and the record resolves, otherwise the free text, and never links. A service is one
    `dd`, a `a.salt-case-study-view__service-link` to its own public page when it has one, plain
    text when it has none; one that may not be shown is not in the document.
  - Removed: the header's client line (`p.salt-case-study-view__client`) and its results and
    details, and the delivered services' card section (`section.salt-case-study-view__services`),
    so nothing appears twice. The view's section ids are now three:
    `case-study__services-heading` goes.
  - `primitives.css`: the article is a grid of one track, `minmax(0, var(--container-2xl))`,
    centred inside `--space-gutter`, and a query container. The header is its first row, across
    every track; from 64rem the aside takes an implicit second track of `--container-2xs` (new in
    `token-layer.json`) at a `--space-8` gap, in the story's row, so it starts level with the hero
    and never beside the title; with no aside there is no track and the story keeps its cap. From
    64rem the header lays out as a grid: the back link on its own line on the title's left edge,
    then the title and the summary side by side in two equal halves on a shared first baseline,
    each wrapping in its own half; without the link no row is kept for it, and a title with no
    summary takes the row. A band's tone crosses the whole row to both viewport edges by a border
    image's outset (no overflow), with nothing beside it. Below 64rem the aside follows the story
    and the page reads as it did with the hero in the header: the hero `--space-4` under the
    summary, and in a band inside the tone with the band's `md` foot under it, painted by the same
    outset over the hero's 16:9 frame (`min(100cqi, var(--container-2xl)) * 9 / 16`), so the image
    is drawn once. Measured at 390 against rc.9's previous layout, every part sits at the same
    place, the details included. The gaps there are padding on the story and the aside, since MR-8
    lets no other rule move a block margin in the view. The details `dl` loses the user agent's
    `1em` margins, which started the aside below the story's top on a site without a reset; below
    64rem the aside's padding gives the same space back, `--space-4` above and below them. The results open their own
    gap at (0,2,0) over the grid's reset.
  - `image-sizes.json`: two slots, `story` (`(min-width: 44rem) 42rem, calc(100vw - 2rem)`) for the
    hero and the case-study image, and `story-gallery` for a gallery frame, one column of the 3/2/1
    grid (at most 13rem). They are written at a reference gutter, the design system's floor of 1rem
    (foundations L4), so they never under-declare on a target whose gutter is at or above it, and the
    aside needs no slot of its own: at that gutter the story is already 42rem from 64rem. Each
    target's gutter stays its own. **A deliberate approximation**: a wider gutter draws the image
    narrower than declared, by twice its excess over 1rem. Measured in Chrome at 390, 639–641,
    703–704, 719–720, 767–769, 1023–1025, 1040, 1055–1056, 1280 and 1600 CSS px, with and without
    the aside, no image was ever drawn wider than declared. Salt for WordPress's gutter (1rem,
    1.5rem from 40rem, 2rem from 64rem) over-declared by at most 16px below 64rem (592 drawn, 608
    declared, at 640) and 32px from 64rem to 66rem with the aside (640 of 672 at 1024). Salt for
    Next.js's clamp (1rem to 2rem, `0.5rem + 2vw`) over-declared by at most 25px (647 of 672 at
    1024). The services' `card` placement goes. Results at four columns in the 42rem story are
    about 9rem each, deliberately.
  - Fixtures: every case-study case regenerated; the new `sector-plain-service` draws a sector, a
    linked service and one with no public page. The fixtures gate checks the aside's presence,
    each row's value and order, that client and sector are never links, and that a service links
    exactly to its own href, the header holding no image, the hero opening the story, the aside
    after the story and no empty story wrapper, with negative controls. 133 cases in all.
  - **What each target changes.** Both: move the header out of the story to the article's first
    child and the hero out of the header to the story's first child; the story and aside markup and the new labels (`details`,
    `client`, `sector`), with translators' comments; drop the header's facts and the service cards;
    the story slots' sizes; serve the new `salt.css`. Salt for WordPress: link a service only when
    it is published and has a permalink, draw it plain without a public page, leave it out when it
    may not be shown.
- The case-study view has fixtures and is required of every implementation (SC-021).
  `fixtures/case-study/` holds four cases (`full`, `aside`, `band` and `minimal`), `case-study`
  joins `REQUIRED_FILES`, and a full conformance run refuses to declare it not shipped. The
  markup closes two gaps: each delivered service's card sits in an `li`, and the view declares its
  priority image (role `image`). The header band, once a note, is the view's `header` variant
  (`plain` or `band`), keyed to a site option through the markup's new `variants[].site`; a band
  draws the header as a section band, with its tones, `md` spacing, the default width, the
  spacing's custom property and its parts in `div.salt-section__content`. A new declared site key,
  `site.caseStudy` (`media`, `header`, `headerTone`, `headerToneDark`), carries the view's layout
  into a fixture's input, and the gate ties it to the HTML: `data-media`, the aside's row count
  and its measure (a rem length, 64rem for a default band) follow the input. The case-study
  image placements in `image-sizes.json` name their img by selector; a delivered service's card
  takes the card slot at three columns in the full band in the flow, and in the aside the new
  `aside-card` slot: the default band from 64rem, where the services keep to the measure, and the
  full band below. Salt for Next.js owes naming the view's four sections and that card slot; Salt for
  WordPress owes the markup, and an ACF options page for the band and the aside layout. (The image
  aside, its site key and its slots are withdrawn in rc.9, SC-034.)
- The conformance runner (`./conformance`, bin `salt-conformance`): fixtures, field snapshots,
  class vocabulary and the served stylesheet, reported as `conformance.json` (format
  `salt-conformance/1`) and `conformance.md`. An implementation conforms only when all four checks
  ran for everything it ships and all pass (SC-017).
- Schemas for every contract file (`./schema/*`).

### What a site does

A site moving onto a platform release that pins this contract migrates its stored content once,
through that platform's own migration. As the first major, 1.0.0 has no earlier major to migrate
from, so it ships no `contract/migrations/` file (`RELEASE-POLICY.md` section 4); what each site
moves from is recorded per item instead, and the platforms' releases carry the migrations:

- Salt for WordPress 5.0.0 sites: `intro` folds into `rich-text`; the `services`, `work`, `team`,
  `blog_teaser` and grid `testimonials` layouts fold into `collection-showcase`, and slider
  `testimonials` and `scroll_carousel` into `carousel`; section settings move from `section_*` to
  the shared settings; several option values are renamed. Each layout slug and field name that
  changes is listed under `formerly` in `contract/sections.json` and `contract/fields/`, and each
  needs a slug-migration entry (FLEET07).
- Salt for Next.js 0.11.0 sites: block slugs and option values that change are listed the same
  way; the Payload migration renames stored blocks and values. It renames the Postgres enum types
  too (SC-023): each select whose type had another name records it as `formerlyEnum`, which
  covers the 52 selects of 0.11.0's blocks whose type name changes, and the mode and order of the
  queries the contract folds. The types that fold into one move their columns to the shared type;
  they are not a plain rename: the three button styles (`enum_hero_button_style`,
  `enum_cta_button_style`, `enum_media_text_button_style`) into `enum_button_style`, the two media
  sides (`enum_hero_media_side`, `enum_media_text_side`) into `enum_media_side`, and the two query
  modes (`enum_content_query_mode`, `enum_content_query_mode_unfiltered`) into `enum_query_mode`. A select
  0.11.0 left to Payload's derived type name (the two alignments, the three icons, the showcase's
  and the carousel's source) has no fixed former name to record, so the migration reads it from
  the site's schema.
- Both: render the contract's markup and serve `styles/salt.css` byte for byte, then run
  `salt-conformance` in CI. What each platform must change is its `owes` in the contract files.

## 0.x drafting (never published)

The drafting record, newest first: an entry higher up supersedes any below it. Counts, open
questions and "left as work" notes here describe the draft at the time; 1.0.0 above is what ships.

- The page fixture and the chrome markup gaps (SC-019). `page.json`'s head declares the link to
  the served `salt.css`. Page cases (`page` is a required file) compare the body and only Salt's head
  elements, that link read as its `rel` and file name and the scriptless phone layout's `noscript`
  style, through `pageOf` in `normalise.mjs`; the rest of the head, the `html` and `body` elements'
  attributes and the body's `script`, `style` and `link` elements are the platform's. The adapter
  returns the whole document for a page. A section nested in a page or view carries its own field
  `values` and is held to its own markup, variants and priority image. Data attributes that mirror a
  field (`data-align`, `data-media-side`, `data-columns`, `data-greyscale`, `data-source`) are tied to
  that field in every case. Markup: the header's span toggle carries no `type`; the theme toggle is a
  button, fixtured under `state.themeScheme`, or its empty `span[aria-hidden]` server form, in the
  header and the footer; the drawer and consent panel carry `open`; the search input keeps the
  query; an untitled footer column's list takes the nav's name; the header logo of
  the site's default scheme is `loading="eager"`, as it is above the fold, and the other scheme's
  is lazy (SC-025); the header phone glyph carries no `data-size`; the
  service view's related cards declare the card slot for the full band, as no stylesheet gives a
  view's `main` a measure.
- Fixtures for the site chrome and page views (SC-018): 20 cases for `site-header`, `site-footer`
  and the `post`, `service`, `archive`, `search` and `not-found` views, 100 cases in all. A case
  names its kind by its key (`section`, `chrome`, `view`); chrome and view cases read `site`,
  `document`, `route` and `state`, and the adapter renders the header or footer element, or the
  view's `main#main`. The fixtures gate reads them against their own markup: one h1 per view and
  none in the chrome; landmark ids only on their landmark elements; `<owner>__<part>` owners limited
  to the file, the components it draws and its nested sections; a view's nested section described
  by `document.listing` and held to the heading rules; `aria-current` tied to the page's path; view
  images in their slots, related service cards in the grid's card slot. `site` keys are declared,
  `site.logoHeight` among them, and a logo is matched to its media record by its exact template. The
  conformance runner runs the chrome and views too, each reported as a file of its own and counted
  in the verdict; `--sections` and `--not-shipped` take their ids, and a full run refuses the SC-018
  files as not shipped.
- `styles/salt.css` (`./styles/salt.css`): the one stylesheet both platforms serve, byte for byte.
  It is the six shared stylesheets in load order (base, sections, primitives, blocks, chrome,
  views), minified with comments stripped (45 KB), built deterministically by `npm run
  build:salt-bundle` with the lockfile's esbuild. `npm run salt-stylesheets` fails when the
  committed bundle is not what the sources build, or when `styles/` and the build's load order name
  different sources; its other checks still read the six sources. Both platforms serve it verbatim
  as a stylesheet of its own (a separate `<link>` or enqueue of a copy, never through Tailwind or a
  CSS pipeline): after Tailwind v4's stylesheet (both platforms' version), whose `@layer theme,
  base, components, utilities` declaration its `@layer base` joins, or first with none. Tailwind v3
  beside it is not supported.
- The conformance runner (ID-3608), `conformance.mjs` (`./conformance`, bin `salt-conformance`),
  which each implementation points at itself in its own CI. Per section it sends every fixture case
  to the implementation's adapter (a command or a local endpoint), normalises both sides and names
  the case and the first differing node by path; checks the implementation's Payload or ACF field
  snapshot with the emitters' own drift checks, filed per section; checks every `salt-*` class it
  writes against the markup's vocabulary; and checks the stylesheet it serves (a file, or a running
  site's URL) is byte-identical to `styles/salt.css`, refusing a path inside the package itself (a
  link elsewhere to the package's file passes). A fixture mismatch aligns each element's children
  first, identical nodes anchor the alignment, so a moved identical node is `order` (with both
  positions), a replaced sibling `element`, and a dropped or added one `missing` or `unexpected`. An
  implementation conforms only when all four checks ran for every section it ships and all pass
  (SC-017); a run that leaves a section or a check out needs `--partial`, which is reported as
  partial, not conforming, and exits 1. It writes `conformance.json` (format `salt-conformance/1`,
  the parity matrix's input) and `conformance.md`, and exits 1 on any mismatch. `--not-shipped`
  reports a section as not shipped rather than failed. `npm run salt-conformance` (in `verify`, CI
  and the release workflow) runs it against the reference adapter with both emitters' snapshots,
  which must conform.
- Image sizes (SC-016): `contract/image-sizes.json` (`./image-sizes`, schema `./schema/image-sizes`)
  fixes each image slot's default `sizes`, per band and per card column count, the candidate widths
  and the rule that picks them, the srcset capped at the upload's intrinsic width (listed itself
  when it is no candidate), `src` the URL at the intrinsic width, and the site logo's sizes as its
  drawn width in px, from Salt for Next.js's table. `markup/media.json` and the section background
  read it. A site that swaps a view or changes a layout declares its own sizes per slot in
  `salt-overrides.json` under `imageSizes`. Salt for WordPress owes matching sizes and registered
  widths, with auto-sizes disabled and core's default sizes dropped from its srcset; Salt for
  Next.js owes the cap, and width and height on fill images (SC-007). Fixture media records give a
  URL template per width; every image asserts its slot's default.
- `toneDark: auto` writes the section's tone, and the shared stylesheet draws its dark form; the
  label and the markup note say so (SC-016).
- `section#display-forms` (SC-016): dates and times display in the site's locale, `<time datetime>`
  is ISO 8601, a phone link's href follows Salt for Next.js's rule, and a number with an extension
  or a stray bracket draws no link, and JSON in data attributes has no escaped slashes. Fixtures pin
  `en-GB`.
- The contact form is fixtured (SC-016): field names, types, the message's rows, autocomplete and
  redrawn values are in the markup. The normaliser masks only the form's action, its two token
  values and the challenge question (the question's own text only, and only values that are
  present), as declared placeholders. New cases: open, invalid and sent.
- Markup corrections: images always carry width and height (SC-007); a rich-text body may draw h2 at
  base level 1; the accordion's group name is only on each `details`, and the tab set's name only on
  its radiogroup; pagination draws its window with gaps; the showcase index has an ungrouped form; a
  lone carousel card may take the priority image (`priorityMedia.role` may list roles, a MINOR
  schema loosening); which buttons take the site's arrow (a section's calls to action only), the
  section index counted from 0 (the plan's index, as both platforms count it) and a background with
  no focal point are stated. The fixtures gate also checks tab counts and the pagination window
  against the case. 80 fixture cases.
- The extension points (ID-3606), with the customisation ladder as normative text in the README:
  brand settings, dials and tokens, variants, swap a view, replace logic, a client-only section,
  each saying what still reaches a site on update. No separate slots-and-hooks system.
  - `contract/dials.json` (`./dials`, schema `./schema/dials`): the four admin-only design dials
    1.0.0 ships (SC-015). Corners (`--radius-sm`, `-md`, `-lg`: square, soft, round), shadows
    (`--salt-card-shadow`: none, subtle, raised, on design-foundations' `--shadow-sm` and
    `--shadow-md`, requiring the shadow colour roles `--color-shadow-sm`, `-md` and `-lg`, which a
    runtime emits while the dial is set), button style (`--salt-button-radius`, read by buttons,
    pagination links and the copy-link button: square, soft, pill) and density
    (`--space-section-sm`, `-md`, `-lg`: compact, comfortable, spacious). Each option points a token
    at a rung, or 0, and the runtime writes that rung's value. Both platforms owe all four.
  - Two component tokens the stylesheets read, both optional, so nothing changes until an admin
    turns a dial: `.salt-card` reads `--salt-card-shadow` (fallback `none`) and `.salt-button`,
    `.salt-pagination__link` and `.salt-copy-link__button` read `--salt-button-radius` (fallback
    `--radius-md`). The token layer names 131 properties: the 128 the stylesheets and markup read,
    and three a dial requires, each marked `requiredBy` (a new optional key in
    `./schema/token-layer`).
  - `contract/view-props/` (`./view-props/<section>`, schema `./schema/view-props`): the props each
    section's view receives, as `data` per section and the page `plan` once in `_shared`, in kinds
    both a TypeScript type and a PHP array shape can be generated from. A prop drawn from a field
    takes the field's canonical name (SC-015) and is nullable whenever its field can come out empty
    (SC-009 cleaning, a deleted upload), required or not; a value only the logic guarantees, by
    dropping the row, comes from the logic. A team card carries its contact and social links, and a
    carousel, gallery or tab set says whether it is named.
  - `schema/replaced-logic.schema.json` (`./schema/replaced-logic`): the `salt-overrides.json` a
    client site writes when it swaps a view or takes a section over, which the update flag reads. On
    WordPress, `OVERRIDES.md` points at it (SC-015). A view swap is flagged when the section's view
    props or `_shared.json` change.
  - `npm run salt-extensions` (in `verify`, CI and the release workflow): every token a dial moves
    is in the token layer, and every rung it points at is there or in design-foundations' scale
    shape, and every token a rung's value references is required by the dial and named in the token
    layer; every section has view props; every prop drawn from a field names a real one, takes its
    name, is nullable whenever its field can come out empty, and offers its select's options; the
    replaced-logic examples hold. `npm run salt-stylesheets` names the card's shadow as a focus-rule
    exception and accepts a dial's radius token in front of a rung, and passes a token no stylesheet
    reads only when a dial requires it, and the release workflow now runs it too.
- Fixtures (`fixtures/<section>/<case>.json` and `.html`, `./fixtures/*`, ID-3604): 73 cases over
  the 17 sections. Each pairs a section's stored field values and its page context with the
  default HTML both platforms must render. Together they cover every variant option, the zero
  state, the inverse band and every value of the shared tone, dark tone, spacing and width
  settings. Every case sets its anchor, so every drawn id is known (SC-012), and its context is a
  page that could exist (track numbers, the single h1, priority media, collapse).
- `normalise.mjs` (`./normalise`): the one normaliser both platforms compare through. It folds
  attribute and class order, white space at block boundaries (between inline elements any run is
  one space and counts), boolean-attribute and character-reference forms, comments, the upload host
  in `src` and `srcset`, and icon artwork (SC-007). It never touches ids.
- The README defines the fixture input and the adapter protocol the conformance runner calls: a
  case's JSON on stdin and the section's HTML on stdout, or a local endpoint.
- `npm run salt-fixtures` (in `verify`, CI and the release workflow) proves coverage, every input
  against `contract/fields`, every expected HTML against `contract/markup` (element order, classes,
  required and undeclared attributes, conditional attributes and elements the case switches on or
  off, data attributes, headings and `aria-labelledby`, ids, and SC-007's image rules), every case
  context, and that the normaliser is idempotent and no one-attribute change survives it.
- `markup/media-text.json` counts alternating rows from 0; `markup/tabs.json` draws the tab set's
  `aria-label` only when it is named.
- The owner's rulings of 09/10/2026 (SC-007, SC-008, SC-012 to SC-014) are applied, and no open
  question remains; the markup schema drops the `open-question` note topic.
  - Every id the system draws is `<owner>__<part>` (SC-012). The owner is the component, section or
    view id as `sections.json` names it, or `<anchor>`, the section's settled id, for ids inside a
    section. Parts are numbered from 1: `site-header__submenu-2`, `<anchor>__heading`,
    `<anchor>__tab-2`, `service__benefits-heading`. Only the landmark ids stay plain (`main`,
    `content`, `header`, `footer`, `nav`, `site-navigation`, `search`, `skip-link`). An anchor is
    slugged as WordPress's `sanitize_title` slugs it under the site's locale, then every run of
    underscores or `%xx` octets becomes one hyphen, repeated hyphens collapse and hyphens are
    trimmed (SC-014), on save and again at render, so it never contains `__` and never meets a drawn
    id; an empty slug counts as no anchor. "We're hiring" gives `were-hiring`; 'Straße' gives
    `strase` on en_GB and `strasse` on de_DE; 'contact__form' gives `contact-form`. Anchors settle
    in two steps (SC-013, SC-025). The anchors editors typed come first, in page order: an anchor
    equal to a landmark id becomes `<anchor>-section`, and an id already taken takes the next free
    `-2`, `-3`. Each section with no anchor then mints its id from its section id, from what is
    left. So `faq, main, faq, faq-2` and an unanchored `pricing` render
    `faq, main-section, faq-2, faq-2-2, pricing`, and an unanchored `faq` section above a section
    anchored `faq` renders `faq-2, faq`. A minted id's number counts every unanchored section of
    its section id in the stored layout, drawn or not: of two unanchored `faq` sections, the
    first with no items, the one drawn is `faq-2`.
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
- The header fixes every id it draws: `site-navigation` (a landmark), and
  `site-header__submenu-<n>`, `site-header__drawer-navigation` and
  `site-header__drawer-submenu-<n>`. The footer's column titles are `site-footer__column-<n>`, and
  the consent panel it draws uses `site-footer__consent-title`, `site-footer__consent-<category>`
  and `site-footer__consent-<category>-description`. A footer social link with no glyph carries the
  profile's name as text.
- `contract/sections.json` declares component variants (card's `style`), and the gate refuses
  component markup that describes a variant or option its entry does not declare, a vocabulary
  variant that offers a value more than once or defaults outside its options, an icon name `icons` does not
  list (in attributes or `dataAttributes`), an icon field whose default is not a content name,
  and any id the markup draws or points at (every id-referencing attribute, `href` fragments
  included) that is not a landmark id, `<anchor>` (only inside sections), or `<owner>__<part>`.
- The markup records the custom properties the shared stylesheets read (the case study's aside rows
  and measure, and the header's scriptless phone layout, a `noscript` style in the document head,
  drawn in page.json's head), and that fit and focal point reach the `img` as inline `object-fit`
  and `object-position` (SC-011).
- The case study names its four sections by `case-study__<part>-heading`, and the contact form's
  honeypot is `<anchor>__website`.
- The sections schema drops `openQuestions`.
- Locations' open-now rule states one order, hours carried past midnight included.
- Each collection source in `contract/sections.json` states whether it has a category taxonomy
  (`categories`, SC-010): services, case studies, posts, team, FAQs and locations do; testimonials
  do not. The sections schema requires it of every source with items, and the gate refuses a
  source that answers two ways or a source a collection-query can read with no answer. Both
  emitters read it (`categorisedSources` and `categorySources` in `emit/_contract.mjs`): a
  collection-query offers its by-category mode and categories picker only for a source with
  categories, and with a source select the picker shows only while the select holds one. Salt for
  Next.js owes a location-area taxonomy with its locations section; its team categories were
  already owed (SC-006). The Payload emitter names team's and locations' taxonomies `departments`
  and `areas` by default; a site names its own through `sources`. SC-027 later withdraws team's
  categories, and with them the `departments` default.
- The collection-showcase and carousel queries' Salt for WordPress notes owe an
  `acf/validate_value` check refusing by-category for a source without categories, and an admin
  check of the categories field's conditional logic (SC-010); the ACF emitter records the rule as
  `salt.modeRequires`.
- `emit/acf.mjs` (`./emit/acf`): generates the ACF page-sections field group from
  `contract/fields`, as ACF JSON (what `acf_add_local_field_group()` takes): one Flexible Content
  layout per section, keys following DATA02 from the contract path so reordering never changes
  them, and conditions as `conditional_logic` (`filled` as "has any value" / "has no value"; ACF
  cannot express SC-009's visible-text rule, which the field schema records). `acfSnapshot` and
  `checkAcfSnapshot` (or `node emit/acf.mjs --check`) are the consumer's drift check, and
  `acfSlugRegistry` feeds Salt for WordPress's slug gate. `reports/round-trip-acf.md` (not shipped)
  compares the output with salt-wordpress 5.0.0: 390 differences, every one recorded in the
  contract.
- `emit/payload.mjs` (`./emit/payload`): generates each section's Payload block config from
  `contract/fields`, as `toPayloadBlocks(options)` (upload collection, link targets, heading set,
  icon registry, installed sources, the site's rich-text editor). `payloadSnapshot` serialises it
  deterministically and `checkPayloadSnapshot` (or `node emit/payload.mjs --check`) fails a
  consumer's committed snapshot when a contract change renames, retypes or re-limits a field.
  `emit/_contract.mjs` holds what every emitter shares. `reports/round-trip-payload.md` (not
  shipped) compares the output with Salt for Next.js 0.11.0's blocks: 118 differences, every one
  recorded in the contract (SC-008 rules the two shared booleans' false default).
- `styles/` (`./styles/<file>`): the one shared stylesheet set (SC-002). `sections.css`,
  `primitives.css`, `blocks.css` and `chrome.css` come from Salt for Next.js's
  `packages/core/styles` at 1472afdd, which it will re-export; `theme.css` stays with each
  implementation. Changed from that source: `sections.css` names the token layer as what it needs,
  and framed images fill their frames from CSS alone (SC-011: section media, showcase cards and
  avatars, logos contained, case-study frames). `base.css` sets design-foundations' element
  convention in `@layer base` (headings in their text roles inside the page's landmarks, running
  text on `body`). With Tailwind v4 (imported after `tailwindcss`) and with no Tailwind it yields to
  every unlayered rule; with Tailwind v3 (imported into the stylesheet v3 processes) v3 emits it
  unlayered after preflight, where its (0,0,1) rules beat preflight on source order and lose to
  every class-keyed rule. Importing it before `tailwindcss` in v4, or serving it beside v3's output,
  is not supported (see the README). `views.css` styles the post, archive and service view bodies in
  the classes SC-007 adopts (the search view's body is its form and a listing, styled elsewhere),
  the service's related list, and the shared `author-box` (SC-008). Load order: base, sections,
  primitives, blocks, chrome, views.
- `contract/token-layer.json` (`./token-layer`, schema `./schema/token-layer`): the 126 custom
  properties the stylesheets read, or the markup writes into one they read, and a runtime emits,
  grouped, each with its meaning and source. A `writes` list gives each property the markup writes
  with a `<placeholder>` the setting that fills it, by placeholder name. Names only, never values.
- `npm run salt-stylesheets`: the stylesheets parse whole; 46 decision contracts hold, 45 ported
  from Salt for Next.js (five that read its runtime stay there) and one new (every framed image
  fills its frame); the token layer names exactly what the stylesheets read and every `var()` a
  markup element writes (attribute values, each value of an enum, and a `style` element's CSS),
  fallbacks included, each placeholder through its named value map; every token said to come from
  the markup is written by a markup element; every styled class is on a markup element.
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
  section's background image; the collection-showcase source has no default. Team members were
  to carry categories on both; SC-027 withdraws that. In the markup, a quote card names its person with a heading; team cards
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
