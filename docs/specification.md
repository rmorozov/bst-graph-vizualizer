# BuildStream Graph Toolkit — System Specification (v5.5.0)

## 1. System Overview

The BuildStream Graph Toolkit is a two-component system designed to extract, analyse, and visualise BuildStream dependency graphs with high performance and reusability.

* **Tool 1:** `bst_graph_extractor.py` – Python CLI that executes `bst show`, constructs and analyses the dependency graph, computes SCC condensation and graph metrics, optionally precomputes layout, and exports a self-contained, schema-validated JSON payload.
* **Tool 2:** `bst_graph_viewer.html` – Static HTML page using AntV G6 v5 to load the JSON and provide interactive graph analysis.

### Core Architectural Principles

1. **Analysis Ownership** — Graph construction and expensive analysis happen in Python. The frontend performs only interaction-oriented calculations.
2. **Honest Complexity** — No blanket O(V+E) claim. Every non-linear metric has an explicit performance class, execution policy, and a runtime timeout guard (§3.5) as backstop against the size heuristic being wrong.
3. **Analysis-Stateless Frontend** — JSON is authoritative for data/metrics. The viewer maintains transient interaction state only.
4. **Stable Geometry** — Filtering never triggers layout. Node positions are stable after initial layout.
5. **Progressive Disclosure** — Large graphs are explored hierarchically. The system never renders all elements with equal visual importance.
6. **Visible-Graph Principle** — The dataset and the rendered graph are separate concepts. Rendering-cost decisions (LOD, animation, labels, hover) track the *current visible set* (`renderMode`), not just static dataset size (`datasetMode`) — see §2.2.
7. **Performance Is a Correctness Property** — Unbounded work triggered by a single interaction is an implementation defect, enforced both by pre-emptive size heuristics and by runtime guards (timeouts, adaptive quality), never by heuristics alone.
8. **Data Honesty** — `null` always means "not computed/unavailable," never a display convenience. Approximate/targeted values are always visibly labeled.
9. **Fail Closed, Diagnose Fast** — On invalid input or an internal error, both tools stop, explain precisely what went wrong, and never proceed on partially-trusted data. Every state that isn't the happy path (degraded metric, dropped edge, truncated set, caught exception) is logged, not just silently applied.

---

## 2. Performance Envelope

### 2.1 Dataset Mode (fixed, from total counts)

| Graph Size | `datasetMode` | Governs |
|---|---|---|
| ≤ 5,000 | `normal` | Full interactive baseline |
| 5,001 – 20,000 | `large` | Dagre eligibility, initial combo depth |
| 20,001 – 50,000 | `huge` | Dagre forbidden, hierarchical-first defaults |
| 50,001 – 100,000 | `extreme` | Combo-first navigation, spatial culling on |
| > 100,000 | `ultra` | Best-effort; optional features disabled by default |

Computed from both node and edge counts — may escalate on edge density (a 10k-node/200k-edge graph can land in a more restrictive mode than a 20k-node/25k-edge graph). Never de-escalates during a session.

### 2.2 Render Mode (dynamic, from current visible set)

`renderMode` is recomputed whenever the visible set changes (filter, search, combo expand/collapse, viewport settle), using the same thresholds as §2.1 but evaluated against **currently-visible** node/edge counts. It governs LOD tier, animation eligibility, label budget, and hover availability.

`renderMode` is never more permissive than `datasetMode` for decisions baked into precomputed indexes (dagre eligibility, initial combo depth, minimap policy — pinned to `datasetMode`). It **can** be more permissive than `datasetMode` for animation/labels/hover when a huge dataset has been filtered down to a small visible slice — that relaxation is the entire point of the dataset/render mode split.

### 2.3 Continuous Monitoring

The implementation tracks visible nodes, visible edges, rendered labels, and active effects at all times. `renderMode` recomputation (§2.2) against the §5.1 budgets is the primary pre-emptive control. The adaptive quality mechanism (§5.2.1) — driven by measured FPS, which already reflects the true cost of labels and effects that a synthetic composite formula would approximate poorly — is the reactive control layered on top. No separate synthetic "interaction cost" score is maintained; the two mechanisms above are sufficient and each has a clearly defined trigger, which a composite score without per-mode thresholds did not.

---

## 3. Component 1: Data Extractor & Analyzer

