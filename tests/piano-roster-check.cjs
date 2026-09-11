"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ||
  "C:/Users/shohe/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const root = path.resolve(__dirname, "..");
const audioOnly = process.argv.includes("--audio-only");
const original = fs.readFileSync(path.join(root, "sprunki-piano-game.html"), "utf8");
const rosterContext = {};
vm.runInNewContext(fs.readFileSync(path.join(root, "sprunki-roster.js"), "utf8"), rosterContext);
const roster = JSON.parse(JSON.stringify(rosterContext.SprunkiRoster.characters));
const mods = JSON.parse(JSON.stringify(rosterContext.SprunkiRoster.modCharacters));
assert.equal(roster.length, 20);
for (const character of roster) {
  assert(fs.existsSync(path.join(root, character.file)));
  assert(fs.existsSync(path.join(root, character.audio)));
}
assert(!original.includes("setMusicSelection("), "Preview must not own the shared music transport");
const html = original.replace("      buildKeyboard();", `
      window.__rosterTest = { characters, pianoTimbre, startGame, resetGame, recordMelody,
        stopMelody, replayMelody, playInput, clockNow, songTime, selectSong, stopCharacterPreview,
        get state() { return state; }, get melody() { return melody; },
        get preview() { return characterPreview !== null; },
        clearBuffer() { audioBuffers.delete('black'); },
        strict(value) { selectedSong().strictTone = value; } };
      buildKeyboard();`);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ||
    "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true,
    args: ["--allow-file-access-from-files"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/sprunki-piano-game.html", route => route.fulfill({ body: html, contentType: "text/html; charset=utf-8" }));
    await page.goto(pathToFileURL(path.join(root, "sprunki-piano-game.html")).href);
    await page.evaluate(() => {
      window.__sources = [];
      const engine = window.MoonAudio;
      const unlock = engine.unlock;
      engine.unlock = async () => {
        const context = await unlock();
        if (!context.__observed) {
          context.__observed = true;
          const create = context.createBufferSource.bind(context);
          context.createBufferSource = () => {
            const source = create(), entry = { stopped: false };
            const start = source.start.bind(source), stop = source.stop.bind(source);
            source.start = (...args) => {
              Object.assign(entry, { args, loop: source.loop, duration: source.buffer.duration });
              window.__sources.push(entry);
              return start(...args);
            };
            source.stop = (...args) => { entry.stopped = true; return stop(...args); };
            return source;
          };
        }
        return context;
      };
    });
    assert.equal(await page.evaluate(() => window.__sources.length), 0, "No automatic preview");
    await page.locator("#menuButton").click();
    assert.deepEqual(await page.locator(".character-button").evaluateAll(buttons => buttons.map(b => b.dataset.character)), [...roster, ...mods].map(c => c.id));
    for (const character of roster) {
      const button = page.locator(`[data-character="${character.id}"]`);
      await button.click();
      assert.equal(await button.getAttribute("aria-pressed"), "true");
      assert.equal(await button.getAttribute("aria-label"), character.name);
      assert.equal(await page.locator("#heroFace").getAttribute("src"), character.file);
      assert.equal(await page.locator('.character-button[aria-pressed="true"]').count(), 1);
      const timbres = await page.evaluate(() => {
        const t = window.__rosterTest;
        t.strict(false); const normal = t.pianoTimbre();
        t.strict(true); const strict = t.pianoTimbre();
        t.strict(false); return [normal, strict];
      });
      for (const timbre of timbres) for (const key of ["detune", "highDetune", "filter", "decay", "gain"]) assert(Number.isFinite(timbre[key]));
    }
    await page.waitForFunction(() => window.__rosterTest.preview);
    const source = await page.evaluate(() => window.__sources.at(-1));
    assert.equal(source.loop, false);
    assert.equal(source.args.length, 1, "Full original sample, no .32-second truncation or offset");
    assert(source.duration > 0.332);
    await page.locator('[data-character="oren"]').click();
    assert(await page.evaluate(() => !window.__rosterTest.preview && window.__sources.at(-1).stopped));

    // Retain native stop(): it throws when our injected start failure leaves an unstarted source.
    await page.evaluate(() => {
      const context = window.MoonAudio.getContext();
      const createSource = context.createBufferSource, createGain = context.createGain;
      const fault = window.__previewFault = { thrown: false, sourceDisconnects: 0, gainDisconnects: 0 };
      fault.restore = () => { context.createBufferSource = createSource; context.createGain = createGain; };
      context.createBufferSource = function() {
        const source = createSource.call(this), disconnect = source.disconnect.bind(source);
        fault.source = source;
        source.disconnect = () => { fault.sourceDisconnects++; disconnect(); };
        source.start = () => {
          fault.lateEnd = source.onended;
          fault.thrown = true;
          throw new Error("Injected preview start failure");
        };
        return source;
      };
      context.createGain = function() {
        const gain = createGain.call(this), disconnect = gain.disconnect.bind(gain);
        gain.disconnect = () => { fault.gainDisconnects++; disconnect(); };
        return gain;
      };
    });
    try {
      await page.locator('[data-character="black"]').click();
      await page.waitForFunction(() => window.__previewFault.thrown);
      assert.deepEqual(await page.evaluate(() => ({
        owned: window.__rosterTest.preview,
        source: window.__previewFault.sourceDisconnects,
        gain: window.__previewFault.gainDisconnects,
        endedCleared: window.__previewFault.source.onended === null
      })), { owned: false, source: 1, gain: 1, endedCleared: true });
    } finally {
      await page.evaluate(() => window.__previewFault.restore());
    }
    await page.evaluate(async () => {
      const t = window.__rosterTest;
      t.stopCharacterPreview(); t.stopCharacterPreview();
      t.resetGame(); t.resetGame();
      await t.startGame();
    });
    assert(await page.evaluate(() => window.__rosterTest.state.running), "Start recovers after failed preview and repeated Reset/cleanup");
    await page.evaluate(() => window.__rosterTest.resetGame());
    await page.locator('[data-character="black"]').click();
    await page.waitForFunction(() => window.__rosterTest.preview);
    const recovery = await page.evaluate(() => {
      window.__previewFault.lateEnd();
      return { owned: window.__rosterTest.preview, source: window.__sources.at(-1),
        disconnects: [window.__previewFault.sourceDisconnects, window.__previewFault.gainDisconnects] };
    });
    assert(recovery.owned && !recovery.source.stopped, "Recovery preview plays and survives a stale failed-source end");
    assert.equal(recovery.source.loop, false);
    assert.equal(recovery.source.args.length, 1);
    assert.deepEqual(recovery.disconnects, [1, 1], "Failed-source cleanup is idempotent");
    await page.evaluate(() => {
      window.__rosterTest.stopCharacterPreview(); window.__rosterTest.stopCharacterPreview();
      window.__rosterTest.resetGame();
    });
    assert(await page.evaluate(() => !window.__rosterTest.preview && window.__sources.at(-1).stopped));
    console.log("PASS preview start fault: disconnected nodes, cleared ownership, idempotent cleanup/reset, start and playback recovery");

    for (const viewport of (audioOnly ? [] : [{ width: 768, height: 1024 }, { width: 1024, height: 768 },
      { width: 1366, height: 768 }, { width: 390, height: 844 }])) {
      await page.setViewportSize(viewport);
      for (const character of roster) {
        const button = page.locator(`[data-character="${character.id}"]`);
        await button.scrollIntoViewIfNeeded();
        const box = await button.boundingBox();
        assert(box.width >= 44 && box.height >= 44);
        assert(box.x >= 0 && box.x + box.width <= viewport.width + 1);
        assert(box.y >= 0 && box.y + box.height <= viewport.height + 1);
      }
      assert(await page.locator(".character-button img").evaluateAll(images => images.every(i => i.complete && i.naturalWidth > 0)));
    }
    await page.setViewportSize({ width: 1024, height: 768 });
    if (!audioOnly) await page.screenshot({ path: path.join(os.tmpdir(), "piano-roster-ipad.png") });

    const black = page.locator('[data-character="black"]');
    for (const action of ["mute", "hidden", "music", "start", "record", "song"]) {
      await black.click();
      await page.waitForFunction(() => window.__rosterTest.preview);
      if (action === "mute") await page.locator("#soundButton").evaluate(button => button.click());
      if (action === "hidden") await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        document.dispatchEvent(new Event("visibilitychange"));
        delete document.hidden;
      });
      if (action === "music") await page.evaluate(() => window.MoonAudio.setMusicSelection(["oren"]));
      if (action === "start") await page.evaluate(() => window.__rosterTest.startGame());
      if (action === "record") await page.evaluate(() => window.__rosterTest.recordMelody());
      if (action === "song") await page.evaluate(() => window.__rosterTest.selectSong("twinkle"));
      assert(await page.evaluate(() => !window.__rosterTest.preview), action + " cancels preview");
      if (action === "mute") {
        const count = await page.evaluate(() => window.__sources.length);
        await black.click();
        assert.equal(await page.evaluate(() => window.__sources.length), count, "Muted selection is silent");
        await page.locator("#soundButton").evaluate(button => button.click());
      }
      await page.evaluate(() => { window.MoonAudio.stopMusic(); window.__rosterTest.resetGame(); });
      await page.locator("#menuButton").evaluate(button => button.click());
    }
    // A selection change invalidates both decoding and unlocking still in flight.
    for (const method of ["loadTrack", "unlock"]) {
      await page.evaluate(method => {
        window.__rosterTest.clearBuffer();
        window.__savedMethod = window.MoonAudio[method];
        window.MoonAudio[method] = (...args) => new Promise(resolve => {
          window.__releasePreview = async () => resolve(await window.__savedMethod(...args));
        });
      }, method);
      await black.click();
      await page.waitForFunction(() => typeof window.__releasePreview === "function");
      await page.locator('[data-character="sky"]').click();
      const count = await page.evaluate(() => window.__sources.length);
      await page.evaluate(async method => {
        window.MoonAudio[method] = window.__savedMethod;
        await window.__releasePreview(); delete window.__releasePreview;
      }, method);
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => window.__sources.length), count, "Late " + method + " cannot revive preview");
    }
    await page.evaluate(async () => {
      await window.__rosterTest.startGame();
      const context = window.MoonAudio.getContext(), now = context.currentTime;
      Object.defineProperty(context, "currentTime", { configurable: true, get: () => now });
    });
    const beforePreview = await page.evaluate(() => ({
      state: JSON.stringify(window.__rosterTest.state),
      time: window.__rosterTest.songTime(), clock: window.__rosterTest.clockNow()
    }));
    await black.click();
    await page.waitForFunction(() => window.__rosterTest.preview);
    assert.deepEqual(await page.evaluate(() => ({
      state: JSON.stringify(window.__rosterTest.state),
      time: window.__rosterTest.songTime(), clock: window.__rosterTest.clockNow()
    })), beforePreview, "Preview does not move the piano clock or mutate the game state");
    await page.evaluate(async () => {
      delete window.MoonAudio.getContext().currentTime;
      await window.__rosterTest.recordMelody();
      window.__rosterTest.playInput("C4");
      window.__rosterTest.stopMelody();
    });
    const recorded = await page.evaluate(() => JSON.stringify(window.__rosterTest.melody.events));
    await black.click();
    await page.waitForFunction(() => window.__rosterTest.preview);
    assert.equal(await page.evaluate(() => JSON.stringify(window.__rosterTest.melody.events)), recorded);
    await page.evaluate(() => window.__rosterTest.replayMelody());
    assert(await page.evaluate(() => !window.__rosterTest.preview));
    await page.evaluate(() => window.__rosterTest.stopMelody());
    assert.deepEqual(errors, []);
    console.log(`PASS piano roster: ${roster.length + mods.length} character IDs, canonical names/timbres, full Black one-shot, cancellation and async races${audioOnly ? " (audio-only; image/layout checks skipped)" : ", iPad/mobile touch targets and images"}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
