export function GET(): Response {
  return Response.json({ error: 'legacy_provider_retired' }, { status: 410 })
}
