/**
 * Test-only failpoints for the trip→expense conversion. A failpoint SIMULATES A PROCESS CRASH at a named step (the request is abandoned
 * with no cleanup, exactly as if the server died there), so recovery tests exercise the real route logic rather than editing the database.
 *
 * Armed only when BOTH hold: the server was started with TRAVEL_FAILPOINTS=1 AND NODE_ENV is not "production". The point to trigger is
 * named by the request header `x-test-failpoint`. In a production build the header is ignored unconditionally.
 */
export class FailpointCrash extends Error {
  constructor(public readonly point: string) { super(`failpoint:${point}`); this.name = 'FailpointCrash' }
}

export const failpointsArmed = () => process.env.TRAVEL_FAILPOINTS === '1' && process.env.NODE_ENV !== 'production'

/** The failpoint requested by this call, or undefined. */
export function requestedFailpoint(headers: { get(name: string): string | null }): string | undefined {
  if (!failpointsArmed()) return undefined
  const v = headers.get('x-test-failpoint')
  return v && /^[a-z_]{1,40}$/.test(v) ? v : undefined
}

/** Simulates a STALLED (not dead) request: it sleeps at the named step and then carries on — the zombie holder of an expired lease. */
export const stall = async (requested: string | undefined, point: string, ms = 1800) => { if (requested === `stall_${point}`) await new Promise(r => setTimeout(r, ms)) }

export const hit = (requested: string | undefined, point: string) => { if (requested === point) throw new FailpointCrash(point) }
