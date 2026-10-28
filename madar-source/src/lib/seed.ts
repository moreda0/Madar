import type { AttendanceRecord, AppNotification, Company, Membership, OrgUnit, Task, User } from './types'
import { randomSecret } from './utils'

/**
 * Sample data so the app is alive on first open.
 * Companies and people here are placeholders; Settings → "ابدئي من الصفر" wipes them.
 */
export function buildSeed() {
  const now = new Date()
  const at = (dayOffset: number, h: number, m = 0) => {
    const d = new Date(now)
    d.setDate(d.getDate() + dayOffset)
    d.setHours(h, m, 0, 0)
    return d.toISOString()
  }
  /** hours from now, rounded to the next quarter hour */
  const rel = (hours: number) => {
    const d = new Date(now.getTime() + hours * 36e5)
    d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0)
    return d.toISOString()
  }

  const users: User[] = [
    { id: 'u_ayman', name: 'أيمن الغباشي', initials: 'أغ', phone: '' },
    { id: 'u_sara', name: 'سارة محمود', initials: 'سم' },
    { id: 'u_omar', name: 'عمر خالد', initials: 'عخ' },
    { id: 'u_mona', name: 'منى سامي', initials: 'مس' },
    { id: 'u_karim', name: 'كريم عادل', initials: 'كع' },
    { id: 'u_nour', name: 'نور حسن', initials: 'نح' },
  ]

  const companies: Company[] = [
    { id: 'c_nour', name: 'النور للمقاولات', short: 'النور', color: '#22D3EE', workStart: '09:00', workEnd: '17:00', graceMinutes: 15, strictGeofence: false, qrSecret: randomSecret(), sample: true },
    { id: 'c_reyada', name: 'الريادة للاستثمار', short: 'الريادة', color: '#A78BFA', workStart: '10:00', workEnd: '18:00', graceMinutes: 15, strictGeofence: false, qrSecret: randomSecret(), sample: true },
    { id: 'c_smart', name: 'سمارت تك', short: 'سمارت تك', color: '#FBBF24', workStart: '09:30', workEnd: '17:30', graceMinutes: 10, strictGeofence: false, qrSecret: randomSecret(), sample: true },
  ]

  const units: OrgUnit[] = [
    { id: 'o_n_ops', companyId: 'c_nour', parentId: null, type: 'division', name: 'قطاع العمليات', managerId: 'u_omar' },
    { id: 'o_n_proc', companyId: 'c_nour', parentId: 'o_n_ops', type: 'department', name: 'إدارة المشتريات', managerId: 'u_omar' },
    { id: 'o_n_site', companyId: 'c_nour', parentId: 'o_n_ops', type: 'department', name: 'إدارة المواقع' },
    { id: 'o_n_fin', companyId: 'c_nour', parentId: null, type: 'division', name: 'القطاع المالي', managerId: 'u_mona' },
    { id: 'o_r_sales', companyId: 'c_reyada', parentId: null, type: 'division', name: 'قطاع المبيعات', managerId: 'u_sara' },
    { id: 'o_r_mkt', companyId: 'c_reyada', parentId: 'o_r_sales', type: 'department', name: 'إدارة التسويق', managerId: 'u_sara' },
    { id: 'o_r_mkt_d', companyId: 'c_reyada', parentId: 'o_r_mkt', type: 'team', name: 'فريق الديجيتال', managerId: 'u_nour' },
    { id: 'o_s_eng', companyId: 'c_smart', parentId: null, type: 'division', name: 'قطاع التطوير', managerId: 'u_karim' },
    { id: 'o_s_mobile', companyId: 'c_smart', parentId: 'o_s_eng', type: 'team', name: 'فريق الموبايل', managerId: 'u_karim' },
  ]

  const memberships: Membership[] = [
    ...companies.map((c) => ({ userId: 'u_ayman', companyId: c.id, role: 'admin' as const, title: 'رئيس مجلس الإدارة' })),
    { userId: 'u_omar', companyId: 'c_nour', role: 'manager', unitId: 'o_n_proc', title: 'مدير المشتريات' },
    { userId: 'u_mona', companyId: 'c_nour', role: 'manager', unitId: 'o_n_fin', title: 'المدير المالي' },
    { userId: 'u_sara', companyId: 'c_reyada', role: 'manager', unitId: 'o_r_mkt', title: 'مديرة التسويق' },
    { userId: 'u_nour', companyId: 'c_reyada', role: 'employee', unitId: 'o_r_mkt_d', title: 'أخصائية ديجيتال' },
    { userId: 'u_karim', companyId: 'c_smart', role: 'manager', unitId: 'o_s_mobile', title: 'قائد فريق الموبايل' },
    { userId: 'u_nour', companyId: 'c_smart', role: 'employee', unitId: 'o_s_mobile', title: 'مطورة' },
  ]

  const t = (p: Partial<Task> & Pick<Task, 'id' | 'companyId' | 'title'>): Task => ({
    description: '',
    status: 'todo',
    priority: 'medium',
    creatorId: 'u_ayman',
    remindBefore: 30,
    subtasks: [],
    comments: [],
    createdAt: at(-3, 10),
    ...p,
  })

  const tasks: Task[] = [
    t({ id: 't1', companyId: 'c_nour', title: 'مراجعة عقد توريد الحديد', priority: 'urgent', assigneeId: 'u_ayman', unitId: 'o_n_proc', dueAt: rel(-1.5), status: 'doing', creatorId: 'u_omar',
      description: 'مراجعة البنود المالية وشروط الدفع قبل التوقيع مع المورد.',
      subtasks: [
        { id: 's1', title: 'مراجعة الأسعار مع آخر عرض', done: true },
        { id: 's2', title: 'التأكد من شرط الجزاءات', done: false },
        { id: 's3', title: 'إرسال الملاحظات للقانوني', done: false },
      ],
      comments: [{ id: 'cm1', userId: 'u_omar', text: 'العرض الجديد وصل الصبح، مرفق في الإيميل', at: rel(-3) }] }),
    t({ id: 't2', companyId: 'c_smart', title: 'إصلاح مشكلة الدفع في التطبيق', priority: 'high', assigneeId: 'u_karim', unitId: 'o_s_mobile', dueAt: at(-1, 16), status: 'doing' }),
    t({ id: 't3', companyId: 'c_reyada', title: 'عرض السعر لعميل الساحل', priority: 'high', assigneeId: 'u_ayman', dueAt: rel(1.5), remindBefore: 60 }),
    t({ id: 't4', companyId: 'c_reyada', title: 'اعتماد خطة تسويق الربع الأخير', priority: 'medium', assigneeId: 'u_ayman', unitId: 'o_r_mkt', dueAt: rel(3), status: 'review', creatorId: 'u_sara' }),
    t({ id: 't5', companyId: 'c_nour', title: 'زيارة موقع التجمع الخامس', priority: 'medium', assigneeId: 'u_omar', unitId: 'o_n_site', dueAt: at(1, 10) }),
    t({ id: 't6', companyId: 'c_nour', title: 'تقرير التدفقات النقدية لشهر أكتوبر', priority: 'high', assigneeId: 'u_mona', unitId: 'o_n_fin', dueAt: at(2, 12) }),
    t({ id: 't7', companyId: 'c_reyada', title: 'حملة إعلانات السوشيال', priority: 'medium', assigneeId: 'u_nour', unitId: 'o_r_mkt_d', dueAt: at(3, 15), status: 'doing',
      subtasks: [
        { id: 's4', title: 'تصميم 5 بوستات', done: true },
        { id: 's5', title: 'كتابة الكابشنز', done: true },
        { id: 's6', title: 'ضبط الاستهداف', done: false },
      ] }),
    t({ id: 't8', companyId: 'c_smart', title: 'إطلاق نسخة 2.4 على المتجر', priority: 'urgent', assigneeId: 'u_karim', unitId: 'o_s_mobile', dueAt: at(5, 13) }),
    t({ id: 't9', companyId: 'c_smart', title: 'اجتماع مراجعة السبرنت', priority: 'low', assigneeId: 'u_ayman', dueAt: rel(5), remindBefore: 10 }),
    t({ id: 't10', companyId: 'c_nour', title: 'توقيع محاضر الاستلام', priority: 'low', assigneeId: 'u_ayman', status: 'done', dueAt: at(-1, 12), completedAt: at(-1, 11) }),
    t({ id: 't11', companyId: 'c_reyada', title: 'مقابلة مرشحين لوظيفة محاسب', priority: 'medium', assigneeId: 'u_sara', dueAt: at(1, 13) }),
    t({ id: 't12', companyId: 'c_smart', title: 'مراجعة تصميمات الشاشة الرئيسية', priority: 'medium', assigneeId: 'u_nour', unitId: 'o_s_mobile', status: 'done', dueAt: at(-2, 15), completedAt: at(-2, 14) }),
  ]

  const notifications: AppNotification[] = [
    { id: 'n1', userId: 'u_ayman', companyId: 'c_reyada', kind: 'status', title: 'سارة بعتت مهمة للمراجعة', body: 'اعتماد خطة تسويق الربع الأخير', taskId: 't4', at: rel(-4), read: false },
    { id: 'n2', userId: 'u_ayman', companyId: 'c_nour', kind: 'comment', title: 'عمر علّق على مهمة', body: 'العرض الجديد وصل الصبح، مرفق في الإيميل', taskId: 't1', at: rel(-3), read: false },
    { id: 'n3', userId: 'u_ayman', companyId: 'c_smart', kind: 'overdue', title: 'مهمة متأخرة في سمارت تك', body: 'إصلاح مشكلة الدفع في التطبيق (كريم)', taskId: 't2', at: at(-1, 16, 5), read: true },
  ]

  const attendance: AttendanceRecord[] = [
    { id: 'a1', userId: 'u_omar', companyId: 'c_nour', checkInAt: at(-1, 8, 55), checkOutAt: at(-1, 17, 10), method: 'qr', late: false, plannedTaskIds: [] },
    { id: 'a2', userId: 'u_karim', companyId: 'c_smart', checkInAt: at(-1, 9, 50), checkOutAt: at(-1, 18, 0), method: 'gps', late: true, plannedTaskIds: ['t2'] },
  ]

  // already-late sample tasks were "announced" before; don't re-alert them on first open
  const firedReminders: Record<string, true> = {}
  tasks.filter((x) => x.dueAt && new Date(x.dueAt) < now).forEach((x) => { firedReminders[`late:${x.id}`] = true; firedReminders[`rem:${x.id}`] = true })

  return { users, companies, units, memberships, tasks, notifications, attendance, firedReminders }
}
