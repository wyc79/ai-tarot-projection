"""Validate a symbol pack against the pack schema.

Run against any pack dir, not just this one -- "fork it, drop in your own deck"
only works if forks can check themselves:

    python3 scripts/validate_deck.py [pack_dir]

Exits non-zero and lists every problem found.
"""

import json
import os
import sys

SCHEMA_VERSION = 5
REQUIRED_POSITIONS = ["situation", "obstacle", "advice"]
MEANING_KEYS = REQUIRED_POSITIONS + ["general"]
EXPECTED_CARDS = 78
IMAGERY_MAX = 160  # one line, not a paragraph
DETAILS_MIN = 3    # fewer than three and the reader has nothing to recognise
DETAIL_MAX = 140   # one observation each, not a paragraph


def nonempty_str(v):
    return isinstance(v, str) and v.strip() != ""


def validate(pack_dir):
    problems, warnings = [], []
    deck_path = os.path.join(pack_dir, "deck.json")
    if not os.path.exists(deck_path):
        return ["no deck.json in %s" % pack_dir], []

    try:
        deck = json.load(open(deck_path))
    except json.JSONDecodeError as e:
        return ["deck.json is not valid JSON: %s" % e], []

    if deck.get("schema_version") != SCHEMA_VERSION:
        problems.append("schema_version must be %d, got %r"
                        % (SCHEMA_VERSION, deck.get("schema_version")))
    for key in ("pack_id", "name", "card_back", "persona", "few_shots"):
        if not nonempty_str(deck.get(key)):
            problems.append("missing or empty top-level %r" % key)

    for key in ("card_back", "persona", "few_shots"):
        ref = deck.get(key, "")
        if nonempty_str(ref) and not os.path.exists(os.path.join(pack_dir, ref)):
            problems.append("%s file not found: %s" % (key, ref))

    shots_ref = deck.get("few_shots", "")
    shots_path = os.path.join(pack_dir, shots_ref) if nonempty_str(shots_ref) else None
    if shots_path and os.path.exists(shots_path):
        try:
            shots = json.load(open(shots_path)).get("few_shots")
        except json.JSONDecodeError as e:
            shots, _ = None, problems.append("%s is not valid JSON: %s" % (shots_ref, e))
        if not isinstance(shots, list) or not 3 <= len(shots) <= 8:
            problems.append("few_shots must hold 3 to 8 exchanges, got %r"
                            % (len(shots) if isinstance(shots, list) else shots))
        else:
            for i, shot in enumerate(shots):
                for key in ("demonstrates", "position", "card", "user", "reader"):
                    if not nonempty_str(shot.get(key)):
                        problems.append("few_shot %d: missing or empty %r" % (i, key))
                if shot.get("position") not in REQUIRED_POSITIONS:
                    problems.append("few_shot %d: unknown position %r" % (i, shot.get("position")))

    # The scaffolding ladder. Order is meaning here: the engine steps up it by
    # index, so a pack that lists the levels in the wrong order is a pack whose
    # questions climb in the wrong direction.
    levels = deck.get("levels")
    level_ids = []
    if not isinstance(levels, list) or len(levels) < 2:
        problems.append("levels must be a list of at least 2, low to high")
    else:
        level_ids = [l.get("id") for l in levels]
        if len(set(level_ids)) != len(level_ids):
            problems.append("level ids must be unique, got %r" % (level_ids,))
        for i, level in enumerate(levels):
            for key in ("id", "asks", "gloss"):
                if not nonempty_str(level.get(key)):
                    problems.append("level %d: missing or empty %r" % (i, key))
            exemplars = level.get("exemplars")
            if not isinstance(exemplars, list) or not 2 <= len(exemplars) <= 3:
                problems.append("level %r: exemplars must be 2 or 3 questions"
                                % level.get("id"))
            elif not all(nonempty_str(e) and e.strip().endswith("?") for e in exemplars):
                problems.append("level %r: every exemplar is one question, ending in ?"
                                % level.get("id"))

    positions = deck.get("positions")
    if not isinstance(positions, list) or len(positions) != len(REQUIRED_POSITIONS):
        problems.append("positions must be a list of %d" % len(REQUIRED_POSITIONS))
    else:
        ids = [p.get("id") for p in positions]
        if ids != REQUIRED_POSITIONS:
            problems.append("position ids must be %r, got %r" % (REQUIRED_POSITIONS, ids))
        for p in positions:
            for key in ("label", "arc_role", "prompt_hint"):
                if not nonempty_str(p.get(key)):
                    problems.append("position %r: missing or empty %r" % (p.get("id"), key))
            moves = p.get("moves")
            if not isinstance(moves, list) or not moves or not all(nonempty_str(m) for m in moves):
                problems.append("position %r: moves must be a non-empty list of names"
                                % p.get("id"))
            if level_ids and p.get("ceiling") not in level_ids:
                problems.append("position %r: ceiling %r is not one of the levels %r"
                                % (p.get("id"), p.get("ceiling"), level_ids))
        if level_ids:
            # The arc and the staircase are the same shape: a later position may
            # reach higher than an earlier one, never lower.
            heights = [level_ids.index(p["ceiling"]) for p in positions
                       if p.get("ceiling") in level_ids]
            if heights != sorted(heights):
                problems.append("position ceilings must not descend across the spread, got %r"
                                % ([p.get("ceiling") for p in positions],))

    cards = deck.get("cards")
    if not isinstance(cards, list):
        return problems + ["cards must be a list"], warnings
    if len(cards) != EXPECTED_CARDS:
        problems.append("expected %d cards, got %d" % (EXPECTED_CARDS, len(cards)))

    seen_ids, seen_images = set(), set()
    for i, card in enumerate(cards):
        where = card.get("card_id") or "card index %d" % i

        for key in ("card_id", "name", "image", "imagery_line"):
            if not nonempty_str(card.get(key)):
                problems.append("%s: missing or empty %r" % (where, key))

        cid = card.get("card_id")
        if cid in seen_ids:
            problems.append("duplicate card_id: %s" % cid)
        seen_ids.add(cid)

        image = card.get("image", "")
        if nonempty_str(image):
            if image.startswith("/"):
                problems.append("%s: image path must be relative (subpath-safe): %s"
                                % (where, image))
            elif not os.path.exists(os.path.join(pack_dir, image)):
                problems.append("%s: image not found: %s" % (where, image))
            if image in seen_images:
                problems.append("%s: image reused: %s" % (where, image))
            seen_images.add(image)

        line = card.get("imagery_line", "")
        if nonempty_str(line) and len(line) > IMAGERY_MAX:
            warnings.append("%s: imagery_line is %d chars (max %d)"
                            % (where, len(line), IMAGERY_MAX))

        details = card.get("details")
        if not isinstance(details, list) or len(details) < DETAILS_MIN:
            problems.append("%s: needs at least %d details, got %r"
                            % (where, DETAILS_MIN,
                               len(details) if isinstance(details, list) else details))
        else:
            for detail in details:
                if not nonempty_str(detail):
                    problems.append("%s: empty detail line" % where)
                elif len(detail) > DETAIL_MAX:
                    warnings.append("%s: detail is %d chars (max %d)"
                                    % (where, len(detail), DETAIL_MAX))

        meanings = card.get("meanings")
        if not isinstance(meanings, dict):
            problems.append("%s: meanings must be an object" % where)
            continue
        for key in MEANING_KEYS:
            if not nonempty_str(meanings.get(key)):
                problems.append("%s: missing or empty meanings.%s" % (where, key))
        for key in meanings:
            if key not in MEANING_KEYS:
                problems.append("%s: unexpected meanings.%s" % (where, key))

    return problems, warnings


def main():
    pack_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
    problems, warnings = validate(pack_dir)

    for w in warnings:
        print("warn: %s" % w)
    if problems:
        for p in problems:
            print("fail: %s" % p)
        print("\n%d problem(s) in %s" % (len(problems), pack_dir))
        sys.exit(1)
    print("ok: %s validates against pack schema v%d (%d warnings)"
          % (pack_dir, SCHEMA_VERSION, len(warnings)))


if __name__ == "__main__":
    main()