### 3.1 CLI Interface
```bash
python3 bst_graph_extractor.py TARGET \
    [-o OUTPUT] \
    [--show-invalid] \
    [--include-runtime] \
    [--precompute-layout] \
    [--expensive-metrics] \
    [--betweenness-samples N] \
    [--no-betweenness] \
    [--no-reachability] \
    [--max-reachability-memory MB] \
    [--targeted-reachability-k K] \
    [--metric-timeout-seconds S] \
    [--performance-report] \
    [-v | -q]
```
* **TARGET** – BuildStream target element.
* `-o, --output` – JSON output (default: `graph_data.json`).
* `--show-invalid` – Parsing warnings to stderr.
* `--include-runtime` – Include runtime edges.
* `--precompute-layout` – Graphviz positioning (`rankdir: 'LR'`, Y-inverted). **Required** for any graph expected to exceed 20,000 nodes (§4.3 layout gate). If graphviz/pygraphviz is unavailable, this is a **hard error** (exit 1) naming the missing dependency — never a silent fallback to no layout.
* `--expensive-metrics` – Force exact betweenness and exact articulation points regardless of size. Warns on stderr above 20k nodes. Overridden by `--no-betweenness` if both are given.
* `--betweenness-samples N` – Approximate betweenness with N sources (default 500). Ignored once exact mode is active.
* `--no-betweenness` – Disable betweenness entirely. **Highest precedence** — overrides `--expensive-metrics`.
* `--no-reachability` – Disable reachability entirely (`reachabilityMode: "disabled_by_user"`).
* `--max-reachability-memory MB` – Memory budget for the exact bitset closure (default: 512). Echoed into output metadata.
* `--targeted-reachability-k K` – Size of the high-value subset for targeted reachability (default: 2000).
* `--metric-timeout-seconds S` – Wall-clock timeout per expensive-metric stage (default: 60). On timeout, that stage alone is aborted and marked `disabled_timeout`.
* `--performance-report` – Include timing/memory info in metadata.
* `-v` / `-q` – Increase/decrease log verbosity (§3.5).

**Precedence for betweenness flags:** `--no-betweenness` > `--expensive-metrics` > default size-based tiering.

### 3.2 External Contracts & Parsing
```text
bst show --deps all --format '%{name}|%{kind}' <TARGET>
bst show --deps build --format '%{name}|%{deps}' <TARGET>
bst show --deps run --format '%{name}|%{deps}' <TARGET>  (if --include-runtime)
```
Lines with `|` start a node. Lines starting with `- ` are dependencies. `[]` = empty. Duplicate build/runtime edges merge to `depType: 'both'`.

**Empty Graph:** `totalNodes: 0`, `totalEdges: 0`, empty node/edge/combo arrays, all scalar metrics `0`, `hasCycles: false`. `kindColorMap`, `depTypeColorMap`, `heatmapGradient`, and `schemaVersion` are **always present**, even on an empty graph.

### 3.3 Graph Analysis

#### SCC Condensation
`C = nx.condensation(G)`. Cyclic nodes: `isCycle: true`, `isCritical: false`, retain `sccId`. A self-loop is also cyclic and must participate in SCC detection.

#### Cheap Metrics (O(V+E) — Always Computed)
`inDegree`, `outDegree` (original graph), `topoLayer` (SCC-condensed DAG — all nodes in one SCC share a `topoLayer`), `levelCounts`, `maxConcurrencyWidth` (0 if empty), `maxTopoLayer` (0 if empty), `density` (0 if N<2), SCC membership, cycle flags.

#### Reachability Metrics
* `blastRadius` — distinct downstream reachable original nodes. `buildCost` — distinct upstream reachable original nodes. Both count distinct nodes, never paths.
* **Forbidden:** per-node `nx.descendants()` / `nx.ancestors()`.
* **Preferred exact path:** SCC-DAG bitset reachability. Memory ≈ `C²/8` bytes (e.g. 100,000 independent SCCs ≈ 1.25GB for a full closure).
* **Memory guard:** if the estimated closure exceeds `--max-reachability-memory` (default 512MB), fall back to **targeted mode** rather than disabling outright:
  - Computes *exact* `blastRadius`/`buildCost` via direct BFS for: all articulation points, all critical-path nodes, and the top-K nodes by out-/in-degree (K = `--targeted-reachability-k`, default 2000). Cost: `O(K·(V+E))` time, no quadratic memory.
  - Nodes outside the set get `null`. Never presented as covering all nodes.
* If disabled entirely (`--no-reachability` or targeted mode itself infeasible), all reachability fields are `null`.
* `reachabilityMode` ∈ `{"exact", "targeted", "disabled_by_user", "disabled_memory_budget", "disabled_timeout"}` (single field — replaces the earlier split boolean+string pair, which could disagree).

#### Betweenness Centrality (Tiered)
* ≤10k: approximate. >10k: approximate. >50k: disabled by default.
* `--expensive-metrics` forces exact at any size, subject to CLI precedence.
* Subject to the per-stage timeout guard (§3.1) — on timeout, `bottleneckMetric: "disabled"` with `analysisModes.betweenness: "disabled_timeout"`, logged as WARNING.
* Metadata: `"bottleneckMetric": "approximate"|"exact"|"disabled"`, `"bottleneckSamples": N`.

#### Articulation Points
On `G.to_undirected()`. Metadata: `"articulationSemantics": "undirected_projection"`. Tiered identically to betweenness (approximate/skippable above 50k by default, forced exact by `--expensive-metrics`, subject to the same timeout guard). Treated by the UI as a structural heuristic, not a directed dependency bottleneck.

#### Critical Path (Edge-Counted)
Calculated on the acyclic SCC-condensed graph. `cpDepth`, `cpHeight`, `componentCriticalPathLength = max(cpDepth[v] + cpHeight[v])`, `globalCriticalPathLength` (0 if empty/fully cyclic). Cyclic nodes are never critical.

**Edge criticality:** `edge.isCritical` requires **both endpoints** to have `isCritical == true` — no critical-red edge can touch a cyclic node, keeping the visual story consistent with the cycle-warning banner text.

