// مدار: attendance from Odoo (Supabase Edge Function "madar-odoo", JWT verification OFF).
//
// Each Madar company can have its own Odoo database. From each one it pulls check-ins/outs
// (hr.attendance), approved time off (hr.leave) and public holidays (resource.calendar.leaves),
// matches each Odoo employee to a Madar person (work email, then phone, then name), decides
// late / left early from that company's hours, and saves them as normal Madar records, so they
// count in the monthly commitment score.
//
//   {tick: true}                                            Cron, every 10 minutes (supabase/odoo.sql): every connection
//   {action: 'status'}                                      any member: all connections, last results (never a key)
//   {action: 'sync', companyId}                             any member: pull now
//   {action: 'configure', companyId, url, db, login, apiKey, tz?, since?}   owner: test + save, then pull
//   {action: 'resync', companyId}                           owner: pull the whole history again
//   {action: 'disconnect', companyId}                       owner: forget the connection (imported days stay)
//
// Works with Odoo Online and self-hosted. Tries Odoo's JSON-2 API (Odoo 19+) first and falls
// back to the classic /jsonrpc API. Odoo Online only opens its API on the Custom plan.
import { createClient } from 'npm:@supabase/supabase-js@2'

const env = (k: string, d = '') => Deno.env.get(k) ?? d
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
class Fail extends Error { constructor(public code: string, public status = 400, public detail = '') { super(code) } }

// deno-lint-ignore no-explicit-any
type Rec = Record<string, any>
const db = () => createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })

/* ---------- Odoo client ---------- */

interface Cfg { company_id: string; url: string; db: string; login: string; api_key: string; tz: string; cursor: string | null; since: string | null; last_sync: string | null; last_result: Rec | null }

class Odoo {
  mode: 'json2' | 'jsonrpc' | null = null
  uid = 0
  constructor(private c: Pick<Cfg, 'url' | 'db' | 'login' | 'api_key'>) {}

  private get base() { return this.c.url.replace(/\/+$/, '') }
  private get dbName() {
    if (this.c.db) return this.c.db
    // Odoo Online: the database is the subdomain (mycompany.odoo.com -> mycompany)
    const h = new URL(this.base).hostname
    return h.endsWith('.odoo.com') ? h.split('.')[0] : ''
  }

