# Graph Page Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The graph page shows the whole drawing fitted in a window-height viewport that can be zoomed and dragged, scrolls its scenario list inside its own column, and puts the legend top right.

**Architecture:** A new `web/js/ui/pan-zoom.js` moves the rendered SVG's `viewBox` (pure view arithmetic, tested; DOM wiring, hand-checked). `graph.html` regroups the explanation and legend into a `.lead` grid and wraps the picture in a `.viewport` with three buttons; `graph.css` sizes the picture box and side column to `--picture-height` and lets `#scenarios` scroll. Nothing drawn, bound or recorded changes.

**Tech Stack:** Plain ES modules, CSS, `node:test`. Spec: `.claude/plans/2026-09-17-graph-page-layout-design.md`.

## Global Constraints

- No third-party script on any page; the graph page loads only `vendor/mermaid.min.js` and its own modules, and every request it makes is to its own origin (`tests/engine/graph-page.test.mjs` asserts the static part).
- `pan-zoom.js` imports nothing and touches no DOM at module scope (it must import under Node for the tests and for the import-closure walker).
- What is drawn, the tooltips (`bindTooltips`), the highlighting (`light`) and `web/graph-scenarios.json` do not change; `node scripts/draw_graph.mjs --check` must stay current without being re-run.
- Scale clamp relative to fit: `MIN_SCALE = 0.5`, `MAX_SCALE = 8`. Wheel factor `Math.exp(-delta * 0.002)`, line-mode deltas ×40. Buttons zoom ×1.5 / ÷1.5 about the centre of the current view.
- The page is the window: `main` a flex column `calc(100vh - 3.5rem)` tall, `.graph-layout` taking the rest with its row `minmax(0, 1fr)`; below `64rem` it stacks and scrolls, the viewport `60vh` and `#scenarios` `max-height: 16rem`. (Task 2 was written and reviewed against a fixed `--picture-height: calc(100vh - 6rem)`; Task 3's hand check replaced it — see the spec's Layout deviation and the changelog. `graph.css` as committed is the truth, not Task 2's block.)
- AGENTS.md: any commit touching `.claude/plans/ai-tarot-v1.5-plan.md` updates its Plan changelog in the same commit; small commits; the human merges. Commit messages are plain sentences, like the log.
- Run the tests with `node --test tests/engine/pan-zoom.test.mjs tests/engine/graph-page.test.mjs` from the repo root; the whole suite is `scripts/test.sh`.

---

### Task 1: The pan-zoom module

**Files:**
- Create: `web/js/ui/pan-zoom.js`
- Test: `tests/engine/pan-zoom.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `MIN_SCALE`, `MAX_SCALE`, `fit(home)`, `scaleOf(home, view)`, `zoomed(home, view, factor, cx, cy)`, `panned(view, dx, dy)`, and `attachPanZoom(svg, viewport, { zoomIn, zoomOut, fitButton })`. A view is `{ x, y, w, h }` in drawing units. Task 2 calls `attachPanZoom`.

- [ ] **Step 1: Write the failing tests**

Create `tests/engine/pan-zoom.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_SCALE, MIN_SCALE, fit, panned, scaleOf, zoomed } from "../../web/js/ui/pan-zoom.js";

const home = { x: 0, y: 0, w: 2000, h: 1000 };
const close = (view, expected) => {
  for (const key of ["x", "y", "w", "h"]) assert.ok(Math.abs(view[key] - expected[key]) < 1e-9, `${key}: ${view[key]} vs ${expected[key]}`);
};

test("fit is the whole drawing, and a copy of it", () => {
  const view = fit(home);
  assert.deepEqual(view, home);
  assert.notEqual(view, home);
  assert.equal(scaleOf(home, view), 1);
});

