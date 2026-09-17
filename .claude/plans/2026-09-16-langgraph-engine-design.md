# LangGraph engine — design

2026-09-16. Branch `langgraph-engine`. Status: awaiting review.

## Goal

The reading engine becomes a LangGraph `StateGraph`, truthfully, running in
the browser exactly where it runs today, and the graph it compiles to is
visible to anyone who opens the repo or clicks through from the site. The
deliverable is the sentence "built on LangGraph" being true and checkable, for
a portfolio audience that knows the tool. Nothing about how a reading paces,
judges, or ends changes.

## Non-goals

- No real-time trace. The graph page is a static render of the compiled
  graph, drawn at load from the same `buildGraph()` the reading runs on. There
  is no hand-maintained picture anywhere: not a layout file, not a node list,
  not an SVG. If it is on the page, it came out of the compiled object.
- No LangSmith. Not wired, and not mimicked. The tracer ships inside the
  bundle, is never enabled, and a test proves the graph makes no network
  calls. The README says so: that is the demonstration of knowing the
  ecosystem, not a fake trace viewer.
- No checkpointer, no `interrupt()`. The session already persists under
  `tarot:` keys client-side; a second persisted truth is not wanted.
- No change to state.js, judgements.js, prompts.js, or any pack file. The
  engine's rules are not touched, only the control flow that sequences them.
- No third-party script tag on any page of the site. A CDN script on one page
  of the origin can read `tarot:` localStorage on every page. Both libraries
  are vendored, pinned, and served from the repo.

## Architecture

### One turn is one graph run

`startReading()` keeps its interface: `session`, `begin`, `say`, `meanings`,
`end`, `stayAWhile`, `onEvent`, the same return shapes, the same events in
the same order. The tests, the scripts, and both pages do not change.

Inside, `say(answer)` and `meanings()` call `graph.invoke({ kind, answer })`.
The graph state is turn-local scratch and nothing else:

```
kind      "say" | "meanings"
answer    what they said
opening   judge.opening's verdict (opening turn only)
gate      judge.gate's verdict
decision  flipDecision's result, or the synthetic { flip: false, reason }
          the non-flip branches already return today
text      the reader's turn
result    what say() / meanings() return, in today's shapes. Written by the
          node that knows which branch this is (off_frame, judge_opening,
          aside, exchange, tail, decide, meanings) and overwritten by the
          node that changes the outcome (flip on the opening turn, farewell,
          close). Shared nodes such as respond never write it.
```

The session object is closed over, not carried in graph state, and it is
mutated by the same state.js functions in the same order as today. Nodes are
the bodies of the functions in reading.js; conditional edges are its `if`s.
Routers are pure functions over `(state, session)` and emit nothing; every
event is emitted from inside a node, after the state change it announces.

The alternatives — the whole reading as one run with `interrupt()` per user
turn and a checkpointer, or the session as graph state with reducers — were
rejected: the first creates a second persisted truth beside the session, the
second rewrites state.js's mutation style for no product gain.

### Nodes

Every reader turn kind in `TURN_INSTRUCTIONS` is a node of the same name, so
the picture reads as the reading does. The remaining nodes are the judgements,
the ledger writes, and the flips.

| node            | does                                                              |
|-----------------|-------------------------------------------------------------------|
| `judge_opening` | judge.opening; recordOpening; `opening` event; `frame_dropped` if so |
| `judge_gate`    | judge.gate → `gate`                                               |
| `off_frame`     | recordOffFrame (frame dropped before any card)                    |
| `aside`         | recordAside; `gate` event; `frame_dropped` if so                  |
| `exchange`      | recordExchange; `gate` event; `frame_dropped` if so               |
| `tail`          | recordAfterward at `afterward` or `afterglow`; `gate` event; `frame_dropped` if so |
| `decide`        | starts the anchor revision (see below); flipDecision → `decision`; `flip_decision` event |
| `commit_anchor` | commitAnchor(judge.anchor); persist; `anchor` event                |
| `flip`          | flipCard(cardFor(nextPosition)); `flip` event. Reason is `decision.reason`, or the fixed opening reason when `opening` is set |
| `flip_epilogue` | flipEpilogue(cardFor(epilogue_position)); `flip` event            |
| `invite`, `respond`, `clarify`, `bridge`, `epilogue`, `close`, `after`, `farewell`, `afterglow`, `regroup`, `meanings` | readerTurn(kind) with the options each has today; `close` also closes the session and sets phase; `farewell` also ends it; `meanings` also records its aside first |
| `revise_anchor` | awaits the pending revision, if any; updateAnchor; persist; `anchor` event with `rolling: true` |

