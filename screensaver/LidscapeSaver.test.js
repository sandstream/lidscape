import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

test('old map settings retain the selected city, theme and variant', {
  skip: process.platform !== 'darwin' && 'The screen saver requires macOS',
  timeout: 60000,
}, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lidscape-saver-settings-test-'))
  try {
    const source = await readFile(fileURLToPath(new URL('./LidscapeSaver.swift', import.meta.url)), 'utf8')
    const testSource = `${source}
private let oldData = Data(#"{"city":"stockholm","theme":"miniature","variant":"christmas","view":"map"}"#.utf8)
private let settings = try JSONDecoder().decode(SaverSettings.self, from: oldData)
precondition(settings.city == "stockholm")
precondition(settings.theme == "miniature")
precondition(settings.variant == "christmas")
private let encoded = try JSONEncoder().encode(settings)
private let fields = try JSONSerialization.jsonObject(with: encoded) as! [String: Any]
precondition(fields["view"] == nil)
precondition(fields["city"] as? String == "stockholm")
precondition(fields["theme"] as? String == "miniature")
precondition(fields["variant"] as? String == "christmas")
`
    const file = join(dir, 'compatibility.swift')
    const executable = join(dir, 'compatibility')
    await writeFile(file, testSource)
    execFileSync('xcrun', ['swiftc', '-framework', 'AppKit', '-framework', 'ScreenSaver',
      '-framework', 'WebKit', file, '-o', executable], { stdio: 'pipe' })
    execFileSync(executable, [], { stdio: 'pipe' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