test("zooming keeps the point under the cursor where it was", () => {
  const view = zoomed(home, fit(home), 2, 500, 250);
  // Half the size, and the point a quarter of the way across is still a quarter of the way across.
  assert.deepEqual(view, { x: 250, y: 125, w: 1000, h: 500 });
  assert.equal(scaleOf(home, view), 2);
});

test("zooming in and back out about one point returns home", () => {
  close(zoomed(home, zoomed(home, fit(home), 3, 1234, 56), 1 / 3, 1234, 56), home);
});

test("the scale is clamped at both ends, about the same point", () => {
  const far = zoomed(home, fit(home), 100, 600, 300);
  assert.equal(scaleOf(home, far), MAX_SCALE);
  // 600 is 30% of the way across the home view; still 30% across the clamped one.
  assert.ok(Math.abs((600 - far.x) / far.w - 0.3) < 1e-9);
  const out = zoomed(home, fit(home), 0.01, 0, 0);
  assert.equal(scaleOf(home, out), MIN_SCALE);
  assert.deepEqual(out, { x: 0, y: 0, w: 4000, h: 2000 });
});

test("at the clamp a further zoom changes nothing", () => {
  const far = zoomed(home, fit(home), MAX_SCALE, 100, 100);
  assert.deepEqual(zoomed(home, far, 2, 100, 100), far);
});

test("a drag moves the view against the drag", () => {
  // The drawing dragged 10 right and 5 up shows what was 10 to the left and 5 below.
  assert.deepEqual(panned(fit(home), 10, -5), { x: -10, y: 5, w: 2000, h: 1000 });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/engine/pan-zoom.test.mjs`
Expected: FAIL — `Cannot find module '.../web/js/ui/pan-zoom.js'`.

- [ ] **Step 3: Write the module**

Create `web/js/ui/pan-zoom.js`:

```js
/**
 * Pan and zoom for an inline SVG, through its viewBox. The browser does the
 * scaling, the text stays text, and nothing bound to the drawing's elements
 * (the tooltips, the lit path) has to know. A view is the visible rectangle
 * in the drawing's own units; home is the viewBox the drawing came with,
 * which shows all of it.
 */

/** Half the fit: the whole graph, small. */
export const MIN_SCALE = 0.5;
/** Eight times the fit: one node, large. */
export const MAX_SCALE = 8;

/** The view that shows the whole drawing. */
export const fit = (home) => ({ ...home });

/** How far in a view is: 1 at fit, 2 at twice as close. */
export const scaleOf = (home, view) => home.w / view.w;

/**
 * The view zoomed by `factor` about the drawing point (cx, cy), so that what
 * is under the cursor stays under the cursor. Clamped to the scale range; at
 * the clamp the view does not move.
 */
export function zoomed(home, view, factor, cx, cy) {
  const before = scaleOf(home, view);
  const after = Math.min(MAX_SCALE, Math.max(MIN_SCALE, before * factor));
  const k = after / before;
  return {
    x: cx - (cx - view.x) / k,
    y: cy - (cy - view.y) / k,
    w: view.w / k,
    h: view.h / k,
  };
}

/** The view after the drawing has been dragged by (dx, dy) drawing units. */
export const panned = (view, dx, dy) => ({ ...view, x: view.x - dx, y: view.y - dy });

/**
 * Wires wheel, drag and the three buttons. The svg must fill `viewport`
 * (graph.css: width and height 100%), so the viewBox alone decides what is
 * seen, and client points map to drawing points through the svg's own screen
 * transform -- the letterbox offset is never computed by hand.
 */
export function attachPanZoom(svg, viewport, { zoomIn, zoomOut, fitButton }) {
  const box = svg.viewBox.baseVal;
  const home = { x: box.x, y: box.y, w: box.width, h: box.height };
  let view = fit(home);
  const show = () => svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);
  const toDrawing = (clientX, clientY) =>
    new DOMPoint(clientX, clientY).matrixTransform(svg.getScreenCTM().inverse());
  const zoomAbout = (factor, point) => { view = zoomed(home, view, factor, point.x, point.y); show(); };
  const centre = () => ({ x: view.x + view.w / 2, y: view.y + view.h / 2 });

  viewport.addEventListener("wheel", (event) => {
    // The page does not scroll under a cursor that is zooming.
    event.preventDefault();
    // A mouse notch is ~100 pixels, a trackpad pinch a few per event, and
    // Firefox reports notches in lines (deltaMode 1): the exponent makes all
    // of them smooth, and the line scale keeps Firefox from crawling.
    const delta = event.deltaMode ? event.deltaY * 40 : event.deltaY;
    zoomAbout(Math.exp(-delta * 0.002), toDrawing(event.clientX, event.clientY));
  }, { passive: false });

  let last = null;
  viewport.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    last = { x: event.clientX, y: event.clientY };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add("dragging");
  });
  viewport.addEventListener("pointermove", (event) => {
    if (!last) return;
    // Drawing units per client pixel. The svg's screen transform is a uniform
    // scale and a translation, so one axis says it all.
    const unitsPerPixel = 1 / svg.getScreenCTM().a;
    view = panned(view, (event.clientX - last.x) * unitsPerPixel, (event.clientY - last.y) * unitsPerPixel);
    last = { x: event.clientX, y: event.clientY };
    show();
  });
  const release = () => { last = null; viewport.classList.remove("dragging"); };
  viewport.addEventListener("pointerup", release);
  viewport.addEventListener("pointercancel", release);

  zoomIn.addEventListener("click", () => zoomAbout(1.5, centre()));
  zoomOut.addEventListener("click", () => zoomAbout(1 / 1.5, centre()));
  fitButton.addEventListener("click", () => { view = fit(home); show(); });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/engine/pan-zoom.test.mjs`
Expected: 6 passing, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add web/js/ui/pan-zoom.js tests/engine/pan-zoom.test.mjs
git commit -m "A viewBox is panned and zoomed, and the point under the cursor stays put"
```

