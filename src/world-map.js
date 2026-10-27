import * as THREE from 'three'
import { CAPITALS, LAND } from './map-data.js'
import { mapUV, layoutCities, layoutCapitals, MAP_WIDTH as WIDTH, MAP_HEIGHT as HEIGHT } from './map-layout.js'

function mapTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 2048
  canvas.height = 1024
  const ctx = canvas.getContext('2d')
  const w = canvas.width
  const h = canvas.height
  const x = (lon) => mapUV(0, lon).u * w
  const y = (lat) => (1 - mapUV(lat, 0).v) * h

  ctx.fillStyle = '#101f2d'
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = 'rgba(141, 179, 188, 0.10)'
  ctx.lineWidth = 1
  for (let lon = -150; lon <= 150; lon += 30) {
    ctx.beginPath()
    ctx.moveTo(x(lon), 0)
    ctx.lineTo(x(lon), h)
    ctx.stroke()
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    ctx.beginPath()
    ctx.moveTo(0, y(lat))
    ctx.lineTo(w, y(lat))
    ctx.stroke()
  }

  ctx.fillStyle = '#263e4b'
  ctx.strokeStyle = '#64858b'
  ctx.lineWidth = 1.35
  for (const ring of LAND) {
    ctx.beginPath()
    ring.forEach(([lon, lat], i) => {
      if (i === 0) ctx.moveTo(x(lon), y(lat))
      else ctx.lineTo(x(lon), y(lat))
    })
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }

  // A faint paper grain softens the flat areas without a per-frame shader.
  let seed = 9182
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
  for (let i = 0; i < 8500; i++) {
    ctx.fillStyle = random() > 0.5 ? 'rgba(255, 243, 208, 0.035)' : 'rgba(0, 0, 0, 0.045)'
    ctx.fillRect(random() * w, random() * h, 1.5, 1.5)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

function miniature(city) {
  const group = new THREE.Group()
  const pivot = new THREE.Group()
  group.add(pivot)

  const shape = new THREE.Shape()
  shape.moveTo(-0.84, 0)
  shape.lineTo(0.84, 0)
  shape.lineTo(0.84, 0.48)
  shape.lineTo(0.60, 0.48)
  shape.lineTo(0.60, 0.92)
  shape.lineTo(0.51, 1.13)
  shape.lineTo(0.42, 0.92)
  shape.lineTo(0.42, 0.58)
  shape.lineTo(0.15, 0.58)
  shape.lineTo(0.15, 0.80)
  shape.lineTo(-0.03, 1.00)
  shape.lineTo(-0.20, 0.80)
  shape.lineTo(-0.20, 0.53)
  shape.lineTo(-0.44, 0.53)
  shape.lineTo(-0.44, 1.15)
  shape.lineTo(-0.52, 1.39)
  shape.lineTo(-0.60, 1.15)
  shape.lineTo(-0.60, 0.42)
  shape.lineTo(-0.84, 0.42)
  shape.closePath()
  const paper = new THREE.MeshStandardMaterial({
    color: city.palette?.[0] ?? '#e8d3aa',
    emissive: '#b8733c',
    emissiveIntensity: 0.25,
    roughness: 1,
    side: THREE.DoubleSide,
  })
  const card = new THREE.Mesh(new THREE.ShapeGeometry(shape), paper)
  card.castShadow = false
  pivot.add(card)

  const windows = new THREE.MeshBasicMaterial({ color: '#ffcd82', side: THREE.DoubleSide })
  for (const [x, y] of [[-0.71, 0.17], [-0.30, 0.20], [0.00, 0.18], [0.29, 0.20], [0.70, 0.19], [-0.51, 0.76], [0.51, 0.71]]) {
    const window = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.11), windows)
    window.position.set(x, y, 0.012)
    pivot.add(window)
  }
  const hit = new THREE.Mesh(
    new THREE.PlaneGeometry(1.9, 1.55),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
  )
  hit.position.y = 0.7
  pivot.add(hit)
  hit.userData.cityId = city.id
  return { group, pivot, paper, windows, hit }
}

