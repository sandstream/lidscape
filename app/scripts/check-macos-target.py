#!/usr/bin/env python3
"""Check that an executable has the same macOS minimum as its bundle."""

import plistlib
import re
import subprocess
import sys


def version_parts(version):
    if not isinstance(version, str) or not re.fullmatch(r"\d+(?:\.\d+)*", version):
        raise ValueError("Invalid macOS minimum version")
    parts = [int(part) for part in version.split(".")]
    while len(parts) > 1 and parts[-1] == 0:
        parts.pop()
    return parts


def main(plist_path, executable_path):
    with open(plist_path, "rb") as source:
        app_minimum = plistlib.load(source).get("LSMinimumSystemVersion")
    expected = version_parts(app_minimum)
    result = subprocess.run(
        ["xcrun", "vtool", "-show-build", executable_path],
        check=True,
        text=True,
        capture_output=True,
    )
    minimums = re.findall(r"^\s*minos\s+(\S+)", result.stdout, re.MULTILINE)
    platforms = re.findall(r"^\s*platform\s+(\S+)", result.stdout, re.MULTILINE)
    if (
        not minimums
        or len(platforms) != len(minimums)
        or any(platform.upper() != "MACOS" for platform in platforms)
        or any(version_parts(version) != expected for version in minimums)
    ):
        raise ValueError("The executable minimum macOS version does not match the bundle")
    architectures = subprocess.run(
        ["xcrun", "lipo", executable_path, "-archs"],
        text=True,
        capture_output=True,
    )
    if architectures.returncode != 0:
        detail = architectures.stderr.strip() or architectures.stdout.strip() or "no diagnostic"
        raise ValueError(f"Could not list executable architectures: {detail}")
    available = architectures.stdout.strip() or "none"
    verification = subprocess.run(
        ["xcrun", "lipo", executable_path, "-verify_arch", "arm64"],
        text=True,
        capture_output=True,
    )
    if verification.returncode != 0 or "arm64" not in architectures.stdout.split():
        detail = verification.stderr.strip() or verification.stdout.strip() or "no diagnostic"
        raise ValueError(f"Could not verify arm64; architectures: {available}; {detail}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: check-macos-target.py Info.plist executable")
    try:
        main(sys.argv[1], sys.argv[2])
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        raise SystemExit(f"FAIL: {error}")
