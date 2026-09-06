"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ||
  "C:/Users/shohe/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "sprunki-piano-game.html"), "utf8");
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]).filter(Boolean);
for (const script of scripts) new vm.Script(script, { filename: "sprunki-piano-game.html" });
const gameScript = scripts.find(script => script.includes("const SONGS ="));
const chartFixture = gameScript.slice(gameScript.indexOf("const SONGS ="), gameScript.indexOf("const SONG_CATEGORIES =")) +
  gameScript.slice(gameScript.indexOf("function makeChart()"), gameScript.indexOf("function resizeCanvas()"));
const noteCounts = vm.runInNewContext(`${chartFixture}
  let currentSong;
  function selectedSong() { return currentSong; }
  Object.fromEntries(SONGS.map(song => { currentSong = song; return [song.id, makeChart().length]; }));`);
assert.equal(Object.keys(noteCounts).length, 18);
console.log("Song noteCounts from actual makeChart(): " + JSON.stringify(noteCounts));
const screenshots = process.env.PIANO_SCREENSHOT_DIR || path.join(root, "output/playwright/piano-fun");
fs.mkdirSync(screenshots, { recursive: true });

// Observe the real Web Audio scheduler without replacing its sound generation.
function observeAudio() {
  window.__audioLog = [];
  window.__inputTimes = [];
  window.__rankings = [];
  window.MoonRanking = { complete: value => window.__rankings.push(value) };
  window.addEventListener("keydown", event => {
    if (!event.repeat) window.__inputTimes.push({ code: event.code, at: performance.now() });
  });
  const proto = (window.AudioContext || window.webkitAudioContext).prototype;
  const create = proto.createOscillator;
  const resume = proto.resume;
  proto.resume = function () {
    if (window.__holdResume) return new Promise(resolve => {
      window.__releaseResume = () => resume.call(this).then(resolve);
    });
    return resume.call(this);
  };
  proto.createOscillator = function () {
    window.__audioContext = this;
    const oscillator = create.call(this);
    const entry = { cancelled: false, ended: false };
    const start = oscillator.start.bind(oscillator);
    const stop = oscillator.stop.bind(oscillator);
    oscillator.start = time => {
      Object.assign(entry, { at: time, frequency: oscillator.frequency.value, type: oscillator.type });
      window.__audioLog.push(entry);
      return start(time);
    };
    oscillator.stop = time => {
      if (time === undefined) entry.cancelled = true;
      else entry.endAt = time;
      return stop(time);
    };
    oscillator.addEventListener("ended", () => { entry.ended = true; });
    return oscillator;
  };
}

