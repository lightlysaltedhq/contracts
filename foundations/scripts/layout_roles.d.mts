// Types for layout_roles.mjs, the package's `./layout-roles` export. LayoutEnd and LayoutToken are
// checked against the implementation's actual output on every run of check_layout_roles.py: every
// key it produces must be declared here with a matching type, every required key must be present,
// and every optional key must turn up. So these declarations cannot drift from the code.

import type { ScaleShape, ScaleToken } from './scale_tokens.mjs'

/** Thrown for a declaration the contract refuses. `codes` names each failure: an invariant id (L1…),
 *  or `unknownRole`, `unknownEnd`, `unknownRung`, `declaration`, `unrankable`. */
export declare class LayoutRefused extends Error {
  constructor(codes: string[], detail: string)
  readonly codes: string[]
}

/** Thrown for a contract this implementation cannot read: a vocabulary with no readable `layoutRoles`,
 *  or an invariant of an unknown kind. */
export declare class ContractError extends Error {}

/** contract/vocabulary.json, the `./vocabulary` export; only `layoutRoles` is read. */
export interface Vocabulary {
  layoutRoles: unknown
  [key: string]: unknown
}

/** A product's overrides: for any role, another rung of the role's family for either end. */
export type LayoutOverrides = Record<string, Partial<Record<string, string>>>

/** One end of one role, resolved: its rung, that rung's property and value, and the value in CSS px.
 *  A value is always a px or rem length here; anything else is refused as `unrankable`. */
export interface LayoutEnd {
  rung: string
  property: string
  value: string
  px: string
}

/** One emitted end: a custom property whose value references the rung's own property. */
export interface LayoutToken {
  property: string
  value: string
  role: string
  end: string
}

export interface LayoutRoles {
  roles: Record<string, Record<string, LayoutEnd>>
  tokens: LayoutToken[]
}

/**
 * The contract's layout roles, with any overrides, resolved against the tokens deriveScaleTokens
 * returns for the product's scale:
 *
 *   resolveLayoutRoles(vocabulary, shape, deriveScaleTokens(shape, scales), overrides)
 *
 * Throws LayoutRefused naming every invariant that fails, and ContractError for a vocabulary it
 * cannot read. A scale the scale shape refuses is refused by deriveScaleTokens, before this runs.
 */
export declare function resolveLayoutRoles(vocabulary: Vocabulary, shape: ScaleShape,
  scaleTokens: ScaleToken[], overrides?: LayoutOverrides): LayoutRoles
