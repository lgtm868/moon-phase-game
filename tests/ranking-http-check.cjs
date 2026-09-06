'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Mutating acceptance tests intentionally run ONLY on the local D1 development DB.
// Example: RANKING_TEST_BASE=http://127.0.0.1:5173 RANKING_TEST_WRITES=1 node tests/ranking-http-check.cjs
const base = new URL(process.env.RANKING_TEST_BASE || 'http://127.0.0.1:5173');
const allowWrites = process.env.RANKING_TEST_WRITES === '1';
const testCors = process.env.RANKING_TEST_CORS !== '0';
if (allowWrites) assert(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Synthetic score writes are restricted to local test databases');
const origin = 'https://lgtm868.github.io';
const report = { base: base.origin, started: new Date().toISOString(), writes: allowWrites, corsTested: testCors, requests: [], checks: [], passed: false };
const artifact = path.resolve(process.env.RANKING_TEST_REPORT || path.join(__dirname, '..', 'output', 'ranking-tests', 'http-report.json'));
function check(label, fn) { fn(); report.checks.push(label); }
async function call(endpoint, options = {}) {
  const headers = { ...(testCors ? { Origin: origin } : {}), ...(options.headers || {}) };
  if (options.token) headers.Authorization = 'Bearer ' + options.token;
  let body = options.raw;
  if (Object.hasOwn(options, 'json')) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(options.json); }
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(new URL(endpoint, base), { method: options.method || 'GET', headers, body, signal: AbortSignal.timeout(20000) });
    const text = await response.text(); let value = null;
    if (response.status === 503 && text.includes('Your worker restarted mid-request.') && attempt < 2) {
      report.requests.push({ path: endpoint, method: options.method || 'GET', status: 503, retry: 'local Wrangler worker restarted', attempt: attempt + 1 });
      await new Promise(resolve => setTimeout(resolve, 150));
      continue; // Retry exactly the same body/runId; never regenerate a score.
    }
    try { value = text ? JSON.parse(text) : null; } catch { throw new Error(`${endpoint}: expected JSON, received ${response.status}; ${text.slice(0, 240).replace(/[a-zA-Z0-9_-]{40,}/g, '[redacted]')}`); }
    report.requests.push({ path: endpoint, method: options.method || 'GET', status: response.status });
    return { status: response.status, value, headers: response.headers, retried: attempt > 0 };
  }
}
function status(response, expected, label) { assert.equal(response.status, expected, `${label}: HTTP ${response.status}, error ${response.value?.error?.code || 'none'}`); }
const score = (firstTry, mode = 'easy', game = 'food') => ({ runId: randomUUID(), game, mode, metrics: { firstTry, completed: 5, total: 5 } });
async function register(aliasId) { const response = await call('/api/players', { method: 'POST', json: { aliasId } }); status(response, 201, 'Register anonymous alias'); assert.equal(typeof response.value.token, 'string'); assert.equal(typeof response.value.alias, 'string'); return response.value; }
async function post(token, payload) { return call('/api/scores', { method: 'POST', token, json: payload }); }
async function board(mode = 'easy', game = 'food') { const response = await call(`/api/leaderboards?game=${game}&mode=${mode}`); status(response, 200, 'Read board'); return response.value; }
(async () => {
  const health = await call('/api/health'); check('healthy durable backend', () => { status(health, 200, 'Health'); assert.equal(health.value.ok, true); });
  const initial = await call('/api/leaderboards?game=food&mode=easy');
  check('bounded public leaderboard response' + (testCors ? ' and allowed CORS' : ''), () => {
    status(initial, 200, 'Public board'); assert.equal(initial.value.game, 'food'); assert.equal(initial.value.mode, 'easy'); assert(initial.value.entries.length <= 50);
    for (const row of initial.value.entries) assert.equal(Object.keys(row).sort().join(','), 'alias,rank,score,unit');
    if (testCors) assert.equal(initial.headers.get('access-control-allow-origin'), origin); assert.equal(initial.headers.get('cache-control'), 'no-store');
  });
  const preflight = await call('/api/scores', { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
  check('browser preflight supports authorization and JSON', () => { status(preflight, 204, 'Preflight'); assert(preflight.headers.get('access-control-allow-headers').toLowerCase().includes('authorization')); });
  if (testCors) {
    const forbiddenOrigin = await call('/api/leaderboards?game=food&mode=easy', { headers: { Origin: 'https://not-authorized.invalid' } });
    check('unlisted browser origin denied', () => { status(forbiddenOrigin, 403, 'Foreign origin'); assert.equal(forbiddenOrigin.headers.get('access-control-allow-origin'), null); });
  }
  for (const query of ['game=__proto__&mode=easy', 'game=food&mode=constructor', 'game=food&mode=twinkle', 'game=piano&mode=easy']) status(await call('/api/leaderboards?' + query), 400, 'Malformed board');
  status(await call('/api/scores', { method: 'POST', json: score(5) }), 401, 'No bearer token');
  status(await call('/api/scores', { method: 'POST', token: 'a'.repeat(60), json: score(5) }), 401, 'Unknown bearer token');
  for (const aliasId of ['<img src=x onerror=alert(1)>', '__proto__', 'child real name']) status(await call('/api/players', { method: 'POST', json: { aliasId } }), 400, 'Rejected public alias');
  status(await call('/api/players', { method: 'POST', headers: { 'Content-Type': 'application/json' }, raw: '{' }), 400, 'Malformed JSON');
  status(await call('/api/players', { method: 'POST', headers: { 'Content-Type': 'application/json' }, raw: ' '.repeat(5000) }), 400, 'Oversized body');
  report.checks.push('invalid boards, anonymous submissions, arbitrary aliases, malformed/oversized bodies rejected');
  if (!allowWrites) { report.passed = true; console.log(`PASS ranking HTTP read-only: ${report.checks.length} checks; no valid players or scores created.`); return; }
  const first = await register('sky-panda'), second = await register('star-cat'), throttled = await register('moon-rabbit');
  const payload = score(5);
  const burst = await Promise.all(Array.from({ length: 20 }, () => post(first.token, payload)));
  check('20 simultaneous identical submissions store one logical run', () => {
    burst.forEach(result => assert([200, 201].includes(result.status), 'Concurrent duplicate accepted idempotently'));
    assert.equal(burst.filter(result => result.value.duplicate === false).length, 1);
    assert(burst.every(result => result.value.entry.score === 5));
  });
  const replay = await post(first.token, payload); check('retry is idempotent', () => { status(replay, 200, 'Identical replay'); assert.equal(replay.value.duplicate, true); });
  const changed = await post(first.token, { ...payload, metrics: { ...payload.metrics, firstTry: 4 } }); check('altered run ID reuse rejected', () => { status(changed, 409, 'Changed replay'); assert.equal(changed.value.error.code, 'replay_changed'); });
  const worse = await post(first.token, score(2)); check('later lower score preserves personal best', () => { status(worse, 201, 'Lower run'); assert.equal(worse.value.entry.score, 5); });
  const tie = await post(second.token, score(5)); check('independent anonymous player shares equal rank', () => { status(tie, 201, 'Second player'); assert.equal(tie.value.entry.rank, replay.value.entry.rank); });
  const racedRun = randomUUID();
  const racedPayloads = Array.from({ length: 20 }, (_, index) => ({ ...score(index % 2 ? 3 : 4), runId: racedRun }));
  const changedBurst = await Promise.all(racedPayloads.map(payload => post(second.token, payload)));
  check('concurrent changed-payload replay commits exactly one canonical result', () => {
    assert.equal(changedBurst.filter(result => result.status === 409).length, 10);
    assert.equal(changedBurst.filter(result => result.value.duplicate === false).length, 1);
    const acceptedValues = new Set(changedBurst.flatMap((result, index) => [200, 201].includes(result.status) ? [racedPayloads[index].metrics.firstTry] : []));
    assert.equal(acceptedValues.size, 1, 'Only one of the two racing payloads may succeed');
  });
  const hardPayload = score(1, 'hard'); const hard = await post(first.token, hardPayload); check('difficulty partitions personal best', () => { status(hard, 201, 'Hard mode'); assert.equal(hard.value.entry.score, 1); });
  const guessPayload = score(3, 'default', 'guess'); const guess = await post(first.token, guessPayload); check('game partitions personal best', () => { status(guess, 201, 'Guess game'); assert.equal(guess.value.entry.score, 3); });
  const easyBoard = await board(), hardBoard = await board('hard'), guessBoard = await board('default', 'guess');
  check('public reads share server data across separate bearer identities', () => {
    const a = easyBoard.entries.find(row => row.alias === first.alias), b = easyBoard.entries.find(row => row.alias === second.alias);
    assert(a && b); assert.equal(a.score, 5); assert.equal(b.score, 5); assert.equal(a.rank, b.rank);
    assert.equal(easyBoard.entries.filter(row => row.alias === first.alias).length, 1, 'One personal-best row despite many runs');
    assert.equal(hardBoard.entries.find(row => row.alias === first.alias).score, 1); assert.equal(guessBoard.entries.find(row => row.alias === first.alias).score, 3);
    for (const row of [...easyBoard.entries, ...hardBoard.entries, ...guessBoard.entries]) assert.equal(Object.keys(row).sort().join(','), 'alias,rank,score,unit');
  });
  for (const metrics of [{ firstTry: 6, completed: 5, total: 5 }, { firstTry: 5, completed: 4, total: 5 }, { firstTry: '5', completed: 5, total: 5 }]) status(await post(second.token, { ...score(0), metrics }), 400, 'Impossible quiz result');
  // Fresh player ensures the fixed-window test is independent of duplicate races above.
  for (let index = 0; index < 40; index++) status(await post(throttled.token, score(index % 6)), 201, 'Within score rate allowance');
  const limited = await post(throttled.token, score(5)); check('per-player rate limit bounds write abuse', () => { status(limited, 429, 'Rate limit'); assert.equal(limited.value.error.code, 'rate_limited'); });
  report.passed = true;
  console.log(`PASS ranking HTTP: ${report.checks.length} checks; concurrent deduplication, retries/conflicts, shared data, ties, game/mode partition, personal best, privacy and rate limits. Local test DB only.`);
})().catch(error => { report.error = error.message; console.error(error.message); process.exitCode = 1; }).finally(() => { fs.mkdirSync(path.dirname(artifact), { recursive: true }); fs.writeFileSync(artifact, JSON.stringify(report, null, 2)); });
