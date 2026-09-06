// Run with the bundled Node; PLAYWRIGHT_MODULE and CHROME_EXECUTABLE override defaults.
// No app hooks, source rewriting, synthetic DOM dispatch, or app geometry helpers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
let url;
const server = http.createServer((request, response) => {
  const target = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://local').pathname));
  if (!target.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  fs.readFile(target, (error, bytes) => {
    if (error) { response.writeHead(404).end(); return; }
    const type = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg',
      '.webp': 'image/webp', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' }[path.extname(target)];
    response.writeHead(200, { 'Content-Type': type || 'application/octet-stream' }).end(bytes);
  });
});
const output = path.join(root, 'output', 'moon-audit');
// Optional MOON_AUDIT_VIEWPORT=568x320 limits a diagnosis run; unset runs the full matrix.
const viewports = [[320, 568], [375, 667], [390, 844], [568, 320], [740, 360], [844, 390], [1280, 800]]
  .filter(size => !process.env.MOON_AUDIT_VIEWPORT || size.join('x') === process.env.MOON_AUDIT_VIEWPORT);
assert.ok(viewports.length, 'MOON_AUDIT_VIEWPORT must name a viewport in the audit matrix');
const report = { viewports: [], failures: [], checks: 0 };
const distance = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const litFraction = degrees => (1 - Math.cos(degrees * Math.PI / 180)) / 2;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function check(ok, kind, context, details) {
  report.checks++;
  if (!ok) report.failures.push({ kind, context, details });
}

async function state(page) {
  return page.evaluate(() => ({
    degrees: Number(document.querySelector('#space').getAttribute('aria-valuenow')),
    name: document.querySelector('#phaseName').textContent,
    message: document.querySelector('#phaseMessage').textContent,
    spoken: document.querySelector('#phaseSummary').getAttribute('aria-label'),
    slider: document.querySelector('#space').getAttribute('aria-valuetext'),
    selected: [...document.querySelectorAll('.phase-choice')].findIndex(b => b.getAttribute('aria-pressed') === 'true')
  }));
}

async function moonPixels(page) {
  return page.locator('#space').evaluate(canvas => {
    const w = canvas.width, h = canvas.height, bounds = canvas.getBoundingClientRect();
    const sx = w / bounds.width, sy = h / bounds.height;
    const data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    const mask = new Uint8Array(w * h), candidates = [];
    // Neutral illuminated connected components, without an assumed orbit location.
    for (let i = 0; i < mask.length; i++) {
      const p = i * 4, r = data[p], g = data[p + 1], b = data[p + 2];
      mask[i] = r > 55 && Math.abs(r - g) < 10 && b > r * .92 && b < r * 1.02 ? 1 : 0;
    }
    for (let start = 0; start < mask.length; start++) {
      if (!mask[start]) continue;
      const pending = [start]; mask[start] = 0;
      let count = 0, minX = w, minY = h, maxX = 0, maxY = 0;
      while (pending.length) {
        const i = pending.pop(), x = i % w, y = Math.floor(i / w);
        count++; minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        for (const n of [x ? i - 1 : -1, x + 1 < w ? i + 1 : -1,
          y ? i - w : -1, y + 1 < h ? i + w : -1]) {
          if (n >= 0 && mask[n]) { mask[n] = 0; pending.push(n); }
        }
      }
      const width = (maxX - minX + 1) / sx, height = (maxY - minY + 1) / sy;
      if (count / sx / sy > 35 && height > 12 && height / width > 1.4 && height / width < 2.8) {
        candidates.push({ count: count / sx / sy, x: (maxX + 1) / sx,
          y: (minY + maxY + 1) / (2 * sy), radius: height / 2, width, height });
      }
    }
    candidates.sort((a, b) => b.count - a.count);
    if (!candidates.length) throw new Error('No recognizable sun-facing lunar half-disk in canvas pixels');
    return { ...candidates[0], box: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } };
  });
}

