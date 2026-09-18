# Native menu observation (SDK 4.5)

SDK 4.5 continues to use protocol 4.0. No transport or scope migration is required.

Unused legacy Netease support has been removed. Supported `PlayerStats.provider` values are `bnet` and `w3champions`. No active integration used the removed provider.

`GameContext.menuOpen?: boolean` is an optional native observation. True indicates an open in-game menu/dialog; false indicates a recognized gameplay input mode; absence means unavailable. It is independent of pause, replay and observer status. A local `W3MenuState` update with null withdraws the observation; a new match clears it.

Overlay applications may hide their in-game surface while `menuOpen === true`. Keep recording and subscriptions active while hidden, and choose OBS visibility separately. Older SDKs/producers remain transport compatible but may not expose the new signal.

## Replay identity and departed players

Use `match.isReplay` and `match.isObserver` independently; a recording of an
observer game can have both flags. Do not derive either from menus or pause.
The matching recorder confirms engine session transitions independently of UI.

In observer/replay views, the matching recorder preserves attribution of known
surviving units neutralized by a standard melee player departure. Actual health,
production and resources keep updating; real destruction still removes a unit.
Fresh attachments can infer attribution from one unambiguous departed player's
preserved color. Custom maps that recolor units or create Neutral Victim units
independently may not provide reliable provenance. Self-play access is unchanged.
No new public fields are required for this recorder correction.

See the [SDK 4.5 guide](https://w3booster.com/developer/sdk-4-5/) for examples and
coverage, and [SDK 4.4](https://w3booster.com/developer/sdk-4-4/) for smooth live
values and interactive regions.
