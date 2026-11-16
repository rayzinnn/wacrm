import { requireApiKey } from '@/lib/auth/api-context';
import { fail, toApiErrorResponse } from '@/lib/api/v1/respond';

const UNSUPPORTED_CAPABILITY_MESSAGE =
  'Broadcasts are not supported by this provider.';

function noStore(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function GET(
  request: Request,
  _context: { params: Promise<{ id: string }> }
) {
  void _context;
  try {
    await requireApiKey(request, 'broadcasts:send');
  } catch (error) {
    return noStore(toApiErrorResponse(error));
  }

  return noStore(
    fail('unsupported_capability', UNSUPPORTED_CAPABILITY_MESSAGE, 422)
  );
}
