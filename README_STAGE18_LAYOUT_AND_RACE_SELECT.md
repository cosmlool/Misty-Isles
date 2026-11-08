# Stage 18 — Structural layout and race selection portrait fix

## Changes
- Replaced compensating left/right margins and fixed-position right rail with a three-column CSS grid on desktop.
- The sidebar, main content and timer/reminder rail now occupy explicit grid columns; the right rail is not a fixed overlay.
- At medium widths, the right rail moves below the main two-column area; at mobile widths all regions stack.
- Added min-width safeguards to prevent nested content from forcing horizontal overflow.
- Race selection portrait backgrounds now use a contained portrait-sized image area instead of `background-size: cover`, which cropped the race artwork.
- Kept existing race selection action handlers, Phaser/Colyseus code and launcher scripts unchanged.

## Verification
- ZIP integrity and expected source/assets should be checked after packaging.
- Browser visual QA was not performed in this environment. Test at desktop width and at a narrow viewport before replacing the current working copy.