**Self-loops** render as G6 `loop`-type edges, still subject to normal depType/critical styling.

#### Combo Aggregation
Each combo stores: `nodeCount`, `minTopoLayer`, `maxTopoLayer`, `hasCritical`, and, **computed over non-null member values only**:
* `maxBlastRadius`, `maxBuildCost`, `maxBottleneckScore`

If a combo has zero non-null members for a given metric (common under `targeted` reachability mode), that combo's aggregate is `null` — never `0`, since `0` would falsely claim "computed, and equal to zero."

`collapsedSize = max(minSize, log2(nodeCount + 1) * scalar)`, `minSize = [60, 40]`, `scalar = 20` (both configurable).

#### Style Pre-calculation
* Node fill: pastel variant of kind color, deterministically derived (same kind → same color across runs, for cross-run diagnosability).
* Node stroke: solid kind color; **critical nodes:** `stroke: '#ff4d4f'`, `lineWidth: 3` (shifts to `#00d9ff` in the viewer while heatmap is active — §5.9, a frontend-only style-state change, not part of the precomputed JSON).
* Critical edges: `stroke: '#ff4d4f'`, `lineWidth: 4`, `opacity: 1.0`, `endArrow: true` — always, regardless of LOD tier.
* Non-critical edges: `opacity: 0.4`, `endArrow: false` (suppressed further at LOD 0), stroke from `depTypeColorMap`.

### 3.4 Output JSON Contract

#### 3.4.1 Schema & Versioning
The full contract is defined by a versioned JSON Schema, `graph_data.schema.json`, which both tools validate against — Tool 1 refuses to write output that fails its own schema check (fail loud, at the source, rather than downstream in the viewer); Tool 2 refuses to render input that fails the same check. `metadata.schemaVersion` (e.g. `"5.5.0"`) is a required field; the viewer compares it against the schema version(s) it supports and shows a specific "produced by an incompatible extractor version" message on mismatch, rather than a generic parse error.

```json
{
  "metadata": {
    "schemaVersion": "5.5.0",
    "target": "target.bst",
    "totalNodes": 10523, "totalEdges": 28104,
    "globalCriticalPathLength": 42, "maxTopoLayer": 15,
    "maxConcurrencyWidth": 1200, "density": 0.0024,
    "maxBlastRadius": 2400, "maxBuildCost": 1500, "maxBottleneckScore": 0.92,
    "levelCounts": { "0": 150, "1": 320, "2": 1200 },
    "kindColorMap": { "build": "#1890ff", "import": "#52c41a", "compose": "#faad14", "script": "#722ed1" },
    "depTypeColorMap": { "build": "#1890ff", "runtime": "#52c41a", "both": "#722ed1" },
    "heatmapGradient": ["#fffbe6", "#fff1b8", "#ff7a45", "#cf1322"],
    "hasCycles": true, "layoutPrecomputed": true,
    "reachabilityMode": "targeted",
    "bottleneckMetric": "approximate", "bottleneckSamples": 500,
    "articulationSemantics": "undirected_projection",
    "graphSizeClass": "large",
    "performance": {}, "analysisModes": {}
  },
  "nodes": [{
    "id": "components/desktop/gtk.bst", "type": "rect", "combo": "components/desktop",
    "x": 1200.5, "y": -450.0,
    "data": {
      "label": "gtk.bst", "kind": "build", "sccId": 42,
      "inDegree": 12, "outDegree": 5, "topoLayer": 4,
      "cpDepth": 5, "cpHeight": 12,
      "blastRadius": 850, "buildCost": 42, "bottleneckScore": 0.84,
      "isCritical": false, "isArticulationPoint": false, "isCycle": false
    },
    "style": { "size": [140, 36], "fill": "#e6f7ff", "stroke": "#1890ff", "lineWidth": 1 }
  }],
  "edges": [{
    "id": "e_0", "type": "cubic-horizontal",
    "source": "components/desktop/gtk.bst", "target": "base/linux-headers.bst",
    "data": { "depType": "build", "isCritical": false },
    "style": { "stroke": "#1890ff", "endArrow": false, "opacity": 0.4, "lineWidth": 1 }
  }],
  "combos": [{
    "id": "components/desktop", "type": "rect", "combo": "components",
    "data": {
      "label": "desktop", "nodeCount": 45,
      "minTopoLayer": 2, "maxTopoLayer": 8,
      "maxBlastRadius": 850, "maxBuildCost": 320, "maxBottleneckScore": 0.71,
      "hasCritical": true
    },
    "style": { "fill": "#fafafa", "stroke": "#d9d9d9", "collapsedSize": [120, 60] }
  }, {
    "id": "@root", "type": "rect",
    "data": { "label": "root", "nodeCount": 10523, "minTopoLayer": 0, "maxTopoLayer": 15, "maxBlastRadius": 2400, "maxBuildCost": 1500, "maxBottleneckScore": 0.92, "hasCritical": true },
    "style": { "fill": "#ffffff", "stroke": "#e8e8e8", "collapsedSize": [240, 120] }
  }]
}
```
`graphSizeClass` ∈ `{normal, large, huge, extreme, ultra}`. Root combos omit `combo` field. Actual max values preserved (may legitimately be 0). Missing metrics are `null`, never `0`.

