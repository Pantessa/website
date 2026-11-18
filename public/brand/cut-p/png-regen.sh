#!/usr/bin/env bash
# Rasterizes the Cut P kit's png/ set + the app/ and design-system icons from
# the SVGs in this directory. Run from anywhere: bash png-regen.sh
# Needs network once (npx fetches sharp-cli).
set -e
cd "$(dirname "$0")"
S="npx --yes sharp-cli"
r() { # r input.svg out.png width height basewidth
  local d=$(python3 -c "print(min(2400, round(72*$3/$5)))")
  $S --density $d -i "$1" -o "png/$2" resize $3 $4 --fit inside >/dev/null
}
# favicons (base 128)
for s in 16 32 48 64; do r pantessa-favicon.svg favicon-$s.png $s $s 128; done
r pantessa-apple-touch.svg apple-touch-icon-180.png 180 180 128
for s in 192 512 1024; do r pantessa-app-icon.svg pantessa-app-icon-$s.png $s $s 128; done
r pantessa-app-icon-maskable.svg pantessa-app-icon-maskable-512.png 512 512 128
# avatars: the two-tone one, emerald, and black + white
for v in "" -emerald -black -white; do
  r pantessa-avatar$v.svg pantessa-avatar$v-400.png 400 400 128
  r pantessa-avatar$v.svg pantessa-avatar$v-800.png 800 800 128
done
# the mark alone, transparent ground
r pantessa-mark.svg pantessa-mark-512.png 512 512 128
r pantessa-mark-paper.svg pantessa-mark-paper-512.png 512 512 128
for v in white black ink emerald; do r pantessa-mark-mono-$v.svg pantessa-mark-mono-$v-512.png 512 512 128; done
# lockups (viewBox ~260 wide) and stacked (~200 wide), transparent ground
for v in "" -ink -mono-white -mono-black; do
  r pantessa-lockup$v.svg pantessa-lockup$v-1600w.png 1600 600 289
  r pantessa-stacked$v.svg pantessa-stacked$v-1200.png 1200 1300 200
done
# social
for v in "" -black -white; do r pantessa-x-header$v.svg pantessa-x-header$v-1500x500.png 1500 500 1500; done
r pantessa-linkedin-banner.svg pantessa-linkedin-banner-1584x396.png 1584 396 1584
r pantessa-og-banner.svg pantessa-og-banner-1200x630.png 1200 630 1200
for v in "" -emerald -black -white; do r pantessa-social-square$v.svg pantessa-social-square$v-1080.png 1080 1080 1080; done
echo "rasters done"; ls png/ | wc -l
cd ../../..
r2() { npx --yes sharp-cli --density $1 -i "$2" -o "$3" resize $4 $4 >/dev/null; }
r2 288 public/brand/cut-p/pantessa-favicon.svg app/icon.png 512
r2 102 public/brand/cut-p/pantessa-apple-touch.svg app/apple-icon.png 180
cp public/brand/cut-p/png/apple-touch-icon-180.png public/design-system/assets/apple-icon.png
cp public/brand/cut-p/png/favicon-32.png public/design-system/assets/favicon-32.png
r2 288 public/brand/cut-p/pantessa-favicon.svg public/design-system/assets/icon-512.png 512
echo "app + design-system rasters done"
