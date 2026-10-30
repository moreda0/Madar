// مدار: phone notifications with the app closed (Supabase Edge Function "madar-push", JWT verification OFF).
//
//  POST {"tick":true}   from the records trigger (every new notification) and Cron (every minute):
//                       creates due/overdue reminders the same way the app does, then pushes every fresh,
//                       unread notification to the devices of the person it's for.
// Tables and the signing key: supabase/push.sql. Safe to call any time: each notification goes to each
// device once.
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'

const env = (k: string, d = '') => Deno.env.get(k) ?? d
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
const VAPID_PUBLIC = 'BHUzRDOyP0IEV4Pmxk6xKs4U_Ln8BGw2BsXe4ZGvQ6P__T1tPUyfdg1-UITLJNwah0ldTrmfnUbzskVMhJ7zzrM'

type Rec = Record<string, any>

async function load(kind: string, recentOnly = false) {
  const out: Rec[] = []
  for (let from = 0; ; from += 1000) {
    let q = db.from('records').select('data').eq('kind', kind).eq('deleted', false).range(from, from + 999)
    if (recentOnly) q = q.gt('updated_at', new Date(Date.now() - 864e5).toISOString())
    const { data, error } = await q
    if (error) throw error
    out.push(...data.map((r) => r.data))
    if (data.length < 1000) break
  }
  return out
}

const save = (kind: string, id: string, data: Rec) => db.from('records').upsert({ kind, id, data, deleted: false }, { onConflict: 'kind,id' })

let keyReady = false
async function vapid() {
  if (keyReady) return true
  const { data, error } = await db.rpc('push_private_key')
  if (error || !data) { console.error('no push key', error); return false }
  webpush.setVapidDetails('mailto:manar55574@gmail.com', VAPID_PUBLIC, data)
  return (keyReady = true)
}

async function tick() {
  const [users, tasks, notifications] = await Promise.all([load('users'), load('tasks'), load('notifications', true)])
  const now = Date.now()
  const have = new Set(notifications.map((n) => n.id))
  const add = async (n: Rec) => {
    if (have.has(n.id)) return
    const full = { ...n, at: new Date().toISOString(), read: false }
    have.add(n.id); notifications.push(full)
    await save('notifications', n.id, full)
  }

  // the same reminders the app fires, with the same ids, so the app and the server never double up
  for (const t of tasks) {
    if (!t.dueAt || t.status === 'done') continue
    const due = new Date(t.dueAt).getTime()
    if (t.remindBefore > 0 && now >= due - t.remindBefore * 60000 && now < due && t.assigneeId)
      await add({ id: `rem:${t.id}:${t.dueAt}`, userId: t.assigneeId, companyId: t.companyId, kind: 'reminder', title: `فاضل ${Math.max(1, Math.round((due - now) / 60000))} دقيقة على الميعاد`, body: t.title, taskId: t.id })
    if (now >= due && now - due < 3 * 864e5)
      for (const u of new Set([t.assigneeId, t.creatorId].filter(Boolean)))
        await add({ id: `late:${t.id}:${t.dueAt}:${u}`, userId: u, companyId: t.companyId, kind: 'overdue', title: 'مهمة عدّت ميعادها', body: t.title, taskId: t.id })
  }

  // fresh = unread and from the last 15 minutes (a device that was off doesn't get a pile of old ones)
  const fresh = notifications.filter((n) => !n.read && now - new Date(n.at).getTime() < 15 * 60e3)
  if (!fresh.length) return { sent: 0 }

  // Madar person -> sign-in email -> their devices
  const [{ data: members }, { data: subs }] = await Promise.all([
    db.from('workspace_members').select('email, user_id'),
    db.from('push_subs').select('*'),
  ])
  if (!subs?.length) return { sent: 0, devices: 0 }
  const uidByEmail = new Map((members ?? []).filter((m) => m.user_id).map((m) => [m.email, m.user_id]))
  const devicesOf = (userId: string) => {
    const email = users.find((u) => u.id === userId)?.email?.toLowerCase()
    const uid = email && uidByEmail.get(email)
    return uid ? subs.filter((s) => s.auth_uid === uid) : []
  }

  if (!(await vapid())) return { error: 'no key' }
  let count = 0
  for (const n of fresh) {
    for (const s of devicesOf(n.userId)) {
      if (new Date(s.created_at).getTime() - 60e3 > new Date(n.at).getTime()) continue // older than the device
      // claim first so two ticks never push the same thing twice
      const { error } = await db.from('push_sent').insert({ notification_id: n.id, endpoint: s.endpoint })
      if (error) continue
      const payload = JSON.stringify({ title: n.title, body: n.body, tag: n.id, taskId: n.taskId ?? null, kind: n.kind })
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: n.kind === 'overdue' || n.kind === 'assigned' ? 'high' : 'normal' })
        count++
      } catch (e: any) {
        // the phone unsubscribed or the app was removed: forget the device
        if (e?.statusCode === 404 || e?.statusCode === 410) await db.from('push_subs').delete().eq('endpoint', s.endpoint)
        else console.error('push failed', e?.statusCode, e?.body ?? e)
      }
    }
  }
  return { sent: count }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('madar-push ok', { status: 200 })
  let body: Rec = {}
  try { body = await req.json() } catch { /* empty */ }
  if (!body.tick) return new Response('ignored', { status: 200 })
  try { return Response.json(await tick()) } catch (e) { console.error('tick failed', e); return Response.json({ error: 'tick' }, { status: 500 }) }
})
