# Motif model: draft for review

Date: 2026-10-30. Status: draft for review.

This document proposes the result for phase 2 of the [motif plan](2026-10-29-motifs-styles-screensaver-plan.md). It does not change the product.
The car and teddy bear descriptions are design proposals, not finished research or drawings.

## Purpose

A viewer selects one motif, one style, and an optional occasion.
The lid folds the selected motif like a pop-up book.
The city, the car, and the teddy bear each have a separate menu.
The world map contains places only.

A motif is the subject of the picture. Stockholm, a car, and a teddy bear are motifs.
A category groups motifs. A style changes their visual treatment. An occasion adds decorations.
A trait describes a feature or condition that an occasion may require.
A paper part is one visible piece in a motif. An attachment point is a named place where another piece can connect.
These terms are proposed for this design. Code currently uses `city`, `theme`, and `variant`.

## Categories and selection

| Category | First example | Entry point | Map |
| --- | --- | --- | --- |
| Places | Stockholm | World map and place menu | Show each available place with its geographic location. |
| Vehicles | Generic red sports car | Vehicle menu | Do not show. |
| Toys | Teddy bear | Toy menu | Do not show. |
| Your own | A motif imported from an SVG file | Your own menu | Do not show. |

Each motif has one stable identifier, a category, and a name in Swedish and English.
Names are for display. Identifiers keep saved choices and links stable.
The place list feeds the world map. Other categories do not enter the map list.
Unavailable categories do not advertise a working selection before a motif exists.

For migration, an existing `?city=stockholm` link must still open Stockholm.
Existing `theme` and `variant` choices must remain effective.
The phase 1 screen saver settings must keep their selected city, style, and occasion.
The phase 3 change must not alter the current Stockholm picture or its map position.

## What the code does today

- `src/cities/index.js` registers cities. `findCity` falls back to the first city.
- `src/city.js` builds Stockholm and updates its paper layers from lid progress.
- `src/main.js` passes the city list to the world map and changes a city through the URL.
- `src/themes/index.js` registers Paper, Miniature, and Monet as themes.
- `src/variants/christmas.js` defines Christmas effects and settings.
- `src/traits.js` defines `snow`, `adventStars`, and `ice`. The city checker requires a boolean for each.
- `src/effects.js` filters effects through `requires`. Several Christmas effects currently have no requirement.

The current city builder assumes buildings, windows, water, and a skyline.
The car and teddy bear must not be passed to that builder as if they were cities.
An adapter or a common interface can provide shared behavior. Phase 3 must preserve the existing scene first.

## Proposed motif contract

A motif supplies a scene and its own fold. The scene exposes these capabilities to the host:

1. Add the motif to the book and return its root scene object.
2. Update the fold from a value between `0` and `1`.
3. Update lighting and any supported occasion effects with the scene.
4. Report a named hit when a motif supplies labels. Otherwise return no hit.
5. Release resources when the host replaces the scene or closes it.

The host may retain city-specific map transitions and reflections for places.
A car or teddy bear does not need a map miniature or a water reflection.
The exact API and ownership rules are implementation work for phase 3.
The implementation must not require a motif to create city-only geometry.

## Fold contract

The fold value `0` means the lid is closed. The value `1` means the lid is open.
The app slider and the sensor use the same fold value.
The screen saver uses the sensor when it is available. It uses the open position when the sensor is unavailable.

For every motif:

- At `0`, all moving paper parts lie flat against their intended page.
- At `1`, all moving parts form the selected open composition.
- Values between the endpoints move continuously in both directions.
- Repeated values produce the same positions. Reversing the lid reverses the fold without a jump.
- The parts remain within the book. Their movement must not cut through another part or page.
- Paper thickness and small depth offsets are allowed. They must not create flicker or visible gaps.
- The motif remains recognisable throughout the supported range. The closed position may overlap flat parts.
- Lighting and decorations follow their attached parts. A decoration must not float when its part folds.

For Stockholm, keep the existing layer order and appearance.
For a car, use the proposed V-fold below. For a teddy bear, use the proposed layered fold below.

## Traits and occasions

An occasion may add an effect only when the motif supplies the required feature or condition.
An unknown or absent trait must not enable an effect.
The checker must reject an effect that names an unknown trait.
A motif can omit a trait that does not apply. An omitted trait has the same effect as `false`.
This differs from the current city checker, which requires every registered city trait.
The migration must retain Stockholm's explicit weather values and their sources.
A trait does not by itself make an effect. The motif must also provide the attachment points or surfaces that effect needs.

The following names are proposals. The final registry and checker belong to implementation.

| Trait or support | Meaning | Example |
| --- | --- | --- |
| `snow` | The represented place supports the existing weather effect. | Stockholm's snowfall. |
| `adventStars` | The represented place supports the existing window-star effect. | Stockholm's window stars. |
| `ice` | The represented place supports the existing water-ice effect. | Stockholm's water. |
| `windows` | The motif supplies window surfaces. | Stockholm's building windows or the car cabin. |
| `windowGarlandSites` | The motif supplies building-window anchors for garlands. | Stockholm's building windows. |
| `treeSites` | The motif supplies positions for separate Christmas trees. | Stockholm's quay. |
| `bodywork` | The motif supplies an outer car body with attachment points. | The car body. |
| `wheels` | The motif supplies wheel parts. | The car's two visible wheels. |
| `fur` | The motif represents a furry subject. | The teddy bear. |
| `neck` | The motif supplies a neck attachment for a scarf. | The teddy bear's neck. |
| `layers` | The motif supplies edges for a light string. | A layered SVG motif. |

