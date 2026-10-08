// Types for type_tokens.mjs, the package's `./type-tokens` export. check_type_scale.py holds these
// declarations to the implementation on every run: the exported names must be exactly the ones
// declared here, and each interface below must describe what the functions actually return, key for
// key and type for type, with every required key present and every optional key seen. So the
// declarations cannot drift from the code.

/** Thrown for anything the contract forbids. `codes` are contract/type-scale.json's names for why. */
export declare class Refused extends Error {
  codes: string[]
}

/** Thrown when the contract asks for a rule this implementation does not run. */
export declare class ContractError extends Error {}

/** contract/type-scale.json, the `./type-scale` export. */
export type TypeScale = Record<string, unknown>

/** contract/vocabulary.json, the `./vocabulary` export. */
export type Vocabulary = Record<string, unknown>

/**
 * contract/scale-shape.json, the `./scale-shape` export, as imported: the same type
 * scale_tokens.d.mts gives it. Families such as `stagger` and `spaceBase` have no `steps`, so a
 * narrower type rejects the real file (TS2345); resolve() reads the type steps and the leading,
 * tracking and weight rungs from it and refuses nothing else.
 */
export interface ScaleShape {
  families: Record<string, unknown>
  [key: string]: unknown
}

/** A scale's inputs, contract/type-scale.json#inputs. */
export interface ScaleInputs {
  viewportMinPx: number
  viewportMaxPx: number
  baseMinRem: number
  baseMaxRem: number
  ratioMin: number
  ratioMax: number
  ratioBelow: number
  fluidFrom: number
  steps: string[]
}

/** A fluid step. Every number is a decimal string in the contract's notation. */
export interface FluidStep {
  kind: string
  minRem: string
  preferredRem: string
  preferredVw: string
  maxRem: string
}

/** A fixed step. */
export interface FixedStep {
  kind: string
  sizeRem: string
}

/** A type table. `viewports` is null only for an all-fixed table, which owes none. */
export interface Table {
  viewports: string[] | null
  steps: Record<string, FluidStep | FixedStep>
}

/** A text role as resolved: rung names, and the typography role it wears after the fallback chain. */
export interface Role {
  step: string
  leading: string
  tracking: string
  weight: string
  font: string
}

/** One text-role token, in emitted order. */
export interface TextRoleToken {
  id: string
  css: string
  type: string
  value: string
  role: string
  property: string
  overridden: boolean
}

/** What resolve returns. */
export interface Resolved {
  roles: Record<string, Role>
  tokens: TextRoleToken[]
  table: Table
}

/** A product: its scale in contract/scale-shape.json's families, and the typography and colour roles it emits. */
export interface Product {
  scale?: Record<string, unknown>
  fontRoles?: string[]
  colourRoles?: string[]
}

/** contract/type-scale.json#declaration. */
export type Declaration = Record<string, unknown>

/** The scale from its inputs. Throws Refused when the inputs or the derived table break the contract. */
export declare function derive(typeScale: TypeScale, inputs: ScaleInputs): Table

/** A product's own table, in the scale shape's type families, read and checked. */
export declare function parseTable(typeScale: TypeScale, families: Record<string, unknown>): Table

/** The value a consumer writes for --step-<name>. */
export declare function cssOf(typeScale: TypeScale, step: FluidStep | FixedStep): string

/** A table in the scale shape's type families. */
export declare function stepFamilies(typeScale: TypeScale, table: Table): Record<string, unknown>

/** The neutral rungs in the scale shape's families. */
export declare function neutralRungFamilies(typeScale: TypeScale): Record<string, Record<string, string | number>>

/** A product's declaration resolved to its text roles and tokens. Throws Refused naming every rule it breaks. */
export declare function resolve(vocabulary: Vocabulary, typeScale: TypeScale, scaleShape: ScaleShape,
  declaration: Declaration, product: Product): Resolved