async function calibrate(page) {
  const points = [];
  for (const index of [0, 4, 8, 12]) {
    await page.locator('.phase-choice').nth(index).click();
    points.push(await moonPixels(page));
  }
  // Fit opposite observed cardinal centers. No CSS ratios or production radii.
  const [left, bottom, right, top] = points;
  const cx = (left.x + right.x) / 2, cy = (top.y + bottom.y) / 2;
  const rx = (right.x - left.x) / 2, ry = (bottom.y - top.y) / 2;
  assert.ok(rx > 20 && ry > 20 && Math.abs(rx - ry) < 3, `raster cardinals describe a circular orbit: ${JSON.stringify(points)}`);
  return { cx, cy, radius: (rx + ry) / 2, moonRadius: left.radius, box: left.box };
}

function point(g, degrees) {
  const radians = degrees * Math.PI / 180;
  return { x: g.box.x + g.cx - Math.cos(radians) * g.radius,
    y: g.box.y + g.cy + Math.sin(radians) * g.radius };
}

async function visibility(page, moon) {
  return page.evaluate(m => {
    const canvas = document.querySelector('#space'), bad = [];
    const cx = m.box.x + m.x, cy = m.box.y + m.y;
    // Interior disk points catch both complete and partial DOM occlusion.
    for (const scale of [0, .5, .9]) for (let i = 0; i < (scale ? 16 : 1); i++) {
      const x = cx + Math.cos(i * Math.PI / 8) * m.radius * scale;
      const y = cy + Math.sin(i * Math.PI / 8) * m.radius * scale;
      const hit = document.elementFromPoint(x, y);
      if (hit !== canvas) bad.push({ x, y, hit: hit ? `${hit.tagName}#${hit.id}.${hit.className}` : null,
        text: hit?.textContent?.trim().slice(0, 50) });
    }
    const controls = [...document.querySelectorAll('.scene-actions button, .scene-actions a')];
    const intersections = controls.filter(el => {
      const r = el.getBoundingClientRect();
      return r.width && r.height && Math.hypot(cx - Math.max(r.left, Math.min(cx, r.right)),
        cy - Math.max(r.top, Math.min(cy, r.bottom))) < m.radius;
    }).map(el => ({ text: el.textContent.trim(), rect: el.getBoundingClientRect().toJSON() }));
    return { bad, intersections };
  }, moon);
}

async function phasePixels(page) {
  return page.locator('#phaseMoon').evaluate(canvas => {
    const w = canvas.width, h = canvas.height;
    const data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    let total = 0, bright = 0, left = 0, right = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] < 220) continue;
      total++;
      if (data[i] > 40) { bright++; if (x < w / 2) left++; else right++; }
    }
    return { total, fraction: bright / total, left, right };
  });
}

