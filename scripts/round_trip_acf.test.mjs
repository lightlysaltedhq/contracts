// Proves the ACF round trip's own machinery without a salt-wordpress checkout: its command line,
// and that importing it runs nothing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { classify } from './_round_trip.mjs'
import { parseArguments } from './round_trip_acf.mjs'

test('R10: flags may come anywhere; the checkout is a path or SALT_WORDPRESS_DIR, never a guess', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'salt-wordpress-'))
  try {
    mkdirSync(path.join(dir, 'inc', 'fields'), { recursive: true })
    assert.throws(() => parseArguments([tmpdir()], {}), /salt-wordpress checkout not found/)
    assert.deepEqual(parseArguments(['--check', dir], {}), { wordpress: dir, check: true, suggest: false })
    assert.deepEqual(parseArguments([dir, '--suggest'], {}), { wordpress: dir, check: false, suggest: true })
    assert.deepEqual(parseArguments([], { SALT_WORDPRESS_DIR: dir }), { wordpress: dir, check: false, suggest: false })
    assert.throws(() => parseArguments([], {}), /pass a salt-wordpress checkout or set SALT_WORDPRESS_DIR/)
    assert.throws(() => parseArguments([path.join(dir, 'nope')], {}), /salt-wordpress checkout not found: .*nope/)
    assert.throws(() => parseArguments(['--chek', dir], {}), /unknown option --chek/)
    assert.throws(() => parseArguments([dir, dir], {}), /one salt-wordpress checkout/)
    assert.throws(() => parseArguments(['--check', '--suggest', dir], {}), /--check and --suggest cannot be used together/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('finding 8: every reviewed entry cites a note of its own field, a field above it or its section', async () => {
  const { misplacedAcfEvidence } = await import('./round_trip_acf.mjs')
  const { loadContract } = await import('../salt-contract/emit/_contract.mjs')
  const contract = loadContract()
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'salt-contract', 'reports', 'round-trip-acf.expected.json')
  const list = JSON.parse(readFileSync(file, 'utf8'))
  assert.ok(list.length > 0)
  for (const e of list) assert.deepEqual(Object.keys(e), ['section', 'path', 'kind', 'difference', 'evidence'])
  assert.deepEqual(misplacedAcfEvidence(contract, list), [])
  // A folded layout's label names its section; a real note borrowed from a sibling is refused.
  const borrowed = { section: 'collection-showcase (services)', path: 'columns', kind: 'condition', difference: 'x',
    evidence: 'owes: the accordion and index layouts, and the field on work, team and blog_teaser; services has grid, list and featured; testimonials grid becomes source testimonials with layout grid' }
  const layoutNote = contract.fields['collection-showcase'].fields.find((f) => f.name === 'layout').platforms.wordpress.owes
  assert.deepEqual(misplacedAcfEvidence(contract, [{ ...borrowed, evidence: `owes: ${layoutNote}` }]).length, 1)
  const own = contract.fields['collection-showcase'].fields.find((f) => f.name === 'columns').platforms.wordpress.owes
  assert.deepEqual(misplacedAcfEvidence(contract, [{ ...borrowed, evidence: `owes: ${own}` }]), [])
})

test('R9: a difference is expected only when the reviewed list names it exactly', () => {
  const list = [{ section: 'contact', path: 'showPhone', kind: 'name', difference: 'stored as show_phone', evidence: 'formerly: show_phone' }]
  const row = (kind, text) => ({ section: 'contact', at: 'showPhone', kind, text })
  assert.deepEqual(classify([row('name', 'stored as show_phone')], list).expected.map((r) => r.evidence), ['formerly: show_phone'])
  const later = classify([row('type', 'type text; salt-wordpress textarea')], list)
  assert.equal(later.unexpected.length, 1)
  assert.deepEqual(later.unseen, list)
})

test('S7: a committed report checked out with CRLF line endings is still current', async () => {
  const { reportIsCurrent } = await import('./round_trip_acf.mjs')
  const text = '# ACF round trip\n\na | b\n'
  assert.equal(reportIsCurrent(text.replace(/\n/g, '\r\n'), text), true)
  assert.equal(reportIsCurrent(text.replace('a', 'c'), text), false)
})
