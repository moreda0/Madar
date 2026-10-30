export type ID = string

export type Role = 'admin' | 'manager' | 'employee'
export type UnitType = 'division' | 'department' | 'team'
export type TaskStatus = 'todo' | 'doing' | 'review' | 'done'
export type Priority = 'low' | 'medium' | 'high' | 'urgent'
export type CheckMethod = 'gps' | 'qr' | 'manual'

export interface User {
  id: ID
  name: string
  phone?: string
  email?: string // used to sign in when sync is on
  waOptIn?: boolean // send my alerts on WhatsApp (needs sync + the madar-whatsapp function)
  waSince?: string // only alerts from this moment on
  initials: string
}

export interface Geofence {
  lat: number
  lng: number
  radius: number // meters
  label?: string
}

export interface Company {
  id: ID
  name: string
  short: string
  color: string
  workStart: string // "09:00"
  workEnd: string // "17:00"
  graceMinutes: number
  geofence?: Geofence
  strictGeofence: boolean
  qrSecret: string
  sample?: boolean
}

export interface OrgUnit {
  id: ID
  companyId: ID
  parentId: ID | null
  type: UnitType
  name: string
  managerId?: ID
}

export interface Membership {
  userId: ID
  companyId: ID
  role: Role
  unitId?: ID
  title?: string
}

export interface Subtask {
  id: ID
  title: string
  done: boolean
}

export interface Comment {
  id: ID
  userId: ID
  text: string
  at: string
}

export interface Task {
  id: ID
  companyId: ID
  title: string
  description: string
  status: TaskStatus
  priority: Priority
  assigneeId?: ID
  creatorId: ID
  unitId?: ID
  dueAt?: string // ISO
  remindBefore: number // minutes, 0 = none
  subtasks: Subtask[]
  comments: Comment[]
  createdAt: string
  completedAt?: string
  rating?: number // 1..5 quality rating given when the task is done
  ratedBy?: ID
  meetingId?: ID // came out of a meeting's minutes
}

export type NotificationKind =
  | 'assigned'
  | 'reminder'
  | 'overdue'
  | 'comment'
  | 'status'
  | 'attendance'
  | 'performance'
  | 'meeting'
  | 'system'

export interface AppNotification {
  id: ID
  userId: ID
  companyId?: ID
  kind: NotificationKind
  title: string
  body: string
  taskId?: ID
  at: string
  read: boolean
}

export interface AttendanceRecord {
  id: ID
  userId: ID
  companyId: ID
  checkInAt: string
  checkOutAt?: string
  method: CheckMethod
  location?: { lat: number; lng: number; accuracy?: number }
  distanceM?: number
  insideFence?: boolean
  late: boolean
  plannedTaskIds: ID[]
  note?: string
}

/* ---------- performance (phase 3) ---------- */

export type KpiPeriod = 'month' | 'quarter' | 'year'

/** Cascading KPI: a company goal can break down into unit goals, then personal goals */
export interface Kpi {
  id: ID
  companyId: ID
  parentId: ID | null
  title: string
  unit: string // e.g. "جنيه", "%", "عميل"
  target: number
  current: number
  higherIsBetter: boolean
  period: KpiPeriod
  ownerUnitId?: ID // goal of a division/department/team
  ownerUserId?: ID // personal goal
  weight: number // 1..5, used when averaging achievement
}

export type RatingCriterion = 'quality' | 'speed' | 'teamwork' | 'initiative' | 'discipline'

/** A manager's monthly rating of one person in one company */
export interface MonthlyRating {
  id: ID
  companyId: ID
  userId: ID
  raterId: ID
  month: string // "2026-10"
  scores: Record<RatingCriterion, number> // 1..5
  note?: string
  at: string
}

export type ReviewGrade = 'excellent' | 'very_good' | 'good' | 'fair' | 'weak'
export type ReviewRecommendation = 'promotion' | 'raise' | 'keep' | 'improve'

export interface AnnualReview {
  id: ID
  companyId: ID
  userId: ID
  reviewerId: ID
  year: number
  avgScore: number | null // average monthly commitment score
  kpiAchievement: number | null // 0..100
  grade: ReviewGrade
  recommendation: ReviewRecommendation
  strengths: string
  improvements: string
  at: string
}

export type PromotionStatus = 'proposed' | 'approved' | 'rejected'

export interface Promotion {
  id: ID
  companyId: ID
  userId: ID
  proposedBy: ID
  fromTitle?: string
  toTitle: string
  toRole?: Role
  reason: string
  effectiveDate: string // yyyy-mm-dd
  status: PromotionStatus
  decidedBy?: ID
  decidedAt?: string
  at: string
}

/* ---------- meetings: recording -> minutes + tasks ---------- */

/** live = recorded in Madar, upload = an audio file, text = pasted notes/transcript, whatsapp = sent in from outside (Instinct) */
export type MeetingSource = 'live' | 'upload' | 'text' | 'whatsapp'

export interface Meeting {
  id: ID
  companyId: ID
  title: string
  at: string // when it happened
  durationMin?: number
  source: MeetingSource
  attendeeIds: ID[]
  transcript: string
  summary: string
  decisions: string[]
  points: string[] // what was discussed
  taskIds: ID[]
  createdBy: ID
}
