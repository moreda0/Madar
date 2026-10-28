import { useState } from 'react'
import { useStore } from '../lib/store'
import { initialsOf, ROLE_LABEL } from '../lib/utils'
import { Avatar } from '../components/ui'
import { Icon } from '../components/Icon'

export function Login() {
  const users = useStore((s) => s.users)
  const memberships = useStore((s) => s.memberships)
  const companies = useStore((s) => s.companies)
  const login = useStore((s) => s.login)
  const addUser = useStore((s) => s.addUser)
  const [name, setName] = useState('')

  const describe = (uid: string) => {
    const ms = memberships.filter((m) => m.userId === uid)
    if (!ms.length) return 'لسه مش في أي شركة'
    const top = ms.some((m) => m.role === 'admin') ? 'admin' : ms.some((m) => m.role === 'manager') ? 'manager' : 'employee'
    return `${ROLE_LABEL[top]} · ${ms.map((m) => companies.find((c) => c.id === m.companyId)?.short).filter(Boolean).join('، ')}`
  }

  return (
    <div className="login-wrap">
      <div className="login-card stack" style={{ gap: 20 }}>
        <div className="row" style={{ gap: 14 }}>
          <span className="brand-mark" style={{ width: 54, height: 54, borderRadius: 18 }} aria-hidden="true" />
          <div>
            <h1 style={{ fontSize: 30 }}>مدار</h1>
            <div className="soft">كل شركاتك ومهامك في مكان واحد</div>
          </div>
        </div>

        <div className="card stack" style={{ gap: 12 }}>
          <h2>ادخلي باسم</h2>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            نسخة تجريبية: البيانات محفوظة على الجهاز ده. اختاري شخص عشان تشوفي التطبيق من عينه (مدير عام، مدير، موظف).
          </p>
          {users.map((u) => (
            <button key={u.id} className="user-pick" onClick={() => login(u.id)}>
              <Avatar user={u} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{u.name}</div>
                <div className="muted" style={{ fontSize: 12 }}>{describe(u.id)}</div>
              </div>
              <Icon name="chevron" size={18} className="muted" />
            </button>
          ))}
        </div>

        <form
          className="card stack"
          style={{ gap: 12 }}
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return
            const id = addUser({ name: name.trim(), initials: initialsOf(name) })
            login(id)
          }}
        >
          <h3>أو اعملي حساب جديد</h3>
          <div className="row">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="اسمك" aria-label="الاسم" />
            <button className="btn primary" disabled={!name.trim()}>ابدئي</button>
          </div>
        </form>
      </div>
    </div>
  )
}
