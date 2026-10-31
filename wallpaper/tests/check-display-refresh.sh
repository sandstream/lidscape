#!/bin/sh
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/lidscape-display-refresh.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
python3 - "$ROOT" "$WORK" <<'PY'
from pathlib import Path
import sys

root, work = map(Path, sys.argv[1:])
store = (root / 'wallpaper/DriftwoodWallpaperExtension/WallpaperAssignmentStore.swift').read_text()
choice = (root / 'wallpaper/ProbeHost/ProbeChoiceMapping.swift').read_text()

def method(source, marker):
    start = source.index(marker)
    opening = source.index('{', start)
    depth = 0
    for index in range(opening, len(source)):
        if source[index] == '{':
            depth += 1
        elif source[index] == '}':
            depth -= 1
            if depth == 0:
                return source[start:index + 1]
    raise ValueError(f'Could not extract {marker}')

refresh_start = store.index('    func refreshConnectedDisplayChoices() async {')
refresh_end = store.index('    /// Limit the Settings list', refresh_start)
reply_start = choice.index('final class SettingsRefreshReply:')
reply_end = choice.index('\nenum ProbeChoiceMapping', reply_start)
parts = [
    'import Foundation\n',
    choice[reply_start:reply_end],
    '\nenum ProbeChoiceMapping {\n',
    method(choice, '    static func activeDisplays('),
    method(choice, '    static func visibleDisplays('),
    '\n}\nfinal class Store: @unchecked Sendable {\n',
    '''
    let settingsRefresh = SettingsRefreshCoordinator()
    let documentsURL: URL
    let lock = StateLock()
    var current: Set<String>?
    var ready: Set<String>
    var pauseReload = false
    init(_ root: URL, current: Set<String>?, ready: Set<String>) {
        documentsURL = root
        self.current = current
        self.ready = ready
    }
    func activeDisplayUUIDs() -> Set<String>? { current }
    func resolvedAssignment(displayUUID: String) -> Assignment? {
        ready.contains(displayUUID) ? Assignment(posterURL: documentsURL.appendingPathComponent("poster.png")) : nil
    }
    private func reload(applyToHostedSurfaces: Bool) {
        if pauseReload {
            reloadEntered.signal()
            reloadRelease.wait()
        }
        lock.withLock { $0.manifest = WallpaperAssignmentManifest(revision: 2) }
        reloadFinished.signal()
    }
    ''',
    method(store, '    func settingsSlots() -> [DisplayWallpaperSlot] {'),
    store[refresh_start:refresh_end],
    method(store, '    func visibleSettingsSlots() -> [DisplayWallpaperSlot] {'),
    '\n}\n',
]
(work / 'ActualDisplayRefresh.swift').write_text('\n'.join(parts))
PY
xcrun swiftc -swift-version 6 -strict-concurrency=complete -warnings-as-errors -parse-as-library \
  "$WORK/ActualDisplayRefresh.swift" "$ROOT/wallpaper/tests/WallpaperDisplayRefreshCheck.swift" -o "$WORK/check"
"$WORK/check"
