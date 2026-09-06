const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const script = fs.readFileSync(path.join(__dirname, '..', 'games-theme.js'), 'utf8');

function assertAsset(actual, filename) {
  const url = new URL(actual);
  assert.equal(url.origin, 'https://example.test', 'Ranking assets stay on the loader origin');
  assert.equal(url.pathname, '/games/' + filename, 'Ranking assets resolve beside the loader regardless of cache query');
}

function setup(readyState = 'loading', existingApi) {
  const elements = [], events = {};
  const window = { MoonRanking: existingApi };
  window.self = window;
  window.top = {};
  const document = {
    readyState,
    currentScript: { src: 'https://example.test/games/games-theme.js?v=current' },
    documentElement: { classList: { toggle() {} } },
    querySelector: () => null,
    createElement: tag => ({ tag }),
    head: { append: element => elements.push(element) },
    addEventListener: (name, fn) => { events[name] = fn; }
  };
  const context = vm.createContext({ window, document, URL, location: { href: 'https://example.test/elsewhere/page.html' } });
  vm.runInContext(script, context);
  return { window, elements, events, context };
}

for (const event of ['onload', 'onerror']) {
  const app = setup();
  assert.equal(app.elements.length, 0, 'Assets wait until the game DOM is available');
  const payload = { game: 'food', mode: 'easy', runId: 'run-1', metrics: { firstTry: 3, completed: 5, total: 5 } };
  assert.equal(app.window.MoonRanking.complete(payload), true);
  payload.metrics.firstTry = 0;
  assert.equal(app.window.__moonRankingQueue[0].metrics.firstTry, 3, 'Queued metrics are a snapshot');
  app.events.DOMContentLoaded();
  assert.equal(app.elements.length, 2);
  assertAsset(app.elements[0].href, 'games-ranking.css');
  assertAsset(app.elements[1].src, 'games-ranking-config.js');
  app.elements[1][event]();
  assert.equal(app.elements.length, 3, 'Interface follows either config success or its honest fallback');
  assertAsset(app.elements[2].src, 'games-ranking.js');
  app.elements[1].onload();
  app.elements[1].onerror();
  assert.equal(app.elements.length, 3, 'Config callbacks cannot inject duplicate interfaces');
  vm.runInContext(script, app.context);
  assert.equal(app.elements.length, 3, 'Repeated theme execution cannot bootstrap again');
  assert.equal(app.window.__moonRankingQueue.length, 1, 'Repeated theme execution retains pending completion');
}
const api = { complete() { return 'ready'; } };
const loaded = setup('complete', api);
assert.equal(loaded.window.MoonRanking, api, 'Existing real interface is preserved');
assert.equal(loaded.elements.length, 2, 'Already-parsed direct pages start loading immediately');
console.log('PASS ranking bootstrap: per-document queue, snapshot metrics, DOM readiness, sequential loading, config failure fallback, duplicate guards, and existing API preservation.');
