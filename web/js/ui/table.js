/**
 * The card table on the styled page.
 *
 * The whole spread is dealt face down at the start and cards turn over in
 * place, which is the topology the engine already produces -- this module is
 * the treatment of it, not a second opinion about it. It holds one element per
 * position and syncs them against tableau(); it decides nothing.
 *
 * Two faces per slot, both in the DOM, the back rotated away from the front.
 * That is what lets the turn be a rotation of one element rather than a swap of
 * two images, and it is the whole reason there is a module here at all: the
 * debug page can redraw its spread from scratch on every flip because nothing
 * is moving, and this one cannot.
 */

import { tableau } from "../engine/state.js";

export function makeTable(container, pack) {
  /** Slot elements by position id, built once per deal. */
  const slots = new Map();

  function build(slot, index) {
    const position = pack.position(slot.position);
    const figure = document.createElement("figure");
    figure.className = "slot";
    // The stagger for the opening deal. One custom property, so the timing is
    // a CSS decision and this file does not own any of it.
    figure.style.setProperty("--i", index);
    figure.innerHTML = `
      <div class="card">
        <img class="back" src="${pack.cardBackUrl}" alt="a card, face down">
        <img class="front" alt="" hidden>
      </div>
      <figcaption>
        <span class="card-name"></span>
        <span class="position-label">${
          // The fourth one is deliberately unlabelled: naming it "epilogue"
          // before it turns tells someone there is a bonus card to play for,
          // and a card played for is not a card earned.
          slot.epilogue ? "·" : position?.label ?? slot.position}</span>
      </figcaption>`;
    return figure;
  }

  return {
    /** Every position, face down, before a word is said. */
    deal(session) {
      container.innerHTML = "";
      slots.clear();
      for (const [index, slot] of tableau(session).entries()) {
        const figure = build(slot, index);
        slots.set(slot.position, figure);
        container.append(figure);
      }
    },

    /**
     * Turn over whatever the reading has earned since the last call.
     *
     * Reads tableau() and syncs, so it is idempotent and safe to call on any
     * event. A card that never turns -- an unearned fourth through the farewell
     * -- simply never appears here, because tableau() never calls it face up.
     */
    turn(session) {
      for (const slot of tableau(session)) {
        const figure = slots.get(slot.position);
        if (!figure || !slot.face_up || figure.classList.contains("up")) continue;
        const card = pack.card(slot.card_id);
        const front = figure.querySelector(".front");
        front.src = pack.imageUrl(card);
        // No caption describing the picture. A printed description is something
        // to agree with, and agreeing is not projecting -- whatever they say
        // about the card should come from looking at it, not from reading a
        // sentence about it. The line survives as alt text, where it belongs.
        front.alt = card.imagery_line;
        front.hidden = false;
        figure.querySelector(".card-name").textContent = card.name;
        // The fourth card gets its name now that it has turned. Withholding the
        // label was about not advertising a bonus card in advance; a card face
        // up on the table is a card that has been earned, and it can be called
        // what the pack calls it.
        figure.querySelector(".position-label").textContent =
          pack.position(slot.position)?.label ?? slot.position;
        figure.classList.add("up");
      }
    },
  };
}
