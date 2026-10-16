import { runCronJob } from '../lib/runCronJob.mjs'

// Netlify Scheduled Function (UTC). Runs only on the PUBLISHED deploy of a site. See docs/SCHEDULED_JOBS.md.
export default async () => { await runCronJob('birthday') }
export const config = { schedule: '0 7 * * *' }
