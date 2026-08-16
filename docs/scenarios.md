# Backlog

Work items for this repo. Derived from [`audit_2026-08.md`](audit_2026-08.md)
(claims vs reality, plus a full macro→micro optimization walkthrough against
`examples/cmake-cpp/`) and [`design_directions.md`](design_directions.md)
(target architecture and the two usage scenarios).

**Relationship to `conformance_review.md`:** that document already carries
`R0`–`R25`, remediation tasks for *implementation vs specification* defects.
Those are not restated here. This backlog adds what that review could not see,
because it audited against the spec rather than against the job:

| Prefix | Track | Question |
| --- | --- | --- |
| `GAP` | blockers found by *using* the tool | why can't I run this at all? |
| `OPT` | build-optimization capability | why can't this tell me what to fix? |
| `CI` | CI efficiency gate | why can't this stop a regression? |
| `UX` | surfaces (CLI, viewer, reports) | why can't I act on the answer? |
| `PRJ` | project hygiene / positioning | why did nobody notice? |

Priority: **P0** blocks everything · **P1** the tool is not useful without it ·
**P2** substantial value · **P3** worth doing eventually.

Every item states its evidence, so nothing here is speculative.

---

## GAP — the tool cannot currently be used

### GAP-01 · P0 · Implement the real `bst show` contract
The extractor invokes a bare `bst show TARGET` and parses an invented grammar
that BuildStream never emits. Fed the spec's *own* documented formats, the
parser returns 0 edges for both — there is no invocation of the real CLI from
which this tool can obtain a dependency graph.
*Evidence:* audit §3.2. *Related:* `R5` (same finding from the spec side).
* Implement the three §3.2 invocations, including the `%{deps}` list form
  `[a, b, c]` — the only one carrying edges.
* `--include-runtime` must actually change which invocation runs (dead flag today).
* Acceptance: against `examples/cmake-cpp`, `bst show --deps all/build/run`
  output yields 15 nodes / 31 build edges / 1 runtime edge, with no shim
  compatibility mode.
* Acceptance: a golden-file test per format, so the contract cannot drift.

### GAP-02 · P0 · Fail closed on parse loss
A 15-element project parsed to a **1-node, 0-edge** graph, and the tool exited
`0` reporting "validation passed" and "completed successfully". Cause:
`parser.py:96-100` catches every exception per line and `continue`s, so
dropping 100% of input is indistinguishable from dropping none.
*Evidence:* audit §3.1. Directly violates spec principle 9 ("Fail Closed").
* Count parsed/dropped lines; ERROR + exit 1 above a threshold (any drop with
  zero edges produced is unambiguous).
* Promote `--show-invalid` from opt-in to default-on for the summary line
  ("parsed 15/15 lines, 0 dropped").
* Sanity assertions before write: `nodes ≈ input lines`; a multi-line input
  producing one node is an error, not an output.
* Acceptance: the audit §3.1 reproduction exits non-zero with a message naming
  the format mismatch.

### GAP-03 · P1 · Remove module-global parser state
`parser.py` keys `_current_node_context` by line number in a module-level dict
that persists across calls. A second parse in the same process fabricates edges
from the first parse's leftovers.
*Evidence:* executed — parsing `"- ghost.bst\n- ghost2.bst"` after an unrelated
parse yields `0 nodes` and an edge `ghost2.bst → a.bst`, where `a.bst` came
from the *previous* input.
* Make parse state local to the call.
* Acceptance: a regression test parsing two unrelated inputs in one process;
  the second produces zero edges.

### GAP-04 · P0 · Metrics must reach the output *(= `R1`)*
Every per-node metric is a default in real output: `topoLayer 0`, `isCritical
false`, `blastRadius null`, `levelCounts {'0': 15}` — including
`isArticulationPoint: false` on the graph's only articulation point.
`assemble_output(..., node_metrics={})` discards everything computed upstream.
*Evidence:* audit §3.3. Highest-leverage single fix in the repo.

### GAP-05 · P1 · Fix edge direction, then pin it
`parser.py:159` emits `source=dependency, target=dependent`; spec §3.4.1's
example is the reverse. Since `blastRadius` is defined as downstream-reachable
and `buildCost` as upstream-reachable, the two silently swap meaning.
*Evidence:* audit §3.4.
* Pick a direction, state it in the schema description, assert it in a test.
* Acceptance: on the example, `buildCost(app/stack.bst) == 14` and
  `blastRadius(app/stack.bst) == 0` — the app depends on everything and nothing
  depends on it.

