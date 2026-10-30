import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'
import type {
  AppNotification,
  AnnualReview,
  AttendanceRecord,
  Company,
  Kpi,
  MonthlyRating,
  Promotion,
  Comment,
  ID,
  Meeting,
  Membership,
  OrgUnit,
  Task,
  User,
} from './types'
import { buildSeed } from './seed'
import { randomSecret, uid, STATUS_LABEL } from './utils'

/**
 * Local data layer. Everything lives in the browser for now (works offline);
 * the shape mirrors supabase/schema.sql so swapping to the real backend is a
 * matter of replacing these actions with API calls.
 */

interface Data {
  users: User[]
  companies: Company[]
  units: OrgUnit[]
  memberships: Membership[]
  tasks: Task[]
  notifications: AppNotification[]
  attendance: AttendanceRecord[]
  firedReminders: Record<string, true>
  kpis: Kpi[]
  ratings: MonthlyRating[]
  reviews: AnnualReview[]
  promotions: Promotion[]
  meetings: Meeting[]
}

interface Session {
  currentUserId: ID | null
  onboarded: boolean
}

interface Actions {
  login: (userId: ID) => void
  logout: () => void

  addUser: (u: Omit<User, 'id'>) => ID
  updateUser: (id: ID, patch: Partial<User>) => void

  addCompany: (c: Omit<Company, 'id' | 'qrSecret'>, ownerId: ID) => ID
  updateCompany: (id: ID, patch: Partial<Company>) => void
  removeCompany: (id: ID) => void
  rotateQr: (id: ID) => void

  addUnit: (u: Omit<OrgUnit, 'id'>) => ID
  updateUnit: (id: ID, patch: Partial<OrgUnit>) => void
  removeUnit: (id: ID) => void

  upsertMembership: (m: Membership) => void
  removeMembership: (userId: ID, companyId: ID) => void

  addTask: (t: Omit<Task, 'id' | 'createdAt' | 'comments'>, actorId: ID) => ID
  updateTask: (id: ID, patch: Partial<Task>, actorId: ID) => void
  removeTask: (id: ID) => void
  addComment: (taskId: ID, userId: ID, text: string) => void

  notify: (n: Omit<AppNotification, 'id' | 'at' | 'read'> & { id?: ID }) => void
  markRead: (id: ID) => void
  markAllRead: (userId: ID) => void
  clearRead: (userId: ID) => void
  markReminderFired: (key: string) => void

  checkIn: (r: Omit<AttendanceRecord, 'id'>) => ID
  checkOut: (id: ID, note?: string) => void

  addKpi: (k: Omit<Kpi, 'id'>) => ID
  updateKpi: (id: ID, patch: Partial<Kpi>) => void
  removeKpi: (id: ID) => void
  rateMonth: (r: Omit<MonthlyRating, 'id' | 'at'>) => void
  rateTask: (taskId: ID, rating: number, raterId: ID) => void
  saveReview: (r: Omit<AnnualReview, 'id' | 'at'>) => void
  proposePromotion: (p: Omit<Promotion, 'id' | 'at' | 'status'>) => void
  decidePromotion: (id: ID, approve: boolean, deciderId: ID) => void

  addMeeting: (m: Omit<Meeting, 'id'>) => ID
  updateMeeting: (id: ID, patch: Partial<Meeting>) => void
  removeMeeting: (id: ID) => void

  resetToSample: () => void
  startFresh: () => void
}

export type State = Data & Session & Actions

const safeStorage: StateStorage = {
  getItem: (k) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  setItem: (k, v) => {
    try {
      localStorage.setItem(k, v)
    } catch {
      /* storage unavailable: keep working in memory */
    }
  },
  removeItem: (k) => {
    try {
      localStorage.removeItem(k)
    } catch {
      /* ignore */
    }
  },
}

const seedData = (): Data => buildSeed()

