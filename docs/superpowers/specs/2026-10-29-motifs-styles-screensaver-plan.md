# Motifs, styles and the screen saver: plan

Date: 2026-10-29. Status: draft for Peter's approval.

Claude writes the content (research, motif and style specs, this plan).
Codex builds from the plan. Each phase ends with a pull request.

## Intent

Lidscape shows more than cities. A viewer picks a motif (what the picture
shows), a style (how it is drawn) and an occasion (what it celebrates). The
lid folds every combination like a pop-up book. The Mac screen saver shows
the same choices.

## The model: three choices

| Choice | Code name today | Examples | Rule |
| --- | --- | --- | --- |
| Motif | city | Stockholm, a red sports car, a teddy bear | A motif belongs to one category. |
| Style | theme | Paper, Miniature, Monet, Bricks | Every style works on every motif. |
| Occasion | variant | Christmas | An occasion adds only what the motif has (`requires` and traits). |

Categories group motifs:

| Category | Motifs, first | How the viewer finds them |
| --- | --- | --- |
| Places | Stockholm (built), then the city queue below | The world map (built in 0.2). |
| Vehicles | A red sports car | Its own menu. The world map holds places only. |
| Toys | A teddy bear | Its own menu. |
| Your own | A company logo from an SVG file | "Add Your Own…" in the motif menu. |

### Your own motif from an SVG file

A viewer opens an SVG file, for example a company logo. Lidscape turns it
into a unique pop-up motif that folds with the lid.

- Each shape in the SVG becomes a paper part, extruded with the Three.js
  `SVGLoader` and `ExtrudeGeometry`. Shapes with the same colour form one
  layer. The layers rise from the page in order, back to front.
- The file stays on the Mac. Lidscape stores the motif locally and sends
  nothing to a server.
- Lidscape reads only paths and colours. It ignores scripts, links, embedded
  images and external references in the file. It refuses files over 1 MB and
  files with more than 2,000 shapes.
- Before the first use, the viewer confirms that they may use the logo.
- Every style and occasion works on the motif. Its traits are `layers` only,
  so Christmas gives string lights along the edges and nothing more.
- The screen saver can show the motif.

A motif that is not a place needs traits of its own, so occasions can ask for
them. Examples: `windows` and `snow` for a city, `bodywork` and `wheels` for a
car, `fur` for a teddy bear. Christmas on a car gives string lights along the
bodywork and snow on the roof. Christmas on a teddy bear gives a scarf.

### The fold contract

Every motif defines how it folds. Lid closed (0) gives a flat page. Lid open
(1) gives the standing motif.

- City: the rows of buildings stand up from the page (built).
- Car: a V-fold pop-up. The body, the cabin and the wheels are separate
  paper parts that rise from the gutter in order, wheels last.
- Teddy bear: a layered pop-up. Body, head and arms are layers that move
  apart in depth.

`tools/check-cities.mjs` gets a check that every motif has a fold.

## Rights: we use only what we may use

This rule applies to every motif and every style. Each research file states
the result, with a source.

1. A style is not protected. A specific work is. We may paint "like Monet"
   and "like Van Gogh". Both died more than 70 years ago (1926 and 1890), so
   their works are also free, and we may use their names.
2. For a living artist, we do not copy a specific work and do not use the
   artist's name as a style name.
3. No brand names or logos: not Minecraft, not LEGO, not Ferrari. The brick
   style is called "Bricks". The car is a generic red sports car.
