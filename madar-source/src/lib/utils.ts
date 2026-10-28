import type { Priority, TaskStatus, Role, UnitType } from './types'

export const uid = (p = '') =>
  p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4)

export const randomSecret = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

const LOCALE = 'ar-EG-u-nu-latn'

export const fmtTime = (iso: string | Date) =>
  new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit' }).format(new Date(iso))

export const fmtDay = (iso: string | Date) =>
  new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso))

export const fmtShortDate = (iso: string | Date) =>
  new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short' }).format(new Date(iso))

export const fmtMonth = (d: Date) =>
  new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' }).format(d)

export const startOfDay = (d = new Date()) => {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
export const endOfDay = (d = new Date()) => {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}
export const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

export const isToday = (iso?: string) => !!iso && sameDay(new Date(iso), new Date())

export const minutesBetween = (a: string | Date, b: string | Date) =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)

export const fmtDuration = (mins: number) => {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h && m) return `${h} س ${m} د`
  if (h) return `${h} ساعة`
  return `${m} دقيقة`
}

/** Relative due label in Egyptian Arabic */
export const dueLabel = (iso?: string): { text: string; tone: 'muted' | 'warn' | 'late' } => {
  if (!iso) return { text: 'بدون ميعاد', tone: 'muted' }
  const d = new Date(iso)
  const now = new Date()
  if (d < now) return { text: 'متأخرة', tone: 'late' }
  if (sameDay(d, now)) {
    const mins = minutesBetween(now, d)
    return { text: fmtTime(d), tone: mins < 90 ? 'warn' : 'muted' }
  }
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  if (sameDay(d, tomorrow)) return { text: 'بكرة ' + fmtTime(d), tone: 'muted' }
  return { text: fmtShortDate(d), tone: 'muted' }
}

export const greeting = () => {
  const h = new Date().getHours()
  if (h < 12) return 'صباح الفل'
  if (h < 17) return 'نهارك سعيد'
  return 'مساء الخير'
}

/** distance in meters between two coordinates */
export const haversine = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371000
  const toRad = (x: number) => (x * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(s)))
}

export const initialsOf = (name: string) => {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).trim() || '؟'
}

export const toLocalInput = (iso?: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16)
}
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : undefined)

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'لسه',
  doing: 'شغالين فيها',
  review: 'مراجعة',
  done: 'خلصت',
}
export const STATUS_ORDER: TaskStatus[] = ['todo', 'doing', 'review', 'done']

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: 'عادية',
  medium: 'متوسطة',
  high: 'مهمة',
  urgent: 'عاجلة',
}
export const PRIORITY_COLOR: Record<Priority, string> = {
  low: '#8B96B0',
  medium: '#7DE3F4',
  high: '#FBBF24',
  urgent: '#F472B6',
}
export const PRIORITY_WEIGHT: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'مدير عام',
  manager: 'مدير',
  employee: 'موظف',
}
export const UNIT_LABEL: Record<UnitType, string> = {
  division: 'قطاع',
  department: 'إدارة',
  team: 'فريق',
}

export const REMIND_OPTIONS = [
  { v: 0, label: 'من غير تذكير' },
  { v: 10, label: 'قبلها بـ 10 دقايق' },
  { v: 30, label: 'قبلها بنص ساعة' },
  { v: 60, label: 'قبلها بساعة' },
  { v: 180, label: 'قبلها بـ 3 ساعات' },
  { v: 1440, label: 'قبلها بيوم' },
]

export const COMPANY_COLORS = ['#22D3EE', '#A78BFA', '#FBBF24', '#34D399', '#F472B6', '#60A5FA', '#FB923C']

export const hexA = (hex: string, a: number) => {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

export const parseHM = (hm: string, base = new Date()) => {
  const [h, m] = hm.split(':').map(Number)
  const d = new Date(base)
  d.setHours(h || 0, m || 0, 0, 0)
  return d
}
