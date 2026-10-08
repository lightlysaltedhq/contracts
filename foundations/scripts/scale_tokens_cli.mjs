#!/usr/bin/env node
// The command line for scale_tokens.mjs: a batch of scales on stdin, a result for each on stdout.
//
//   node scripts/scale_tokens_cli.mjs < batch.json   // [scales, ...] in, [{ tokens } | { refused }, ...] out
//
// emit.py and check_scale_shape.py call this. It is not exported: the exported module stays free of
// Node built-ins and of any dependence on how the process was started (argv, a script path), so it
// imports cleanly into a browser, an edge runtime, a CommonJS script or `node -e`.

import { readFileSync } from 'node:fs'
import { deriveScaleTokens, ScaleRefused } from './scale_tokens.mjs'

const shape = JSON.parse(readFileSync(new URL('../contract/scale-shape.json', import.meta.url), 'utf8'))
const batch = JSON.parse(readFileSync(0, 'utf8'))
const out = batch.map((scales) => {
  try {
    return { tokens: deriveScaleTokens(shape, scales) }
  } catch (e) {
    if (e instanceof ScaleRefused) return { refused: e.message }
    throw e
  }
})
process.stdout.write(JSON.stringify(out))
