// What every round trip shares, whichever platform it compares: matching differences against the
// reviewed expected list, and holding each listed entry's evidence to the contract notes that can
// account for it. scripts/round_trip_payload.mjs uses it; the ACF round trip will too.
import { resolveSection } from '../salt-contract/emit/_contract.mjs'

export const keyOf = (r) => [r.section, r.path ?? r.at, r.kind, r.difference ?? r.text].join('\u0000')

/**
 * Each row against the reviewed list: listed rows are expected, with the list's evidence; the rest
 * are unexpected. `unseen` is what the list names and the comparison no longer finds.
 */
export function classify(found, list) {
  const listed = new Map(list.map((e) => [keyOf(e), e]))
  const seen = new Set()
  const expected = []
  const unexpected = []
  for (const r of found) {
    const entry = listed.get(keyOf(r))
    if (entry) { seen.add(keyOf(r)); expected.push({ ...r, evidence: entry.evidence }) } else unexpected.push(r)
  }
  return { expected, unexpected, unseen: list.filter((e) => !seen.has(keyOf(e))) }
}

// The evidence strings one platform note can supply: its owes, note and formerly, its values map
// whole, and each part of a values map keyed by part (a collection-query's mode, for example).
function citations(note) {
  if (!note) return []
  const out = []
  if (note.owes) out.push(`owes: ${note.owes}`)
  if (note.note) out.push(`note: ${note.note}`)
  if (note.formerly) out.push(`formerly: ${[note.formerly].flat().join(', ')}`)
  if (note.values) {
    out.push(`values: ${JSON.stringify(note.values)}`)
    for (const part of Object.values(note.values)) if (part && typeof part === 'object') out.push(`values: ${JSON.stringify(part)}`)
  }
  return out
}

/**
 * The evidence an entry may cite: a note on the field its path names, on any field above it, or on
 * its section in sections.json. A path segment the contract has no field for (a collection-query's
 * or a link's parts) stops the walk, so those parts take their parent's notes.
 */
export function evidenceFor(contract, entry, platform) {
  const { section, fields, settings } = resolveSection(contract, entry.section)
  const sectionNote = section.platforms?.[platform]
  const allowed = [
    ...citations(sectionNote && { owes: sectionNote.owes, note: sectionNote.note }),
    ...(sectionNote?.formerly ?? []).map((f) => `sections.json formerly: ${f.name}`),
  ]
  let level = [...fields, { name: 'settings', type: 'group', fields: settings }]
  for (const name of entry.path === '(block slug)' ? [] : entry.path.split('.')) {
    const f = level?.find((x) => x.name === name)
    if (!f) break
    allowed.push(...citations(f.platforms?.[platform]))
    level = f.fields
  }
  return allowed
}

/** The entries whose evidence is not a note of their own field, its parents or its section. */
export const misplacedEvidence = (contract, list, platform) =>
  list.filter((e) => !evidenceFor(contract, e, platform).includes(e.evidence))
