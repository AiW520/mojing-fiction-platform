# Ghost Ledger Cover V2

User direction: attractive, handsome, cool; reduce the glossy AI-rendered appearance of the previous cover.

## Art Direction

Brush-ink graphic-novel illustration with charcoal, neutral white and vermilion. One decisive character silhouette, a plain saber and a closed black clothbound ledger. Avoid photorealistic beauty retouching, intricate fabric noise, floating spirits, snow particles, cinematic fog and pseudo-runes. Reserve the top 30% for separately typeset Chinese lettering.

The title is `镇诡司`, subtitle `我以功簿斩妖`, author `唐渡 著`. Typography is rendered locally rather than relying on generated text.

## Asset Policy

- Fixed provider: Tuzi coding, `https://api.tu-zi.com/coding/images/generations`.
- Fixed model: `gpt-image-2`; one generation call for this version, no automatic retries.
- Preserve the returned original artwork and a full-resolution typeset PNG.
- Export a 640x960 WebP plus a 120x180 inspection thumbnail.
- Keep the existing `cover.webp` and original artwork as recoverable previous versions.
- This pass changes one cover only; novel text and other portraits remain unchanged.

## Generation And Validation

- One Tuzi coding `gpt-image-2` call returned a nonempty original PNG; no retries.
- Original artwork: `cover-ink-original.png`. The image did not leave the requested title area clear enough; local layout places the artwork lower rather than generating again.
- Full typeset cover: `cover-typeset.png`; typography does not overlap the face.
- Optimized WebP: `cover-ink-v2.webp`, 640x960, 83634 bytes.
- The 120x180 thumbnail was visually inspected for title readability and figure silhouette.
- The manifest now references `/assets/books/ghost-ledger/cover-ink-v2.webp`; the previous `cover.webp` remains untouched.
- Browser QA passed at 320px, 390px and 768px: the new 640x960 cover loads with no horizontal overflow or JavaScript errors.
- Detail and first-chapter reader pages also load the new cover. Screenshots: `qa-bookstore-390.png`, `qa-detail-390.png`.
- Project TypeScript/server syntax/Sass checks and all six existing regression tests passed after integration.
