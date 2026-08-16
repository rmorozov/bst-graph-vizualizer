# Design directions — from graph viewer to build efficiency tool

Companion to [`audit_2026-08.md`](audit_2026-08.md) (what is wrong) and
[`scenarios.md`](scenarios.md) (the backlog). This document is the *target
shape*: what the tool should be, so that the two usage scenarios — a local
optimization helper and a CI efficiency gate — fall out of one data model
rather than two products.

---

## 0. The one-sentence change

> Stop modelling **a dependency graph**. Start modelling **a build**: the same
> graph, with cost, cache behaviour, and a scheduler attached — and make every
> answer a *counterfactual*, not a *statistic*.

Everything below follows from that. The audit's headline result is the proof
it is necessary: two one-edge fixes to the example project, both shortening the
edge-counted critical path by exactly 1, are worth **1.1 s** and **60.0 s**
respectively. No metric in the current model can tell them apart; every metric
in the model below can.

---

## 1. The core model

### 1.1 Cost, with provenance

Every node carries a duration and a statement of where that number came from:

```json
"cost": {
  "durationMs": 120000,
  "provenance": "measured",         // measured | modelled | assumed | unknown
  "samples": 7, "p50Ms": 120000, "p90Ms": 138000,
  "source": "bst-build-log:2026-08-14",
  "cacheHitRate": 0.94,
  "expectedMs": 7200                // durationMs * (1 - cacheHitRate)
}
```

Non-negotiable rules, extending the spec's existing "Data Honesty" principle
(§1.8) from metrics to cost:

* `unknown` is never silently coerced to `0`. A node with unknown cost
  poisons every aggregate that includes it, and the aggregate must say so.
* `assumed` values are never used as the basis of a CI failure without the
  report saying which nodes were assumed and what fraction of the total they
  represent.
* A cost model is an artifact with an identity and a timestamp, not a
  side-effect of a run. It is versioned, committed or cached, and reusable —
  see §4.3, where holding it constant is what makes the CI gate deterministic.

### 1.2 Cache-expected cost is the real cost

For BuildStream specifically, this is not a refinement — it is most of the
answer. An element whose cache key is unchanged is fetched, not built.

`expectedMs = durationMs × P(cache miss)`, with `P(miss)` estimated from
observed history per element.

In the example project `base/toolchain.bst` is the most expensive element
(180 s), the graph's only articulation point, and the highest-degree hub — it
would rank first on every metric the current spec has. It also changes about
twice a year, so its expected contribution to a given CI run is ≈ 0.
Meanwhile `src/corelib.bst` costs 2.1 s and rebuilds on every commit.
**Any tool that ranks by build cost instead of expected cost gives exactly the
wrong answer here**, and confidently.

Two rankings must be available and clearly distinguished:

| Ranking | Question it answers | Audience |
| --- | --- | --- |
| by `durationMs` | "why is a cold/clean build slow?" | release engineering, new-machine setup |
| by `expectedMs` | "why is my day slow?" / "why is CI slow?" | everyone, most of the time |

### 1.3 A scheduler, not a longest path

Replace "critical path length (edges)" with a small simulation over
`(graph, costs, jobs)`:

```
totalWork   W    = Σ expectedMs
makespan∞   M∞   = time-weighted critical path
makespan(j) M(j) = list-schedule simulation at the real job count
parallelism P    = W / M∞           (ideal speedup ceiling)
slack(v)         = latestStart(v) - earliestStart(v)
```

`slack` is the correct prioritizer for optimization work and does not exist in
the current model. Zero-slack nodes are the only ones where making the element
faster shortens the build; everything else needs a *structural* change.

On the example: `W = 501.6 s`, `M∞ = 400.5 s`, `P = 1.25`, and
`M(4) = M(∞) = 400.5 s` — the build is latency-bound, so buying CI workers
buys nothing. That is a first-class answer and the current tool cannot reach it.

### 1.4 Recursion — a build graph is a build graph

Macro and micro are the same object at two zoom levels:

```
BuildStream elements ──┐
                       ├── nodes with cost, edges with a reason, one scheduler
native build targets ──┘   (ninja/make/cmake targets, TUs, headers)
```

