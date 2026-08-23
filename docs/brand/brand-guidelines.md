# Grab Your Torch — Logo System

## Chosen concept

**Victory Flame** combines a bold torch with a trophy cut from the flame in negative space. The flame supplies adventure and momentum; the trophy connects directly to fantasy competition; the blue torch base ties the identity to the product interface. The symbol is original and deliberately avoids Survivor-owned imagery.

## Color palette

| Role | Name | HEX | Use |
|---|---|---:|---|
| Primary dark | Night Navy | `#071D3A` | Wordmark, dark backgrounds, app icon |
| Product blue | League Blue | `#1177FF` | Torch bowl, links, active states |
| Accent cool | Signal Cyan | `#18D5F2` | Highlights and dark-mode wordmark accent |
| Flame primary | Ember Orange | `#FF5A36` | Main flame |
| Flame secondary | Victory Gold | `#FFC83D` | Secondary flame tongue |
| Light neutral | Ice White | `#EAF8FF` | Dark-mode type and torch handle |
| Supporting neutral | Mist Blue | `#B8D9EE` | Secondary copy on dark backgrounds |

Do not recolor the trophy cutout; it is transparent negative space. On visually busy backgrounds, use the one-color version or place the full-color logo on a solid field.

## Typography

- **Wordmark:** Space Grotesk SemiBold (600–650) for “Grab Your”; Space Grotesk ExtraBold Italic (800) for “Torch.” Space Grotesk is open source under the SIL Open Font License.
- **Product/UI:** Inter Regular, Medium, and Semibold. Inter is open source under the SIL Open Font License.
- **Fallback:** Arial or a system sans-serif. For final production artwork, convert the wordmark glyphs to outlines after setting the supplied tracking.

## Clear space and minimum sizes

- Define `x` as the width of the torch handle at its widest point.
- Keep at least `1x` clear space around the emblem and `1.5x` around full lockups.
- Primary horizontal logo: minimum 160 px digital / 42 mm print.
- Stacked logo: minimum 96 px digital / 25 mm print.
- Standalone full emblem: minimum 40 px digital.
- Below 40 px, use the supplied simplified favicon artwork. Do not shrink the full emblem into a favicon.
- At 16 px, use only the two-color pixel-aligned favicon; at 32 px, use the three-color favicon.

## SVG-ready construction

The emblem uses a `160 × 200` coordinate grid.

1. Build the outer flame as one closed Bézier silhouette spanning approximately `x=30…130`, `y=4…144`.
2. Subtract the trophy using an SVG mask or compound path. The trophy cup spans `x=56…104`, with side handles extending to `x=39…120`; its stem and base end at `y=138`.
3. Clip the gold secondary tongue to the same trophy mask so the negative space remains uninterrupted.
4. Construct the torch bowl from a four-point trapezoid spanning `x=31…129`, `y=142…162`, then place a cyan inset highlight.
5. Construct the handle from a tapered four-point polygon spanning `x=65…95`, `y=162…200`.
6. Preserve the supplied viewBox and do not add strokes, shadows, gradients, or raster effects.

## Export filenames

- `grab-your-torch-primary-light.svg` / `.png`
- `grab-your-torch-primary-dark.svg` / `.png`
- `grab-your-torch-stacked.svg` / `.png`
- `grab-your-torch-emblem-color.svg` / `.png`
- `grab-your-torch-favicon-16.svg` / `.png`
- `grab-your-torch-favicon-32.svg` / `.png`
- `grab-your-torch-app-icon-512.svg` / `.png`
- `grab-your-torch-apple-touch-icon-180.svg` / `.png`
- `grab-your-torch-one-color-black.svg` / `.png`
- `grab-your-torch-one-color-white.svg` / `.png`
- `grab-your-torch-social-avatar.svg` / `.png`
- `grab-your-torch-og-1200x630.svg` / `.png`
- `grab-your-torch-brand-board.png`