---

### Task 2: The page: lead, viewport, scrolling column

**Files:**
- Modify: `web/graph.html` (the `<main>` body)
- Modify: `web/css/graph.css` (whole file)
- Modify: `web/js/ui/graph-page.js:1-12` (doc comment), `:13` (imports), `:96-107` (`main()` after the render)
- Test: `tests/engine/graph-page.test.mjs` (existing, unchanged) and `tests/engine/pan-zoom.test.mjs` (Task 1)

**Interfaces:**
- Consumes: `attachPanZoom(svg, viewport, { zoomIn, zoomOut, fitButton })` from `web/js/ui/pan-zoom.js` (Task 1).
- Produces: element ids `zoom-in`, `zoom-out`, `zoom-fit`; classes `lead`, `legend-box`, `viewport`, `zoom`, `hint`, `dragging`; the CSS custom property `--picture-height`.

- [ ] **Step 1: Confirm the page test is green before touching anything**

Run: `node --test tests/engine/graph-page.test.mjs`
Expected: all passing. (This test walks the import closure of `graph-page.js` and greps `graph.html`; it stays the guard for this task.)

- [ ] **Step 2: Rewrite the body of `web/graph.html`**

Replace everything from `<main class="wide">` through `</main>` with:

```html
<main class="wide">
  <h1>AI Tarot Projection — how the reading decides</h1>
  <p>The reading's control flow, drawn by the engine from itself when this page loaded.
     <a href="index.html">Run a reading &rarr;</a> &middot; <a href="pack.html">Browse the pack &rarr;</a></p>

  <div class="lead">
    <section class="explain">
      <p>The engine that runs a reading is a <strong>LangGraph <code>StateGraph</code></strong>, and it runs in
         your browser. One turn of the conversation is one run of this graph. Every kind of turn the reader
         can take is a node with that name; the dashed edges are the decisions, and the word on each one is
         the reason that branch is taken. The picture is not maintained by hand: this page compiles the same
         graph the reading runs on and asks it to draw itself. Source:
         <code>web/js/engine/graph.js</code>.</p>
      <p>The model in this engine judges; it does not decide. It returns a verdict on each answer &mdash;
         how deep, whether it was about their life, hedged, the stakes &mdash; and every decision after that
         is a rule. The scenarios on the left were each run once through the real engine with a scripted
         judge and recorded; nothing runs here, and nothing leaves this page.
         <a href="https://github.com/wyc79/ai-tarot-projection#the-engine-is-a-graph">Read more &rarr;</a></p>
    </section>

    <aside class="legend-box">
      <h2>Legend</h2>
      <dl class="legend">
        <dt><span class="sample dashed"></span>dashed edge</dt>
        <dd>a decision; its label is the key the router returned</dd>
        <dt><span class="sample"></span>solid edge</dt>
        <dd>always taken</dd>
        <dt><span class="sample lit"></span>orange</dt>
        <dd>the path the selected scenario took</dd>
        <dt>rounded ends</dt>
        <dd><code>__start__</code> and <code>__end__</code>: where a turn enters and leaves the graph</dd>
        <dt>hover</dt>
        <dd>any node or edge label, for what it means</dd>
      </dl>
    </aside>
  </div>

  <div class="graph-layout">
    <aside class="side">
      <h2>Scenarios</h2>
      <p class="side-note">A moment in a reading. Click one to light the path that turn took.</p>
      <div id="scenarios"></div>
    </aside>

    <div class="picture-column">
      <div class="viewport">
        <div id="picture" class="picture">rendering…</div>
        <!-- Beside #picture rather than inside it: the render replaces its
             contents. -->
        <div class="zoom">
          <button type="button" id="zoom-out" title="zoom out">&minus;</button>
          <button type="button" id="zoom-in" title="zoom in">+</button>
          <button type="button" id="zoom-fit" title="the whole graph">fit</button>
        </div>
      </div>
      <p class="hint">Scroll to zoom, drag to move.</p>
      <div id="trace" class="trace" hidden>
        <p><span class="label">they said</span> <span id="trace-answer"></span></p>
        <p><span class="label">the judge returned</span> <code id="trace-verdict"></code></p>
        <p><span class="label">the engine decided</span> <span id="trace-reason"></span></p>
      </div>
    </div>
  </div>
  <div id="tip" class="tip" hidden></div>
</main>
```