`snow` currently describes a real city's weather. It must not automatically imply snowfall for a generic car.
A paper snow decoration on the car roof can use a body attachment without claiming a location or climate.
Ice requires the existing `ice` condition and a water surface. It must not appear on a car or a teddy bear.
A scarf requires a neck attachment. Fur alone does not identify where a scarf can be placed.

The existing unguarded `trees`, `windowGarlands`, and `stringLights` effects need explicit support checks before non-city motifs use them.
Car windows do not imply building-window garland anchors. Fur does not imply a neck attachment.
For Stockholm, retain the present Christmas appearance and its existing sourced weather traits.
For the car, the proposed Christmas additions are a light string on the body and paper snow on the roof.
For the teddy bear, the proposed addition is a scarf. The bear does not gain car wheels, city windows, or water.
For a user SVG, the plan proposes only `layers`. It can receive edge lights and no other Christmas effect.

## Car: proposed paper design

The subject is a generic red sports car. It has no badge, model name, or copied design reference in the interface.
The composition uses a low side profile with a slight view of the front. The front points right.
It sits across the open spread and remains clear of the book's edge.
The silhouette, proportions, and details are a design proposal. They need review before drawing.

| Paper part | Appearance | Attachment and movement |
| --- | --- | --- |
| Left and right base tabs | Narrow paper supports behind the body. | One tab attaches to each page near the centre fold. |
| Body | Red lower silhouette, with separate front and rear edges. | Two folded body faces meet at the centre. Their tabs form the V-fold. |
| Cabin | A red roof outline with dark paper windows. | Attach to the body. It rises after the body begins to stand. |
| Wheels | Two visible dark circular paper parts with simple hubs. | Attach on the visible side. They rise last and fold flat with the body. |
| Lights | Small neutral paper shapes at the front and rear. | Attach to the body. Their light follows the app's light control. |
| Christmas pieces | Optional body light string and roof snow. | Attach to body and roof anchors. Do not add city trees or window garlands. |

At `0`, the tabs, body, cabin, and wheels lie on their pages without crossing the spine.
As the lid opens, the tabs lift the body. The cabin follows. The wheels stand last.
At `1`, the body, cabin, and both visible wheels form one readable car silhouette.
Closing reverses that order. The wheels do not need to roll.

A separate rights review is required before a car drawing is accepted or published.
This draft does not establish that any particular silhouette is free to use.

## Teddy bear: proposed paper design

The subject is a seated teddy bear with a calm expression. It has no badge, text, or named character reference.
Warm brown paper, visible edges, and simple shapes give it a handmade appearance.
The pose and face are design proposals. They need review before drawing.

| Paper part | Appearance | Attachment and movement |
| --- | --- | --- |
| Base | A small paper support on the page. | Holds the body at the centre of the spread. |
| Body | One broad, rounded brown layer. | Lifts from the base first. |
| Head and ears | A rounded head and two rounded ears. | Attach above the body and separate in depth as the fold opens. |
| Arms | Two separate rounded layers. | Attach at the shoulders and move apart from the body as the fold opens. |
| Face | Eyes, nose, and mouth in dark paper. | Attach to the head and follow it as one part. |
| Legs | Two rounded paper shapes at the lower body. | Attach to the body and remain within the pages. |
| Christmas scarf | A separate coloured paper strip. | Attach at the neck. Hide it when Christmas is off. |

At `0`, the body, head, arms, and legs lie flat in a known stacking order.
As the lid opens, the body rises and the head and arms separate into layers.
At `1`, the seated bear, face, arms, and legs are readable as one composition.
Closing reverses the fold. The scarf follows the neck at every value.

## Styles and surfaces

Each released style must have a defined result for every available motif.
Paper, Miniature, and Monet must remain usable during migration.
A future geometry-dependent style must work with every available motif before release.
A new motif must work with every available style before release.
An unsupported combination must not silently produce a broken or empty scene.

The screen saver shows a motif, style, and occasion without a world map.
Its runtime uses the lid only. Camera, mouse pointer, and gestures are not inputs there.
The searchable motif list and Shuffle remain phase 9. Custom SVG import remains phase 11.
The live desktop wallpaper and camera experiment have separate plans and are outside this specification.

## Verification gates

Before phase 3 is accepted:

- The city registry and the new motif contract reject duplicate identifiers and unknown categories.
- Stockholm keeps its existing appearance, saved choices, URL, map location, and Christmas effects.
- The map receives places only, including when non-place motifs are present.
- The checker rejects an unknown required trait. An absent trait does not enable an effect.
- Existing theme and variant tests continue to pass.

Before either new motif is accepted:

- Check open, closed, and intermediate fold positions from the front and an oblique view.
- Move the fold in both directions and check that paper parts and decorations do not intersect or jump.
- Check Paper, Miniature, Monet, no occasion, and Christmas for the motif.
- Check that effects without suitable traits and attachment points do not appear.
- Check keyboard selection and the Swedish and English names in the relevant menu.
- Check that switching motifs keeps the selected style and occasion. Release the previous scene.
- Check the supported screen saver after the phase 1 integration is available.
- Test the real lid on a MacBook and record what was observed.
- Complete the car's separate rights review before publishing that motif.

## Decisions for Peter

1. Is the proposed side profile and right-facing direction of the car acceptable?
2. Is the proposed seated bear with a calm expression acceptable?
3. Should Christmas add roof snow to the generic car even when no place or climate is selected?
4. Should the bear's scarf be the only initial Christmas decoration?
5. Should Christmas be selectable when a motif has no suitable decoration, or should the control be disabled?
