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
  // One ring, both faults named: it crossed off a single answer about a picture,
  // and climbed a rung while doing it.
  assert.match(svg, /crossed off 1 answer on this card; crossed to life and climbed to consequences/);
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

test("the question you are being asked is on the map before you answer it", async () => {
  const pack = await realPack();
  const session = await c145c7();
  const settled = staircaseSvg(session, pack);
  // The turn that hangs unanswered at the end of c145c7, which is the one turn
  // a diagram built from exchanges alone can never show.
  const pending = session.cards.at(-1).ai_reading;
  const live = staircaseSvg(session, pack, { pending });

  assert.ok(live.length > settled.length);
  assert.match(live, /class="q-card pending"/);
  assert.match(live, /waiting on you/);
  assert.equal((live.match(/class="drop"/g) ?? []).length,
               (settled.match(/class="drop"/g) ?? []).length,
               "a question nobody has answered is not a deflection");
});

test("a question that reaches too far is ringed while it is still pending", async () => {
  const pack = await realPack();
  const session = {
    cards: [{ card_id: "major-02-high-priestess", position: "situation" }],
    exchanges: [{ q: "What does she look like she's pointing at for you?", a: "a woman in blue",
                  position: "situation", question_type: "projection", disclosure_depth: 2,
                  gate: { user_level: "name", has_life_content: false } }],
  };
  const live = staircaseSvg(session, pack, { pending: "What were you hoping for, before it went this way?" });
  assert.match(live, /class="violation"/, "asked at intentions from name, and you can see it now");
});

test("a flip that cuts through a first disclosure is drawn as the violation it is", async () => {
  const pack = await realPack();
  const session = await c145c7();
  const river = JSON.parse(await readFile(
    new URL("../fixtures/river-89c1fb.json", import.meta.url), "utf8")).session;
  river.exchanges[2].gate.hedged = true;

  const svg = staircaseSvg(river, pack);
  assert.equal((svg.match(/class="arrival"/g) ?? []).length, 1, "the moment it found them");
  assert.match(svg, /on-disclosure/, "and the flip line through the same column");
  assert.match(svg, /turned over on the turn they first said something of their own/);
  assert.match(svg, /class="hedge"/, "and the question mark they put on it");

  // c145c7 never got a disclosure at all, so it has neither.
  const flat = staircaseSvg(session, pack);
  assert.ok(!/class="arrival"/.test(flat));
  assert.ok(!/on-disclosure/.test(flat));
});