The same makespan/slack/counterfactual math applies to `bst` elements and to
ninja targets. Build it once, generically, over an interface (`load_graph`,
`load_costs`) with a BuildStream adapter and a Ninja adapter behind it. The
payoff is that drill-down is free, and the "which level does this cost live at"
question — the one the audit's §4.4 shows the tool gets wrong today — becomes
answerable by construction.

The micro level is where the example's real daily cost sits: `src/corelib.bst`
looks like a 2 s element at the macro level, while inside it one header is
included by 12 of 13 TUs, costing ≈ 400 ms each — ≈ 4.8 s of the build's 16.7 s
of CPU work, and a 1796 ms vs 616 ms incremental rebuild.

### 1.5 Edges carry a reason

An edge is not just a pair. To claim an edge is removable, the tool needs to
know why it exists:

```json
{"source": "src/mathlib.bst", "target": "src/netlib.bst",
 "depType": "build",
 "evidence": {"kind": "declared-only", "symbolsUsed": 0, "headersUsed": 0}}
```

`declared-only` (declared in the `.bst`, no symbol or header from it actually
used) is precisely the false-dependency signature planted twice in the example
project, and it is derivable — from `ninja -t deps` for headers, and from
`nm`/linker map analysis for symbols. This is what upgrades "here is a long
chain" into "here is an edge you can delete, worth 60 s."

---

## 2. Counterfactuals are the product

Statistics describe; counterfactuals instruct. The primary output is a ranked
worklist where every row is a *proposed change with a predicted saving*:

| Operation | Predicted effect | Derived from |
| --- | --- | --- |
| cut edge `u→v` | Δmakespan, Δblast-radius | re-run scheduler on `G − e` |
| split element `v` | Δ rebuild fan-out per touch | recompute reachability |
| make `v` cacheable / stabilise its key | Δ expected CI time | recompute expected cost |
| add worker | Δ`M(j)` → Δ`M(j+1)` | re-run scheduler |
| move work off the critical chain | Δmakespan | scheduler + slack |
| drop a `#include` / split a header | Δ incremental rebuild cost | micro-level graph |

Ranked by predicted saving, filtered by confidence (§1.1 provenance), and
capped — a worklist of 20 actionable items, not a canvas of 100k nodes.

Worked example, which is the entire argument for this design:

```
baseline                              M∞ = 400.5 s   CP(edges) = 10
cut src/mathlib.bst → src/netlib.bst  M∞ = 399.4 s   CP(edges) =  9   saving  1.1 s
cut base/cmake.bst → deps/openssl.bst M∞ = 340.5 s   CP(edges) =  9   saving 60.0 s
```

Both are `declared-only` edges. Both shorten the edge path identically. Only
the counterfactual separates them, and it puts the right one first.

---

## 3. Scenario A — the local optimization helper

**User:** an engineer who thinks the build is too slow and has an afternoon.
**Job to be done:** *tell me the three things to change, in order, and how much
each is worth.*

### 3.1 Shape: CLI-first, viewer second

The picture is not the deliverable — the worklist is. Today's spec inverts
this, spending most of its complexity budget on rendering scale.

```bash
# 1. collect — from a real build, or replay a saved dump (no `bst` required)
bstopt profile app/stack.bst --jobs 4 --runs 3 -o profile.json
bstopt profile --from-dump bst-show.txt --ninja-log build/.ninja_log -o profile.json

# 2. report — the ranked worklist, straight to the terminal
bstopt report profile.json
#   M∞ 400.5s  W 501.6s  parallelism 1.25x  (latency-bound: M(4) == M(∞))
#   1. cut base/cmake.bst → deps/openssl.bst   -60.0s  [declared-only, high confidence]
#   2. split base/sdk.bst (6 consumers, each uses 1 member)   -5.4s, -4 rebuilds/touch
#   3. corelib/core_all.hpp: 12 of 13 TUs, ~400ms each        -4.8s CPU, -1.2s incremental

# 3. explore a hypothesis before doing the work
bstopt whatif profile.json --cut base/cmake.bst→deps/openssl.bst --jobs 4

# 4. drill from an element into its native build, same metrics
bstopt drill profile.json src/corelib.bst

# 5. look at it, when the numbers are ambiguous
bstopt view profile.json
```

