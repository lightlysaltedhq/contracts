# Release policy: @lightlysaltedhq/salt-contract

This policy governs `salt-contract/` in the public repository `lightlysaltedhq/contracts`. The package defines what Salt for Next.js (`salt-nextjs`) and Salt for WordPress (`salt-wordpress`) must hold identical: visitor output and editor fields. Admin, logins, form delivery and routing stay native to each platform and are outside the contract (SC-003). Neither implementation is the reference (SC-001), and the stylesheets are the contract's own (SC-002). Rules are adopted from the salt-wordpress release policy ("WP policy") and the design-foundations CHANGELOG ("Foundations"); each is cited where used.

## 1. One version

The package has one version. Every JSON file in `contract/` carries a top-level `version` equal to `package.json`, moved in the same commit as the bump (Foundations, "One version for the whole package"). The package's gate (`npm run salt-contract`) reads every file under `contract/` and `schema/` and fails when a file is not JSON, lacks a top-level `version`, disagrees with `package.json`, or carries a version key anywhere else. Schemas carry no version of their own; they move with the package. Which file changed in which release is recorded in `CHANGELOG.md`, not in per-file versions.

The test for every change below is the same: could an implementation that conformed before stop conforming, or could a consumer of an export break? If yes, MAJOR. If the change only adds something optional, MINOR. If no conforming implementation's verdict changes, PATCH. The release owner makes the call in the PR that tags and records it in `CHANGELOG.md` (WP policy, semver contract).

## 2. What each part of a version means

| Artefact | MAJOR | MINOR | PATCH |
|---|---|---|---|
| Section ids (`contract/sections.json`) | Rename or removal (after deprecation, section 3) | New section | Label or description text |
| Field ids and types | Rename, removal, retype; a new required field; an optional field becoming required | New optional field with a default | Help text, editor labels |
| Field choices | Removing or renaming a choice value; changing the default | New choice appended | Choice label text |
| Field limits (length, count, ranges) | Tightening a limit; adding a limit that did not exist | Loosening a limit | None |
| Element order in markup | Any change | None | None |
| Classes (`salt-*` vocabulary) | Rename or removal of a class; moving a class to another element | New class | None |
| Data attributes | Rename, removal, or a changed value vocabulary | New optional attribute | None |
| Heading rules | Any change to level, element or the rule for choosing it | None | Wording of the rule only |
| Stylesheets (`styles/*.css`) | Any change that alters rendered output for unchanged markup, or removes a selector or custom property that markup or an implementation uses | New selector or property that unchanged markup does not match | Changes with byte-identical rendered output (comments, formatting, rebuild) |
| Fixtures | Any change that could turn a conforming implementation red, even with the same shape and counts (Foundations) | New fixture for a new optional feature | A change no previously passing implementation can fail |
| Extension points, view props, replaced-logic declarations | Rename, removal, retype, or a removed declaration | New optional dial, prop or declaration | Description text |
| Schema (`schema/field-definition.schema.json`) | Tightening it so a valid field file becomes invalid, or removing a keyword | Loosening it, or a new optional keyword | Description text |

Two rules come straight from the WP policy. Markup structure change is MAJOR, and the fixture diff in the PR is the semver evidence, as the snapshot diff is there (WP policy, FLEET01). Adding an optional argument with a default is MINOR, which is why a new optional view prop is MINOR and a retyped one is MAJOR. Where a change fits two rows, the stricter applies.

## 3. Deprecation

Nothing in sections, fields, classes, data attributes or extension points is removed in the release that first deprecates it. A deprecated item is marked `"deprecated": {"since": "<version>", "replacedBy": "<id or null>"}` in its contract file and stays valid and generated. Its replacement ships in the same release, so the contract carries both for at least one full minor. Removal is a MAJOR and may happen no earlier than the first major after the deprecating minor.

