/**
 * Owner decision P-01 (approved 2026-10-25): a user may not hold two pending/approved leaves that cover the same day.
 * Rejected / withdrawn leave never blocks. The one exception is a morning + afternoon half-day pair on the same single day.
 * The check is check-then-insert (not atomic); the balance check in POST /api/lms remains the second line of defence.
 */
import Leave from '@/models/Leave'

const DAY = 86_400_000
export type HalfDayPeriod = 'morning' | 'afternoon'
export interface LeaveWindow { start: Date; end: Date; halfDayPeriod?: HalfDayPeriod }

const dayStart = (d: Date) => Math.floor(d.getTime() / DAY) * DAY

/** True when two windows may coexist: both are half-days on the same single calendar day, in different periods. */
export function isCompatibleHalfDayPair(a: LeaveWindow, b: LeaveWindow): boolean {
  if (!a.halfDayPeriod || !b.halfDayPeriod || a.halfDayPeriod === b.halfDayPeriod) return false
  const sameDay = (w: LeaveWindow) => dayStart(w.start) === dayStart(w.end)
  return sameDay(a) && sameDay(b) && dayStart(a.start) === dayStart(b.start)
}

export async function findOverlappingLeave(orgId: string, userId: string, win: LeaveWindow): Promise<{ _id: unknown } | null> {
  const lo = new Date(dayStart(win.start)), hi = new Date(dayStart(win.end) + DAY)     // whole calendar days (UTC), end exclusive
  const candidates = await Leave.find({
    orgId, userId, status: { $in: ['pending', 'approved'] },
    startDate: { $lt: hi }, endDate: { $gte: lo },
  }).select('startDate endDate isHalfDay halfDayPeriod').lean()
  for (const c of candidates as unknown as { _id: unknown; startDate: Date; endDate: Date; isHalfDay?: boolean; halfDayPeriod?: HalfDayPeriod }[]) {
    const other: LeaveWindow = { start: c.startDate, end: c.endDate, halfDayPeriod: c.isHalfDay ? c.halfDayPeriod : undefined }
    if (!isCompatibleHalfDayPair(win, other)) return c
  }
  return null
}
