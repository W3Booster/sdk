# In-game overlay interaction

This feature requires a desktop host and compositor with overlay-input protocol
v1, and this SDK revision. It is local implementation work; the current published
SDK/desktop release does not yet include it. Older hosts remain click-through.
OBS/browser sources stay noninteractive through this bridge.

## Mark an interactive region

```html
<div class="w3-interactive">
  <button id="settings">Settings</button>
  <input type="range" aria-label="Overlay scale">
</div>
```

The class marks the container's rectangular visible area, including padding, and
its descendants. The default policy is `data-w3-input="block"`: mouse input in
that region stays in the overlay. It does not make the element draggable and does
not implement its application actions. An opacity of zero does not disable input.

The compositor adds `w3input=1` to in-game app launches. Creating a client with the
updated SDK automatically loads the bridge for that document. For an overlay
without a data client, or to guarantee initialization before application event
handlers, initialize explicitly at startup:

```js
import { initializeOverlayInput } from '@w3booster/sdk/overlay-input';
const interaction = initializeOverlayInput();
// Install application handlers / mount the UI after initialization.
// Optional: interaction.refresh(); interaction.close();
```

Initialization is idempotent within a document. The returned registration is
shared; closing it stops the document's bridge. It is inactive in a standalone
page and activates only after an in-game parent-frame handshake. An optional
`parentOrigin` restricts that handshake; `signal` supports teardown.

## Allow unhandled input through

```html
<div class="w3-interactive" data-w3-input="conditional">
  <button id="action">Action</button>
</div>
```

```js
document.querySelector('#action').addEventListener('pointerdown', event => {
  event.stopPropagation(); // Keep this gesture out of Warcraft.
  // Your UI action or drag setup.
});
```

Conditional regions forward unconsumed **button-down** events. Synchronous
`stopPropagation()`, `stopImmediatePropagation()` or `preventDefault()` on the
pointer-down or compatibility mouse-down consumes the gesture. A later `click`
handler cannot retract a down already delivered to Warcraft. Async consumption
is not supported. The bridge observes the individual event before application
handlers and finalizes in a subsequent task, after propagation. Install it early;
handlers that prevent the bridge's capture listener from running, or bypass event
methods with direct prototype calls, are outside this contract.

Left, middle and right single-button gestures are supported. Simultaneous mouse
button chords are not part of this contract. Forwarded gestures keep paired
releases, movement and current Shift/Ctrl flags. If Warcraft takes native mouse
capture after a forwarded down, Windows delivers the remaining movement/release
directly. The app may receive `pointercancel` at this handoff. Conditional wheel forwarding is
an approximation of DOM wheel deltas in Windows units, not hardware Raw Input.
The app's own DOM behavior is preserved; the bridge does not stop propagation on
behalf of block regions. Keyboard/text focus, touch/pen and native HTML5/file
Drag-and-Drop are not added by this mouse-input contract.

## Show, hide, move and remove

Add/remove `w3-interactive`, or set `data-w3-input="disabled"` on a region or its
ancestor to disable it. Removed nodes, `display:none`, `visibility:hidden`, inert
subtrees, zero-size boxes and off-viewport areas stop publishing regions.
`pointer-events:none` on the marked element disables that region. Ancestor
rectangular overflow clipping is accounted for.

The SDK discovers marked nodes using a mutation observer and measures their
bounds on animation frames. This also detects position-only layout changes,
scrolling, CSS transforms and animations that a resize observer alone would miss.
Only changes and 200-ms heartbeats are sent across frames; mouse movement does
not trigger a DOM query or round trip. Work is limited to 256 marked elements per
app; mark compact containers rather than every cell in a large table.

Regions are axis-aligned rectangles. Rotated shapes, border-radius holes,
clip-paths and partially occluding unmarked content do not produce exact pixel
masks. Mark smaller rectangular controls where that distinction matters. Nodes
inside shadow roots or nested frames are not discovered automatically; marking
the containing host includes its bounding rectangle. Visibility changes are
asynchronous: no promise is made that a newly shown control can consume a click
before its region has reached the desktop host.

## Dragging a marked element

Use your app's drag implementation. For pointer-based dragging, call
`event.preventDefault()` to suppress native text/image dragging and
`element.setPointerCapture(event.pointerId)` on the consumed down and finish on
`pointerup`/`pointercancel`. Apply final pointer-up coordinates as well as moves,
which the browser may coalesce. The host keeps an accepted gesture assigned to its
original app, even when the cursor leaves the region. The SDK republishes bounds
while the element moves. A Warcraft gesture started outside regions stays with
Warcraft while crossing UI. Removing/hiding the active region cancels its input
ownership; applications must also clean up their own drag state when removing UI.

## Cursor

Use CSS `cursor` on your controls, for example `cursor:pointer` or `cursor:grab`.
The host uses the operating-system cursor over the interactive window; do not
render a DOM cursor on every mouse move. Its position does not wait for your
animation frames. Native visibility over UI was verified in the controlled
Warcraft window; other display/DPI modes still require acceptance.

## Hangs and diagnostic dot

The desktop hosts the compositor in a nonactivating popup owned by the game and
checks cached bounds independently from app/compositor JavaScript.
Outside regions it ignores mouse events with `forward:false`; no renderer decision
or Electron movement-forwarding hook is required for direct game clicks.
A frozen app's regions expire after 750 ms in a live compositor; a frozen
compositor's snapshot expires after 1 second in the desktop host. Stale input
older than 500 ms is not replayed into Warcraft on recovery. Input already owned
by the overlay is not retroactively forwarded when its renderer fails. Expired
regions become click-through for subsequent gestures. This is a deliberate
availability tradeoff, not a promise to preserve late consumption decisions.

The compositor shows a **red dot at bottom right** for consumed mouse input. It
stays lit for an observed held consumed gesture and briefly pulses for consumed
clicks/wheel events. It does not itself intercept input. It is a diagnostic in the
in-game surface only; its paint can freeze if the compositor renderer freezes.
It is not an independent watchdog or proof that a game received an event.

A hung Electron main process cannot run polling, mode switches or the watchdog.
If it was already ignoring input, the window retains click-through. If it was
accepting input, leaving the region can lose game clicks until recovery.
CPU/GPU contention can also affect gameplay. Do not interpret renderer independence
as immunity to every Electron or operating-system failure. The full integration
and hang results are documented in the platform's overlay input implementation
report; the early ~1-ms fixed-region experiment did not include iframe selection.