### GAP-06 · P1 · A consumer for the output must exist *(= `R13`, `R25`)*
No HTML file, no bundler, no `package.json`; `import('./viewer/main.js')` fails
with `SyntaxError` (TypeScript syntax in `.js` files). Extraction output has no
consumer at all. Until `UX-01` lands, a text report is the minimum viable one.

### GAP-07 · P1 · Offline input mode
The extractor can only shell out to `bst`. There is no way to feed a saved
dump, replay a fixture, or run in a container without BuildStream — which
blocks CI, blocks testing, and blocked this audit (a shim had to be written,
`examples/cmake-cpp/tools/bst-shim/`).
* `--from-dump FILE` (raw `bst show` capture), `--from-json FILE` (a previous
  extraction), `--dump-raw FILE` (save what was captured).
* Acceptance: the full test suite runs with no `bst` on `PATH`.

### GAP-08 · P0 · Dependency manifest and a test runner *(= `R0`, `R3.1`)*
No `requirements.txt`/`pyproject.toml`; `networkx` and `jsonschema` are
imported undeclared. Zero test files in the repo. This is *why* everything
above shipped as "COMPLETE".

### GAP-09 · P2 · Delete or regenerate `IMPLEMENTATION_STATUS.md` *(= `R12`)*
It claims Phases 0–5 complete, lists flags that do not exist, and is the reason
a reader would not go looking for any of the above. Either delete it or derive
it from a passing test suite.

---

## OPT — make it a build-optimization tool

The tool models topology. Optimization is about time, cache behaviour, and
counterfactuals. See `design_directions.md` §1–§2 for the model these items
build toward.

### OPT-01 · P1 · Cost model with provenance
Add per-node `cost {durationMs, provenance, samples, p50, p90, source}` where
`provenance ∈ {measured, modelled, assumed, unknown}`. `unknown` is never
coerced to `0`; any aggregate containing an `unknown` says so.
*Why:* there is no duration field anywhere in the current schema, so no
question about build *time* is answerable.
* Acceptance: an aggregate over a graph with one unknown-cost node reports the
  aggregate as incomplete rather than emitting a smaller number.

### OPT-02 · P1 · Ingest real element durations
Sources: `bst build` logs, `bst show --format '%{state}'`, timing from a
`--profile` run. Persist as a cost-model artifact keyed by element **cache
key**, so unchanged elements reuse their historical duration.
*Why:* also the foundation of the noise-free CI gate (`CI-04`).

### OPT-03 · P1 · Scheduler: makespan, slack, parallelism
Implement `makespan(∞)`, `makespan(j)` via list-schedule simulation, per-node
`slack`, and `parallelism = totalWork / makespan(∞)`. Report all four.
*Why:* the audit's central result — two one-edge fixes, both shortening the
edge-counted critical path by 1, worth 1.1 s and 60.0 s. Only a time-weighted
scheduler separates them. On the example this also yields "M(4) == M(∞), the
build is latency-bound, more workers buy nothing" — currently unreachable.
* Acceptance: on `examples/cmake-cpp`, reproduce `W=501.6s`, `M∞=400.5s`,
  `P=1.25x`, and rank `cut cmake→openssl` above `cut mathlib→netlib`.
* Acceptance: `slack` is 0 for exactly the nodes on the time-critical chain.

### OPT-04 · P1 · Cache-expected cost
`expectedMs = durationMs × P(miss)`, with `P(miss)` from observed history.
Rank by *expected* cost by default, with cold-build cost available separately.
*Why:* `base/toolchain.bst` is the example's most expensive element, its only
articulation point, and its highest-degree hub — and it changes twice a year.
Every metric the tool has today ranks it first; its expected contribution to a
normal run is ≈ 0. This is the single largest source of wrong advice.

### OPT-05 · P2 · Retire edge-counted critical path as a headline metric
Keep `cpDepth`/`cpHeight` as structural descriptors, but stop calling the
edge-counted longest path "critical path" in user-facing output once `OPT-03`
lands. Two different quantities under one name is how the 1.1 s/60 s confusion
survives.

### OPT-06 · P1 · Counterfactual engine
`whatif(graph, costs, ops) → Δmakespan, Δblast-radius`, for: cut edge, split
element, add worker, make element cacheable, move work off the critical chain.
*Why:* statistics describe, counterfactuals instruct. This is the product.
* Acceptance: `cut base/cmake.bst→deps/openssl.bst` predicts −60.0 s;
  `cut src/mathlib.bst→src/netlib.bst` predicts −1.1 s.
* Acceptance: sub-second for a single op on a 10k-node graph (it is interactive).

