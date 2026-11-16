import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(_request: Request) {
  try {
    await requireRole('agent')
    void _request
    return NextResponse.json(
      {
        error: 'unsupported_capability',
        code: 'unsupported_capability',
        capability: 'reactions',
      },
      { status: 422, headers: NO_STORE },
    )
  } catch (error) {
    const response = toErrorResponse(error)
    response.headers.set('Cache-Control', 'no-store')
    return response
  }
}
