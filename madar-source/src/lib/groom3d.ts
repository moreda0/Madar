// The groom in 3D: her model (decimated to ~23k triangles) with a tiny skeleton so he really claps.
// public/mascot/groom.bin = header JSON + quantized positions, uvs, skin indices/weights and triangles.
// three.js is loaded only the first time he shows up.
export async function mountGroom(canvas: HTMLCanvasElement): Promise<() => void> {
  const THREE = await import('three')
  const [buf, tex] = await Promise.all([
    fetch('./mascot/groom.bin').then((r) => r.arrayBuffer()),
    new THREE.TextureLoader().loadAsync('./mascot/groom.webp'),
  ])
  const hl = new DataView(buf).getUint32(0, true)
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hl))) as { n: number; tris: number; min: number[]; max: number[]; idx32: boolean }
  let o = 4 + hl; o += (4 - (o % 4)) % 4
  const take = <T>(C: new (b: ArrayBuffer, o: number, n: number) => T, n: number, bytes: number) => { const a = new C(buf, o, n); o += n * bytes; o += (4 - (o % 4)) % 4; return a }
  const { n, min, max } = head
  const qp = take(Uint16Array, n * 3, 2), quv = take(Uint16Array, n * 2, 2), si = take(Uint8Array, n * 4, 1), sw = take(Uint8Array, n * 4, 1)
  const idx = head.idx32 ? take(Uint32Array, head.tris * 3, 4) : take(Uint16Array, head.tris * 3, 2)
  const pos = new Float32Array(n * 3)
  for (let i = 0; i < n * 3; i++) { const k = i % 3; pos[i] = min[k] + (qp[i] / 65535) * (max[k] - min[k]) }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(quv, 2, true))
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Uint16Array.from(si), 4))
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4, true))
  g.setIndex(new THREE.BufferAttribute(idx, 1))
  g.computeVertexNormals()
  tex.colorSpace = THREE.SRGBColorSpace
  tex.flipY = false
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 })

  // bones: 0 root, 1 head, 2/3 left upper/lower arm, 4/5 right upper/lower arm (positions in model space)
  const bone = (x: number, y: number, z: number) => { const b = new THREE.Bone(); b.position.set(x, y, z); return b }
  const root = bone(0, 0, 0), hd = bone(0, 1.15, 0)
  const lu = bone(-0.215, 1.12, -0.03), ll = bone(-0.075, -0.28, -0.06)
  const ru = bone(0.215, 1.12, -0.03), rl = bone(0.075, -0.28, -0.06)
  root.add(hd, lu, ru); lu.add(ll); ru.add(rl)
  const mesh = new THREE.SkinnedMesh(g, mat)
  mesh.add(root)
  mesh.updateMatrixWorld(true)
  mesh.bind(new THREE.Skeleton([root, hd, lu, ll, ru, rl]))

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  const scene = new THREE.Scene()
  scene.add(mesh)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.5))
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(1, 2, 3); scene.add(key)
  const rim = new THREE.DirectionalLight(0x7de3f4, 1.2); rim.position.set(-2, 1.5, -2); scene.add(rim)
  const cam = new THREE.PerspectiveCamera(30, canvas.clientWidth / canvas.clientHeight, 0.1, 20)
  cam.position.set(0, 1.0, 4.4); cam.lookAt(0, 0.9, 0)

  const t0 = performance.now()
  let raf = 0
  const frame = (now: number) => {
    const t = (now - t0) / 1000
    const ph = (Math.sin(t * Math.PI * 2 * 2.6) + 1) / 2 // ~2.6 claps a second
    const up = -0.7, lo = -1.1, lz = -0.1 + 0.5 * ph
    lu.rotation.set(up, 0, 0.25); ll.rotation.set(lo, 0, lz)
    ru.rotation.set(up, 0, -0.25); rl.rotation.set(lo, 0, -lz)
    hd.rotation.set(0.05 * ph, 0, 0.08 * Math.sin(t * Math.PI * 2.6))
    mesh.rotation.y = 0.35 * Math.sin(t * 1.4)
    mesh.position.y = 0.04 * ph
    renderer.render(scene, cam)
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)
  return () => { cancelAnimationFrame(raf); renderer.dispose(); g.dispose(); mat.dispose(); tex.dispose() }
}
