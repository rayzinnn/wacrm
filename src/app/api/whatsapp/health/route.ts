import { GET as getWhatsAppConfig } from '../config/route'

export async function GET() {
  return getWhatsAppConfig()
}
