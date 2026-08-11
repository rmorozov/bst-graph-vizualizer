# BuildStream Graph Toolkit — Specification Conformance Review

**Reviewed against:** `docs/specification.md` (v5.5.0) and `docs/implementation_plan.md`
**Scope:** `bst_graph_extractor/` (Python, Tool 1) and `viewer/` (JS, Tool 2)
**Method:** static code reading of every module, cross-checked against spec sections, plus **live execution** of the extractor CLI (dependencies installed and run inside the review sandbox) against the repo's own fixtures to confirm hypotheses with real output rather than inference alone. All findings below marked "confirmed by execution" were reproduced this way; the underlying commands and outputs are reproducible from the fixtures already in the repo.

`IMPLEMENTATION_STATUS.md` (committed to the repo) claims Phases 0–5 are "✅ COMPLETE" and only Phase 6 (integration/E2E tests) is pending. **This claim is not supported by the code.** The pipeline cannot run without manually installing undeclared dependencies, its flagship `--precompute-layout` feature crashes on every invocation, and its most fundamental job — attaching computed metrics to nodes — silently discards nearly every computed value before writing output. None of this is caught because **there are zero test files anywhere in the repository.**

---

## 1. Executive Summary

| Area | Status |
|---|---|
| Extractor runs at all | ❌ Crashes on import — `networkx`, `jsonschema` not declared as dependencies anywhere (no `requirements.txt`/`pyproject.toml`) |
| Extractor produces correct per-node metrics | ❌ **Root-cause bug**: computed metrics are discarded during serialization (§3.1) |
| `--precompute-layout` (required for >20k nodes per spec) | ❌ Crashes every run — writes an illegal extra JSON key, fails its own schema self-check (§3.2, confirmed by execution) |
| Combo hierarchy / combo aggregates | ❌ Never wired up — `combos: []` on every run; `combo_aggregator.py` is dead code (§3.3) |
| `schemaVersion` | ❌ Hardcoded `"1.0.0"`, spec requires `"5.5.0"`; guarantees every schema-version-aware consumer treats output as incompatible (§3.4) |
| `bst show` invocation contract | ❌ Single generic `bst show <target>` call with a fabricated text format; spec's 3-invocation `--deps all/build/run --format` contract (§3.5) is not implemented at all; `--include-runtime` is a dead flag |
| Betweenness/articulation size tiering | ❌ Betweenness defaults to *exact* below 10k nodes (spec: always *approximate* unless `--expensive-metrics`); articulation has no size tiering at all (§3.3) |
| Data Honesty principle (§1, principle 8) | ❌ Successful articulation-points runs are reported as `analysisModes.articulation: "disabled"` (§3.4/§3.5) |
| Style precomputation | ❌ Critical-node fill overridden to red instead of spec's "pastel kind color, stroke changes only"; non-critical edges hardcoded `endArrow:true, opacity:1.0` contradicting spec (§3.3) |
| Viewer entry point | ❌ No `bst_graph_viewer.html` exists anywhere — spec's Tool 2 is a single self-contained static HTML file; the repo has only unbundled ES modules with no bundler/build step (§4.0) |
| Viewer: does it even parse/load | ❌ No — 6 files contain TypeScript syntax inside `.js` files (confirmed: real `import()` throws `SyntaxError`), 4 files import a nonexistent `utils/logger.js`, and the AntV G6 dependency never resolves (§4.0) |
| Viewer: is `main.js`'s wiring correct | ❌ No — 13 of ~18 named imports in `main.js` reference exports that don't exist in their target files; the app would throw `TypeError` on its first initialization call even if §4.0 were fixed (§4.1) |
| Viewer: do the "core" modules agree on data shapes | ❌ No — `resolver.js`, `indexes.js`, `hover.js`, `selection.js`, `search.js`, `culling.js`, `sliders.js` each independently assume a different shape for the shared indexes/state objects (§4.3) |
| Test suite | ❌ Zero test files (`*test*`) anywhere in the repository, despite ~140 acceptance-criteria checkboxes in `implementation_plan.md` all being implicitly claimed "done" |
| Fixture coverage (§7 correctness matrix / T0.2) | ❌ Only 5 of the ~12+ required scenarios exist; no 10k/50k/100k scale fixtures, no disconnected/high-degree-hub/multi-node-cyclic fixtures — blocks the very performance claims the spec cares most about |

The pattern across nearly every file: **modules are individually well-commented and reference the correct spec section in their docstrings, but the actual wiring between modules — the part that makes the documented behavior real — is missing, stubbed, or silently wrong.** This is consistent with each file having been produced independently against the spec text without integration testing between them.

---

## 2. Extractor (Python) — Confirmed Findings

### 2.1 [CRITICAL] Computed per-node metrics are discarded before serialization
**File:** `bst_graph_extractor/serializer.py:88-121`, called from `bst_graph_extractor/cli.py:465-481`
**Confirmed by execution.**

`assemble_output()` takes a `node_metrics` parameter and reads every node's `data.*` fields from it:
```python
metrics = node_metrics.get(node_id, {})
...
"inDegree": metrics.get("inDegree", 0),
"outDegree": metrics.get("outDegree", 0),
"topoLayer": metrics.get("topoLayer", 0),
"cpDepth": metrics.get("cpDepth", 0),
...
"blastRadius": metrics.get("blastRadius"),
"buildCost": metrics.get("ancestorCount"),
"bottleneckScore": metrics.get("betweenness"),
```
But `cli.py` calls it with:
```python
output = assemble_output(
    nodes=node_list_output,
    ...
    node_metrics={},  # Already merged into nodes
    ...
)
```
`node_metrics` is passed as a **hardcoded empty dict**, with a comment claiming the values were "already merged into nodes" — they were (via `**node_metrics.get(node, {})` in `cli.py:437-443`), but `assemble_output` never looks at the `node` dict for these fields, only at the separate (empty) `node_metrics` argument. Every `.get(..., default)` therefore silently returns its default.

The same bug also swallows **all node style values** (`style.fill`, `style.stroke`, `style.lineWidth`, and `style.size` is not even attempted — hardcoded `[50, 30]`).

**Reproduced by running the extractor against the repo's own `dag.txt` fixture** (10 nodes, 8 edges, mix of kinds, 3 hand-computed critical nodes, 4 articulation points):
```
distinct fills:          {'#1890ff'}       # every node identical, kind ignored
distinct sizes:           {(50, 30)}       # every node identical
distinct topoLayer values: {0}             # every node reports layer 0
distinct isCritical values: {False}        # even the 3 known-critical nodes
levelCounts: {'0': 10}                     # collapses to a single fake layer
```
Every node in the output is visually and analytically identical regardless of what was actually computed. This single bug is the root cause behind most of the "always-null"/"always-zero" symptoms documented separately below — `blastRadius`, `buildCost`, `bottleneckScore`, `sccId`, `isCritical`, `isArticulationPoint`, `isCycle`, `cpDepth`, `cpHeight` are all affected, on every single extraction run, for every graph size.

**Impact:** the extractor's entire purpose — computing and exposing graph metrics — is defeated at the last step. A viewer consuming this output has no usable data to render heatmaps, critical-path highlighting, bottleneck scores, or blast-radius encodings, no matter how correct or incorrect the upstream metric computation is.

