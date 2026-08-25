import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { staircaseSvg } from "../../web/js/ui/staircase.js";
import { realPack } from "./helpers.mjs";

const c145c7 = async () =>
  JSON.parse(await readFile(new URL("../fixtures/thread-c145c7.json", import.meta.url), "utf8")).session;

test("the map draws what the scanner reports, from the exchanges alone", async () => {
  const svg = staircaseSvg(await c145c7(), await realPack());
  assert.match(svg, /^<svg /);
  assert.equal((svg.match(/class="violation"/g) ?? []).length, 1, "turn 3, and only turn 3");
  assert.equal((svg.match(/class="drop"/g) ?? []).length, 1, "the one deflection");
  // Two cards, but the first is dealt rather than earned, so one rule.
  assert.equal((svg.match(/class="flip"/g) ?? []).length, 1);
  assert.match(svg, /crossed to life and climbed to consequences/);
});

test("every rung of the pack's ladder gets a row, in order, high at the top", async () => {
  const pack = await realPack();
  const svg = staircaseSvg(await c145c7(), pack);
  const rows = [...svg.matchAll(/class="rung"[^>]*>([a-z]+)</g)].map((m) => m[1]);
  assert.deepEqual(rows, [...pack.levels].reverse().map((l) => l.id));
});

test("it draws nothing before anything has been asked", async () => {
  const pack = await realPack();
  assert.equal(staircaseSvg({ exchanges: [], cards: [] }, pack), "");
  assert.equal(staircaseSvg({
    exchanges: [{ q: "anything you want to look at?", a: "no", position: "opening" }], cards: [],
  }, pack), "", "the opening turn is not on the ladder");
});

test("the user's own words are escaped, since they land in markup", async () => {
  const pack = await realPack();
  const svg = staircaseSvg({
    cards: [{ card_id: "major-00-fool", position: "situation" }],
    exchanges: [{ q: "What do you see?", a: "<script>alert(1)</script> & \"quotes\"",
                  position: "situation", disclosure_depth: 2,
                  gate: { user_level: "name", has_life_content: false } }],
  }, pack);
  assert.ok(!svg.includes("<script>"), "a transcript is untrusted text like any other");
  assert.match(svg, /&lt;script&gt;/);
});
