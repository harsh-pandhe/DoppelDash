import { redirect } from 'next/navigation'

// Campaign merged into the unified Mail composer (which already supports
// tag/segment recipient picking + send history). Old route redirects.
export default function CampaignsPage() {
  redirect('/mail')
}
