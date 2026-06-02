// Server-only IndexedDB shim.
//
// WalletConnect's key-value storage touches `indexedDB` when its client
// initializes. RainbowKit wires up WalletConnect infrastructure as part of its
// connector setup, so that init runs during SSR — where `indexedDB` doesn't
// exist. On Next 15 it was a benign prerender warning; under Next 16's stricter
// SSR it surfaces as a fatal `unhandledRejection`.
//
// Provide an in-memory IndexedDB on the server only (the browser already has a
// real one, so we never override it). Imported first in app/layout.tsx — a
// Server Component — so this never reaches the client bundle.
if (typeof globalThis.indexedDB === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('fake-indexeddb/auto')
}

export {}
