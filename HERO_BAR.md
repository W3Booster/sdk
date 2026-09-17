# Native hero-bar layout

`GameContext.heroBarLastOccupiedSlot` is an optional, one-based index of the last
visible native hero portrait. It describes the broadcaster's actual Warcraft
HUD, independently of hero ownership, selection, team size and data scopes.
Zero means the observed bar is empty. An absent field means unavailable; do not
interpret it as zero.

For one owned hero in slot 1 and one shared allied hero in slot 4:

```json
{
  "gameContext": {
    "hudScale": 1,
    "heroBarLastOccupiedSlot": 4
  }
}
```

Slots 2 and 3 stay reserved even though they are empty. Counting owned or
controllable heroes would give the wrong boundary. A dead hero can still have a
portrait. This field does not add shared heroes to `Player.heroes` or grant
access to their statistics.

Consumers choose their own placement policy. Match Vision reserves at least
three rows and extends its left production/construction column through the
observed last slot during self-play, using the same boundary for scrolling.
Its observer/replay layout stays unchanged. Older or unsupported recorders omit
the field; Match Vision retains its three-row compatibility fallback.

The wire accepts integers 0–32; the verified Warcraft 3.0.0.24268 profile exposes
seven physical slots. Native initial hydration uses
`W3Game.initialRuntime.heroBarLastOccupiedSlot`; subsequent `W3HeroBar.value`
updates carry the last slot, with `null` explicitly withdrawing an unavailable
observation. The public snapshot omits withdrawn values. New matches clear the
previous observation, and later valid readings can restore it.
