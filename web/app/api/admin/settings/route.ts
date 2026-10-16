import { NextRequest } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import { handleGetOrgSettings, handleMutateOrgSettings } from '@/lib/settings/orgSettingsHandler'

async function GET_handler() {
  return handleGetOrgSettings()
}

async function POST_handler(req: NextRequest) {
  return handleMutateOrgSettings(req)
}

async function PATCH_handler(req: NextRequest) {
  return handleMutateOrgSettings(req)
}

async function PUT_handler(req: NextRequest) {
  return handleMutateOrgSettings(req)
}

export const GET = dbGuard(GET_handler)
export const POST = dbGuard(POST_handler)
export const PATCH = dbGuard(PATCH_handler)
export const PUT = dbGuard(PUT_handler)
