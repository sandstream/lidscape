# Agent guide

This file tells an AI coding agent (Claude Code, Codex) how to work in Lidscape.
`CLAUDE.md` points here.

## "Build <city>"

When someone asks for a city ("Bygg Göteborg", "Make Paris"), follow
CONTRIBUTING.md step by step:

1. Research first. Write `docs/cities/<id>.md`: one real viewpoint, 4 to 7
   landmarks, and a source URL for every height and year. Do not state a
   number you have not found in a source.
2. Draw `src/cities/<id>.js` with `outline` landmarks, following
   `src/cities/stockholm.js`. List the city in `src/cities/index.js`.
3. Run `node tools/check-cities.mjs` until it prints OK.
4. Serve the page (`python3 tools/serve.py`) and look at
   `http://localhost:5173/?city=<id>&progress=1` in a browser. Every landmark
   must stand free against the sky. Fix and look again.
5. Save a screenshot as `docs/<id>.png` and offer to open a pull request.

## "Make a <style> theme" or "Make a <occasion> variant"

A theme is an artistic form for the whole picture (Papper, Miniatyr). A variant
is an occasion over any theme (Jul). Follow "Add a theme" or "Add a variant" in
CONTRIBUTING.md. Never let a variant add something a city lacks: use
`requires` and a trait from `src/traits.js`. Check a variant on a city with the
trait and on one without it, and check a theme's frame time.

## "Translate Lidscape to <language>"

Follow "Add a language" in CONTRIBUTING.md. The app must declare the language
in `Info.plist`, or a Mac in that language still opens it in English.

## Rules

- No build step and no npm dependencies in the page. Three.js and MediaPipe
  load from jsDelivr.
- Keep `ITEM_TYPES` and `EFFECT_TYPES` in `tools/check-cities.mjs` in step with
  `BUILDERS` in `src/city.js` and `EFFECTS` in `src/effects.js`.
- The lid bridge (`bridge/LidBridge.swift`) reads an Apple HID device without a
  public API. Test changes to it on a real MacBook.

<!-- BEGIN kit (managed block — edit outside the markers, not inside) -->

## kit

This repo is managed by [kit](https://github.com/sandstream/kit) (env, secrets, security gates). Hooks enforce the hard rules; what you need to know:

- If `kit` is missing (fresh clone/machine): `npm i -g sandstream-kit`, then continue below.
- Start: `kit check` — on `fail`, run `kit fix`, then re-check.
- Prior decisions: `kit memory search "<query>"` (cross-session, cross-agent).
- Secrets: `kit secrets` (vault-backed); placeholders go in `.env.example`, never plaintext in `.env*`.
- Deploy env: `[deploy]` declares required platform key names; `kit check --category deploy` diffs remote names without reading values.
- Deps the install gate hasn't covered (git repos, URLs, vendored code): `kit triage repo <target>` first.
- After a batch of edits: `kit check --category security`; halt and surface findings on `fail`.
- Everything else: `kit --help` — the commands are self-documenting.

<!-- END kit -->
