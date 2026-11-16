const RETIRED_RESPONSE = { error: 'legacy_provider_retired' }

export function GET(_request: Request): Response {
  void _request
  return Response.json(RETIRED_RESPONSE, { status: 410 })
}

export function POST(_request: Request): Response {
  void _request
  return Response.json(RETIRED_RESPONSE, { status: 410 })
}