export const useStore = create<State>()(
  persist(
    (set, get) => {
      const nameOf = (id?: ID) => get().users.find((u) => u.id === id)?.name.split(' ')[0] ?? 'حد'
      // a fixed id makes the notification idempotent (several synced devices may raise the same reminder)
      const push = (n: Omit<AppNotification, 'id' | 'at' | 'read'> & { id?: ID }) =>
        set((s) => {
          if (n.id && s.notifications.some((x) => x.id === n.id)) return s
          return { notifications: [{ ...n, id: n.id ?? uid('n_'), at: new Date().toISOString(), read: false }, ...s.notifications].slice(0, 300) }
        })

      return {
        ...seedData(),
        currentUserId: null,
        onboarded: false,

        login: (userId) => set({ currentUserId: userId, onboarded: true }),
        logout: () => set({ currentUserId: null }),

        addUser: (u) => {
          const id = uid('u_')
          set((s) => ({ users: [...s.users, { ...u, id }] }))
          return id
        },
        updateUser: (id, patch) => set((s) => ({ users: s.users.map((u) => (u.id === id ? { ...u, ...patch } : u)) })),

        addCompany: (c, ownerId) => {
          const id = uid('c_')
          set((s) => ({
            companies: [...s.companies, { ...c, id, qrSecret: randomSecret() }],
            memberships: [...s.memberships, { userId: ownerId, companyId: id, role: 'admin' }],
          }))
          return id
        },
        updateCompany: (id, patch) =>
          set((s) => ({ companies: s.companies.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
        removeCompany: (id) =>
          set((s) => ({
            companies: s.companies.filter((c) => c.id !== id),
            units: s.units.filter((u) => u.companyId !== id),
            memberships: s.memberships.filter((m) => m.companyId !== id),
            tasks: s.tasks.filter((t) => t.companyId !== id),
            attendance: s.attendance.filter((a) => a.companyId !== id),
            notifications: s.notifications.filter((n) => n.companyId !== id),
            kpis: s.kpis.filter((k) => k.companyId !== id),
            ratings: s.ratings.filter((r) => r.companyId !== id),
            reviews: s.reviews.filter((r) => r.companyId !== id),
            promotions: s.promotions.filter((p) => p.companyId !== id),
            meetings: s.meetings.filter((m) => m.companyId !== id),
          })),
        rotateQr: (id) => get().updateCompany(id, { qrSecret: randomSecret() }),

        addUnit: (u) => {
          const id = uid('o_')
          set((s) => ({ units: [...s.units, { ...u, id }] }))
          return id
        },
        updateUnit: (id, patch) => set((s) => ({ units: s.units.map((u) => (u.id === id ? { ...u, ...patch } : u)) })),
        removeUnit: (id) =>
          set((s) => {
            const unit = s.units.find((u) => u.id === id)
            const parent = unit?.parentId ?? null
            return {
              units: s.units.filter((u) => u.id !== id).map((u) => (u.parentId === id ? { ...u, parentId: parent } : u)),
              memberships: s.memberships.map((m) => (m.unitId === id ? { ...m, unitId: parent ?? undefined } : m)),
              tasks: s.tasks.map((t) => (t.unitId === id ? { ...t, unitId: parent ?? undefined } : t)),
            }
          }),

        upsertMembership: (m) =>
          set((s) => {
            const exists = s.memberships.some((x) => x.userId === m.userId && x.companyId === m.companyId)
            return {
              memberships: exists
                ? s.memberships.map((x) => (x.userId === m.userId && x.companyId === m.companyId ? { ...x, ...m } : x))
                : [...s.memberships, m],
            }
          }),
        removeMembership: (userId, companyId) =>
          set((s) => ({ memberships: s.memberships.filter((m) => !(m.userId === userId && m.companyId === companyId)) })),

        addTask: (t, actorId) => {
          const id = uid('t_')
          set((s) => ({ tasks: [{ ...t, id, comments: [], createdAt: new Date().toISOString() }, ...s.tasks] }))
          if (t.assigneeId && t.assigneeId !== actorId)
            push({ userId: t.assigneeId, companyId: t.companyId, kind: 'assigned', title: `${nameOf(actorId)} كلّفك بمهمة جديدة`, body: t.title, taskId: id })
          return id
        },
        updateTask: (id, patch, actorId) => {
          const before = get().tasks.find((t) => t.id === id)
          if (!before) return
          const next: Task = { ...before, ...patch }
          if (patch.status && patch.status !== before.status) {
            next.completedAt = patch.status === 'done' ? new Date().toISOString() : undefined
          }
          set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? next : t)) }))

          if (patch.assigneeId && patch.assigneeId !== before.assigneeId && patch.assigneeId !== actorId)
            push({ userId: patch.assigneeId, companyId: next.companyId, kind: 'assigned', title: `${nameOf(actorId)} كلّفك بمهمة`, body: next.title, taskId: id })

          if (patch.status && patch.status !== before.status) {
            const watchers = new Set([next.creatorId, next.assigneeId].filter(Boolean) as ID[])
            watchers.delete(actorId)
            watchers.forEach((w) =>
              push({
                userId: w,
                companyId: next.companyId,
                kind: 'status',
                title: patch.status === 'done' ? `${nameOf(actorId)} خلّص مهمة` : `${nameOf(actorId)} نقل مهمة لـ "${STATUS_LABEL[patch.status!]}"`,
                body: next.title,
                taskId: id,
              }),
            )
          }
          if (patch.dueAt !== undefined && patch.dueAt !== before.dueAt) {
            // a new due date re-arms the reminders
            set((s) => {
              const fr = { ...s.firedReminders }
              delete fr[`rem:${id}`]
              delete fr[`late:${id}`]
              return { firedReminders: fr }
            })
          }
        },
        removeTask: (id) =>
          set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id), notifications: s.notifications.filter((n) => n.taskId !== id) })),
        addComment: (taskId, userId, text) => {
          const c: Comment = { id: uid('cm_'), userId, text, at: new Date().toISOString() }
          const task = get().tasks.find((t) => t.id === taskId)
          if (!task) return
          set((s) => ({ tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, comments: [...t.comments, c] } : t)) }))
          const watchers = new Set([task.creatorId, task.assigneeId].filter(Boolean) as ID[])
          watchers.delete(userId)
          watchers.forEach((w) =>
            push({ userId: w, companyId: task.companyId, kind: 'comment', title: `${nameOf(userId)} علّق على "${task.title}"`, body: text, taskId }),
          )
        },

        notify: push,
        markRead: (id) => set((s) => ({ notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)) })),
        markAllRead: (userId) =>
          set((s) => ({ notifications: s.notifications.map((n) => (n.userId === userId ? { ...n, read: true } : n)) })),
        clearRead: (userId) => set((s) => ({ notifications: s.notifications.filter((n) => !(n.userId === userId && n.read)) })),
        markReminderFired: (key) => set((s) => ({ firedReminders: { ...s.firedReminders, [key]: true } })),

        checkIn: (r) => {
          const id = uid('a_')
          set((s) => ({ attendance: [{ ...r, id }, ...s.attendance] }))
          const s = get()
          const company = s.companies.find((c) => c.id === r.companyId)
          // tell the company admins/managers of the person's unit
          const who = nameOf(r.userId)
          s.memberships
            .filter((m) => m.companyId === r.companyId && m.role !== 'employee' && m.userId !== r.userId)
            .forEach((m) =>
              push({
                userId: m.userId,
                companyId: r.companyId,
                kind: 'attendance',
                title: r.late ? `${who} سجّل حضور متأخر` : `${who} سجّل حضور`,
                body: `${company?.short ?? ''} · ${r.plannedTaskIds.length} مهام في خطة اليوم`,
              }),
            )
          return id
        },
        checkOut: (id, note) =>
          set((s) => ({ attendance: s.attendance.map((a) => (a.id === id ? { ...a, checkOutAt: new Date().toISOString(), note } : a)) })),

        addKpi: (k) => {
          const id = uid('k_')
          set((s) => ({ kpis: [...s.kpis, { ...k, id }] }))
          return id
        },
        updateKpi: (id, patch) => set((s) => ({ kpis: s.kpis.map((k) => (k.id === id ? { ...k, ...patch } : k)) })),
        removeKpi: (id) =>
          set((s) => {
            const parent = s.kpis.find((k) => k.id === id)?.parentId ?? null
            return { kpis: s.kpis.filter((k) => k.id !== id).map((k) => (k.parentId === id ? { ...k, parentId: parent } : k)) }
          }),
        rateMonth: (r) => {
          set((s) => ({
            ratings: [
              ...s.ratings.filter((x) => !(x.userId === r.userId && x.companyId === r.companyId && x.month === r.month)),
              { ...r, id: uid('r_'), at: new Date().toISOString() },
            ],
          }))
          if (r.userId !== r.raterId)
            push({ userId: r.userId, companyId: r.companyId, kind: 'performance', title: `${nameOf(r.raterId)} قيّم شغلك الشهر ده`, body: r.note || 'افتحي "أدائي" عشان تشوفي التفاصيل' })
        },
        rateTask: (taskId, rating, raterId) => {
          const t = get().tasks.find((x) => x.id === taskId)
          if (!t) return
          set((s) => ({ tasks: s.tasks.map((x) => (x.id === taskId ? { ...x, rating, ratedBy: raterId } : x)) }))
          if (t.assigneeId && t.assigneeId !== raterId)
            push({ userId: t.assigneeId, companyId: t.companyId, kind: 'performance', title: `${nameOf(raterId)} قيّم مهمتك ${rating} من 5`, body: t.title, taskId })
        },
        saveReview: (r) => {
          set((s) => ({
            reviews: [
              ...s.reviews.filter((x) => !(x.userId === r.userId && x.companyId === r.companyId && x.year === r.year)),
              { ...r, id: uid('rv_'), at: new Date().toISOString() },
            ],
          }))
          push({ userId: r.userId, companyId: r.companyId, kind: 'performance', title: `التقييم السنوي ${r.year} جاهز`, body: 'افتحي "أدائي" عشان تشوفيه' })
        },
        proposePromotion: (p) => {
          set((s) => ({ promotions: [{ ...p, id: uid('p_'), status: 'proposed', at: new Date().toISOString() }, ...s.promotions] }))
          get()
            .memberships.filter((m) => m.companyId === p.companyId && m.role === 'admin' && m.userId !== p.proposedBy)
            .forEach((m) =>
              push({ userId: m.userId, companyId: p.companyId, kind: 'performance', title: `${nameOf(p.proposedBy)} اقترح ترقية لـ ${nameOf(p.userId)}`, body: `${p.fromTitle ?? '—'} ← ${p.toTitle}` }),
            )
        },
        decidePromotion: (id, approve, deciderId) => {
          const p = get().promotions.find((x) => x.id === id)
          if (!p || p.status !== 'proposed') return
          set((s) => ({
            promotions: s.promotions.map((x) => (x.id === id ? { ...x, status: approve ? 'approved' : 'rejected', decidedBy: deciderId, decidedAt: new Date().toISOString() } : x)),
            memberships: approve
              ? s.memberships.map((m) => (m.userId === p.userId && m.companyId === p.companyId ? { ...m, title: p.toTitle, role: p.toRole ?? m.role } : m))
              : s.memberships,
          }))
          if (approve) push({ userId: p.userId, companyId: p.companyId, kind: 'performance', title: 'مبروك! اتعتمدت ترقيتك', body: `بقيتي ${p.toTitle} من ${p.effectiveDate}` })
          if (p.proposedBy !== deciderId)
            push({ userId: p.proposedBy, companyId: p.companyId, kind: 'performance', title: approve ? `ترقية ${nameOf(p.userId)} اتعتمدت` : `ترقية ${nameOf(p.userId)} اترفضت`, body: p.toTitle })
        },

        addMeeting: (m) => {
          const id = uid('mt_')
          set((s) => ({ meetings: [{ ...m, id }, ...s.meetings] }))
          return id
        },
        updateMeeting: (id, patch) => set((s) => ({ meetings: s.meetings.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),
        // its tasks stay: they're real work now, they just lose the link back
        removeMeeting: (id) =>
          set((s) => ({ meetings: s.meetings.filter((m) => m.id !== id), tasks: s.tasks.map((t) => (t.meetingId === id ? { ...t, meetingId: undefined } : t)) })),

        resetToSample: () => set({ ...seedData() }),
        startFresh: () => {
          const s = get()
          const me = s.users.find((u) => u.id === s.currentUserId) ?? { id: 'u_me', name: 'أنا', initials: 'أ' }
          set({
            users: [me],
            companies: [],
            units: [],
            memberships: [],
            tasks: [],
            notifications: [],
            attendance: [],
            firedReminders: {},
            kpis: [],
            ratings: [],
            reviews: [],
            promotions: [],
            meetings: [],
            currentUserId: me.id,
          })
        },
      }
    },
    {
      name: 'madar-v1',
      storage: createJSONStorage(() => safeStorage),
    },
  ),
)

