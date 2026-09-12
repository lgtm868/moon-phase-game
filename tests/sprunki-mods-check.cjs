'use strict';

// node tests/sprunki-mods-check.cjs [--vm-only] [--wait-assets]
// DOM-only UI integration: renderer functions remain private. The allowlist
// pins the approved named mods; it does not independently certify popularity.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const originalIds = 'oren raddy clukr funbot vineria gray brud garnold owakcx sky mrsun durple mrtree simon tunner mrfun wenda pinki jevin black'.split(' ');
const anpanIds = 'anpanman baikinman dokinchan shokupanman currypanman melonpanna rollpanna creampanda jamojisan batakosan'.split(' ');
const musicIds = [...originalIds, ...anpanIds];
const approved = [
  ['acid', 'ACID', 'Pyramixed'], ['tox', 'Tox', 'Pyramixed'], ['sulfur', 'Sulfur', 'Pyramixed'],
  ['mard', 'Mard', 'Retake'], ['mrbear', 'Mr. Bear', 'Retake']
];
const modIds = approved.map(([id]) => id);
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const firstModel = file => [...read(file).matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];

function modelChecks() {
  const context = vm.createContext({});
  vm.runInContext(read('sprunki-roster.js'), context);
  const roster = context.SprunkiRoster;
  assert(Object.isFrozen(roster));
  assert(Object.isFrozen(roster.characters)); assert(Object.isFrozen(roster.modCharacters));
  assert.deepEqual(Array.from(roster.characters, c => c.id), originalIds);
  // Snapshot of the existing original twenty, before the five-mod integration.
  assert.equal(createHash('sha256').update(JSON.stringify(roster.characters)).digest('hex'),
    '005bc96e14506a2eb2e5a55ca73fca4e190cd3773fd7120ad448cca745c5afc6', 'Original character records must remain unchanged');
  assert.deepEqual(Array.from(roster.modCharacters, c => [c.id, c.name, c.sourceGroup]), approved);
  const all = [...roster.characters, ...roster.modCharacters];
  assert.equal(new Set(all.map(c => c.id)).size, 25);
  for (const char of all) {
    assert(Object.isFrozen(char), char.id + ': frozen record');
    assert.throws(() => { char.id = 'invented'; }, TypeError);
  }
  assert.throws(() => roster.modCharacters.push({ id: 'invented' }), { name: 'TypeError' });
  for (const char of roster.modCharacters) {
    assert.equal(char.file, `assets/sprunki-mods/${char.id}.png`);
    assert(char.spokenName && char.hiragana && char.displayName);
    for (const key of ['audio', 'music', 'beats', 'loopable', 'loopStart', 'loopEnd']) {
      assert(!Object.hasOwn(char, key), `${char.id}: no invented ${key}`);
    }
  }
  const manifestContext = { window: {} };
  vm.runInNewContext(read('games-audio-manifest.js'), manifestContext);
  assert.deepEqual(Object.keys(manifestContext.window.MoonAudioManifest.tracks), musicIds);
  for (const id of modIds) assert(!fs.existsSync(path.join(root, 'sounds/packed', id + '.js')), `${id}: no fabricated music pack`);
  const guess = vm.runInContext(firstModel('sprunki-guess-game.html') + ';GuessGame;', context);
  assert.deepEqual(Array.from(guess.characters, c => c.id), originalIds);
  for (const [i, char] of guess.characters.entries()) assert.deepEqual(plain(char), { ...plain(roster.characters[i]), name: roster.characters[i].hiragana });
  const addition = vm.runInContext(firstModel('sprunki-addition-game.html') + ';AdditionGame;', context);
  const draw = addition.createCastCycle(roster.characters, () => .37);
  assert.deepEqual(Array.from(draw(20), c => c.id).sort(), originalIds.slice().sort());
  assert.deepEqual(Array.from(roster.characters, c => c.id), originalIds);
  console.log('PASS VM: approved five named mods, frozen unique roster, no invented music, original twenty unchanged in Addition/Guess.');
  return plain(roster);
}

