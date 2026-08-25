/**
 * Symbol pack loader.
 *
 * Takes any pack directory, not just this one -- "fork it, drop in your own
 * deck" means pointing this at another dir and nothing else changing. Paths are
 * resolved relative to the document, never from the site root, so the same code
 * works at http://localhost:8787/ and at https://user.github.io/ai-tarot/.
 */

const SCHEMA_VERSION = 3;

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

  const byId = new Map(deck.cards.map((card) => [card.card_id, card]));

  return {
    id: deck.pack_id,
    name: deck.name,
    positions: deck.positions,
    persona,
    cards: deck.cards,
    cardBackUrl: `${base}/${deck.card_back}`,
    card: (id) => byId.get(id),
    imageUrl: (card) => `${base}/${card.image}`,
    /** The meaning for a card in a position, falling back to the general sense. */
    meaning: (card, positionId) => card.meanings[positionId] || card.meanings.general,
  };
}
