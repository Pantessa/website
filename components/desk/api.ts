// components/desk/api.ts — the console's one fetch door (squad five-million,
// CONSOLE lane, 2026-11-03). Same-origin, the SIWE session cookie rides
// along; every tenant route answers JSON, and a refusal's own words
// (`error`, plus `entitlement` / `upgrade` / `field` / `reason` when the route
// names them) reach the screen verbatim — the console never paraphrases a
// refusal.

export interface Answer<T = unknown> {
  status: number
  ok: boolean
  json: (T & Refusal) | null
}

export interface Refusal {
  error?: string
  entitlement?: string
  upgrade?: string
  field?: string
  reason?: string
  plan?: string
}

export async function call<T = Record<string, unknown>>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<Answer<T>> {
  try {
    const res = await fetch(path, {
      method,
      cache: 'no-store',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    let json: (T & Refusal) | null = null
    try {
      json = (await res.json()) as T & Refusal
    } catch {
      json = null
    }
    return { status: res.status, ok: res.ok, json }
  } catch (e) {
    return { status: 0, ok: false, json: { error: `The request did not reach the server (${e instanceof Error ? e.message : 'network'}).` } as T & Refusal }
  }
}

/** The refusal as the console prints it: the route's own sentence, or the
 *  status when a route answered nothing readable. */
export function refusalText(a: Answer<unknown>): string {
  return a.json?.error ?? `The server answered ${a.status || 'nothing'}.`
}
