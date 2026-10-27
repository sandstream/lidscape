export function installCanvas() {
  const original = globalThis.document
  const noop = () => {}
  const gradient = () => ({ addColorStop: noop })
  const context = {
    fillRect: noop, beginPath: noop, moveTo: noop, lineTo: noop,
    closePath: noop, fill: noop, stroke: noop, arc: noop, ellipse: noop,
    save: noop, restore: noop, clip: noop, putImageData: noop,
    createLinearGradient: gradient, createRadialGradient: gradient,
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  }
  globalThis.document = { createElement: (tag) => {
    if (tag !== 'canvas') throw new Error(`Unexpected element: ${tag}`)
    return { width: 0, height: 0, getContext: (kind) => kind === '2d' ? context : null }
  } }
  return () => { globalThis.document = original }
}