### 2.2 [CRITICAL] `--precompute-layout` crashes on every invocation
**File:** `bst_graph_extractor/serializer.py:212-214`, `bst_graph_extractor/schema/graph_data.schema.json` (`additionalProperties: false` at top level)
**Confirmed by execution** (graphviz installed in the review sandbox to test this path):
```
ValueError: Output validation failed: Additional properties are not allowed ('layout' was unexpected) at deque([])
```
Two independent bugs compound here:
1. `assemble_output()` never writes the computed `layout_nodes` coordinates onto `nodes[i].x`/`nodes[i].y` (the schema-defined location, per spec §3.4.1's example payload). Every node's `x`/`y` stays hardcoded `0.0`.
2. Instead, it adds a **top-level `"layout": {"nodes": [...]}` key** that does not exist anywhere in `graph_data.schema.json`. Since the schema sets `additionalProperties: false` at the document root, the extractor's own mandatory self-validation step (§3.4.1: "Tool 1 refuses to write output that fails its own schema check") correctly rejects its own output — and the run aborts with exit 1 and no file written.

Also, `layout.py:_sanitize_dot_id()` (line 126-130) replaces `.`, `/`, `:` in node IDs before feeding them to `dot`, and the coordinates that come back are keyed by the **sanitized** IDs. Even if bug (2) were fixed, nothing maps the sanitized `node_0000_bst` IDs back to the original `node_0000.bst` IDs, so coordinates could not be attached to the correct nodes regardless.

**Impact:** the one feature spec §3.1 calls "**Required** for any graph expected to exceed 20,000 nodes" and explicitly designates as a hard-error-on-missing-dependency path is itself completely non-functional — it 100%-of-the-time hard-errors even when graphviz *is* present.

### 2.3 [CRITICAL] Combo hierarchy is never built — `combos` is always `[]`
**File:** `bst_graph_extractor/cli.py:384-387`
**Confirmed by execution** (`d['combos'] == []` on every fixture tried).
```python
# Stage 10: Aggregate combo metrics (placeholder for now)
# TODO: Implement combo detection and aggregation
combo_aggregates = {}
combos = []
```
`combo_aggregator.py` (which computes real aggregates) is `import`ed in `cli.py:246` but its `compute_combo_aggregates()` function is **never called anywhere in the codebase** (verified via repo-wide search — the only call site is inside `combo_aggregator.py`'s own test-free module).

Separately, even if wired up, `combo_aggregator.py` itself deviates from spec §3.3:
- Missing required fields entirely: `minTopoLayer`, `maxTopoLayer`, `hasCritical` (spec §3.3/§3.4.1 combo `data` shape) are never computed.
- Computes unspecified extra fields (`minBuildCost`, `avgBuildCost`, `sumBuildCost`, `avgBottleneckScore`, `avgBlastRadius`) not in the schema/spec.
- `collapsedSize` formula: spec is `max(minSize, log2(nodeCount+1) * scalar)` with `minSize = [60, 40]` (a `[width, height]` pair) and `scalar = 20`. Code (`combo_aggregator.py:104-118`) uses `min_size = 20` (a single scalar, not a pair) and `scale = 5`, and returns a bare `int` instead of a `[width, height]` array — wrong shape and wrong constants.
- `nodeCount` is `len(children)` — immediate children only, with no evidence of recursive aggregation for nested combos or the mandatory `@root` combo (spec requires `@root` always present with `nodeCount == totalNodes`; no code path ever constructs a combo tree or the root combo at all).

**Impact:** every spec feature keyed on combos — progressive disclosure (principle 5), adaptive initial combo depth (§4.5.1), combo-level edge aggregation (§4.5), HTML combo labels (§4.3), the `@root` combo required even for a single-node graph (spec §3.4.1 example) — has no data to work with, because the extractor never emits combo data at all.

### 2.4 [HIGH] `schemaVersion` hardcoded to `"1.0.0"`, not `"5.5.0"`
**File:** `bst_graph_extractor/serializer.py:169`
**Confirmed by execution** on every fixture tested.
```python
metadata = {
    "schemaVersion": "1.0.0",
    ...
```
The spec (§3.4.1) is explicit: `metadata.schemaVersion` (e.g. `"5.5.0"`) is required, and §4.11 requires the viewer to compare it against supported versions and show "produced by an incompatible extractor version" on mismatch. The repo's own fixture generator (`fixtures/generator.py:18`) independently defines `SCHEMA_VERSION = "5.5.0"` — meaning the hand-built test fixtures and the actual extractor output already disagree on schema version, which is exactly the drift T3.2 ("Contract regression suite") was designed to catch, and would catch immediately if it existed.

### 2.5 [HIGH] `bst show` invocation contract does not match spec §3.2
**File:** `bst_graph_extractor/bst_interface.py:35`, `bst_graph_extractor/parser.py`
```python
cmd = ["bst", "show", target]
```
Spec §3.2 requires **three** separate invocations with specific `--deps`/`--format` flags:
```
bst show --deps all --format '%{name}|%{kind}' <TARGET>
bst show --deps build --format '%{name}|%{deps}' <TARGET>
bst show --deps run --format '%{name}|%{deps}' <TARGET>   (if --include-runtime)
```
The implementation calls plain `bst show <target>` once, with no `--format`/`--deps` flags at all, and `parser.py` parses an invented text grammar (`id|kind` node lines, `- dep_id [runtime]` continuation lines, an alternate space-separated `deps=[...]` form) that matches none of the three documented `bst show` output shapes.

Direct consequences:
- `--include-runtime` (`cli.py:80-84`) is parsed but never changes which `bst show` invocation happens — it is a **dead flag**; runtime edges can never actually be fetched.
- Against a real BuildStream project, this parser would receive real `%{name}|%{kind}` / `%{name}|%{deps}` output and almost certainly fail to parse it correctly, since the code was written against a fabricated format instead.

### 2.6 [HIGH] Betweenness centrality tiering contradicts spec default
**File:** `bst_graph_extractor/metrics/betweenness.py:54-57`
**Confirmed by execution** (`bottleneckMetric: "exact"` on a 10-node fixture with no flags passed).
```python
if n < 10000 or enable_exact:
    method = "exact"
else:
    method = "approximate"
```
Spec §3.3: "**≤10k: approximate. >10k: approximate.** >50k: disabled by default." — betweenness is *approximate at every size tier* by default; only `--expensive-metrics` should force exact. The code instead makes exact the **default** for the entire ≤10k range, which is precisely the range most graphs will fall into during normal use, meaning the documented tiering is inverted for the common case.

### 2.7 [HIGH] Articulation points have no size tiering at all
**File:** `bst_graph_extractor/metrics/articulation.py`
Spec §3.3: articulation points are "Tiered identically to betweenness (approximate/skippable above 50k by default, forced exact by `--expensive-metrics`, subject to the same timeout guard)." The implementation has no `n > 50000` branch, no approximate mode, and doesn't even accept an `enable_exact`/expensive-metrics parameter (compare its signature to `betweenness.py`'s). Articulation points are unconditionally computed exactly, every time, regardless of graph size — silently expensive at scale, and not matching the documented contract for the `analysisModes.articulation` field's `"approximate"` value (which can now never occur).

### 2.8 [HIGH] Successful articulation runs are reported as `"disabled"`
**File:** `bst_graph_extractor/serializer.py:196-197`, `bst_graph_extractor/metrics/articulation.py:63-66`
**Confirmed by execution:** a `-v` run against `dag.txt` logs `INFO [articulation] Found 4 articulation points`, yet the output JSON's `metadata.analysisModes.articulation` is `"disabled"`.

`articulation.py` returns `status: "success"` on completion, but the schema's `analysisModes.articulation` enum is `["exact", "approximate", "disabled", "disabled_timeout"]` — `"success"` isn't a member. `serializer.py`'s coercion:
```python
"articulation": articulation_status if articulation_status in ["exact", "approximate", "disabled", "disabled_timeout"] else "disabled",
```
silently maps the unrecognized `"success"` value to `"disabled"`. This directly violates spec principle 8 ("Data Honesty — `null` always means 'not computed/unavailable' ... never a display convenience") and principle 9/§3.5 ("Metric degradation is never silent") — here a metric that *did* compute successfully is mislabeled as not computed, with no warning logged, which is the opposite failure mode from what §3.5 is designed to prevent (silent success-labeled-as-failure, rather than silent failure-labeled-as-success, but the same "the label lies about what happened" problem).

### 2.9 [HIGH] Exact reachability uses the pattern the spec explicitly forbids
**File:** `bst_graph_extractor/metrics/reachability.py:104-109, 140-142`
```python
for node in G.nodes():
    ancestors[node] = set(nx.ancestors(G, node))
    descendants[node] = set(nx.descendants(G, node))
```
Spec §3.3 states in bold: "**Forbidden:** per-node `nx.descendants()` / `nx.ancestors()`" — mandating "SCC-DAG bitset reachability" instead. Both `_compute_exact_reachability` and `_compute_targeted_reachability` use exactly the forbidden per-node pattern, which is O(V·(V+E)) rather than the spec's intended near-linear bitset approach, and defeats the entire point of the memory-guard/targeted-mode design (the fallback exists to avoid quadratic *memory*, but this implementation already pays quadratic *time* even in cases the spec expects to be cheap).

Additionally:
- The memory-guard formula (`estimate_memory_requirement`, lines 21-32) bases its estimate on raw node count `n` with an unexplained `overhead_factor = 10.0` multiplier. Spec §3.3 bases the estimate on **SCC count** `C` (`C²/8` bytes) and its own worked example (100,000 SCCs ≈ 1.25GB) implies *no* 10x multiplier — applying the code's formula to that same example gives ~11.9GB, meaning the code triggers the memory-guard fallback roughly 10x more eagerly than the spec's own reference calculation, and does so using node count instead of the (typically much smaller, for cyclic graphs) SCC count.
- Targeted mode (`_compute_targeted_reachability`, lines 122-158) selects only top-K **out-degree** nodes. Spec §3.3 requires the targeted set to be the union of *all articulation points*, *all critical-path nodes*, **and** top-K by *out-or-in*-degree. The code has access to none of articulation points, critical-path status, or in-degree at the point reachability runs — because in `cli.py`'s stage ordering, reachability (stage 6) runs **before** betweenness (7), articulation (8), and critical path (9), so the data needed to build the correct targeted set doesn't exist yet even if the selection logic were fixed.

### 2.10 [MEDIUM] Style precomputation contradicts spec's documented fill/stroke rules
**File:** `bst_graph_extractor/styler.py:59-98`
Spec §3.3: "Node fill: pastel variant of kind color... Node stroke: solid kind color; **critical nodes:** `stroke: '#ff4d4f'`, `lineWidth: 3`" — i.e. **only stroke changes for critical status; fill is always the pastel kind color.** Non-critical edges: `opacity: 0.4`, `endArrow: false`, stroke from `depTypeColorMap`.

The code does the opposite for nodes and ignores the edge rule entirely:
```python
if is_critical:
    fill_color = CRITICAL_NODE_COLOR   # fill changes to red — spec says fill never changes
    stroke_color = CRITICAL_HEATMAP_COLOR if heatmap_active else CRITICAL_NODE_COLOR
else:
    fill_color = base_color
    stroke_color = base_color           # non-critical stroke should be *solid kind color*; here fill==stroke, no pastel transform exists anywhere in the codebase
```
No pastel-lightening transform exists anywhere in `styler.py` — "pastel variant of kind color" is never implemented for any node.

For edges, `styler.py:90-92` hardcodes non-critical edge color to flat `#d9d9d9` (ignoring `depTypeColorMap` entirely), and **`serializer.py:136-141` hardcodes `endArrow: True, opacity: 1.0` for every edge unconditionally** — the reverse of spec's non-critical-edge rule (`endArrow: false, opacity: 0.4`). (This bug is masked in the sample output shown in §2.1 because the same root-cause metrics-loss bug also prevents `isCritical` from ever reading correctly — but the edge style hardcoding is independent and confirmed directly from source.)

### 2.11 [MEDIUM] `critical_path.py`'s per-node `cpDepth`/`cpHeight` use shortest-path, not longest-path, logic
**File:** `bst_graph_extractor/metrics/critical_path.py:151-177`
```python
def _compute_cp_depth(G, node):
    ...
    lengths = nx.multi_source_dijkstra_path_length(G, sources)
    return lengths.get(node, 0)
```
`global_critical_path_length` is correctly computed via a longest-path DP (`_longest_path_in_dag`, lines 112-148), consistent with "critical path" in the standard CPM sense. But the per-node `cpDepth`/`cpHeight` — which spec §3.3 defines as depth/height *along the critical path* and which feed `componentCriticalPathLength = max(cpDepth[v]+cpHeight[v])` — are computed via `multi_source_dijkstra_path_length`, i.e. **shortest**-path distance from sources / to sinks. This is internally inconsistent (the same module uses longest-path logic for the global figure and shortest-path logic for the per-node figures that are supposed to decompose it) and will produce numerically wrong `cpDepth`/`cpHeight` values on any graph with more than one path between two nodes of differing length.

Separately, `componentCriticalPathLength` (spec §3.3, explicitly named) is **never computed anywhere** in the codebase — not in `critical_path.py`, not in `serializer.py`'s node data assembly.

### 2.12 [MEDIUM] `graphSizeClass` thresholds don't match spec's `datasetMode` thresholds
**File:** `bst_graph_extractor/serializer.py:239-253`
```python
def _classify_graph_size(n: int) -> str:
    if n < 20000: return "normal"
    elif n < 50000: return "large"
    elif n < 100000: return "huge"
    elif n < 200000: return "extreme"
    else: return "ultra"
```
Spec §2.1 (`datasetMode`, which `graphSizeClass` is meant to expose to the viewer): boundaries are **5,000 / 20,000 / 50,000 / 100,000**. The code uses **20,000 / 50,000 / 100,000 / 200,000** — every boundary is different, and `_classify_graph_size` also only considers node count (`n`), never edge count, contradicting §2.1's explicit "Computed from both node and edge counts — may escalate on edge density." A 10k-node/200k-edge graph, which spec says should land in a *more restrictive* mode than normal node-count-only classification would suggest, is instead classified purely by node count and would incorrectly land in `"normal"`.

### 2.13 [LOW] Timeout guard truncates sub-second timeouts to zero (disables the guard)
**File:** `bst_graph_extractor/metrics/timeout_guard.py:44, 84`
```python
signal.alarm(int(timeout_seconds))
```
`--metric-timeout-seconds` is typed as `float` in `cli.py:138-144`, but `signal.alarm()` requires an integer and any `timeout_seconds < 1.0` truncates to `int(...) == 0`, which **cancels** the alarm rather than firing it near-instantly — the opposite of the intended behavior for a small-but-nonzero timeout. Also Unix-only (`signal.SIGALRM`), an unstated platform constraint.

### 2.14 [LOW] `graph_builder.py` carries vestigial, unused, and unspecified node attributes
**File:** `bst_graph_extractor/graph_builder.py:36-42`, `parser.py:33-34, 198-215`
`NodeRecord.build_cost`/`.size` (parsed from an invented `build_cost=<float> size=<int>` line syntax that appears nowhere in spec §3.2) are attached to the `nx.DiGraph` node attributes but never read anywhere downstream — dead fields describing an input format the spec doesn't define, likely left over from an earlier, different design of the parser.

---

## 3. Infrastructure / Process Findings

### 3.1 [CRITICAL] No dependency manifest — the extractor cannot run out of the box
No `requirements.txt`, `pyproject.toml`, or `setup.py` exists anywhere in the repo. `networkx` and `jsonschema` are imported unconditionally by multiple modules (`graph_builder.py`, `serializer.py`, `scc.py`, metrics modules) with no declaration anywhere that they're required. **Confirmed by execution:** a fresh environment fails immediately:
```
ModuleNotFoundError: No module named 'networkx'
```
Layout also depends on the system `dot` binary (graphviz) with no documented install instruction beyond a comment in `layout.py`.

### 3.2 [CRITICAL] No test suite exists
A repo-wide search for `*test*` files, `pytest`/`unittest`/`jest`/`mocha`/`describe(`/`it(` usage found **zero test files**. `implementation_plan.md` defines ~140 checkbox-style acceptance criteria across T0.1–T3.2, every one of which is a test-first contract that was never implemented. This is the single structural reason all of the bugs in §2 above shipped as "COMPLETE": nothing ever ran the code and checked its output against the spec's own worked examples.

### 3.3 [HIGH] No viewer build/entry point — Tool 2 as specified does not exist
No `bst_graph_viewer.html` exists anywhere in the repository (confirmed via repo-wide `*.html` search — zero results). Spec §1 defines Tool 2 as "Static HTML page using AntV G6 v5"; `implementation_plan.md` §1.3 explicitly calls for the JS modules to be "bundled into the single static HTML at build time." Instead, `viewer/` contains ~28 unbundled ES modules (`viewer/main.js` uses `import`/`export`) with no bundler config (no `package.json`, `webpack.config.js`, `vite.config.js`, `rollup.config.js`, or any build script), and no HTML shell that could load them as a `<script type="module">`. The deliverable the spec actually asks for — a single file a user can open — cannot currently be produced from this repo at all.

### 3.4 [HIGH] `IMPLEMENTATION_STATUS.md` materially overstates completion
The document marks Phases 0–5 "✅ COMPLETE" and lists specific claimed features that don't exist in the code, e.g. `--no-articulation` is listed under "CLI Features Implemented" (line 79 of the status doc) but no such flag exists anywhere in `cli.py` (confirmed via grep — zero matches for `no-articulation`/`no_articulation` in the whole `bst_graph_extractor/` tree). Its own "Known Limitations" section (bottom of the file) does correctly flag "No Headless Browser Tests" and "Main.js Wiring: Application entry point not fully wired" — but stops short of the far larger issues in §2/§3 here, and the phase-complete checkmarks above those caveats will mislead anyone skimming the file.

### 3.5 [HIGH] Fixture coverage falls far short of spec §7 / T0.2's required scenario matrix
**File:** `bst_graph_extractor/fixtures/generator.py:725-738`
Only 5 named fixtures exist: `empty`, `single_node`, `self_loop`, `dag`, `nested_combos`. T0.2 explicitly requires (and spec §7's correctness matrix separately lists): fully **and** partially cyclic multi-node graphs (only a trivial 1-node self-loop exists — no multi-node SCC fixture), disconnected graphs, high-degree-hub graphs, and — critically for a spec this focused on large-graph performance — **10k/50k/100k-node fixtures at configurable density**, none of which exist. Without these, T3.1 ("every bullet in spec §8 is checked with an actual measurement... recorded into a committed performance report") cannot even be attempted, let alone pass — the spec's central performance claims (§2, §5, §8) are entirely unverified in either direction.

Also note: the fixture generator's own hand-written JSON fixtures correctly use `"schemaVersion": "5.5.0"` (`generator.py:18`) — directly contradicting the real extractor's hardcoded `"1.0.0"` (§2.4 above). A contract regression test (T3.2) would have caught this on day one.

---

## 4. Viewer (JavaScript) — Findings

This section traces the actual import graph starting from `main.js` and checks each module's real exports/behavior against spec §4/§5, rather than trusting docstrings (every file's header comment claims spec compliance — none of the headline bugs below are visible from reading a docstring). All findings were spot-verified independently during this review (`node --check`, dynamic `import()`, `acorn` strict parsing, and direct `grep` of export statements) and confirmed accurate.

### 4.0 [CRITICAL] The application cannot load in a browser — three independent, unconditional causes

**A. Six files are TypeScript, not JavaScript, despite the `.js` extension.** `viewer/core/modes.js`, `core/indexes.js`, `core/combo-depth.js`, `core/schema-validate.js`, `render/g6-adapter.js`, and `ui/file-loader.js` all contain top-level `export type ... = ...;`, `export interface X { ... }`, and (in `schema-validate.js:11`) `import SCHEMA from './graph_data.schema.json' assert { type: 'json' };`. **Confirmed by execution**: `node --check` is misleadingly permissive here, but an actual dynamic `import()` (the real-world loading path) and a strict `acorn --module` parse both fail identically:
```
$ node -e "import('./viewer/core/modes.js')"
IMPORT FAILED: SyntaxError Unexpected token 'export'
$ npx acorn --ecma2022 --module viewer/core/modes.js
Unexpected token (viewer/core/modes.js 11:7)
```
`modes.js` and `indexes.js` are imported directly by `main.js:8-9`. Any browser's real JS engine parses ES modules the same way `acorn`/Node's dynamic `import()` do — this is a hard `SyntaxError` before any application code runs, full stop. File timestamps (all viewer files added in a single commit) are consistent with TypeScript sources that were renamed `.js` and never compiled.

**B. Four files import a module that doesn't exist.** `viewer/ux/breadcrumb.js:8`, `ux/help.js:8`, `ux/sidebar.js:8`, `ux/statusbar.js:8` all do `import { log } from '../utils/logger.js';`. **Confirmed:** `viewer/utils/` does not exist anywhere in the repo (only `viewer/perf/logger.js` exists, with an unrelated API — `logInfo`/`logError`/`logWarning`, not `log`). All four files are imported by `main.js`.

**C. `viewer/render/g6-adapter.js:10` does `import G6 from '@antv/g6';`** — a bare package specifier. **Confirmed:** there is no `package.json`, `node_modules/`, bundler config, CDN `<script>` tag, or vendored copy of AntV G6 anywhere in the repository. The spec's core rendering dependency ("AntV G6 v5") is not present in the codebase in any form — not misconfigured, simply absent.

Any one of A/B/C is independently fatal to `main.js` loading at all in a browser.

### 4.1 [CRITICAL] Nearly every named import in `main.js` references an export that doesn't exist

Even bypassing §4.0 entirely, `main.js`'s wiring is broken at the API-contract level. **Confirmed by direct `grep` of each target module's actual `export` statements:**

| `main.js` imports | Actual export in target file |
|---|---|
| `{ validateSchema }` from `schema-validate.js` | `validateGraphData` (no `validateSchema`) |
| `{ computeModes }` from `modes.js` | `computeInitialModes`, `updateRenderMode` (no `computeModes`) |
| `{ initRenderer }` from `g6-adapter.js` | `initGraph`, `render`, `updateData` (no `initRenderer`) |
| `{ initFileLoader }` from `file-loader.js` | `loadFile`, `confirmAndLoadLargeFile` (no `initFileLoader`) |
| `{ initSidebar }` from `ux/sidebar.js` | `class Sidebar` (default export, no `initSidebar`) |
| `{ initBreadcrumb }` from `ux/breadcrumb.js` | `class BreadcrumbNav` (default export, no `initBreadcrumb`) |
| `{ initStatusbar }` from `ux/statusbar.js` | `class StatusBar` (default export, no `initStatusbar`) |
| `{ initHelp }` from `ux/help.js` | `class HelpPanel` (default export, no `initHelp`) |
| `{ initHover }` from `interaction/hover.js` | `class HoverHandler`, `createHoverHandler` (no `initHover`) |
| `{ initSelection }` from `interaction/selection.js` | `class SelectionHandler`, `createSelectionHandler` (no `initSelection`) |
| `{ initSearch }` from `interaction/search.js` | `class SearchHandler`, `createSearchHandler` (no `initSearch`) |
| `{ initSliders }` from `interaction/sliders.js` | `class SliderController`, `createSliderController` (no `initSliders`) |
| `{ initComboExpand }` from `interaction/combo-expand.js` | `class ComboExpandHandler`, `createComboExpandHandler` (no `initComboExpand`) |

That is 13 of `main.js`'s ~18 imports calling a name that resolves to `undefined` in its target module. Even in a hypothetical world where every `.js`→TS problem in §4.0 were fixed, `ViewerApp.init()` would throw `TypeError: initFileLoader is not a function` on its very first call (`main.js:58`). No module in `viewer/` was ever actually loaded together with `main.js` and exercised — the naming convention (`init*` factory functions) that `main.js` assumes was apparently the *intended* design (per `implementation_plan.md`'s module descriptions) but was never implemented in the actual files, which instead export ES classes and `create*Handler` factories.

