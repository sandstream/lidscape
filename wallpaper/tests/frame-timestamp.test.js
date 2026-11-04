import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

test('wallpaper capture receives the timestamp of the last frame, including a stale frame', async () => {
  const source = await readFile(new URL('../Shared/Render/MetalSceneRenderer.swift', import.meta.url), 'utf8')
  const match = source.match(/let js = "([^"\n]+)"/)
  assert.ok(match, 'the renderer must provide its capture script')
  const script = match[1].replace('\\(update)', '').replace('\\(pointerScript())', '')
  const now = Date.now()
  const oldTimestamp = now - 10000
  const result = runInNewContext(script, { window: { lidscapeSaverLastRender: oldTimestamp } })
  assert.equal(result, oldTimestamp, 'the host must receive the actual timestamp, not just a boolean')
  assert.ok(now - result > 2000, 'the host can detect that the frame is stale')
})
