// The datafeed as a module, for TradingView's own datafeed checker (it ships
// inside the library's repository, which is licensed and not in this one):
//
//   BASE=http://localhost:3000 npx tsx \
//     <library>/.agents/skills/charting-library-datafeed/scripts/check-datafeed.mjs \
//     --datafeed scripts/tv-datafeed-export.ts --symbol UNI,HYPE,AAPL,US10Y \
//     --resolution 1,15,60,240,1D --product advanced-charts --features seconds_resolution
//
// The datafeed reads relative URLs (it runs in a browser); here they are
// rebased onto BASE. The main symbol is one nothing charts, so no live
// stream is opened (a stream needs the browser's EventSource).

import { createPantessaDatafeed } from '../lib/tv/datafeed'

const base = (process.env.BASE ?? 'http://localhost:3000').replace(/\/$/, '')
const realFetch = globalThis.fetch
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => realFetch(typeof input === 'string' && input.startsWith('/') ? `${base}${input}` : input, init)) as typeof fetch

export default createPantessaDatafeed({ mainSymbol: '__CHECK__', initialTf: '1d' })
