#!/usr/bin/env node
// The command line for layout_roles.mjs: a batch of declarations on stdin, a result for each on stdout.
//
//   node scripts/layout_roles_cli.mjs < batch.json   // [{ scales, overrides?, vocabulary?, shape?,
//                                                    //    tokens? }, ...] in,
//                                                    // [{ roles, tokens } | { refused, codes } |
//                                                    //  { contractError }, ...] out
//
// check_layout_roles.py calls this. It is not exported, so the exported module stays free of Node
// built-ins, as scale_tokens.mjs and its own command line are.

import { readFileSync } from 'node:fs'
import { ContractError, LayoutRefused, resolveLayoutRoles } from './layout_roles.mjs'
import { deriveScaleTokens, ScaleRefused } from './scale_tokens.mjs'

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'))
const vocabulary = read('../contract/vocabulary.json')
const shape = read('../contract/scale-shape.json')
const batch = JSON.parse(readFileSync(0, 'utf8'))
// An item may carry its own `vocabulary`, so a gate can show the implementation a doctored contract
// and see it refused as one; a contract it cannot read comes back as `contractError`, not a refusal.
const out = batch.map((item) => {
  try {
    // The scale's own refusal comes back under the code `scale`, before any role is resolved.
    // `tokens` is a hand-built list used in place of the derivation, and `shape` is the scale shape
    // the roles are resolved under while the tokens are still derived under the contract's: both
    // exist so the gate can hand the implementation tokens that do not match its shape.
    let tokens = item.tokens
    if (!tokens) try {
      tokens = deriveScaleTokens(shape, item.scales)
    } catch (e) {
      if (e instanceof ScaleRefused) return { refused: `scale: ${e.message}`, codes: ['scale'] }
      throw e
    }
    return resolveLayoutRoles(item.vocabulary ?? vocabulary, item.shape ?? shape, tokens, item.overrides ?? {})
  } catch (e) {
    if (e instanceof LayoutRefused) return { refused: e.message, codes: e.codes }
    if (e instanceof ContractError) return { contractError: e.message }
    throw e
  }
})
process.stdout.write(JSON.stringify(out))
