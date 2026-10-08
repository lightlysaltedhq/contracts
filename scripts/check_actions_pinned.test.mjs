// Proves check_actions_pinned.sh fails on every shape of unpinned `uses:` GitHub would run.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check_actions_pinned.sh')
const SHA = '11d5960a326750d5838078e36cf38b85af677262'

function run(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'actions-pinned-'))
  try {
    mkdirSync(path.join(dir, 'scripts'))
    copyFileSync(script, path.join(dir, 'scripts', 'check_actions_pinned.sh'))
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
      writeFileSync(path.join(dir, rel), body)
    }
    try {
      return { code: 0, out: execFileSync('bash', [path.join(dir, 'scripts', 'check_actions_pinned.sh')], { encoding: 'utf8' }) }
    } catch (e) {
      return { code: e.status, out: `${e.stdout}${e.stderr}` }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const wf = (steps) => `jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n${steps}\n`

test('a step pinned to a full SHA passes', () => {
  const r = run({ '.github/workflows/ci.yml': wf(`      - uses: actions/checkout@${SHA} # v4.4.0`) })
  assert.equal(r.code, 0, r.out)
})

for (const [name, step] of [
  ['a tag', '      - uses: actions/checkout@v4'],
  ['a flow mapping', '      - { uses: actions/checkout@v4 }'],
  ['a single-quoted key', "      - 'uses': actions/checkout@v4"],
  ['a double-quoted key', '      - "uses": actions/checkout@v4'],
  ['a space before the colon', '      - uses  : actions/checkout@v4'],
  ['a short SHA', '      - uses: actions/checkout@11d5960'],
]) {
  test(`${name} fails`, () => {
    const r = run({ '.github/workflows/ci.yml': wf(step) })
    assert.equal(r.code, 1, r.out)
    assert.match(r.out, /not pinned to a full commit SHA/)
  })
}

test('an unpinned action inside a composite action fails', () => {
  const r = run({
    '.github/workflows/ci.yml': wf(`      - uses: actions/checkout@${SHA}`),
    '.github/actions/setup/action.yml': `runs:\n  using: composite\n  steps:\n    - uses: actions/setup-node@v4\n`,
  })
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /\.github\/actions\/setup\/action\.yml/)
})
