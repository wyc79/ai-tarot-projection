import { test } from "node:test";
import assert from "node:assert/strict";
import { STORAGE_VERSION, makeStorage, memoryBackend } from "../../web/js/storage.js";

const store = () => makeStorage(memoryBackend());

test("round-trips structured values", () => {
  const s = store();
  s.set("session", { seed: "moon-4f2a91", cards: [{ card_id: "major-00-fool" }] });
  assert.equal(s.get("session").cards[0].card_id, "major-00-fool");
});

test("missing keys return the fallback rather than throwing", () => {
  assert.equal(store().get("nothing"), null);
  assert.equal(store().get("nothing", "default"), "default");
});

test("keys are prefixed on the backend but not in the API", () => {
  const backend = memoryBackend();
  const s = makeStorage(backend);
  s.set("apikey", "x");
  assert.equal(backend.getItem("tarot:apikey"), '{"v":1,"data":"x"}');
  assert.deepEqual(s.keys(), ["apikey"]);
});

test("other apps' keys on the same origin are ignored", () => {
  const backend = memoryBackend();
  backend.setItem("someone-elses-key", "value");
  assert.deepEqual(makeStorage(backend).keys(), []);
});

test("a value from another schema version is treated as absent", () => {
  const backend = memoryBackend();
  backend.setItem("tarot:session", JSON.stringify({ v: STORAGE_VERSION + 1, data: { seed: "x" } }));
  assert.equal(makeStorage(backend).get("session"), null, "a stale session must not load");
});

test("corrupt JSON is treated as absent rather than crashing the reading", () => {
  const backend = memoryBackend();
  backend.setItem("tarot:session", "{not json");
  assert.equal(makeStorage(backend).get("session"), null);
});

test("a backend that refuses writes reports failure instead of throwing", () => {
  const full = { ...memoryBackend(), setItem: () => { throw new Error("QuotaExceededError"); } };
  assert.equal(makeStorage(full).set("session", { big: true }), false);
});

test("memory mode reports itself as non-persistent", () => {
  assert.equal(store().persistent, false, "the key UI has to be able to say 'gone on refresh'");
});

test("clearAll removes this app's keys and nothing else", () => {
  const backend = memoryBackend();
  backend.setItem("unrelated", "keep me");
  const s = makeStorage(backend);
  s.set("a", 1);
  s.set("b", 2);
  s.clearAll();
  assert.deepEqual(s.keys(), []);
  assert.equal(backend.getItem("unrelated"), "keep me");
});
