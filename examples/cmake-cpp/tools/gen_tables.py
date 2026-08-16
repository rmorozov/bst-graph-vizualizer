#!/usr/bin/env python3
"""Codegen step: emits corelib/generated_tables.hpp.

PATHOLOGY (macro level): this is a single serial step at the head of the whole
build. Nothing can compile until it finishes, and it is deliberately slow
(sleep) to model a real codegen/protoc/moc stage.
"""
import sys, time, pathlib

out = pathlib.Path(sys.argv[1])
delay = float(sys.argv[2]) if len(sys.argv) > 2 else 2.0
time.sleep(delay)
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(
    "#pragma once\n"
    "namespace core { inline constexpr unsigned long long kTableSalt = 0x9E3779B97F4A7C15ull; }\n"
)
print(f"generated {out}")
