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
  email?: string
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
}

export type NotificationKind =
  | 'assigned'
  | 'reminder'
  | 'overdue'
  | 'comment'
  | 'status'
  | 'attendance'
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
