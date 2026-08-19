const reporters = new WeakMap();

/** Keep consumer-listener reporting private while allowing composed SDK stores to share one issue channel. */
export function registerConsumerIssueReporter(client, reporter) {
  reporters.set(client, reporter);
}

/** Retrieve a registered reporter so composed stores can preserve the diagnostic channel. */
export function consumerIssueReporter(owner) {
  return reporters.get(owner);
}

export function reportConsumerIssue(client, error) {
  const reporter = reporters.get(client);
  if (reporter) {
    reporter(error);
    return;
  }
  if (typeof globalThis.reportError === 'function') globalThis.reportError(error);
  else globalThis.console?.error?.('W3Booster SDK listener failed:', error);
}
