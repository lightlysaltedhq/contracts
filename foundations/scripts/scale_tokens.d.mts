// Types for scale_tokens.mjs, the package's `./scale-tokens` export.
//
//   import shape from '@lightlysaltedhq/design-foundations/scale-shape' with { type: 'json' }
//   import { deriveScaleTokens, ScaleRefused } from '@lightlysaltedhq/design-foundations/scale-tokens'
//   deriveScaleTokens(shape, scales)
// The ScaleToken interface is
// checked against the implementation's actual output on every run of check_scale_shape.py: every key
// it produces must be declared here with a matching type, every required key must be on every
// token, and every optional key must turn up. So these declarations cannot drift from the code.

/** Thrown for anything the contract forbids, and for a value in a shape no rule can read. */
export declare class ScaleRefused extends Error {}

/** contract/scale-shape.json, the `./scale-shape` export. */
export interface ScaleShape {
  families: Record<string, unknown>
  [key: string]: unknown
}

/** A value a scale supplies for one rung, or once for a scalar family. */
export type ScaleValue = string | number

/** A scale: families by name, each a value, a list (slots, or a derived family's rungs), or rungs by name. */
export type Scales = Record<string, ScaleValue | ScaleValue[] | Record<string, ScaleValue | ScaleValue[]>>

/** One derived token. Fields are in the order the documentation in scale_tokens.mjs gives them. */
export interface ScaleToken {
  property: string
  family: string
  rung?: string
  constant?: true
  type: string
  group: string
  value: string | number
  dark?: string | number
  expr?: string
  px?: string
  fluid?: Record<string, string | number>
}

/**
 * Every scale token for `scales`, in written order. Throws ScaleRefused for anything the contract
 * forbids, and when a family's `derive.of` is missing or anything but "exactDecimal": the rounding
 * applies to the exact decimal product, and a rule stated for another operand is never assumed.
 */
export declare function deriveScaleTokens(shape: ScaleShape, scales: Scales): ScaleToken[]
