// ─────────────────────────────────────────────────────────────────────────
//  The slice of TradingView's Advanced Charts API that Pantessa calls,
//  described in our own words.
//
//  The library is licensed, not open source: "It is prohibited to use any
//  part of the library in public repositories" (its quick-start page), and
//  this repository is public. So nothing of theirs is here — not the
//  bundles, not their `.d.ts`. These are hand-written structural types for
//  the handful of calls we make, checked against v33.1.0 on a private copy.
//  Add a member only when the code starts calling it.
// ─────────────────────────────────────────────────────────────────────────

/** Unix MILLISECONDS on a bar; prices are plain numbers. */
export interface TvBar {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

export interface TvSymbolInfo {
  name: string
  ticker: string
  description: string
  type: string
  session: string
  exchange: string
  listed_exchange: string
  timezone: string
  format: 'price' | 'volume'
  pricescale: number
  minmov: number
  has_intraday: boolean
  intraday_multipliers: string[]
  has_seconds: boolean
  seconds_multipliers?: string[]
  has_daily: boolean
  daily_multipliers: string[]
  has_weekly_and_monthly: boolean
  has_empty_bars: boolean
  supported_resolutions: string[]
  visible_plots_set: 'ohlcv' | 'ohlc' | 'c'
  volume_precision: number
  data_status: 'streaming' | 'endofday' | 'delayed_streaming'
  delay?: number
}

/** `from` / `to` are unix SECONDS; `to` is exclusive. */
export interface TvPeriodParams {
  from: number
  to: number
  countBack: number
  firstDataRequest: boolean
}

export interface TvHistoryMeta {
  noData?: boolean
}

export interface TvSearchResult {
  symbol: string
  description: string
  exchange: string
  ticker: string
  type: string
}

/** A mark on a bar (a fill). `time` is unix SECONDS. */
export interface TvMark {
  id: string
  time: number
  color: { border: string; background: string }
  text: string
  label: string
  labelFontColor: string
  minSize: number
}

/** A mark on the time axis (a news item). `time` is unix SECONDS. */
export interface TvTimescaleMark {
  id: string
  time: number
  color: string
  label: string
  tooltip: string[]
}

export interface TvDatafeedConfig {
  supported_resolutions: string[]
  supports_marks: boolean
  supports_timescale_marks: boolean
  supports_time: boolean
  exchanges: { value: string; name: string; desc: string }[]
  symbols_types: { name: string; value: string }[]
}

export interface TvDatafeed {
  onReady(cb: (config: TvDatafeedConfig) => void): void
  searchSymbols(input: string, exchange: string, type: string, onResult: (items: TvSearchResult[]) => void): void
  resolveSymbol(name: string, onResolve: (info: TvSymbolInfo) => void, onError: (reason: string) => void): void
  getBars(info: TvSymbolInfo, resolution: string, period: TvPeriodParams, onResult: (bars: TvBar[], meta: TvHistoryMeta) => void, onError: (reason: string) => void): void
  subscribeBars(info: TvSymbolInfo, resolution: string, onTick: (bar: TvBar) => void, listenerGuid: string, onResetCacheNeeded: () => void): void
  unsubscribeBars(listenerGuid: string): void
  getMarks(info: TvSymbolInfo, from: number, to: number, onData: (marks: TvMark[]) => void, resolution: string): void
  getTimescaleMarks(info: TvSymbolInfo, from: number, to: number, onData: (marks: TvTimescaleMark[]) => void, resolution: string): void
}

/** A shape's anchor: seconds and/or a price. */
export interface TvPoint {
  time?: number
  price?: number
}

export interface TvShapeOptions {
  shape: string
  text?: string
  lock?: boolean
  disableSelection?: boolean
  disableSave?: boolean
  disableUndo?: boolean
  /** In front of every other drawing AND the candles, or behind them all. */
  zOrder?: 'top' | 'bottom'
  showInObjectsTree?: boolean
  overrides?: Record<string, unknown>
}

export interface TvShapeApi {
  getPoints(): { time?: number; price: number }[]
  getProperties(): Record<string, unknown>
  setPoints(points: TvPoint[]): void
  setProperties(props: Record<string, unknown>): void
  bringToFront(): void
  /** A drawing fixed to the pane (`anchored_text`): its corner as fractions of the pane. */
  setAnchoredPosition(position: { x: number; y: number }): void
}

export interface TvSubscription<F> {
  subscribe(obj: object | null, fn: F, singleshot?: boolean): void
  unsubscribe(obj: object | null, fn: F): void
}

export interface TvPriceScaleApi {
  priceToCoordinate(price: number): number | null
}

export interface TvPaneApi {
  hasMainSeries(): boolean
  getMainSourcePriceScale(): TvPriceScaleApi | null
  getHeight(): number
}

export interface TvChartApi {
  symbol(): string
  resolution(): string
  setResolution(resolution: string): Promise<boolean> | void
  setSymbol(symbol: string): Promise<boolean> | void
  getVisibleRange(): { from: number; to: number }
  /** Seconds. `percentRightMargin` leaves air after the newest bar (and then `to` is that bar). */
  setVisibleRange(range: { from: number; to?: number }, options?: { percentRightMargin?: number; rejectByTimeout?: number }): Promise<void>
  onIntervalChanged(): TvSubscription<(interval: string) => void>
  onVisibleRangeChanged(): TvSubscription<(range: { from: number; to: number }) => void>
  crossHairMoved(): TvSubscription<(p: { time: number; price: number }) => void>
  onDataLoaded(): TvSubscription<() => void>
  createShape(point: TvPoint, options: TvShapeOptions): Promise<string>
  createMultipointShape(points: TvPoint[], options: TvShapeOptions): Promise<string>
  /** A drawing fixed to the pane: `position` is its corner as fractions of the pane (0 to 1). */
  createAnchoredShape(position: { x: number; y: number }, options: TvShapeOptions): Promise<string>
  getAllShapes(): { id: string; name: string }[]
  getShapeById(id: string): TvShapeApi
  removeEntity(id: string): void
  removeAllShapes(): void
  refreshMarks(): void
  clearMarks(): void
  resetData(): void
  getPanes(): TvPaneApi[]
  createStudy(name: string, forceOverlay: boolean, lock: boolean, inputs?: Record<string, unknown>): Promise<string | null>
  selection(): { add(id: string): void; clear(): void }
  getTimeScale(): { setBarSpacing(px: number): void; barSpacing(): number; width(): number; coordinateToTime(x: number): number | null }
}

export interface TvWidget {
  onChartReady(cb: () => void): void
  headerReady(): Promise<void>
  activeChart(): TvChartApi
  subscribe(event: string, cb: (...args: never[]) => void): void
  unsubscribe(event: string, cb: (...args: never[]) => void): void
  changeTheme(theme: 'light' | 'dark', options?: { disableUndo?: boolean }): Promise<void>
  applyOverrides(overrides: Record<string, unknown>): void
  setCSSCustomProperty(name: string, value: string): void
  takeClientScreenshot(): Promise<HTMLCanvasElement>
  save(cb: (state: object) => void): void
  selectLineTool(tool: string): Promise<void> | void
  remove(): void
}

export interface TvWidgetOptions {
  container: HTMLElement
  datafeed: TvDatafeed
  symbol: string
  interval: string
  library_path: string
  locale: string
  autosize: boolean
  theme: 'light' | 'dark'
  timezone?: string
  disabled_features?: string[]
  enabled_features?: string[]
  overrides?: Record<string, unknown>
  studies_overrides?: Record<string, unknown>
  loading_screen?: { backgroundColor?: string; foregroundColor?: string }
  favorites?: { intervals?: string[] }
  saved_data?: object
  auto_save_delay?: number
  custom_css_url?: string
  time_frames?: { text: string; resolution: string; description?: string; title?: string }[]
  debug?: boolean
}

/** The global the library's standalone script defines. */
export interface TvGlobal {
  widget: new (options: TvWidgetOptions) => TvWidget
  version(): string
}