#### Performance Metadata
```json
"performance": {
  "parseMs": 0, "graphConstructionMs": 0, "sccMs": 0, "reachabilityMs": 0,
  "criticalPathMs": 0, "betweennessMs": 0, "articulationMs": 0, "layoutMs": 0,
  "serializationMs": 0, "totalMs": 0, "peakMemoryMb": 0,
  "maxReachabilityMemoryMb": 512, "targetedReachabilityK": 2000,
  "metricTimeoutSeconds": 60
},
"analysisModes": {
  "reachability": "exact|targeted|disabled_by_user|disabled_memory_budget|disabled_timeout",
  "betweenness": "approximate|exact|disabled|disabled_timeout",
  "articulation": "exact|approximate|disabled|disabled_timeout",
  "layout": "graphviz|none"
}
```
`totalMs` ≥ the largest single component-stage time (stages may run concurrently, so it is not required to equal the sum). Every field is present even for a skipped stage (value `0`, never a missing key).

### 3.5 Error Handling & Logging *(new)*

**Subprocess failure (`bst show`):**
| Condition | Log level | Behavior |
|---|---|---|
| `bst` binary not found | ERROR | Exit 1. Message names the missing binary and suggests checking PATH/installation. |
| Non-zero exit code | ERROR | Exit 1. Message includes the exit code and captured stderr tail. |
| Timeout (default: none unless graph construction itself times out per `--metric-timeout-seconds`) | ERROR | Exit 1. |
| Empty or unparseable stdout | ERROR | Exit 1. Distinguished from a legitimately empty graph (which `bst show` reports via a well-formed empty response, not empty/garbled stdout). |

**On any fatal error: no output file is written or partially written.** The extractor writes to a temp file in the output directory and performs an atomic rename to the final path only after (a) all requested analysis stages have completed or been explicitly downgraded/skipped, and (b) the resulting JSON validates against `graph_data.schema.json`. A crash, OOM, or Ctrl-C at any point before that rename leaves no file at the target path — never a truncated one.

**Metric degradation is never silent.** Every tier downgrade (exact→targeted, exact→approximate, enabled→disabled, anything→`disabled_timeout`) emits a WARNING to stderr with concrete numbers, e.g.:
```
WARNING [reachability] estimated closure 2.14GB exceeds --max-reachability-memory 512MB — falling back to targeted mode (k=2000)
WARNING [betweenness] node count 62,000 exceeds default threshold (50,000) — disabled. Use --expensive-metrics to force.
WARNING [articulation] stage exceeded --metric-timeout-seconds (60s) — disabled_timeout
```

**Missing optional dependency (`--precompute-layout` without graphviz/pygraphviz):** ERROR, exit 1, names the missing dependency. Never a silent fallback — a >20k-node graph without a precomputed layout hits the viewer's hard layout gate (§4.3) with zero context otherwise.

**Log format:** `LEVEL [stage] message`, one line per event. `-v` adds INFO-level stage-start/stage-complete lines with timing; `-q` suppresses everything except ERROR. Default verbosity is WARNING and above.

**Exit codes:** `0` success (possibly with warnings), `1` fatal error, `2` invalid CLI arguments/flag combination.

---

## 4. Component 2: G6 Visualizer

### 4.1 Fundamental Rendering Model
```
Complete Dataset → Visibility Resolver → Visible Graph → G6 Renderer
```
The renderer receives ONLY the visible subset. Elements not in the visible set are not instantiated in G6.

### 4.2 UI & UX Paradigm

* **File Loader** — Validates the file against `graph_data.schema.json` (§4.11) before touching any existing state. "Empty graph" state if `totalNodes == 0`. **Loading a new file:** the new file is fully validated first; only on success does the viewer perform a full reset (clear state, rebuild indexes, recompute modes, reset viewport) and load it — a bad second file leaves the current session untouched and shows an error toast. Files above 200MB trigger a size confirmation before parsing begins.
* **Cycle Warning Banner** — If `hasCycles`: *"⚠️ Cyclic dependencies detected. Critical path metrics exclude cyclic nodes and any edge touching them."* Dismissible.
* **Breadcrumb Trail** — `root > components > desktop > gtk.bst`. Clickable segments. **Clicking a segment** collapses all combos below that level and clears selection below that level; **active filters (search, metric sliders, build-stage slider) are untouched**. The resulting collapse depth is clamped by the same budget-walk used for adaptive initial depth (§4.5.1), so collapsing into a subtree containing a pathologically large combo can't itself blow the visible-element budget. Adjusts viewport to fit. Never triggers layout.

#### 4.2.1 Legend Panel
Persistent, toggleable panel reflecting only currently-active encodings: kind→color swatches, depType→color swatches (only while depType coloring is visible), a critical-path swatch, and — only while heatmap is on — the active gradient with its bound metric name, min/max, and a note if that metric is under `targeted` reachability mode.

