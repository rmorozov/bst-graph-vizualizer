# BuildStream Graph Toolkit — Implementation Plan
**Companion to:** `docs/implementation_plan.md`
**Purpose:** turn the spec into an ordered set of small, independently implementable and testable units, on an architecture optimized for diagnosing problems quickly — since the two most expensive failure modes in this project are (a) a contract drift between extractor and viewer that only surfaces as a confusing render bug, and (b) a performance regression at 50k–300k nodes that's invisible at the 500-node scale most manual testing happens at.

---

## 1. Architecture — designed to be diagnosable, not just correct

### 1.1 The one decision that matters most: a shared, validated contract

Both tools currently agree on the JSON shape only via prose in the spec. That's the single biggest source of "worked in my test, broke on theirs" bugs in a two-process pipeline. Fix: **`graph_data.schema.json` is a build artifact in its own right**, versioned alongside `metadata.schemaVersion`, and both tools import/validate against the *same file* (Tool 1 via a Python JSON Schema library at serialize time; Tool 2 via a bundled copy at load time, kept in sync by a build-step checksum check). Any contract change is a schema change, reviewable as a diff, and any drift is a validation failure at the boundary — not a rendering bug three layers deep.

### 1.2 Tool 1 internal structure (Python)

```
bst_graph_extractor/
  cli.py                  — argument parsing, precedence rules, exit codes, top-level try/except → ERROR log + exit 1
  logging_config.py       — -v/-q wiring, "LEVEL [stage] message" formatter
  bst_interface.py        — subprocess boundary: ALL bst-show failure modes caught here, nowhere else
  parser.py               — raw text → node/edge records; malformed-line warnings
  graph_builder.py        — nx.DiGraph construction, duplicate/self-loop/undeclared-ref detection
  scc.py                  — condensation, cycle flags
  metrics/
    cheap.py              — degree, topoLayer, levelCounts, density, maxConcurrencyWidth
    reachability.py       — exact bitset closure, memory guard, targeted-mode fallback
    betweenness.py        — tiered, timeout-guarded
    articulation.py        — tiered, timeout-guarded
    critical_path.py      — cpDepth/cpHeight, both-endpoints-critical edge rule
    timeout_guard.py       — shared wall-clock timeout wrapper used by betweenness/articulation
  combo_aggregator.py     — combo tree + per-metric aggregates (null-skip)
  layout.py               — graphviz wrapper; hard-errors on missing dependency
  styler.py                — deterministic color/style precomputation
  schema/
    graph_data.schema.json — the shared contract (also copied into Tool 2's bundle at build time)
  serializer.py            — assembles final JSON, self-validates against schema, atomic temp-file+rename write
  fixtures/                — synthetic test graphs (empty, single-node, self-loop, cyclic, 10k/50k/100k) — shared with Tool 2's test suite
```

**Why this shape helps diagnosis specifically:** every metric lives in its own file with one clear success/degraded/disabled/timeout output contract (an enum + optional value), so "why is `blastRadius` null on this node" always has exactly one file to check. `bst_interface.py` is the *only* place subprocess errors are caught — a bug report that says "extraction failed" always points to one module. `serializer.py` self-validating means a broken extractor can never silently hand the viewer team a bad fixture to chase.

### 1.3 Tool 2 internal structure (JS, bundled into the single static HTML at build time)

