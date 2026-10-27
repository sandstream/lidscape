export const MAP_WIDTH = 58
export const MAP_HEIGHT = 29
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// The paper texture and the markers must use the same projection.
export function mapUV(lat, lon) {
  return { u: (lon + 180) / 360, v: (lat + 90) / 180 }
}

export function mapPoint(lat, lon) {
  const { u, v } = mapUV(lat, lon)
  return {
    x: (u - 0.5) * MAP_WIDTH,
    y: (v - 0.5) * MAP_HEIGHT,
  }
}

// Keep close cities separate while their fine lines still show the true place.
export function layoutCities(cities) {
  const placed = cities.map((city) => ({ city, truePoint: mapPoint(city.lat, city.lon), point: mapPoint(city.lat, city.lon) }))
  for (let step = 0; step < 32; step++) {
    for (let i = 0; i < placed.length; i++) {
      const a = placed[i]
      for (let j = i + 1; j < placed.length; j++) {
        const b = placed[j]
        let dx = b.point.x - a.point.x
        let dy = b.point.y - a.point.y
        let d = Math.hypot(dx, dy)
        if (d >= 2.35) continue
        if (d < 0.001) {
          dx = 1
          dy = 0
          d = 1
        }
        const push = (2.35 - d) * 0.55
        a.point.x -= (dx / d) * push
        a.point.y -= (dy / d) * push
        b.point.x += (dx / d) * push
        b.point.y += (dy / d) * push
      }
    }
    for (const item of placed) {
      item.point.x = clamp(item.point.x + (item.truePoint.x - item.point.x) * 0.055, -MAP_WIDTH / 2 + 1.4, MAP_WIDTH / 2 - 1.4)
      item.point.y = clamp(item.point.y + (item.truePoint.y - item.point.y) * 0.055, -MAP_HEIGHT / 2 + 1.2, MAP_HEIGHT / 2 - 1.2)
    }
  }
  return placed
}

// Give dense groups of capitals separate targets. Keep each target on its
// original page so it follows the correct hinge when the book closes.
export function layoutCapitals(capitals, placedCities = []) {
  const placed = capitals.map((capital) => {
    const truePoint = mapPoint(capital[3], capital[4])
    return { capital, truePoint, point: { ...truePoint } }
  })
  for (let step = 0; step < 110; step++) {
    for (let i = 0; i < placed.length; i++) {
      const a = placed[i]
      for (let j = i + 1; j < placed.length; j++) {
        const b = placed[j]
        let dx = b.point.x - a.point.x
        let dy = b.point.y - a.point.y
        let distance = Math.hypot(dx, dy)
        if (distance >= 0.7) continue
        if (distance < 0.001) {
          dx = i % 2 ? 1 : -1
          dy = 0.5
          distance = Math.hypot(dx, dy)
        }
        const push = (0.7 - distance) * 0.52
        a.point.x -= dx / distance * push
        a.point.y -= dy / distance * push
        b.point.x += dx / distance * push
        b.point.y += dy / distance * push
      }
      for (const city of placedCities) {
        const dx = a.point.x - city.point.x
        const dy = a.point.y - city.point.y
        const distance = Math.hypot(dx, dy) || 0.001
        if (distance < 1.3) {
          const push = (1.3 - distance) * 0.6
          a.point.x += dx / distance * push
          a.point.y += dy / distance * push
        }
      }
    }
    for (const item of placed) {
      const xLimit = MAP_WIDTH / 2 - 0.6
      const samePageMin = item.truePoint.x < 0 ? -xLimit : 0.3
      const samePageMax = item.truePoint.x < 0 ? -0.3 : xLimit
      item.point.x = clamp(item.point.x + (item.truePoint.x - item.point.x) * 0.008, samePageMin, samePageMax)
      item.point.y = clamp(item.point.y + (item.truePoint.y - item.point.y) * 0.008, -MAP_HEIGHT / 2 + 0.5, MAP_HEIGHT / 2 - 0.5)
    }
  }
  return placed
}
