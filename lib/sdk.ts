// One source of truth for the published `yeetful` SDK version references shown
// across the site (install snippets, prompts, badges). Bump here when a new
// version publishes and every surface stays in sync — no more 0.9-vs-0.10 drift.

export const SDK_PKG = 'yeetful'
/** Minimum version with embed keys (key=) + page reporting (page=). */
export const SDK_MIN = '0.10'
/** The esm.sh spec for the no-bundler embed path. */
export const SDK_EMBED_ESM = `https://esm.sh/${SDK_PKG}@^${SDK_MIN}/embed`
