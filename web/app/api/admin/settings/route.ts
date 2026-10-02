import { NextRequest } from 'next/server'
import { handleGetOrgSettings, handleMutateOrgSettings } from '@/lib/settings/orgSettingsHandler'

export async function GET() {
  return handleGetOrgSettings()
}

export async function POST(req: NextRequest) {
  return handleMutateOrgSettings(req)
}

export async function PATCH(req: NextRequest) {
  return handleMutateOrgSettings(req)
}

export async function PUT(req: NextRequest) {
  return handleMutateOrgSettings(req)
}
