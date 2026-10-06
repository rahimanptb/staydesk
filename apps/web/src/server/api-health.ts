import 'server-only';

export type ApiStatus = 'ok' | 'degraded' | 'unreachable';

/** Server-side readiness probe of the API (and, through it, the database). */
export async function getApiStatus(): Promise<ApiStatus> {
  const base = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${base}/api/v1/health/ready`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2_000),
    });
    if (res.ok) return 'ok';
    return res.status === 503 ? 'degraded' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}
