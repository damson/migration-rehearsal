# Social preview

`preview.png` is the card GitHub shows when this repository is linked from
anywhere else, and the banner at the top of the main README. It is 1280x640,
which is the size GitHub crops from.

Uploading it is a manual step, because there is no REST endpoint for the social
preview: **Settings > General > Social preview > Upload an image.** The README
picks the file up from here automatically.

## Re-rendering it

`card.html` is the source. It is self-contained apart from its webfonts, so
editing the wording is editing that file:

```sh
python3 -m http.server 8080 --directory .github/social-preview
# then screenshot the page at exactly 1280x640, no device scaling
```

Any headless browser will do it. The card is sized in CSS pixels, so capture at
a device pixel ratio of 1 and the output is 1280x640 with no resampling.

## What it is showing

Two things at once, which is the point of it.

The trace along the top is the mechanism: the migration climbs as it is applied
against real rows, then drops and lands exactly on the baseline it left. The two
dotted verticals are the savepoint and the rollback. Nothing is kept.

The table underneath is the measurement from the article, and it is the reason
any of this is worth doing: the same four migrations, once against an empty
container and once against real rows. Three of the four pass in CI and fail on
data.

**The numbers in it are real** and they come from the article's own measurement,
so if that table is ever corrected, this card is part of the correction.
