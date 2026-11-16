import { formatDistanceToNow } from 'date-fns'
import { enUS, es, ko, ptBR } from 'date-fns/locale'

const locales = { en: enUS, es, ko, pt: ptBR }

export function getDateFnsLocale(locale: string) {
  return locales[locale as keyof typeof locales] ?? enUS
}

export function formatRelativeTime(date: Date, locale: string, addSuffix = false): string {
  return formatDistanceToNow(date, { addSuffix, locale: getDateFnsLocale(locale) })
}
