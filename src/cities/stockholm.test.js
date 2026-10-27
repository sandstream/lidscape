import test from 'node:test'
import assert from 'node:assert/strict'
import { stockholm } from './stockholm.js'

test('Stockholm supplies separate, sourced landmark cards', () => {
  const labelled = stockholm.layers.flatMap((layer) => layer.items).filter((item) => item.label)
  assert.ok(labelled.length >= 4)
  assert.ok(labelled.some((item) => item.label.name.sv?.includes('Tyska kyrkan')))
  assert.ok(labelled.some((item) => item.label.name.sv?.includes('Stadshuset')))
  assert.ok(stockholm.layers.every((layer, index, all) => index === 0 || layer.z > all[index - 1].z))
  assert.ok(stockholm.lat > 59 && stockholm.lat < 60)
  assert.ok(stockholm.lon > 18 && stockholm.lon < 19)
})
