#!/bin/sh
# macOS 27 sometimes rejects a proc-macro library from a parallel Rust build
# ("mis-aligned LINKEDIT string pool"), and the next crate fails with "can't find
# crate". Seen 25 October 2026 with ld-27037.1. This removes every library that
# does not load, so the next build makes it again.
cd "$(dirname "$0")/../src-tauri"
for f in target/*/deps/*.dylib; do
  [ -f "$f" ] || continue
  if python3 -c "import ctypes,sys; ctypes.CDLL(sys.argv[1])" "$f" 2>&1 | grep -q "LINKEDIT"; then
    echo "removed broken $f"
    rm -f "$f"
  fi
done
exit 0
