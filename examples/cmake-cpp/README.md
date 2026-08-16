# `examples/cmake-cpp` — reference workload

A deliberately inefficient build, small enough to reason about and real enough
to measure. It exists so that claims about build optimization in this repo can
be checked with a stopwatch instead of argued about.

Two layers, mirroring how BuildStream projects are actually structured:

* **macro** — 15 BuildStream elements in `elements/` (base layers, third-party
  deps, source libraries, a stack).
* **micro** — a real CMake/C++ build (5 targets, 13 translation units) that one
  of those elements would compile.

Every pathology below is planted on purpose and marked in the source with a
`PATHOLOGY` comment.

## The planted problems

| # | Level | What | Costs |
| --- | --- | --- | --- |
| 1 | macro | `deps/openssl.bst` build-depends on `base/cmake.bst`; openssl uses autotools and does not need it | **60.0 s** of makespan |
| 2 | macro | `src/netlib.bst` depends on `src/mathlib.bst`; netlib uses no mathlib symbol | **1.1 s** of makespan |
| 3 | macro | `base/sdk.bst` is a kitchen sink: 6 consumers, each needs one member | 8 → 4 elements rebuilt per touch of openssl |
| 4 | micro | `corelib/core_all.hpp` is a god header included by 12 of 13 TUs | ≈ 400 ms per TU; ≈ 4.8 s of 16.7 s CPU work |
| 5 | micro | `netlib/protocol.cpp` includes `mathlib/linalg.hpp` and uses nothing from it | the `#include` mirror of #2 |
| 6 | micro | `tools/gen_tables.py` is a serial codegen step at the head of the build | 2.0 s that nothing can overlap |

Problems 1 and 2 are the important pair. **Both remove exactly one edge, and
both shorten the edge-counted critical path by exactly 1** — while being worth
60.0 s and 1.1 s respectively. Any tool that ranks by graph topology alone
cannot tell them apart. See [`../../docs/audit_2026-08.md`](../../docs/audit_2026-08.md) §4.1.

## Measured numbers

Recorded on a 4-core sandbox, g++ 13.3, ninja 1.11, `-j4`. Re-derive with the
commands below; exact values will differ, the ratios should not.

**Macro** (element durations: measured for `src/*`, estimated for base/deps):

```
total work            501.6 s
makespan (unbounded)  400.5 s      parallelism 1.25x
makespan (j=4)        400.5 s      -> latency-bound; more workers buy nothing
articulation points   base/toolchain.bst
```

| change | CP (edges) | makespan | saving |
| --- | --- | --- | --- |
| baseline | 10 | 400.5 s | — |
| cut `mathlib → netlib` | 9 | 399.4 s | 1.1 s |
| cut `cmake → openssl` | 9 | 340.5 s | 60.0 s |
| both, plus splitting `base/sdk.bst` | 8 | 334.0 s | 66.5 s |

**Micro** (the CMake build):

```
total CPU work in build steps   16.7 s
wall clock at j=4                4.0 s
codegen step                     2.0 s (serial head)
each TU                        ~0.5-0.7 s

compile hash.cpp with core_all.hpp   519 / 554 / 550 ms   (84,622 preprocessed lines)
the same TU with id.hpp only         149 / 163 / 149 ms   (25,269 preprocessed lines)

touch corelib/core_all.hpp     -> 17 ninja steps, 1796 ms
touch utillib/src/timeutil.cpp ->  3 ninja steps,  616 ms
```

## Reproducing

### The native build

```bash
cmake -G Ninja -S . -B build
ninja -C build -j4

# per-target durations
awk 'NR>1 && $4 !~ /^\// {printf "%7d ms  %s\n", $2-$1, $4}' build/.ninja_log | sort -rn

# header fan-in: how many TUs include each project header
ninja -C build -t deps | awk '/^[^ ].*: #deps/{tu=$1} / +\//{print $1}' \
  | grep -v '^/usr' | sort | uniq -c | sort -rn

# god-header cost, directly
g++ -std=c++17 -Ilibs/corelib/include -E libs/corelib/src/hash.cpp | wc -l
```

`DEMO_CODEGEN_DELAY` (default `2.0`) tunes the codegen step:
`cmake -DDEMO_CODEGEN_DELAY=0.5 ...`.

### The BuildStream layer

BuildStream is not required. `tools/bst-shim/bst` reads `elements/**/*.bst` and
reproduces the `bst show` invocations the specification describes:

```bash
export PATH="$PWD/tools/bst-shim:$PATH"
export BST_SHIM_PROJECT="$PWD"

bst show --deps all   --format '%{name}|%{kind}' app/stack.bst
bst show --deps build --format '%{name}|%{deps}' app/stack.bst
bst show app/stack.bst        # BuildStream's real default format
```

### Running the extractor against it

```bash
cd ../..                       # repo root
pip install networkx jsonschema        # not declared anywhere — see GAP-08
export PATH="$PWD/examples/cmake-cpp/tools/bst-shim:$PATH"
export BST_SHIM_PROJECT="$PWD/examples/cmake-cpp"

python3 -m bst_graph_extractor.cli app/stack.bst -o /tmp/graph.json -v
```

As of this writing that produces a **1-node, 0-edge** graph and exits `0`
(audit §3.1). `BST_SHIM_LEGACY=1` makes the shim emit the invented grammar the
parser actually expects, which gets you a correct 15-node/32-edge graph with
every per-node metric still empty (audit §3.3):

```bash
BST_SHIM_LEGACY=1 python3 -m bst_graph_extractor.cli app/stack.bst \
    --include-runtime --expensive-metrics -o /tmp/macro.json
```

`BST_SHIM_LEGACY` is a workaround for a bug, not a BuildStream format. It
should be deleted once `GAP-01` lands.

## Files

```
CMakeLists.txt              5 targets, the false PUBLIC link on netlib
project.conf                BuildStream project file
elements/                   15 .bst elements, 3 planted macro pathologies
libs/corelib/               the god header + its unused lean alternative
libs/{mathlib,netlib,utillib}/
app/                        demo_app
tools/gen_tables.py         the serial codegen head
tools/bst-shim/bst          stand-in for `bst show`, no BuildStream needed
```