/* ---------- UI (not persisted) ---------- */

export interface Toast {
  id: string
  title: string
  body?: string
  tone?: 'info' | 'ok' | 'warn'
}

interface UI {
  companyFilter: ID | 'all'
  openTaskId: ID | null
  newTask: null | { companyId?: ID; dueAt?: string; status?: Task['status']; title?: string; priority?: Task['priority']; assigneeId?: ID }
  toasts: Toast[]
  confirmReq: null | { message: string; resolve: (ok: boolean) => void }
  setCompanyFilter: (c: ID | 'all') => void
  openTask: (id: ID | null) => void
  openNewTask: (preset?: UI['newTask']) => void
  closeNewTask: () => void
  toast: (t: Omit<Toast, 'id'>) => void
  dismissToast: (id: string) => void
  ask: (message: string) => Promise<boolean>
}

export const useUI = create<UI>()((set) => ({
  companyFilter: 'all',
  openTaskId: null,
  newTask: null,
  toasts: [],
  confirmReq: null,
  setCompanyFilter: (c) => set({ companyFilter: c }),
  openTask: (id) => set({ openTaskId: id }),
  openNewTask: (preset) => set({ newTask: preset ?? {} }),
  closeNewTask: () => set({ newTask: null }),
  toast: (t) => {
    const id = uid('toast_')
    set((s) => ({ toasts: [...s.toasts, { ...t, id }].slice(-4) }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), 5000)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
  ask: (message) =>
    new Promise<boolean>((resolve) =>
      set({ confirmReq: { message, resolve: (ok) => { set({ confirmReq: null }); resolve(ok) } } }),
    ),
}))

/** In-app confirmation (works everywhere, unlike window.confirm) */
export const ask = (message: string) => useUI.getState().ask(message)