```
viewer/
  core/
    schema-validate.js    — validates against the bundled copy of graph_data.schema.json
    state-store.js        — single source of truth: filters, selection, mode, viewport — exposes a dumpState() used by the diagnostic report
    indexes.js            — all §4.3 indexes; comboBounds/comboSpatialIndex explicitly gated on layout-ready
    modes.js              — datasetMode (fixed) + renderMode (recomputed on visible-set change)
    resolver.js           — §4.4.1 Uint8Array mask resolver
    combo-depth.js        — §4.5.1 adaptive depth walk (also reused by breadcrumb collapse)
  render/
    g6-adapter.js         — G6 setup + render cycle wrapped in an error boundary → safe-mode fallback
    lod.js                — LOD tier rules, critical-edge exemption, label priority
    edges.js              — aggregation, partial-criticality sub-labels, budgeted thinning
    styles.js             — fill/stroke priority, heatmap (incl. combo aggregates), critical/heatmap color swap
  interaction/
    hover.js              — unsorted, budget 200
    selection.js          — prioritized truncation, dangling-edge drop
    search.js             — trigram index, budgeted ancestor expansion
    sliders.js            — RAF throttling, targeted-mode notes
    breadcrumb.js          — click behavior, filter-persistence, budget clamp
    combo-expand.js        — confirmation dialog, 4 options, empty-critical-path disable
  perf/
    culling.js             — spatialIndex/comboSpatialIndex viewport queries
    adaptive-quality.js    — FPS monitor, degrade/recover with interaction-gated recovery
    logger.js              — ring-buffer structured logger + diagnostic report export
  ui/
    file-loader.js         — validate-before-swap, large-file warning
    legend.js, tooltip.js, filter-indicator.js, analytics-panel.js, diagnostics-panel.js
  main.js                  — wiring only; no logic lives here
  fixtures/                 — symlinked/copied from Tool 1's fixtures/ for shared test data
```

**Why this shape helps diagnosis specifically:** `state-store.js` being the *only* place mutable interaction state lives means the diagnostic report is one function call away from complete, not an ad-hoc collection of globals. The render cycle's error boundary means a G6 internal bug degrades to safe mode instead of a blank tab with no signal. Splitting `resolver.js` from the per-dimension filter modules means a "wrong nodes visible" bug is always either "the mask for dimension X is wrong" (check that one interaction file) or "the AND pass is wrong" (check resolver.js) — never both at once.

### 1.4 Cross-cutting: fixtures as the shared diagnostic substrate

A single fixture generator (seeded, deterministic) produces every scenario named in spec §7 — empty, single-node, self-loop-only, fully-cyclic, partially-cyclic, high-degree-hub, and synthetic 10k/50k/100k graphs at configurable density and cycle ratio — as both `bst show`-shaped text (for Tool 1's parser tests) and pre-built schema-valid JSON (for Tool 2's tests, so Tool 2 development is never blocked on Tool 1 being finished). This is the difference between "we think it handles 100k nodes" and "here's the exact fixture and the exact numbers from the last time we ran it."

---

## 2. Task List

Each task lists: **Depends on**, **Deliverable**, **Acceptance Criteria** (the test-first contract for the task). Tasks are sized to be a single focused implementation session each. Phase 0 blocks everything; within a phase, tasks are largely independent of each other and can be parallelized; Phase 1 and Phase 2-core can proceed in parallel once Phase 0 is done, since Tool 2 can develop against fixture JSON without a working extractor.

### Phase 0 — Shared Contracts (blocks everything downstream)

**T0.1 — JSON Schema for the output contract**
Depends on: nothing.
Deliverable: `schema/graph_data.schema.json` covering metadata/nodes/edges/combos exactly as in spec §3.4, including all enums (`reachabilityMode`, `bottleneckMetric`, `articulationSemantics`, `graphSizeClass`, `analysisModes.*`) and nullable-field rules.
Acceptance criteria:
- [ ] Validates the example payload in spec §3.4.1 without error.
- [ ] Rejects each of: missing `schemaVersion`, `blastRadius` as a string, `graphSizeClass` outside the enum, negative `totalNodes`, an edge referencing a non-existent node id — each with a distinct, field-identifying error message.
- [ ] Schema file itself is valid JSON Schema (validated by a meta-schema check).

**T0.2 — Fixture generator**
Depends on: T0.1.
Deliverable: seeded, deterministic generator producing every scenario in spec §7 (empty, single-node, self-loop, fully/partially cyclic, disconnected, high-degree hub, nested combos, 10k/50k/100k at configurable density) in both `bst show`-shaped text and schema-valid JSON form.
Acceptance criteria:
- [ ] Same seed → byte-identical output across two runs.
- [ ] Every generated JSON fixture validates against T0.1's schema.
- [ ] A named scenario (e.g. `fixtures.self_loop_hub()`) is retrievable by name from both Tool 1 and Tool 2 test suites without duplicated fixture code.

