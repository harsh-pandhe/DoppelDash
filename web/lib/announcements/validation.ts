/** Announcement field validation shared by create (POST) and edit (PATCH). Returns offending field names. */
export const ANNOUNCEMENT_PRIORITIES = ['normal', 'important', 'urgent']
export const ANNOUNCEMENT_EDIT_FIELDS = ['title', 'body', 'priority', 'pinned', 'scheduledFor'] as const

export function invalidAnnouncementFields(b: Record<string, unknown>, { partial }: { partial: boolean }): string[] {
  const bad: string[] = []
  const has = (k: string) => b[k] !== undefined
  if (!partial || has('title')) if (typeof b.title !== 'string' || !b.title.trim() || b.title.trim().length > 200) bad.push('title')
  if (!partial || has('body')) if (typeof b.body !== 'string' || !b.body.trim() || b.body.length > 20_000) bad.push('body')
  if (has('priority') && !ANNOUNCEMENT_PRIORITIES.includes(b.priority as string)) bad.push('priority')
  if (has('pinned') && typeof b.pinned !== 'boolean') bad.push('pinned')
  if (has('scheduledFor') && b.scheduledFor !== null && (typeof b.scheduledFor !== 'string' && typeof b.scheduledFor !== 'number' || Number.isNaN(new Date(b.scheduledFor as string).getTime()))) bad.push('scheduledFor')
  return bad
}
