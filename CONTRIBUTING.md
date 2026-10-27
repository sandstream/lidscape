# Add a city, a theme, a variant or a language

By opening a pull request you agree that your contribution is licensed as the
rest of the repository: code under MIT (`LICENSE`), cities, themes, variants and research
under CC BY 4.0 (`LICENSE-CONTENT`). Use only photos and sources you may use;
link them in the research file instead of copying them in.

Lidscape grows one city at a time, and every city comes in as a pull request.
Themes (the artistic form, such as Miniatyr) and variants (an occasion, such
as Jul) come in the same way, and so do languages.
A good city is one that a local recognizes in two seconds, from the shape of
its skyline alone.

## 1. Research the skyline

Write `docs/cities/<id>.md` before you draw. Use `docs/cities/stockholm.md` as
the model. The file names:

- one real viewpoint where the landmarks line up, preferably across water,
- 4 to 7 landmarks, each with height, year and a silhouette described from
  bottom to top,
- the ordinary buildings that fill the rows between them,
- the city's traits (see below),
- a source for every height and year.
- latitude and longitude for the city, with a source for both coordinates.

The id is lower case ASCII with hyphens: `goteborg`, `new-york`.

## 2. Draw the city

Copy `src/cities/stockholm.js` to `src/cities/<id>.js` and list it in
`src/cities/index.js`.

A city is a set of paper cards. Each layer is one card, `z` centimetres behind
the screen, ordered from back to front. The screen is about 30 cm wide, and a
card at `z = -40` shows roughly `x = -26` to `x = 26`.

| Item | Use it for |
|---|---|
| `house` | Ordinary buildings. Roofs: `flat`, `gable`, `step`, `hip` |
| `tower` | Simple towers. Tops: `spire`, `dome`, `cupola`, `crowns` |
| `outline` | Landmarks. Your own polygon, with holes and windows |
| `hill` | Ridges and far shores |
| `arcade` | A quay or bridge with arches |
| `lamp` | Street lamps |

Draw each landmark as an `outline`. The helpers in `stockholm.js` show the
method: describe the right half from bottom to top, and `mirrored()` builds the
full shape. Use `holes` for openwork, such as Riddarholmskyrkan's iron spire.

Set `traits` to state what is true of the real city. Every trait in
`src/traits.js` must be `true` or `false`, with a source in the research file:

```js
traits: { snow: true, adventStars: true },   // Stockholm
traits: { snow: false, adventStars: false }, // Nairobi
```

Set `lat` and `lon` on the city definition. The world map places the city
automatically. Add a `Coordinates:` line with the source URL to its research file.

Variants read the traits, so Christmas in Nairobi gets string lights but no snow.

Give each landmark a hover label with its name and one line of facts, taken
from the research file. The page is in Swedish and English, so give text that
differs as `{ sv, en }`, and a plain string when it is the same in both:
`{ name: { sv: 'Stadshuset', en: 'City Hall' }, note: { sv: '1923 · tornet 106 m', en: '1923 · tower 106 m' } }`.
The `labelled()` helper in `stockholm.js` puts it on every piece of a landmark.
The same rule applies to the names and setting labels of themes and variants.

Three rules keep a skyline readable:

1. Every landmark must stand free against the sky. Put it on a card behind the
   house rows, and make it tall enough to clear them.
2. Do not place two landmarks so that one sits straight above the other.
3. Exaggerate the one feature a local knows, and leave out the rest.

## 3. Check and send

Add `src/cities/<id>.test.js`. Test the city's landmarks and layer order.

```bash
bun install --frozen-lockfile
npx playwright install chromium
npm test
python3 tools/serve.py
open "http://localhost:5173/?city=<id>"
node tools/check-cities.mjs
```

Open the pull request with a screenshot of the city fully open and with the
lights on. The `Checks` workflow runs the tests and city check on GitHub.

# Add a theme

