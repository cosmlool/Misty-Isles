# Misty Isles — Stage 11: artwork display quality

This stage is a targeted display/layout correction on top of Stage 10. It does not claim to replace the underlying low-resolution source art with newly painted high-resolution assets.

## Changes
- Monster portraits are displayed with `object-fit: contain` on a consistent neutral backdrop, avoiding the severe vertical cropping caused by `cover` for narrow 65×165 source images.
- Race portraits, sidebar avatars, and hero artwork consistently use contain/no-repeat positioning so the full silhouette is less likely to be clipped.
- The world atlas uses contain sizing to avoid stretching/cropping its 1020×740 composition.
- Item icons receive a consistent backdrop and preserve their aspect ratio.
- Responsive sizes remain in place for smaller screens.

## Checks
Run from `client`:

```bash
npm ci
npm run audit:assets
npm run build
npm run dev
```

Then manually inspect character, map, shop, inventory, and hunting pages in a browser. The asset audit checks files and formats; it does not establish visual quality or interaction correctness. High-quality replacement art still requires replacing the source images, not merely scaling them.