* **Control Panel**
    * **Toggles:** Critical Path, Heatmap, Bottlenecks, Blast Radius, Cycles.
    * **Metric Sliders:** `blastRadius`, `buildCost`, `bottleneckScore`. RAF-throttled; disabled with a tooltip if the metric is fully unavailable (`disabled_by_user`/`disabled_memory_budget`/`disabled_timeout`); shows an explanatory note, but stays enabled, under `targeted` mode ("Computed for representative nodes only — critical path, articulation points, and highest-degree nodes; other nodes are excluded from this filter").
    * **Build Stage Slider:** Range `0` to `maxTopoLayer`. RAF-throttled.
    * **Combo Depth Slider:** 0–5. Initial value computed adaptively (§4.5.1). Debounced 150ms.
    * **Neighborhood Depth:** 1-hop, 2-hop, 3-hop. Default: 1-hop.
    * **"Reset All"** — Clears all state, restores defaults, resets viewport. Does NOT rebuild indexes or rerun layout.
* **Search Box & Sidebar** — 300ms debounce, substring match via trigram index. >10 results → sidebar. Max 50 rendered; full count always shown.
* **Analytics Panel** — Histogram, max width, critical path length, density, totals, cycle count, `datasetMode`, `renderMode`, `reachabilityMode`, performance timings.
* **Filter Indicator** — *"Filtered: N nodes hidden"* / *"Edges simplified: N of M shown"* + "Show all". Never silent.
* **Minimap** — Adaptive, §5.5.
* **Node Tooltip** — Label, kind, depth, CP depth/height, blast radius, build cost, bottleneck %. `null` fields render an explicit reason ("Not available — reachability disabled for this graph" / "Not computed — outside the representative node set"), never a blank or literal `null`. Approximate metrics carry an inline "≈ approximate" tag.
* **Diagnostics Panel** — FPS, visible/culled counts, last render time, current LOD, `datasetMode`/`renderMode`, nodes with fallback (missing) coordinates, and a **"Copy Diagnostic Report"** action (§4.11) exporting mode state, active filters, FPS history, the last N log-buffer entries, and browser/G6 version as one copyable block.

### 4.3 G6 v5 Integration

#### Layout Gate
* `layoutPrecomputed == true`: bypass Dagre. Any node missing `x`/`y` gets a deterministic grid fallback position, flagged in the diagnostics panel; does not block load.
* `layoutPrecomputed == false`, `totalNodes ≤ 20,000`: run Dagre (`rankdir: 'LR'`), warning above 5,000 nodes.
* `layoutPrecomputed == false`, `totalNodes > 20,000`: **Dagre forbidden.** Blocking notice: *"This graph requires `--precompute-layout`; automatic layout is disabled above 20,000 nodes for performance."* A grid/circular fallback is offered only as explicit opt-in, clearly labeled as topologically meaningless.

* **Combo Default:** auto-collapsed to the adaptively-computed initial depth (§4.5.1).
* **HTML Combo Labels:** DOM-rendered, macro-level only. Format: `{label} ({nodeCount})`, red dot if `hasCritical`.
* **On-Load Index Building (O(V+E)):**
    * `nodeToNeighbors: Map<nodeId, Set<nodeId>>` — undirected.
    * `nodeToEdges: Map<nodeId, Set<edgeId>>`.
    * `comboChildren`, `comboParent`, `comboDepthMap`.
    * `comboBounds: Map<comboId, {x0,y0,x1,y1}>` — bounding box from child coordinates. **If `layoutPrecomputed == true`**: computed at index-build time (positions already exist). **If `layoutPrecomputed == false`**: computed immediately after Dagre completes, before first render — positions don't exist until layout finishes, so index-build-time computation would operate on undefined coordinates.
    * `comboSpatialIndex: Quadtree<comboId, bounds>` — built from `comboBounds`, so it has the **same post-layout timing dependency** as `comboBounds` itself. Building it before `comboBounds` exists (in the non-precomputed-layout case) would index stale/undefined data.
    * `searchIndex` — trigram index over normalized labels, for substring search; falls back to a ≤50ms time-boxed linear scan below 20k nodes.
    * `spatialIndex: Quadtree<nodeId, x, y>` — O(log n) leaf-node viewport queries.
    * `sortedMetricArrays: { blastRadius: Uint32Array, buildCost: Uint32Array, bottleneckScore: Float32Array }` — node indices presorted per metric for O(log V) slider threshold queries. **Nodes with `null` for a metric are placed at the end of that metric's array and are always excluded when that metric's slider is active** — a `null` can never satisfy a numeric threshold.

### 4.4 Visible-Set Resolution

The visible set is the intersection of: Hierarchy (combo depth) ∩ Search ∩ Metric/Stage Filters ∩ LOD ∩ Focus ∩ Neighborhood ∩ Viewport.

#### 4.4.1 Resolver Algorithm
Each filter dimension maintains its own `Uint8Array` visibility mask, one byte per node, indexed by a stable node-index assigned at load. When one dimension changes, only that mask is recomputed — a single O(V) pass, or O(log V) for numeric metric sliders via `sortedMetricArrays` (two binary searches for a range). The final visible mask is the bitwise AND of all per-dimension masks, computed once per RAF tick — never once per filter dimension per tick. This bounds per-frame resolver cost to one O(V) pass regardless of how many filter dimensions are simultaneously active.

