/**
 * "Turn it over. Which one is it?"
 *
 * The physical mode's one piece of UI. A position has just turned over in the
 * app; somewhere there is a real card face down on a real table, and this is
 * how the app finds out what it is.
 *
 * Built for a thumb before anything else: the filter takes focus, matching is
 * forgiving about how someone types a card's name, and the results are a list
 * of targets big enough to hit while holding a card in the other hand. A card
 * already on the table is not in the list -- the engine refuses it too, but
 * being unable to make the mistake beats being told about it.
 *
 * No cancel. The reading cannot go on without an answer, and a way out that
 * leaves the session waiting forever is not a way out.
 */

/** Fold a query and a card into the same shape, so "5 of cups" finds Five of Cups. */
const NUMBERS = {
  1: "ace", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven",
  8: "eight", 9: "nine", 10: "ten",
};

function normalise(text) {
  return String(text).toLowerCase()
    .replace(/\d+/g, (n) => NUMBERS[Number(n)] ?? n)
    .replace(/[^a-z]+/g, " ")
    .trim();
}

/** Every word of the query has to land somewhere, in any order. */
function matches(haystack, query) {
  return normalise(query).split(" ").filter(Boolean)
    .every((word) => haystack.includes(word));
}

export function makePicker(container, pack) {
  // Searchable text per card, built once: the name, and the id so the majors'
  // numbers and the suits are reachable by typing them.
  const searchable = new Map(pack.cards.map((card) =>
    [card.card_id, normalise(`${card.name} ${card.card_id}`)]));

  return {
    /**
     * Show the picker and resolve with the card they name.
     * @param {{position: string, taken: string[]}} request
     * @returns {Promise<string>}
     */
    ask({ position, taken }) {
      const label = pack.position(position)?.label ?? position;
      // The epilogue is unlabelled everywhere else until it turns, and this is
      // the moment it turns -- they are being asked to pick the card up.
      container.innerHTML = `
        <div class="picker-card">
          <p class="picker-lead">Turn over the <strong>${label}</strong> card.</p>
          <label class="picker-search">Which one is it?
            <input id="picker-filter" type="search" autocomplete="off"
                   placeholder="type any part of the name" enterkeyhint="done">
          </label>
          <ul id="picker-list" class="picker-list"></ul>
        </div>`;
      container.hidden = false;

      const filter = container.querySelector("#picker-filter");
      const list = container.querySelector("#picker-list");
      const available = pack.cards.filter((c) => !taken.includes(c.card_id));

      return new Promise((resolve) => {
        function render() {
          const query = filter.value.trim();
          const found = query
            ? available.filter((c) => matches(searchable.get(c.card_id), query))
            : available;
          list.innerHTML = "";
          for (const card of found) {
            const item = document.createElement("li");
            const button = document.createElement("button");
            button.type = "button";
            button.className = "picker-choice";
            button.textContent = card.name;
            button.addEventListener("click", () => {
              container.hidden = true;
              container.innerHTML = "";
              resolve(card.card_id);
            });
            item.append(button);
            list.append(item);
          }
          if (!found.length) {
            list.innerHTML = `<li class="picker-none">No card in the deck matches that.</li>`;
          }
        }

        filter.addEventListener("input", render);
        // Enter takes the only one left, which is what a filter narrowed to one
        // result is for. It does nothing while the list is still ambiguous.
        filter.addEventListener("keydown", (event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          const only = list.querySelectorAll(".picker-choice");
          if (only.length === 1) only[0].click();
        });
        render();
        filter.focus();
      });
    },

    /** The reading ended under it. Nothing is pending; just stop showing it. */
    close() {
      container.hidden = true;
      container.innerHTML = "";
    },
  };
}