The `<head>` and the two `<script>` tags after `</main>` are unchanged.

- [ ] **Step 3: Rewrite `web/css/graph.css`**

Replace the whole file with:

```css
/* The graph page. debug.css does the frame; this is the lead, the picture
   viewport, the side column and the tooltip. */

/* The drawing is wider than the site's column; .explain keeps its own
   max-width below. */
main.wide { max-width: none; }

/* The picture box and the scenario column are the same height: most of the
   window, so the drawing is browsed in place rather than scrolled past. */
:root { --picture-height: calc(100vh - 6rem); }

/* Explanation left, legend in the space beside it. */
.lead { display: grid; grid-template-columns: minmax(0, 1fr) 20rem; gap: 1rem 3rem; align-items: start; margin-bottom: 1.5rem; }
.explain { max-width: 60rem; font-size: 0.92rem; }
.explain p { margin: 0 0 0.75rem; }

.graph-layout { display: grid; grid-template-columns: 18rem minmax(0, 1fr); gap: 1.5rem; align-items: start; }

.side h2, .legend-box h2 { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--dim); margin: 0 0 0.5rem; font-weight: 600; }
.side-note { margin: 0 0 0.75rem; color: var(--dim); font-size: 0.82rem; }

/* Heading and note at the top; the list takes the rest of the column and
   scrolls, because seventeen buttons are taller than any window. min-height: 0
   is what lets a flex child shrink below its content. */
.side { height: var(--picture-height); display: flex; flex-direction: column; }
#scenarios { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding-right: 0.25rem; }

.scenario {
  display: block; width: 100%; text-align: left; margin: 0 0 0.35rem; padding: 0.45rem 0.65rem;
  background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 6px;
  cursor: pointer; font: inherit; font-size: 0.9rem;
}
.scenario:hover { border-color: var(--dim); }
.scenario.active { border-color: #e0891b; }
.scenario small { display: block; color: var(--dim); font-size: 0.78rem; line-height: 1.35; margin-top: 0.15rem; }

.legend { margin: 0; font-size: 0.85rem; }
.legend dt { color: var(--text); margin-top: 0.6rem; }
.legend dt:first-child { margin-top: 0; }
.legend dd { margin: 0; color: var(--dim); }
.legend .sample { display: inline-block; width: 2.5rem; border-top: 2px solid #333; vertical-align: middle; margin-right: 0.5rem; background: #fff; box-shadow: 0 0 0 3px #fff; }
.legend .sample.dashed { border-top-style: dashed; }
.legend .sample.lit { border-top: 3px solid #e0891b; }

/* The picture keeps Mermaid's light theme on a light panel: it is a diagram,
   and LangGraph's own colours are part of what it shows. The box is a
   viewport: the svg fills it and its viewBox decides what is seen, which
   pan-zoom.js moves. */
.viewport { position: relative; }
.picture {
  height: var(--picture-height); padding: 0.5rem; overflow: hidden;
  background: #fff; border-radius: 8px; color: #222;
  cursor: grab; user-select: none; touch-action: none;
}
.picture.dragging { cursor: grabbing; }
/* !important because Mermaid puts its max-width inline on the element. */
.picture svg { display: block; width: 100%; height: 100%; max-width: none !important; }
.zoom { position: absolute; top: 0.75rem; right: 0.75rem; display: flex; gap: 0.25rem; }
.zoom button { padding: 0.15rem 0.6rem; font-size: 0.9rem; }
.hint { margin: 0.5rem 0 0; color: var(--dim); font-size: 0.82rem; }

/* !important: Mermaid's own stylesheet is id-scoped (#reading …), which outranks any class rule. */
.picture g.node.lit rect, .picture g.node.lit path { stroke: #e0891b !important; stroke-width: 3px !important; }
.picture path.lit { stroke: #e0891b !important; stroke-width: 3.5px !important; }

/* debug.css's .label is the page's small-caps field label; Mermaid uses the
   same class name for every label in the drawing. Scoped to svg rather than to
   .picture because Mermaid measures the labels in a temporary container outside
   it, and a box measured at one size clips the text at another. */
svg .label { text-transform: none; font-size: inherit; letter-spacing: normal; }

.trace { margin-top: 1rem; font-size: 0.92rem; }
.trace p { margin: 0.3rem 0; }
.trace .label { margin-right: 0.5rem; }
.trace code { font-size: 0.85rem; }

.tip {
  position: fixed; max-width: 24rem; padding: 0.5rem 0.7rem; z-index: 10; pointer-events: none;
  background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 6px;
  font-size: 0.85rem; line-height: 1.4;
}
.tip[hidden] { display: none; }

@media (max-width: 64rem) {
  :root { --picture-height: 60vh; }
  .lead, .graph-layout { grid-template-columns: 1fr; }
  /* Stacked, the list sits above the drawing; a short box keeps the drawing
     within reach. */
  .side { height: auto; }
  #scenarios { max-height: 16rem; }
}
```