**T0.3 — Logging line-format convention**
Depends on: nothing.
Deliverable: one-page convention doc: `LEVEL [stage] message` for Python stderr and `{level, module, message, context, timestamp}` for the JS ring buffer, plus the fixed set of stage/module names both tools will use (so a WARNING about "reachability" means the same thing in both logs).
Acceptance criteria:
- [ ] Every stage/module name referenced anywhere in spec §3.5/§4.11 appears in this doc.
- [ ] Both `logging_config.py` and `perf/logger.js` (built in later tasks) are reviewed against this doc before merging.

---

### Phase 1 — Tool 1: Extractor

**T1.1 — CLI scaffold, argument parsing, exit codes**
Depends on: T0.3.
Deliverable: `cli.py` parsing every flag in spec §3.1; enforces `--no-betweenness` > `--expensive-metrics` precedence; validates flag combinations.
Acceptance criteria:
- [ ] Every documented flag is parsed; `--help` output matches the spec's flag list exactly.
- [ ] `--no-betweenness --expensive-metrics` together → betweenness disabled (precedence test).
- [ ] Invalid/unknown flag → exit code 2.
- [ ] Missing required `TARGET` → exit code 2 with a usage message.

**T1.2 — `bst show` subprocess wrapper**
Depends on: T1.1.
Deliverable: `bst_interface.py`, the sole boundary for subprocess errors.
Acceptance criteria:
- [ ] Mocked "binary not found" → ERROR log naming the binary, exit 1, no output file created.
- [ ] Mocked non-zero exit → ERROR log including exit code + stderr tail, exit 1, no output file.
- [ ] Mocked empty/garbled stdout → ERROR log, exit 1, distinguished in the log message from a legitimately empty graph.
- [ ] Legitimate empty-graph response → proceeds normally (not treated as an error).

**T1.3 — Parser**
Depends on: T1.2, T0.2.
Deliverable: `parser.py`.
Acceptance criteria:
- [ ] Table-driven test over T0.2 fixtures covers: normal record, `[]` empty deps, malformed line (→ WARNING with `--show-invalid`, silent without it), duplicate build+runtime edge → `depType: "both"`, self-loop record, reference to an undeclared node → WARNING.
- [ ] Empty-graph fixture → zero node/edge records, no exception.

**T1.4 — Graph builder**
Depends on: T1.3.
Deliverable: `graph_builder.py`.
Acceptance criteria:
- [ ] Node/edge counts from the built `nx.DiGraph` match parser output exactly across 5 T0.2 fixtures.
- [ ] Self-loop fixture produces a graph with the self-loop edge present (not silently dropped).

**T1.5 — SCC condensation**
Depends on: T1.4.
Deliverable: `scc.py`.
Acceptance criteria:
- [ ] Fully-cyclic fixture → single SCC, every node `isCycle: true`.
- [ ] Fully-acyclic fixture → every node its own SCC, `isCycle: false`.
- [ ] Self-loop-only-cycle fixture → correctly flagged cyclic even though the graph is otherwise a DAG.

**T1.6 — Cheap metrics**
Depends on: T1.5.
Deliverable: `metrics/cheap.py`.
Acceptance criteria:
- [ ] `inDegree`/`outDegree`/`topoLayer`/`density`/`maxConcurrencyWidth` hand-verified against 3 small fixtures.
- [ ] All nodes within one SCC share identical `topoLayer`.
- [ ] Empty-graph fixture → `maxConcurrencyWidth: 0`, `maxTopoLayer: 0`, `density: 0`, no division-by-zero exception.
- [ ] Regression guard: 50k-node fixture completes this stage in under a documented time budget (informational, not a hard spec gate).

**T1.7 — Reachability (exact / targeted / memory guard)**
Depends on: T1.6.
Deliverable: `metrics/reachability.py`.
Acceptance criteria:
- [ ] Exact mode matches brute-force `nx.descendants`/`nx.ancestors` on a small fixture, node-for-node.
- [ ] Artificially low `--max-reachability-memory` on a mid-size fixture → `reachabilityMode: "targeted"`, WARNING logged with actual estimated MB vs. budget.
- [ ] Targeted mode: 100% of articulation points, critical-path nodes, and top-K-by-degree nodes have non-null values; all others are `null`.
- [ ] `--no-reachability` → `reachabilityMode: "disabled_by_user"`, all fields `null`, no computation attempted (timing near-zero).

