import { useState } from 'react'
import { ask, useStore, useUI } from '../lib/store'
import { builtInConfig, connect, firstUpload, getSyncConfig, setSyncConfig, signIn, signOut, syncNow, SYNC_COLOR, SYNC_LABEL, useSync } from '../lib/sync'
import { Icon } from './Icon'

export const syncOn = () => !!getSyncConfig()

/** Leave the app: ends the online session too when sync is on */
export async function logoutEverywhere() {
  if (syncOn()) await signOut()
  useStore.getState().logout()
}

export function SyncDot({ withLabel }: { withLabel?: boolean }) {
  const status = useSync((s) => s.status)
  if (status === 'off') return null
  const c = SYNC_COLOR[status]
  return (
    <span className="row" style={{ gap: 6, fontSize: 12 }} title={SYNC_LABEL[status]} role="status">
      <span className="cdot" style={{ background: c, boxShadow: `0 0 8px ${c}`, width: 8, height: 8 }} />
      {withLabel ? <span className="muted">{SYNC_LABEL[status]}</span> : <span className="sr-only">{SYNC_LABEL[status]}</span>}
    </span>
  )
}

/** Email + password, used on the login screen when sync is on */
export function SyncLoginForm() {
  const syncError = useSync((s) => s.error)
  const status = useSync((s) => s.status)
  const signedInAs = useSync((s) => (s.status !== 'signed-out' ? s.email : undefined))
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  if (signedInAs && status !== 'connecting') {
    // signed in, but can't enter (not invited / no matching person)
    return (
      <div className="card stack" style={{ gap: 12 }}>
        <h2>داخلة بـ <span dir="ltr" className="num">{signedInAs}</span></h2>
        {syncError && <p style={{ margin: 0, color: 'var(--rose)' }}>{syncError}</p>}
        <div className="row wrap">
          <button className="btn primary" onClick={() => connect()}><Icon name="refresh" size={18} /> جربي تاني</button>
          <button className="btn ghost" onClick={() => signOut()}><Icon name="logout" size={18} /> ادخلي بإيميل تاني</button>
        </div>
      </div>
    )
  }

  return (
    <form
      className="card stack"
      style={{ gap: 14 }}
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true); setError(undefined)
        const r = await signIn(email, password, mode)
        if (r.ok) await connect()
        else setError(r.error)
        setBusy(false)
      }}
    >
      <div className="seg" role="tablist" style={{ alignSelf: 'flex-start' }}>
        <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>دخول</button>
        <button type="button" className={mode === 'signup' ? 'on' : ''} onClick={() => setMode('signup')}>أول مرة</button>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        {mode === 'login' ? 'ادخلي بالإيميل والباسورد بتوعك.' : 'اكتبي الإيميل اللي المدير ضافه لك، واختاري باسورد. أول واحد يدخل مدار بيبقى صاحبه.'}
      </p>
      <label className="field"><span>الإيميل</span>
        <input className="input num" dir="ltr" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="field"><span>الباسورد</span>
        <input className="input num" dir="ltr" type="password" minLength={6} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {(error || syncError) && <p style={{ margin: 0, color: 'var(--rose)', fontSize: 14 }}>{error || syncError}</p>}
      <button className="btn primary" disabled={busy || status === 'connecting'}>
        {busy || status === 'connecting' ? 'لحظة…' : mode === 'login' ? 'ادخلي' : 'اعملي الحساب وادخلي'}
      </button>
    </form>
  )
}

/** Owner's first connection to an empty workspace */
export function FirstUpload() {
  const me = useStore((s) => s.users.find((u) => u.id === s.currentUserId))
  const companies = useStore((s) => s.companies.length)
  const tasks = useStore((s) => s.tasks.length)
  const [name, setName] = useState(me?.name ?? '')
  const [busy, setBusy] = useState(false)
  return (
    <div className="login-wrap">
      <div className="login-card stack" style={{ gap: 20 }}>
        <div className="row" style={{ gap: 14 }}>
          <span className="brand-mark" style={{ width: 54, height: 54, borderRadius: 18 }} aria-hidden="true" />
          <div>
            <h1 style={{ fontSize: 26 }}>أهلاً، مدار بقى أونلاين</h1>
            <div className="soft">السيرفر لسه فاضي. نبدأ بإيه؟</div>
          </div>
        </div>
        <label className="field"><span>اسمك</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <button className="user-pick" disabled={busy} onClick={async () => { setBusy(true); await firstUpload('local', name) }}>
          <Icon name="upload" />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>ارفعي اللي على الجهاز ده</div>
            <div className="muted" style={{ fontSize: 12 }}><span className="num">{companies}</span> شركات و<span className="num">{tasks}</span> مهمة (لو دي بيانات التجربة هتترفع زي ما هي)</div>
          </div>
        </button>
        <button className="user-pick" disabled={busy} onClick={async () => { setBusy(true); await firstUpload('empty', name) }}>
          <Icon name="sparkle" />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>ابدئي على نضافة</div>
            <div className="muted" style={{ fontSize: 12 }}>من غير أمثلة، وتضيفي شركاتك وفريقك بنفسك</div>
          </div>
        </button>
        <button className="btn ghost" onClick={() => signOut()}><Icon name="logout" size={18} /> مش دلوقتي، اخرجي</button>
      </div>
    </div>
  )
}

