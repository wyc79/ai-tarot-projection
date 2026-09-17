# The graph page: a viewport, a scrolling list, and the legend up top

2026-09-17. Branch `graph-page-layout`, off `main` after `langgraph-engine`
merged. Status: implemented 2026-09-17; one deviation, noted inline under Layout. Follows 2026-09-16-langgraph-engine-design.md, which describes the
page; this changes only how it is laid out.

## Goal

The drawing is ~2100px wide at natural size and the page shows it in a
scrolling panel, which means the whole graph is never in view at once and
the scenario list, seventeen buttons long, runs far below it. Three
changes, all to `web/graph.html`, `web/css/graph.css` and
`web/js/ui/graph-page.js`:

1. The scenario list scrolls inside its own column instead of growing the
   page.
2. The picture is a viewport the height of the browser window: the graph is
   fitted into it on load, and can be zoomed in and out and dragged about.
3. The legend moves to the top right of the page, beside the explanation,
   where there is empty space today.

## Non-goals

- No change to what is drawn, to the tooltips, to the scenarios or to the
  recorded traces. `scripts/draw_graph.mjs --check` stays current without
  being re-run.
- No third-party script. svg-pan-zoom was considered; the whole behaviour is
  ~50 lines of viewBox arithmetic, and a vendored 30KB script with its own
  pin and rebuild step is not simpler than that.
- Touch pinch-to-zoom on phones. The buttons and the fit view cover it.

## Layout

Wide screens (above 64rem):

```
h1 / intro line
┌ explain (max 60rem) ──────────────────────┐  ┌ Legend ──────────┐
│ two paragraphs, as today                  │  │ dashed / solid … │
└───────────────────────────────────────────┘  └──────────────────┘
┌ Scenarios ───┐  ┌ picture ─────────────────────────── [−][+][fit] ┐
│ note         │  │ the graph, fitted; wheel zooms at the cursor,   │
│ list scrolls │  │ drag pans                                        │
│ inside, the  │  │                                                  │
│ column as    │  │                                                  │
│ tall as the  │  │                                                  │
│ picture      │  └──────────────────────────────────────────────────┘
└──────────────┘  trace: they said / the judge returned / the engine decided
```

- `.lead` is a two-column grid, explanation left and legend right; it
  stacks below 64rem, legend under the text.
- The page is the window, like the reading page. `main` is a flex column
  `calc(100vh - 3.5rem)` tall (the body's padding); the head and the lead
  take what they need and `.graph-layout` takes the rest, its one grid row
  `minmax(0, 1fr)` so neither column's content can push it taller. On a
  wide screen there is nothing to scroll. *Deviation, found by the hand
  check:* the first cut gave the box a fixed `calc(100vh - 6rem)`, which
  put its bottom off the first screen — and because the wheel over the
  picture zooms, the gesture that would have scrolled to it zoomed instead.
  `min-height: 34rem` on `main` lets a very short window scroll rather
  than crush the picture.
- The side column is a flex column: heading, note, then `#scenarios` taking
  the rest with `overflow-y: auto`. Below 64rem the layout stacks and
  scrolls like any page, the list gets `max-height: 16rem` so a phone is not
  two screens of buttons before the drawing, and the viewport is `60vh`.
- The legend is a two-column grid, term beside meaning: its height is the
  lead's, and every line of it comes out of the picture below.
- The zoom controls sit in the top-right corner of the picture box, in a
  wrapper beside `#picture` rather than inside it, because the render
  replaces `#picture`'s contents. The hint ("scroll to zoom, drag to move")
  sits in the same bar, on a white backing so it reads when the drawing
  runs under it.
- The trace under the picture keeps its space before a scenario is chosen
  (`[hidden]` is `visibility: hidden`, not `display: none`), so choosing one
  does not shrink the picture.

## Pan and zoom

Done through the SVG's `viewBox`, not a CSS transform: the browser does the
scaling, text stays text, and nothing that binds to the drawing's elements
— the tooltips, the lit path — has to know. The svg fills the box
(`width: 100%; height: 100%`, Mermaid's inline `max-width` overridden) and
the viewBox alone decides what is seen; with the default
`preserveAspectRatio` (`xMidYMid meet`) the fit view letterboxes the graph
centred in the box, whatever the box's shape.

New module `web/js/ui/pan-zoom.js`:

- A view is `{ x, y, w, h }` in drawing units; `home` is the viewBox
  Mermaid wrote. Pure: `fit(home)`, `scaleOf(home, view)` (1 at fit),
  `zoomed(home, view, factor, cx, cy)` — zoom about a drawing point so what
  is under the cursor stays under the cursor, scale clamped to
  `[MIN_SCALE, MAX_SCALE]` = `[0.5, 8]` relative to fit — and
  `panned(view, dx, dy)`.
- `attachPanZoom(svg, viewport, { zoomIn, zoomOut, fitButton })` wires the
  DOM: wheel over the viewport zooms about the cursor
  (`Math.exp(-deltaY * 0.002)`, line-mode deltas scaled ×40 so Firefox's
  wheel is not a crawl; `preventDefault`, so the page does not also
  scroll), pointer drag pans (pointer capture, client-pixel deltas
  converted with `svg.getScreenCTM().a`), the buttons zoom ×1.5 about the
  centre of the current view or return to fit. Client → drawing
  coordinates go through `getScreenCTM().inverse()`, so the letterbox
  offset is never computed by hand.
- `graph-page.js` no longer sets `width`/`height` from the viewBox (that
  was for natural size); it calls `attachPanZoom` after the render, before
  the tooltips.
- CSS: `.picture { flex: 1 1 auto; min-height: 0; overflow: hidden;
  cursor: grab; user-select: none; touch-action: none }`, `.dragging`
  swaps the cursor. The `svg .label` rule stays: Mermaid still measures
  labels outside the box.

## Tests

- `tests/engine/pan-zoom.test.mjs`, node:test like the staircase test:
  fit is a copy of home at scale 1; zooming ×2 about (500,250) in a
  2000×1000 home gives `{250,125,1000,500}` and the point stays at the
  same fraction across; ×3 then ×⅓ about one point returns home; the
  clamp holds at both ends and clamps about the same point; a further
  zoom at the clamp changes nothing; a pan moves the view against the
  drag.
- `tests/engine/graph-page.test.mjs` unchanged and still green: the
  import closure grows by `pan-zoom.js`, which imports nothing.
- Hand check in headless Chrome, as before: fit on load with the whole
  graph visible and the page not scrolling, wheel zooms about the cursor,
  drag pans, buttons work, scenarios scroll in their column, legend top
  right, tooltips and highlighting still bind, own-origin requests only, no
  console errors; at 1600×1300, 1440×900 and 800×1300.

## Docs and plan

- `.claude/plans/ai-tarot-v1.5-plan.md`: a changelog entry; M7's "the page
  checked by hand" gains nothing, this is layout.
- The "natural size, scrolled" comment in `graph.css` and the viewBox
  comment in `graph-page.js` go with the code they explained.

## Files

```
new      web/js/ui/pan-zoom.js
new      tests/engine/pan-zoom.test.mjs
modify   web/graph.html
modify   web/css/graph.css
modify   web/js/ui/graph-page.js
modify   .claude/plans/ai-tarot-v1.5-plan.md
```
