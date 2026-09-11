// node tests/addition-roster-check.cjs [--browser]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'sprunki-addition-game.html'), 'utf8');
const registry = fs.readFileSync(path.join(root, 'sprunki-roster.js'), 'utf8');
const model = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
const { game, characters } = vm.runInNewContext(`${registry}\n${model}\n({game: AdditionGame, characters: SprunkiRoster.characters})`);
assert.equal(characters.length, 20);
assert.equal(new Set(characters.map(c => c.id)).size, 20);
assert.match(html, /<script src="sprunki-roster\.js\?v=20260912-roster"><\/script>/);
assert(html.indexOf('sprunki-roster.js?v=20260912-roster') < html.indexOf('// Pure game model'));
for (const char of characters) {
  assert(char.hiragana);
  assert.equal(fs.readFileSync(path.join(root, char.file)).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const audio = fs.readFileSync(path.join(root, char.audio));
  assert(audio.length > 1000, `${char.id}: packaged audio is not empty`);
  if (char.audio.endsWith('.wav')) {
    assert.equal(audio.subarray(0, 4).toString(), 'RIFF');
    assert.equal(audio.subarray(8, 12).toString(), 'WAVE');
  } else {
    assert(char.audio.endsWith('.mp3'));
    assert(audio.subarray(0, 3).toString() === 'ID3' || (audio[0] === 255 && (audio[1] & 224) === 224));
  }
}
for (let seed = 1; seed <= 100; seed++) {
  let x = seed;
  const draw = game.createCastCycle(characters, () => ((x = (1664525 * x + 1013904223) >>> 0) / 4294967296));
  const drawn = [];
  // Variable-size questions, with a continuous cycle across session boundaries.
  for (const n of [2, 3, 1, 14, 11, 9, 20]) drawn.push(...draw(n));
  for (let i = 0; i <= drawn.length - 20; i++) assert.equal(new Set(drawn.slice(i, i + 20).map(c => c.id)).size, 20);
  for (const char of drawn) assert(characters.includes(char), 'Use registry entries without inventing paths or names');
}
assert.throws(() => game.createCastCycle([]), /Empty character roster/);
console.log('PASS roster model: 20 packaged images/audio, shared registry, 100 seeded cast cycles without starvation.');

async function browserChecks() {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const output = path.join(root, 'output', 'playwright', 'addition-roster');
  fs.mkdirSync(output, { recursive: true });
  const url = pathToFileURL(path.join(root, 'sprunki-addition-game.html')).href;
  const errors = [];
  try {
    for (const viewport of (process.argv.includes('--targeted') ? [{ width: 1024, height: 600 }] : [{ width: 1024, height: 600 }, { width: 1180, height: 820 }, { width: 390, height: 844 }])) {
      const context = await browser.newContext({ viewport, hasTouch: true, reducedMotion: 'reduce' });
      await context.route(/^https?:/, route => route.abort());
      await context.addInitScript(() => {
        window.mediaCalls = { plays: [], pauses: 0, speech: [], cancels: 0, pending: [], errors: [] };
        window.volumeWrites = [];
        let volumes = { music: .91, voice: .85, effects: .55 };
        Object.defineProperty(window, 'MoonAudio', { value: {
          getVolumes: () => ({ ...volumes }),
          setVolumes(value) { volumeWrites.push(value); volumes = { ...volumes, ...value }; window.dispatchEvent(new CustomEvent('moon:audio-volume', { detail: { ...volumes } })); },
          unlock: async () => ({}), output: () => ({ gain: {} }), setDucking() {}, onSuspend() {},
          getMusicState: () => ({ selected: [], playing: [], pending: [], errors: mediaCalls.errors }),
          setMusicSelection(ids) { mediaCalls.errors = ids.includes('black') ? [{ id: 'black', message: 'loop-unverified' }] : []; if (mediaCalls.errors.length) { window.dispatchEvent(new Event('moon:audio-state')); return Promise.resolve(); } mediaCalls.plays.push(ids[0]); if (window.deferPlayback) return new Promise((resolve, reject) => mediaCalls.pending.push({ resolve, reject })); return Promise.resolve(); },
          stopMusic() { mediaCalls.pauses++; mediaCalls.errors = []; }
        } });
        Object.defineProperty(window, 'speechSynthesis', { value: {
          getVoices: () => [], addEventListener() {}, speaking: false, pending: false,
          speak(u) { window.mediaCalls.speech.push(u.text); }, cancel() { window.mediaCalls.cancels++; }
        } });
      });
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message));
      await page.clock.install();
      await page.clock.pauseAt(new Date(Date.now() + 1000));
      await page.goto(url);
      await page.locator('#answers button').first().waitFor();
      assert.equal(await page.locator('#musicVolume').inputValue(), '91', 'Initialize from shared volume, including values above the old 50% cap');
      assert.equal(await page.evaluate(() => volumeWrites.length), 0, 'Initialization must not write volume');
      await page.evaluate(() => MoonAudio.setVolumes({ music: .73 }));
      assert.equal(await page.locator('#musicVolume').inputValue(), '73', 'Shared volume event updates local slider');
      for (const value of ['0', '37', '100']) {
        const before = await page.evaluate(() => volumeWrites.length);
        await page.locator('#musicVolume').fill(value);
        assert.equal(await page.evaluate(() => MoonAudio.getVolumes().music), Number(value) / 100, 'Local input updates shared music volume');
        assert.equal(await page.evaluate(() => volumeWrites.length), before + 1, 'Synchronization does not feed back into shared writes');
        assert.deepEqual(await page.evaluate(() => ({ voice: MoonAudio.getVolumes().voice, effects: MoonAudio.getVolumes().effects })), { voice: .85, effects: .55 });
      }
      await page.evaluate(() => { MoonAudio.setVolumes({ music: .91 }); window.volumeWrites = []; });
      assert.equal(await page.locator('#musicTrack option').count(), 20);
      assert.deepEqual(await page.locator('#musicTrack option').evaluateAll(els => els.map(o => [o.value, o.textContent])), Array.from(characters, c => [c.id, `${c.hiragana} \u266a`]));
      assert.equal(await page.evaluate(() => mediaCalls.plays.length + mediaCalls.speech.length), 0);
      for (const char of characters) {
        await page.locator('#musicTrack').selectOption(char.id);
      }
      assert.equal(await page.evaluate(() => mediaCalls.plays.length), 0, 'Selection alone never plays');
      await page.locator('#musicTrack').selectOption('oren');
      await page.locator('#musicToggle').tap();
      assert.equal(await page.evaluate(() => MoonAudio.getVolumes().music), .91, 'Play must not overwrite shared volume with a stale local default');
      const loopCharacters = characters.filter(char => char.id !== 'black');
      assert.equal(loopCharacters.length, 19, 'Only 19 characters support synchronized music');
      for (const char of loopCharacters) {
        await page.locator('#musicTrack').selectOption(char.id);
        assert.equal(await page.evaluate(() => mediaCalls.plays.at(-1)), char.id);
        assert.equal(await page.evaluate(() => MoonAudio.getVolumes().music), .91, 'Track change preserves shared volume');
      }
      assert.equal(await page.evaluate(() => volumeWrites.length), 0, 'Play and track changes never write global volume');
      await page.evaluate(() => MoonAudio.setVolumes({ music: .64 }));
      assert.equal(await page.locator('#musicVolume').inputValue(), '64', 'Shared changes also synchronize during playback');
      await page.locator('#musicToggle').tap();
      await page.evaluate(() => { window.deferPlayback = true; });
      await page.locator('#musicToggle').tap();
      await page.locator('#musicTrack').selectOption('oren');
      await page.evaluate(() => mediaCalls.pending[0].reject(new Error('stale track')));
      assert.equal(await page.locator('#musicToggle').getAttribute('aria-pressed'), 'true');
      await page.locator('#musicToggle').tap();
      const pauses = await page.evaluate(() => mediaCalls.pauses);
      await page.evaluate(() => { mediaCalls.pending[1].resolve(); window.deferPlayback = false; });
      assert.equal(await page.evaluate(() => mediaCalls.pauses), pauses, 'Engine cancellation is owned by stopMusic, stale completion never restarts');
      assert.equal(await page.locator('#musicToggle').getAttribute('aria-pressed'), 'false');
      await page.locator('#musicToggle').tap();
      const plays = await page.evaluate(() => mediaCalls.plays.length);
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
      await page.locator('#musicTrack').selectOption('sky');
      assert.equal(await page.evaluate(() => mediaCalls.plays.length), plays);
      await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
      assert.equal(await page.evaluate(() => mediaCalls.plays.length), plays, 'Visibility restoration requires manual music tap');
      await page.locator('#musicToggle').tap();

      // Black remains selectable and packaged for preview, but cannot start a loop.
      await page.locator('#musicToggle').tap();
      await page.locator('#musicTrack').selectOption('black');
      await page.locator('#musicToggle').tap();
      assert.equal(await page.locator('#musicToggle').getAttribute('aria-pressed'), 'false');
      assert.equal(await page.locator('#musicStatus').textContent(), 'このおとは どうきの じゅんびちゅう');
      assert.equal(await page.locator('#musicTrack option').count(), 20);
      assert.equal(await page.evaluate(() => mediaCalls.plays.includes('black')), false);
      await page.locator('#musicTrack').selectOption('oren');
      assert.equal(await page.locator('#musicStatus').textContent(), '');
      assert.equal(await page.locator('#musicToggle').getAttribute('aria-pressed'), 'false');
      await page.locator('#musicToggle').tap();
      assert.equal(await page.locator('#musicToggle').getAttribute('aria-pressed'), 'true');
      await page.locator('#musicToggle').tap();

      if (process.argv.includes('--targeted')) { await context.close(); console.log('PASS targeted music contract: 20 choices, 19 loop tracks, Black unavailable without false ON, deferred cancellation, manual restart after hidden.'); continue; }
      const seen = new Set();
      const castIds = () => page.locator('#groups .character').evaluateAll(els => els.map(e => e.dataset.characterId));
      async function verifyImages(selector = '#groups .character img') {
        await page.locator(selector).evaluateAll(imgs => Promise.all(imgs.map(img => img.decode())));
        const images = await page.locator(selector).evaluateAll(imgs => imgs.map(img => ({ file: img.getAttribute('src'), name: img.alt, width: img.naturalWidth, id: img.parentElement.dataset.characterId, label: img.parentElement.getAttribute('aria-label') })));
        for (const img of images) {
          const char = characters.find(c => c.file === img.file);
          assert(char && img.width > 0);
          assert.equal(img.name, char.hiragana);
          if (img.id) { assert.equal(img.id, char.id); assert(img.label.includes(char.hiragana)); seen.add(img.id); }
        }
      }
      for (const operation of ['add', 'subtract']) {
        await page.locator(operation === 'add' ? '#addMode' : '#subtractMode').tap();
        await page.locator('#level').selectOption('20');
        if (operation === 'subtract') await page.locator('#handsOn').check();
        for (let round = 0; round < 5; round++) {
          const numbers = await page.locator('#equation > span').allTextContents();
          const a = Number(numbers[0]), b = Number(numbers[2]), total = operation === 'add' ? a + b : a - b;
          await verifyImages();
          const before = await castIds();
          assert.equal(before.length, operation === 'add' ? a + b : a);
          assert.equal(new Set(before).size, before.length, 'No duplicate cast within a question');
          if (operation === 'subtract') {
            await page.locator('#handsOn').uncheck();
            assert.deepEqual(await castIds(), before, 'Hint toggle retains cast and positions');
            await page.locator('#handsOn').check();
            assert.equal(await page.locator('#answers button:disabled').count(), 3);
            for (let i = 0; i < b; i++) await page.locator(`#left [data-counter-id="${i}"]`).tap();
            assert.equal(await page.locator('#left .gone').count(), b);
          }
          const wrong = page.locator('#answers button').filter({ hasText: new RegExp(`^(?!${total}$)\\d+$`) }).first();
          await wrong.tap();
          assert.deepEqual(await castIds(), before, 'Retry retains physical character identities');
          if (round === 0) await page.screenshot({ path: path.join(output, `${viewport.width}-${operation}.png`), fullPage: true });
          await page.locator('#answers button').filter({ hasText: new RegExp(`^${total}$`) }).tap();
          await page.clock.runFor(1801);
        }
        assert(await page.locator('#party').isVisible());
        assert.equal(await page.locator('#party .band img').count(), 3);
        await verifyImages('#party .band img');
        assert.equal(new Set(await page.locator('#party .band img').evaluateAll(imgs => imgs.map(img => img.src))).size, 3);
        await page.locator('#again').tap();
      }
      assert.equal(seen.size, 20, 'Real questions expose all 20 characters');
      await page.locator('#read').tap();
      assert(await page.evaluate(() => mediaCalls.speech.length) > 0);
      const cancels = await page.evaluate(() => mediaCalls.cancels);
      await page.locator('#sound').tap();
      assert(await page.evaluate(() => mediaCalls.cancels) > cancels);
      await page.locator('#musicTrack').selectOption('mrfun');
      const layoutIssues = await page.evaluate(() => {
        const issues = [];
        if (document.documentElement.scrollWidth > innerWidth) issues.push('horizontal overflow');
        for (const el of document.querySelectorAll('.music-bar > *')) {
          const r = el.getBoundingClientRect();
          if (r.left < 0 || r.right > innerWidth + 1 || (innerWidth >= 900 && r.bottom > innerHeight + 1)) issues.push('music controls outside viewport');
        }
        return issues;
      });
      assert.deepEqual(layoutIssues, []);
      console.log(`PASS browser ${viewport.width}x${viewport.height}: 20 options, source selection, silence, stale playback, visibility, cast/images, stable counters, hands-on, advance and fit.`);
      await context.close();
    }
    // Check actual browser decoding independently of deterministic lifecycle spies.
    const context = await browser.newContext();
    await context.route(/^https?:/, route => route.abort());
    const page = await context.newPage();
    await page.goto(url);
    for (const char of characters) {
      await page.locator('#musicTrack').selectOption(char.id);
      const result = await page.evaluate(src => new Promise(resolve => {
        const audio = new Audio(src);
        const timer = setTimeout(() => finish(false), 10000);
        function finish(ok) { clearTimeout(timer); audio.onloadedmetadata = audio.onerror = null; resolve({ ok, paused: audio.paused, duration: audio.duration }); }
        audio.onloadedmetadata = () => finish(true);
        audio.onerror = () => finish(false);
        audio.load();
      }), char.audio);
      assert(result.ok && result.paused && result.duration > 0, `${char.id}: real audio decodes without playback`);
    }
    await context.close();
    assert.deepEqual(errors, []);
    console.log(`PASS real media: all 20 tracks decode without autoplay. Screenshots: ${output}`);
  } finally { await browser.close(); }
}
if (process.argv.includes('--browser')) browserChecks().catch(error => { console.error(error); process.exitCode = 1; });
