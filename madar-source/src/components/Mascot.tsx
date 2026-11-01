import { useEffect, useRef, useState } from 'react'
import { mountGroom } from '../lib/groom3d'

/** Madar's 3D mascot: drops in clapping, with confetti whenever a notification rings. Tap to dismiss. */
export const showMascot = () => window.dispatchEvent(new Event('madar-mascot'))

const CONFETTI = ['#22d3ee', '#a78bfa', '#fbbf24', '#34d399', '#f472b6']

export function Mascot() {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const on = () => setShown(Date.now())
    window.addEventListener('madar-mascot', on)
    return () => window.removeEventListener('madar-mascot', on)
  }, [])
  useEffect(() => {
    if (!shown) return
    const t = setTimeout(() => setShown(0), 6000)
    return () => clearTimeout(t)
  }, [shown])
  if (!shown) return null
  return (
    <div className="mascot-layer" key={shown} onPointerDown={() => setShown(0)} role="presentation">
      {Array.from({ length: 28 }, (_, i) => (
        <i key={i} className="confetti" style={{ left: `${(i * 37) % 100}%`, background: CONFETTI[i % CONFETTI.length], animationDelay: `${0.6 + (i % 7) * 0.12}s`, ['--drift' as string]: `${((i * 53) % 120) - 60}px` }} />
      ))}
      <div className="mascot">
        <Groom />
      </div>
    </div>
  )
}

/** The real 3D model clapping; while it loads (or if the device has no WebGL) the cut-out figure claps instead */
function Groom() {
  const ref = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let stop: (() => void) | undefined
    let dead = false
    if (ref.current) mountGroom(ref.current).then((s) => { if (dead) s(); else { stop = s; setReady(true) } }).catch(() => {})
    return () => { dead = true; stop?.() }
  }, [])
  return (
    <div className="groom">
      <canvas ref={ref} style={{ opacity: ready ? 1 : 0 }} />
      {!ready && (
        <div className="fig">
          <img src="./mascot/body.webp" alt="" draggable={false} />
          <img className="rarm" src="./mascot/rarm.webp" alt="" draggable={false} />
          <img className="larm" src="./mascot/larm.webp" alt="" draggable={false} />
          <img className="head" src="./mascot/head.webp" alt="" draggable={false} />
        </div>
      )}
    </div>
  )
}

/** Fetch the 3D model and three.js quietly in the background so the first ring shows him at once */
export function preloadGroom() {
  const go = () => { import('three').catch(() => {}); fetch('./mascot/groom.bin').catch(() => {}); fetch('./mascot/groom.webp').catch(() => {}) }
  const idle = (window as unknown as { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback
  setTimeout(() => (idle ? idle(go) : go()), 4000)
}