### 4.2 [CRITICAL] `interaction/selection.js` constructor throws on first use
**File:** `viewer/interaction/selection.js:32-40`. Confirmed by direct read:
```js
constructor(options) {
    this.indexes = options.indexes;
    this.graphData = options.graphData;
    ...
    if (graphData.nodes) {          // `graphData` is never declared — only `options.graphData`/`this.graphData` exist
      for (let i = 0; i < graphData.nodes.length; i++) {
```
`new SelectionHandler(...)` throws `ReferenceError: graphData is not defined` immediately, independent of every wiring/parsing issue above.

### 4.3 [CRITICAL] Core files disagree with each other about the shape of the data they pass around
The spec's own architectural principle (implementation_plan.md §1.1: "a shared, validated contract... is the single biggest source of 'worked in my test, broke on theirs' bugs") is violated *within* Tool 2 itself, between files that are supposed to compose:
- `core/resolver.js` expects `indexes.sortedBuildCost[i]`/`sortedBottleneckScore[i]` as **numeric value arrays indexed by node index**, and expects `indexes.nodeToKind`/`indexes.nodeToComboDepth`. `core/indexes.js` actually produces `sortedMetricArrays` as a **map of metric name → array of node-ID strings** (a sort permutation, not a value lookup) that doesn't even include `bottleneckScore` as a key, and never produces `nodeToKind`/`nodeToComboDepth` at all.
- `interaction/hover.js`, `selection.js`, `search.js`, `combo-expand.js` all expect `indexes.nodeIdToIndex`, `indexes.nodeIndexToId`, `indexes.nodeToOutgoing`, `indexes.nodeToIncoming`, and `indexes.comboChildren[comboId]` (array-indexed). `core/indexes.js` never produces the first four at all, and produces `comboChildren` as a `Map` (bracket-indexing a `Map` silently returns `undefined`, not a lookup).
- `perf/culling.js` calls `spatialIndex.rangeQuery(minX,maxX,minY,maxY)`; `core/indexes.js`'s spatial index only exposes `.query(bounds)`.
- `interaction/search.js` calls `indexes.searchIndex.search(query)`; `core/indexes.js`'s trigram builder returns raw `{trigrams, nodeIdToLabel}` maps with no `.search()` method.
- `interaction/sliders.js` reads `state.analysisModes.reachabilityMode`; `core/state-store.js`'s actual state shape has no `analysisModes` field — the real data lives at `metadata.reachabilityMode` per the schema.
- `interaction/breadcrumb.js` (the unwired one) reads `currentState.searchQuery`/`.metricSliderMin`; `state-store.js`'s real fields are `state.search.query`/`state.sliders.buildCost`.