**Context Preservation:** filtering never discards coordinates. Restoring a filter restores the same positions; no layout triggered; viewport unchanged.

### 4.5 Combo-Level Edge Aggregation
Collapsed-combo pairs get one aggregated visual edge: stroke width ∝ `log2(edgeCount + 1)`, label showing count (e.g. "×47"), color = dominant `depType`. If ≥1 underlying edge is critical, the aggregate shows critical styling plus a sub-label ("3/47 critical") rather than implying uniform criticality.

#### 4.5.1 Adaptive Initial Combo Depth
Computed at load time: starting from depth 0, walk deeper while the estimated visible-node sum (via precomputed `comboChildren` counts) stays under the current `datasetMode`'s node budget (§5.1). Stop at the deepest level that fits; fall back to depth 0 (single root aggregate) if even depth 1 overflows. The same walk is reused whenever breadcrumb navigation would otherwise collapse into a subtree that overflows budget (§4.2).

### 4.6 Combo Expansion
* **< `animatedExpansionThreshold` (2000) elements:** animate 200ms.
* **≥ 2000:** instant snap, no animation.
* **> `maxExpansionElements` (10000):** confirmation dialog — *"Expand 14,382 nodes? This may reduce rendering performance."* Options: Expand / Expand + focus / Show critical path only / Cancel.
* **"Show critical path only"** filters the visible set to `isCritical == true` nodes (and their critical edges) within the combo's subtree; the rest remain collapsed, filter indicator fires. **If the subtree contains zero critical nodes, this option is disabled (greyed out) with tooltip "No critical path nodes in this subsystem."**

### 4.7 Search Architecture
Index built once at load. Case-insensitive substring match via trigram intersection (≤50ms time-boxed linear-scan fallback below 20k nodes). Selecting a result: expand minimum ancestor combos → materialize target → focus → highlight → optionally show neighborhood. Ancestor expansion halts and flags the filter indicator if it would exceed the visible-element budget, rather than expanding the full hierarchy regardless of cost.

### 4.8 Hover vs Selection

#### Hover (Transient, Cheap)
50ms dwell. Disabled below LOD 0 zoom, during rapid movement, during slider drag. Max 200 nodes, taken directly from `nodeToNeighbors` in insertion order — **no priority sort on this path**, so a hub node with thousands of neighbors doesn't turn a "cheap" hover into a sort. Cached; cancels previous target on new hover. No graph-wide state update.

#### Selection (Persistent, Analytical)
Click to select; bounded neighborhood. Budget: `maxNeighborhoodNodes = 500`, `maxNeighborhoodEdges = 1500`. Truncation priority (applied across the whole multi-hop candidate set, not hop-by-hop): (1) critical status, (2) bottleneck score, (3) blast radius, (4) node ID. Edges to any non-materialized neighbor are dropped, never rendered as dangling lines. *"Neighborhood truncated: 500 of 3,821 nodes shown."* Persists until deselected/replaced.

### 4.9 State Management
Native `hover-activate` disabled. Central resolver, dirty-set updates only. Priority: `search-match` > `selected` > `active` > `inactive` > `default`.
* **Node states:** `default` · `active` (`opacity:1.0, stroke:'#fa8c16', lineWidth:3`) · `selected` (`opacity:1.0, stroke:'#1890ff', lineWidth:4, shadowBlur:8`) · `inactive` (`opacity:0.1, stroke:'#ccc', fill:'#f5f5f5'`) · `search-match` (`stroke:'#fadb14', lineWidth:4, opacity:1.0`).
* **Edge states:** `default` · `active` (`opacity:1.0, stroke:'#fa8c16', lineWidth:2`) · `inactive` (`opacity:0.05, stroke:'#eee', lineWidth:1`) · `search-match` (`stroke:'#fadb14', lineWidth:3, opacity:1.0`).

### 4.10 Rendering Rules
1. Batch updates — one `draw()` per cycle. 2. Never trigger layout for filtering/sliders. 3. Canvas for graph elements; DOM only for UI/tooltips/macro labels. 4. LOD reduces labels/effects, never topology. 5. Coalesce continuous updates. 6. Dirty-set updates only. 7. Never animate graph-wide transitions when `renderMode` is `large` or more restrictive. 8. Per-node DOM labels forbidden.

### 4.11 Error Handling & Diagnostics *(new)*

**Schema validation is mandatory and fail-closed.** On file load, the JSON is validated against `graph_data.schema.json` — the same schema Tool 1 validates its own output against — before any rendering attempt. Validation failure produces a field-level, human-readable error list (e.g. "node[412].data.blastRadius: expected number|null, got string"), not a generic "invalid file" toast. The viewer never attempts to render partially-valid data — a `null` slipping unchecked into a `shadowBlur` or coordinate calculation is a worse failure than a clear pre-render rejection.

**`schemaVersion` mismatch** produces a specific message ("This file was produced by an incompatible extractor version — expected schema 5.x, got 4.2") rather than falling through to a generic parse error.

**Render-cycle error boundary.** The render cycle is wrapped; an uncaught exception mid-frame (malformed style value, G6 internal error) is caught, logged to console and the diagnostics ring buffer, and the viewer drops into **safe mode**: animation, viewport culling, and spatial-index-driven features disabled, falling back to a static full redraw — rather than a blank or frozen canvas.

