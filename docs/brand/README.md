# MobileTavern brand assets

The fork's identity: **Momo-chan** (the mascot, supplied art) inside a gold medallion,
hung with a rustic tankard charm; a standalone rustic tankard for small icon sizes.

## Palette

| Role | Hex |
|---|---|
| Ink (backgrounds) | `#141019` / `#1d1425` / `#100b16` |
| Tavern gold | `#e8b563` |
| Candlelight cream | `#f4ead9` |
| Amber (accents, foam dots) | `#c98a3c` |
| Wood | `#9a6540` → `#5d371f` |
| Iron | `#6f645b` → `#332d29` |

Typography: **Playfair Display** (wordmark + home screen), **Inter** (small labels).
Ink: `#141019` is the boot-screen backdrop, independent of the user's theme.

## The marks

| File | What | Where it is used |
|---|---|---|
| `mark-medallion.svg` | Momo medallion, rings + warm glow, **no charm** | `public/img/logo.png` (square, 512²) → home hero (round 56px badge, `object-fit: cover`), `login.html` (30px), `welcomePanel.html` |
| `mark-medallion-charm.svg` | medallion **+ rustic tankard on a chain** | `public/img/mt-logo-charm.png` → boot screen mark (`#preloader` + app-init splash) |
| `mark-rustic-tankard.svg` | the tankard alone (wood staves, riveted iron hoops, wrought-iron handle, foam that doubles as a speech bubble) | `public/img/mt-tankard.png`, and the app icons |

Why two logos: the home hero crops `logo.png` into a **circle with `object-fit: cover`**, so
anything hanging below the medallion (the charm) would be clipped there. The charm version
is used only where we control the box — the boot screen. And the medallion goes muddy at
32px while the tankard still reads as a frothy mug, so the tankard carries the small sizes.

## Generated files (checked in — regenerate only when the marks change)

- `public/img/logo.png` — medallion, 512², transparent
- `public/img/mt-logo-charm.png` — medallion + charm, 424 wide, transparent
- `public/img/mt-tankard.png` — tankard, 512 wide, transparent
- `public/img/mt-appicon-512.png` — tankard on the ink tile, 512²
- `public/img/apple-icon-{57,72,114,144,192,512}.png` — tankard on ink tile, opaque
- `public/favicon.ico` — 16/32/48, tankard on ink tile

## Regenerating

```bash
mkdir -p ~/.cache/logo/fonts && cd ~/.cache/logo/fonts
for f in "ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf" \
         "ofl/cinzel/Cinzel%5Bwght%5D.ttf" \
         "ofl/inter/Inter%5Bopsz,wght%5D.ttf"; do
  curl -sL -o "$(basename "$f" | sed 's/%5B.*//').ttf" "https://raw.githubusercontent.com/google/fonts/main/$f"
done
cd ~/.cache/logo && npm init -y && npm i @resvg/resvg-js jquery jsdom   # jsdom/jquery only for the boot harness
cp <this-dir>/mt-logo-assets.mjs . && node mt-logo-assets.mjs
```

`mt-logo-concepts.mjs` is the exploration file that produced the candidates (three marks,
comparison sheets, boot-screen mocks) — keep it if you want to iterate on the direction.

### Pitfalls learned the hard way

- **Do not nest an `<svg>` inside an `<svg>` to place a mark.** The inner `viewBox` re-maps
  the coordinates on top of the outer transform and the mark lands huge and clipped. Place
  the mark in its own coordinate space with `translate() scale() translate(-cx -cy)` using the
  mark's visual bbox **including stroke bleed** (the tankard's handle stroke pushes the right
  edge out by half its width).
- **Raw `&` in SVG text is a hard parse error** (`malformed entity reference`) — resvg refuses
  the whole document. Write `&amp;`.
- **Duplicate `id`s across marks in one document collide** — gradients/clipPaths resolve
  document-wide and the *first* definition wins, so two clips of different radii silently
  share one. Prefix ids per mark (`mcClip`, `bmClip`, …) when composing several marks in a
  single sheet.
- **Build the `.ico` from a large render, not from the 16px frame** — PIL's `save(format='ICO',
  sizes=[...])` downscales from the image you hand it; passing the 16px frame makes 32/48 blurry.
- `favicon.ico` serves from `public/` and is a 16px tab icon: that size is mush for any
  detailed mark, which is why the *silhouette* (mug + foam head) is what matters, not the wood
  grain.