  private async post(path: string, body: unknown, headers: Record<string, string> = {}) {
    let r: Response
    try {
      r = await fetch(this.base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) })
    } catch (e) {
      throw new Fail('unreachable', 502, String((e as Error).message ?? e))
    }
    return r
  }

  private async rpc(service: string, method: string, args: unknown[]) {
    const r = await this.post('/jsonrpc', { jsonrpc: '2.0', method: 'call', id: Date.now(), params: { service, method, args } })
    if (r.status === 404) throw new Fail('bad-url', 400)
    const text = await r.text()
    let j: Rec
    try { j = JSON.parse(text) } catch { throw new Fail('bad-url', 400, text.slice(0, 200)) }
    if (j.error) {
      const msg = String(j.error.data?.message ?? j.error.message ?? '')
      if (/access denied|AccessDenied|invalid.*(login|password)/i.test(msg)) throw new Fail('bad-login', 401, msg)
      if (/database.*(not exist|does not)|KeyError/i.test(msg)) throw new Fail('bad-db', 400, msg)
      throw new Fail('odoo-error', 502, msg)
    }
    return j.result
  }

  async connect() {
    // JSON-2 (Odoo 19+): bearer API key, named arguments
    const h: Record<string, string> = { Authorization: `bearer ${this.c.api_key}` }
    if (this.dbName) h['X-Odoo-Database'] = this.dbName
    const r = await this.post('/json/2/res.users/context_get', {}, h)
    if (r.ok) { this.mode = 'json2'; return }
    if (r.status === 401 || r.status === 403) {
      const t = await r.text()
      // some servers answer 401 on unknown routes too; only trust it when it is Odoo's JSON
      if (/"name"|access|denied|unauthorized/i.test(t) && t.trim().startsWith('{')) throw new Fail('bad-login', 401, t.slice(0, 200))
    }
    // classic external API
    if (!this.dbName) throw new Fail('need-db', 400)
    const uid = await this.rpc('common', 'login', [this.dbName, this.c.login, this.c.api_key])
    if (!uid) throw new Fail('bad-login', 401)
    this.uid = uid
    this.mode = 'jsonrpc'
  }

  /** model method with named arguments, e.g. call('hr.attendance', 'search_read', {domain, fields}) */
  async call(model: string, method: string, params: Rec) {
    if (!this.mode) await this.connect()
    if (this.mode === 'json2') {
      const h: Record<string, string> = { Authorization: `bearer ${this.c.api_key}` }
      if (this.dbName) h['X-Odoo-Database'] = this.dbName
      const r = await this.post(`/json/2/${model}/${method}`, params, h)
      const text = await r.text()
      if (!r.ok) {
        let msg = text.slice(0, 300)
        try { const j = JSON.parse(text); msg = String(j.message ?? j.error?.message ?? msg) } catch { /* not json */ }
        if (r.status === 401) throw new Fail('bad-login', 401, msg)
        if (r.status === 404 && /model|not found/i.test(msg)) throw new Fail('no-model', 404, msg)
        throw new Fail('odoo-error', 502, msg)
      }
      return JSON.parse(text)
    }
    try {
      return await this.rpc('object', 'execute_kw', [this.dbName, this.uid, this.c.api_key, model, method, [], params])
    } catch (e) {
      if (e instanceof Fail && /doesn't exist|does not exist|Object .* doesn't/i.test(e.detail)) throw new Fail('no-model', 404, e.detail)
      throw e
    }
  }

  async searchReadAll(model: string, domain: unknown[], fields: string[], context: Rec, order = 'id asc', cap = 20000) {
    const out: Rec[] = []
    for (let offset = 0; offset < cap; offset += 500) {
      const page: Rec[] = await this.call(model, 'search_read', { domain, fields, offset, limit: 500, order, context })
      out.push(...page)
      if (page.length < 500) break
    }
    return out
  }
}

/* ---------- helpers ---------- */

/** Odoo keeps datetimes in UTC as "YYYY-MM-DD HH:MM:SS" */
const fromOdoo = (s: string | false | null) => (s ? new Date(s.replace(' ', 'T') + 'Z').toISOString() : undefined)
const toOdoo = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ')

/** local wall-clock of an instant in a timezone */
function local(iso: string, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) }
}
const hm = (s: string | undefined, d: number) => { const m = /^(\d{1,2}):(\d{2})/.exec(s ?? ''); return m ? Number(m[1]) * 60 + Number(m[2]) : d }

function normPhone(p?: string | false) {
  let s = String(p || '').replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/\D/g, '')
  if (s.startsWith('00')) s = s.slice(2)
  if (s.length === 11 && s.startsWith('01')) s = '2' + s
  return s
}
const normName = (s?: string | false) =>
  String(s || '').toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim()
const m2o = (v: unknown): [number, string] | null => (Array.isArray(v) && v.length ? [Number(v[0]), String(v[1] ?? '')] : null)

async function load(kind: string, idLike?: string): Promise<Rec[]> {
  const out: Rec[] = []
  for (let from = 0; ; from += 1000) {
    let q = db().from('records').select('data').eq('kind', kind).eq('deleted', false)
    if (idLike) q = q.like('id', idLike)
    const { data, error } = await q.range(from, from + 999)
    if (error) throw error
    out.push(...data.map((r) => r.data))
    if (data.length < 1000) return out
  }
}

async function getCfg(companyId: string): Promise<Cfg | null> {
  const { data, error } = await db().from('odoo_connections').select('*').eq('company_id', companyId).maybeSingle()
  if (error) throw new Fail('no-table', 500, error.message)
  return data as Cfg | null
}
async function allCfgs(): Promise<Cfg[]> {
  const { data, error } = await db().from('odoo_connections').select('*')
  if (error) throw new Fail('no-table', 500, error.message)
  return (data ?? []) as Cfg[]
}

const rid = (p: string) => p + crypto.randomUUID().replace(/-/g, '').slice(0, 10)

/* ---------- the pull: one Odoo database -> one Madar company ---------- */

