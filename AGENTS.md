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

## "Make a <theme> theme"

Follow "Add a theme" in CONTRIBUTING.md. Never let a theme add something a city
lacks: use `requires` and a trait from `src/traits.js`. Check the theme on a
city with the trait and on one without it.

## Rules

- No build step and no npm dependencies in the page. Three.js and MediaPipe
  load from jsDelivr.
- Keep `ITEM_TYPES` and `EFFECT_TYPES` in `tools/check-cities.mjs` in step with
  `BUILDERS` in `src/city.js` and `EFFECTS` in `src/effects.js`.
- The lid bridge (`bridge/LidBridge.swift`) reads an Apple HID device without a
  public API. Test changes to it on a real MacBook.
