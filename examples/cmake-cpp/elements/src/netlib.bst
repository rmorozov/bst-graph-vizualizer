kind: build
description: |
  PATHOLOGY (macro): mirrors the C++ false dependency — netlib uses no mathlib
  symbol, but depends on it, so netlib cannot start until mathlib finishes.
depends:
- base/sdk.bst
- src/corelib.bst
- src/mathlib.bst
