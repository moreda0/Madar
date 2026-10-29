import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import { create } from 'zustand'
import { useStore, type State } from './store'
import type { User } from './types'
import { initialsOf, uid } from './utils'

/**
 * Online sync with Supabase (supabase/sync.sql).
 *
 * The local store stays the source the UI reads from, so the app keeps working offline.
 * Every change to a synced collection is diffed (by object identity — the store never
 * mutates in place) and pushed as one row per record; changes from other devices arrive
 * over realtime and are merged back in. Last write wins per record.
 */

export const COLLECTIONS = ['users', 'companies', 'units', 'memberships', 'tasks', 'notifications', 'attendance', 'kpis', 'ratings', 'reviews', 'promotions'] as const
type Kind = (typeof COLLECTIONS)[number]
type Item = Record<string, unknown>
interface Row { kind: Kind; id: string; data: Item; deleted: boolean; updated_at?: string }

const keyOf = (kind: Kind, item: Item) => (kind === 'memberships' ? `${item.userId}:${item.companyId}` : String(item.id))

/* ---------- config ---------- */

export interface SyncConfig { url: string; key: string }
const CFG_KEY = 'madar-sync-config'
const PENDING_KEY = 'madar-sync-pending'

const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch { /* storage blocked */ } }

export const builtInConfig: SyncConfig | null =
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
    ? { url: import.meta.env.VITE_SUPABASE_URL, key: import.meta.env.VITE_SUPABASE_ANON_KEY }
    : null

export function getSyncConfig(): SyncConfig | null {
  if (builtInConfig) return builtInConfig
  try { const c = JSON.parse(read(CFG_KEY) ?? 'null'); return c?.url && c?.key ? c : null } catch { return null }
}
export function setSyncConfig(c: SyncConfig | null) {
  write(CFG_KEY, c ? JSON.stringify(c) : null)
  client = null
}

/* ---------- status for the UI ---------- */

export type SyncStatus = 'off' | 'signed-out' | 'connecting' | 'synced' | 'saving' | 'offline' | 'error'
interface SyncState {
  status: SyncStatus
  email?: string
  role?: string
  error?: string
  pending: number
  lastSync?: string
  needsFirstUpload: boolean
}
export const useSync = create<SyncState>()(() => ({ status: getSyncConfig() ? 'connecting' : 'off', pending: 0, needsFirstUpload: false }))
const setStatus = (p: Partial<SyncState>) => useSync.setState(p)

/* ---------- engine state ---------- */

let client: SupabaseClient | null = null
let channel: RealtimeChannel | null = null
let unsubStore: (() => void) | null = null
let applying = false
let flushTimer: ReturnType<typeof setTimeout> | null = null
let retryTimer: ReturnType<typeof setInterval> | null = null
let lastSeen = '1970-01-01T00:00:00Z'
const snapshot = Object.fromEntries(COLLECTIONS.map((k) => [k, new Map<string, Item>()])) as Record<Kind, Map<string, Item>>
const pending = new Map<string, Row>(loadPending())

function loadPending(): [string, Row][] {
  try { return JSON.parse(read(PENDING_KEY) ?? '[]') } catch { return [] }
}
function savePending() {
  write(PENDING_KEY, JSON.stringify([...pending.entries()]))
  setStatus({ pending: pending.size })
}

function getClient(): SupabaseClient | null {
  const cfg = getSyncConfig()
  if (!cfg) return null
  if (!client) client = createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'madar-auth' } })
  return client
}

const arabicError = (msg?: string) => {
  const m = (msg ?? '').toLowerCase()
  if (m.includes('invalid login')) return 'الإيميل أو الباسورد غلط'
  if (m.includes('already registered')) return 'الإيميل ده عامل حساب قبل كده، ادخلي من "دخول"'
  if (m.includes('password should be')) return 'الباسورد لازم يكون 6 حروف أو أكتر'
  if (m.includes('email not confirmed')) return 'لازم تأكدي الإيميل الأول من الرسالة اللي وصلتك'
  if (m.includes('failed to fetch') || m.includes('network')) return 'مش قادرين نوصل للسيرفر، اتأكدي من النت'
  if (m.includes('rate limit')) return 'محاولات كتير، استني دقيقة وجربي تاني'
  return msg || 'حصلت مشكلة، جربي تاني'
}

/* ---------- auth ---------- */