### OPT-07 · P1 · Edge evidence — which dependencies are real
Classify each edge: `used-symbols`, `used-headers`, `declared-only`,
`unknown`. Derive from `ninja -t deps` (headers) and `nm`/linker maps (symbols).
*Why:* turns "here is a long chain" into "here is an edge you can delete."
Both planted false edges in the example are `declared-only`.
* Acceptance: on the example, `mathlib→netlib` and `cmake→openssl` classify as
  `declared-only`; `corelib→mathlib` does not.

### OPT-08 · P2 · Ranked worklist as the primary output
Top-N proposed changes with predicted saving, evidence, and confidence. Sorted
by saving, filtered by provenance. Not a canvas — a list of 20 rows.

### OPT-09 · P2 · `recoverableMs` — quantify the room for optimization
`Σ` predicted saving over independently-safe operations. This is the "room for
optimization" the CI scenario gates on (`CI-05`), and the number a local user
wants first: *is it worth my afternoon?*
* Must handle interaction: two fixes on the same chain do not add up. Compute
  greedily with re-simulation, and report as a bound, not a promise.

### OPT-10 · P1 · Ninja adapter — durations and the native DAG
Parse `.ninja_log` (start/end ms per target) and `ninja -t graph`/`-t deps`.
*Why:* the micro level, entirely absent today. This data is free and sitting in
every build directory.
* Acceptance: reproduce the example's per-target table (codegen 2026 ms,
  registry.cpp.o 728 ms, …) and `total CPU work 16.7 s / wall 4.0 s at j=4`.

### OPT-11 · P2 · CMake adapter
`compile_commands.json` for per-TU flags and include paths; the CMake file API
for the target graph. Enables flag-level findings (missing PCH, no unity build,
`-O2` on a debug build).

### OPT-12 · P1 · Header analysis — the micro pathology
From `ninja -t deps`, build the header→TU graph and rank headers by
`fan-in × cost`.
*Why:* in the example, `corelib/core_all.hpp` is included by 12 of 13 TUs at
≈ 400 ms each — ≈ 4.8 s of 16.7 s of CPU work — and touching it costs 1796 ms
of rebuild versus 616 ms for a leaf `.cpp`. At the element level `src/corelib.bst`
looks like a harmless 2 s element.
* Acceptance: rank `core_all.hpp` first, report its fan-in, marginal cost, and
  incremental rebuild cost.
* Acceptance: report the measured cost delta of the lean alternative
  (550 ms → 150 ms per TU with `id.hpp`).

### OPT-13 · P2 · Generic graph interface + adapters
One engine over `load_graph`/`load_costs`; BuildStream, Ninja, CMake behind it.
*Why:* macro and micro are the same math at two zoom levels. Drill-down should
be free rather than a second implementation.

### OPT-14 · P3 · Compiler-internal cost
`-ftime-trace` (clang) / `-ftime-report` (gcc) for intra-TU attribution —
which template instantiation, which header, which pass.

### OPT-15 · P2 · Model BuildStream's actual scheduler
`bst build` has its own concurrency model (fetch/build/push queues, `--jobs`,
per-element parallelism). Makespan estimates that ignore it will be wrong in a
direction the user cannot predict. Validate the simulation against a real
`bst build` wall-clock before anyone gates on it.

---

## CI — the efficiency gate

Design and rationale in `design_directions.md` §4. The requirement being
implemented: *absolute time may grow; adding elements is normal; adding them
in an unoptimized way is not.*

### CI-01 · P1 · Baseline artifact
Every main-branch build publishes `profile.json` — graph, cost model,
provenance, cache rates, scheduler results, ratios — retained as a time series.
Everything else in this track reads it, and Scenario A pulls it instead of
profiling locally.

### CI-02 · P2 · Trend analytics
Per-element cost history, cache-hit-rate drift, parallelism over time,
graph-size over time. The "gather analytics" half of the CI scenario, and
non-blocking.

### CI-03 · P1 · Comparison mode
`bstopt compare baseline.json candidate.json` → structural diff (added/removed
elements and edges) plus metric deltas. No verdict yet — just the diff.

### CI-04 · P0-for-the-gate · Freeze the cost model when comparing
Compare the PR graph against the baseline using **the baseline's cost model**,
reusing each unchanged element's historical duration by cache key. Structure
varies, cost is held constant; only genuinely changed elements need fresh
measurement.
*Why:* CI timing noise is what kills build-time gates. Holding cost constant
makes the verdict deterministic and reproducible, and makes a failure
re-checkable offline.