async function sync(cfg: Cfg, full = false) {
  const odoo = new Odoo(cfg)
  await odoo.connect()
  const tz = cfg.tz || 'Africa/Cairo'
  const since = cfg.since ? new Date(cfg.since + 'T00:00:00Z') : (() => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() - 2, 1); d.setUTCHours(0, 0, 0, 0); return d })()
  const sinceStr = toOdoo(since)
  const cid = cfg.company_id
  const pre = `odoo_${cid}_`

  const oCompanies: Rec[] = await odoo.call('res.company', 'search_read', { domain: [], fields: ['name'], context: {} })
  const context = { allowed_company_ids: oCompanies.map((c) => c.id), tz, active_test: false }
  const employees = await odoo.searchReadAll('hr.employee', [], ['name', 'work_email', 'mobile_phone', 'work_phone', 'company_id'], context)

  const [users, memberships, companies, existingAll, existingLeavesAll] = await Promise.all([
    load('users'), load('memberships'), load('companies'), load('attendance', `${pre}%`), load('leaves', `${pre}%`),
  ])
  const company = companies.find((c) => c.id === cid)
  if (!company) throw new Fail('no-company', 404)
  const existing = existingAll, existingLeaves = existingLeavesAll

  // match people: work email, then phone, then name. People of this company first, then anyone in Madar.
  const inCo = new Set(memberships.filter((m) => m.companyId === cid).map((m) => m.userId))
  const ranked = [...users.filter((u) => inCo.has(u.id)), ...users.filter((u) => !inCo.has(u.id))]
  const byEmail = new Map<string, Rec>(), byPhone = new Map<string, Rec>(), byName = new Map<string, Rec>()
  for (const u of [...ranked].reverse()) {
    if (u.email) byEmail.set(String(u.email).toLowerCase().trim(), u)
    if (normPhone(u.phone).length >= 9) byPhone.set(normPhone(u.phone).slice(-9), u)
    byName.set(normName(u.name), u)
  }
  const empUser = new Map<number, Rec>()
  for (const e of employees) {
    const u = byEmail.get(String(e.work_email || '').toLowerCase().trim())
      ?? byPhone.get(normPhone(e.mobile_phone).slice(-9) || '-') ?? byPhone.get(normPhone(e.work_phone).slice(-9) || '-')
      ?? byName.get(normName(e.name))
    if (u) empUser.set(e.id, u)
  }

  // ---- check-ins / outs
  const domain = !full && cfg.cursor ? [['write_date', '>=', cfg.cursor]] : [['check_in', '>=', sinceStr]]
  const atts = await odoo.searchReadAll('hr.attendance', domain, ['employee_id', 'check_in', 'check_out', 'write_date'], context, 'write_date asc, id asc')

  const old = new Map(existing.map((a) => [a.id, a]))
  const rows: { kind: string; id: string; data: Rec; deleted: boolean }[] = []
  const lateNow: Rec[] = []
  let cursor = cfg.cursor ?? ''
  let added = 0, changed = 0
  const grace = Number(company.graceMinutes ?? 0)
  for (const a of atts) {
    if (a.write_date && a.write_date > cursor) cursor = a.write_date
    const ref = m2o(a.employee_id)
    const user = ref && empUser.get(ref[0])
    if (!user) continue
    const checkInAt = fromOdoo(a.check_in)!
    const checkOutAt = fromOdoo(a.check_out)
    const late = local(checkInAt, tz).min > hm(company.workStart, 540) + grace
    const earlyLeave = !!checkOutAt && local(checkOutAt, tz).min < hm(company.workEnd, 1020) - grace
    const id = `${pre}${a.id}`
    const prev = old.get(id)
    const data: Rec = { ...(prev ?? {}), id, userId: user.id, companyId: cid, checkInAt, method: 'odoo', late, earlyLeave, plannedTaskIds: prev?.plannedTaskIds ?? [], odooId: a.id }
    if (checkOutAt) data.checkOutAt = checkOutAt; else delete data.checkOutAt
    if (prev && JSON.stringify(prev) === JSON.stringify(data)) continue
    rows.push({ kind: 'attendance', id, data, deleted: false })
    if (prev) changed++
    else { added++; if (late && Date.now() - Date.parse(checkInAt) < 3 * 3600e3) lateNow.push(data) }
  }

  // ---- days deleted in Odoo during the last 40 days
  const win = new Date(Date.now() - 40 * 864e5)
  const liveIds = new Set<number>(await odoo.call('hr.attendance', 'search', { domain: [['check_in', '>=', toOdoo(win)]], context }))
  let removed = 0
  for (const a of existing) {
    if (Date.parse(a.checkInAt) >= +win && !liveIds.has(Number(a.odooId)) && !rows.some((r) => r.id === a.id)) {
      rows.push({ kind: 'attendance', id: a.id, data: a, deleted: true })
      removed++
    }
  }

  // ---- approved time off + public holidays (so those days aren't counted as absence)
  const leaveRows: Rec[] = []
  const notes: string[] = []
  try {
    const leaves = await odoo.searchReadAll('hr.leave', [['state', '=', 'validate'], ['date_to', '>=', sinceStr]], ['employee_id', 'date_from', 'date_to', 'holiday_status_id'], context)
    for (const l of leaves) {
      const ref = m2o(l.employee_id)
      const user = ref && empUser.get(ref[0])
      if (user) leaveRows.push({ id: `${pre}leave_${l.id}`, userId: user.id, companyId: cid, from: fromOdoo(l.date_from), to: fromOdoo(l.date_to), type: m2o(l.holiday_status_id)?.[1] ?? 'إجازة', source: 'odoo' })
    }
  } catch (e) { notes.push(e instanceof Fail && e.code === 'no-model' ? 'no-time-off-app' : 'leaves: ' + (e as Error).message) }
  try {
    const hol = await odoo.searchReadAll('resource.calendar.leaves', [['resource_id', '=', false], ['date_to', '>=', sinceStr]], ['name', 'date_from', 'date_to'], context)
    for (const h of hol) leaveRows.push({ id: `${pre}hol_${h.id}`, companyId: cid, from: fromOdoo(h.date_from), to: fromOdoo(h.date_to), type: h.name || 'إجازة رسمية', holiday: true, source: 'odoo' })
  } catch (e) { notes.push('holidays: ' + (e as Error).message) }
  const oldLeaves = new Map(existingLeaves.map((l) => [l.id, l]))
  for (const l of leaveRows) {
    if (!l.from || !l.to) continue
    if (JSON.stringify(oldLeaves.get(l.id)) !== JSON.stringify(l)) rows.push({ kind: 'leaves', id: l.id, data: l, deleted: false })
    oldLeaves.delete(l.id)
  }
  for (const l of oldLeaves.values()) if (Date.parse(l.to) >= +since) rows.push({ kind: 'leaves', id: l.id, data: l, deleted: true })

  // ---- tell the company's managers about late arrivals that just happened
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? ''
  for (const a of lateNow) {
    for (const m of memberships.filter((m) => m.companyId === cid && m.role !== 'employee' && m.userId !== a.userId)) {
      const n = { id: rid('n_'), userId: m.userId, companyId: cid, kind: 'attendance', title: `${nameOf(a.userId)} سجّل حضور متأخر (أودو)`, body: `${company.short ?? ''} · الساعة ${new Date(a.checkInAt).toLocaleTimeString('ar-EG', { timeZone: tz, hour: 'numeric', minute: '2-digit' })}`, at: new Date().toISOString(), read: false }
      rows.push({ kind: 'notifications', id: n.id, data: n, deleted: false })
    }
  }

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db().from('records').upsert(rows.slice(i, i + 500), { onConflict: 'kind,id' })
    if (error) throw new Fail('save-failed', 500, error.message)
  }

  const result = {
    at: new Date().toISOString(), mode: odoo.mode, full,
    odooCompanies: oCompanies.map((c) => c.name),
    employees: employees.length, matched: empUser.size,
    unmatchedEmployees: employees.filter((e) => !empUser.has(e.id)).map((e) => ({ id: e.id, name: e.name, email: e.work_email || null })).slice(0, 200),
    pulled: atts.length, added, changed, removed, leaves: leaveRows.length, notes,
  }
  await db().from('odoo_connections').update({ cursor: cursor || null, last_sync: result.at, last_result: result, since: cfg.since ?? since.toISOString().slice(0, 10) }).eq('company_id', cid)
  return result
}

