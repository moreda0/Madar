// Notifications that arrive with the app closed (Web Push). The phone shows them like any app's,
// with Madar's own vibration pattern. Subscriptions are saved in Supabase (push_subs) and the
// madar-push function sends to them. On iPhone this only works once Madar is on the home screen.
import { getClient, getSyncConfig } from './sync'

/** flips on once supabase/push.sql and the madar-push function are live on the server */
export const PUSH_LIVE = true

const VAPID_PUBLIC = 'BHUzRDOyP0IEV4Pmxk6xKs4U_Ln8BGw2BsXe4ZGvQ6P__T1tPUyfdg1-UITLJNwah0ldTrmfnUbzskVMhJ7zzrM'

export type PushState = 'on' | 'off' | 'denied' | 'unsupported' | 'needs-install' | 'needs-sync'

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

function keyBytes(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

export async function pushState(): Promise<PushState> {
  if (!PUSH_LIVE || !getSyncConfig()) return 'needs-sync'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return isIOS() && !standalone() ? 'needs-install' : 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  if (Notification.permission !== 'granted') return 'off'
  const reg = await navigator.serviceWorker.getRegistration()
  return (await reg?.pushManager.getSubscription()) ? 'on' : 'off'
}

/** ask (from a tap), subscribe this device and save it. quiet = refresh only, never prompt */
export async function enablePush(quiet = false): Promise<PushState> {
  const state = await pushState()
  if (state === 'needs-sync' || state === 'unsupported' || state === 'needs-install' || state === 'denied') return state
  if (Notification.permission !== 'granted') {
    if (quiet) return 'off'
    if ((await Notification.requestPermission()) !== 'granted') return Notification.permission === 'denied' ? 'denied' : 'off'
  }
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC) }))
    const j = sub.toJSON()
    const { error } = await getClient()!.rpc('save_push_sub', { p_endpoint: sub.endpoint, p_p256dh: j.keys?.p256dh, p_auth: j.keys?.auth, p_ua: navigator.userAgent.slice(0, 200) })
    if (error) { console.warn('push save failed', error.message); return 'off' }
    return 'on'
  } catch (e) {
    console.warn('push subscribe failed', e)
    return 'off'
  }
}