**T1.8 — Betweenness**
Depends on: T1.6.
Deliverable: `metrics/betweenness.py`, `metrics/timeout_guard.py`.
Acceptance criteria:
- [ ] Tier boundary tests at exactly 10,000/10,001 and 50,000/50,001 nodes select the documented mode.
- [ ] `--expensive-metrics` forces exact at 60k nodes (above the default disable threshold).
- [ ] `--no-betweenness --expensive-metrics` together → disabled (precedence, cross-check with T1.1).
- [ ] Mocked slow computation (sleeps past `--metric-timeout-seconds`) → stage aborts, `analysisModes.betweenness: "disabled_timeout"`, WARNING logged, **rest of the pipeline continues** (this stage's failure doesn't abort the whole run).

**T1.9 — Articulation points**
Depends on: T1.6.
Deliverable: `metrics/articulation.py`, reusing `timeout_guard.py`.
Acceptance criteria:
- [ ] Same tier-boundary and timeout tests as T1.8, applied to articulation.
- [ ] Verified against a small hand-constructed graph with known articulation points.

**T1.10 — Critical path**
Depends on: T1.5.
Deliverable: `metrics/critical_path.py`.
Acceptance criteria:
- [ ] Hand-verified longest path on a small constructed DAG.
- [ ] Fixture with a cyclic SCC feeding into an otherwise-critical downstream chain: **no edge with `isCritical: true` touches a node with `isCycle: true`** (direct regression test for the both-endpoints rule).
- [ ] Fully-cyclic fixture → `globalCriticalPathLength: 0`.

**T1.11 — Combo aggregation**
Depends on: T1.6, T1.7.
Deliverable: `combo_aggregator.py`.
Acceptance criteria:
- [ ] Combo with all-null `buildCost` members (targeted-mode fixture) → combo `maxBuildCost: null`, not `0`.
- [ ] Combo with mixed null/non-null members → aggregate computed over non-null only, matches hand-calculation.
- [ ] `collapsedSize` matches the formula for 3 constructed `nodeCount` values including the `minSize` floor case.

**T1.12 — Layout integration**
Depends on: T1.1.
Deliverable: `layout.py`.
Acceptance criteria:
- [ ] `--precompute-layout` with graphviz mocked absent → ERROR naming the dependency, exit 1, no output file.
- [ ] With graphviz present → `rankdir=LR` and Y-axis inversion verified against a fixture's expected coordinate signs.

**T1.13 — Style precomputation**
Depends on: T1.5.
Deliverable: `styler.py`.
Acceptance criteria:
- [ ] Same `kind` value → identical color across two separate runs (determinism check).
- [ ] Critical node/edge style values match spec constants exactly (`#ff4d4f`, `lineWidth: 3` / `4`, etc.).

**T1.14 — Serializer, atomic write, self-validation**
Depends on: T0.1, T1.6–T1.13.
Deliverable: `serializer.py`.
Acceptance criteria:
- [ ] Output for every T0.2 fixture validates against T0.1's schema.
- [ ] Process killed mid-write (simulated) → no file, or only the untouched previous file, exists at the final output path — never a truncated one.
- [ ] A deliberately-broken internal payload (e.g. wrong type injected for a test) is caught by self-validation **before** the write, not after.

**T1.15 — Logging wiring**
Depends on: T0.3, T1.7–T1.9.
Deliverable: `logging_config.py` wired through all metric modules.
Acceptance criteria:
- [ ] Run on a fixture that triggers both reachability targeted-mode fallback and betweenness auto-disable → both WARNING lines present in captured stderr, each with concrete numbers, in the exact format from T0.3.
- [ ] `-q` suppresses both; `-v` adds INFO stage-timing lines around them.

**T1.16 — `--performance-report` wiring**
Depends on: T1.6–T1.15.
Deliverable: timing capture threaded through every stage into `metadata.performance`.
Acceptance criteria:
- [ ] All performance fields present and non-negative for every T0.2 fixture, including ones where a stage was skipped (value `0`, key still present).
- [ ] `maxReachabilityMemoryMb`/`targetedReachabilityK`/`metricTimeoutSeconds` reflect the actual CLI flags used for that run.