Every one of these is a different pair of files independently inventing an incompatible shape for what should be one shared data structure — not a single bug, but the systemic failure mode the implementation plan's own architecture section was designed to prevent.

### 4.4 [HIGH] Entire spec sections have no implementation at all (not merely buggy — the files don't exist)
`render/lod.js`, `render/edges.js`, `render/styles.js` (implementation_plan.md T2.14/T2.15/T2.18) and `ui/legend.js`, `ui/tooltip.js`, `ui/filter-indicator.js`, `ui/analytics-panel.js`, `ui/diagnostics-panel.js` (T2.19–T2.23) do not exist anywhere in `viewer/`. Consequently, none of the following spec-mandated behavior exists in any form: LOD tiering and critical-edge LOD-0 exemption (§5.2), combo-edge aggregation/`×N` labels/thinning (§4.5, §5.4), heatmap fill and the `#ff4d4f`→`#00d9ff` critical/heatmap color swap (§5.3, §5.9), the legend panel (§4.2.1), node tooltip (§4.2), filter indicator (§4.2), analytics panel (§4.2), and diagnostics panel / "Copy Diagnostic Report" UI (§4.2, §4.11). This is roughly a third of Tool 2's planned surface area, entirely absent rather than merely wired incorrectly.

### 4.5 [HIGH] Adaptive-quality recovery reproduces the exact flapping bug the spec names and warns against
**File:** `viewer/perf/fps-monitor.js:130-142`. Spec §5.2.1 is explicit: "Recovery requires 3 seconds of sustained above-target FPS **AND at least one interaction event**... without the interaction requirement, a session could flap between quality tiers on every subsequent interaction." Implementation-plan T2.17 names this "regression test for the v5.4.0 flapping fix" as an acceptance criterion.

`fps-monitor.js`'s `recover()` fires the instant the 30-sample rolling average crosses `RECOVERY_THRESHOLD = 50`, gated only by a 100ms cooldown between adjustment checks — **no 3-second sustained window, no interaction-event requirement at all.** `perf/adaptive-quality.js` layers a second, differently-shaped gate on top that suppresses changes *during* interaction and applies them ~500ms *after* interaction ends — the **inverse** of the spec's intent (spec wants an interaction event required *during* the stability window, not suppressed by it), using 500ms rather than the spec's `adaptiveQualityStabilityWindowMs = 3000`. The two files' "quality tier" vocabulary (`'high'/'medium'/'low'`) is also disconnected from `core/modes.js`'s `renderMode`/`datasetMode`, so nothing actually "drops one LOD/budget tier" as §5.2.1 requires — there's no wiring from FPS degradation to an actual rendering-budget change.