export function buildWorldMap(scene, cities) {
  const root = new THREE.Group()
  root.position.set(0, 0, -60)
  root.rotation.x = -Math.PI * (40 / 180)
  root.visible = false
  scene.add(root)

  const texture = mapTexture()
  const pageMaterial = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide })
  const backingMaterial = new THREE.MeshBasicMaterial({ color: '#08131e' })
  const leftPage = new THREE.Group()
  const rightPage = new THREE.Group()
  root.add(leftPage, rightPage)
  for (const [side, group] of [[-1, leftPage], [1, rightPage]]) {
    const backing = new THREE.Mesh(new THREE.BoxGeometry(WIDTH / 2 + 0.24, HEIGHT + 0.48, 0.32), backingMaterial)
    backing.position.set(side * (WIDTH / 4 + 0.12), 0, -0.2)
    group.add(backing)
    const geometry = new THREE.PlaneGeometry(WIDTH / 2, HEIGHT)
    const uv = geometry.attributes.uv
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 0.5 + (side > 0 ? 0.5 : 0))
    const page = new THREE.Mesh(geometry, pageMaterial)
    page.position.set(side * WIDTH / 4, 0, 0.005)
    group.add(page)
  }
  // The spine stays behind both pages. No transparent planes share its depth.
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.12, HEIGHT + 0.45, 0.28), backingMaterial)
  spine.position.z = -0.35
  root.add(spine)
  const pageFor = (x) => x < 0 ? leftPage : rightPage

  const placed = layoutCities(cities)
  const cityMarkers = new Map()
  const cityHits = []
  const lineMaterial = new THREE.LineBasicMaterial({ color: '#deb985', transparent: true, opacity: 0.7 })
  for (const item of placed) {
    const { city, point, truePoint } = item
    if (Math.hypot(point.x - truePoint.x, point.y - truePoint.y) > 0.12) {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(truePoint.x, truePoint.y, 0.09),
          new THREE.Vector3(point.x, point.y, 0.09),
        ]),
        lineMaterial
      )
      pageFor(point.x).add(line)
    }
    const trueDot = new THREE.Mesh(new THREE.CircleGeometry(0.09, 12), new THREE.MeshBasicMaterial({ color: '#deb985' }))
    trueDot.position.set(truePoint.x, truePoint.y, 0.11)
    pageFor(point.x).add(trueDot)
    const mini = miniature(city)
    mini.group.position.set(point.x, point.y, 0.09)
    pageFor(point.x).add(mini.group)
    cityMarkers.set(city.id, { ...mini, point })
    cityHits.push(mini.hit)
  }

  const remaining = CAPITALS.filter(([, , , lat, lon]) =>
    !cities.some((city) => Math.abs(city.lat - lat) < 0.18 && Math.abs(city.lon - lon) < 0.18)
  )
  const capitalTargets = layoutCapitals(remaining, placed)
  const dotHitMeshes = []
  const dotGeometry = new THREE.CircleGeometry(0.115, 10)
  const dotMat = new THREE.MeshBasicMaterial({ color: '#091722', side: THREE.DoubleSide })
  const ringGeometry = new THREE.RingGeometry(0.12, 0.17, 10)
  const ringMaterial = new THREE.MeshBasicMaterial({ color: '#657b7d', side: THREE.DoubleSide })
  const hitGeometry = new THREE.CircleGeometry(0.32, 10)
  const hitMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
  const matrix = new THREE.Matrix4()
  for (const [group, targets] of [
    [leftPage, capitalTargets.filter(({ point }) => point.x < 0)],
    [rightPage, capitalTargets.filter(({ point }) => point.x >= 0)],
  ]) {
    const dots = new THREE.InstancedMesh(dotGeometry, dotMat, targets.length)
    const rings = new THREE.InstancedMesh(ringGeometry, ringMaterial, targets.length)
    const hits = new THREE.InstancedMesh(hitGeometry, hitMaterial, targets.length)
    targets.forEach(({ point }, i) => {
      matrix.makeTranslation(point.x, point.y, 0.08)
      dots.setMatrixAt(i, matrix)
      matrix.makeTranslation(point.x, point.y, 0.075)
      rings.setMatrixAt(i, matrix)
      matrix.makeTranslation(point.x, point.y, 0.11)
      hits.setMatrixAt(i, matrix)
    })
    dots.instanceMatrix.needsUpdate = true
    rings.instanceMatrix.needsUpdate = true
    hits.instanceMatrix.needsUpdate = true
    hits.userData.targets = targets
    group.add(rings, dots, hits)
    dotHitMeshes.push(hits)
  }

  function update(progress, lights) {
    const foldAngle = (1 - progress) * 1.47
    leftPage.rotation.y = foldAngle
    rightPage.rotation.y = -foldAngle
    for (const marker of cityMarkers.values()) {
      marker.pivot.rotation.x = progress * 1.02
      marker.paper.emissiveIntensity = 0.05 + lights * 0.3
      marker.windows.color.set(lights > 0.35 ? '#ffcd82' : '#695d5e')
    }
  }

  function pick(raycaster) {
    const cityHit = raycaster.intersectObjects(cityHits, false)[0]
    const dotHits = raycaster.intersectObjects(dotHitMeshes, false).map((hit) => {
      const target = hit.object.userData.targets[hit.instanceId]
      const local = hit.object.parent.worldToLocal(hit.point.clone())
      return { hit, target, centerDistance: Math.hypot(local.x - target.point.x, local.y - target.point.y) }
    }).sort((a, b) => a.centerDistance - b.centerDistance)
    const dotHit = dotHits[0]
    if (cityHit && (!dotHit || dotHit.centerDistance > 0.2)) {
      const id = cityHit.object.userData.cityId
      return { type: 'city', city: cities.find((c) => c.id === id) }
    }
    if (dotHit) {
      const [code, name, country] = dotHit.target.capital
      const nearby = dotHits.map(({ target }) => ({ code: target.capital[0], name: target.capital[1], country: target.capital[2] }))
      return { type: 'capital', code, name, country, nearby }
    }
    return null
  }

  return { root, leftPage, rightPage, update, pick, cityMarkers, capitalCount: remaining.length }
}