---

### Phase 2 — Tool 2: Viewer Core

**T2.1 — Schema validation on load**
Depends on: T0.1, T0.2.
Deliverable: `core/schema-validate.js`.
Acceptance criteria:
- [ ] All T0.2 valid fixtures pass.
- [ ] 5 deliberately-corrupted fixtures (missing required field / wrong type / out-of-enum value / negative count / edge referencing a non-existent node id) each produce a distinct, field-identifying error message, and none proceed to render.
- [ ] `schemaVersion` mismatch produces the specific "incompatible extractor version" message, not a generic error.

**T2.2 — File loader**
Depends on: T2.1.
Deliverable: `ui/file-loader.js`.
Acceptance criteria:
- [ ] Loading a 2nd valid file after a working 1st session fully replaces state only after validation succeeds.
- [ ] Loading an invalid 2nd file leaves the 1st graph fully intact, interactive, with an error toast shown — verified by checking the 1st graph's selection/filter state is unchanged.
- [ ] A file above 200MB triggers a confirmation dialog before `JSON.parse` is invoked.

**T2.3 — Index building**
Depends on: T2.1, T0.2.
Deliverable: `core/indexes.js`.
Acceptance criteria:
- [ ] Each index (`nodeToNeighbors`, `nodeToEdges`, `comboChildren/Parent/Depth`, `searchIndex`, `spatialIndex`, `sortedMetricArrays`) independently unit-tested against 3 fixtures.
- [ ] `targeted`-mode fixture: null-valued nodes appear at the end of the relevant `sortedMetricArrays` entry.
- [ ] `comboBounds`/`comboSpatialIndex` computed correctly when `layoutPrecomputed: true` (immediately) **and** when `false` (only after a mocked Dagre-completion event fires) — both paths tested explicitly.

**T2.4 — Mode computation**
Depends on: T2.3.
Deliverable: `core/modes.js`.
Acceptance criteria:
- [ ] Boundary tests at every §5.1/§2.1 threshold (5000/5001, 20000/20001, 50000/50001, 100000/100001) for both node-count and edge-count triggers.
- [ ] On a `datasetMode: ultra` fixture, applying a filter that reduces the visible set to <100 nodes → `renderMode` recomputes to `normal` (the direct regression test for the headline v5.3.0 fix).
- [ ] `renderMode` is never observed more permissive than `datasetMode` for combo-depth/dagre-eligibility decisions in any test case.

**T2.5 — Basic G6 render pipeline + error boundary**
Depends on: T2.3.
Deliverable: `render/g6-adapter.js`.
Acceptance criteria:
- [ ] 500-node fixture renders with the correct node/edge count present in the G6 instance.
- [ ] A forced exception (mocked throwing style function) during a render cycle is caught, logged, and the viewer enters safe mode (verified: culling/animation disabled, static redraw still succeeds) rather than throwing to the console uncaught or leaving a blank canvas.

**T2.6 — Adaptive combo depth**
Depends on: T2.3, T2.4.
Deliverable: `core/combo-depth.js`.
Acceptance criteria:
- [ ] 3 constructed combo-tree scenarios (one pathological — a single huge top-level combo; one balanced; one deep/narrow) each produce a hand-computed-and-verified initial depth.
- [ ] Depth-1 overflow scenario correctly falls back to depth 0.

---

### Phase 3 — Viewer Interaction

**T2.7 — Visibility resolver**
Depends on: T2.4.
Deliverable: `core/resolver.js`.
Acceptance criteria:
- [ ] Matches a naive reference-implementation intersection across 20 randomized filter-combination scenarios on a 2k-node fixture.
- [ ] On a 100k-node fixture, changing a single filter dimension completes the resolver pass within a documented time budget (measured and logged, informational regression gate).
- [ ] Changing one dimension does not trigger recomputation of any other dimension's mask (verified via call-count instrumentation).

