# Full-size castaway photos

These originals load only when a castaway's photo modal opens. Card thumbnails
remain in `public/images/` so the cast grid stays lightweight.

Each season's `sources.json` records the source URL and original dimensions.
`src/data/castawayPhotos.json` maps thumbnail paths to these files; photos without
a mapping use their existing image. Keep originals outside `public/images/`
because `scripts/optimize-images.ts` reduces player thumbnails to 450 pixels.

Season 51 files retain the original WebP bytes from the source CDN.