/** Settings card: status, sync now, and (if not built in) the server keys */
export function SyncCard() {
  const st = useSync()
  const toast = useUI((s) => s.toast)
  const cfg = getSyncConfig()
  const [url, setUrl] = useState(cfg?.url ?? '')
  const [key, setKey] = useState(cfg?.key ?? '')

  return (
    <div className="card stack" style={{ gap: 12 }}>
      <div className="row"><Icon name="refresh" /><h2 style={{ flex: 1 }}>المزامنة أونلاين</h2><SyncDot withLabel /></div>
      {cfg ? (
        <>
          <p className="soft" style={{ margin: 0, fontSize: 14 }}>
            كل تعديل بيتحفظ على السيرفر ويظهر على كل الأجهزة والفريق على طول. لو النت فصل بتكملي عادي، وأول ما يرجع بنرفع.
          </p>
          {st.email && <div className="row" style={{ fontSize: 14 }}><span className="muted">داخلة بـ</span><span dir="ltr" className="num">{st.email}</span>{st.role === 'owner' || st.role === 'owner-new' ? <span className="pill" style={{ background: 'rgba(34,211,238,.12)', color: 'var(--cyan-2)' }}>صاحبة مدار</span> : null}</div>}
          {st.pending > 0 && <div className="muted" style={{ fontSize: 13 }}>مستني يترفع: <span className="num">{st.pending}</span></div>}
          {st.lastSync && <div className="muted" style={{ fontSize: 13 }}>آخر مزامنة: <span className="num">{new Date(st.lastSync).toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit' })}</span></div>}
          {st.error && st.status === 'error' && <p style={{ margin: 0, color: 'var(--rose)', fontSize: 14 }}>{st.error}</p>}
          <div className="row wrap">
            <button className="btn" onClick={async () => { await syncNow(); toast({ title: 'اتزامن', tone: 'ok' }) }}><Icon name="refresh" size={18} /> زامني دلوقتي</button>
            {!builtInConfig && (
              <button className="btn ghost" onClick={async () => (await ask('نقفل المزامنة على الجهاز ده؟ البيانات هتفضل عليه بس مش هتتحدث.')) && (await signOut(), setSyncConfig(null), useSync.setState({ status: 'off' }))}>اقفلي المزامنة هنا</button>
            )}
          </div>
        </>
      ) : (
        <form
          className="stack"
          style={{ gap: 12 }}
          onSubmit={async (e) => {
            e.preventDefault()
            setSyncConfig({ url: url.trim().replace(/\/+$/, ''), key: key.trim() })
            useSync.setState({ status: 'signed-out', error: undefined })
            useStore.getState().logout()
          }}
        >
          <p className="soft" style={{ margin: 0, fontSize: 14 }}>
            دلوقتي البيانات على الجهاز ده بس. حطي بيانات مشروع Supabase عشان تتزامن بين اللابتوب والموبايل والفريق.
          </p>
          <label className="field"><span>Project URL</span><input className="input num" dir="ltr" required placeholder="https://xxxx.supabase.co" value={url} onChange={(e) => setUrl(e.target.value)} /></label>
          <label className="field"><span>anon public key</span><input className="input num" dir="ltr" required value={key} onChange={(e) => setKey(e.target.value)} /></label>
          <div className="row"><button className="btn primary" disabled={!/^https:\/\//.test(url.trim()) || key.trim().length < 20}>شغّلي المزامنة</button></div>
        </form>
      )}
    </div>
  )
}