async function waitForAssets(mods) {
  const missing = () => mods.filter(c => !fs.existsSync(path.join(root, c.file))).map(c => c.file);
  if (missing().length && process.argv.includes('--wait-assets')) {
    const deadline = Date.now() + 300000;
    console.log('WAIT assets (up to 5 minutes): ' + missing().join(', '));
    while (missing().length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 2000));
  }
  assert.deepEqual(missing(), [], 'MOD assets are pending; use --vm-only until ready, or --wait-assets');
  for (const char of mods) assert.equal(fs.readFileSync(path.join(root, char.file)).subarray(0, 8).toString('hex'), '89504e470d0a1a0a', char.id + ': real PNG');
}

async function browserChecks(roster) {
  const runtime = process.env.CODEX_NODE_RUNTIME || 'C:/Users/shohe/.cache/codex-runtimes/codex-primary-runtime/dependencies/node';
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.join(runtime, 'node_modules/playwright'));
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
    fs.readFile(file, (error, bytes) => { res.writeHead(error ? 404 : 200, { 'Content-Type': type }); res.end(error ? '' : bytes); });
  });
  let browser;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    browser = await chromium.launch({ headless: true, ...(process.env.AUDIO_BROWSER ? { executablePath: process.env.AUDIO_BROWSER } : { channel: 'chrome' }) });
    const base = `http://127.0.0.1:${server.address().port}`;
    async function open(file) {
      const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
      const errors = [], failedMods = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => { if (response.url().includes('/assets/sprunki-mods/') && !response.ok()) failedMods.push(response.url()); });
      await page.route(/^https?:/, route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
      await page.addInitScript(() => {
        window.__moonRankingBootstrapped = true; window.MoonRanking = { complete() {} };
        const probe = window.modProbe = { loads: [], selections: [], errors: [], pending: [] };
        addEventListener('unhandledrejection', event => probe.errors.push(String(event.reason)));
        addEventListener('moon:audio-state', event => {
          for (const error of event.detail?.errors || []) probe.errors.push(error.message);
        });
        // Observe real engine calls, including swallowed load errors, without
        // substituting audio behavior or exposing any private renderer API.
        let engine;
        Object.defineProperty(window, 'MoonAudio', { configurable: true, get: () => engine, set(value) {
          engine = value;
          for (const [name, field] of [['loadTrack', 'loads'], ['setMusicSelection', 'selections']]) {
            const method = value[name];
            value[name] = function(arg) {
              probe[field].push(arg);
              const result = method.call(this, arg).catch(error => { probe.errors.push(error.message); throw error; });
              probe.pending.push(result.catch(() => {}));
              return result;
            };
          }
        } });
      });
      await page.goto(base + '/' + file + '?standalone=1');
      return { page, errors, failedMods };
    }
    async function verifyClean(test, allowedIds = originalIds) {
      const result = await test.page.evaluate(async () => {
        await Promise.all(modProbe.pending);
        return { loads: modProbe.loads, selections: modProbe.selections, errors: modProbe.errors, state: MoonAudio.getMusicState() };
      });
      assert.deepEqual(result.errors, [], 'No unknown-track or other audio errors');
      assert.deepEqual(result.state.errors, []); assert.deepEqual(test.errors, []); assert.deepEqual(test.failedMods, []);
      assert(result.loads.every(id => allowedIds.includes(id)), 'Only this game\'s approved audio is loaded');
      assert(result.selections.every(ids => ids.every(id => allowedIds.includes(id))), 'No MOD reaches music selection');
    }
    async function images(page, selector, count) {
      assert.equal(await page.locator(selector).count(), count);
      await page.locator(selector + ' img').evaluateAll(imgs => Promise.all(imgs.map(img => img.decode())));
      assert(await page.locator(selector + ' img').evaluateAll(imgs => imgs.length > 0 && imgs.every(img => img.naturalWidth > 0 && img.naturalHeight > 0)));
    }

    const moon = await open('moon-phase-game.html');
    await moon.page.locator('#tabFriends').click();
    const moonSelector = '#sprunkiList .sprunki-choice';
    await images(moon.page, moonSelector, 35);
    assert.deepEqual(await moon.page.locator(moonSelector + ' img').evaluateAll(imgs => imgs.slice(0, 20).map(img => img.src)), roster.characters.map(c => new URL(c.file, base + '/').href));
    assert.deepEqual(await moon.page.locator(moonSelector + ' img').evaluateAll(imgs => imgs.slice(30).map(img => img.src)), roster.modCharacters.map(c => new URL(c.file, base + '/').href));
    async function onlyMoon(index) {
      const buttons = moon.page.locator(moonSelector);
      if (await buttons.nth(index).getAttribute('aria-pressed') !== 'true') await buttons.nth(index).click();
      for (let i = 0; i < 35; i++) {
        if (i === index || await buttons.nth(i).getAttribute('aria-pressed') !== 'true') continue;
        // A retained Black image replays on its first click after playback stops.
        if (i === originalIds.indexOf('black') && !await moon.page.evaluate(() => MoonAudio.getMusicState().selected.includes('black'))) {
          await buttons.nth(i).click();
          assert.equal(await buttons.nth(i).getAttribute('aria-pressed'), 'true', 'Stopped Black replays before it can be deselected');
          await moon.page.waitForFunction(() => MoonAudio.getMusicState().selected.includes('black'));
        }
        await buttons.nth(i).click();
      }
      assert.equal(await moon.page.locator(moonSelector + '[aria-pressed="true"]').count(), 1);
    }
    for (const [i, mod] of roster.modCharacters.entries()) {
      const button = moon.page.locator(moonSelector).nth(30 + i);
      assert((await button.getAttribute('title') || '').includes(mod.sourceGroup), mod.id + ': named MOD title');
      assert((await button.textContent()).includes(mod.displayName));
      await onlyMoon(30 + i);
      assert(await moon.page.locator('#musicButton').isDisabled(), mod.id + ': MOD-only music disabled');
      await moon.page.locator(moonSelector).nth(0).click();
      assert(await moon.page.locator('#musicButton').isEnabled(), 'MOD plus Oren can play Oren');
      await moon.page.locator('#musicButton').click();
      await moon.page.waitForFunction(() => MoonAudio.getMusicState().selected.includes('oren'));
      assert.deepEqual(await moon.page.evaluate(() => MoonAudio.getMusicState().selected), ['oren']);
      await moon.page.locator(moonSelector).nth(0).click();
      assert(await moon.page.locator('#musicButton').isDisabled());
      assert.deepEqual(await moon.page.evaluate(() => MoonAudio.getMusicState().selected), []);
    }
    for (let i = 0; i < 20; i++) {
      await onlyMoon(i); assert(await moon.page.locator('#musicButton').isEnabled(), originalIds[i] + ': original recording remains available');
    }
    for (const [i, id] of anpanIds.entries()) {
      await onlyMoon(20 + i);
      assert(await moon.page.locator('#musicButton').isEnabled(), id + ': generated original is playable');
      if (await moon.page.locator('#musicButton').getAttribute('aria-pressed') !== 'true') await moon.page.locator('#musicButton').click();
      await moon.page.waitForFunction(id => MoonAudio.getMusicState().playing.includes(id), id);
      assert.deepEqual(await moon.page.evaluate(() => MoonAudio.getMusicState().selected), [id]);
      await moon.page.locator(moonSelector).nth(30).click();
      assert.deepEqual(await moon.page.evaluate(() => MoonAudio.getMusicState().selected), [id], 'MOD plus generated audio plays only generated track');
    }
    await verifyClean(moon, musicIds); await moon.page.close();
    console.log('PASS Moon: 35 images; 30 playable choices; all ten generated originals decoded; named MOD titles; MOD-only disabled; MOD mixed with canonical/generated music stays silent.');

    const piano = await open('sprunki-piano-game.html');
    // Existing buildCharacters appends to characterStrip; laneHeads is not the picker.
    const pianoSelector = '#characterStrip .character-button';
    await images(piano.page, pianoSelector, 25);
    assert.deepEqual(await piano.page.locator(pianoSelector).evaluateAll(nodes => nodes.map(node => node.dataset.character)), [...originalIds, ...modIds]);
    assert.equal(await piano.page.locator(pianoSelector + '[data-mod]').count(), 5, 'Only the five MODs carry a MOD badge');
    await piano.page.locator('#soundButton').click();
    await piano.page.locator('#soundButton').click();
    await piano.page.waitForFunction(() => modProbe.loads.length === 20);
    for (const mod of roster.modCharacters) {
      await piano.page.locator('#menuButton').click();
      const button = piano.page.locator(`${pianoSelector}[data-character="${mod.id}"]`);
      assert.equal(await button.getAttribute('data-mod'), mod.sourceGroup);
      assert((await button.getAttribute('title') || '').includes(mod.sourceGroup), mod.id + ': named MOD title');
      assert((await button.evaluate(node => getComputedStyle(node, '::after').content)).includes('MOD'), mod.id + ': visible MOD badge');
      assert((await button.textContent()).includes(mod.displayName));
      await button.click();
      assert.equal(await button.getAttribute('aria-pressed'), 'true');
      assert.equal(await piano.page.locator('#heroFace').evaluate(img => img.src), new URL(mod.file, base + '/').href);
      await piano.page.locator('#menuCloseButton').click();
      assert(await piano.page.locator('#soundButton').isEnabled(), 'No recording must not disable ordinary piano sound');
      await piano.page.locator('#piano .piano-key').first().click();
    }
    await verifyClean(piano); await piano.page.close();
    console.log('PASS Piano: 25 rendered/selectable characters; MOD titles; original-only audio loads; piano remains usable for MODs.');

    const addition = await open('sprunki-addition-game.html');
    await addition.page.locator('#musicTrack option').first().waitFor({ state: 'attached' });
    assert.deepEqual(await addition.page.locator('#musicTrack option').evaluateAll(nodes => nodes.map(node => node.value)), originalIds);
    assert(await addition.page.locator('#groups .character').evaluateAll(nodes => nodes.length > 0 && nodes.every(node => !['acid', 'tox', 'sulfur', 'mard', 'mrbear'].includes(node.dataset.characterId))));
    await verifyClean(addition); await addition.page.close();
    const guess = await open('sprunki-guess-game.html');
    await guess.page.locator('#sound').click();
    for (let round = 0; round < 5; round++) {
      const name = await guess.page.locator('#targetName').textContent();
      const char = roster.characters.find(c => c.hiragana === name); assert(char, 'Original-only guessing target');
      const ids = await guess.page.locator('#cards .card').evaluateAll(nodes => nodes.map(node => node.dataset.id));
      assert(ids.every(id => originalIds.includes(id)));
      await guess.page.locator(`#cards [data-id="${char.id}"]`).click();
      await guess.page.locator('#next').click();
    }
    assert.deepEqual(await guess.page.locator('#friends .friend').evaluateAll(nodes => nodes.map(node => node.dataset.id)), originalIds);
    await verifyClean(guess); await guess.page.close();
    console.log('PASS Addition/Guess browser: original 20 music choices and collection entries; no MOD leakage.');
    console.log('PASS browser ' + browser.version() + '; no renderer API exported, no files or assets rewritten.');
  } finally {
    if (browser) await browser.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
}

(async () => {
  const roster = modelChecks();
  if (process.argv.includes('--vm-only')) return;
  await waitForAssets(roster.modCharacters);
  await browserChecks(roster);
})().catch(error => { console.error(error); process.exitCode = 1; });
