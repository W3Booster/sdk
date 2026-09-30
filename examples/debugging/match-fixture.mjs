import { PROTOCOL_VERSION } from '@w3booster/sdk';
import { createDemoState } from '@w3booster/sdk/testing';

// Synthetic, JSON-compatible data only. Never put credentials or live captures here.
const copy = value => JSON.parse(JSON.stringify(value));

/**
 * A manually advanced test transport. Use only in an explicit local/test build.
 * It never connects to W3Booster, launches a host, or exercises authorization.
 */
export function createMatchFixture({ surface = 'streamOverlay', settings = {} } = {}) {
  let state = copy(createDemoState());
  let context;
  let sequence = 0;
  let sent = 0;
  let publishing = false;
  state.match.gameTime = 120; // Attach to an already-running match by default.
  state.match.isObserver = true;

  function publish() {
    if (!context || context.signal.aborted || publishing) return;
    const data = copy(state);
    data.application = {
      clientId: context.clientId, settings: copy(settings), surface, development: true
    };
    // A malformed test draft can synchronously request resync. Do not recursively
    // resend that same invalid frame; let the test inspect the protocol issue.
    publishing = true;
    try {
      sent += 1;
      context.onMessage({
        version: PROTOCOL_VERSION, sequence: ++sequence, type: 'state.snapshot', data
      });
    } finally { publishing = false; }
  }

  return {
    transport: {
      name: 'application-test-fixture',
      open(nextContext) {
        if (context && !context.signal.aborted) throw new Error('Use one fixture per runtime');
        context = nextContext;
        sequence = 0;
        publish();
      },
      resync: publish,
      close() { context = undefined; }
    },
    get sent() { return sent; },
    repeat() { publish(); },
    update(edit) {
      const next = copy(state);
      edit(next); // Mutate this fixture draft, never an SDK snapshot.
      state = next;
      publish();
    }
  };
}