export async function signIn(email: string, password: string, mode: 'login' | 'signup'): Promise<{ ok: boolean; error?: string; needsConfirm?: boolean }> {
  const c = getClient()
  if (!c) return { ok: false, error: 'المزامنة مش متظبطة' }
  const e = email.trim().toLowerCase()
  const res = mode === 'signup' ? await c.auth.signUp({ email: e, password }) : await c.auth.signInWithPassword({ email: e, password })
  if (res.error) return { ok: false, error: arabicError(res.error.message) }
  if (!res.data.session) return { ok: false, needsConfirm: true, error: 'بعتنالك إيميل تأكيد. افتحيه ودوسي على اللينك، وبعدين ادخلي هنا.' }
  return { ok: true }
}

export async function signOut() {
  stop()
  try { await getClient()?.auth.signOut() } catch { /* offline */ }
  setStatus({ status: getSyncConfig() ? 'signed-out' : 'off', email: undefined, role: undefined, needsFirstUpload: false })
}

/* ---------- connect / pull ---------- */

/** Call on app start and after sign-in. Resolves to the workspace role, or null when not signed in. */
export async function connect(): Promise<string | null> {
  const c = getClient()
  if (!c) return null
  const { data } = await c.auth.getSession()
  const session = data.session
  if (!session) { setStatus({ status: 'signed-out' }); return null }
  const email = session.user.email?.toLowerCase() ?? ''
  setStatus({ status: 'connecting', email, error: undefined })

  const claim = await c.rpc('claim_workspace')
  if (claim.error) {
    // offline with a saved session: keep working locally, sync later
    setStatus({ status: navigator.onLine ? 'error' : 'offline', error: arabicError(claim.error.message) })
    startLocalTracking()
    return null
  }
  const role = String(claim.data)
  setStatus({ role })
  if (role === 'not-invited') { setStatus({ status: 'error', error: 'الإيميل ده مش متضاف في مدار. اطلبي من المدير يضيفك بإيميلك في الفريق.' }); return role }

  const rows = await pullAll()
  if (rows === null) return role
  const live = rows.filter((r) => !r.deleted)

  if (live.length === 0) {
    // brand-new workspace: ask the owner what to upload (see firstUpload)
    setStatus({ needsFirstUpload: true, status: 'synced' })
    return role
  }
  replaceLocal(rows)
  bindMe(email)
  startLiveSync()
  return role
}

async function pullAll(since?: string): Promise<Row[] | null> {
  const c = getClient()!
  const out: Row[] = []
  for (let from = 0; ; from += 1000) {
    let q = c.from('records').select('kind,id,data,deleted,updated_at').order('updated_at').range(from, from + 999)
    if (since) q = q.gt('updated_at', since)
    const { data, error } = await q
    if (error) { setStatus({ status: navigator.onLine ? 'error' : 'offline', error: arabicError(error.message) }); return null }
    out.push(...(data as Row[]))
    if (!data || data.length < 1000) break
  }
  for (const r of out) if (r.updated_at && r.updated_at > lastSeen) lastSeen = r.updated_at
  return out
}

/** Make the local store equal to the server (plus any of our own unsent changes) */
function replaceLocal(rows: Row[]) {
  const next: Partial<Record<Kind, Item[]>> = {}
  for (const k of COLLECTIONS) next[k] = []
  for (const r of rows) if (!r.deleted && COLLECTIONS.includes(r.kind)) next[r.kind]!.push(r.data)
  for (const p of pending.values()) {
    const arr = next[p.kind]!
    const i = arr.findIndex((x) => keyOf(p.kind, x) === p.id)
    if (p.deleted) { if (i >= 0) arr.splice(i, 1) }
    else if (i >= 0) arr[i] = p.data
    else arr.push(p.data)
  }
  applying = true
  useStore.setState(next as Partial<State>)
  applying = false
  takeSnapshot()
}

function takeSnapshot() {
  const s = useStore.getState() as unknown as Record<Kind, Item[]>
  for (const k of COLLECTIONS) snapshot[k] = new Map((s[k] ?? []).map((x) => [keyOf(k, x), x]))
}

/** Point the app at the person who signed in */
function bindMe(email: string) {
  const s = useStore.getState()
  const me = s.users.find((u) => u.email?.toLowerCase() === email)
  if (me) { if (s.currentUserId !== me.id) s.login(me.id) }
  else {
    s.logout()
    setStatus({ status: 'error', error: 'دخلتي، بس مش لاقيين اسمك في الفريق. اطلبي من المدير يكتب إيميلك جنب اسمك في صفحة الهيكل.' })
  }
}

