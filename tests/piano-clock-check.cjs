"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ||
  "C:/Users/shohe/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const root = path.resolve(__dirname, "..");
const original = fs.readFileSync(path.join(root, "sprunki-piano-game.html"), "utf8");
assert(!/new\s+(?:\([^\n]*AudioContext|AudioContext)/.test(original), "Piano never owns a second context");
assert(original.indexOf('src="games-audio-manifest.js') < original.indexOf('src="games-audio.js'));
const html = original.replace("      buildKeyboard();", `
      window.__pianoTest = { get state() { return state; }, get melody() { return melody; },
        startGame, pauseGame, resetGame, clockNow, songTime, playInput, recordMelody,
        replayMelody, stopMelody, get voices() { return activeVoices.size; },
        windows: [PERFECT_MS, GREAT_MS, GOOD_MS, OK_MS, MISS_GRACE_MS] };
      buildKeyboard();`);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ||
    "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true,
    args: ["--allow-file-access-from-files", "--autoplay-policy=no-user-gesture-required"] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(7000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/sprunki-piano-game.html", route => route.fulfill({ body: html, contentType: "text/html; charset=utf-8" }));
    await page.goto(pathToFileURL(path.join(root, "sprunki-piano-game.html")).href);
    assert.deepEqual(await page.evaluate(() => window.__pianoTest.windows), [28, 55, 90, 135, 150]);
    const failure = await page.evaluate(async () => {
      const t = window.__pianoTest, engine = window.MoonAudio;
      window.__realUnlock = engine.unlock;
      engine.unlock = async () => { throw new Error("Test unlock rejection"); };
      await t.startGame();
      return { running: t.state.running, count: t.state.chart.length, time: t.songTime() };
    });
    assert.deepEqual(failure, { running: false, count: 0, time: 0 }, "Rejected unlock cannot advance the chart");
    const cancelled = await page.evaluate(async () => {
      const t = window.__pianoTest, engine = window.MoonAudio;
      engine.unlock = () => new Promise(resolve => { window.__release = resolve; });
      const pending = t.startGame();
      t.resetGame();
      engine.unlock = window.__realUnlock;
      window.__release(await engine.unlock());
      await pending;
      return t.state.running;
    });
    assert.equal(cancelled, false, "Late unlock cannot resurrect Reset");
    await page.evaluate(async () => {
      await window.__pianoTest.startGame();
      const ctx = window.MoonAudio.getContext();
      window.__realContext = ctx;
      window.__testAudioTime = ctx.currentTime;
      Object.defineProperty(ctx, "currentTime", { configurable: true, get: () => window.__testAudioTime });
    });
    const before = await page.evaluate(() => window.__pianoTest.songTime());
    await page.waitForTimeout(180);
    assert.equal(await page.evaluate(() => window.__pianoTest.songTime()), before, "Wall time cannot advance a frozen audio clock");
    await page.evaluate(() => { window.__testAudioTime += (900 - window.__pianoTest.songTime()) / 1000; });
    await page.waitForFunction(() => document.querySelector('[data-note="C4"]').classList.contains("is-approaching"));
    await page.keyboard.press("a");
    assert.equal(await page.evaluate(() => window.__pianoTest.state.perfect), 1, "Keyboard mapping scores at the audio-clock hit time");
    const paused = await page.evaluate(() => {
      const t = window.__pianoTest;
      t.pauseGame();
      const position = t.songTime();
      window.__testAudioTime += 8;
      return [position, t.songTime(), t.voices];
    });
    assert.equal(paused[0], paused[1]);
    assert.equal(paused[2], 0);
    await page.evaluate(() => window.__pianoTest.startGame());
    assert(Math.abs(await page.evaluate(() => window.__pianoTest.songTime()) - paused[0]) < 0.001);
    await page.evaluate(() => window.MoonAudio.suspend());
    assert(await page.evaluate(() => window.__pianoTest.state.paused));
    await page.waitForTimeout(100);
    assert(await page.evaluate(() => window.__pianoTest.state.paused), "Foreground never resumes automatically");
    const restored = await page.evaluate(async () => {
      const t = window.__pianoTest;
      const position = t.songTime();
      window.dispatchEvent(new Event("pagehide"));
      await t.startGame();
      return { delta: t.songTime() - position, replaced: window.MoonAudio.getContext() !== window.__realContext };
    });
    assert(restored.replaced, "Pagehide-disposed shared context is replaced by engine");
    assert(Math.abs(restored.delta) < 40, "New context preserves the paused chart position");
    await page.evaluate(async () => {
      const t = window.__pianoTest;
      await t.recordMelody();
      t.playInput("C4");
      t.stopMelody();
      const ctx = window.MoonAudio.getContext();
      window.__testAudioTime = ctx.currentTime;
      Object.defineProperty(ctx, "currentTime", { configurable: true, get: () => window.__testAudioTime });
      await t.replayMelody();
    });
    await page.waitForTimeout(220);
    assert.equal(await page.locator(".piano-key.is-active").count(), 0, "Frozen audio clock holds replay visuals before the scheduled onset");
    await page.evaluate(() => { window.__testAudioTime += 0.07; });
    await page.waitForFunction(() => document.querySelector('[data-note="C4"]').classList.contains("is-active"));
    await page.evaluate(() => { window.__testAudioTime += 2; });
    await page.waitForFunction(() => window.__pianoTest.melody.mode === "idle");
    assert.equal(await page.evaluate(() => window.__pianoTest.voices), 0, "Replay end uses audio time and clears its scheduled voices");
    await page.locator("#soundButton").click();
    await page.evaluate(async () => {
      window.__pianoTest.resetGame();
      window.MoonAudio.unlock = async () => { throw new Error("No audio device"); };
      await window.__pianoTest.startGame();
    });
    assert(await page.evaluate(() => window.__pianoTest.state.running), "Muted gameplay works without audio");
    const silentAt = await page.evaluate(() => window.__pianoTest.songTime());
    await page.waitForTimeout(100);
    assert(await page.evaluate(() => window.__pianoTest.songTime()) > silentAt + 50);
    await page.keyboard.press("a");
    assert.equal(await page.evaluate(() => window.__pianoTest.voices), 0, "Muted input emits no synth voices");
    const fit = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert(fit.scroll <= fit.width + 1, "Mobile controls fit");
    fs.mkdirSync(path.join(root, "output/playwright/piano-fun"), { recursive: true });
    await page.screenshot({ path: path.join(root, "output/playwright/piano-fun/mobile-clock.png") });
    assert.deepEqual(errors, []);
    console.log("PASS piano audio-clock: rejected/cancelled unlock, frozen clock, exact hit, pause/resume, context replacement, silent fallback, mobile layout");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