- [ ] **Step 4: Wire `web/js/ui/graph-page.js` to the module**

Replace the doc comment at the top of the file (lines 1–12) with:

```js
/**
 * The graph page: the reading's control flow, drawn from the compiled graph.
 *
 * Four things happen here and none of them is a reading. The graph is
 * compiled with no context and asked to draw itself; Mermaid renders the
 * text; the picture becomes a viewport that pan-zoom.js moves; then the notes
 * from graph.js are bound to the rendered nodes and edge labels as tooltips,
 * and the recorded scenarios are bound to buttons that colour the path each
 * one took. The scenarios were recorded by scripts/draw_graph.mjs running the
 * real engine; this page runs nothing and fetches nothing from anywhere but
 * its own origin.
 */
```

Add, after `import { buildGraph } from "../engine/graph.js";`:

```js
import { attachPanZoom } from "./pan-zoom.js";
```

In `main()`, replace the block from `const drawing = $("picture").querySelector("svg");` through `bindTooltips(drawing, notes);` (the viewBox comment and the two `setAttribute` calls go) with:

```js
  const drawing = $("picture").querySelector("svg");
  attachPanZoom(drawing, $("picture"), { zoomIn: $("zoom-in"), zoomOut: $("zoom-out"), fitButton: $("zoom-fit") });
  bindTooltips(drawing, notes);
```