4. Car shapes can be protected. A US court held Ferrari body shapes to be
   protected trade dress ([Ferrari v. Roberts, 1991](https://law.justia.com/cases/federal/appellate-courts/F2/944/1235/)).
   The EU Court of Justice held that part of a car can have unregistered
   design protection ([C-123/20, Ferrari v Mansory, 2021](https://curia.europa.eu/juris/liste.jsf?num=C-123/20)).
   So the car mixes features. No single model is recognisable, it has no
   badge, and no model name appears in code, docs or the interface.
5. Buildings: freedom of panorama (the right to show buildings in public
   places) differs between countries. Sweden allows it. The night lighting of
   the Eiffel Tower is protected in France. Each city's research file states
   the rule for its country.

This is not legal advice. Ask a lawyer before a recognisable homage.

## Styles

Lid value f: 0 is flat, 1 is standing.

| Style | What the fold does | Work in Three.js | Order |
| --- | --- | --- | --- |
| Monet (impressionism) | The picture dissolves into soft brush strokes as f falls, like haze at dusk. | A post step in `src/post.js` (Kuwahara filter, a common oil-paint filter). | 1 |
| Bricks (generic toy bricks) | Bricks stack up, layer by layer, as f rises, and fall to the page as f falls. | New geometry: convert each motif to bricks with InstancedMesh. | 2 |
| Van Gogh | The sky swirls more as f rises. Lights get halos. | Brush strokes that follow a swirl field. Harder than Monet. | 3 |
| Papercut shadow box | Layers move apart in depth, and the backlight gets brighter as f rises. | Extrude the existing outlines into stacked planes. Low work. | 4 |
| Mosaic | Tiles fly into place as f rises. | Instanced quads or a screen shader. | Later |
| Stained glass | Light shines through as the motif stands up. | Voronoi cell shader with dark lead lines. | Later |
| Neon line | Lines draw on from 0 to 1 and the glow follows f. | Edge lines with a bloom pass. Low work. | Later |
| Kirigami (folded and cut paper) | Crease angles follow f directly. | New fold geometry. High work, best fit with the idea. | Later |

Peter asked for Monet, Van Gogh and bricks. Monet comes first because it
needs only a post step and no new geometry.

## Menus follow Apple's guidelines

Sources: Apple Human Interface Guidelines, [The menu bar](https://developer.apple.com/design/human-interface-guidelines/the-menu-bar),
[Settings](https://developer.apple.com/design/human-interface-guidelines/settings)
and [Pop-up buttons](https://developer.apple.com/design/human-interface-guidelines/pop-up-buttons).

- Motif, style and occasion change the picture, so they stay in the window
  where they act. The guidelines say to put options in the screens they
  affect, not in Settings.
- Use pop-up buttons for motif, style and occasion. A pop-up button shows a
  flat list of choices that exclude each other and shows the current choice.
  Group motifs by category, with a separator between categories.
- Menu bar, in standard order:
  - Lidscape: About Lidscape, Check for Updates…, Settings… (⌘,), Hide, Quit.
  - View: Motif, Style and Occasion as submenus, World Map, Enter Full Screen.
  - Window: Minimize, Zoom.
  - Help: Lidscape Help (the existing help window).
- Every command in the window also has a menu bar item.
- Settings… holds app-level settings only: camera, update check, the screen
  saver. Changes apply at once, with no OK or Apply button.
- Menu items use title capitalisation, an ellipsis when they open a window,
  and are dimmed (not hidden) when not available.

## The screen saver

The screen saver shows the same motifs, styles and occasions as the app.

- Nobody can change settings from the Lock Screen or from the running screen
  saver. macOS stops the screen saver at the first key press or mouse move.
- Two places change the same settings:
  1. System Settings > Screen Saver > Options. This is the screen saver's own
     sheet (`configureSheet` in `ScreenSaverView`). It works without the app.
  2. Lidscape > Settings… > Screen Saver in the app.
- The Options sheet has: category, motif, style, occasion, and a Shuffle
  switch. Shuffle changes the motif every 10 minutes, among motifs the viewer
  has ticked. It has a Done button, as the sheet guidelines ask.
- The lid is the only input. No camera, pointer or gestures.
- Codex chooses where the shared settings are stored. The screen saver runs
  in the sandboxed `legacyScreenSaver` host, so the app must write where that
  host can read. Test it on a real Mac.

## City queue: a draft for each city

A draft is the research file `docs/cities/<id>.md` (AGENTS.md step 1): one
real viewpoint, 4 to 7 landmarks, a source for every height and year, and the
panorama rule for the country. Claude writes drafts. Codex draws the cities
from them.

Order (Claude's call, Peter can change it): Oslo, Copenhagen, Helsinki (they
test the crowded Nordic corner of the map), Göteborg, London, Paris, New York,
Tokyo.

## Phases

| Phase | Owner | Result | Gate |
| --- | --- | --- | --- |
| 0 | Peter | Merge PR #17 (Kaknästornet) and PR #15 (the i icon). | Merged on main. |
| 1 | Codex | Finish the screen saver on `feat/screensaver` (occlusion fix, lid, wake-up). | Live frames in the real screen saver, seen in the log. |
| 2 | Claude | Motif spec: categories, traits, fold contract, the car and the teddy bear as paper parts. | Peter approves. |
| 3 | Codex | Rename in code: city becomes motif, with categories. Cities keep working. | Checks pass. Stockholm looks the same. |
| 4 | Codex | Menus per Apple's guidelines: pop-up buttons, menu bar, Settings window. | Checked in the Mac app against the list above. |
| 5 | Codex | Monet style. | Frame time checked. Every motif looks right. |
| 6 | Claude, then Codex | The red sports car: research and spec, then build. | Rights check passes. Fold works on a real lid. |
| 7 | Codex | Bricks style, then Van Gogh. | As phase 5. |
| 8 | Claude, then Codex | City drafts, then cities, in queue order. | `check-cities` OK. Every landmark free against the sky. |
| 9 | Codex | Screen saver Options with motif, style, occasion and Shuffle. | Change in Options, see it in the real screen saver. Same for the app. |
| 10 | Claude, then Codex | The teddy bear. | As phase 6. |
| 11 | Codex | Your own motif from an SVG file. | Three test logos fold correctly. A file with a script is read without running it. |

## Open questions for Peter

- Is the order of the styles right: Monet, Bricks, Van Gogh, papercut?
- Is the city queue right?
- Does Shuffle belong in the first screen saver version, or later?
