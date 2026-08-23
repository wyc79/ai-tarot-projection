/**
 * Symbol pack loader.
 *
 * Takes any pack directory, not just this one -- "fork it, drop in your own
 * deck" means pointing this at another dir and nothing else changing. Paths are
 * resolved relative to the document, never from the site root, so the same code
 * works at http://localhost:8787/ and at https://user.github.io/ai-tarot/.
 */

const SCHEMA_VERSION = 1;

export async function loadPack(packDir = "data") {
  const base = packDir.replace(/\/$/, "");
  const response = await fetch(`${base}/deck.json`);
  if (!response.ok) throw new Error(`no pack at ${base}/deck.json (${response.status})`);

  const deck = await response.json();
  if (deck.schema_version !== SCHEMA_VERSION) {
    throw new Error(`pack schema ${deck.schema_version}, expected ${SCHEMA_VERSION}`);
  }

  const byId = new Map(deck.cards.map((card) => [card.card_id, card]));

  return {
    id: deck.pack_id,
    name: deck.name,
    positions: deck.positions,
    cards: deck.cards,
    cardBackUrl: `${base}/${deck.card_back}`,
    card: (id) => byId.get(id),
    imageUrl: (card) => `${base}/${card.image}`,
    /** The meaning for a card in a position, falling back to the general sense. */
    meaning: (card, positionId) => card.meanings[positionId] || card.meanings.general,
  };
}