/** Owner's first connection: upload what's on this device, or start clean */
export async function firstUpload(mode: 'local' | 'empty', myName?: string) {
  const email = useSync.getState().email ?? ''
  const name = myName?.trim()
  if (mode === 'empty') useStore.getState().startFresh()
  const st = useStore.getState()
  // whoever is signed in on this device; otherwise the first general manager in the data
  let me = st.users.find((u) => u.id === st.currentUserId) ?? st.users.find((u) => st.memberships.some((m) => m.userId === u.id && m.role === 'admin'))
  if (!me) {
    const u: User = { id: uid('u_'), name: name || email.split('@')[0], initials: initialsOf(name || email), email }
    useStore.setState({ users: [...st.users, u] })
    me = u
  }
  useStore.getState().updateUser(me.id, { email, ...(name ? { name, initials: initialsOf(name) } : {}) })
  useStore.getState().login(me.id)
  setStatus({ needsFirstUpload: false })
  startLiveSync()
  // everything on the device is new to the server
  for (const k of COLLECTIONS) snapshot[k] = new Map()
  diffAndQueue()
}

/* ---------- live sync ---------- */

function startLocalTracking() {
  if (unsubStore) return
  if (![...Object.values(snapshot)].some((m) => m.size)) takeSnapshot()
  unsubStore = useStore.subscribe(() => {
    if (applying) return
    diffAndQueue()
  })
  window.addEventListener('online', onOnline)
  window.addEventListener('focus', onFocus)
  retryTimer = setInterval(() => { if (pending.size) flush() }, 15000)
}

function startLiveSync() {
  startLocalTracking()
  const c = getClient()!
  channel?.unsubscribe()
  channel = c
    .channel('madar-records')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'records' }, (payload) => {
      const row = payload.new as Row
      if (row?.kind) applyRemote([row])
    })
    .subscribe((st) => {
      if (st === 'SUBSCRIBED') catchUp()
      if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') setStatus({ status: 'offline' })
    })
  setStatus({ status: pending.size ? 'saving' : 'synced', error: undefined })
  if (pending.size) flush()
}

function stop() {
  unsubStore?.()
  unsubStore = null
  channel?.unsubscribe()
  channel = null
  if (retryTimer) clearInterval(retryTimer)
  retryTimer = null
  window.removeEventListener('online', onOnline)
  window.removeEventListener('focus', onFocus)
}

// started offline: do the full connect once the network is back
const onOnline = () => { if (!channel) connect().catch(() => {}); else { flush(); catchUp() } }
const onFocus = () => catchUp()

async function catchUp() {
  if (!getClient() || useSync.getState().needsFirstUpload) return
  const rows = await pullAll(lastSeen)
  if (rows?.length) applyRemote(rows)
  if (rows) setStatus({ status: pending.size ? 'saving' : 'synced', lastSync: new Date().toISOString() })
}

function applyRemote(rows: Row[]) {
  const s = useStore.getState() as unknown as Record<Kind, Item[]>
  const next: Partial<Record<Kind, Item[]>> = {}
  for (const r of rows) {
    if (r.updated_at && r.updated_at > lastSeen) lastSeen = r.updated_at
    if (!COLLECTIONS.includes(r.kind)) continue
    if (pending.has(`${r.kind}|${r.id}`)) continue // our newer local edit wins until it's sent
    const arr = next[r.kind] ?? (next[r.kind] = [...(s[r.kind] ?? [])])
    const i = arr.findIndex((x) => keyOf(r.kind, x) === r.id)
    if (r.deleted) { if (i >= 0) arr.splice(i, 1) }
    else if (i >= 0) { if (JSON.stringify(arr[i]) !== JSON.stringify(r.data)) arr[i] = r.data }
    else arr.push(r.data)
  }
  if (!Object.keys(next).length) return
  applying = true
  useStore.setState(next as Partial<State>)
  applying = false
  for (const k of Object.keys(next) as Kind[]) snapshot[k] = new Map(next[k]!.map((x) => [keyOf(k, x), x]))
  setStatus({ lastSync: new Date().toISOString() })
}

