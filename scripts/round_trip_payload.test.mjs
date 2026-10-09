// Proves the round trip's own machinery without a salt-nextjs checkout: its command line, and
// that importing it runs nothing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'

import { parseArguments } from './round_trip_payload.mjs'

test('R10: flags may come first, and the default checkout is the repository\'s sibling', () => {
  assert.deepEqual(parseArguments(['--check', '/x/salt-nextjs'], '/w/contracts/scripts'), { nextjs: '/x/salt-nextjs', check: true })
  assert.deepEqual(parseArguments(['/x/salt-nextjs', '--check'], '/w/contracts/scripts'), { nextjs: '/x/salt-nextjs', check: true })
  assert.deepEqual(parseArguments([], '/w/Products/Salt/contracts/scripts'), { nextjs: path.resolve('/w/Products/Salt/salt-nextjs'), check: false })
  assert.throws(() => parseArguments(['--chek']), /unknown option --chek/)
  assert.throws(() => parseArguments(['/a', '/b']), /one salt-nextjs checkout/)
})
