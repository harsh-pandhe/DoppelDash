'use client'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'

/**
 * Night-time cable car scene — sign-in background.
 * A ring of 8 towers carries cable cars on a continuous loop across a snowy
 * ridge under a glowing moon. Fully procedural (no external assets).
 *
 * Adapted from the "Night Cable Car" reference. Per design: FIXED camera angle
 * (no auto-rotate, no drag), pointer-events-none so it never steals form clicks.
 */
export default function CableCarScene() {
  const mountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    let width = mount.clientWidth || window.innerWidth
    let height = mount.clientHeight || window.innerHeight

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.fog = new THREE.Fog(0x0a1424, 350, 2400)

    const camera = new THREE.PerspectiveCamera(58, width / height, 1, 5000)
    // fixed vantage — close enough that the near towers + gondolas read big,
    // angled down at the ropeway ring. Biased left of the form.
    const CAM_AZ = -0.32
    const RADIUS = 430
    camera.position.set(Math.sin(CAM_AZ) * RADIUS, 160, Math.cos(CAM_AZ) * RADIUS)
    camera.lookAt(0, 60, -40)

    // --- lights ---
    scene.add(new THREE.AmbientLight(0x223355, 1.2))
    scene.add(new THREE.HemisphereLight(0x6688cc, 0x0a0820, 0.6))
    const moonDir = new THREE.DirectionalLight(0xb9c8ff, 0.8)
    moonDir.position.set(-300, 400, -200)
    moonDir.castShadow = true
    moonDir.shadow.mapSize.set(2048, 2048)
    moonDir.shadow.camera.left = -600
    moonDir.shadow.camera.right = 600
    moonDir.shadow.camera.top = 600
    moonDir.shadow.camera.bottom = -600
    moonDir.shadow.camera.far = 1500
    scene.add(moonDir)

    // --- moon + halo ---
    const moonGroup = new THREE.Group()
    moonGroup.add(new THREE.Mesh(new THREE.SphereGeometry(50, 48, 48), new THREE.MeshBasicMaterial({ color: 0xf2e6c4 })))
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(50, 48, 48),
      new THREE.ShaderMaterial({
        vertexShader: `varying vec3 vNormal; void main(){ vNormal = normalize(normalMatrix*normal); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `varying vec3 vNormal; void main(){ float i = pow(0.72 - dot(vNormal, vec3(0.,0.,0.6)), 4.0); gl_FragColor = vec4(0.95,0.85,0.62,1.0) * i; }`,
        side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true,
      }),
    )
    halo.scale.setScalar(1.6)
    moonGroup.add(halo)
    moonGroup.position.set(-400, 420, -700)
    scene.add(moonGroup)

    // --- stars ---
    {
      const count = 1200
      const positions = new Float32Array(count * 3)
      for (let i = 0; i < count; i++) {
        const r = 1200 + Math.random() * 800
        const theta = Math.random() * Math.PI * 2
        const phi = Math.acos(Math.random() * 2 - 1)
        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
        positions[i * 3 + 1] = Math.abs(r * Math.cos(phi)) * 0.6 + 50
        positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta)
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, transparent: true, opacity: 0.85, sizeAttenuation: true })))
    }

    // --- snowy ground ---
    {
      const geom = new THREE.PlaneGeometry(3000, 3000, 80, 80)
      geom.rotateX(-Math.PI / 2)
      const pos = geom.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i); const z = pos.getZ(i)
        const d = Math.sqrt(x * x + z * z)
        const noise = Math.sin(x * 0.012) * Math.cos(z * 0.011) * 18 + Math.sin(x * 0.04 + z * 0.03) * 6
        const ringDip = Math.max(0, 1 - Math.abs(d - 250) / 220) * -8
        pos.setY(i, noise + ringDip)
      }
      geom.computeVertexNormals()
      const ground = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: 0x1e2a44, flatShading: true, roughness: 1, metalness: 0 }))
      ground.position.y = -60
      ground.receiveShadow = true
      scene.add(ground)
    }

    // --- layered mountain backdrops ---
    const foregroundLayer = new THREE.Group()
    const midgroundLayer = new THREE.Group()
    const horizonLayer = new THREE.Group()
    scene.add(foregroundLayer, midgroundLayer, horizonLayer)

    const snowMat = new THREE.MeshStandardMaterial({ color: 0xe8eefc, flatShading: true, roughness: 0.9 })
    const fgMat = new THREE.MeshStandardMaterial({ color: 0x1c2742, flatShading: true, roughness: 1 })
    const mgMat = new THREE.MeshStandardMaterial({ color: 0x2a3a5e, flatShading: true, roughness: 1 })
    const horizonMat = new THREE.MeshStandardMaterial({ color: 0x3d5277, flatShading: true, roughness: 1 })
    const mountainMat = mgMat

    function addMountainTo(parent: THREE.Object3D, mat: THREE.Material, x: number, z: number, base: number, peakHeight: number, groundY: number, withSnow: boolean) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(base, peakHeight, 6), mat)
      cone.position.set(x, groundY + peakHeight / 2, z)
      cone.rotation.y = Math.random() * Math.PI
      cone.castShadow = true; cone.receiveShadow = true
      parent.add(cone)
      if (withSnow) {
        const capH = peakHeight * 0.32
        const cap = new THREE.Mesh(new THREE.ConeGeometry(base * 0.42, capH, 6), snowMat)
        cap.position.set(x, groundY + peakHeight - capH / 2 + 1, z)
        cap.rotation.y = cone.rotation.y
        parent.add(cap)
      }
    }
    const addMountain = (x: number, z: number, base: number, peakHeight: number, groundY: number) =>
      addMountainTo(scene, mountainMat, x, z, base, peakHeight, groundY, true)

    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + Math.random() * 0.35
      const r = 520 + Math.random() * 180
      addMountainTo(foregroundLayer, fgMat, Math.cos(a) * r, Math.sin(a) * r, 150 + Math.random() * 90, 260 + Math.random() * 180, -60, true)
    }
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + Math.random() * 0.22
      const r = 950 + Math.random() * 280
      addMountainTo(midgroundLayer, mgMat, Math.cos(a) * r, Math.sin(a) * r, 170 + Math.random() * 120, 320 + Math.random() * 260, -60, true)
    }
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2 + Math.random() * 0.16
      const r = 1700 + Math.random() * 500
      addMountainTo(horizonLayer, horizonMat, Math.cos(a) * r, Math.sin(a) * r, 220 + Math.random() * 160, 380 + Math.random() * 320, -40, false)
    }

    // --- cable car factory ---
    const COLORS = { shellRed: 0xc92b2b, shellDeep: 0x7a1212, cream: 0xe9d6a8, black: 0x14161a, steel: 0x5a6470, lamp: 0xffc070 }
    function makeCableCar() {
      const group = new THREE.Group()
      const skid = new THREE.Mesh(new THREE.BoxGeometry(10.4, 0.8, 7.2), new THREE.MeshStandardMaterial({ color: COLORS.black, roughness: 0.6 }))
      skid.position.y = -3.2; skid.castShadow = true; group.add(skid)
      const shellMat = new THREE.MeshStandardMaterial({ color: COLORS.shellRed, flatShading: true, roughness: 0.55 })
      const lowerShell = new THREE.Mesh(new THREE.BoxGeometry(10, 3.2, 7), shellMat)
      lowerShell.position.y = -1.2; lowerShell.castShadow = true; group.add(lowerShell)
      const upperShell = new THREE.Mesh(new THREE.BoxGeometry(9.4, 3.6, 6.6), shellMat)
      upperShell.position.y = 2.2; upperShell.castShadow = true; group.add(upperShell)
      const belt = new THREE.Mesh(new THREE.BoxGeometry(10.05, 0.5, 7.05), new THREE.MeshStandardMaterial({ color: COLORS.cream, roughness: 0.7 }))
      belt.position.y = 0.6; group.add(belt)
      const roofMat = new THREE.MeshStandardMaterial({ color: COLORS.shellDeep, flatShading: true, roughness: 0.7 })
      const roofA = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.6, 6.4), roofMat)
      roofA.position.y = 4.3; roofA.castShadow = true; group.add(roofA)
      const roofB = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.5, 5.0), roofMat)
      roofB.position.y = 4.75; group.add(roofB)
      const winMat = new THREE.MeshStandardMaterial({ color: COLORS.lamp, emissive: COLORS.lamp, emissiveIntensity: 1.6 })
      const sideWin = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.0, 5.4), winMat)
      sideWin.position.set(5.0, 2.2, 0); group.add(sideWin)
      const sideWin2 = sideWin.clone(); sideWin2.position.x = -5.0; group.add(sideWin2)
      const endWin = new THREE.Mesh(new THREE.BoxGeometry(5.6, 1.6, 0.3), winMat)
      endWin.position.set(0, 2.4, 3.3); group.add(endWin)
      const endWin2 = endWin.clone(); endWin2.position.z = -3.3; group.add(endWin2)
      const frameMat = new THREE.MeshStandardMaterial({ color: COLORS.black })
      for (const sx of [-5.05, 5.05]) for (const dz of [-1.6, 0, 1.6]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.1, 0.18), frameMat)
        bar.position.set(sx, 2.2, dz); group.add(bar)
      }
      const armMat = new THREE.MeshStandardMaterial({ color: COLORS.steel, metalness: 0.55, roughness: 0.45 })
      const makeArm = (dx: number) => {
        const len = 9.5
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, len, 8), armMat)
        arm.position.set(dx * 0.6, 5.0 + len / 2 - 0.5, 0)
        arm.rotation.z = -dx * 0.18; arm.castShadow = true; group.add(arm)
      }
      makeArm(-1); makeArm(1)
      const yoke = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.8, 1.2), armMat)
      yoke.position.y = 13.5; group.add(yoke)
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 5.4, 12), new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.7, roughness: 0.3 }))
      grip.rotation.x = Math.PI / 2; grip.position.y = 14.5; group.add(grip)
      const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 6), frameMat)
      antenna.position.set(0, 5.6, 2.3); group.add(antenna)
      const lampHousing = new THREE.Mesh(new THREE.ConeGeometry(0.6, 0.9, 12), new THREE.MeshStandardMaterial({ color: COLORS.lamp, emissive: COLORS.lamp, emissiveIntensity: 1.2 }))
      lampHousing.rotation.x = Math.PI; lampHousing.position.y = -3.8; group.add(lampHousing)
      const lamp = new THREE.PointLight(COLORS.lamp, 22, 70, 2); lamp.position.y = 1; group.add(lamp)
      return group
    }

    // --- towers (irregular ring) ---
    const TOWER_COUNT = 8
    const RING_RADIUS = 210
    const towerTops: THREE.Vector3[] = []

    function makeTower(heightT: number) {
      const g = new THREE.Group()
      const legMat = new THREE.MeshStandardMaterial({ color: 0x2f3a52, flatShading: true, roughness: 0.85 })
      const baseH = heightT * 0.85
      for (const [sx, sz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, baseH, 6), legMat)
        leg.position.set(sx * 0.35, baseH / 2, sz * 0.35)
        leg.rotation.x = -sz * 0.04; leg.rotation.z = sx * 0.04
        leg.castShadow = true; leg.receiveShadow = true; g.add(leg)
      }
      const post = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, heightT - baseH + 4, 10), new THREE.MeshStandardMaterial({ color: 0x3a4a66, flatShading: true, roughness: 0.8 }))
      post.position.y = baseH + (heightT - baseH) / 2 - 2; post.castShadow = true; g.add(post)
      const braceMat = new THREE.MeshStandardMaterial({ color: 0x222a3a, flatShading: true })
      for (const y of [baseH * 0.3, baseH * 0.65]) {
        const brace = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.35, 0.35), braceMat)
        brace.position.y = y; g.add(brace)
        const brace2 = brace.clone(); brace2.rotation.y = Math.PI / 2; g.add(brace2)
      }
      const arm = new THREE.Mesh(new THREE.BoxGeometry(14, 1.5, 2.2), new THREE.MeshStandardMaterial({ color: 0x2a3346, flatShading: true }))
      arm.position.y = heightT + 1; arm.castShadow = true; g.add(arm)
      const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1a1d24, metalness: 0.65, roughness: 0.35 })
      for (const sx of [-5.5, 5.5]) {
        const w = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.45, 8, 18), wheelMat)
        w.position.set(sx, heightT + 1, 0); w.rotation.y = Math.PI / 2; g.add(w)
      }
      const beacon = new THREE.PointLight(0xff3344, 5, 80, 2); beacon.position.y = heightT + 3; g.add(beacon)
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 12), new THREE.MeshBasicMaterial({ color: 0xff3344 }))
      bulb.position.y = heightT + 3; g.add(bulb)
      return g
    }

    const GROUND_Y = -60
    type TowerSite = { x: number; z: number; peakHeight: number; peakBase: number; towerH: number }
    const sites: TowerSite[] = []
    for (let i = 0; i < TOWER_COUNT; i++) {
      const baseAngle = (i / TOWER_COUNT) * Math.PI * 2
      const a = baseAngle + Math.sin(i * 2.13) * 0.18
      const r = RING_RADIUS + Math.cos(i * 1.7) * 70 + Math.sin(i * 3.1) * 25
      sites.push({
        x: Math.cos(a) * r, z: Math.sin(a) * r,
        peakHeight: 105 + Math.sin(i * 1.7) * 45 + (i % 3 === 0 ? 50 : 0),
        peakBase: 90 + Math.cos(i * 0.9) * 18,
        towerH: 36 + ((i * 11) % 26),
      })
    }
    for (let i = 0; i < sites.length; i++) {
      const s = sites[i]
      const next = sites[(i + 1) % sites.length]
      const prev = sites[(i - 1 + sites.length) % sites.length]
      addMountain(s.x, s.z, s.peakBase, s.peakHeight, GROUND_Y)
      const summitY = GROUND_Y + s.peakHeight
      const tower = makeTower(s.towerH)
      tower.position.set(s.x, summitY - 4, s.z)
      const inDir = new THREE.Vector3(s.x - prev.x, 0, s.z - prev.z).normalize()
      const outDir = new THREE.Vector3(next.x - s.x, 0, next.z - s.z).normalize()
      const tangent = inDir.add(outDir).normalize()
      tower.rotation.y = Math.atan2(tangent.x, tangent.z) + Math.PI / 2
      scene.add(tower)
      towerTops.push(new THREE.Vector3(s.x, summitY - 4 + s.towerH + 1, s.z))
    }

    // --- cables ---
    const CABLE_OFFSET = 5.5
    {
      const cableMat = new THREE.LineBasicMaterial({ color: 0x101218 })
      for (let i = 0; i < towerTops.length; i++) {
        const a = towerTops[i]
        const b = towerTops[(i + 1) % towerTops.length]
        const segDir = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize()
        const perp = new THREE.Vector3(-segDir.z, 0, segDir.x)
        for (const side of [-1, 1]) {
          const ox = perp.x * CABLE_OFFSET * side
          const oz = perp.z * CABLE_OFFSET * side
          const segs = 18
          const pts: THREE.Vector3[] = []
          for (let s = 0; s <= segs; s++) {
            const t = s / segs
            const x = a.x + (b.x - a.x) * t + ox
            const z = a.z + (b.z - a.z) * t + oz
            const y = a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * 7
            pts.push(new THREE.Vector3(x, y, z))
          }
          scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), cableMat))
        }
      }
    }

    // --- cars ---
    const CAR_COUNT = 6
    const cars: { mesh: THREE.Group; offset: number; side: number }[] = []
    for (let i = 0; i < CAR_COUNT; i++) {
      const car = makeCableCar()
      scene.add(car)
      cars.push({ mesh: car, offset: i / CAR_COUNT, side: i % 2 === 0 ? -1 : 1 })
    }

    function positionOnCircuit(t: number, side: number) {
      const total = towerTops.length
      const f = t * total
      const i = Math.floor(f) % total
      const k = f - Math.floor(f)
      const a = towerTops[i]
      const b = towerTops[(i + 1) % total]
      const segDir = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize()
      const perp = new THREE.Vector3(-segDir.z, 0, segDir.x)
      const x = a.x + (b.x - a.x) * k + perp.x * CABLE_OFFSET * side
      const z = a.z + (b.z - a.z) * k + perp.z * CABLE_OFFSET * side
      const y = a.y + (b.y - a.y) * k - Math.sin(k * Math.PI) * 7 - 15.5
      const yaw = Math.atan2(b.x - a.x, b.z - a.z)
      return { pos: new THREE.Vector3(x, y, z), yaw }
    }

    const onResize = () => {
      width = mount.clientWidth || window.innerWidth
      height = mount.clientHeight || window.innerHeight
      renderer.setSize(width, height)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    window.addEventListener('resize', onResize)

    // fixed parallax (camera does not move — set once)
    const camAz = Math.atan2(camera.position.x, camera.position.z)
    foregroundLayer.rotation.y = camAz * 0.15
    midgroundLayer.rotation.y = camAz * 0.55
    horizonLayer.rotation.y = camAz * 0.9

    let raf = 0
    let disposed = false
    const start = performance.now()
    const tick = () => {
      if (disposed) return
      const elapsed = (performance.now() - start) / 1000
      const speed = 0.04
      for (const c of cars) {
        const t = (elapsed * speed + c.offset) % 1
        const { pos, yaw } = positionOnCircuit(t, c.side)
        c.mesh.position.copy(pos)
        c.mesh.rotation.y = yaw
        c.mesh.rotation.z = Math.sin(elapsed * 2 + c.offset * 6) * 0.04
      }
      renderer.render(scene, camera)
      raf = requestAnimationFrame(tick)
    }
    tick()

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      renderer.dispose()
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
      scene.traverse((obj) => {
        const m = obj as THREE.Mesh
        if (m.geometry) m.geometry.dispose?.()
        const mat = m.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
        else mat?.dispose()
      })
    }
  }, [])

  return (
    <div
      ref={mountRef}
      aria-hidden
      className="absolute inset-0 z-0 overflow-hidden pointer-events-none"
      style={{ background: 'linear-gradient(180deg, #050a18 0%, #0a1424 60%, #111a30 100%)' }}
    />
  )
}
