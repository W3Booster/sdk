import test from 'node:test';
import assert from 'node:assert/strict';
import { defineApplication } from '@w3booster/sdk/app';
import { createMatchFixture } from './match-fixture.mjs';

// Replace with your generated binding when integrating this into your own app.
const app = defineApplication({
  clientId: 'fixture_app', revision: 'fixture',
  scopes: ['match:read', 'players:read', 'heroes:read'], settingsDefaults: {}
});

for (const surface of ['streamOverlay', 'ingameOverlay']) {
  test(`${surface}: late attach, repeated missing fields, finish, next match`, async () => {
    const fixture = createMatchFixture({ surface });
    const runtime = app.createRuntime({ transport: fixture.transport, retry: false });
    const issues = [];
    const starts = [];
    runtime.client.on('issue', issue => issues.push(issue));
    runtime.client.on('match.started', event => starts.push(event));
    try {
      await runtime.start({ timeout: 1000 });
      const current = () => runtime.client.state.get();
      assert.equal(current().match.status, 'running');
      assert.equal(current().match.gameTime, 120);
      assert.equal(current().application.surface, surface);
      assert.equal(runtime.client.state.isSynchronized, true);
      assert.equal(starts.length, 0, 'late attachment is state, not a new match event');

      fixture.update(state => {
        for (const player of state.players) {
          delete player.apm;
          for (const hero of Object.values(player.heroes ?? {})) delete hero.statistics;
        }
      });
      const beforeRepeat = current();
      for (let index = 0; index < 20; index += 1) fixture.repeat();
      assert.equal(current(), beforeRepeat, 'unchanged SDK state keeps its identity');
      assert.equal(current().players[0].apm, undefined);

      fixture.update(state => { state.match.status = 'finished'; });
      assert.equal(current().match.status, 'finished');
      fixture.update(state => {
        state.match = { ...state.match, id: 'next-fixture-match', status: 'starting', gameTime: 0 };
      });
      assert.equal(current().match.status, 'starting');
      fixture.update(state => { state.match.status = 'running'; state.match.gameTime = 1; });
      assert.equal(current().match.status, 'running');
      assert.equal(current().match.id, 'next-fixture-match');
      assert.equal(fixture.sent, 25, 'no background publications or timers');
      assert.deepEqual(issues, []);
      await runtime.stop();
      const sent = fixture.sent;
      fixture.repeat();
      assert.equal(fixture.sent, sent, 'stopped fixtures do not publish');
    } finally { await runtime.stop(); }
  });
}


test('an invalid draft reports a protocol issue without recursive resync', async () => {
  const fixture = createMatchFixture();
  const runtime = app.createRuntime({ transport: fixture.transport, retry: false });
  const issues = [];
  runtime.client.on('issue', issue => issues.push(issue));
  try {
    await runtime.start({ timeout: 1000 });
    fixture.update(state => { state.players[0].statistics = {}; });
    assert.ok(issues.some(issue => issue.source === 'protocol'));
    assert.equal(fixture.sent, 2, 'invalid data must not cause a resend storm');
    fixture.update(state => { delete state.players[0].statistics; });
    assert.equal(runtime.client.state.isSynchronized, true);
  } finally { await runtime.stop(); }
});
