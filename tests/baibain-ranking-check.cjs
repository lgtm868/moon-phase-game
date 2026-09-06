const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'baibain-game.html'), 'utf8');
const source = html.slice(html.indexOf('const rankingDiscoveries ='), html.indexOf('const clock ='));
assert(source.includes('function recordDiscoveries'), 'Exercise the actual observation achievement hook');
const events = [];
const window = { MoonRanking: { complete: event => events.push(event) } };
const context = vm.createContext({ window, Date, Math });
vm.runInContext(source + '\nthis.record = recordDiscoveries; this.begin = () => { rankingObservationStarted = true; };', context);
context.record({ count: 1000000n });
assert.equal(events.length, 0, 'Passive load does not report an achievement');
context.begin();
context.record({ count: 1n });
assert.deepEqual([...events[0].metrics.discoveries], ['one']);
for (const count of [1n, 1n, 1n]) context.record({ count });
assert.equal(events.length, 1, 'Repeated renders cannot duplicate achievements');
context.record({ count: 2n });
context.record({ count: 128n });
context.record({ count: 1024n });
context.record({ count: 1048576n });
assert.equal(events.length, 5);
assert.deepEqual([...events.at(-1).metrics.discoveries], ['one', 'double', 'hundred', 'thousand', 'million']);
assert.equal(new Set(events.map(event => event.runId)).size, 5, 'Each larger snapshot has its own idempotency key');
assert(events.every(event => event.game === 'baibain' && event.mode === 'discoveries'));
for (const count of [1n, 2n, 128n, 1024n, 2n ** 288n]) context.record({ count });
assert.equal(events.length, 5, 'Seeking backward, reset and later revisits cannot farm discoveries');
assert.deepEqual([...events[0].metrics.discoveries], ['one'], 'Later growth does not mutate queued metrics');

for (const api of [undefined, { complete() { throw new Error('ranking unavailable'); } }]) {
  const fallback = vm.createContext({ window: { MoonRanking: api, crypto: { randomUUID() { throw new Error('unavailable'); } } }, Date, Math });
  vm.runInContext(source + '\nrankingObservationStarted = true; recordDiscoveries({count: 1024n});', fallback);
}
for (const inline of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(inline[1]);
console.log('PASS Baibain ranking: explicit observation, five bounded discovery IDs, unique snapshot IDs, no repeat/reset farming, stable payloads, optional API/UUID failure isolation, inline syntax.');
