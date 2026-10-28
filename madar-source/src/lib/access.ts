import { useMemo } from 'react'
import { useStore, useUI } from './store'
import type { Company, ID, Membership, OrgUnit, Role, Task, User } from './types'

/** All unit ids under (and including) the given unit */
export function subtree(units: OrgUnit[], rootId: ID): Set<ID> {
  const out = new Set<ID>([rootId])
  let added = true
  while (added) {
    added = false
    for (const u of units) {
      if (u.parentId && out.has(u.parentId) && !out.has(u.id)) {
        out.add(u.id)
        added = true
      }
    }
  }
  return out
}

export function roleIn(memberships: Membership[], userId: ID, companyId: ID): Role | null {
  return memberships.find((m) => m.userId === userId && m.companyId === companyId)?.role ?? null
}

/** Units a user is responsible for in a company (managed units + their own unit for managers) */
export function managedUnits(units: OrgUnit[], memberships: Membership[], userId: ID, companyId: ID): Set<ID> {
  const out = new Set<ID>()
  units.filter((u) => u.companyId === companyId && u.managerId === userId).forEach((u) => subtree(units, u.id).forEach((x) => out.add(x)))
  const m = memberships.find((x) => x.userId === userId && x.companyId === companyId)
  if (m?.role === 'manager' && m.unitId) subtree(units, m.unitId).forEach((x) => out.add(x))
  return out
}

export function canSeeTask(
  s: { units: OrgUnit[]; memberships: Membership[] },
  userId: ID,
  t: Task,
): boolean {
  const role = roleIn(s.memberships, userId, t.companyId)
  if (!role) return false
  if (role === 'admin') return true
  if (t.assigneeId === userId || t.creatorId === userId) return true
  if (role === 'manager') {
    const mine = managedUnits(s.units, s.memberships, userId, t.companyId)
    if (t.unitId && mine.has(t.unitId)) return true
    const assigneeUnit = s.memberships.find((m) => m.userId === t.assigneeId && m.companyId === t.companyId)?.unitId
    return !!assigneeUnit && mine.has(assigneeUnit)
  }
  return false
}

/** People this user can assign work to in a company */
export function assignableUsers(
  s: { units: OrgUnit[]; memberships: Membership[]; users: User[] },
  userId: ID,
  companyId: ID,
): User[] {
  const role = roleIn(s.memberships, userId, companyId)
  const members = s.memberships.filter((m) => m.companyId === companyId)
  let ids: ID[]
  if (role === 'admin') ids = members.map((m) => m.userId)
  else if (role === 'manager') {
    const mine = managedUnits(s.units, s.memberships, userId, companyId)
    ids = members.filter((m) => m.userId === userId || (m.unitId && mine.has(m.unitId))).map((m) => m.userId)
  } else ids = [userId]
  return s.users.filter((u) => ids.includes(u.id))
}

/* ---------- hooks ---------- */

export function useMe(): User | undefined {
  const id = useStore((s) => s.currentUserId)
  const users = useStore((s) => s.users)
  return users.find((u) => u.id === id)
}

export function useMyCompanies(): Company[] {
  const id = useStore((s) => s.currentUserId)
  const companies = useStore((s) => s.companies)
  const memberships = useStore((s) => s.memberships)
  return useMemo(
    () => companies.filter((c) => memberships.some((m) => m.userId === id && m.companyId === c.id)),
    [companies, memberships, id],
  )
}

export function useCompanyMap(): Record<ID, Company> {
  const companies = useStore((s) => s.companies)
  return useMemo(() => Object.fromEntries(companies.map((c) => [c.id, c])), [companies])
}

export function useUserMap(): Record<ID, User> {
  const users = useStore((s) => s.users)
  return useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users])
}

/** Tasks visible to the current user, narrowed by the global company filter */
export function useVisibleTasks(opts: { ignoreFilter?: boolean } = {}): Task[] {
  const me = useStore((s) => s.currentUserId)
  const tasks = useStore((s) => s.tasks)
  const units = useStore((s) => s.units)
  const memberships = useStore((s) => s.memberships)
  const filter = useUI((s) => s.companyFilter)
  return useMemo(() => {
    if (!me) return []
    return tasks.filter(
      (t) => (opts.ignoreFilter || filter === 'all' || t.companyId === filter) && canSeeTask({ units, memberships }, me, t),
    )
  }, [tasks, units, memberships, me, filter, opts.ignoreFilter])
}

export function useRoleIn(companyId?: ID): Role | null {
  const me = useStore((s) => s.currentUserId)
  const memberships = useStore((s) => s.memberships)
  if (!me || !companyId) return null
  return roleIn(memberships, me, companyId)
}

export function useIsAdminAnywhere(): boolean {
  const me = useStore((s) => s.currentUserId)
  const memberships = useStore((s) => s.memberships)
  return memberships.some((m) => m.userId === me && m.role === 'admin')
}
