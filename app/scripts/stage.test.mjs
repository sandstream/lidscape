import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

test('the staged lid bridge supports the minimum macOS version of the app', {
  skip: process.platform !== 'darwin' && 'The lid bridge is built on macOS',
}, async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  const fixture = await mkdtemp(join(tmpdir(), 'lidscape-stage-target-'))
  try {
    for (const dir of ['app/scripts', 'app/src-tauri', 'bridge', 'screensaver', 'src', 'assets']) {
      await mkdir(join(fixture, dir), { recursive: true })
    }
    for (const file of ['app/scripts/stage.sh', 'app/src-tauri/tauri.conf.json', 'bridge/LidBridge.swift']) {
      await copyFile(join(root, file), join(fixture, file))
    }
    await writeFile(join(fixture, 'index.html'), '')
    // Stop staging after it has compiled the bridge, without building or signing other bundles.
    await writeFile(join(fixture, 'screensaver/build.sh'), 'exit 85\n')
    const result = spawnSync('sh', ['scripts/stage.sh'], {
      cwd: join(fixture, 'app'), encoding: 'utf8', timeout: 30000,
    })
    assert.equal(result.status, 85, result.stderr || result.stdout)
    const binary = join(fixture, 'app/src-tauri/binaries/lid-bridge-aarch64-apple-darwin')
    const info = execFileSync('xcrun', ['vtool', '-show-build', binary], { encoding: 'utf8' })
    const minimum = JSON.parse(await readFile(join(fixture, 'app/src-tauri/tauri.conf.json'), 'utf8')).bundle.macOS.minimumSystemVersion
    const actual = info.match(/\bminos\s+(\S+)/)?.[1]
    assert.ok(actual, 'The bridge has no minimum macOS version')
    const parts = version => {
      const result = version.split('.').map(Number)
      while (result.length > 1 && result.at(-1) === 0) result.pop()
      return result
    }
    assert.deepEqual(parts(actual), parts(minimum))
    const plist = join(fixture, 'Info.plist')
    await writeFile(plist, `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>LSMinimumSystemVersion</key><string>${minimum}</string></dict></plist>`)
    const check = join(root, 'app/scripts/check-macos-target.py')
    execFileSync('python3', [check, plist, binary])
    await writeFile(plist, '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>LSMinimumSystemVersion</key><string>99.0</string></dict></plist>')
    assert.notEqual(spawnSync('python3', [check, plist, binary]).status, 0)
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})