`respond` is reached from five branches with two different `onCard` values
today; it derives the value as `!session.closed`, which is what every caller
passes.

### Edges

```
START ─entry─┬─ meanings ─────────────────────────────────────────────► END
             ├─ judge_opening ─┬─ (frame dropped) → respond
             │                 └─ flip → invite ────────────────────────► END
             ├─ off_frame → respond
             └─ judge_gate ─┬─ (asked back, on a card) → aside → clarify ► END
                            ├─ (closed) → tail ─┬─ (frame dropped) → respond
                            │                   ├─ (afterglow) ─┬─ afterglow ► END
                            │                   │               └─ regroup ─► END
                            │                   ├─ (farewell due) → farewell ► END
                            │                   └─ after ────────────────► END
                            └─ exchange ─┬─ (frame dropped) → respond
                                         └─ decide ─┬─ (hold) → respond
                                                    ├─ (no anchor yet) → commit_anchor ─┐
                                                    ├─ flip → bridge                     │
                                                    ├─ flip_epilogue → epilogue          │
                                                    └─ close                             │
                                                    ◄─ same router, from commit_anchor ──┘
respond | bridge | epilogue | close → revise_anchor ► END
```

Routers are pure over `(state, session)` and return a path-map key, never a
node name. The key is the label LangGraph draws on the dashed edge, so the
picture says why each branch is taken. The keys, and where they go:

- `entry` (from START): `meanings` → meanings; `opening` → judge_opening;
  `frame dropped` → off_frame (frame dropped and no current card); `answer`
  → judge_gate.
- `after_opening`: `frame dropped` → respond; `dealt` → flip.
- `after_flip`: `first card` → invite (`state.opening` set); `next card` →
  bridge.
- `after_gate`: `asked back` → aside (`gate.asked_back` and a current card);
  `closed` → tail; `exchange` → exchange.
- `after_exchange`: `frame dropped` → respond; `judged` → decide.
- `advance`, one function used as the conditional edge out of both `decide`
  and `commit_anchor`: `hold` → respond (`!decision.flip`); `no anchor yet`
  → commit_anchor (in decide's map only — commit_anchor leaves an anchor
  behind, so the key cannot recur and is not in its map); `epilogue earned`
  → flip_epilogue; `spread complete` → close; `flip` → flip.
- `after_tail`: `frame dropped` → respond; `afterglow` → afterglow;
  `drifted` → regroup (afterglowDrift); `farewell due` → farewell; `after` →
  after.

### The expected picture

Three files beside this spec are the acceptance reference for the first
implementation, drawn from the node and edge lists above before any code
existed:

- `2026-09-16-langgraph-engine-expected.mmd` — the `drawMermaid()` text the
  compiled graph is expected to produce: 24 nodes, 41 edges, 26 of them
  conditional and labelled. The check is mechanical: a sorted line diff
  between it and the real output must be empty. Edge order in LangGraph's
  output depends on insertion order, which is why the diff is sorted.
- `2026-09-16-langgraph-engine-expected.svg` — the same graph hand-laid-out
  for reading: orthogonal routing, one row per layer. Compare nodes, edges,
  dashes and labels against it; not positions.
- `2026-09-16-langgraph-engine-expected-mermaid.svg` — the `.mmd` rendered
  through the real Mermaid build in headless Chrome. This is what
  `graph.html` will look like, dagre's layout and all.

Once the implementation matches, the README block and the page are the
living render and these three stay as the record of what was designed.

