'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');

// Runs outside the hosted Site; only imports its pure, side-effect-free rules.
const serviceDirectory = path.resolve(process.env.RANKING_SERVICE_DIR || path.join(__dirname, '..', 'leaderboard-service'));
const rulesPath = path.join(serviceDirectory, 'lib', 'ranking-rules.mjs');
const runId = '54b0573c-4111-45b5-b985-f9a722ca12ae';
const clone = value => structuredClone(value);
let checks = 0;
function reject(validate, payload, label) {
  assert.throws(() => validate(payload), undefined, label);
  checks++;
}
function accepted(validate, payload, expectedScore) {
  const original = JSON.stringify(payload);
  const result = validate(payload);
  assert.equal(JSON.stringify(payload), original, 'Validation cannot mutate caller data');
  assert.equal(result.score, expectedScore);
  assert.equal(typeof result.unit, 'string'); assert(result.unit.length);
  assert.notEqual(result.canonical, undefined, 'Every accepted result has canonical data for idempotency');
  checks++;
  return result;
}
(async () => {
  assert(fs.existsSync(rulesPath), 'Ranking backend source not found. Set RANKING_SERVICE_DIR to its separate checkout containing lib/ranking-rules.mjs.');
  const rules = await import(pathToFileURL(rulesPath).href);
  const { validateResult } = rules;
  assert.equal(typeof validateResult, 'function');
  const pianoSource = fs.readFileSync(path.resolve(__dirname, '..', 'sprunki-piano-game.html'), 'utf8');
  const songStart = pianoSource.indexOf('const SONGS =');
  const songEnd = pianoSource.indexOf('const SONG_CATEGORIES =', songStart);
  assert(songStart >= 0 && songEnd > songStart, 'Locate the actual piano song catalogue');
  const songFunction = pianoSource.match(/function selectedSong\(\) \{[\s\S]*?\n      \}/)?.[0];
  const chartFunction = pianoSource.match(/function makeChart\(\) \{[\s\S]*?\n      \}/)?.[0];
  assert(songFunction && chartFunction, 'Use actual chart generation rather than a duplicate formula');
  const actualCharts = vm.runInNewContext(pianoSource.slice(songStart, songEnd) + '\nlet selectedSongId;\n' + songFunction + '\n' + chartFunction + '\nObject.fromEntries(SONGS.map(song => { selectedSongId = song.id; return [song.id, makeChart().length]; }));');
  assert.deepEqual(JSON.parse(JSON.stringify(actualCharts)), rules.PIANO_CHARTS, 'Backend song bounds match every real makeChart output');
  assert.deepEqual(Object.keys(actualCharts).sort(), [...rules.PIANO_SONGS].sort(), 'Every real song has exactly one server board'); checks += 2;
  assert.deepEqual(Object.keys(rules.ALIASES).sort(), ['sky-panda', 'star-cat', 'moon-rabbit', 'sun-dog', 'sea-penguin', 'forest-bear'].sort());
  for (const [id, alias] of Object.entries(rules.ALIASES)) { assert.equal(rules.validateAlias(id), alias); assert(/^[ぁ-ゖー ]+$/.test(alias)); checks++; }
  for (const alias of ['__proto__', 'constructor', 'toString', '', 'real child name', '<script>x</script>', null, 42, {}, ['sky-panda']]) reject(rules.validateAlias, alias, 'Only fixed aliases can become public names');
  for (const [game, gameModes] of Object.entries(rules.MODES)) for (const mode of gameModes) { assert.deepEqual(rules.validateBoard(game, mode), { game, mode }); checks++; }
  assert.throws(() => rules.validateBoard('food', 'twinkle')); assert.throws(() => rules.validateBoard('__proto__', 'easy')); checks += 2;
  const modes = { food: ['easy', 'normal', 'hard'], guess: ['default'], addition: ['add-5', 'add-10', 'add-20', 'sub-5', 'sub-10', 'sub-20'], english: ['animals', 'food', 'colors'], moon: ['current', 'future'] };
  for (const [game, gameModes] of Object.entries(modes)) for (const mode of gameModes) {
    const total = game === 'moon' ? 20 : 5;
    const payload = { game, mode, runId, metrics: { firstTry: total - 1, completed: total, total } };
    const result = accepted(validateResult, payload, total - 1);
    accepted(validateResult, { ...payload, metrics: { firstTry: 0, completed: total, total } }, 0);
    accepted(validateResult, { ...payload, metrics: { firstTry: total, completed: total, total } }, total);
    const reordered = { metrics: { total, completed: total, firstTry: total - 1 }, runId, mode, game };
    assert.deepEqual(validateResult(reordered).canonical, result.canonical, 'Key insertion order cannot defeat duplicate detection'); checks++;
    for (const invalid of [-1, total + 1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER, '3', null, true, [], {}]) {
      reject(validateResult, { ...payload, metrics: { ...payload.metrics, firstTry: invalid } }, `${game}/${mode} rejects malformed firstTry`);
    }
    for (const invalid of [0, total - 1, total + 1, String(total), null, Infinity]) {
      reject(validateResult, { ...payload, metrics: { ...payload.metrics, completed: invalid } }, `${game}/${mode} requires a complete run`);
      reject(validateResult, { ...payload, metrics: { ...payload.metrics, total: invalid } }, `${game}/${mode} cannot invent a different run length`);
    }
    reject(validateResult, { ...payload, metrics: { ...payload.metrics, score: 1000000 } }, 'Client cannot provide an overriding score');
    const missingMetric = clone(payload); delete missingMetric.metrics.firstTry; reject(validateResult, missingMetric, 'Missing metrics cannot be silently filled');
  }
  const valid = { game: 'food', mode: 'easy', runId, metrics: { firstTry: 3, completed: 5, total: 5 } };
  const originalCanonical = validateResult(valid).canonical;
  assert.notDeepEqual(validateResult({ ...valid, metrics: { ...valid.metrics, firstTry: 4 } }).canonical, originalCanonical, 'Different scores cannot reuse an idempotency payload');
  assert.notDeepEqual(validateResult({ ...valid, mode: 'hard' }).canonical, originalCanonical, 'Difficulty is part of the canonical result');
  assert.notDeepEqual(validateResult({ ...valid, game: 'guess', mode: 'default' }).canonical, originalCanonical, 'Game is part of the canonical result');
  checks += 3;
  for (const invalid of [null, undefined, [], 'food', 42, true]) reject(validateResult, invalid, 'Only a result object is accepted');
  for (const field of ['game', 'mode', 'runId', 'metrics']) { const payload = clone(valid); delete payload[field]; reject(validateResult, payload, `Missing ${field}`); }
  for (const game of ['unknown', '__proto__', 'constructor', 'toString', '', null, 1, ['food']]) reject(validateResult, { ...valid, game }, 'Game IDs use an explicit allowlist');
  for (const mode of ['unknown', '__proto__', 'constructor', 'toString', '', null, 1, ['easy'], 'add-5']) reject(validateResult, { ...valid, mode }, 'Mode IDs are checked against the selected game');
  for (const badId of ['', ' ', null, 1, [], {}, 'x'.repeat(10000), '<script>alert(1)</script>']) reject(validateResult, { ...valid, runId: badId }, 'Run IDs have bounded, safe syntax');
  for (const metrics of [null, undefined, [], '3', 3, true]) reject(validateResult, { ...valid, metrics }, 'Metrics are an object, not coercible values');
  reject(validateResult, { ...valid, nickname: '<img src=x onerror=alert(1)>' }, 'Arbitrary user names are not part of the result contract');
  reject(validateResult, JSON.parse(JSON.stringify(valid).replace('"firstTry":3', '"firstTry":3,"__proto__":{"score":1000000}')), 'Prototype-shaped properties cannot alter validation');
  const discoveries = { game: 'baibain', mode: 'discoveries', runId, metrics: { discoveries: [...rules.DISCOVERIES] } };
  accepted(validateResult, discoveries, rules.DISCOVERIES.length);
  accepted(validateResult, { ...discoveries, metrics: { discoveries: [rules.DISCOVERIES[0]] } }, 1);
  assert.deepEqual(validateResult({ ...discoveries, metrics: { discoveries: [...rules.DISCOVERIES].reverse() } }).canonical, validateResult(discoveries).canonical, 'Discovery order cannot defeat duplicate protection'); checks++;
  for (const bad of [[], ['unknown'], ['__proto__'], [rules.DISCOVERIES[0], rules.DISCOVERIES[0]], [null], [1], 'one', {}, null]) reject(validateResult, { ...discoveries, metrics: { discoveries: bad } }, 'Only distinct known discoveries count');
  for (const mode of rules.PIANO_SONGS) {
    const notes = rules.PIANO_CHARTS[mode];
    const metrics = { perfect: notes, great: 0, good: 0, ok: 0, miss: 0, maxCombo: notes, noteCount: notes };
    const payload = { game: 'piano', mode, runId, metrics };
    accepted(validateResult, payload, 120 * notes);
    accepted(validateResult, { ...payload, metrics: { ...metrics, perfect: 0, miss: notes, maxCombo: 0 } }, 0);
    const mixed = { ...metrics, perfect: notes - 4, great: 1, good: 1, ok: 1, miss: 1, maxCombo: notes - 1 };
    accepted(validateResult, { ...payload, metrics: mixed }, (notes - 4) * 120 + 100 + 70 + 30);
    for (const key of ['perfect', 'great', 'good', 'ok', 'miss', 'maxCombo', 'noteCount']) for (const bad of [-1, 0.5, NaN, Infinity, '1', null]) reject(validateResult, { ...payload, metrics: { ...metrics, [key]: bad } }, `Piano ${key} is a bounded integer`);
    reject(validateResult, { ...payload, metrics: { ...metrics, great: 1 } }, 'Piano judgments must add up to the chart notes');
    reject(validateResult, { ...payload, metrics: { ...metrics, perfect: notes - 1 } }, 'Piano cannot omit judgments');
    reject(validateResult, { ...payload, metrics: { ...metrics, maxCombo: notes + 1 } }, 'Combo cannot exceed all hits');
    reject(validateResult, { ...payload, metrics: { ...metrics, maxCombo: notes - 1 } }, 'A run without misses has one unbroken combo');
    reject(validateResult, { ...payload, metrics: { ...mixed, maxCombo: Math.ceil((notes - 1) / 2) - 1 } }, 'Reported misses must account for all combo breaks');
    reject(validateResult, { ...payload, metrics: { ...metrics, score: 999999 } }, 'Server derives piano score');
    for (const forgedCount of [notes - 1, notes + 1, 5000]) reject(validateResult, { ...payload, metrics: { ...metrics, perfect: forgedCount, maxCombo: forgedCount, noteCount: forgedCount } }, 'Self-consistent inflated counts cannot bypass the real song manifest');
  }
  const entries = [
    { alias: 'a', score: 5, unit: 'もん', player_id: 'private-a', token_hash: 'secret' },
    { alias: 'b', score: 5, unit: 'もん', player_id: 'private-b' },
    { alias: 'c', score: 3, unit: 'もん', player_id: 'private-c' },
    { alias: 'd', score: 0, unit: 'もん', player_id: 'private-d' }
  ];
  const originalEntries = JSON.stringify(entries), ranked = rules.rankEntries(entries);
  assert.deepEqual(ranked.map(entry => entry.rank), [1, 1, 3, 4], 'Equal scores share competition rank without a hidden time advantage');
  assert.equal(JSON.stringify(entries), originalEntries, 'Presentation leaves database rows untouched');
  assert(ranked.every(entry => Object.keys(entry).sort().join(',') === 'alias,rank,score,unit'), 'Public rows never leak player IDs, hashes, or internal metadata');
  assert.deepEqual(rules.rankEntries([]), []); checks += 4;
  console.log(`PASS ranking rules: ${checks} assertions; all quiz modes; full-run boundaries; server-derived scores; canonical key ordering; malformed schema/types; prototype keys; bounded identifiers.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
