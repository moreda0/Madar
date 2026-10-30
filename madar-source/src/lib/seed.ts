import type { AttendanceRecord, AppNotification, Company, Kpi, Membership, MonthlyRating, OrgUnit, Promotion, Task, User } from './types'
import { monthKey, shiftMonth } from './performance'
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


  /* ---------- history: a few months of work so performance screens have something real to show ---------- */
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  const profiles = [
    { userId: 'u_omar', companyId: 'c_nour', unitId: 'o_n_proc', rater: 'u_ayman', onTime: 0.9, late: 0.08, start: 9 },
    { userId: 'u_mona', companyId: 'c_nour', unitId: 'o_n_fin', rater: 'u_ayman', onTime: 0.8, late: 0.18, start: 9 },
    { userId: 'u_sara', companyId: 'c_reyada', unitId: 'o_r_mkt', rater: 'u_ayman', onTime: 0.86, late: 0.12, start: 10 },
    { userId: 'u_nour', companyId: 'c_reyada', unitId: 'o_r_mkt_d', rater: 'u_sara', onTime: 0.74, late: 0.28, start: 10 },
    { userId: 'u_karim', companyId: 'c_smart', unitId: 'o_s_mobile', rater: 'u_ayman', onTime: 0.66, late: 0.34, start: 9.5 },
    { userId: 'u_nour', companyId: 'c_smart', unitId: 'o_s_mobile', rater: 'u_karim', onTime: 0.8, late: 0.2, start: 9.5 },
  ]
  const taskNames = ['تقرير أسبوعي', 'متابعة مع العميل', 'مراجعة فواتير', 'تحديث الخطة', 'اجتماع تنسيق', 'تجهيز عرض', 'مراجعة عقد', 'تسليم مرحلة', 'تحليل نتائج', 'رد على استفسارات']
  const ratings: MonthlyRating[] = []
  const today0 = new Date(now)
  today0.setHours(0, 0, 0, 0)
  let hid = 0
  for (const pr of profiles) {
    for (let back = 4; back >= 0; back--) {
      const mk = shiftMonth(monthKey(now), -back)
      const [y, m] = mk.split('-').map(Number)
      const days = new Date(y, m, 0).getDate()
      const monthTasks: Task[] = []
      for (let d = 1; d <= days; d++) {
        const day = new Date(y, m - 1, d)
        if (day >= today0 || day.getDay() === 5 || day.getDay() === 6) continue // Egyptian weekend: Fri & Sat
        if (rnd() < 0.3) {
          const dueAt = new Date(day)
          dueAt.setHours(14 + Math.floor(rnd() * 4), 0, 0, 0)
          const ok = rnd() < pr.onTime
          const completedAt = new Date(dueAt.getTime() + (ok ? -rnd() * 20 : 2 + rnd() * 40) * 36e5)
          const rated = rnd() < 0.6
          const task: Task = {
            id: `h${hid++}`, companyId: pr.companyId, title: taskNames[Math.floor(rnd() * taskNames.length)], description: '',
            status: 'done', priority: rnd() < 0.2 ? 'high' : 'medium', assigneeId: pr.userId, creatorId: pr.rater, unitId: pr.unitId,
            dueAt: dueAt.toISOString(), remindBefore: 30, subtasks: [], comments: [], createdAt: new Date(day.getTime() - 3 * 864e5).toISOString(),
            completedAt: completedAt.toISOString(),
            ...(rated ? { rating: Math.max(2, Math.min(5, Math.round(pr.onTime * 5 + (rnd() - 0.4) * 1.5))), ratedBy: pr.rater } : {}),
          }
          monthTasks.push(task)
          tasks.push(task)
        }
        if (rnd() < 0.9) {
          const late = rnd() < pr.late
          const inAt = new Date(day)
          inAt.setHours(Math.floor(pr.start), (pr.start % 1) * 60 + (late ? 20 + rnd() * 50 : -rnd() * 15), 0, 0)
          const outAt = new Date(inAt.getTime() + (8 + rnd()) * 36e5)
          const todays = monthTasks.filter((x) => x.dueAt && new Date(x.dueAt).getDate() === d).map((x) => x.id)
          attendance.push({ id: `ha${hid++}`, userId: pr.userId, companyId: pr.companyId, checkInAt: inAt.toISOString(), checkOutAt: outAt.toISOString(), method: rnd() < 0.5 ? 'qr' : 'gps', late, plannedTaskIds: todays })
        }
      }
      const base = 2.6 + pr.onTime * 2.2
      const sc = () => Math.max(1, Math.min(5, Math.round(base + (rnd() - 0.5) * 1.4)))
      if (back > 0) ratings.push({ id: `r${hid++}`, companyId: pr.companyId, userId: pr.userId, raterId: pr.rater, month: mk, scores: { quality: sc(), speed: sc(), teamwork: sc(), initiative: sc(), discipline: sc() }, at: new Date(y, m, 1, 10).toISOString() })
    }
  }

  const kpis: Kpi[] = [
    { id: 'k_n1', companyId: 'c_nour', parentId: null, title: 'إيرادات المشاريع', unit: 'مليون جنيه', target: 50, current: 38.5, higherIsBetter: true, period: 'year', weight: 5 },
    { id: 'k_n2', companyId: 'c_nour', parentId: 'k_n1', title: 'تخفيض تكلفة المشتريات', unit: '%', target: 8, current: 6.5, higherIsBetter: true, period: 'year', ownerUnitId: 'o_n_proc', weight: 3 },
    { id: 'k_n3', companyId: 'c_nour', parentId: 'k_n1', title: 'مشاريع تتسلم في ميعادها', unit: 'مشروع', target: 10, current: 7, higherIsBetter: true, period: 'year', ownerUnitId: 'o_n_site', weight: 4 },
    { id: 'k_n4', companyId: 'c_nour', parentId: 'k_n2', title: 'عروض موردين متقارنة', unit: 'عرض', target: 12, current: 11, higherIsBetter: true, period: 'month', ownerUserId: 'u_omar', weight: 3 },
    { id: 'k_n5', companyId: 'c_nour', parentId: null, title: 'مدة صرف المستخلصات', unit: 'يوم', target: 15, current: 19, higherIsBetter: false, period: 'quarter', ownerUnitId: 'o_n_fin', weight: 3 },
    { id: 'k_n6', companyId: 'c_nour', parentId: 'k_n5', title: 'مستخلصات اتراجعت في الأسبوع', unit: 'مستخلص', target: 6, current: 5, higherIsBetter: true, period: 'month', ownerUserId: 'u_mona', weight: 2 },
    { id: 'k_r1', companyId: 'c_reyada', parentId: null, title: 'عملاء جدد', unit: 'عميل', target: 40, current: 31, higherIsBetter: true, period: 'quarter', weight: 5 },
    { id: 'k_r2', companyId: 'c_reyada', parentId: 'k_r1', title: 'عملاء محتملين مؤهلين', unit: 'عميل محتمل', target: 300, current: 260, higherIsBetter: true, period: 'quarter', ownerUnitId: 'o_r_mkt', weight: 4 },
    { id: 'k_r3', companyId: 'c_reyada', parentId: 'k_r2', title: 'تكلفة العميل المحتمل', unit: 'جنيه', target: 80, current: 72, higherIsBetter: false, period: 'month', ownerUnitId: 'o_r_mkt_d', weight: 3 },
    { id: 'k_r4', companyId: 'c_reyada', parentId: 'k_r3', title: 'حملات منشورة', unit: 'حملة', target: 8, current: 6, higherIsBetter: true, period: 'month', ownerUserId: 'u_nour', weight: 2 },
    { id: 'k_r5', companyId: 'c_reyada', parentId: 'k_r2', title: 'معدل التحويل', unit: '%', target: 12, current: 10.4, higherIsBetter: true, period: 'quarter', ownerUserId: 'u_sara', weight: 3 },
    { id: 'k_s1', companyId: 'c_smart', parentId: null, title: 'تقييم التطبيق على المتجر', unit: 'نجمة', target: 4.6, current: 4.3, higherIsBetter: true, period: 'quarter', weight: 4 },
    { id: 'k_s2', companyId: 'c_smart', parentId: 'k_s1', title: 'أعطال حرجة مفتوحة', unit: 'عطل', target: 2, current: 3, higherIsBetter: false, period: 'month', ownerUnitId: 'o_s_mobile', weight: 3 },
    { id: 'k_s3', companyId: 'c_smart', parentId: 'k_s1', title: 'إصدارات في ميعادها', unit: 'إصدار', target: 3, current: 2, higherIsBetter: true, period: 'quarter', ownerUserId: 'u_karim', weight: 3 },
    { id: 'k_s4', companyId: 'c_smart', parentId: 'k_s2', title: 'شاشات اتسلمت', unit: 'شاشة', target: 10, current: 9, higherIsBetter: true, period: 'month', ownerUserId: 'u_nour', weight: 2 },
  ]

  const promotions: Promotion[] = [
    { id: 'p1', companyId: 'c_reyada', userId: 'u_nour', proposedBy: 'u_sara', fromTitle: 'أخصائية ديجيتال', toTitle: 'أخصائية ديجيتال أولى', reason: 'قادت حملة الساحل لوحدها وجابت أعلى عدد عملاء محتملين في الربع', effectiveDate: `${now.getFullYear()}-${String(now.getMonth() + 2 > 12 ? 1 : now.getMonth() + 2).padStart(2, '0')}-01`, status: 'proposed', at: rel(-30) },
  ]
  notifications.push({ id: 'n4', userId: 'u_ayman', companyId: 'c_reyada', kind: 'performance', title: 'سارة اقترحت ترقية لنور', body: 'أخصائية ديجيتال ← أخصائية ديجيتال أولى', at: rel(-30), read: false })

  // already-late sample tasks were "announced" before; don't re-alert them on first open
  const firedReminders: Record<string, true> = {}
  tasks.filter((x) => x.dueAt && new Date(x.dueAt) < now).forEach((x) => { firedReminders[`late:${x.id}`] = true; firedReminders[`rem:${x.id}`] = true })

  return { users, companies, units, memberships, tasks, notifications, attendance, firedReminders, kpis, ratings, reviews: [] as import('./types').AnnualReview[], promotions, meetings: [] as import('./types').Meeting[] }
}