### The anchor revision

Today `beginAnchorRevision` starts a model call before the reader turn and
`settleAnchorRevision` applies it after, so the revision costs no latency on
the turns where the person is most aware of the pause. LangGraph runs each
superstep to completion before the next starts, so a fan-out of
`revise_anchor` beside the reader node would serialise the two calls and put
the round trip back. So: `decide` starts the promise and holds it in a closure
variable (never in graph state, where LangGraph expects data, not a
Promise), and `revise_anchor` is where it lands. On paths that never started one it awaits
`null` and does nothing, which is what `settleAnchorRevision(null)` does now.
The revision starts in `decide` rather than `exchange` so that a frame-dropped
turn does not start one, as today.

### Errors and guards

- A node that throws rejects `say()` with the same error the client threw.
  If LangGraph wraps it, the implementation unwraps to the original; a test
  pins the message either way, because the UI shows it.
- `oneAtATime` is unchanged and wraps the graph call.
- `meanings()`'s two guards (`ended`, `!closed`) stay in the method, before
  the graph is entered, so they throw as they do now.
- The default recursion limit (25) is far above the longest path (7 nodes).

### Where the code lives

- `web/js/engine/graph.js` — new. `buildGraph(ctx)` declares the nodes,
  routers and edges and returns the compiled graph. `ctx` carries `session`,
  `pack`, `judge`, `readerTurn`, `cardFor`, `persist`, `onEvent`, and the
  revision slot. Called with no `ctx`, it compiles a graph whose nodes are
  never run — that is what the drawing script uses.
- `web/js/engine/reading.js` — keeps `startReading`: the deal, `readerTurn`,
  `cardFor`, `persist`, the public methods. `say`, `openWith`, `afterward`,
  `advance`, `flipNext` and the two anchor helpers move into graph.js as nodes.
- `web/vendor/langgraph.js` — the bundle, imported by relative path.

## The dependency

- `package.json` + `package-lock.json`, devDependencies only:
  `@langchain/langgraph` pinned exact, `esbuild` pinned exact. `node_modules/`
  goes in `.gitignore` (it is not there today).
- `scripts/langgraph_entry.js` re-exports exactly what the engine uses:
  `StateGraph`, `Annotation`, `START`, `END`.
- `scripts/vendor_langgraph.sh` runs `npm ci` and esbuild
  (`--bundle --format=esm --platform=browser --minify`, with a banner naming
  the version and this script) into `web/vendor/langgraph.js`, which is
  committed. `--check` builds to a temporary path and `cmp`s against the
  committed file; it is the audit path for a 1.3 MB file nobody reads.
  It is not a leg of `scripts/test.sh` because `npm ci` needs the network.
- One file for every environment: the browser, Node tests, the Python relay
  and GitHub Pages all serve or import the same path, so there is no import
  map and no second copy to drift. "Run it yourself" still needs no Node;
  re-vendoring does, once.
- Measured in a spike: 1.3 MB minified (≈ 2.5 MB unminified), mostly
  `@langchain/core`, zod and the langsmith client. Runs with no `process`
  global and a `fetch` that throws. Accepted as the cost of the name; it is
  the first page weight this project has.

Mermaid, for the graph page only:

- `mermaid` pinned exact in the same devDependencies. `web/vendor/mermaid.min.js`
  is a straight copy of the package's own prebuilt `dist/mermaid.min.js`
  (5.5 MB; the ESM build is small but lazy-loads 134 chunks, which is a
  folder to vendor and no better). The same `vendor_langgraph.sh` copies it
  and `--check` `cmp`s it, so one script owns both vendored files.
- Loaded by `graph.html` and nothing else. `index.html` does not get heavier.
- The alternative was `@dagrejs/dagre` (~130 KB) for layout plus ~100 lines of
  SVG drawing in the site's style, reading `getGraph().toJSON()`. Rejected for
  now: it is drawing code to own, and the Mermaid render is the picture every
  LangGraph tutorial shows, which is the point for this audience. It is the
  swap to make if the page weight ever matters.

## Visibility

