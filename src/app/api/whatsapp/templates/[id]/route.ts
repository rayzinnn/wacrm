import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

const UNSUPPORTED_TEMPLATES = {
  error: 'Templates are not supported by this provider.',
  code: 'unsupported_capability',
  capability: 'templates',
} as const

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(_request: Request, _context: RouteContext) {
  void _request
  void _context
  try {
    await requireRole('admin')
    return NextResponse.json(UNSUPPORTED_TEMPLATES, { status: 422 })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function DELETE(_request: Request, _context: RouteContext) {
  void _request
  void _context
  try {
    await requireRole('admin')
    return NextResponse.json(UNSUPPORTED_TEMPLATES, { status: 422 })
  } catch (error) {
    return toErrorResponse(error)
  }
}