async function inspect(page, g, context, expectedDegrees, semantics = true) {
  const s = await state(page), moon = await moonPixels(page), visible = await visibility(page, moon);
  const radians = expectedDegrees * Math.PI / 180;
  const expected = { x: g.cx - Math.cos(radians) * g.radius, y: g.cy + Math.sin(radians) * g.radius };
  check(distance(s.degrees, expectedDegrees) <= 1.5, 'input-angle', context, { expectedDegrees, ...s });
  check(Math.hypot(moon.x - expected.x, moon.y - expected.y) <= 3, 'orbital-pixels', context, { moon, expected });
  check(visible.bad.length === 0 && visible.intersections.length === 0, 'moon-occluded', context, visible);
  const pixels = await phasePixels(page), fraction = litFraction(expectedDegrees);
  check(pixels.total > 100 && Math.abs(pixels.fraction - fraction) < .05,
    'earth-phase-pixels', context, { expected: fraction, pixels });
  if (fraction > .05 && fraction < .95) {
    check(expectedDegrees < 180 ? pixels.right > pixels.left : pixels.left > pixels.right,
      'earth-phase-side', context, { expectedDegrees, pixels });
  }
  if (semantics) {
    // Test physical claims, not a copy of the app's name-selection algorithm.
    const claims = [
      ['\u3057\u3093\u3052\u3064', fraction <= .01],
      ['\u3058\u3087\u3046\u3052\u3093', Math.abs(fraction - .5) <= .04 && expectedDegrees < 180],
      ['\u307e\u3093\u3052\u3064', fraction >= .99],
      ['\u304b\u3052\u3093', Math.abs(fraction - .5) <= .04 && expectedDegrees > 180]
    ];
    for (const [name, valid] of claims) {
      if (s.name === name) check(valid, 'summary-physical-claim', context, { ...s, fraction, pixels });
    }
    check(s.slider === s.name && !!s.spoken && s.spoken.includes(s.name), 'summary-accessibility', context, s);
    // Rounded public angles cannot establish exact equality; stay clear of fixed anchors
    // and classification boundaries when asserting the continuous name/selection state.
    const offNamedSample = g.namedAngles && g.namedAngles.every(angle => distance(angle, expectedDegrees) > 2);
    const boundaries = [0, 90, 180, 270, Math.acos(.98) * 180 / Math.PI, 360 - Math.acos(.98) * 180 / Math.PI];
    if (offNamedSample && boundaries.every(angle => distance(angle, expectedDegrees) > 2)) {
      const waxing = expectedDegrees < 180;
      const expectedName = fraction < .01
        ? (waxing ? '\u3057\u3093\u3052\u3064\u306e \u3059\u3053\u3057\u3042\u3068' : '\u3057\u3093\u3052\u3064\u306e \u3059\u3053\u3057\u307e\u3048')
        : (waxing ? '\u3075\u304f\u3089\u3080' : '\u304b\u3051\u3066\u3044\u304f') + (fraction < .5 ? '\u7d30\u3044\u6708' : '\u4e38\u3044\u6708');
      check(s.name === expectedName && s.selected === -1, 'continuous-name-selection', context, { ...s, expectedName });
    }
  }
  return { ...s, pixels, moon, occluded: visible.bad.length > 0 };
}

async function ready(page) {
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  await page.locator('.phase-choice').nth(15).waitFor();
  if (await page.locator('#voiceButton').getAttribute('aria-pressed') === 'true') await page.locator('#voiceButton').click();
}

async function recover(page) {
  await sleep(80);
  if (page.url() !== url) { await ready(page); return true; }
  if (await page.evaluate(() => !!document.fullscreenElement)) {
    await page.evaluate(() => document.exitFullscreen());
    await page.clock.runFor(200);
  }
  return false;
}

async function layout(page, context) {
  const result = await page.evaluate(() => {
    const rect = element => element.getBoundingClientRect().toJSON();
    const footer = document.querySelector('.scene-footer'), caption = footer?.querySelector('span');
    const problems = [];
    for (const selector of ['#phaseName', '#phaseMessage', '#quizPrompt', '#quizResult', '#quizNext', '.controls', '.scene-footer']) {
      const element = document.querySelector(selector);
      if (!element || !element.checkVisibility()) continue;
      const r = rect(element);
      if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) problems.push({ selector, reason: 'outside-viewport', rect: r });
      if (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1) problems.push({ selector, reason: 'content-overflow', rect: r });
      if (selector === '#phaseName' || selector === '#phaseMessage') {
        const parent = rect(document.querySelector('#phaseSummary'));
        if (r.top < parent.top - 1 || r.bottom > parent.bottom + 1) problems.push({ selector, reason: 'outside-summary', rect: r, parent });
      }
    }
    for (const button of document.querySelectorAll('.phase-choice, #quizOptions button')) {
      if (!button.checkVisibility()) continue;
      const parent = rect(button);
      for (const child of button.children) {
        const r = rect(child);
        if (r.left < parent.left - 1 || r.top < parent.top - 1 || r.right > parent.right + 1 || r.bottom > parent.bottom + 1) {
          problems.push({ selector: button.className || '#quizOptions button', reason: 'choice-content-overflow',
            text: button.textContent, child: child.tagName, rect: r, parent });
        }
      }
    }
    const range = document.createRange();
    if (caption) range.selectNodeContents(caption);
    return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight, problems,
      caption: caption ? { text: caption.textContent, rect: rect(caption), textRect: range.getBoundingClientRect().toJSON(), footer: rect(footer) } : null };
  });
  check(result.scrollWidth <= result.width + 1 && result.scrollHeight <= result.height + 1 && result.problems.length === 0,
    'document-layout', context, result);
  const c = result.caption;
  check(!!c && c.text.includes('\u307b\u3063\u304d\u3087\u304f') && c.textRect.height > 0 && c.textRect.bottom <= c.footer.bottom + 1
    && c.textRect.right <= c.footer.right + 1, 'north-view-caption', context, c);
}

