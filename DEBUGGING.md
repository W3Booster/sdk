# Debugging an app or overlay

For developers and coding agents. Start here when an overlay is blank, appears only
after reload, disappears during a match, or stops returning for the next match.
You can reproduce application state/rendering bugs using the public SDK without
Warcraft III, credentials, or access to the private W3Booster platform repository.
A synthetic test does not verify the desktop compositor, authorization, OBS,
recorder availability, or the user's Windows installation.

## Establish which boundary fails

Record the app revision, installed SDK version (`npm ls @w3booster/sdk`), browser
version, surface, exact startup order, expected behavior and observed behavior.
Verify the running server's working directory and build output. A successful build
or an HTTP 200 is not evidence that the overlay rendered.

Trace one update through:

`SDK lifecycle → app adapter → optional app relay → derived state → render → visibility`

| Observation | Investigate next |
| --- | --- |
| No page or chunks load | URL, server, stale output, embedding policy, surface switches |
| Page loads; no synchronized state | Lifecycle status, permission/connection error category, granted capabilities |
| Synchronized running state; empty DOM | First browser exception, React error boundary, update loop, adapter |
| DOM exists but is invisible | CSS, dimensions, opacity, menu/visibility conditions |
| Normal direct SDK updates; relay POST/SSE flood | App relay feedback, sender ownership, deduplication |
| Synthetic app works; only host/live fails | Fresh host launch, scopes, surface config, recorder/host diagnostics |

