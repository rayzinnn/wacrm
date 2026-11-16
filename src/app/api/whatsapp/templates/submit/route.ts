import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

const UNSUPPORTED_TEMPLATES = {
  error: 'Templates are not supported by this provider.',
  code: 'unsupported_capability',
  capability: 'templates',
} as const

export async function POST(_request: Request) {
  void _request
  try {
    await requireRole('admin')
    return NextResponse.json(UNSUPPORTED_TEMPLATES, { status: 422 })
  } catch (error) {
    return toErrorResponse(error)
  }
}
