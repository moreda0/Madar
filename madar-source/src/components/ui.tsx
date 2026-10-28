import { useEffect, type ReactNode } from 'react'
import { useStore, useUI } from '../lib/store'
import { useMyCompanies } from '../lib/access'
import type { Company, User } from '../lib/types'
import { hexA } from '../lib/utils'
import { Icon } from './Icon'

export function Overlay({ onClose, children, kind = 'modal', label }: { onClose: () => void; children: ReactNode; kind?: 'modal' | 'drawer'; label: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={kind} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  )
}

export function Avatar({ user, size }: { user?: User; size?: 'sm' | 'lg' }) {
  return (
    <span className={`avatar ${size ?? ''}`} title={user?.name}>
      {user?.initials ?? '؟'}
    </span>
  )
}

export function CompanyTag({ company }: { company?: Company }) {
  if (!company) return null
  return (
    <span className="pill" style={{ background: hexA(company.color, 0.12), color: company.color }}>
      <span className="cdot" style={{ background: company.color }} />
      {company.short}
    </span>
  )
}

export function CompanyChips() {
  const companies = useMyCompanies()
  const filter = useUI((s) => s.companyFilter)
  const setFilter = useUI((s) => s.setCompanyFilter)
  if (companies.length < 2) return null
  return (
    <div className="chips" role="group" aria-label="فلتر الشركات">
      <button className={`chip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')} aria-pressed={filter === 'all'}>
        كل الشركات
      </button>
      {companies.map((c) => {
        const on = filter === c.id
        return (
          <button
            key={c.id}
            className="chip"
            aria-pressed={on}
            onClick={() => setFilter(on ? 'all' : c.id)}
            style={on ? { background: c.color, color: '#070A14', borderColor: c.color, fontWeight: 600 } : { borderColor: hexA(c.color, 0.45), color: c.color }}
          >
            {c.short}
          </button>
        )
      })}
    </div>
  )
}

export function Ring({ value, total, size = 92, label, color = 'var(--cyan-2)' }: { value: number; total: number; size?: number; label?: string; color?: string }) {
  const r = size / 2 - 8
  const c = 2 * Math.PI * r
  const pct = total ? value / total : 0
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label ?? `${value} من ${total}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="9" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={`${pct * c} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray .5s ease' }}
      />
      <text x={size / 2} y={size / 2 + 7} textAnchor="middle" fill="#E8ECF6" fontFamily="Readex Pro" fontSize={size / 4.2} fontWeight="700">
        {value}/{total}
      </text>
    </svg>
  )
}

export function Toasts() {
  const toasts = useUI((s) => s.toasts)
  const dismiss = useUI((s) => s.dismissToast)
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone ?? ''}`}>
          <span className="ic">
            <Icon name={t.tone === 'ok' ? 'check' : t.tone === 'warn' ? 'alert' : 'bell'} size={18} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{t.title}</div>
            {t.body && <div className="soft" style={{ fontSize: 13 }}>{t.body}</div>}
          </div>
          <button className="btn ghost icon sm" onClick={() => dismiss(t.id)} aria-label="إغلاق">
            <Icon name="close" size={16} />
          </button>
        </div>
      ))}
    </div>
  )
}

export function Empty({ icon = 'sparkle', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={32} />
      <div style={{ fontSize: 15, color: 'var(--soft)' }}>{title}</div>
      {children}
    </div>
  )
}

export function useUnreadCount() {
  const me = useStore((s) => s.currentUserId)
  return useStore((s) => s.notifications.filter((n) => n.userId === me && !n.read).length)
}

export function ConfirmDialog() {
  const req = useUI((s) => s.confirmReq)
  if (!req) return null
  return (
    <Overlay onClose={() => req.resolve(false)} label="تأكيد">
      <div className="stack" style={{ gap: 18 }}>
        <h2 style={{ lineHeight: 1.5 }}>{req.message}</h2>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={() => req.resolve(false)}>لأ</button>
          <button className="btn danger" autoFocus onClick={() => req.resolve(true)}>أيوه، كمّلي</button>
        </div>
      </div>
    </Overlay>
  )
}