function diffAndQueue() {
  const s = useStore.getState() as unknown as Record<Kind, Item[]>
  let changed = false
  for (const k of COLLECTIONS) {
    const arr = s[k] ?? []
    const prev = snapshot[k]
    if (prev.size === arr.length && arr.every((x) => prev.get(keyOf(k, x)) === x)) continue
    const now = new Map(arr.map((x) => [keyOf(k, x), x]))
    for (const [id, x] of now) if (prev.get(id) !== x) { pending.set(`${k}|${id}`, { kind: k, id, data: x, deleted: false }); changed = true }
    for (const [id, x] of prev) if (!now.has(id)) { pending.set(`${k}|${id}`, { kind: k, id, data: x, deleted: true }); changed = true }
    snapshot[k] = now
  }
  if (!changed) return
  savePending()
  setStatus({ status: navigator.onLine ? 'saving' : 'offline' })
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(flush, 700)
}

let flushing = false
async function flush() {
  const c = getClient()
  if (!c || flushing || !pending.size || useSync.getState().needsFirstUpload) return
  if (!navigator.onLine) { setStatus({ status: 'offline' }); return }
  flushing = true
  try {
    const batch = [...pending.entries()].slice(0, 300)
    const rows = batch.map(([, r]) => ({ kind: r.kind, id: r.id, data: r.data, deleted: r.deleted }))
    const { error } = await c.from('records').upsert(rows, { onConflict: 'kind,id' })
    if (error) { setStatus({ status: 'error', error: arabicError(error.message) }); return }
    // drop what was sent, unless it changed again meanwhile
    for (const [key, r] of batch) if (pending.get(key) === r) pending.delete(key)
    savePending()
    // people added with an email can now sign in
    const emails = rows.filter((r) => r.kind === 'users' && !r.deleted && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String((r.data as Item).email ?? ''))).map((r) => ({ email: String((r.data as Item).email).toLowerCase() }))
    if (emails.length) await c.from('workspace_members').upsert(emails, { onConflict: 'email', ignoreDuplicates: true })
    setStatus({ status: pending.size ? 'saving' : 'synced', error: undefined, lastSync: new Date().toISOString() })
    if (pending.size) setTimeout(flush, 50)
  } catch (e) {
    setStatus({ status: navigator.onLine ? 'error' : 'offline', error: arabicError((e as Error).message) })
  } finally {
    flushing = false
  }
}

/** "Sync now" button */
export async function syncNow() {
  if (!channel) { await connect(); return }
  await flush()
  await catchUp()
}

/** Start sync on app load if this device is set up and signed in */
export function initSync() {
  if (!getSyncConfig()) { setStatus({ status: 'off' }); return }
  connect().catch((e) => setStatus({ status: 'error', error: arabicError((e as Error).message) }))
}

export const SYNC_LABEL: Record<SyncStatus, string> = {
  off: 'المزامنة مقفولة',
  'signed-out': 'مش متسجلة دخول',
  connecting: 'بنتصل…',
  synced: 'متزامن',
  saving: 'بنحفظ…',
  offline: 'من غير نت، هنزامن لما يرجع',
  error: 'في مشكلة في المزامنة',
}
export const SYNC_COLOR: Record<SyncStatus, string> = {
  off: 'var(--muted)',
  'signed-out': 'var(--muted)',
  connecting: 'var(--cyan-2)',
  synced: 'var(--green)',
  saving: 'var(--cyan-2)',
  offline: 'var(--amber)',
  error: 'var(--rose)',
}

/* ---------- online assistant (supabase/functions/madar-assistant) ---------- */

export interface OnlineAnswer {
  reply: string
  taskIds: string[]
  actions: Record<string, string | null>[]
}

let assistantMissing = false

/** null when the online assistant isn't reachable (sync off, not signed in, or not set up) */
export async function askOnline(messages: { role: 'user' | 'assistant'; text: string }[], context: unknown): Promise<OnlineAnswer | null> {
  const c = getClient()
  const st = useSync.getState()
  if (!c || assistantMissing || !navigator.onLine || !st.email || st.role === 'not-invited') return null
  const { data, error } = await c.functions.invoke('madar-assistant', { body: { messages, context } })
  if (error) {
    const status = (error as { context?: Response }).context?.status
    if (status === 404 || status === 500) assistantMissing = true // not deployed yet / no API key
    return null
  }
  return data?.reply ? (data as OnlineAnswer) : null
}

export const onlineAssistantReady = () => !!getSyncConfig() && !assistantMissing
