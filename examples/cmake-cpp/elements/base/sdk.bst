kind: compose
description: |
  PATHOLOGY (macro): a kitchen-sink "sdk" stack. Six elements depend on it,
  but each needs only one of its members. Any change to any member rebuilds
  all six consumers. Maximum blast radius, minimum justification.
depends:
- base/toolchain.bst
- base/cmake.bst
- base/python3.bst
- deps/zlib.bst
- deps/openssl.bst
- deps/libcurl.bst