**T2.8 — Metric & build-stage sliders**
Depends on: T2.7.
Deliverable: `interaction/sliders.js`.
Acceptance criteria:
- [ ] 50 rapid synthetic input events collapse to exactly one resolver call per animation frame.
- [ ] Slider is disabled with a tooltip when `reachabilityMode` is `disabled_by_user`/`disabled_memory_budget`/`disabled_timeout`.
- [ ] Slider stays enabled with the explanatory note visible when `reachabilityMode == "targeted"`.

**T2.9 — Hover**
Depends on: T2.3, T2.7.
Deliverable: `interaction/hover.js`.
Acceptance criteria:
- [ ] Hub-node fixture (5000+ neighbors): hover completes with zero calls to any sort function (spy-verified) and returns ≤200 nodes.
- [ ] Hover produces no state change when triggered during a simulated slider-drag or rapid-pan flag.

**T2.10 — Selection & neighborhood**
Depends on: T2.7.
Deliverable: `interaction/selection.js`.
Acceptance criteria:
- [ ] Constructed fixture where a 2nd-hop critical node must outrank a 1st-hop non-critical node for budget inclusion — verified included.
- [ ] Truncation message shows the exact "N of M" counts for a constructed over-budget fixture.
- [ ] Zero dangling edges in the rendered output — every rendered edge's both endpoints are confirmed present in the materialized set, across 5 truncation scenarios.

**T2.11 — Search**
Depends on: T2.3.
Deliverable: `interaction/search.js`.
Acceptance criteria:
- [ ] A query matching a mid-string substring (not a prefix) returns the correct node.
- [ ] 300ms debounce verified (rapid keystrokes → one query fired).
- [ ] >10 results routes to sidebar, shows correct total count, renders ≤50.
- [ ] Deep-hierarchy fixture: ancestor expansion halts before exceeding the visible-element budget and the filter indicator fires, rather than expanding the full chain.

**T2.12 — Breadcrumb navigation**
Depends on: T2.6, T2.7.
Deliverable: `interaction/breadcrumb.js`.
Acceptance criteria:
- [ ] Clicking a mid-trail segment collapses combos below it and clears selection below it.
- [ ] Active search term and slider values are unchanged after the click (explicit before/after state comparison).
- [ ] On a fixture where the target level's subtree contains a pathologically large combo, the resulting collapse depth is clamped rather than exceeding the visible-element budget.

**T2.13 — Combo expansion**
Depends on: T2.6.
Deliverable: `interaction/combo-expand.js`.
Acceptance criteria:
- [ ] Each of the 4 dialog options (Expand / Expand+focus / Show critical path only / Cancel) produces the documented resulting visible set on a fixture combo.
- [ ] "Show critical path only" is disabled with the documented tooltip on a fixture subtree containing zero critical nodes.

---

### Phase 4 — Big-Graph Rendering Features

**T2.14 — LOD system**
Depends on: T2.4, T2.5.
Deliverable: `render/lod.js`.
Acceptance criteria:
- [ ] Zoom-boundary tests at 0.29/0.3, 0.79/0.8, 1.19/1.2 select the correct LOD tier for the relevant visible-node-count band.
- [ ] Mixed fixture with critical and non-critical edges at LOD 0: critical edges retain full arrowhead/color/width; non-critical do not (direct regression test for the LOD-0/critical contradiction fix).
- [ ] Over-`maxCanvasLabels` fixture: rendered labels match the documented priority order exactly.

**T2.15 — Edge rendering & aggregation**
Depends on: T2.14.
Deliverable: `render/edges.js`.
Acceptance criteria:
- [ ] Aggregated combo-to-combo edge count label matches the true underlying edge count.
- [ ] Mixed-criticality aggregate (e.g. 3 of 47 critical) shows the correct sub-label and critical styling.
- [ ] Two renders of the same over-`maxDetailedEdges` visible set produce an identical thinned subset (determinism), and the subset never excludes a critical edge.

**T2.16 — Viewport culling**
Depends on: T2.3, T2.14.
Deliverable: `perf/culling.js`.
Acceptance criteria:
- [ ] 10k-node grid fixture: panning to a known viewport rectangle reveals/hides exactly the geometrically-expected node set at viewport+25% margin.
- [ ] Culling never triggers a layout call or analytics recomputation (spy-verified).

