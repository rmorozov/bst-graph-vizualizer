kind: build
description: |
  PATHOLOGY (macro): openssl builds with autotools and does not need cmake,
  but carries a build-depends on base/cmake.bst. A false edge that adds a
  level to the critical path for nothing.
depends:
- base/toolchain.bst
- base/cmake.bst
