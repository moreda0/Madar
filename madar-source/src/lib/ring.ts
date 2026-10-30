// رنة مدار: Madar's own notification sounds, synthesized live (no audio files), so they sound like
// nothing else on the phone. Bell tones (FM) climbing like an orbit, with a soft shimmer on top.
//  assigned = the signature "orbit" (new task) · reminder = two soft pings · overdue = urgent pulse
import type { NotificationKind } from './types'

const KEY = 'madar-ring'
export type RingStyle = 'assigned' | 'reminder' | 'overdue' | 'soft'

export const ringOn = () => { try { return localStorage.getItem(KEY) !== 'off' } catch { return true } }
export const setRingOn = (on: boolean) => { try { localStorage.setItem(KEY, on ? 'on' : 'off') } catch { /* private mode */ } }

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

/** one FM bell: a sine carrier bent by a modulator that fades, so it starts bright and rings out warm */
function bell(c: AudioContext, out: AudioNode, at: number, freq: number, len: number, vol: number, ratio = 1.4) {
  const car = c.createOscillator(), mod = c.createOscillator(), modGain = c.createGain(), amp = c.createGain()
  car.frequency.value = freq
  mod.frequency.value = freq * ratio
  modGain.gain.setValueAtTime(freq * 2.2, at)
  modGain.gain.exponentialRampToValueAtTime(freq * 0.05, at + len)
  amp.gain.setValueAtTime(0.0001, at)
  amp.gain.exponentialRampToValueAtTime(vol, at + 0.012)
  amp.gain.exponentialRampToValueAtTime(0.0001, at + len)
  mod.connect(modGain).connect(car.frequency)
  car.connect(amp).connect(out)
  car.start(at); mod.start(at); car.stop(at + len + 0.05); mod.stop(at + len + 0.05)
}

/** a high glassy shimmer that sweeps across, the "orbit" */
function shimmer(c: AudioContext, out: AudioNode, at: number, from: number, to: number, len: number, vol: number) {
  const o = c.createOscillator(), g = c.createGain()
  const pan = c.createStereoPanner?.()
  o.type = 'triangle'
  o.frequency.setValueAtTime(from, at)
  o.frequency.exponentialRampToValueAtTime(to, at + len)
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(vol, at + len * 0.3)
  g.gain.exponentialRampToValueAtTime(0.0001, at + len)
  if (pan) {
    pan.pan.setValueAtTime(-0.8, at)
    pan.pan.linearRampToValueAtTime(0.8, at + len)
    o.connect(g).connect(pan).connect(out)
  } else o.connect(g).connect(out)
  o.start(at); o.stop(at + len + 0.05)
}

export function playRing(style: RingStyle = 'assigned', force = false) {
  if (!force && !ringOn()) return
  const c = audio()
  if (!c) return
  const master = c.createGain()
  master.gain.value = 0.9
  // a little echo gives it space without sounding like a phone's stock tone
  const echo = c.createDelay(), fb = c.createGain(), wet = c.createGain()
  echo.delayTime.value = 0.17; fb.gain.value = 0.28; wet.gain.value = 0.35
  master.connect(c.destination)
  master.connect(echo); echo.connect(fb).connect(echo); echo.connect(wet).connect(c.destination)
  const t = c.currentTime + 0.03

  if (style === 'assigned') {
    // E5 → B5 → E6 → G#6: climbing into orbit, then the shimmer circles over it
    ;[659.25, 987.77, 1318.5, 1661.2].forEach((f, i) => bell(c, master, t + i * 0.11, f, 1.1 - i * 0.12, 0.22 - i * 0.025))
    shimmer(c, master, t + 0.28, 2600, 4200, 0.7, 0.035)
    bell(c, master, t + 0.5, 329.63, 1.4, 0.12, 2) // low root under it
  } else if (style === 'reminder') {
    bell(c, master, t, 1174.7, 0.8, 0.2)
    bell(c, master, t + 0.22, 1568, 1.1, 0.17)
  } else if (style === 'overdue') {
    for (let r = 0; r < 2; r++) {
      bell(c, master, t + r * 0.46, 1396.9, 0.35, 0.24, 2.01)
      bell(c, master, t + r * 0.46 + 0.14, 1046.5, 0.45, 0.22, 2.01)
    }
  } else {
    bell(c, master, t, 1318.5, 0.9, 0.16)
  }
}

export const ringFor = (kind: NotificationKind): RingStyle =>
  kind === 'assigned' ? 'assigned' : kind === 'reminder' ? 'reminder' : kind === 'overdue' ? 'overdue' : 'soft'