A theme is the artistic form of the whole picture, and it works for every city:
`paper` draws the pop-up book as it is, `miniature` turns it into a tilt-shift
model. A theme is a file in `src/themes/`, listed in `src/themes/index.js`. It
names post steps from `src/post.js` and the settings people can change:

```js
export const miniature = {
  id: 'miniature',
  name: { sv: 'Miniatyr', en: 'Miniature' },
  post: {
    tiltShift: { setting: 'focus', blur: 7, passes: 2 },
    grade: { saturation: 1.22, contrast: 1.1, vignette: 0.35 },
  },
  settings: [{ id: 'focus', label: { sv: 'Skärpa i höjdled', en: 'Sharp band height' }, min: 0.15, max: 0.75, step: 0.01, default: 0.3 }],
}
```

When the theme is used in a way that does not show, say how in `howTo`: one
line per item, in every base language. The lines open in a window the first
time someone picks the theme, before the general controls. A theme with
`tiltShift` must have them, because the sharp band follows the pointer:

```js
  howTo: [{ sv: 'Det skarpa bandet följer muspekaren.', en: 'The sharp band follows the pointer.' }],
```

A new post step goes in `src/post.js` and in `POST_STEPS` in
`tools/check-cities.mjs`. Measure it: the page must keep its frame rate on an
Apple Silicon Mac, and a slow Mac falls back to lower quality.

# Add a variant

A variant is an occasion laid over any theme, such as Christmas. It is a file
in `src/variants/`, listed in `src/variants/index.js`. It lists effects from
`src/effects.js` and its settings:

```js
export const christmas = {
  id: 'christmas',
  name: { sv: 'Jul', en: 'Christmas' },
  effects: [
    { type: 'stringLights', colors: ['#ffd9a0'] },
    { type: 'snowfall', requires: 'snow', setting: 'snow' },
  ],
  settings: [{ id: 'snow', label: { sv: 'Snö', en: 'Snow' }, min: 0, max: 1, step: 0.01, default: 0.6, requires: 'snow' }],
}
```

Rules for variants:

1. Realism comes from the city, not the variant. An effect that needs something
   the city may not have names it with `requires`. If the trait does not exist
   yet, add it to `src/traits.js` and set it for every city, with sources.
2. Effects must work with the parallax. Put weather in the space between the
   cards, and put decorations on a card's pivot so they fold with it.
3. A new effect type goes in `src/effects.js` and in `EFFECT_TYPES` in
   `tools/check-cities.mjs`.
4. A variant that changes how Lidscape is used says so in `howTo`, as a theme
   does.

Theme and variant settings share the URL, so their ids must differ:
`?theme=miniature&focus=0.4&variant=christmas&snow=0.3`.

# Add a language

The page is in English and Swedish. English is the default, and the page
follows the Mac's language when it knows it. A new language is one file and
two app files:

1. Copy `src/lang/en.js` to `src/lang/<code>.js`, where `<code>` is the
   two-letter ISO 639-1 code, such as `de`. Translate every string, and give
   `name` in the language itself (`Deutsch`). List it in `src/lang/index.js`.
2. Add `<string><code></string>` to `CFBundleLocalizations` in
   `app/src-tauri/Info.plist`. Without it, a Mac in that language opens the
   app in English.
3. Write `app/src-tauri/locales/<code>.lproj/InfoPlist.strings` with the camera
   question (`NSCameraUsageDescription`), and map it in `bundle.macOS.files` in
   `app/src-tauri/tauri.conf.json`, as for `sv`.
4. Optionally, translate city labels and theme and variant names: add your
   code next to `sv` and `en`, such as `{ sv: 'Snö', en: 'Snow', de: 'Schnee' }`.
   Text without your language shows in English.
5. Run `node tools/check-cities.mjs` until it prints OK, and look at
   `?lang=<code>` in a browser.

Every city, theme and variant must have its text in both English and Swedish.
