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