### CI-05 · P1 · Inefficiency ratios
Compute and record: parallelism `P = W/M∞`; parallel efficiency
`E(j) = W/(j·M(j))`; critical concentration (share of `M∞` in zero-slack
nodes); blast-radius index (mean rebuild fan-out over frequently-touched
elements); recoverable share (`recoverableMs / M∞`).
*Why:* these are normalized — they do not move when a build legitimately grows,
which is exactly the property the gate needs.

### CI-06 · P1 · The marginal efficiency gate
For a change adding `ΔW` work and `ΔM∞` makespan, compute `ρ = ΔW / ΔM∞` and
fail when `ρ < θ × P_baseline`.
*Why:* the precise formalisation of "you may add work, but not serially."
`ρ ≈ 1` means the new work is a serial chain; `ρ ≥ P_baseline` means it is at
least as parallel as the build already is, and passes regardless of size.
* Acceptance: a synthetic PR adding 200 s of independent parallel work passes;
  one adding 30 s chained onto the critical path fails.
* Acceptance: the verdict is reproducible offline from the two artifacts.

### CI-07 · P1 · Per-change attribution in the failure message
A failing ratio is not actionable. Name the specific new edge or element, its
own Δmakespan, its evidence class, and what removing it would restore. See
`design_directions.md` §4.3 step 4 for the target message.

### CI-08 · P2 · Policy file and escape hatches
`.build-budget.yml`: job count, thresholds, `unknown_cost_policy: fail|warn`,
expiring per-element allowances, and a warn-only mode for rollout.
*Why:* a gate with no override gets deleted the first time it blocks a release.
An expiry date on every allowance is what stops the allowlist becoming the
policy.

### CI-09 · P2 · PR comment surface
Verdict, ranked worklist, deltas, and a link to the full artifact. The CI
scenario needs an exit code and a comment — not a canvas.

### CI-10 · P3 · Bot-proofing
Rate-limit comments, collapse repeats, tolerate force-pushes and rebases,
degrade gracefully when the baseline is missing (warn, never fail-open silently).

---

## UX — surfaces

### UX-01 · P1 · `report` command — text first
A terminal report: `W`, `M∞`, `M(j)`, parallelism, the critical chain, and the
top-N worklist. Ship before any rendering work.
*Why:* it makes the whole pipeline useful without the viewer, and it is the CI
comment body for free.

### UX-02 · P2 · Re-point the viewer at cost and slack
Node size = `expectedMs`; fill = slack; stroke = time-critical chain; edge
highlight = Δmakespan if cut; combo aggregate = Σ cost and Σ recoverable.
Keep the existing spec's honesty and progressive-disclosure principles.

### UX-03 · P2 · Two views that matter: critical chain, and blast radius of one element
Both are small subgraphs (10–40 nodes). They answer the two questions users
actually ask, and neither needs the 100k-node envelope.

### UX-04 · P2 · Drill-down macro → micro
Click an element, open its native build graph with the same metrics. Depends on
`OPT-10`/`OPT-13`.

### UX-05 · P3 · Park the extreme/ultra render tiers
Adaptive quality, viewport culling, and the `extreme`/`ultra` modes are the
most complex part of the current spec and serve neither scenario. Defer until a
real project produces a graph that needs them.

---

## PRJ — project

### PRJ-01 · P1 · Write a README that says what this is
The README is one line: the repo name. A reader cannot tell whether this is a
visualizer or an optimizer — and the audit found the answer is "neither, yet."

### PRJ-02 · P1 · Decide the product question
Large-graph visualizer, or build-efficiency tool? See `audit_2026-08.md` §5.
They want different work, and ~70% of the current spec's complexity serves the
first. Recommendation there: the second, with the viewer as one surface.
Whichever is chosen, write it down — this backlog assumes the second.

### PRJ-03 · P2 · Keep `examples/cmake-cpp` as the reference workload
It has known, planted, *quantified* pathologies (a 60 s false edge, a 1.1 s
false edge, a 12-TU god header) with reproduction commands. Every `OPT`/`CI`
item above cites numbers from it, so it doubles as the acceptance fixture.
* Add a larger generated variant (200+ elements) once `OPT-03` lands, for
  scale testing that the current 5 fixtures cannot provide.

### PRJ-04 · P2 · One honesty test, run in CI
The pattern behind every finding in both reviews is *plausible output that is
silently wrong*. Add a test class that asserts the tool refuses rather than
guesses: unparseable input → non-zero exit; unknown cost → no aggregate;
missing baseline → warn, never a silent pass.
