// Pantessa's tokens → the library's colors. Pure, pinned (scripts/tv-pins).
//
// The Advanced chart draws in its own iframe, so the site's CSS never
// reaches it: the candle inks, the pane, the grid and the toolbar are set
// through the widget's overrides and CSS custom properties, read from the
// same token probe the built-in chart uses (components/markets/chart/
// chart-tokens). A theme flip re-reads the tokens and re-applies both.

export interface TvThemeTokens {
  up: string
  down: string
  fg: string
  bg: string
  surf: string
  line: string
  muted: string
  muted2: string
  accent: string
  grid: string
  crosshair: string
}

/** `#rrggbb` + alpha → `rgba(…)` (the library reads rgba strings). */
export function withAlpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim())
  if (!m) return hex
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})`
}

/** Chart overrides: the pane, the grid, the scales and the candles. */
export function tvOverrides(t: TvThemeTokens): Record<string, unknown> {
  return {
    'paneProperties.backgroundType': 'solid',
    'paneProperties.background': t.bg,
    'paneProperties.vertGridProperties.color': t.grid,
    'paneProperties.horzGridProperties.color': t.grid,
    'paneProperties.separatorColor': t.line,
    'paneProperties.crossHairProperties.color': t.muted2,
    'scalesProperties.textColor': t.muted,
    'scalesProperties.lineColor': t.line,
    'mainSeriesProperties.candleStyle.upColor': t.up,
    'mainSeriesProperties.candleStyle.downColor': t.down,
    'mainSeriesProperties.candleStyle.borderUpColor': t.up,
    'mainSeriesProperties.candleStyle.borderDownColor': t.down,
    'mainSeriesProperties.candleStyle.wickUpColor': withAlpha(t.up, 0.62),
    'mainSeriesProperties.candleStyle.wickDownColor': withAlpha(t.down, 0.62),
    'mainSeriesProperties.hollowCandleStyle.upColor': t.up,
    'mainSeriesProperties.hollowCandleStyle.downColor': t.down,
    'mainSeriesProperties.barStyle.upColor': t.up,
    'mainSeriesProperties.barStyle.downColor': t.down,
    'mainSeriesProperties.lineStyle.color': t.accent,
    'mainSeriesProperties.areaStyle.linecolor': t.accent,
    'mainSeriesProperties.areaStyle.color1': withAlpha(t.accent, 0.28),
    'mainSeriesProperties.areaStyle.color2': withAlpha(t.accent, 0),
  }
}

/** The volume bars under the candles. */
export function tvStudyOverrides(t: TvThemeTokens): Record<string, unknown> {
  return {
    'volume.volume.color.0': withAlpha(t.down, 0.35),
    'volume.volume.color.1': withAlpha(t.up, 0.35),
  }
}

/** The toolbar chrome, as the library's CSS custom properties. */
export function tvCssProperties(t: TvThemeTokens): Record<string, string> {
  return {
    '--tv-color-platform-background': t.bg,
    '--tv-color-pane-background': t.bg,
    '--tv-color-toolbar-button-background-hover': t.surf,
    '--tv-color-toolbar-button-background-expanded': t.surf,
    '--tv-color-toolbar-button-background-active': t.surf,
    '--tv-color-toolbar-button-background-active-hover': t.surf,
    '--tv-color-toolbar-button-text': t.muted,
    '--tv-color-toolbar-button-text-hover': t.fg,
    '--tv-color-toolbar-button-text-active': t.accent,
    '--tv-color-toolbar-button-text-active-hover': t.accent,
    '--tv-color-item-active-text': t.accent,
    '--tv-color-toolbar-toggle-button-background-active': t.accent,
    '--tv-color-toolbar-toggle-button-background-active-hover': t.accent,
    '--tv-color-toolbar-divider-background': t.line,
    '--tv-color-popup-background': t.surf,
    '--tv-color-popup-element-text': t.fg,
    '--tv-color-popup-element-text-hover': t.fg,
    '--tv-color-popup-element-background-hover': t.bg,
    '--tv-color-popup-element-divider-background': t.line,
  }
}
