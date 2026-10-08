# contracts

Lightly Salted's public contracts. Each package here holds rules and never a brand's values.

- `foundations/` → `@lightlysaltedhq/design-foundations`: the design-system contract (tier model,
  role vocabulary, OKLCH derivation, scales, typography).
- `salt-contract/` → `@lightlysaltedhq/salt-contract`: the platform-neutral Salt contract that Salt
  for Next.js and Salt for WordPress both conform to. Drafting at 0.x; first release 1.0.0.

`npm ci && npm run verify` runs every gate.