### 3.2 What the viewer becomes

Keep the existing spec's genuinely good parts — progressive disclosure, stable
geometry, honest `null` handling, the filter indicator, the legend contract.
Re-point the visual channels at the new model:

| Channel | Today | Should encode |
| --- | --- | --- |
| node size | fixed (label length) | `expectedMs` — cost is the thing you are hunting |
| node fill | kind | slack (zero-slack = hot) |
| node stroke | critical (edge-counted) | on the time-critical chain |
| edge highlight | depType | Δmakespan if cut — the actionable channel |
| combo aggregate | max of member metric | Σ cost, and Σ recoverable cost |

Two views matter more than scale: the **critical chain** (a path, ~10–40 nodes)
and the **blast radius of one element** (a subgraph). Both are small. The
100k-node performance envelope in §2/§5 of the current spec can be deferred
until a real graph demands it; nothing in this scenario does.

### 3.3 Requirements this scenario adds

* **Offline replay** — must work from saved dumps with no `bst`, no network,
  no daemon. Also the only way to test the tool (`GAP-07`).
* **Fast loop** — `whatif` must be sub-second on a mid-size graph, because it
  is used interactively.
* **Honest confidence** — "estimated saving 60 s (cost model: 4 of 15 elements
  assumed)" beats a confident wrong number.
* **Drill-down continuity** — the same commands and the same metrics at the
  element level and inside it.

---

## 4. Scenario B — the CI efficiency gate

**User:** the owner of a build that many people commit to.
**Job to be done:** *let the build grow, but do not let it grow badly.*

This is the harder and more valuable scenario, and it needs three separable
functions: gather, highlight, gate.

### 4.1 Gather — the baseline artifact

Every build on the main branch publishes a `profile.json`: graph, cost model
(with provenance), cache hit rates, scheduler results, ratios. Retained as a
time series. That artifact *is* the analytics product — trends, per-element
cost history, cache-hit-rate drift, the parallelism curve over time. It is also
the input to Scenario A: an engineer pulls the latest CI baseline instead of
profiling locally.

### 4.2 Highlight — a standing worklist, not just a verdict

The same ranked counterfactual worklist from §2, published per run: "the build
currently leaves 84 s of removable serialisation on the table, here are the
five edges." Non-blocking, always visible. This is the "room for optimization"
in the task framing, quantified: `recoverableMs = Σ` predicted saving of
independently-safe operations.

### 4.3 Gate — the inefficiency-ratio design

The requirement, precisely: *absolute build time is allowed to grow; adding
elements is normal. Adding them in an unoptimized way is not. The owner sets
what level of inefficiency is normal, and a big regression against that must be
spotted and stopped.*

So the gate must be **normalized** (immune to legitimate growth) and
**attributable** (points at the change that did it).

**Step 1 — freeze the cost model.** Compare the PR graph against the baseline
graph using **the baseline's cost model**, reusing each unchanged element's
historical duration keyed by cache key. Structure varies, cost is held
constant. This makes the gate deterministic and immune to CI timing noise,
which is the failure mode that kills most build-time gates. Only elements whose
content actually changed need fresh measurement.

**Step 2 — the marginal efficiency ratio.** For a PR that adds `ΔW` of work and
`ΔM∞` of makespan:

```
ρ = ΔW / ΔM∞          marginal parallelism of the added work
```

* `ρ ≈ 1` → the new work was added as a serial chain. Worst case.
* `ρ ≥ P_baseline` → the new work is at least as parallel as the build already
  is. Fine, regardless of how much time it added.
* `ρ < θ × P_baseline` → **fail**, where `θ` is the owner's tolerance.

This is the exact formalisation of the requirement. A PR that adds 200 s of
genuinely parallel work passes; a PR that adds 30 s bolted onto the end of the
critical chain fails. Absolute time never enters the decision.

**Step 3 — structural ratios, tracked and bounded.** Absolute values are
policy, deltas are the gate:

| Ratio | Definition | Fails when |
| --- | --- | --- |
| parallelism `P` | `W / M∞` | drops > x% vs baseline |
| parallel efficiency `E(j)` | `W / (j·M(j))` | drops > x% at the CI job count |
| critical concentration | share of `M∞` in zero-slack nodes | rises > x% |
| blast-radius index | mean rebuild fan-out over frequently-touched elements | rises > x% |
| recoverable share | `recoverableMs / M∞` | rises above the owner's normal band |