The deprecating release's `CHANGELOG.md` entry has a *Deprecated* heading listing each item, its replacement, and the earliest version that may remove it. A removal's entry has a *Breaking* heading naming each removed item at section, field, class or attribute granularity, so a maintainer can diff it against a site's overrides (WP policy, BREAKING section). A class or attribute removed without a prior deprecation is a policy breach, not merely a major.

## 4. Migration notes for a major

Every major ships `contract/migrations/<version>.json`, covering everything renamed, removed or retyped since the previous major (the machine-readable form of the WP `slug-migrations.json` idea, which is still an empty list, and of the *Breaking* and *What a site does* split in the salt-nextjs "Upgrading" section). Shape:

```json
{
  "version": "2.0.0",
  "from": "1.4.0",
  "renames": [
    { "kind": "section" | "field" | "class" | "attribute" | "choice" | "extensionPoint",
      "scope": "<section id, or null>",
      "from": "<old id>",
      "to": "<new id, or null if removed>",
      "note": "<how existing content or markup is migrated>" }
  ],
  "retypes": [
    { "scope": "<section id>", "field": "<id>", "fromType": "text", "toType": "richtext", "note": "..." }
  ]
}
```

The file carries the package `version` like any other (section 1). Each implementation generates its own migration from it: a Payload database migration and a `salt-nextjs-migrations` run for Next.js, and a slug-stability entry per removal for WordPress (FLEET07 requires a migration entry for any removed ACF field name or layout slug). The prose lives in the CHANGELOG entry under *What a site does*. Moving to a major is never described as additive.

## 5. Conformance and lag

An implementation states conformance as an exact pin of `@lightlysaltedhq/salt-contract` (no range), as salt-nextjs already pins core exactly. Its conformance report, produced by running the fixtures, records the contract version it ran against. A claim without that version is not a claim.

A major must be adopted by both implementations before the next major is released. Minors may lag by one: an implementation may sit on the previous minor of its current major while the other moves ahead, but not two. The release owner checks both pins and both reports before tagging. If one implementation cannot adopt a major, the owner decides whether the contract change is withdrawn or the lag is recorded as an exception in the CHANGELOG, with a reason and a date.

Platform-native behaviour is not a conformance matter (SC-003), so a native change that leaves visitor output and editor fields intact needs no contract release.

## 6. Releases

A release is staged, not published directly (Foundations, "Publishing"). The tag is `salt-contract-v<version>`, pushed from the public repository; the tag prefix keeps it apart from the `design-foundations` tags in the same repository. CI runs the package's gate (one version, every contract file valid against its schema, no colour values, the tarball), then calls `npm stage publish`. The implementations' conformance runs happen in their own repositories; the release owner checks both reports before tagging (section 5), and the stage uses npm trusted publishing with no token. The package becomes public only when the owner approves it on npmjs.com with a passkey. Afterwards the release is read back from the registry (version, tarball file list, `dist.integrity`, and that every `contract/` file's `version` matches). Because the source repository is public, npm attests provenance for every release without a flag; a release without an attestation is investigated before it is announced.

Hand-published or unattested releases are exceptions that the CHANGELOG states plainly, as Foundations does for 2.1.0 and 3.0.0.

## 7. Changelog

`CHANGELOG.md` is newest first, dates DD/MM/YYYY, and each entry names the semver call and the reason. It does not carry per-file versions. Headings used: *Breaking*, *Deprecated*, *Added*, *Changed*, *What a site does* (majors only). The SC-001..SC-004 rulings are cited by number where a release depends on one, for example a new section citing SC-001, or a rejected request to put routing in the contract citing SC-003.

## Not adopted

The WP trivial-patch auto-update allow-list does not apply: this package is a pinned dependency, not an auto-updating theme. The WP rule that widening `salt_allowed_html()` is MAJOR stays in salt-wordpress; the contract only records an HTML allowance if a markup file adds one, which would then be MAJOR under section 2.
