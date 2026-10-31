// رنة مدار: every kind of notification has its own sound, picked in Settings from Madar's library
// (public/sounds/lib) or uploaded from the person's own device. Defaults: chicken, duck, sad trombone.
import type { NotificationKind } from './types'

const KEY = 'madar-ring'
const PICK_KEY = 'madar-ring-pick'
const CUSTOM_KEY = (s: PickStyle) => `madar-ring-custom-${s}`
export type RingStyle = 'assigned' | 'reminder' | 'overdue' | 'soft'
export type PickStyle = 'assigned' | 'reminder' | 'overdue'

export const SOUND_GROUPS: { title: string; sounds: { id: string; name: string }[] }[] = [
  { title: 'مضحكة', sounds: [
    { id: 'chicken', name: 'فرخة بتصرخ' }, { id: 'duck', name: 'بطة' }, { id: 'trombone', name: 'ترومبون حزين' },
    { id: 'boing', name: 'صفارة وبوينج' }, { id: 'monkey-laugh', name: 'قرد بيضحك' }, { id: 'frogs', name: 'كورال ضفادع' },
    { id: 'tiny-dog', name: 'كلب صغنن' }, { id: 'chipmunk', name: 'قطة سنجاب' }, { id: 'elephant-tune', name: 'فيل بيغني' },
    { id: 'monster-cow', name: 'بقرة وحش' }, { id: 'goat', name: 'معزة' },
  ] },
  { title: 'حيوانات', sounds: [
    { id: 'bird', name: 'عصفورة' }, { id: 'cat', name: 'قطة' }, { id: 'dog', name: 'كلب' }, { id: 'lion', name: 'أسد' },
    { id: 'horse', name: 'حصان' }, { id: 'hen', name: 'فرخة' }, { id: 'cow', name: 'بقرة' }, { id: 'elephant', name: 'فيل' },
    { id: 'monkey', name: 'قرد' }, { id: 'cricket', name: 'صرصار الليل' },
  ] },
  { title: 'نغمات', sounds: [
    { id: 'tada', name: 'تا دا!' }, { id: 'dingdong', name: 'جرس الباب' }, { id: 'marimba', name: 'ماريمبا' },
    { id: 'sparkle', name: 'سحر' }, { id: 'bubbles', name: 'فقاقيع' }, { id: 'pew', name: 'ليزر' }, { id: 'alarm', name: 'منبه' },
  ] },
]
export const CUSTOM = 'custom'
export const DEFAULT_PICK: Record<PickStyle, string> = { assigned: 'chicken', reminder: 'duck', overdue: 'trombone' }
export const soundName = (id: string) =>
  id === CUSTOM ? 'صوت من عندك' : SOUND_GROUPS.flatMap((g) => g.sounds).find((s) => s.id === id)?.name ?? id

export const ringOn = () => { try { return localStorage.getItem(KEY) !== 'off' } catch { return true } }
export const setRingOn = (on: boolean) => { try { localStorage.setItem(KEY, on ? 'on' : 'off') } catch { /* private mode */ } }

export function getPicks(): Record<PickStyle, string> {
  try { return { ...DEFAULT_PICK, ...JSON.parse(localStorage.getItem(PICK_KEY) || '{}') } } catch { return { ...DEFAULT_PICK } }
}
export function setPick(style: PickStyle, id: string) {
  try { localStorage.setItem(PICK_KEY, JSON.stringify({ ...getPicks(), [style]: id })) } catch { /* private mode */ }
}
export const hasCustom = (s: PickStyle) => { try { return !!localStorage.getItem(CUSTOM_KEY(s)) } catch { return false } }

/** Save an uploaded sound (kept on this device). Rejects files over ~1.5 MB. */
export async function setCustom(style: PickStyle, file: File): Promise<string | null> {
  if (!file.type.startsWith('audio/') && !/\.(mp3|wav|ogg|m4a|aac)$/i.test(file.name)) return 'ده مش ملف صوت'
  if (file.size > 1_500_000) return 'الملف كبير، اختاري صوت أقل من 1.5 ميجا (ثواني قليلة)'
  const url = await new Promise<string>((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = fail; r.readAsDataURL(file) })
  const c = audio()
  if (c) { try { await c.decodeAudioData(await (await fetch(url)).arrayBuffer()) } catch { return 'الصوت ده مش بيشتغل، جربي ملف mp3' } }
  try { localStorage.setItem(CUSTOM_KEY(style), url) } catch { return 'مفيش مساحة كفاية على الجهاز للصوت ده' }
  buffers.delete(`custom:${style}`)
  setPick(style, CUSTOM)
  return null
}

let ctx: AudioContext | null = null
function audio() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

// browsers only allow sound after the first tap, so wake the audio on it
if (typeof window !== 'undefined') {
  const unlock = () => { audio(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock) }
  window.addEventListener('pointerdown', unlock)
  window.addEventListener('keydown', unlock)
}

// decoded once, then every ring starts instantly
const buffers = new Map<string, Promise<AudioBuffer | null>>()
function load(c: AudioContext, key: string, url: string) {
  if (!buffers.has(key))
    buffers.set(key, fetch(url).then((r) => r.arrayBuffer()).then((b) => c.decodeAudioData(b)).catch(() => { buffers.delete(key); return null }))
  return buffers.get(key)!
}

function source(style: PickStyle, id: string): [string, string] {
  if (id === CUSTOM) {
    try { const u = localStorage.getItem(CUSTOM_KEY(style)); if (u) return [`custom:${style}`, u] } catch { /* fall back */ }
    id = DEFAULT_PICK[style]
  }
  return [id, `./sounds/lib/${id}.mp3`]
}

let lastRing = 0
/** Play a sound by id (for previews in Settings) */
export async function playSound(id: string, style: PickStyle = 'assigned') {
  const c = audio()
  if (!c) return
  const [key, url] = source(style, id)
  const buf = await load(c, key, url)
  if (!buf) return
  const src = c.createBufferSource()
  src.buffer = buf
  src.connect(c.destination)
  src.start()
}

export async function playRing(style: RingStyle = 'assigned', force = false) {
  if (!force && !ringOn()) return
  // the push and the synced notification can both ask for the same ring: play it once
  if (!force && Date.now() - lastRing < 4000) return
  lastRing = Date.now()
  const s: PickStyle = style === 'soft' ? 'reminder' : style
  return playSound(getPicks()[s], s)
}

export const ringFor = (kind: NotificationKind): RingStyle =>
  kind === 'assigned' ? 'assigned' : kind === 'reminder' ? 'reminder' : kind === 'overdue' ? 'overdue' : 'soft'

// a push that lands while Madar is open (even in a background tab) rings with Madar's own sound too
if (typeof navigator !== 'undefined' && navigator.serviceWorker)
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'ring') playRing(ringFor(e.data.kind))
  })
