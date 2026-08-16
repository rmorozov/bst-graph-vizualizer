# bst-graph-vizualizer

Tooling for extracting, analysing and visualising [BuildStream][bst] dependency
graphs, with the goal of making build inefficiency visible and fixable.

[bst]: https://buildstream.build/

## Status — read this first

**Not yet usable.** The extractor runs but does not produce correct output, and
the viewer does not exist as a loadable artifact. Concretely, as of 2026-08:

* the extractor parses a text format that `bst show` does not emit, so a real
  15-element project extracts as a 1-node graph — and exits `0`;
* per-node metrics are computed and then discarded before serialization, so
  every node reports zeros and nulls;
* there is no `bst_graph_viewer.html`, no bundler, and the JavaScript modules
  do not parse;
* there are no tests and no dependency manifest.

Details, with reproduction commands, in [`docs/audit_2026-08.md`](docs/audit_2026-08.md)
and [`docs/conformance_review.md`](docs/conformance_review.md).

## Documentation

| Document | What it covers |
| --- | --- |
| [`docs/specification.md`](docs/specification.md) | the intended system (v5.5.0) — extractor contract, schema, viewer behaviour |
| [`docs/implementation_plan.md`](docs/implementation_plan.md) | phased task breakdown behind that spec |
| [`docs/conformance_review.md`](docs/conformance_review.md) | implementation vs specification, defect by defect, with remediation tasks `R0`–`R25` |
| [`docs/audit_2026-08.md`](docs/audit_2026-08.md) | using the tool on a real project: what breaks, and why the spec itself is not sufficient for build optimization |
| [`docs/design_directions.md`](docs/design_directions.md) | target architecture — cost model, scheduler, counterfactuals — and the two usage scenarios |
| [`docs/scenarios.md`](docs/scenarios.md) | **the backlog** |
| [`examples/cmake-cpp/README.md`](examples/cmake-cpp/README.md) | reference workload with planted, measured build pathologies |

## Layout

```
bst_graph_extractor/    Tool 1 — Python CLI: bst show -> analysis -> JSON
viewer/                 Tool 2 — JavaScript modules for a G6 viewer (not yet loadable)
examples/cmake-cpp/     reference workload: CMake/C++ build + BuildStream elements
docs/                   specification, reviews, backlog
```

## Trying it

```bash
pip install networkx jsonschema     # not declared in the repo yet

# against the reference workload, no BuildStream installation required
export PATH="$PWD/examples/cmake-cpp/tools/bst-shim:$PATH"
export BST_SHIM_PROJECT="$PWD/examples/cmake-cpp"
python3 -m bst_graph_extractor.cli app/stack.bst -o /tmp/graph.json -v
```

See [`examples/cmake-cpp/README.md`](examples/cmake-cpp/README.md) for what that
currently produces and how to work around it.

## Licence

Apache 2.0 — see [`LICENSE`](LICENSE).
