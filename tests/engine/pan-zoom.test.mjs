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