async function runViewport(browser, viewport, embedded) {
  const context = await browser.newContext({ viewport, hasTouch: true });
  await context.addInitScript(observeAudio);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const url = pathToFileURL(path.join(root, embedded ? "index.html" : "sprunki-piano-game.html"));
  if (embedded) url.search = "?game=piano";
  await page.goto(url.href);
  let frame = page.mainFrame();
  if (embedded) {
    await page.waitForFunction(() => document.querySelector("#gameFrame")?.src.includes("sprunki-piano-game.html"));
    const handle = await page.$("#gameFrame");
    frame = await handle.contentFrame();
  }
  await frame.waitForSelector('.piano-key[data-note="C4"]');
  const $ = selector => frame.locator(selector);
  const status = () => $("#melodyStatus").textContent();
  const audio = () => frame.evaluate(() => window.__audioLog);
  const clearLog = () => frame.evaluate(() => { window.__audioLog = []; window.__inputTimes = []; });
  const isIdle = () => frame.waitForFunction(() => document.querySelector("#melodyStop").disabled);
  async function assertQuiet() {
    await page.waitForTimeout(180);
    assert.equal(await $(".piano-key.is-active").count(), 0, "No stuck illuminated keys");
    assert((await audio()).every(note => note.cancelled || note.ended), "No surviving scheduled/live oscillators");
  }
  async function assertFits() {
    const geometry = await frame.evaluate(() => {
      const rect = element => {
        const { x, y, width, height, bottom, right } = element.getBoundingClientRect();
        return { x, y, width, height, bottom, right };
      };
      return { width: innerWidth, height: innerHeight,
        scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight,
        controls: [...document.querySelectorAll(".melody-controls button")].map(rect),
        piano: rect(document.querySelector("#piano")), stage: rect(document.querySelector("#stage")),
        melody: rect(document.querySelector(".melody-controls")),
        embedded: document.documentElement.classList.contains("is-embedded") };
    });
    assert.equal(geometry.embedded, embedded);
    assert(geometry.scrollWidth <= geometry.width + 1, JSON.stringify(geometry));
    assert(geometry.scrollHeight <= geometry.height + 1, JSON.stringify(geometry));
    assert(geometry.stage.height >= 180, "Keep playable note lane");
    assert(geometry.stage.bottom <= geometry.melody.y + 1, "Lane and recorder do not overlap");
    assert(geometry.melody.bottom <= geometry.piano.y + 1, "Recorder and keys do not overlap");
    assert(geometry.piano.bottom <= geometry.height + 1);
    for (const control of geometry.controls) {
      assert(control.width >= 44 && control.height >= 44, "Touch target at least 44px");
      assert(control.x >= 0 && control.right <= geometry.width);
    }
  }

  await assertFits();
  assert(await $("#melodyPlay").isDisabled(), "Empty take cannot play");
  await $("#melodyRecord").click();
  await $("#melodyStop").click();
  assert(await $("#melodyPlay").isDisabled(), "Empty recording is safe");
  await $("#melodyRecord").click();
  await clearLog();
  await page.waitForTimeout(180);
  await page.keyboard.press("a");
  await page.waitForTimeout(210);
  await page.keyboard.press("s");
  await page.waitForTimeout(340);
  await page.keyboard.press("d");
  await page.waitForTimeout(150);
  await page.keyboard.down("f");
  await page.keyboard.down("h");
  await page.keyboard.down("h");
  await page.keyboard.up("h");
  await page.keyboard.up("f");
  assert.match(await status(), /5おん/, "Repeat keydown is not a new note");
  assert.equal(await $("#startButton").textContent(), "START", "Recording never auto-starts rhythm game");
  const take = (await audio()).filter((_, index) => index % 2 === 0);
  const inputTimes = await frame.evaluate(() => window.__inputTimes);
  assert.equal(take.length, 5);
  await $("#melodyStop").click();
  await assertQuiet();
  await assertFits();
  const base = `${viewport.width}x${viewport.height}${embedded ? "-embedded" : ""}`;
  await page.screenshot({ path: path.join(screenshots, `${base}-melody.png`) });
  const pixels = await frame.evaluate(() => {
    const canvas = document.querySelector("#noteCanvas");
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let colored = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] && Math.max(data[i], data[i + 1], data[i + 2]) > 150) colored++;
    return colored;
  });
  assert(pixels > 400, "Melody canvas has visible notes and labels");

  await clearLog();
  await $("#melodyPlay").click();
  await frame.waitForFunction(() => window.__audioLog.length === 10);
  const replay = (await audio()).filter((_, index) => index % 2 === 0);
  assert.deepEqual(replay.map(note => note.frequency), take.map(note => note.frequency));
  assert.deepEqual(replay.map(note => note.type), take.map(note => note.type));
  for (let i = 0; i < replay.length; i++) {
    const scheduledDelta = (replay[i].at - replay[0].at) * 1000;
    assert(Math.abs(scheduledDelta - (inputTimes[i].at - inputTimes[0].at)) < 12,
      `Note ${i} onset matches captured timing: ${scheduledDelta}`);
  }
  await page.waitForTimeout(85);
  assert(await $(".piano-key.is-active").count() > 0, "Replay lights the played keys");
  await page.keyboard.press("a");
  assert.equal((await audio()).length, 10, "Live keys do not layer over playback or record themselves");
  await page.screenshot({ path: path.join(screenshots, `${base}-replay.png`) });
  await isIdle();
  await assertQuiet();
  await page.waitForTimeout(400);
  assert.equal((await audio()).length, 10, "Playback ends once without a loop");
  assert.match(await status(), /5 おん/, "Replay does not modify the take");

  // Every exit cancels already scheduled notes as well as visual timers.
  for (const selector of ["#melodyStop", "#startButton", "#pauseButton", "#resetButton", "#songButton", "#menuButton", "#soundButton"]) {
    await clearLog();
    await $("#melodyPlay").click();
    await frame.waitForFunction(() => window.__audioLog.length === 10);
    await $(selector).click();
    await isIdle();
    await assertQuiet();
    assert.equal((await audio()).length, 10, `${selector} cancels deferred playback`);
    if (selector === "#songButton") await $("#songPickerClose").click();
    if (selector === "#menuButton") await $("#menuCloseButton").click();
    if (selector === "#soundButton") await $("#soundButton").click();
  }
  for (const event of ["blur", "pagehide", "visibilitychange"]) {
    await clearLog();
    await $("#melodyPlay").click();
    await frame.waitForFunction(() => window.__audioLog.length === 10);
    await frame.evaluate(type => {
      if (type === "visibilitychange") {
        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        document.dispatchEvent(new Event(type));
        delete document.hidden;
      } else window.dispatchEvent(new Event(type));
    }, event);
    await isIdle();
    await assertQuiet();
  }

  // A resume promise resolved after Stop must not resurrect a stopped take.
  await frame.evaluate(async () => {
    await window.__audioContext.suspend();
    window.__holdResume = true;
  });
  await clearLog();
  await $("#melodyPlay").click();
  await $("#melodyStop").click();
  await frame.evaluate(async () => { window.__holdResume = false; await window.__releaseResume(); });
  await assertQuiet();
  assert.equal((await audio()).length, 0, "Cancelled async audio resume cannot start playback");

  await $("#melodyRecord").click();
  await clearLog();
  const c = await $('.piano-key[data-note="C4"]').boundingBox();
  const e = await $('.piano-key[data-note="E4"]').boundingBox();
  const cSharp = await $('.piano-key[data-note="C#4"]').boundingBox();
  await page.mouse.click(cSharp.x + cSharp.width / 2, cSharp.y + 15);
  assert.match(await status(), /1おん/, "Mouse compatibility events do not duplicate notes");
  const session = await context.newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [
    { x: c.x + c.width / 2, y: c.y + c.height - 15, id: 1 },
    { x: e.x + e.width / 2, y: e.y + e.height - 15, id: 2 }
  ] });
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  assert.match(await status(), /3おん/, "Simultaneous touch chord preserves both notes");
  assert.equal((await audio()).length, 6);
  await $("#melodyStop").click();
  await assertQuiet();
  await session.detach();

  await $("#melodyRecord").click();
  await frame.evaluate(() => {
    for (let i = 0; i < 140; i++) {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA" }));
      window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyA" }));
    }
  });
  await isIdle();
  assert.match(await status(), /128 おん/, "Recording is bounded at 128 events");

  await page.clock.install();
  await $("#melodyRecord").click();
  await page.keyboard.press("s");
  await page.clock.fastForward(20050);
  await isIdle();
  assert.match(await status(), /1 おん/, "20-second automatic stop retains take");
  await $("#melodyRecord").click();
  await page.clock.fastForward(20050);
  assert(await $("#melodyPlay").isDisabled(), "Silent recording also has a duration limit");

  // Existing song selection, pause/resume, scoring and the optional one-shot ranking hook.
  await frame.evaluate(() => {
    window.__rankings = [];
    window.MoonRanking = { complete: value => window.__rankings.push(value) };
  });
  await $("#songButton").click();
  const chosen = await $(".song-card").nth(1).getAttribute("data-song");
  await $(".song-card").nth(1).click();
  await $("#startButton").click();
  await $("#pauseButton").click();
  assert.equal(await $("#pauseButton").textContent(), "RESUME");
  await $("#pauseButton").click();
  assert.equal(await $("#pauseButton").textContent(), "PAUSE");
  await page.clock.fastForward(240000);
  await page.clock.runFor(50);
  assert(await $("#resultOverlay").evaluate(element => element.classList.contains("is-live")));
  const results = await frame.evaluate(() => window.__rankings);
  assert.equal(results.length, 1);
  assert.equal(results[0].game, "piano");
  assert.equal(results[0].mode, chosen);
  assert(results[0].runId);
  assert(results[0].metrics.noteCount > 0);
  assert.equal(results[0].metrics.miss, results[0].metrics.noteCount);
  assert.deepEqual(Object.keys(results[0].metrics).sort(), ["good", "great", "maxCombo", "miss", "noteCount", "ok", "perfect"]);
  await page.clock.runFor(100);
  assert.equal(await frame.evaluate(() => window.__rankings.length), 1, "One ranking per round");
  await $("#startButton").click();
  await page.clock.fastForward(240000);
  await page.clock.runFor(50);
  const again = await frame.evaluate(() => window.__rankings);
  assert.equal(again.length, 2);
  assert.notEqual(again[0].runId, again[1].runId, "New round has a new stable ID");
  assert.deepEqual(errors, [], "No uncaught runtime errors");
  await context.close();
  console.log(`PASS ${base}: real file:// Chrome, recording/replay timing, chords, limits, cleanup, layout, ranking`);
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ||
    "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true,
    args: ["--allow-file-access-from-files", "--autoplay-policy=no-user-gesture-required"] });
  try {
    await runViewport(browser, { width: 1024, height: 600 }, true);
    await runViewport(browser, { width: 1180, height: 820 }, false);
    console.log(`PASS inline Node syntax (${scripts.length} script); screenshots: ${screenshots}`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