**Large-file handling.** Files above 200MB trigger a confirmation before parsing, so a slow parse (or a near-OOM tab) doesn't present as an unexplained freeze.

**Client-side structured logging.** A ring-buffer logger (level/module/message/context, capped size) records every non-happy-path event — validation failures, truncations, degraded metrics surfaced from `analysisModes`, caught render exceptions, adaptive-quality degrade/recover events. Exposed via "Copy Diagnostic Report" (§4.2) as a single copyable block for bug reports: current mode state, active filters, FPS history, last N log lines, browser/G6 version.

---

## 5. Visual Encoding & LOD

### 5.1 Performance Modes & Budgets

| `renderMode` | Visible Node Budget | Visible Edge Budget |
|---|---|---|
| `normal` | Unlimited | Unlimited |
| `large` | 15,000 | 30,000 |
| `huge` | 10,000 | 20,000 |
| `extreme` | 5,000 | 15,000 |
| `ultra` | 3,000 | 10,000 |

Evaluated against the current visible set (§2.2), not static dataset totals.

### 5.2 Semantic Zoom (LOD) — Threshold-Batched
* **LOD 0 (zoom < 0.3):** no node labels except active/search-match; root combo labels only; non-critical edges `lineWidth: 1`, lose arrowheads, use a simplified source→target gradient for direction. **Critical edges are exempt from all LOD-0 simplification** — full color/width/arrowhead at every zoom level. Hover disabled. Combo-level edge aggregation active.
* **LOD 1 (0.3–0.8):** combo labels + critical/bottleneck/selected labels; reduced node detail.
* **LOD 2 (> 0.8):** all labels. Above 20k visible nodes, threshold raised to 1.2. Above 50k visible nodes, `maxCanvasLabels = 2000`, priority: selected > search > critical > bottleneck > blastRadius > viewport proximity.

#### 5.2.1 Runtime Adaptive Quality
If measured FPS stays below the current `renderMode`'s target (§5.6) for >30 consecutive frames, the viewer auto-drops one LOD/budget tier and shows a dismissible toast. **Recovery requires 3 seconds of sustained above-target FPS AND at least one interaction event (pan, zoom, hover, slider) during that window** — idle FPS is naturally high and is not a valid recovery signal on its own; without the interaction requirement, a session could flap between quality tiers on every subsequent interaction.

### 5.3 Visual Channels & Encoding

| Channel | Metric | Property | Notes |
|---|---|---|---|
| Size | Label length (fixed) | `style.size` | Never dynamic |
| Fill | Kind / Heatmap | `style.fill` | Heatmap overrides when ON, including on collapsed combos — uses the combo's precomputed aggregate for the *active* metric (`maxBlastRadius`, `maxBuildCost`, or `maxBottleneckScore`; `null` if the combo has no non-null members for that metric) |
| Stroke | Critical > Bottleneck > Kind | `stroke`, `lineWidth` | Critical wins; shifts to `#00d9ff` while heatmap is active (§5.9) |
| Halo/Badge | Blast Radius | `shadowBlur` OR badge | Mode-dependent |
| Opacity | Filtering | `style.opacity` | Universal |
| Label | Identity | Canvas text | LOD-dependent |
| Position | Topology | `x`, `y` | Never changes |

**Safe normalization:** `normalize(value, maxVal) = maxVal > 0 ? value / maxVal : 0`.

**Blast Radius Encoding:** ≤5k visible nodes: `shadowBlur = normalize(blastRadius, maxBlastRadius) * 40`, capped 40px. >5k visible nodes: canvas badge, bottom-right, radius `log2(blastRadius+1)`, color `#fa8c16`, max 1000 simultaneous (highest-ranked). Fully disabled reachability → toggle/slider disabled with tooltip. `targeted` mode → toggle stays enabled; nodes outside the targeted set show no badge, tooltip explains why.

