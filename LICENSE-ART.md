# Card art provenance

`data/Cards-jpg/` holds 79 files (300×527 JPEG, 26–60 KB each, 43 KB mean,
3.4 MB total), and they are two different things with two different answers.

**The 78 cards** are scans of the Smith-Waite deck first published by William
Rider & Son in 1909, illustrated by Pamela Colman Smith, cleaned up and resized
by a third party. The 1909 edition is in the public domain in the United States
and in countries with a life-plus-70 term (Smith died in 1951).

**`CardBacks.jpg` is not a 1909 scan.** It is an original design drawn by the
pack's author, who released it under CC0. Age has nothing to do with why it is
free to use, so it does not travel on the 1909 argument above and is listed
separately below.

## Where these files came from

Source: **"Rider-Waite Smith Tarot Cards (CC0)" by luciellaes**,
<https://luciellaes.itch.io/rider-waite-smith-tarot-cards-cc0> — the
`Cards-jpg.zip` download, whose name this directory still carries. The pack also
ships `Cards-png.zip` (rounded corners, 20 MB) and a `cardBorder.png`; neither
is used here.

Licence, in that page's own words, and quoted rather than summarised because the
two halves are not the same claim:

> I have personally assessed that the original Rider-Waite Smith tarot
> illustrations are within the public domain according to my own country's
> copyright laws (Australia). Please make your own assessment for your use case
> and your country. I am also happy to release rights to the included cardback
> design under CC0 (it took about 2 minutes with the multi-brush tool, so no big
> loss!).

and on what the card images are:

> The cards are scans of the original Rider-Waite Smith deck, sourced from
> Wikipedia and then cleaned up (slightly) and resized by me, with a small black
> border added.

So the CC0 in the pack's title is an explicit grant over the cardback only. For
the 78 cards it is one person's reading of Australian law, offered as such —
this project does not rest on it, and makes the 1909 publication argument above
on its own account. That argument is about the artwork, not about the scan: a
faithful photographic reproduction of a public-domain flat work attracts no new
copyright in the US (*Bridgeman v. Corel*) or under the EU's 2019 Article 14,
and the pack's own edits are a resize and a black border.

Date obtained: on or before **2026-08-23**, when they arrive whole in `f1230cb`,
the commit that added the pack scaffold. Nothing earlier is in the history.

How this was established, since it was an open question for a while and the
answer should not have to be taken on trust: the three preview images on that
itch.io page are **byte-identical** to `02-TheHighPriestess.jpg`,
`03-TheEmpress.jpg` and `CardBacks.jpg` here — same MD5, not merely the same
picture. The page also states the set is 300×527, which is the exact size of all
79 files. Two other candidates were ruled out on the way: `mixvlad/TarotCards`
is 1086×1810 at a different aspect ratio, and `metabismuth/tarot-json` is
350×600 under different filenames.

It also explains the one structural oddity in the directory. The 78 cards carry
an HP-authored `sRGB IEC61966-2.1` ICC profile and `CardBacks.jpg` carries a
littleCMS `sRGB-elle-V2-srgbtrc.icc` one — a clean 78/1 split, because the cards
passed through someone's photo pipeline and the back was drawn from scratch in a
paint program.

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
