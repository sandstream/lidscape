# World map: design

Date: 2026-10-27. Status: implemented and checked in the browser and Mac app. Physical lid closure remains to be checked on the MacBook.

## Intent

Lidscape shows one city at a time. The world map lets the viewer zoom out
from the city and see all cities at once, as small pop-up miniatures on a
map. The map shows which cities exist and which do not exist yet. It makes
the collection visible, and it invites people to add the missing cities.

## What the viewer sees and does

1. In the city view, a small world map sits in the top right corner of the
   window.
2. A click on the small map starts the fly-out. The city book shrinks first.
   The world map book then grows into view. The two scenes do not intersect.
3. The world map is a dark night map, with the same colours as the night
   sky of the city view. The map lies flat as an open spread in a pop-up
   book, with a fold in the middle.
4. Each city that Lidscape has stands as a lit paper miniature at its
   location. Stockholm is the first.
5. Capitals without a city show as dark dots, with no miniature.
6. The lid controls the map: both pages fold at the spine, and the miniatures
   fold against their pages. A manual slider in the map menu provides the
   same motion when no lid sensor is connected.
7. A click on a lit miniature starts the fly-in. The world map book shrinks
   first. The chosen city book then grows until it fills the city view.
8. The viewer can zoom the map with a scroll wheel, pinch gesture or buttons.
   The viewer can drag a zoomed map and restore the whole map.
9. The map has its own menu for zoom, book fold, language, city selection and
   contribution. The city menu, including camera, lights, theme and variant,
   appears only in the city view.
10. Dense capital markers move apart. A click shows the selected capital and
    offers a choice when several markers share the clicked area.

## Decisions by Peter

- The map style is B and C from the mock-ups: a dark night map, as an open
  book spread with a fold.
- Lit miniatures for existing cities. Dark dots, with no miniature, for
  capitals without a city.
- The lid folds the miniatures down and up.
- The way in is the small map in the top right corner. A click on a
  miniature goes back into the city.
- The change between city and map is a fly-out and a fly-in, not a cut.
- The two books move in sequence. One shrinks before the other grows, so
  their parts never cut through each other.
- The map supports zoom and drag. The camera and light buttons do not show
  on the map.
- The map shows the whole world. Where miniatures crowd together (for
  example Stockholm, Oslo, Copenhagen and Helsinki, or later Göteborg and
  Malmö), they move a little apart, and a thin line shows the true
  location of each one.
- The map is for places only. Motifs that are not places (a car, a teddy
  bear) are a separate project, in a menu of their own. That project comes
  after the map.

## Goals

- A viewer can go from a city to the map and back, with the mouse alone.
- The map shows every city in `src/cities/` at its real location, with no
  extra work for the person who adds the city beyond its coordinates.
- The lid, the slider and the scroll wheel control the map as they control
  the city.

## Non-goals

- Motifs that are not places. They are the next project.
- Country borders, country names, roads or a zoomable map with tiles.
- A miniature for capitals without a city.
- Geographic accuracy beyond what a reader recognizes at a glance.

## Anti-goals

These make the feature a failure, even if it works:

- The map looks like a web map (tiles, pins, zoom buttons) and not like a
  page in the pop-up book.
- The fly-out or fly-in is a jump or a fade. The viewer must feel the
  camera move.
- The map drops the frame rate below that of the city view on the same
  Mac.
- The map breaks the rules of the project: a build step, or npm
  dependencies in the page.

## Constraints

- No build step and no npm dependencies in the page. Three.js and
  MediaPipe load from jsDelivr. Map data can also load from jsDelivr, or
  live in the repository as a small file.
- The app's content security policy (`app/src-tauri/tauri.conf.json`)
  allows `connect-src` to `cdn.jsdelivr.net`. Any other host must be added
  there.
- The camera is an off-axis "window" projection (`src/offaxis.js`): the
  viewer's eye is the camera, and the scene is in centimetres behind the
  screen. The fly-out must move or scale the scene, not take the camera
  away from the viewer's head.
- Every city must give its coordinates (latitude and longitude), with a
  source in `docs/cities/<id>.md`, as for all other numbers.
  `tools/check-cities.mjs` must check them.
- The list of capitals needs a source in the repository.
- Text on the map, if any, is in every base language (`src/lang/`).
- The map must work in the browser and in the Mac app.

## Guesses that Peter has not corrected

- The fly-out and the fly-in take a few seconds, not an instant.
- The head (with the camera on) and the pointer (with the camera off)
  still give depth on the map, as in the city view.
- The theme (Paper, Miniature) and the variant (Christmas) stay on when
  the viewer goes to the map.

## Calls made by Claude (Peter can change them)

- **Angle of the map.** The spread is tilted back from the screen, as in
  mock-up C: about 40 degrees from the screen plane, so that the viewer
  looks down at it at a slant, as at a book on a table. It does not lie
  flat in the floor plane, because the north would then be too
  foreshortened to read or click. The miniatures stand at a right angle to
  the page and fold down onto it, with the hinge at their base.
- **Capitals.** The 193 UN member states, with one capital each, from a
  list with a source that is kept in the repository.
- **A different city.** The page is built for one city at load time. After
  the map is open, a choice of another city reloads the page on the same map.
  The new page then flies into the selected city. The map covers the change.
  With only Stockholm today, the fly-in uses the same page.

## Left to the builder

- How the map is drawn: the source of the coastlines, the projection, and
  how the spread and the fold look.
- How a miniature is made: a small render of the real city, or a simple
  paper shape per city.
- How the small map in the corner looks, and how it fits with the HUD.
- The exact timing and curve of the fly-out and the fly-in.
- How the URL shows the map (for example `?view=map`), so that a reload
  keeps the viewer on the map.
- What a hover on a miniature or a dark dot shows.