### The graph page

- `web/graph.html` + `web/js/ui/graph-page.js`. On load: `buildGraph()` with
  no context, `getGraphAsync().drawMermaid()`, and `mermaid.render()` of that
  text into the page. Nothing else. No pack, no key, no session — the page
  works for a visitor who has none of them.
- The page says, in a paragraph above the picture, what it is: the reading's
  control flow as LangGraph compiled it a moment ago, dashed edges are
  conditional and their label is the reason the branch is taken, every
  reader turn kind is a node, and the source is `web/js/engine/graph.js`. It links back to `index.html` and to the README
  section, the way `pack.html` and `debug.html` cross-link today.
- `index.html` gains one link to it in the same place it links nothing else
  today: a line in the footer, "how the reading decides →". The styled page
  otherwise does not change, and the debug machinery still never reaches it.

### The README

- `scripts/draw_graph.mjs`: the same two calls as the page, written
  into `README.md` between `<!-- graph:begin -->` and `<!-- graph:end -->`
  inside a ```` ```mermaid ```` fence. GitHub renders it. `--check`
  regenerates and diffs, and is a leg of `scripts/test.sh`, so a node added
  without redrawing fails the suite. It is a cached render of the page's
  source, not a second definition.
- The README gains a section on the engine as a graph, placed after "Your
  key, and where it goes": what the nodes are, that conditional edges are
  dashed because that is how LangGraph draws them, a link to the live page,
  the vendoring and audit story, and the LangSmith paragraph.
- If GitHub's Mermaid rejects anything in `drawMermaid()`'s output (the
  `<p>` it wraps `__start__`/`__end__` in is the likely one), the script
  strips exactly that and says so in a comment. The page renders the
  unmodified text.

## Tests

Existing: all four legs of `scripts/test.sh` unchanged and green.

New, in `tests/engine/graph.test.mjs`:

1. The seeded session runs end to end through the graph with
   `globalThis.fetch` replaced by a function that throws. The runtime never
   touches the network.
2. A fake client whose `chat` throws makes `say()` reject with that message.
3. Every key of `TURN_INSTRUCTIONS` is a node name in the compiled graph, and
   every node name that is a turn kind is a key. Adding a turn kind without a
   node, or a node the reader cannot speak, fails.
4. Once, at the end of the implementation and recorded in the plan changelog:
   the sorted-line diff between `drawMermaid()` and the expected `.mmd` is
   empty.

New leg in `scripts/test.sh`: `node scripts/draw_graph.mjs --check`.

The graph page has no automated test, because the suite has no browser. It
is checked by hand through `python3 server/relay.py` → `/graph.html` before
the branch is offered for merge, and the check is recorded in the plan
changelog entry.

One-time verification, recorded in the plan changelog rather than kept as a
golden: `node scripts/seeded_session.mjs --json` captured on `main` before the
change and diffed against the branch after. It must be byte-identical — same
cards, same flip decisions and reasons, same prompts, same close.

## Docs and plan

- README: the section above; the "You need Python 3 and nothing else" line
  gets its caveat; the file-size note.
- `.claude/plans/ai-tarot-v1.5-plan.md`: a milestone section for this work
  and a changelog entry in the same commit, per AGENTS.md. The entry says
  out loud that this dependency does not reduce complexity, which AGENTS.md
  asks of libraries, and that it is here because "built on LangGraph" is the
  deliverable. That is a conflict with the working agreements, flagged rather
  than hidden.

## Files

```
new      web/js/engine/graph.js
new      web/vendor/langgraph.js
new      web/vendor/mermaid.min.js
new      web/graph.html
new      web/js/ui/graph-page.js
new      scripts/langgraph_entry.js
new      scripts/vendor_langgraph.sh
new      scripts/draw_graph.mjs
new      tests/engine/graph.test.mjs
new      package.json, package-lock.json
changed  web/js/engine/reading.js
changed  web/index.html
changed  scripts/test.sh
changed  README.md
changed  .gitignore
changed  .claude/plans/ai-tarot-v1.5-plan.md
```
