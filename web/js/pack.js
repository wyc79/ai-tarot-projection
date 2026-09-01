/**
 * Symbol pack loader.
 *
 * Takes any pack directory, not just this one -- "fork it, drop in your own
 * deck" means pointing this at another dir and nothing else changing. Paths are
 * resolved relative to the document, never from the site root, so the same code
 * works at http://localhost:8787/ and at
 * https://wyc79.github.io/ai-tarot-projection/.
 */

const SCHEMA_VERSION = 6;

/**
 * @param {string} packDir  pack root, relative to the document
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]  swappable so tests can load a pack
 *   from disk and exercise this loader rather than a stand-in for it
 */
export async function loadPack(packDir = "data", { fetchImpl = fetch } = {}) {
  const base = packDir.replace(/\/$/, "");
  const response = await fetchImpl(`${base}/deck.json`);
  if (!response.ok) throw new Error(`no pack at ${base}/deck.json (${response.status})`);

  const deck = await response.json();
  if (deck.schema_version !== SCHEMA_VERSION) {
    throw new Error(`pack schema ${deck.schema_version}, expected ${SCHEMA_VERSION}`);
  }

  // The persona prompt is pack data, not code: editing it is a file save
  // locally and a Pages deploy when hosted. No relay is involved either way.
  const persona = await fetchImpl(`${base}/${deck.persona}`).then((r) => {
    if (!r.ok) throw new Error(`pack declares ${deck.persona} but it is missing`);
    return r.text();
  });

  // Few-shots are pack data too: how the reader sounds is content, and changing
  // it should not mean changing code.
  const fewShots = await fetchImpl(`${base}/${deck.few_shots}`).then((r) => {
    if (!r.ok) throw new Error(`pack declares ${deck.few_shots} but it is missing`);
    return r.json();
  }).then((body) => body.few_shots);

  const byId = new Map(deck.cards.map((card) => [card.card_id, card]));

  return {
    id: deck.pack_id,
    name: deck.name,
    positions: deck.positions,
    // The earned fourth card, and deliberately not a fourth entry in positions:
    // the spread is three, and this one only exists if a session goes past its
    // own ending. A pack that does not define one simply cannot deal it.
    epilogue: deck.epilogue ?? null,
    /** Any position by id, the epilogue included. */
    position: (id) => (deck.epilogue?.id === id ? deck.epilogue
      : deck.positions.find((p) => p.id === id)),
    // The scaffolding ladder, low to high. Array order is the ordering: the
    // engine does index arithmetic on it and knows nothing else about levels.
    levels: deck.levels,
    level: (id) => deck.levels.find((l) => l.id === id),
    persona,
    fewShots,
    // The two things said before any model is called: what this is, and the
    // question that starts it. Pack data rather than an instruction to write
    // them, because they are fixed content -- and the honesty line in
    // particular is a statement of fact about the app, not something the
    // reader should be asked to improvise in character.
    opening: deck.opening,
    cards: deck.cards,
    cardBackUrl: `${base}/${deck.card_back}`,
    card: (id) => byId.get(id),
    imageUrl: (card) => `${base}/${card.image}`,
    /** The meaning for a card in a position, falling back to the general sense. */
    meaning: (card, positionId) => card.meanings[positionId] || card.meanings.general,
  };
}