/* ---------- requests ---------- */

async function who(req: Request): Promise<'owner' | 'member'> {
  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const [{ data: member }, { data: owner }] = await Promise.all([sb.rpc('is_member'), sb.rpc('is_owner')])
  if (owner === true) return 'owner'
  if (member === true) return 'member'
  throw new Fail('not-member', 403)
}

const publicCfg = (c: Cfg) => ({ companyId: c.company_id, url: c.url, db: c.db, login: c.login, tz: c.tz, since: c.since, lastSync: c.last_sync, lastResult: c.last_result })

async function syncSafe(cfg: Cfg, full = false) {
  try { return await sync(cfg, full) } catch (e) {
    const err = { at: new Date().toISOString(), error: e instanceof Fail ? e.code : 'failed', detail: e instanceof Fail ? e.detail : String(e) }
    await db().from('odoo_connections').update({ last_sync: err.at, last_result: { ...(cfg.last_result ?? {}), lastError: err } }).eq('company_id', cfg.company_id)
    throw e
  }
}

async function handle(req: Request) {
  let body: Rec
  try { body = await req.json() } catch { throw new Fail('bad-json') }

  if (body.tick) {
    const out: Rec = {}
    for (const cfg of await allCfgs()) {
      if (cfg.last_sync && Date.now() - Date.parse(cfg.last_sync) < 4 * 60e3) { out[cfg.company_id] = 'recent'; continue }
      try { const r = await syncSafe(cfg); out[cfg.company_id] = { added: r.added, changed: r.changed } } catch (e) { out[cfg.company_id] = { error: (e as Error).message } }
    }
    return out
  }

  const role = await who(req)
  const action = String(body.action ?? 'status')
  if (action === 'status') return { connections: (await allCfgs()).map(publicCfg) }

  const companyId = String(body.companyId ?? '')
  if (!companyId) throw new Fail('missing-company')
  const need = async () => { const c = await getCfg(companyId); if (!c) throw new Fail('not-configured', 409); return c }
  const done = async (r: Rec) => ({ ...publicCfg((await getCfg(companyId))!), lastResult: r })

  if (action === 'sync') return done(await syncSafe(await need()))
  if (role !== 'owner') throw new Fail('owner-only', 403)

  if (action === 'configure') {
    const old = await getCfg(companyId)
    let url = String(body.url ?? '').trim()
    if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url
    try { url = new URL(url).origin } catch { throw new Fail('bad-url') }
    const next = {
      company_id: companyId,
      url,
      db: String(body.db ?? '').trim(),
      login: String(body.login ?? '').trim(),
      api_key: String(body.apiKey ?? '').trim() || old?.api_key || '',
      tz: String(body.tz ?? old?.tz ?? 'Africa/Cairo'),
      since: /^\d{4}-\d{2}-\d{2}$/.test(String(body.since ?? '')) ? String(body.since) : old?.since ?? null,
    }
    if (!next.login || !next.api_key) throw new Fail('missing')
    await new Odoo(next).connect() // throws bad-login / bad-url / need-db
    const same = !!old && old.url === next.url && old.db === next.db
    const { error } = await db().from('odoo_connections').upsert({ ...next, cursor: same ? old!.cursor : null, updated_at: new Date().toISOString() }, { onConflict: 'company_id' })
    if (error) throw new Fail('save-failed', 500, error.message)
    return done(await syncSafe((await getCfg(companyId))!, !same))
  }
  if (action === 'resync') return done(await syncSafe(await need(), true))
  if (action === 'disconnect') {
    await db().from('odoo_connections').delete().eq('company_id', companyId)
    return { companyId, disconnected: true }
  }
  throw new Fail('bad-action')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  try {
    return json(await handle(req))
  } catch (e) {
    if (e instanceof Fail) return json({ error: e.code, detail: e.detail }, e.status)
    console.error(e)
    return json({ error: 'failed', detail: String((e as Error).message ?? e) }, 500)
  }
})
