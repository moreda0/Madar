import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useStore, useUI } from '../lib/store'
import { useMe, useMyCompanies } from '../lib/access'
import { Avatar, CompanyChips, ConfirmDialog, Toasts, useUnreadCount } from './ui'
import { Icon } from './Icon'
import { TaskDrawer } from './TaskDrawer'
import { NewTaskModal } from './TaskForm'
import { useReminderEngine } from '../lib/reminders'
import { ROLE_LABEL } from '../lib/utils'

const NAV = [
  { to: '/', label: 'اليوم', icon: 'today', end: true },
  { to: '/tasks', label: 'المهام', icon: 'tasks' },
  { to: '/attendance', label: 'الحضور', icon: 'pin' },
  { to: '/notifications', label: 'التنبيهات', icon: 'bell' },
  { to: '/org', label: 'الهيكل التنظيمي', short: 'الهيكل', icon: 'org' },
  { to: '/settings', label: 'الإعدادات', icon: 'settings' },
]

const TITLES: Record<string, string> = {
  '/': 'اليوم',
  '/tasks': 'المهام',
  '/attendance': 'الحضور والانصراف',
  '/notifications': 'التنبيهات',
  '/org': 'الهيكل التنظيمي',
  '/settings': 'الإعدادات',
}

export function Layout() {
  useReminderEngine()
  const me = useMe()
  const companies = useMyCompanies()
  const memberships = useStore((s) => s.memberships)
  const unread = useUnreadCount()
  const openNewTask = useUI((s) => s.openNewTask)
  const openTaskId = useUI((s) => s.openTaskId)
  const logout = useStore((s) => s.logout)
  const loc = useLocation()
  const myRoles = memberships.filter((m) => m.userId === me?.id)
  const topRole = myRoles.some((m) => m.role === 'admin') ? 'admin' : myRoles.some((m) => m.role === 'manager') ? 'manager' : 'employee'

  return (
    <div className="app">
      <aside className="sidebar" aria-label="القائمة">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">مدار</span>
        </div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <Icon name={n.icon} />
            {n.label}
            {n.to === '/notifications' && unread > 0 && <span className="badge">{unread}</span>}
          </NavLink>
        ))}
        {companies.length > 0 && <div className="sidebar-section">شركاتي</div>}
        {companies.map((c) => (
          <button
            key={c.id}
            className="nav-link"
            style={{ background: 'none', border: 0, cursor: 'pointer', textAlign: 'start', width: '100%' }}
            onClick={() => useUI.getState().setCompanyFilter(c.id)}
          >
            <span className="cdot" style={{ background: c.color, boxShadow: `0 0 8px ${c.color}`, width: 10, height: 10 }} />
            {c.name}
          </button>
        ))}
        <div className="sidebar-foot">
          <div className="row" style={{ padding: '10px 8px', borderTop: '1px solid var(--line)' }}>
            <Avatar user={me} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{me?.name}</div>
              <div className="muted" style={{ fontSize: 12 }}>{ROLE_LABEL[topRole]}</div>
            </div>
            <button className="btn ghost icon sm" onClick={logout} aria-label="تسجيل خروج" title="تسجيل خروج"><Icon name="logout" size={18} /></button>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <h1 style={{ fontSize: 20, whiteSpace: 'nowrap' }} className="topbar-title">{TITLES[loc.pathname] ?? 'مدار'}</h1>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'flex-end' }}>
            <CompanyChips />
          </div>
          <NavLink to="/settings" className="mobile-only" aria-label="الإعدادات والحساب">
            <Avatar user={me} size="sm" />
          </NavLink>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>

      <button className="fab" onClick={() => openNewTask()} aria-label="مهمة جديدة" title="مهمة جديدة">
        <Icon name="plus" size={26} stroke={2.4} />
      </button>

      <nav className="bottom-nav" aria-label="التنقل">
        {NAV.filter((n) => n.to !== '/settings').map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            <Icon name={n.icon} size={22} />
            {n.short ?? n.label}
            {n.to === '/notifications' && unread > 0 && <span className="dot" />}
          </NavLink>
        ))}
      </nav>

      <TaskDrawer key={openTaskId ?? 'none'} />
      <NewTaskModal />
      <ConfirmDialog />
      <Toasts />
    </div>
  )
}