Use `client.lifecycle`, `client.diagnostics` and `client.on('issue', ...)` rather
than inspecting private wire internals. The [support trace example](https://w3booster.com/developer/troubleshooting/#capture-a-small-support-trace)
records bounded metadata. Inspect full exceptions locally; remove credentials,
URL fragments, browser-source URLs, player names and private state before sharing.
Never solve authorization by saving or replaying launch tokens.

## Reproduce with controlled state

For a single static case, the generated binding already supports:

```js
const runtime = w3boosterApp.createRuntime({
  demo: { interval: 0, surface: 'streamOverlay' }
});
await runtime.start();
```

For transitions, copy [match-fixture.mjs](examples/debugging/match-fixture.mjs) and
[lifecycle.test.mjs](examples/debugging/lifecycle.test.mjs) into your app's test
folder. They use public SDK 4.8 APIs and Node's built-in test runner. From an SDK
checkout run `node --test examples/debugging/lifecycle.test.mjs`; from an installed
package run:

```sh
node --test node_modules/@w3booster/sdk/examples/debugging/lifecycle.test.mjs
```

These files are included with releases containing this guide. For an older SDK
artifact, copy them from this repository; the examples need no private packages.
The shipped tests validate the fixture and SDK lifecycle. **They do not test your
app until you connect the fixture to your real app entry and assert its output.**

Use your generated binding in the test entry:

```js
import { w3boosterApp } from './w3booster.generated';
import { createMatchFixture } from './test/match-fixture.mjs';

const fixture = createMatchFixture({ surface: 'streamOverlay' });
// A variable also permits the public testing transport extension in TypeScript.
const options = { transport: fixture.transport, retry: false };
const runtime = w3boosterApp.createRuntime(options);
// Give this runtime to the SAME adapter/hooks/rendering entry as the live app.
// In a browser test entry only, expose fixture to your automation driver.
window.overlayFixture = fixture;
await runtime.start({ timeout: 1000 });
```

Keep this entry confined to an explicit test build. Do not select test mode from a
production URL or bundle fixture data into normal startup. Stop the runtime at
teardown. Each mounted runtime needs its own fixture. This source has no timers;
`repeat()` emits unchanged data and `update(draft => ...)` emits a complete new
snapshot. Never mutate the SDK's immutable snapshots.

Exercise this sequence with the real page and, if present, the real local relay:

| Step | Required assertion |
| --- | --- |
| Open while the first snapshot is already `running` | Overlay becomes visible without waiting for a new `match.started` event |
| Repeat the same snapshot 20 times | No render/update-depth error; UI stays present; publications/requests stay bounded |
| Omit APM and optional hero statistics | No crash or invented zero; unchanged derived state retains identity |
| Send `finished` | App follows its defined end-of-match visibility policy |
| New match ID with `starting`, then `running` | Next match appears; `starting` has not latched an ended state |
| Unmount/remount; test both overlay surfaces | Subscriptions clean up; fresh mount receives current state |

Example driver operations (through your browser automation's `page.evaluate`):

```js
await page.evaluate(() => window.overlayFixture.repeat());
await page.evaluate(() => window.overlayFixture.update(state => {
  state.match.status = 'finished';
}));
await page.evaluate(() => window.overlayFixture.update(state => {
  state.match = { ...state.match, id: 'second-test-match', status: 'starting', gameTime: 0 };
}));
await page.evaluate(() => window.overlayFixture.update(state => {
  state.match.status = 'running';
}));
```

Capture `pageerror`, browser console errors (including React's “Maximum update
depth exceeded”), root element presence/visibility, and relay POST/SSE counts.
Wait for the expected UI with a bounded timeout before sampling; an arbitrary
sleep may only measure lazy loading. Assert visibility after every transition,
not only at initial load. Choose a request budget based on deliberate app
publications; repeated rendering must not generate unbounded network traffic.

Launch the relay with the same origin/proxy behavior as the normal app. Verify
that a test publication returns success and reaches a second reader. A relay
fixture that returns 403 to every POST can hide the very feedback loop under test.
Use an isolated port/store so tests never publish to a live overlay relay.

Then run a fresh authorized launch in W3Booster and OBS to check the actual host.
Keep synthetic evidence and live confirmation separate in the bug report.

## Prevent React and relay feedback loops

SDK snapshots are immutable and structurally shared. Your own adapters must not
undo that stability. `useSyncExternalStore` requires a cached snapshot while its
store has not changed. Use `createReactStore` from `@w3booster/sdk/react` for SDK
stores, keep the store/runtime stable per mount, and memoize derived merges by
their actual inputs. See [React's snapshot contract](https://react.dev/reference/react/useSyncExternalStore#im-getting-an-error-the-result-of-getsnapshot-should-be-cached).

An effect that depends on a freshly allocated merged object and calls `setState`
can rerun forever even while the SDK is idle. Add a regression asserting that an
unchanged input returns the same derived object. `NaN !== NaN`: if an app adapter
uses `NaN` for unavailable counters, use `Object.is` when comparing those values,
or normalize absence consistently. Do not put NaN into JSON fixtures: JSON turns
it into null. Test such sentinels directly at the adapter boundary.

For app-owned relays, keep the data flow one-way:

`direct SDK state → deliberate publisher → relay → read-only merged display`

Do not publish a display state that already includes the same relay's data back
to that relay. With multiple writers, define origin/sequence ownership and
idempotency; do not rely on timers to damp an uncontrolled loop. Keep subscriptions
alive when merely hiding an overlay. Treat `starting`, `running`, `finished` and
`none` explicitly; `status !== 'running'` is not a valid “match ended” predicate.

## Shortcut changes are settings, not keyboard pulses

W3Booster toggles and persists the boolean on each shortcut press. `false → true`
and `true → false` are successive presses, not key-down and key-up. Prefer
rendering the current setting directly. A relay that only handles rising edges
will skip every second observed toggle. If mapping changes to app-owned actions,
baseline initial hydration and source handoff, ignore identical snapshots and
handle both directions. Settings are current state; rapid edits can coalesce
while saves are in flight, so they are not a lossless command/event stream.

## Instructions to give your coding agent

Copy this into your app's `AGENTS.md`, adjusting commands/selectors for your app:

> Before changing W3Booster startup timing or visibility, read the SDK's
> `DEBUGGING.md` and capture the first failing boundary. Reproduce with the real
> app entry, adapters and local relay using a deterministic SDK fixture. Add a
> regression that fails before the fix and passes afterward. Cover late attach,
> unchanged/missing counters, finish, and the next starting/running match for both
> overlay surfaces. Check browser exceptions, DOM visibility and bounded relay
> traffic; passing builds and hook-only tests are insufficient. Use public SDK
> APIs, do not persist launch credentials, and label synthetic versus live
> validation. If synthetic tests pass but live fails, report the smallest remaining
> host-specific reproduction instead of guessing at undocumented internals.

If escalation remains necessary, include a minimal app/reproduction, lockfile,
exact commands, expected/actual result, SDK/browser/surface versions, sanitized
metadata and the first relevant stack trace. Never publish someone else's app
archive or private data without their permission.
