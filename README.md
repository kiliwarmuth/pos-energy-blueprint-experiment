# POS Blueprint Leaderboard (Live via GitHub Pages)

This site shows runs uploaded to **Zenodo** that contain the keyword
`pos-blueprint:stress-energy`.

## How to appear here

1. Run the blueprint with `--publish` (requires a Zenodo token).
2. In the Zenodo record, add the keyword:
   `pos-blueprint:stress-energy`
   (or put the exact text into the description).
3. Open the leaderboard page and hit **Refresh**.

## Dev notes

- Static files live in `docs/`.
- Enable GitHub Pages: *Settings → Pages → Source: main /docs*.
- Client loads data directly from Zenodo’s public API.
