# Movement: how a motif reacts to the lid

Research, 30 October 2026. This file adds a fourth choice to the plan in
`2026-10-29-motifs-styles-screensaver-plan.md`.

## Intent

Today every style uses one movement. Each row of buildings is a card that
turns up on a hinge as the lid opens (`src/city.js`, `update`). Peter asked for
other movements: parts that spring apart and come together, parts that hang in
loops, and a figure on strings that falls down and stands up again.

The style sets how the picture looks. The movement sets how the parts move.
These are two different things, so they become two choices.

## The four movements

| Movement | Lid closed (0) | Lid open (1) | Default for |
| --- | --- | --- | --- |
| Pop-up (built) | A flat page | The cards stand up | Paper |
| Push puppet | The string is slack, the figure lies in a heap | The string is tight, the figure stands, with a small wobble | (new) |
| Mobile | The parts lie in a stack | The parts hang on threads and swing | Monet |
| Assemble | The parts float apart | The parts fall into place with a small click | Miniature, Bricks |

The user can change the movement. The style gives only the default.

### Push puppet

A push puppet is a toy figure. Wooden beads form its parts, and a string
through the beads goes down into a base. A spring in the base keeps the string
tight, so the figure stands. A push on the button under the base compresses
the spring and makes the string slack, so the figure falls down. When the
button is released, the figure stands up again.
([Wikipedia: Push Puppet](https://en.wikipedia.org/wiki/Push_Puppet))

The lid is the button. Closing the lid is the same as a push on the button.

- Lidscape cuts each landmark and building into horizontal bands. Each band is
  one bead. This works for every motif without new data.
- The lid angle gives the string tension: tension = progress.
- Each bead has a target tilt: `(1 - tension) * collapseAngle`. The bottom
  bead has the smallest angle, the top bead the largest.
- A spring moves each bead to its target. The tension travels up the string,
  so each bead starts a little after the bead below it.
- When the figure stands up, the spring is slightly underdamped. This gives one
  or two small wobbles, as on the real toy.

#### Classic push puppet motifs

The push puppet works best with the classic figures of the toy. These become
new motifs in the category Toys, next to the teddy bear.

| Motif | Source |
| --- | --- |
| Donkey | Kohner donkey push puppet ([oldwoodtoys.com](https://oldwoodtoys.com/new_page_8.htm)) |
| Horse with rider | Kohner horse and rider ([gasolinealleyantiques.com](https://gasolinealleyantiques.com/pushpuppet.htm)) |
| Dog | Kohner "Happy Snappy" dog ([oldwoodtoys.com](https://oldwoodtoys.com/new_page_8.htm)) |
| Acrobat clown on his hands | Kohner acrobat clown ([oldwoodtoys.com](https://oldwoodtoys.com/new_page_8.htm)) |
| Two boxers in a ring | Kohner boxers ([oldwoodtoys.com](https://oldwoodtoys.com/new_page_8.htm)) |
| Giraffe | Current wooden push puppet sets ([walmart.com](https://www.walmart.com/ip/16821074378)) |

- We draw our own generic figures. We do not copy one specific toy.
- We do not use licensed characters, for example cartoon or TV figures that
  Kohner also made as push puppets. They are protected.
- A figure motif has its beads in its data: head, neck, body, legs. The
  automatic bands are only for motifs with no beads, such as cities.

Rights: the oldest patent is from 1944 (Marty Meinrad, US 2421279A, issued
27 May 1947). The English patent by Tomlin and Burrows is US 2453646A (issued
9 November 1948). Both expired long ago. The form is free. We do not use the
brand name "Wakouwa" or the names of current makers.

### Mobile

A mobile is a hanging sculpture. Each arm is a balance: the mass times the
distance is the same on the two sides of the hanging point (L1 x M1 = L2 x M2).
A part balances when its centre of mass is below the hanging point.
([MCA Chicago](https://mcachicago.org/whats-on/exhibitions/intricate-calder-and-the-poetry-of-science/),
[Marco Mahler: How to make mobiles](https://www.marcomahler.com/how-to-make-mobiles/))

- Each building and landmark hangs on a thread from a loop above it. Lid
  closed: the threads are short and the parts lie stacked at the top. As the
  lid opens, the threads become longer and the parts come down to their place.
- Each part is a damped pendulum. A change of the lid angle gives the parts a
  push, as a small wind. When the lid is still, the parts slowly stop.
- The period follows the thread length: T = 2 pi sqrt(L / g). Long threads
  swing slowly, short threads swing fast. This gives a natural variation with
  no random numbers.
- The scene is in centimetres. A real g gives a swing that is too fast, so g
  is a tuning value (start: 1/10 of the real value).
- An arm with two parts must balance. The part list gives the masses, and
  `tools/check-cities.mjs` can check L1 x M1 = L2 x M2.

Rights: the mobile is a general form. Alexander Calder made the form famous.
He died in 1976, so each of his works is protected until 2046. We use the form
and do not copy a specific work.

### Assemble

The parts float apart when the lid closes, and come back together when it
opens. This is the same as an exploded view in a building guide.

- Each part moves away from the motif centre: `offset = direction * distance
  * (1 - progress)`, with a small rotation.
- The parts land in order, from the bottom up, as a real model is built.
- When a part lands, a short underdamped spring gives a small overshoot. This
  is the click.

Rights: the exploded view is a general technique. We use no brand of building
blocks. This agrees with the rule for Bricks.

## The movement contract

This replaces "The fold contract" in the plan.

- A motif is a list of parts. Each part has a standing pose and an order.
- A movement takes the parts, the lid progress, the time step and the Reduce
  Motion setting. It sets the pose of each part for each frame.
- A movement must give the standing pose at progress 1, when all springs are
  at rest. A test checks this for each movement on each motif.
- Pop-up needs no state. Push puppet, Mobile and Assemble keep a position and
  a speed per part between frames.

### The spring

Use a critically damped spring with a half-life. It moves to the target as
fast as possible with no overshoot. The half-life is the time in which the
distance to the target becomes about half.
([Daniel Holden: Spring-It-On](https://theorangeduck.com/page/spring-roll-call))

```js
// Holden, "Spring-It-On": critical_spring_damper_exact, goal velocity 0.
function spring(x, v, goal, halflife, dt) {
  const y = (4 * Math.LN2) / (halflife + 1e-5) / 2
  const j0 = x - goal
  const j1 = v + j0 * y
  const e = Math.exp(-y * dt)
  return [e * (j0 + j1 * dt) + goal, e * (v - j1 * y * dt)]
}
```

The wobble of the push puppet and the click of Assemble need a little
overshoot. For these, use the underdamped spring from the same article.

The cost is a few operations per part per frame. A city has fewer than 200
parts, so the cost is small compared with the render.

## Reduce Motion

The Mac has the accessibility setting Reduce Motion. Apple says that an app
must then reduce automatic and repetitive animations. Apple lists these
practices: tighten springs to reduce bounce, track animations directly with
the gesture, and do not animate depth in the z-axis.
([Apple HIG: Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility))

The lid is a direct gesture, so the movement can stay. When Reduce Motion is
on:

- All springs are critically damped. No wobble and no click.
- The mobile does not swing. The parts hang still.
- Assemble moves the parts only in x and y, not in depth.

The page reads `matchMedia('(prefers-reduced-motion: reduce)')`. The screen
saver gets the same setting from WebKit. Lidscape has no check for this today.
This is a gap for all movements, also for Pop-up and the screen saver shuffle.

## Menus

- Settings and the screen saver Options get a fourth pop-up button: Movement.
  The first item is "Style default", then the four movements.
- The search list of motifs does not change.

## Phases

| Phase | Owner | Work |
| --- | --- | --- |
| M1 | Claude | Prototype Push puppet on one Stockholm landmark, check with the real lid |
| M2 | Codex | Movement contract, the spring, Reduce Motion, the Movement pop-up |
| M3 | Codex | Push puppet on all motifs (automatic bands) |
| M3b | Claude | Research and draw the classic figures: donkey first |
| M4 | Codex | Assemble, then Mobile |
| M5 | Claude | Tune half-lives and g on real hardware, screenshots |

## Open questions to Peter

1. Is "Movement" a fourth choice for the user, or only a part of the style?
   The recommendation is a fourth choice with the style default first.
2. Push puppet in the first version, or after the screen saver?
3. Must a motif that is not a figure (a city) also work as a push puppet? The
   automatic bands make it possible. The result can look strange on wide
   buildings.