The last one is the direct expression of *"some level of inefficiency the owner
considers normal"* — a build running at 20% recoverable is the accepted status
quo; a PR pushing it to 35% is the regression to stop.

**Step 4 — per-change attribution.** A ratio failing is not a useful message.
For every edge and element the PR adds, compute its own counterfactual and name
the culprit:

```
FAIL  marginal efficiency ρ = 0.31 (baseline parallelism 1.25, threshold 0.62)

  This PR adds 62s of work and 48s of makespan; 44s of that is one chain:
    src/newthing.bst → src/netlib.bst → src/app.bst

  Largest single contributor:
    new edge src/newthing.bst → src/netlib.bst   +44.0s makespan
    evidence: declared-only (0 symbols, 0 headers used from src/netlib.bst)
    if removed: makespan 448.5s → 404.5s

  Not a blocker, but new: base/sdk.bst now has 7 consumers (+1)
```

**Step 5 — escape hatches, because a gate that cannot be overridden gets
deleted.** A policy file the owner owns:

```yaml
# .build-budget.yml
jobs: 8
thresholds:
  marginal_efficiency_ratio: 0.5     # fraction of baseline parallelism
  parallelism_drop_pct: 10
  recoverable_share_max: 0.25
unknown_cost_policy: fail            # fail | warn — never silently zero
allow:
  - reason: "vendored toolchain bump, one-off"
    expires: 2026-09-01
    element: base/toolchain.bst
```

Plus: warn-only mode for the first N weeks (a new gate must earn trust before
it blocks), and an explicit `unknown_cost_policy` so a gate can never fire — or
pass — on nodes whose cost was assumed.

### 4.4 What CI does *not* need

No canvas, no G6, no LOD, no 60fps. The CI surface is a JSON artifact, an exit
code, and a PR comment. Any rendering effort spent before those exist is spent
on the wrong scenario.

---

## 5. Consequences for the existing specification

**Keep:** the honesty principles (§1.8, §1.9, §3.5's "degradation is never
silent"), the schema-as-contract discipline, progressive disclosure, stable
geometry, the filter indicator.

**Change:**

| Spec area | Change |
| --- | --- |
| §3.4 schema | add `cost` (+provenance), `cacheHitRate`, edge `evidence`, `baselineId`, `costModelId`; fix edge direction (audit §3.4) |
| §3.3 metrics | add scheduler-derived `slack`, `makespan`, `parallelism`; keep betweenness/articulation but demote them to secondary heuristics — they are not cost |
| §3.2 inputs | real `bst show --format` contract, **plus** offline replay, **plus** ninja/cmake adapters |
| §1 architecture | a third component: the analysis/counterfactual engine, headless, shared by CLI + CI + viewer |
| §2, §5 | defer the 100k-node performance envelope; it serves neither scenario today |

**Drop, or park:** the ultra/extreme render modes, adaptive quality, viewport
culling — until a real project produces a graph that needs them. They are the
most complex part of the current spec and the least connected to either job.

---

## 6. Staging

Each stage is independently useful; nothing here needs the stage after it.

| Stage | Delivers | Backlog |
| --- | --- | --- |
| **0. Make it true** | real `bst` contract, metrics actually serialized, offline replay, a test suite | `GAP-*`, `R0`–`R12` |
| **1. Make it about time** | cost model + provenance, scheduler, slack, `report` command | `OPT-01`…`OPT-05` |
| **2. Make it actionable** | counterfactual engine, edge evidence, ranked worklist | `OPT-06`…`OPT-09` |
| **3. Make it deep** | ninja/cmake adapters, header analysis, drill-down | `OPT-10`…`OPT-14` |
| **4. Make it a gate** | baseline artifact, ratios, marginal-efficiency gate, PR comment | `CI-01`…`CI-08` |
| **5. Make it a picture** | viewer re-pointed at cost/slack, drill-down UI | `UX-*`, `R13`–`R25` |

Stage 1 alone — cost and a scheduler, output as plain text — would already be
more useful for optimizing a build than the entire current specification
delivered perfectly.
