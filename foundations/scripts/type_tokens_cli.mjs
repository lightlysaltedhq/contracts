#!/usr/bin/env node
// The command line of ./type-tokens, kept out of the exported module so that the module imports
// nothing and reads no argv: a module that ran a CLI on import whenever argv[1] looked like its own
// path would run inside a consumer's bundle. emit.py and the gates call this; a product imports
// scripts/type_tokens.mjs instead.
//
//   node scripts/type_tokens_cli.mjs < batch.json
//   in:  [{ derive } | { table } | { stepFamilies } | { neutralRungFamilies } | { resolve, shape, product }]
//   out: [{ steps } | { families } | { roles, tokens } | { refused }], one result per job, in order,
//        `steps` being { [stepName]: css } as contract/type-vectors.json holds it.

import { readFileSync } from 'node:fs'
import {
  Refused, ContractError, derive, parseTable, cssOf, stepFamilies, neutralRungFamilies, resolve,
} from './type_tokens.mjs'

const read = (name) => JSON.parse(readFileSync(new URL(`../contract/${name}`, import.meta.url), 'utf8'))
const vocab = read('vocabulary.json')
const ts = read('type-scale.json')
const css = (table) => Object.fromEntries(Object.entries(table.steps)
  .sort(([a], [b]) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
  .map(([name, step]) => [name, cssOf(ts, step)]))

const out = JSON.parse(readFileSync(0, 'utf8')).map((job) => {
  try {
    if ('derive' in job) return { steps: css(derive(ts, job.derive)) }
    if ('table' in job) return { steps: css(parseTable(ts, job.table)) }
    if ('stepFamilies' in job) return { families: stepFamilies(ts, derive(ts, job.stepFamilies)) }
    if ('neutralRungFamilies' in job) return { families: neutralRungFamilies(ts) }
    if ('resolve' in job) {
      const { roles, tokens } = resolve(vocab, ts, job.shape, job.resolve, job.product)
      return { roles, tokens }
    }
    throw new ContractError(`a job is { derive }, { table }, { stepFamilies }, { neutralRungFamilies } or { resolve }, not ${Object.keys(job)}`)
  } catch (e) {
    if (e instanceof Refused) return { refused: e.codes }
    throw e
  }
})
process.stdout.write(JSON.stringify(out))