async function gesture(page, cdp, start, end, touch) {
  if (touch) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
    for (let step = 1; step <= 8; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1,
        x: start.x + (end.x - start.x) * step / 8, y: start.y + (end.y - start.y) * step / 8 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 }); await page.mouse.up();
  }
}

async function runViewport(browser, width, height) {
  const label = `${width}x${height}`, entry = { viewport: label, picker: [], drags: [], autoplay: [] };
  report.viewports.push(entry);
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: true,
    deviceScaleFactor: width === 390 ? 2 : 1, reducedMotion: 'reduce' });
  page.setDefaultTimeout(6000);
  page.on('pageerror', error => check(false, 'browser-error', label, error.message));
  try {
    await page.clock.install();
    await ready(page);
    const g = await calibrate(page), cdp = await page.context().newCDPSession(page);
    entry.geometry = g;
    const initialLayout = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth,
      width: innerWidth, height: innerHeight, controls: document.querySelector('.controls').getBoundingClientRect().toJSON() }));
    check(initialLayout.scrollWidth <= width && initialLayout.controls.bottom <= height + 1,
      'viewport-fit', label, initialLayout);
    const labels = await page.locator('.phase-choice span').allTextContents();
    check(labels.length === 16, 'picker-count', label, labels);
    // Every fixed choice: real selection, rendering, accessible selection, and actual Moon tap.
    for (let index = 0; index < 16; index++) {
      await page.locator('.phase-choice').nth(index).click();
      const s = await state(page), context = `${label}/picker-${index}`;
      if (index % 4 === 0) check(distance(s.degrees, index * 22.5) <= 1, 'cardinal-anchor', context, s);
      check(s.name === labels[index] && s.selected === index, 'fixed-name-selection', context, { ...s, label: labels[index] });
      const sample = await inspect(page, g, context, s.degrees);
      entry.picker.push(sample);
      if (sample.occluded || index % 4 === 0) await page.screenshot({ path: path.join(output, `${label}-picker-${index}.png`) });
      await page.touchscreen.tap(sample.moon.box.x + sample.moon.x, sample.moon.box.y + sample.moon.y);
      const navigated = await recover(page);
      check(!navigated, 'moon-tap-navigation', context, 'Tapping the lunar disk activated an overlaid game link');
      if (!navigated) {
        const after = await state(page);
        check(after.selected === (index + 1) % 16, 'moon-tap-advance', context, after);
      }
    }
    for (let index = 1; index < entry.picker.length; index++) {
      const delta = (entry.picker[index].degrees - entry.picker[index - 1].degrees + 360) % 360;
      check(delta > 0 && delta < 90, 'picker-order', `${label}/${index}`, delta);
    }
    g.namedAngles = entry.picker.map(sample => sample.degrees);
    // Start on the actual Moon in all eight compass directions, including the top arc.
    for (const touch of [false, true]) for (const startAngle of [0, 45, 90, 135, 180, 225, 270, 315]) {
      await page.locator('.phase-choice').nth(0).click();
      if (startAngle) await gesture(page, cdp, point(g, 0), point(g, startAngle), false);
      await inspect(page, g, `${label}/setup-${startAngle}`, startAngle);
      const target = (startAngle + 35) % 360, context = `${label}/${touch ? 'touch' : 'mouse'}-${startAngle}-to-${target}`;
      await gesture(page, cdp, point(g, startAngle), point(g, target), touch);
      const navigated = await recover(page);
      check(!navigated, 'drag-navigation', context, 'Drag activated navigation');
      if (!navigated) entry.drags.push(await inspect(page, g, context, target));
    }
    // A complete continuous drag sweep, independent of the sixteen fixed-age samples.
    for (let angle = 0; angle < 360; angle += 10) {
      await page.locator('.phase-choice').nth(0).click();
      if (angle) await gesture(page, cdp, point(g, 0), point(g, angle), false);
      await inspect(page, g, `${label}/continuous-${angle}`, angle);
      await layout(page, `${label}/continuous-${angle}`);
      if (angle === 80 || angle === 350) await page.screenshot({ path: path.join(output, `${label}-continuous-${angle}.png`) });
      if ([10, 80, 100, 250, 290, 350].includes(angle)) {
        const next = g.namedAngles.find(value => value > angle + 1) ?? g.namedAngles[0];
        await page.locator('#stepButton').click();
        const after = await state(page);
        check(distance(after.degrees, next) <= 1, 'next-strictly-forward', `${label}/step-from-${angle}`, { next, after });
      }
    }
    await page.locator('#resetButton').click();
    await page.locator('#playButton').click();
    let previous = 0, travelled = 0;
    // Clock runs real requestAnimationFrame callbacks; it does not mutate app phase/state.
    for (let step = 0; step < 38; step++) {
      await page.clock.runFor(800);
      const s = await state(page), delta = (s.degrees - previous + 360) % 360;
      check(delta >= 5 && delta <= 16, 'autoplay-progress', `${label}/${step}`, { previous, current: s.degrees, delta });
      travelled += delta; previous = s.degrees;
      entry.autoplay.push(await inspect(page, g, `${label}/autoplay-${step}`, s.degrees));
    }
    check(travelled >= 360, 'autoplay-full-cycle', label, travelled);
    await page.locator('#playButton').click();
    const paused = await state(page);
    await page.clock.runFor(800);
    check((await state(page)).degrees === paused.degrees, 'autoplay-pause', label, paused);
    for (const tab of ['#tabMoon', '#tabQuiz', '#tabChallenge']) {
      await page.locator(tab).click();
      await page.evaluate(() => window.scrollTo(0, 0));
      await layout(page, `${label}/${tab}`);
      await page.screenshot({ path: path.join(output, `${label}-${tab.slice(1)}.png`) });
    }
    console.log(`${label}: ${entry.picker.length} choices, ${entry.drags.length} drags, 36 sweep samples, ${entry.autoplay.length} autoplay samples`);
  } catch (error) {
    check(false, 'audit-execution', label, error.stack);
    await page.screenshot({ path: path.join(output, `${label}-execution-error.png`) }).catch(() => {});
  } finally { await page.close(); }
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}/moon-phase-game.html?standalone=1`;
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  try {
    for (const [width, height] of viewports) {
      await runViewport(browser, width, height);
      fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    }
  } finally { await browser.close(); server.close(); }
  report.failureCounts = report.failures.reduce((counts, failure) => {
    counts[failure.kind] = (counts[failure.kind] || 0) + 1; return counts;
  }, {});
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ checks: report.checks, failures: report.failureCounts, artifacts: output }, null, 2));
  assert.equal(report.failures.length, 0, `Moon audit found ${report.failures.length} failures; see output/moon-audit/report.json`);
})().catch(error => { server.close(); console.error(error); process.exitCode = 1; });
