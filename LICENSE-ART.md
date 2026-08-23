# Card art provenance

The 78 card images plus a card back in `data/Cards-jpg/` (300×527 JPEG, ~52 KB
each, 3.4 MB total) are scans of the Smith-Waite deck first published by
William Rider & Son in 1909, illustrated by Pamela Colman Smith. The 1909
edition is in the public domain in the United States and in countries with a
life-plus-70 term (Smith died in 1951).

## TODO: record where these files came from

**Owner: Yuanchen.** The images were already in the repo when this milestone
started, so their exact source is not known here and has not been guessed. Fill
in before the repo goes public:

- Source (URL of the repo, set, or scan collection):
- License stated by that source:
- Date obtained:

Candidate sources, if it turns out to be one of them — each has a different
licence statement worth quoting exactly:

- <https://github.com/mixvlad/TarotCards> — downloads from Wikimedia Commons and
  verifies the licence per file
- <https://luciellaes.itch.io/rider-waite-smith-tarot-cards-cc0> — CC0
  restoration, card backs included
- <https://github.com/metabismuth/tarot-json> — JSON dataset plus 350×600 images
- Wikimedia Commons, "Rider–Waite tarot deck" categories — the canonical 1909
  scans (Pam-A, Roses & Lilies, Holly Voley)

## Naming

The deck is called **Smith-Waite (1909)** in the app and in `data/deck.json`.
US Games Systems holds trademarks around the "Rider-Waite" branding; the
public-domain status of the 1909 artwork is a separate question from the name
used to advertise it, so the app uses the artist-first name.

## Card meanings

`data/deck.json`'s imagery lines and per-position meanings are written for this
project. Waite's "Pictorial Key to the Tarot" (1911, public domain) was the raw
material, reached through `scripts/sources/ekelen-card_data.json` from
<https://github.com/ekelen/tarot-api> (MIT), vendored for reproducible builds.
No text from that dataset ships in `deck.json`.