### 4.6 [HIGH] `core/indexes.js`'s neighbor index is built one-directional, silently breaking half the graph
**File:** `viewer/core/indexes.js:61-77`. Only `edge.source`'s neighbor/edge lists are appended to; `edge.target` never receives the reciprocal entry. Spec §4.3 requires `nodeToNeighbors: Map<nodeId, Set<nodeId>>` to be **undirected**. As written, any node that only ever appears as an edge's `target` (e.g. a leaf dependency with only incoming edges) gets an empty neighbor list — hover, selection-neighborhood, and search-ancestor-expansion (all of which read this index) would silently fail for such nodes even if every wiring/parsing bug elsewhere were fixed.

### 4.7 [HIGH] `interaction/combo-expand.js` never checks the two numeric thresholds §4.6 is built around
`animatedExpansionThreshold` (2000) and `maxExpansionElements` (10000) are referenced nowhere in the file. There is no element-count check before an expansion executes, no animate-vs-snap branch at the 2000 boundary, and no confirmation-dialog trigger at the 10000 boundary — the file implements the 4 dialog *options* correctly (including the zero-critical-nodes disable case) but never actually decides *when* to show the dialog based on size, which is the mechanism §4.6 exists to specify.

### 4.8 [MEDIUM] `interaction/selection.js` truncation priority implements 2 of the 4 required tiers
Spec §4.8: truncation priority is "(1) critical status, (2) bottleneck score, (3) blast radius, (4) node ID," applied across the whole multi-hop candidate set. The code implements tier 1 (critical status, correctly pooled across all hops) but never reads or compares bottleneck score or blast radius at all; the non-critical fallback is ordered purely by **hop distance** (`for (const hop of [1,2,3])`) — not one of the four spec-listed criteria, and applied hop-by-hop, which is exactly the ordering §4.8 says *not* to use as the primary criterion. (The zero-dangling-edge guarantee, separately, is correctly implemented and self-verified in the same file.)

### 4.9 [MEDIUM] Two independent, non-communicating `breadcrumb.js` implementations
`viewer/interaction/breadcrumb.js` (never imported by anything) correctly implements §4.2's click behavior — collapse-below-level, clear-selection-below-level, preserve search/sliders, budget clamp. `viewer/ux/breadcrumb.js` (the one `main.js` actually references, modulo §4.1's export mismatch) implements only DOM rendering of the trail plus a click handler that changes selection — none of collapse, clear-below-level, state preservation, or budget clamping exist in it. Even where `interaction/breadcrumb.js` tries to preserve state, it reads field names (`currentState.searchQuery`) that don't match `state-store.js`'s real shape (`state.search.query`) — so it wouldn't work correctly even if wired in.

### 4.10 [MEDIUM] `perf/culling.js` implements no viewport margin
Spec §5.6 mandates "Viewport + 25% margin" (`viewportCullMarginPct = 25`, §5.10). `culling.js:21-56` computes `viewportBounds` directly from the raw viewport rectangle with no expansion factor at all — the constant is defined in the spec but never referenced anywhere in this file.

### 4.11 [MEDIUM] `core/modes.js`'s `renderMode` is a fabricated 3-value enum
Spec §2.2/§5.1 defines `renderMode` using the same 5-value enum as `datasetMode` (`normal/large/huge/extreme/ultra`), each with its own node/edge visible-set budget (15000/30000, 10000/20000, 5000/15000, 3000/10000 from the §5.1 table). `modes.js` instead defines `RenderMode = 'normal' | 'aggressive_culling' | 'safe_mode'` — a 3-value invention with none of the §5.1 budget numbers present anywhere in the file. The `renderMode`-capped-by-`datasetMode` logic (`Math.min(...)`) is structurally present but operates over the wrong enum, so it can't express "more permissive for labels/animation but not for combo-depth/dagre" (§2.2's whole point) at all — there's only one severity axis, not the two the spec's split requires.

### 4.12 [LOW] `core/combo-depth.js` uses heuristic bucketing, not the spec's monotonic budget walk
Spec §4.5.1: "starting from depth 0, walk deeper while the estimated visible-node sum stays under budget... stop at the deepest level that fits." The implementation instead classifies the combo tree into heuristic buckets ("pathological"/"balanced"/"deep-narrow") and picks a depth from a small fixed set based on the bucket, checking overflow only at that one guessed depth rather than incrementally — a tree that's fine at depth 1 but overflows at depth 2 can fall straight to depth 0 instead of the correct depth 1. It also estimates budget by counting *combo* nodes, not the graph-node budget the spec specifies, systematically under-costing combos with many members. (Moot in practice since this file is never imported — §4.0/4.1 — but worth fixing since it's a real algorithmic gap, not just a wiring gap.)

