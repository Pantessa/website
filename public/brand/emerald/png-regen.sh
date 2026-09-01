#!/usr/bin/env bash
# Rasterizes the emerald kit's png/ set + app/ and design-system icons from
# the SVGs in this directory. Run from anywhere: bash png-regen.sh
set -e
cd "$(dirname "$0")"
S="npx --yes sharp-cli"
r() { # r input.svg out.png width height basewidth
  local d=$(python3 -c "print(min(2400, round(72*$4/$5)))")
  $S --density $d -i "$1" -o "png/$2" resize $3 $4 --fit inside >/dev/null
}
# favicons (base 128)
for s in 16 32 48 64; do r pantessa-favicon.svg favicon-$s.png $s $s 128; done
r pantessa-apple-touch.svg apple-touch-icon-180.png 180 180 128
r pantessa-app-icon.svg pantessa-app-icon-512.png 512 512 128
r pantessa-app-icon.svg pantessa-app-icon-1024.png 1024 1024 128
r pantessa-avatar.svg pantessa-avatar-400.png 400 400 128
r pantessa-avatar.svg pantessa-avatar-800.png 800 800 128
r pantessa-gem.svg pantessa-gem-512.png 512 512 128
r pantessa-gem-mark-paper.svg pantessa-gem-paper-512.png 512 512 128
r pantessa-x-header.svg pantessa-x-header-1500x500.png 1500 500 500
r pantessa-og-banner.svg pantessa-og-banner-1200x630.png 1200 630 630
# lockups: height-based (viewBox H ~83)
r pantessa-lockup.svg pantessa-lockup-1600w.png 1600 420 83
r pantessa-lockup-ink.svg pantessa-lockup-ink-1600w.png 1600 420 83
r pantessa-stacked.svg pantessa-stacked-1200.png 1200 1000 210
echo "rasters done"; ls png/ | wc -l
cd ../../..
npx --yes sharp-cli --density 288 -i public/brand/emerald/pantessa-favicon.svg -o app/icon.png resize 512 512 >/dev/null
npx --yes sharp-cli --density 102 -i public/brand/emerald/pantessa-apple-touch.svg -o app/apple-icon.png resize 180 180 >/dev/null
cp public/brand/emerald/png/apple-touch-icon-180.png public/design-system/assets/apple-icon.png
cp public/brand/emerald/png/favicon-32.png public/design-system/assets/favicon-32.png
npx --yes sharp-cli --density 288 -i public/brand/emerald/pantessa-favicon.svg -o public/design-system/assets/icon-512.png resize 512 512 >/dev/null
echo "app + design-system rasters done"