**T2.17 — Adaptive quality**
Depends on: T2.14, T2.16.
Deliverable: `perf/adaptive-quality.js`.
Acceptance criteria:
- [ ] Simulated FPS feed below target for exactly 31 frames → one degrade event, one toast.
- [ ] Simulated FPS above target for 3+ seconds with zero interaction events → no recovery (regression test for the v5.4.0 flapping fix).
- [ ] Same scenario with one interaction event injected mid-window → recovery fires after the window completes.

**T2.18 — Visual encoding**
Depends on: T2.14, T1.11 (combo aggregate shape).
Deliverable: `render/styles.js`.
Acceptance criteria:
- [ ] A node satisfying both "critical" and "high bottleneck" shows critical styling (priority order test).
- [ ] Heatmap bound to `buildCost`/`bottleneckScore` on a collapsed combo reads the corresponding combo aggregate correctly, including the `null`-aggregate case (combo shows no heatmap fill, not a false "zero" color).
- [ ] Critical stroke color is `#ff4d4f` with heatmap off and `#00d9ff` with heatmap on, toggled live.

---

### Phase 5 — UX Chrome

**T2.19 — Legend panel** — Depends on: T2.18. Acceptance: legend content set changes correctly across every toggle combination; heatmap gradient row appears only while heatmap is active and shows the correct bound-metric name.

**T2.20 — Node tooltip** — Depends on: T2.3. Acceptance: `null` `blastRadius` under `targeted` mode shows the specific reason string; approximate `bottleneckScore` shows the "≈" tag; no field ever renders a literal `null` or blank.

**T2.21 — Filter indicator** — Depends on: T2.7, T2.15. Acceptance: node-hidden and edge-simplified message variants each appear under their correct trigger; "Show all" fully restores the visible set without a layout call (position-stability check).

**T2.22 — Analytics & Diagnostics panels** — Depends on: T2.4, T2.16. Acceptance: panel values match ground-truth computed state at each step of a scripted multi-interaction sequence; fallback-coordinate nodes (from T2.3) are listed.

**T2.23 — Diagnostic Report export** — Depends on: T2.22, T4.11 logger. Acceptance: exported report is non-empty and includes mode state, active filters, FPS history, and at least one log entry after deliberately inducing a warning-level event (e.g. a truncated neighborhood).

---

### Phase 6 — Integration & Scale Validation

**T3.1 — End-to-end pipeline test**
Depends on: all of Phase 1 and Phase 2–5.
Deliverable: automated run of the real extractor against T0.2 fixtures at every named scale (empty/1-node/10k/50k/100k), feeding real output into the real viewer (headless).
Acceptance criteria:
- [ ] Every scenario in spec §7 passes end-to-end using the real pipeline, not mocked fixtures.
- [ ] Every bullet in spec §8 is checked with an actual measurement recorded (FPS, resolver time, load time) into a committed performance report — not just a pass/fail.

**T3.2 — Contract regression suite**
Depends on: T3.1.
Deliverable: a small corpus of intentionally-stale/invalid JSON (old `schemaVersion`, hand-broken fields) fed to the real viewer.
Acceptance criteria:
- [ ] Every case produces the specific, documented error message (schema-version mismatch vs. field-level validation error), never a generic failure or, worse, a silent partial render.

---

## 3. Suggested execution order

1. **Phase 0** (T0.1–T0.3) — strictly first, everything else depends on the schema and fixtures.
2. **Phase 1 (Tool 1)** and **Phase 2 (Tool 2 core, T2.1–T2.6)** can run in parallel — Tool 2's core doesn't need a working extractor, only T0.2's pre-built fixture JSON.
3. **Phase 3 and Phase 4** depend on Phase 2 core but not on Phase 1 completing — continue in parallel with the tail end of Phase 1.
4. **Phase 5** can start as soon as the specific state/data it displays exists (most tasks only need T2.3/T2.4/T2.7).
5. **Phase 6** is the integration gate — do not consider the project done until T3.1 and T3.2 both pass against the *real* extractor output, since that's the only point where the shared-schema assumption from §1.1 actually gets exercised end to end rather than assumed.