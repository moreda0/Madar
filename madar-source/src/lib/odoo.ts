// Odoo attendance link (supabase/functions/madar-odoo). The Odoo key lives on the server only.
import { getClient, useSync } from './sync'

export interface OdooResult {
  at: string
  mode?: 'json2' | 'jsonrpc'
  companies?: { id: number; name: string; madarId: string | null }[]
  employees?: number
  matched?: number
  unmatchedEmployees?: { id: number; name: string; email: string | null; company: string | null }[]
  pulled?: number
  added?: number
  changed?: number
  removed?: number
  leaves?: number
  notes?: string[]
  lastError?: { at: string; error: string; detail?: string }
}

export interface OdooStatus {
  configured: boolean
  url?: string
  db?: string
  login?: string
  tz?: string
  since?: string | null
  lastSync?: string | null
  lastResult?: OdooResult | null
}

export const ODOO_ERRORS: Record<string, string> = {
  missing: 'اكتبي إيميل الدخول ومفتاح الـ API.',
  'bad-url': 'الرابط ده مش رابط أودو. اكتبيه زي ما بتفتحيه في المتصفح، مثلًا https://mycompany.odoo.com',
  'need-db': 'محتاجين اسم قاعدة البيانات (Database) بتاعة أودو. تلاقيها في صفحة الدخول بتاعة أودو أو اسأليها لمسؤول السيستم.',
  'bad-db': 'اسم قاعدة البيانات مش مظبوط.',
  'bad-login': 'أودو رفض الدخول. اتأكدي من الإيميل ومفتاح الـ API (ولو أودو أونلاين، الربط محتاج باقة Custom).',
  unreachable: 'مش قادرين نوصل لسيرفر أودو. لو السيرفر جوه الشركة بس، لازم يبقى متاح على النت.',
  'odoo-error': 'أودو رجّع خطأ.',
  'not-configured': 'أودو لسه مش مربوط.',
  'owner-only': 'صاحبة مدار بس اللي تقدر تغيّر ربط أودو.',
  'not-member': 'الإيميل ده مش متضاف في مدار.',
  'no-table': 'جدول ربط أودو لسه مش متعمل على السيرفر.',
  'no-model': 'تطبيق الحضور (Attendances) مش متسطب في أودو.',
  missingFn: 'خدمة ربط أودو لسه مش متركبة على السيرفر.',
}

/** Calls the function; throws an Arabic message */
export async function odoo(action: 'status' | 'sync' | 'resync' | 'disconnect' | 'configure', extra: Record<string, unknown> = {}): Promise<OdooStatus> {
  const c = getClient()
  const st = useSync.getState()
  if (!c || !st.email) throw new Error('لازم المزامنة أونلاين تكون شغالة ومتسجلة دخول.')
  if (!navigator.onLine) throw new Error('مفيش نت دلوقتي.')
  const { data, error } = await c.functions.invoke('madar-odoo', { body: { action, ...extra } })
  if (error) {
    const res = (error as { context?: Response }).context
    const j = res ? ((await res.json().catch(() => ({}))) as { error?: string; detail?: string }) : {}
    const msg = ODOO_ERRORS[j.error ?? ''] ?? (res?.status === 404 ? ODOO_ERRORS.missingFn : 'حصلت مشكلة، جربي تاني كمان شوية.')
    throw new Error(j.error === 'odoo-error' && j.detail ? `${msg} ${j.detail}` : msg)
  }
  return data as OdooStatus
}
