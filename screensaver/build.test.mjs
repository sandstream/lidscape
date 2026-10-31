import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

test('the screen saver builds each executable for its declared macOS minimum', {
  skip: process.platform !== 'darwin' && 'The screen saver is built on macOS',
  timeout: 120000,
}, async t => {
  const sdk = execFileSync('xcrun', ['--sdk', 'macosx', '--show-sdk-version'], { encoding: 'utf8' }).trim()
  if (Number(sdk.split('.')[0]) < 27) {
    t.skip('Building the screen saver requires the macOS 27 SDK')
    return
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const fixture = await mkdtemp(join(tmpdir(), 'lidscape-saver-target-'))
  try {
    for (const dir of ['screensaver', 'bridge', 'app/src-tauri', 'assets/fonts', 'node_modules/three/build', 'src', 'bin']) {
      await mkdir(join(fixture, dir), { recursive: true })
    }
    for (const file of [
      'screensaver/build.sh', 'screensaver/Info.plist', 'screensaver/SensorInfo.plist',
      'screensaver/LidscapeSaver.swift', 'screensaver/index.html', 'bridge/LidBridge.swift',
      'app/src-tauri/tauri.conf.json',
    ]) {
      await copyFile(join(root, file), join(fixture, file))
    }
    for (const file of ['assets/fonts/instrument-serif-italic.woff2', 'assets/fonts/OFL.txt', 'node_modules/three/build/three.module.js', 'src/saver-main.js']) {
      await writeFile(join(fixture, file), '')
    }
    // The target differs from this Mac to catch a compiler default based on the host OS.
    for (const file of ['screensaver/Info.plist', 'screensaver/SensorInfo.plist']) {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :LSMinimumSystemVersion 26.0', join(fixture, file)])
    }
    // The native compiler is real. Frontend generation and signing do not affect its target.
    for (const name of ['bun', 'node', 'codesign']) {
      const stub = join(fixture, 'bin', name)
      await writeFile(stub, '#!/bin/sh\nexit 0\n')
      await chmod(stub, 0o755)
    }
    const result = spawnSync('sh', ['screensaver/build.sh'], {
      cwd: fixture, encoding: 'utf8', timeout: 90000,
      env: { ...process.env, PATH: `${join(fixture, 'bin')}:${process.env.PATH}`, APPLE_SIGNING_IDENTITY: '-' },
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    const saver = join(fixture, 'app/src-tauri/target/screensaver/LidscapeScreenSaver.saver/Contents')
    for (const binary of [join(saver, 'MacOS/LidscapeSaver'), join(saver, 'Resources/Lidscape Sensor.app/Contents/MacOS/lid-bridge')]) {
      const info = execFileSync('xcrun', ['vtool', '-show-build', binary], { encoding: 'utf8' })
      assert.match(info, /\bminos\s+26\.0(?:\.0)?(?:\s|$)/)
    }
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})
