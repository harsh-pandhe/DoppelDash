import { listUsers } from '@/lib/auth'

/**
 * Helper to query announcement recipients strictly within the specified organization.
 */
export async function getAnnouncementRecipients(orgId: string): Promise<string[]> {
  try {
    const users = await listUsers({ limit: 500, orgId })
    return users.map(u => u.email).filter((e): e is string => Boolean(e))
  } catch {
    return []
  }
}

/**
 * Helper to query birthday notification recipients strictly within the specified organization.
 */
export async function getBirthdayNotificationRecipients(orgId: string): Promise<string[]> {
  try {
    const users = await listUsers({ limit: 500, orgId })
    return users
      .filter(u => u.role === 'manager' || u.role === 'admin')
      .map(u => u.email)
      .filter((e): e is string => Boolean(e))
  } catch {
    return []
  }
}
