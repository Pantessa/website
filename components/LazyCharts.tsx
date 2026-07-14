'use client'

// Lazy wrappers for the Recharts-backed chart components. Recharts compiles to
// a ~358 KB chunk; importing the charts statically pulled it into the initial
// JS of every dashboard page. These next/dynamic (ssr:false) wrappers move it
// to an on-demand chunk that loads only when a chart actually mounts — so the
// dashboard routes' first load no longer ships Recharts. Pages import their
// charts from here instead of DashboardCharts/AdminCharts directly.

import dynamic from 'next/dynamic'

// Fixed-height skeletons match each chart's footprint → no layout shift while
// the async chunk loads.
const skeleton = (height: number) =>
  function ChartSkeleton() {
    return <div className="min-w-0 animate-pulse rounded-xl bg-white/5" style={{ height }} />
  }

export const SpendOverTime = dynamic(() => import('./DashboardCharts').then((m) => m.SpendOverTime), {
  ssr: false,
  loading: skeleton(220),
})
export const SpendByAgent = dynamic(() => import('./DashboardCharts').then((m) => m.SpendByAgent), {
  ssr: false,
  loading: skeleton(220),
})
export const WalletsOverTime = dynamic(() => import('./AdminCharts').then((m) => m.WalletsOverTime), {
  ssr: false,
  loading: skeleton(220),
})
export const ActiveWallets = dynamic(() => import('./AdminCharts').then((m) => m.ActiveWallets), {
  ssr: false,
  loading: skeleton(220),
})
// Funnel is pure CSS (no Recharts) but lives in AdminCharts, so import it lazily
// too — that keeps the whole AdminCharts module (and its Recharts dep) out of
// the initial bundle.
export const Funnel = dynamic(() => import('./AdminCharts').then((m) => m.Funnel), {
  ssr: false,
  loading: skeleton(120),
})
export const PriceChart = dynamic(() => import('./DashboardCharts').then((m) => m.PriceChart), {
  ssr: false,
  loading: skeleton(200),
})
export const UsageChart = dynamic(() => import('./DashboardCharts').then((m) => m.UsageChart), {
  ssr: false,
  loading: skeleton(160),
})
export const MoneyCurve = dynamic(() => import('./ActivityCharts').then((m) => m.MoneyCurve), {
  ssr: false,
  loading: skeleton(280),
})
export const DailyFlow = dynamic(() => import('./ActivityCharts').then((m) => m.DailyFlow), {
  ssr: false,
  loading: skeleton(260),
})
