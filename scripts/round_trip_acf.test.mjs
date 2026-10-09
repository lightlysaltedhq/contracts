// Proves the ACF round trip's own machinery without a salt-wordpress checkout: its command line,
// and that importing it runs nothing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

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
