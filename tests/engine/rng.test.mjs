import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRng, newSeed } from "../../web/js/engine/rng.js";
import { makeDeal, shuffle } from "../../web/js/engine/draw.js";

const IDS = Array.from({ length: 78 }, (_, i) => `card-${i}`);

test("the same seed yields the same stream", () => {
  const a = makeRng("moon-4f2a91");
  const b = makeRng("moon-4f2a91");
  const left = Array.from({ length: 20 }, a);
  const right = Array.from({ length: 20 }, b);
  assert.deepEqual(left, right);
});

test("different seeds diverge", () => {
  assert.notDeepEqual(
    Array.from({ length: 10 }, makeRng("moon-4f2a91")),
    Array.from({ length: 10 }, makeRng("moon-4f2a92")),
  );
});

test("values stay in [0, 1)", () => {
  const rng = makeRng("tower-000001");
  for (let i = 0; i < 5000; i += 1) {
    const v = rng();
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
});

test("a shuffle is a permutation, not a resample", () => {
  const shuffled = shuffle(IDS, makeRng("river-abc123"));
  assert.equal(shuffled.length, IDS.length);
  assert.deepEqual([...shuffled].sort(), [...IDS].sort());
  assert.notDeepEqual(shuffled, IDS, "shuffle returned the original order");
});

test("a seed reproduces the whole deal, which is the point of seeding", () => {
  const first = makeDeal(IDS, "star-777777");
  const second = makeDeal(IDS, "star-777777");
  assert.deepEqual(first.take(3), second.take(3));
  assert.deepEqual(first.take(1), second.take(1), "the 4th card must match too");
});

test("a session never deals the same card twice", () => {
  const deal = makeDeal(IDS, "hinge-123456");
  const drawn = [...deal.take(3), ...deal.take(1), ...deal.take(2)];
  assert.equal(new Set(drawn).size, drawn.length);
  assert.equal(deal.dealtCount, 6);
});

test("taking past the end of the pile runs out rather than repeating", () => {
  const deal = makeDeal(["a", "b"], "moon-000000");
  assert.equal(deal.take(5).length, 2);
  assert.deepEqual(deal.take(1), []);
});

test("generated seeds are readable and stable in shape", () => {
  assert.match(newSeed(0.5), /^[a-z]+-[0-9a-f]{6}$/);
  assert.equal(newSeed(0.5), newSeed(0.5));
});
