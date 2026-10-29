import type { AttendanceRecord, ID, Kpi, MonthlyRating, RatingCriterion, ReviewGrade, ReviewRecommendation, Task } from './types'

/* ---------- months ---------- */

export const monthKey = (d: Date | string = new Date()) => {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`
}
export const monthStart = (key: string) => {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1)
}
export const shiftMonth = (key: string, n: number) => {
  const d = monthStart(key)
  d.setMonth(d.getMonth() + n)
  return monthKey(d)
}
export const inMonth = (iso: string | undefined, key: string) => !!iso && monthKey(iso) === key
export const monthLabel = (key: string, short = false) =>
  new Intl.DateTimeFormat('ar-EG-u-nu-latn', short ? { month: 'short' } : { month: 'long', year: 'numeric' }).format(monthStart(key))
export const lastMonths = (n: number, from = monthKey()) => Array.from({ length: n }, (_, i) => shiftMonth(from, i - n + 1))

/* ---------- monthly commitment score (out of 100) ---------- */

export type PartKey = 'delivery' | 'punctuality' | 'plan' | 'rating' | 'quality'

export const PARTS: { key: PartKey; label: string; weight: number; hint: string }[] = [
  { key: 'delivery', label: 'تسليم في الميعاد', weight: 35, hint: 'المهام اللي خلصت قبل ميعادها من كل مهام الشهر' },
  { key: 'punctuality', label: 'الالتزام بالمواعيد', weight: 20, hint: 'أيام الحضور في الميعاد من كل أيام الحضور' },
  { key: 'plan', label: 'تنفيذ خطة اليوم', weight: 15, hint: 'المهام اللي خلصت من اللي اختارها مع الحضور' },
  { key: 'rating', label: 'تقييم المدير', weight: 20, hint: 'متوسط تقييم المدير الشهري' },
  { key: 'quality', label: 'جودة الشغل', weight: 10, hint: 'متوسط تقييم المهام بعد ما تخلص' },
]

export interface ScorePart {
  key: PartKey
  label: string
  weight: number
  hint: string
  value: number | null // 0..1, null = no data this month
  detail: string
}

export interface MonthScore {
  score: number | null
  parts: ScorePart[]
}

interface ScoreInput {
  tasks: Task[]
  attendance: AttendanceRecord[]
  ratings: MonthlyRating[]
}

export const CRITERIA: { key: RatingCriterion; label: string }[] = [
  { key: 'quality', label: 'جودة الشغل' },
  { key: 'speed', label: 'السرعة' },
  { key: 'teamwork', label: 'روح الفريق' },
  { key: 'initiative', label: 'المبادرة' },
  { key: 'discipline', label: 'الانضباط' },
]

export const ratingAvg = (r: MonthlyRating) => CRITERIA.reduce((s, c) => s + (r.scores[c.key] ?? 0), 0) / CRITERIA.length

export function monthScore(data: ScoreInput, userId: ID, companyId: ID, key: string, now = new Date()): MonthScore {
  const mine = data.tasks.filter((t) => t.companyId === companyId && t.assigneeId === userId)

  // tasks due this month that are already decidable (done, or past due)
  const due = mine.filter((t) => inMonth(t.dueAt, key) && (t.status === 'done' || new Date(t.dueAt!) < now))
  const onTime = due.filter((t) => t.status === 'done' && t.completedAt && new Date(t.completedAt) <= new Date(t.dueAt!))

  const att = data.attendance.filter((a) => a.userId === userId && a.companyId === companyId && inMonth(a.checkInAt, key))
  const punctual = att.filter((a) => !a.late)

  const planned = att.flatMap((a) => a.plannedTaskIds)
  const plannedDone = planned.filter((id) => {
    const t = data.tasks.find((x) => x.id === id)
    return t?.status === 'done'
  })

  const rating = data.ratings.find((r) => r.userId === userId && r.companyId === companyId && r.month === key)

  const rated = mine.filter((t) => t.rating && inMonth(t.completedAt, key))
  const quality = rated.length ? rated.reduce((s, t) => s + (t.rating ?? 0), 0) / rated.length : null

  const values: Record<PartKey, { v: number | null; d: string }> = {
    delivery: { v: due.length ? onTime.length / due.length : null, d: due.length ? `${onTime.length} من ${due.length} مهمة` : 'مفيش مهام مستحقة' },
    punctuality: { v: att.length ? punctual.length / att.length : null, d: att.length ? `${punctual.length} من ${att.length} يوم` : 'مفيش حضور مسجل' },
    plan: { v: planned.length ? plannedDone.length / planned.length : null, d: planned.length ? `${plannedDone.length} من ${planned.length} مهمة` : 'مفيش خطط يومية' },
    rating: { v: rating ? (ratingAvg(rating) - 1) / 4 : null, d: rating ? `${ratingAvg(rating).toFixed(1)} من 5` : 'لسه ما اتقيمش' },
    quality: { v: quality !== null ? (quality - 1) / 4 : null, d: quality !== null ? `${quality.toFixed(1)} من 5 (${rated.length} مهمة)` : 'مفيش مهام متقيمة' },
  }

  const parts: ScorePart[] = PARTS.map((p) => ({ ...p, value: values[p.key].v, detail: values[p.key].d }))
  const known = parts.filter((p) => p.value !== null)
  if (!known.length) return { score: null, parts }
  // parts with no data don't count against the person: their weight is spread over the rest
  const totalW = known.reduce((s, p) => s + p.weight, 0)
  const score = Math.round((known.reduce((s, p) => s + p.weight * (p.value as number), 0) / totalW) * 100)
  return { score, parts }
}

export const scoreTone = (s: number | null) =>
  s === null ? 'var(--muted)' : s >= 85 ? 'var(--green)' : s >= 70 ? 'var(--cyan-2)' : s >= 55 ? 'var(--amber)' : 'var(--rose)'

/* ---------- KPIs ---------- */

/** 0..120 (capped), 100 = target met */
export function kpiAchievement(k: Kpi): number {
  if (k.higherIsBetter) return k.target ? Math.min(120, Math.round((k.current / k.target) * 100)) : 0
  if (k.current <= 0) return 120
  return Math.min(120, Math.round((k.target / k.current) * 100))
}

/** A KPI with children takes the weighted average of its children */
export function kpiRollup(k: Kpi, all: Kpi[]): number {
  const kids = all.filter((x) => x.parentId === k.id)
  if (!kids.length) return kpiAchievement(k)
  const w = kids.reduce((s, x) => s + x.weight, 0)
  return Math.round(kids.reduce((s, x) => s + kpiRollup(x, all) * x.weight, 0) / (w || 1))
}

export function personalKpiAchievement(kpis: Kpi[], userId: ID, companyId: ID): number | null {
  const mine = kpis.filter((k) => k.ownerUserId === userId && k.companyId === companyId)
  if (!mine.length) return null
  const w = mine.reduce((s, k) => s + k.weight, 0)
  return Math.round(mine.reduce((s, k) => s + Math.min(100, kpiRollup(k, kpis)) * k.weight, 0) / (w || 1))
}

export const PERIOD_LABEL = { month: 'شهري', quarter: 'ربع سنوي', year: 'سنوي' } as const

/* ---------- reviews ---------- */

export const GRADE_LABEL: Record<ReviewGrade, string> = {
  excellent: 'ممتاز',
  very_good: 'جيد جداً',
  good: 'جيد',
  fair: 'مقبول',
  weak: 'محتاج تحسين',
}
export const GRADE_COLOR: Record<ReviewGrade, string> = {
  excellent: '#34D399',
  very_good: '#7DE3F4',
  good: '#A78BFA',
  fair: '#FBBF24',
  weak: '#FDA4AF',
}
export const RECOMMENDATION_LABEL: Record<ReviewRecommendation, string> = {
  promotion: 'ترقية',
  raise: 'زيادة مرتب',
  keep: 'يكمل في مكانه',
  improve: 'خطة تحسين',
}

export const suggestGrade = (score: number | null): ReviewGrade =>
  score === null ? 'good' : score >= 90 ? 'excellent' : score >= 80 ? 'very_good' : score >= 70 ? 'good' : score >= 60 ? 'fair' : 'weak'

export function yearAverage(data: ScoreInput, userId: ID, companyId: ID, year: number, now = new Date()) {
  const keys = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`).filter((k) => monthStart(k) <= now)
  const scores = keys.map((k) => monthScore(data, userId, companyId, k, now).score).filter((s): s is number => s !== null)
  return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null
}
