# POSTAL 2 (fan remake)

A week of errands in Paradise, Arizona. Work down the list; how you get it done
is between you and the list.

Built from scratch for the browser: **no engine, no libraries, no asset files.**
The renderer is a hand-written WebGL2 pipeline, the town is generated at boot,
every texture is painted with canvas2D, and all sound effects are synthesised
with WebAudio. The only binary assets are the voice recordings (see below).

## Running it

Any static server works, but this one disables caching so edits show up on reload:

```bash
python3 serve.py 8420
```

Then open <http://localhost:8420>.

## Controls

| | |
|---|---|
| WASD | move |
| Mouse / Arrow keys | look (arrows work when pointer lock is unavailable) |
| Shift | sprint |
| LMB | attack |
| RMB | zoom |
| E (hold) | do the errand |
| F | flip them off |
| 1–4 | weapons |
| 5 | piss |
| Q / wheel | cycle weapon |
| R | reload |
| Space / Ctrl | jump / crouch |
| Tab or M | big map |
| V | mute voices |
| Esc | pause |

## What's in it

- **The town** — a 5×5 block grid of Paradise: adobe storefronts, palms and
  saguaros, power lines, mesas on the horizon, traffic, and twelve shops you can
  walk into, each with an interior and a shopkeeper.
- **The week** — five days of errands (cash the paycheck, buy milk, return the
  library book, gun permit, confess, dog food…). Finish the list, go home, sleep.
- **The crowd** — civilians who wander the pavements, panic, gag, point and
  laugh, or pull a gun on you if you provoke them; cops who escalate with your
  wanted level; thugs who start it themselves.
- **Death animations** — collapse, drop to the knees, stumble forward and crawl,
  and (shotgun only) launched off their feet onto their back.
- **Difficulty** — five levels that change damage taken, enemy aim, heat gain,
  police response, starting cash and how many lives you get.

## Voices

Dialogue is pre-rendered from the macOS system voices rather than relying on the
browser's speech API, which is unreliable and, once jammed, unfixable from inside
a page. The Dude speaks in one deep voice; the crowd is spread across twelve.

Regenerate after changing any dialogue (requires macOS):

```bash
python3 tools/render-voices.py
```

It skips clips that already exist and deletes orphans.

## Layout

```
src/gfx.js        WebGL2 renderer, mesh builder, shaders
src/city.js       town generation, interiors, nav graph, collision
src/entities.js   people, AI, death animations, cars, gore
src/game.js       player, combat, wanted level, errands, HUD, main loop
src/menu.js       main menu, options, pause
src/textures.js   every surface, painted procedurally
src/audio.js      synthesised SFX + dialogue playback
voices/           pre-rendered dialogue (generated)
```

## Note

An original fan implementation inspired by Postal 2. Not affiliated with or
endorsed by Running With Scissors; no original code, assets, or dialogue from
that game is used here. All code, art and writing in this repository is original.