- [ ] **Step 5: Run the tests**

Run: `node --test tests/engine/pan-zoom.test.mjs tests/engine/graph-page.test.mjs`
Expected: all passing. Then `node scripts/draw_graph.mjs --check` — expected: current (nothing drawn or recorded has changed).

- [ ] **Step 6: Commit**

```bash
git add web/graph.html web/css/graph.css web/js/ui/graph-page.js
git commit -m "The graph page is browsed: a fitted viewport, a scrolling list, the legend up top"
```

---

### Task 3: Hand check and changelog

Run by the controller, not a subagent: it needs the session's headless-Chrome harness.

**Files:**
- Modify: `.claude/plans/ai-tarot-v1.5-plan.md` (Plan changelog, new first entry)

- [ ] **Step 1: Serve and drive the page**

`python3 -m http.server 8787 --directory web` in the background; headless Chrome with `--remote-debugging-port=9222`; the scratchpad's `drive.mjs` extended to: read the viewBox after load and assert it equals the svg's original (fit); dispatch a wheel event over a node and assert the viewBox shrank and the drawing point under the cursor is unchanged; dispatch a drag and assert the viewBox moved; click `#zoom-fit` and assert home again; assert `#scenarios` has `scrollHeight > clientHeight` and `overflow-y: auto`; assert `.legend-box`'s bounding box is above `.graph-layout` and to the right of `.explain`; the existing scenario, tooltip, host and console checks. Screenshot at 1600×1300 and at 800×1300 (stacked layout).

- [ ] **Step 2: Fix what the check finds** — by hand if it is CSS, through a fix subagent if it is the module. Re-run the check after.

- [ ] **Step 3: Changelog**

Insert at the top of `## Plan changelog` in `.claude/plans/ai-tarot-v1.5-plan.md`, with the check's actual findings written into the last sentence:

```
- v1.5 (2026-09-17): the graph page is laid out to be browsed, on branch graph-page-layout.
  Spec in 2026-09-17-graph-page-layout-design.md. The drawing had been shown at natural size in
  a scrolling panel, ~2100px wide, so the whole graph was never in view and the seventeen
  scenario buttons ran below it. Now the picture is a viewport the height of the window with
  the graph fitted into it, zoomed by wheel or buttons and dragged about, done through the
  svg's viewBox in web/js/ui/pan-zoom.js (svg-pan-zoom considered; ~50 lines of viewBox
  arithmetic are simpler than a third vendored script); the scenario list scrolls inside a
  column of the same height; the legend sits top right beside the explanation. What is drawn,
  the tooltips and the recorded traces are untouched, and draw_graph.mjs --check stays current
  without a re-run. Hand check in headless Chrome: <what was checked and what it found>.
```

- [ ] **Step 4: Commit**

```bash
git add .claude/plans/ai-tarot-v1.5-plan.md
git commit -m "Plan changelog: the graph page is browsed, and how that was checked"
```
