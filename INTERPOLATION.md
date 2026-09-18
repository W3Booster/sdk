# Interpolated health, mana and progress

The SDK now advances known health/mana and active production, construction and
building-upgrade values between recorder observations. Existing public fields
and subscriptions are unchanged; applications need no countdown implementation.
Human power build follows the engine's observed rate, including stops and changes
in workers. Unknown progress stays unknown, and waiting queue entries do not get
invented start times or durations.

The recorder supplies a precise simulation-clock heartbeat every **200 ms**. The
SDK publishes immutable derived snapshots every **50 ms** using the observed game
speed, including replay speeds. New observations immediately correct estimates.
A pause or speed change is detected at the next heartbeat; transport delay still
applies. The SDK never removes a job or invents completion solely from progress.

The integer `match.gameTime` holds its last displayed second when a forward-moving
heartbeat corrects an estimate slightly backwards. It advances again when the
estimate catches up. This avoids a brief `06:35 → 06:34 → 06:35` flicker without
changing heartbeat frequency. Only the integer clock is held: health, mana and
progress immediately use the corrected engine times.

This is not a global monotonic clock. An observed precise-clock rewind (even less
than a second), restarted recorder sample sequence, pause, stopped clock, match
status/identity change, source change or connection reset clears the hold. Real
seeks and authoritative pause/end corrections may therefore move the display
backwards. The existing one-second extrapolation bound still applies; holding a
display value does not keep stale timers running.

After **one second without a fresh heartbeat**, estimates freeze. Known connection
errors/gaps stop interpolation immediately; reconnect full snapshots restore
current anchors. Closed clients cancel their timers. Consumers receive ordinary
numeric fields and changed events, with no private interpolation metadata.

This requires coordinated release of the recorder, API, SDK and consumer bundles.
The public API shape is unchanged, but older SDK versions cannot interpret the
new sparse timing transport. Local tests cover 1×/2×/8×, pause/seek, correction,
stale streams, reconnects and scoped state. Live Warcraft validation covers health,
mana, production and Human power build at 1×; simulated speed tests are not a claim
of live replay validation.