### 4.13 [LOW] `perf/logger.js`'s ring buffer can return entries out of chronological order once wrapped
The `MAX_BUFFER_SIZE=500` cap and entry shape (`level/module/message/context/timestamp`) match spec §5.10/§4.11, but the overwrite-slot arithmetic (`this.index % MAX_BUFFER_SIZE`) doesn't preserve logical insertion order once the buffer has wrapped past 500 entries, so "last N log lines" in a Copy Diagnostic Report could return stale-looking ordering. Separately, no code path anywhere calls `logger.exportDiagnosticReport()`, and it doesn't itself include "active filters, FPS history, browser/G6 version" as §4.11 requires — `main.js`'s `getDiagnosticReport()` assembles some of that independently but never merges in the logger's own export, and there is no "Copy Diagnostic Report" UI button at all (`ui/diagnostics-panel.js` doesn't exist, §4.4).

---

## 5. Remediation Task List

Format follows `implementation_plan.md`'s convention: **Depends on / Deliverable / Acceptance Criteria**, with every acceptance criterion phrased as a concrete, runnable test. Tasks are ordered so fixing them in sequence keeps the pipeline runnable at each step. `R0` blocks everything — nothing else in this list can be verified without it.

### R0 — Make the project buildable and testable
**Depends on:** nothing. **Blocks:** every other task below (none of their acceptance criteria can be automated without this).
**Deliverable:** `requirements.txt` (or `pyproject.toml`) declaring `networkx`, `jsonschema`, and any other runtime dependency actually imported by `bst_graph_extractor/`; a Python test runner (`pytest`) wired up with a `tests/` directory; a JS test runner (e.g. `vitest`/`jest`) with a `package.json`; CI config (or at minimum a documented `make test` / `npm test` / `pytest` entry point) that runs both.
**Acceptance criteria:**
- [ ] `pip install -r requirements.txt && python3 -m bst_graph_extractor.cli <fixture>.txt` succeeds from a clean virtualenv with no manual `pip install` steps beyond the manifest.
- [ ] `pytest` (or equivalent) discovers and runs at least one real test file; exit code reflects pass/fail.
- [ ] A JS test command (documented in a README or `package.json` script) runs at least one real test file for a `viewer/` module.
- [ ] CI (or a documented local command) fails the build if either test suite fails — i.e., this task is not "done" until a red test can actually block a merge.

### R1 — Fix the node-metrics serialization bug (root cause of §2.1)
**Depends on:** R0.
**Deliverable:** `serializer.py`'s `assemble_output()` reads each node's computed fields from the `node` dict it already receives (which `cli.py` already merges metrics into), not from the separately-passed, always-empty `node_metrics` parameter. Either wire the real per-node metrics dict through, or remove the redundant parameter entirely and read fields directly off `node`.
**Acceptance criteria:**
- [ ] Running the extractor against `fixtures/dag.txt` (or the fixture-generator's `dag` scenario) produces **at least 3 distinct `style.fill` values** across the output's nodes (matching the number of distinct `kind` values in that fixture) — regression test for "every node identical."
- [ ] The known-critical nodes in the `dag` fixture (per the fixture generator's own hand-computed `isCritical: true` values) appear as `isCritical: true` in the extractor's real output, not just the fixture's reference JSON.
- [ ] `inDegree`/`outDegree` in the output match direct computation from the `edges` array in the same output (i.e., internally self-consistent — an edge `A->B` implies `B.inDegree >= 1` and `A.outDegree >= 1`).
- [ ] `levelCounts` in `metadata` sums to `totalNodes` and has more than one key for any fixture with more than one topological layer (regression test for "levelCounts collapses to a single fake layer").
- [ ] `blastRadius`/`buildCost`/`bottleneckScore` are non-null for every node in a fixture where `reachabilityMode == "exact"` (per spec §3.3: exact mode has no nulls).

### R2 — Fix `--precompute-layout`
**Depends on:** R1.
**Deliverable:** `assemble_output()` writes computed layout coordinates onto each node's top-level `x`/`y` fields (not a new `"layout"` top-level key); `layout.py` maps sanitized DOT node IDs back to original node IDs before returning coordinates.
**Acceptance criteria:**
- [ ] `python3 -m bst_graph_extractor.cli fixtures/dag.txt -o out.json --precompute-layout` exits 0 and writes `out.json` (regression test for the confirmed crash in §2.2).
- [ ] Every node in the output has a non-`(0.0, 0.0)` `x`/`y` pair (unless the fixture is a true 1-node graph where graphviz may legitimately place it at origin).
- [ ] `metadata.layoutPrecomputed == true` and `metadata.analysisModes.layout == "graphviz"`.
- [ ] No top-level key outside `{metadata, nodes, edges, combos}` exists in the output (schema `additionalProperties: false` regression test, run for both `--precompute-layout` and without it).
- [ ] `--precompute-layout` with `dot` mocked/renamed-away still exits 1 with an ERROR log naming the missing dependency, per spec §3.1/§3.5 (verify this path wasn't broken by the fix).

### R3 — Wire up combo hierarchy and aggregation
**Depends on:** R1.
**Deliverable:** a combo-tree builder (grouping nodes by path-prefix hierarchy per spec §3.3/§4.3, including an always-present `@root` combo) invoked from `cli.py`, feeding real children into `combo_aggregator.compute_combo_aggregates()`, which is corrected to emit exactly the spec-defined field set (`nodeCount`, `minTopoLayer`, `maxTopoLayer`, `hasCritical`, `maxBlastRadius`, `maxBuildCost`, `maxBottleneckScore` — max-only, no min/avg/sum) and the correct `collapsedSize` formula (`max(minSize, log2(nodeCount+1)*scalar)`, `minSize=[60,40]`, `scalar=20`, returned as a `[width, height]` pair).
**Acceptance criteria:**
- [ ] Every fixture's output `combos` array contains an `@root` entry with `data.nodeCount == metadata.totalNodes`.
- [ ] `nested_combos`-style fixture (nodes under `components/component_a.bst`, `base/library1.bst` etc.) produces a combo for each path segment, with `nodeCount` correctly reflecting nested descendants, not just immediate children.
- [ ] A combo whose members are all reachability-`null` (targeted-mode fixture) has `maxBuildCost: null`, never `0` (direct test of spec §3.3's "never 0" rule).
- [ ] `collapsedSize` for 3 constructed `nodeCount` values (including the `minSize` floor case) matches hand computation of `max([60,40], log2(n+1)*20)` component-wise.
- [ ] Output combo `data` keys are exactly `{nodeCount, minTopoLayer, maxTopoLayer, hasCritical, maxBlastRadius, maxBuildCost, maxBottleneckScore, label}` — no extra undocumented fields.

### R4 — Correct `schemaVersion`
**Depends on:** R0.
**Deliverable:** `serializer.py` emits `metadata.schemaVersion` matching the actual schema file's version (single source of truth — read from the schema file itself or a shared constant, not a separate hardcoded literal, so the two can never drift again).
**Acceptance criteria:**
- [ ] `metadata.schemaVersion == "5.5.0"` (or current spec version) on every fixture's real output.
- [ ] A test asserts `serializer.SCHEMA_VERSION == json.load(open(schema_path))["properties"]["metadata"]["properties"]["schemaVersion"].get("const")` or equivalent single-source check, so a future schema bump can't silently desync from the emitted value again.

### R5 — Implement the real `bst show` invocation contract
**Depends on:** R0.
**Deliverable:** `bst_interface.py` issues the three documented invocations (`--deps all --format '%{name}|%{kind}'`, `--deps build --format '%{name}|%{deps}'`, and `--deps run --format '%{name}|%{deps}'` when `--include-runtime`); `parser.py` parses the real `%{deps}`-list output shape those commands produce, not the invented single-command grammar.
**Acceptance criteria:**
- [ ] A mocked `subprocess.run` captures exactly the documented command lines (asserted argument lists) for both the `--include-runtime` and default cases.
- [ ] `--include-runtime` omitted → only 2 `bst show` invocations occur (verified via mock call count); included → 3.
- [ ] Parser correctly handles the real `%{deps}` bracketed/list output shape (construct a realistic sample based on spec §3.2's textual description) for both build and runtime dependency lines, merging duplicates into `depType: "both"` per spec.
- [ ] Existing fixture-file-based tests (`.txt` fixtures) are updated to match the real format so they remain meaningful regression tests rather than testing an invented grammar.

### R6 — Fix betweenness/articulation tiering and status reporting
**Depends on:** R0.
**Deliverable:** `betweenness.py` defaults to `"approximate"` at every size ≤50k (never `"exact"` unless `--expensive-metrics`); `articulation.py` gains the same size-tiered approximate/disable-above-50k behavior as betweenness, or (if no networkx approximate-articulation-points algorithm exists) the spec's tiering requirement is renegotiated with the spec author rather than silently ignored; `articulation.py`'s success status maps to a schema-valid value (`"exact"`/`"approximate"`), not the unrecognized `"success"` string that silently coerces to `"disabled"`.
**Acceptance criteria:**
- [ ] Betweenness on a 500-node fixture with no flags → `analysisModes.betweenness == "approximate"` (regression test for the confirmed `"exact"`-by-default bug).
- [ ] Betweenness with `--expensive-metrics` on the same fixture → `"exact"`.
- [ ] Tier-boundary tests at 10,000/10,001 and 50,000/50,001 nodes select the values the spec table actually documents (approximate/approximate/disabled, not exact/approximate/disabled).
- [ ] A fixture where articulation succeeds → `analysisModes.articulation` is `"exact"` or `"approximate"`, never `"disabled"` (regression test for the confirmed status-coercion bug), and `isArticulationPoint` flags on nodes match the computed set.

### R7 — Fix reachability: remove forbidden per-node calls, fix memory estimate, fix targeted-set selection and stage ordering
**Depends on:** R1, R6 (targeted mode needs articulation/critical-path results, which requires reordering pipeline stages so reachability runs after those, or restructuring to pass them in).
**Deliverable:** exact-mode reachability computed via SCC-DAG bitset closure (not per-node `nx.ancestors`/`nx.descendants`); memory estimate based on SCC count `C` (`C²/8` bytes, matching spec's own worked example, no unexplained multiplier); targeted mode's node set is the union of articulation points, critical-path nodes, and top-K by *both* in- and out-degree; pipeline stage order changed so reachability has access to articulation/critical-path results when building the targeted set.
**Acceptance criteria:**
- [ ] Exact mode matches brute-force `nx.descendants`/`nx.ancestors` node-for-node on a small fixture (correctness unchanged), but a call-count/profiling assertion confirms the exact-mode code path never calls `nx.ancestors`/`nx.descendants` in a per-node loop (spy-verified or algorithmically inspected).
- [ ] `estimate_memory_requirement` reproduces the spec's own worked example: ~1.25GB estimated for a graph condensing to 100,000 independent SCCs (within reasonable tolerance, no 10x-off result).
- [ ] Targeted mode on a fixture with known articulation points and a known critical path: 100% of those nodes have non-null `blastRadius`/`buildCost`, not just the top-K-by-out-degree subset.
- [ ] `--max-reachability-memory` set artificially low on a mid-size fixture → `reachabilityMode: "targeted"` with a WARNING log giving concrete estimated-vs-budget MB numbers matching the corrected formula.

### R8 — Fix style precomputation to match spec §3.3/§5.3/§5.4
**Depends on:** R1.
**Deliverable:** `styler.py` — critical nodes get **stroke** color change only (`#ff4d4f`, `lineWidth: 3`); fill is always a pastel-lightened variant of the kind color (implement an actual lightening transform, e.g. HSL lightness boost) for both critical and non-critical nodes; non-critical edges get `depTypeColorMap`-derived stroke, `opacity: 0.4`, `endArrow: false`; critical edges get `#ff4d4f`, `lineWidth: 4`, `opacity: 1.0`, `endArrow: true`. `serializer.py` stops hardcoding `endArrow`/`opacity` and reads them from the computed style dict.
**Acceptance criteria:**
- [ ] Two nodes of the same `kind`, one critical one not, have **identical `style.fill`** and **different `style.stroke`/`lineWidth`** in the output (direct regression test for the fill/stroke swap bug).
- [ ] A non-critical `depType: "runtime"` edge's `style.stroke` matches `metadata.depTypeColorMap.runtime`, `style.endArrow == false`, `style.opacity == 0.4`.
- [ ] A critical edge has `style.endArrow == true`, `style.opacity == 1.0`, `style.stroke == "#ff4d4f"`, `style.lineWidth == 4`, regardless of its `depType`.
- [ ] Same `kind` value → identical `fill` across two separate runs (determinism check, already partially covered by existing code but should be a real test).

### R9 — Fix critical-path per-node depth/height and add `componentCriticalPathLength`
**Depends on:** R1.
**Deliverable:** `_compute_cp_depth`/`_compute_cp_height` use longest-path DP (consistent with `_longest_path_in_dag`'s existing approach), not shortest-path Dijkstra; `componentCriticalPathLength = max(cpDepth[v] + cpHeight[v])` is computed and threaded into node output.
**Acceptance criteria:**
- [ ] Hand-verified longest path on a small constructed DAG with multiple source-to-node paths of different lengths — `cpDepth` matches the longest, not shortest, path length (regression test distinguishing the two).
- [ ] `componentCriticalPathLength` appears in every node's output `data`, and for at least one hand-constructed fixture, matches `max(cpDepth[v] + cpHeight[v])` computed independently in the test.
- [ ] Cyclic-SCC-feeding-a-critical-chain fixture: no edge with `isCritical: true` touches a node with `isCycle: true` (already-intended regression test from T1.10, now actually runnable).

### R10 — Fix `graphSizeClass` thresholds
**Depends on:** R0.
**Deliverable:** `_classify_graph_size` uses spec §2.1's boundaries (5,000/20,000/50,000/100,000) and considers edge count as well as node count (escalate on edge density, matching §2.1's stated behavior), not just node count against different boundaries.
**Acceptance criteria:**
- [ ] Boundary tests at exactly 5000/5001, 20000/20001, 50000/50001, 100000/100001 nodes select the documented `graphSizeClass` values.
- [ ] A constructed 10k-node/200k-edge fixture lands in a more restrictive class than a 20k-node/25k-edge fixture would, per spec §2.1's explicit example (edge-density escalation test).

### R11 — Fill fixture coverage gap (T0.2)
**Depends on:** R0.
**Deliverable:** extend `fixtures/generator.py` with the missing scenarios: multi-node fully-cyclic, multi-node partially-cyclic, disconnected graph, high-degree hub, and seeded 10k/50k/100k-node graphs at configurable density (per T0.2's original spec).
**Acceptance criteria:**
- [ ] Same seed → byte-identical generator output across two runs, for every new scenario (matches T0.2's existing requirement).
- [ ] Every new JSON fixture validates against `graph_data.schema.json`.
- [ ] The 10k/50k/100k fixtures are consumable by an actual T3.1-style end-to-end run (real extractor → real fixture → recorded timing), not just schema-valid in isolation.

### R12 — Correct `IMPLEMENTATION_STATUS.md` or remove it from the repo
**Depends on:** R1–R11 (or a subset, if the document is corrected incrementally as fixes land).
**Deliverable:** either delete the status document (it's a point-in-time claim that's actively misleading given the above) or rewrite it to accurately reflect what's implemented, tested, and passing — with phase-complete claims gated on the R0 test suite actually passing, not on file existence.
**Acceptance criteria:**
- [ ] No claim in the document references a flag, behavior, or "complete" status that isn't backed by a passing test from the R0 suite.
- [ ] The document either doesn't exist, or is regenerated/reviewed as part of CI so it can't drift from reality again.

### R13 — Get the viewer to parse and load at all
**Depends on:** R0.
**Deliverable:** strip all TypeScript syntax from `core/modes.js`, `core/indexes.js`, `core/combo-depth.js`, `core/schema-validate.js`, `render/g6-adapter.js`, `ui/file-loader.js` (either compile through `tsc`/`esbuild` and commit the JS output, or hand-convert to plain JS — pick one and be consistent, since the project has no build step today); create `viewer/utils/logger.js` or repoint the 4 `ux/*.js` imports at the real `perf/logger.js` API; add AntV G6 (via `package.json` + bundler, or a vendored/CDN copy consistent with the "single static HTML" deliverable) so `@antv/g6` resolves to something.
**Acceptance criteria:**
- [ ] `node --input-type=module -e "import('./viewer/main.js')"` (or the equivalent bundler build) does not throw `SyntaxError` for any file reachable from `main.js`.
- [ ] A headless-browser smoke test (Playwright/Puppeteer) loads the eventual `bst_graph_viewer.html` and confirms `window.viewerApp` exists with no console errors during initialization against an empty-graph fixture.
- [ ] `grep -rn "assert { type\|export interface\|export type " viewer/` returns zero matches (regression guard against TS syntax creeping back into `.js` files).

### R14 — Fix `main.js`'s import/export contract against every module it wires
**Depends on:** R13.
**Deliverable:** either rename each target module's exports to match what `main.js` expects (`init*` factory functions, per the implementation plan's apparent intent), or rewrite `main.js` to use each module's actual exported names (`class X` + `createXHandler` pattern). Pick one convention repo-wide and apply it consistently — do not leave the two conventions coexisting.
**Acceptance criteria:**
- [ ] `ViewerApp.init()` (or its replacement) completes without throwing for every one of the ~18 imports currently listed in §4.1's mismatch table — verified by a test that constructs the app against a minimal DOM/fixture and asserts no exception.
- [ ] A lint rule or test enumerates every named import across `viewer/**/*.js` and asserts the imported name is an actual export of the target file (prevents this class of bug from recurring silently).

### R15 — Fix `interaction/selection.js` constructor crash
**Depends on:** R13.
**Deliverable:** `selection.js:32-40` reads `options.graphData` (or `this.graphData`, already assigned one line above), not the undeclared `graphData`.
**Acceptance criteria:**
- [ ] `new SelectionHandler({graphData: {nodes: [...]}, indexes: {...}})` (or `createSelectionHandler(...)`) constructs without throwing, for a fixture with at least one critical node, and `_criticalNodeIndices` contains the expected indices.

### R16 — Establish one shared shape for `indexes` and fix every consumer to match it
**Depends on:** R13, R14.
**Deliverable:** `core/indexes.js` is the single source of truth for the index object's shape (per spec §4.3: `nodeToNeighbors`, `nodeToEdges`, `comboChildren/Parent/Depth`, `comboBounds`, `comboSpatialIndex`, `searchIndex` with a real `.search()` method, `spatialIndex` with a `.query()`/`.rangeQuery()` method matching what callers actually use, `sortedMetricArrays` as typed `Uint32Array`/`Float32Array` **node-index** arrays for exactly `{blastRadius, buildCost, bottleneckScore}`). Every consumer (`resolver.js`, `hover.js`, `selection.js`, `search.js`, `combo-expand.js`, `culling.js`) is updated to read that shape — not a shape it independently assumed.
**Acceptance criteria:**
- [ ] A single shared type/JSDoc/schema for the indexes object is defined once and imported (not redefined) by every consumer file.
- [ ] `nodeToNeighbors` is verified undirected: for a fixture edge `A->B` (B has no outgoing edges), `nodeToNeighbors.get('B')` contains `'A'` (regression test for the source-only bug in §4.6).
- [ ] `sortedMetricArrays` includes `bottleneckScore`, and a binary-search test against it (mirroring `resolver.js`'s intended O(log V) range query) returns correct results on a constructed fixture — not just "the array is sorted" but "resolver.js's actual lookup code returns the right node set."
- [ ] `searchIndex.search(query)`, `spatialIndex.rangeQuery(...)`/`.query(...)` (whichever the culling/search code actually calls) exist and return correct results against a small fixture.
- [ ] `interaction/sliders.js` reads `metadata.reachabilityMode` (the real schema location), not `state.analysisModes.reachabilityMode`; a test with a `targeted`-mode fixture confirms the slider shows the correct enabled-with-note state.

### R17 — Fix adaptive-quality recovery gating (regression of the named v5.4.0 flapping bug)
**Depends on:** R13.
**Deliverable:** `perf/fps-monitor.js`'s recovery path requires both (a) ≥3000ms of sustained above-target FPS (`adaptiveQualityStabilityWindowMs`) and (b) at least one interaction event during that window, per spec §5.2.1 — not an immediate threshold-cross. `adaptive-quality.js`'s interaction-suppression logic is removed or reconciled so the two files implement one coherent state machine, not two disagreeing ones. Degradation trigger counts *consecutive* below-target frames (>30), not a rolling average. Both are parameterized by the current `renderMode`'s target FPS (§5.6's table), not flat constants. A successful degrade/recover event actually drops/restores one LOD/budget tier (wired to whatever `core/modes.js`/`render/lod.js` end up being after R11/R21).
**Acceptance criteria:**
- [ ] Simulated FPS below target for exactly 31 consecutive frames → exactly one degrade event (matches T2.17's original acceptance criterion).
- [ ] Simulated FPS above target for 3+ seconds with **zero** interaction events → no recovery (direct regression test for the confirmed bug in §4.5).
- [ ] Same scenario with one interaction event injected mid-window → recovery fires only after the full window completes.
- [ ] Degrade/recover events are observable as an actual change to a rendering budget or LOD tier (not just an internal `'high'/'medium'/'low'` flag disconnected from rendering).

### R18 — Implement the missing render-tier modules
**Depends on:** R13, R14.
**Deliverable:** `render/lod.js` (zoom-threshold tiers, critical-edge LOD-0 exemption, `maxCanvasLabels` priority order per §5.2), `render/edges.js` (combo-edge aggregation/`×N` labels, partial-criticality sub-labels, `maxDetailedEdges` stable-seeded thinning per §4.5/§5.4), `render/styles.js` (fill/stroke channel priority, heatmap incl. combo-aggregate null-handling, critical/heatmap color swap per §5.3/§5.9) — matching `implementation_plan.md` T2.14/T2.15/T2.18's original acceptance criteria, which can be lifted directly from that document.
**Acceptance criteria:** (verbatim from `implementation_plan.md` T2.14/T2.15/T2.18, since they were never actually executed against real code)
- [ ] Zoom-boundary tests at 0.29/0.3, 0.79/0.8, 1.19/1.2 select the correct LOD tier.
- [ ] Mixed critical/non-critical-edge fixture at LOD 0: critical edges retain full styling, non-critical do not.
- [ ] Aggregated combo-to-combo edge count label matches the true underlying edge count; mixed-criticality aggregate shows the correct "N/M critical" sub-label.
- [ ] Two renders of the same over-`maxDetailedEdges` visible set produce an identical thinned subset (determinism), never excluding a critical edge.
- [ ] A node satisfying both "critical" and "high bottleneck" shows critical styling (priority test); heatmap on a `null`-aggregate combo shows no fill, not a false zero-color.

### R19 — Implement the missing UX chrome modules
**Depends on:** R13, R14, R18 (legend/tooltip depend on styles.js existing).
**Deliverable:** `ui/legend.js`, `ui/tooltip.js`, `ui/filter-indicator.js`, `ui/analytics-panel.js`, `ui/diagnostics-panel.js` per T2.19–T2.23's original specs, including a working "Copy Diagnostic Report" button that calls `logger.exportDiagnosticReport()` merged with `stateStore.dumpState()`, FPS history, and browser/G6 version — none of which is currently assembled in one place anywhere in the codebase.
**Acceptance criteria:** (from `implementation_plan.md` T2.19–T2.23)
- [ ] Legend content changes correctly across every toggle combination; heatmap gradient row appears only while heatmap is active.
- [ ] `null` `blastRadius` under `targeted` mode shows the specific reason string in the tooltip; no field ever renders literal `null`/blank.
- [ ] "Show all" in the filter indicator fully restores the visible set without a layout call (position-stability check).
- [ ] Exported diagnostic report is non-empty and includes mode state, active filters, FPS history, browser/G6 version, and at least one log entry after deliberately inducing a warning (e.g. a truncated neighborhood).

### R20 — Fix `combo-expand.js`'s missing size thresholds
**Depends on:** R13, R16.
**Deliverable:** wire `animatedExpansionThreshold = 2000` and `maxExpansionElements = 10000` into the actual expand-trigger logic — compute the subtree's element count (via the fixed `comboChildren` from R16) before deciding whether to animate, snap, or show the confirmation dialog.
**Acceptance criteria:**
- [ ] Expanding a combo with <2000 resulting elements animates (200ms); ≥2000 snaps instantly (both verified via a spy on the animation call, not just code inspection).
- [ ] Expanding a combo with >10000 resulting elements shows the confirmation dialog before any state change occurs; ≤10000 does not.
- [ ] All 4 dialog options continue to produce their documented visible-set outcome after the threshold logic is added (regression test against the already-correct parts of this file).

### R21 — Fix `interaction/selection.js`'s truncation priority
**Depends on:** R13, R15, R16.
**Deliverable:** implement all 4 documented tiers (critical status, bottleneck score, blast radius, node ID) as comparators applied across the pooled whole-candidate-set, not hop-scoped fallback.
**Acceptance criteria:**
- [ ] Constructed fixture where a 2nd-hop critical node must outrank a 1st-hop non-critical node for budget inclusion — verified included (this was T2.10's original, never-executed acceptance criterion).
- [ ] Constructed fixture where two non-critical nodes at the same hop distance are ranked correctly by bottleneck score, then blast radius, then node ID as tiebreakers.

### R22 — Unify the two `breadcrumb.js` implementations
**Depends on:** R13, R14, R16.
**Deliverable:** delete one of `interaction/breadcrumb.js` / `ux/breadcrumb.js` and merge their responsibilities (DOM rendering + collapse/clamp/preserve-state logic) into a single module wired into `main.js`, using `combo-depth.js`'s real budget-walk (not a second independently-invented size check) for the clamp, and reading `state-store.js`'s actual field names for state preservation.
**Acceptance criteria:**
- [ ] Clicking a mid-trail breadcrumb segment collapses combos below it and clears selection below it (verified against the real, wired `state-store.js`, not a mocked shape).
- [ ] Active search term and slider values are unchanged after the click (explicit before/after comparison against real state fields).
- [ ] A fixture where the target level's subtree contains a pathologically large combo produces a collapse depth clamped via the same function `combo-depth.js` uses for initial adaptive depth (shared-code assertion, not just "produces some clamped value").

### R23 — Add the missing 25% viewport-culling margin
**Depends on:** R13, R16.
**Deliverable:** `perf/culling.js` expands the viewport rectangle by `viewportCullMarginPct = 25` before querying the spatial index.
**Acceptance criteria:**
- [ ] 10k-node grid fixture: panning to a known viewport rectangle reveals/hides exactly the geometrically-expected node set at viewport+25% margin (T2.16's original criterion, now against a margin that actually exists).

### R24 — Replace `core/modes.js`'s 3-value `renderMode` with the spec's 5-value enum and real budgets
**Depends on:** R13.
**Deliverable:** `renderMode` uses `normal/large/huge/extreme/ultra` (same enum as `datasetMode`), with the §5.1 node/edge budget table (15000/30000, 10000/20000, 5000/15000, 3000/10000) driving actual visible-set decisions, and a mechanism distinguishing "permissive for labels/animation/hover" from "capped by datasetMode for combo-depth/dagre-eligibility/minimap" per §2.2.
**Acceptance criteria:**
- [ ] Boundary tests at every §5.1/§2.1 threshold (5000/5001, 20000/20001, 50000/50001, 100000/100001) for both node-count and edge-count triggers (T2.4's original criterion).
- [ ] On a `datasetMode: ultra` fixture, applying a filter that reduces the visible set to <100 nodes → `renderMode` recomputes to `normal` for label/animation decisions, while combo-depth/dagre-eligibility remain capped at `ultra`'s restrictions (the actual regression test for the "headline v5.3.0 fix" the implementation plan describes — not currently testable since the two-axis distinction doesn't exist in code).

### R25 — Ship the actual deliverable: `bst_graph_viewer.html`
**Depends on:** R13–R24 (or as many as are fixed before this is attempted — but this task is what "done" means for Tool 2).
**Deliverable:** a build step producing a single, self-contained `bst_graph_viewer.html` per spec §1/§4, bundling all `viewer/**/*.js` and the AntV G6 v5 dependency, with the shared `graph_data.schema.json` kept in sync via the checksum mechanism `implementation_plan.md` §1.1 describes.
**Acceptance criteria:**
- [ ] `bst_graph_viewer.html` exists, opens directly in a browser (via `file://` or a static server) with no build/dev-server dependency at runtime, and loads a fixture end-to-end (visible render, no console errors).
- [ ] A checksum/build-step test fails CI if `viewer/core/schema-validate.js`'s bundled schema copy diverges from `bst_graph_extractor/schema/graph_data.schema.json`.
- [ ] This is the task that finally makes T3.1/T3.2 (end-to-end pipeline test, contract regression suite) executable against the real deliverable rather than individual modules in isolation.

---

## 6. Suggested Remediation Order

1. **R0** first, always — no other task's acceptance criteria can be automated without a runnable environment and a test runner. This is the single highest-leverage fix: it is also *why* every bug in this report shipped as "complete" in the first place.
2. **Extractor core-correctness (R1 → R2 → R3 → R4):** fix the metrics-serialization bug first — it's the root cause behind the majority of observed null/zero/identical-style symptoms — then layout, then combos, then schemaVersion. These four alone would take the extractor from "produces uniformly-wrong output" to "produces structurally complete output," even before the remaining tiering/algorithmic fixes (R5–R10) land.
3. **Viewer bootability (R13 → R14 → R15 → R16):** in parallel with the extractor work, since Tool 2 doesn't need a working extractor (per `implementation_plan.md` §3's own stated parallelization) — get the app to parse, get `main.js`'s wiring correct, fix the one hard crash, and unify the indexes/state contract. Nothing else in the viewer can be verified before these four land, because nothing currently runs.
4. **Extractor tiering/algorithmic correctness (R5–R10)** and **viewer feature completion (R17–R24)** can proceed in parallel once their respective bootability gates (R0 / R13–R16) are clear.
5. **R11 (fixture coverage)** should land early enough to unblock **R25 (ship the actual HTML deliverable)** and the original T3.1/T3.2 integration tasks, which remain the project's actual finish line — the spec's stated goal is a working two-tool pipeline validated at 10k/50k/100k scale, and nothing in the current repo has ever been run at that scale even once.
6. **R12 (correct or remove `IMPLEMENTATION_STATUS.md`)** last, or continuously — re-derive it from the R0 test suite's actual pass/fail state rather than hand-maintaining it, so it can't drift from reality again the way it has here.

**Bottom line:** the specification and implementation plan are detailed and internally consistent; the gap is entirely in execution. Every module read for this review cites the correct spec section in its own docstring, which suggests the constants, thresholds, and algorithms *were* transcribed from the spec in most cases — the failures are almost all in the connective tissue between modules (parameter passing, export names, shared data shapes, pipeline stage ordering) and in the complete absence of anything that would have caught these problems before this review did.

