"""Build the structural scaffold for data/deck.json.

Maps the 78 card images in data/Cards-jpg/ to stable card_ids and display names,
and pre-fills content fields from Waite's 1909 "Pictorial Key" text (vendored in
scripts/sources/ekelen-card_data.json, from github.com/ekelen/tarot-api, MIT).

The pre-filled text is raw material, not shippable content. Waite is verbose,
interpretive where we want neutral description, and mixes upright and reversed
readings into one list. imagery_line and meanings are meant to be rewritten by
hand afterwards; the per-position meanings are left empty so validate_deck.py
fails until someone does it.

deck.json is the source of truth once written. This script refuses to overwrite
it without --force, because doing so would discard the hand-authored content.

    python3 scripts/build_deck.py --out data/deck.json
"""

import argparse
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, "scripts", "sources", "ekelen-card_data.json")
CARDS_DIR = os.path.join(ROOT, "data", "Cards-jpg")

SUITS = {"wa": "Wands", "cu": "Cups", "pe": "Pentacles", "sw": "Swords"}
RANKS = {
    1: "Ace", 2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six", 7: "Seven",
    8: "Eight", 9: "Nine", 10: "Ten", 11: "Page", 12: "Knight", 13: "Queen",
    14: "King",
}
SMALL_WORDS = {"of", "the", "and"}

# The three-card spread, as the pack defines it. Each position's arc_role is what
# the reader bends the user's projection toward.
POSITIONS = [
    {"id": "situation", "label": "Situation", "arc_role": "setup",
     "prompt_hint": "where things stand right now"},
    {"id": "obstacle", "label": "Obstacle", "arc_role": "tension",
     "prompt_hint": "what is in the way, or what the pull is against"},
    {"id": "advice", "label": "Advice", "arc_role": "resolution",
     "prompt_hint": "where this could land, and what to do with it"},
]


def title_from_filename(stem):
    """'10-WheelOfFortune' -> 'Wheel of Fortune'."""
    words = re.findall(r"[A-Z][a-z]*", stem.split("-", 1)[1])
    out = [words[0]]
    out += [w.lower() if w.lower() in SMALL_WORDS else w for w in words[1:]]
    return " ".join(out)


def slug(name):
    """'The High Priestess' -> 'high-priestess'."""
    s = re.sub(r"^the\s+", "", name.lower())
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def first_sentence(text):
    """Waite's first descriptive sentence, as a starting point for rewriting."""
    text = re.sub(r"\s+", " ", text).strip()
    parts = re.split(r"(?<=[.;])\s+", text)
    return parts[0].strip() if parts else ""


def keywords(meaning_up):
    """Waite's upright keywords up to the first semicolon."""
    return re.sub(r"\s+", " ", meaning_up).split(";")[0].strip().rstrip(".")


def index_images():
    """Filename lookups: majors by number, minors by (suit, rank)."""
    majors, minors = {}, {}
    for fn in sorted(os.listdir(CARDS_DIR)):
        if not fn.endswith(".jpg"):
            continue
        stem = fn[:-4]
        m = re.match(r"^(\d{2})-(.+)$", stem)
        if m:
            majors[int(m.group(1))] = fn
            continue
        m = re.match(r"^(Wands|Cups|Pentacles|Swords)(\d{2})$", stem)
        if m:
            minors[(m.group(1), int(m.group(2)))] = fn
    return majors, minors


def build():
    cards_in = json.load(open(SOURCE))["cards"]
    majors, minors = index_images()
    out = []

    for c in cards_in:
        if c["type"] == "major":
            n = c["value_int"]
            fn = majors.get(n)
            if not fn:
                sys.exit("no image for major %d (%s)" % (n, c["name"]))
            # Display names come from the printed card titles, not from Waite:
            # the 1909 deck reads STRENGTH and JUDGEMENT where he wrote
            # "Fortitude" and "The Last Judgment".
            name = title_from_filename(fn[:-4])
            card_id = "major-%02d-%s" % (n, slug(name))
        else:
            suit = SUITS[c["name_short"][:2]]
            n = c["value_int"]
            fn = minors.get((suit, n))
            if not fn:
                sys.exit("no image for %s %d" % (suit, n))
            name = "%s of %s" % (RANKS[n], suit)
            card_id = "%s-%02d-%s" % (suit.lower(), n, RANKS[n].lower())

        out.append({
            "card_id": card_id,
            "name": name,
            "image": "Cards-jpg/%s" % fn,
            # Raw Waite, to be rewritten by hand.
            "imagery_line": first_sentence(c["desc"]),
            "meanings": {
                "situation": "",
                "obstacle": "",
                "advice": "",
                "general": keywords(c["meaning_up"]),
            },
        })

    out.sort(key=lambda c: (c["card_id"].split("-")[0] != "major", c["card_id"]))
    return {
        "schema_version": 2,
        "pack_id": "smith-waite-1909",
        "name": "Smith-Waite (1909)",
        "card_back": "Cards-jpg/CardBacks.jpg",
        "persona": "persona.md",
        "positions": POSITIONS,
        "cards": out,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "deck.json"))
    ap.add_argument("--force", action="store_true",
                    help="overwrite an existing deck.json, discarding hand-authored content")
    args = ap.parse_args()

    if os.path.exists(args.out) and not args.force:
        sys.exit("%s exists; refusing to discard authored content (use --force)" % args.out)

    deck = build()
    with open(args.out, "w") as f:
        json.dump(deck, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("wrote %d cards to %s" % (len(deck["cards"]), args.out))


if __name__ == "__main__":
    main()