### 5.4 Edge Rendering
Non-critical: `depTypeColorMap` color, no arrowhead at LOD 0, `opacity: 0.4`. Critical: `#ff4d4f`, `lineWidth: 4`, arrowhead, `opacity: 1.0` at every LOD. Past `maxDetailedEdges` (20,000) visible edges, non-critical edges are thinned to budget via stable-seeded random sampling (consistent per visible-set version — doesn't flicker frame to frame); critical edges are never thinned. Filter indicator fires ("Edges simplified: N of M shown").

### 5.5 Adaptive Minimap

| Graph (dataset size) | Behavior |
|---|---|
| ≤10k | Combo/bounding-box delegate (G6's simplified-geometry minimap mode) |
| 10k–50k | Combo-level only |
| >50k | Disabled by default; manually enableable |

Keyed to dataset size (whole-graph orientation should reflect full structure even under a filtered main view). Never renders individual edges above 10k dataset nodes. Shows a viewport-position rectangle at all times.

### 5.6 Viewport Culling (Extreme/Ultra `renderMode`)
Uses `spatialIndex` (leaf nodes) and `comboSpatialIndex` (collapsed combos — the dominant case at this scale) for O(log n) viewport queries. Viewport + 25% margin; materialize intersecting elements, remove distant ones. Coordinates stay in memory; topology never changes. Throttled to animation frames; never triggers layout.

| Graph | Target FPS |
|---|---|
| `normal` | 60 |
| `large` | 30–60 |
| `huge` | ~30 |
| `extreme` / `ultra` | ~15–30 |

### 5.7 Slider Processing
```
input → latest-value buffer → RAF → resolver (§4.4.1) → renderer
```
Intermediate values discarded; no queued backlog.

### 5.8 Build Stage Time-Travel
Collapsed combo: `combo.minTopoLayer > sliderValue` → inactive (a partially-in-progress combo, `minTopoLayer ≤ slider ≤ maxTopoLayer`, is intentionally shown fully active — a documented simplification of collapsed granularity). Expanded node: `node.topoLayer > sliderValue` → inactive. Only changed visible elements updated; never invokes layout.

### 5.9 Heatmap / Critical Color Conflict
Heatmap's hot end (`#cf1322`) and critical stroke (`#ff4d4f`) share a hue family, weakening pop-out. While heatmap is active, critical stroke shifts to `#00d9ff` (reverts when heatmap is off).

### 5.10 Performance Safety Limits
```
maxHoverNodes = 200
maxNeighborhoodNodes = 500
maxNeighborhoodEdges = 1500
maxAnimatedElements = 2000
maxExpansionElements = 10000
maxBadgeElements = 1000
maxCanvasLabels = 2000
maxDetailedEdges = 20000
maxMinimapElements = 5000
targetedReachabilityK = 2000
viewportCullMarginPct = 25
adaptiveQualityStabilityWindowMs = 3000
metricTimeoutSeconds = 60
maxFileSizeSoftWarningMb = 200
diagnosticRingBufferSize = 500
```

---

## 6. UX Principles for Big-Graph Comprehension
1. Structure before detail. 2. Hierarchy before individual nodes. 3. Local context before global noise. 4. Selection before hover for deep analysis. 5. Stable coordinates preserve the mental map. 6. Progressive disclosure controls density. 7. Critical information gets rendering priority and stays visually distinct under other active encodings (§5.9). 8. Search navigates, not merely highlights. 9. Large neighborhoods are bounded consistently across hops. 10. Large combos don't accidentally materialize. 11. Filtering is explicit and reversible, including edge simplification, not just node hiding. 12. Viewport determines what's rendered. 13. Animation is decoration, never a requirement. 14. Performance degradation is graceful, explained, and has a concrete runtime mechanism (§5.2.1). 15. A legend is not optional once color carries meaning. 16. **Failure is explained, not silent** — every degraded metric, truncated set, dropped edge, or caught error is visible somewhere (tooltip, filter indicator, log, or diagnostic report), never just applied quietly.

**Primary Interaction Model:**
```
Overview → Identify subsystem → Expand combo → Find node → Inspect neighborhood → Read metrics → Return to overview
```

---

## 7. Correctness Requirements
Empty graphs, single-node, disconnected, isolated nodes, self-loops, fully/partially cyclic, SCCs, duplicate edges, nested combos, combos with cycles, nodes without combos, high-degree nodes, zero maxima, unavailable metrics (`null`), targeted-vs-exact-vs-disabled reachability, combo aggregates with all-null members, missing/partial layout, comboBounds/comboSpatialIndex timing under non-precomputed layout, malformed JSON (schema-rejected with field-level errors), schemaVersion mismatch, 50k/100k nodes, high edge density, huge combos, huge search results, filtered-huge-graph-to-tiny-visible-set (renderMode relaxation), critical edges at every LOD tier, heatmap+critical color overlap, breadcrumb collapse budget clamping, "show critical path only" on a subtree with zero critical nodes, multi-file load with a failing second file, `bst show` subprocess failure in each mode (missing binary/non-zero exit/malformed output), metric-stage timeout, crash-during-serialization (no partial output file). No NaN/Infinity. `0` = calculated zero. `null` = unavailable.

## 8. Performance Acceptance Criteria
**10k/30k:** Load without freeze. Interactive pan/zoom. Responsive sliders (bounded per-frame resolver cost). Hover <50ms, unsorted. No layout during interaction.
**50k/150k:** `extreme` mode. Hierarchical initial view sized to budget. No animation. No DOM per-node labels. Bounded hover/neighborhood. LOD active, critical edges exempt from LOD-0 simplification. Within budget; adaptive quality engages if FPS target missed for 30+ frames and recovers only during active interaction.
**100k/300k:** `ultra` mode. Full graph NOT materialized. Initial view responsive. Search locates via trigram index without full ancestor expansion. Selection shows bounded, edge-consistent neighborhood. Critical path explorable even when most nodes are `null` for reachability (targeted mode covers critical/articulation/high-degree nodes). Filtering down to a small visible set relaxes `renderMode` back toward full detail. Degrades gracefully, never freezes.
**Failure modes (all sizes):** malformed extractor output is rejected by the viewer with a field-level error, never partially rendered. A killed extraction process never leaves a corrupt output file. A forced render-cycle exception drops into safe mode, never a blank/frozen tab.