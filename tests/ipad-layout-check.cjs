/* Integration-only checks: drive native controls and observe DOM, never game globals.
 * PLAYWRIGHT_MODULE / CHROME_EXECUTABLE select the existing browser installation.
 * IPAD_ROUTES=moon,piano IPAD_MODES=direct,embedded IPAD_VIEWPORTS=1024x600
 * IPAD_LAYOUT_ONLY=1 skips game flows; IPAD_PHONE=1 adds portrait smoke checks.
 * IPAD_NAVIGATION_ONLY=1 runs only all-route tab/history integration checks.
 * IPAD_FOOD_LONGEST=0 skips the additional longest-clue resize coverage.
 * Direct means the official ?standalone=1 game entry; bare HTTP redirects are checked separately.
 * IPAD_FINAL_READY=1 acknowledges the parent handoff before the full six-iPad matrix.
 * IPAD_SCREENSHOTS=0 disables PNGs; IPAD_ARTIFACTS selects a non-publication folder.
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const publication = path.join(root, 'output', 'quiz-reference-publish');
const artifacts = path.resolve(process.env.IPAD_ARTIFACTS || path.join(root, 'output', 'playwright', 'ipad-layout'));
assert(artifacts !== publication && !artifacts.startsWith(publication + path.sep), 'Do not write publication artifacts');
const games = {
  moon: 'moon-phase-game.html', piano: 'sprunki-piano-game.html',
  addition: 'sprunki-addition-game.html', guess: 'sprunki-guess-game.html', baibain: 'baibain-game.html', food: 'food-quiz-game.html',
  english: 'english-game.html'
};
const tokens = {
  '--game-bg': '#151918', '--game-surface': '#202824', '--game-ink': '#f4f7f3',
  '--game-muted': '#a9b7b0', '--game-line': '#3b4942', '--game-primary': '#b9edcc',
  '--game-gold': '#f4cc72', '--game-coral': '#f4a996', '--game-cyan': '#8edce2'
};
const routes = (process.env.IPAD_ROUTES || Object.keys(games).join(',')).split(',');
const modes = (process.env.IPAD_MODES || 'direct,embedded').split(',');
assert(routes.length && routes.every(route => Object.hasOwn(games, route)), 'Unknown IPAD_ROUTES');
assert(modes.length && modes.every(mode => ['direct', 'embedded'].includes(mode)), 'Unknown IPAD_MODES');
const viewports = (process.env.IPAD_VIEWPORTS || '1024x600,1024x768,1133x744,1180x820,1194x834,1366x1024')
  .split(',').map(value => {
    assert(/^\d+x\d+$/.test(value), 'Use WIDTHxHEIGHT in IPAD_VIEWPORTS');
    const [width, height] = value.split('x').map(Number);
    assert(width > 0 && height > 0, 'Viewport dimensions must be positive');
    return { width, height, phone: width < 700 };
  });
if (process.env.IPAD_PHONE === '1') viewports.push({ width: 390, height: 844, phone: true }, { width: 320, height: 568, phone: true });
const screenshots = process.env.IPAD_SCREENSHOTS !== '0';
const layoutOnly = process.env.IPAD_LAYOUT_ONLY === '1';
const navigationOnly = process.env.IPAD_NAVIGATION_ONLY === '1';
const report = { started: new Date().toISOString(), routes, modes, viewports, layoutOnly, navigationOnly, cases: [], foodLongest: [], failures: [], navigation: [] };
const navSignatures = new Map();
const required = {
  moon: ['#space', '#phaseSummary', '#tabMoon', '#tabFriends', '#tabQuiz', '#tabChallenge', '#playButton', '#stepButton', '#resetButton', '#musicButton'],
  piano: ['#noteCanvas', '#piano', '#menuButton', '#songButton', '#startButton', '#pauseButton', '#resetButton', '#soundButton'],
  addition: ['#addMode', '#subtractMode', '#musicToggle', '#musicTrack', '#level', '#restart'],
  guess: ['#sound'],
  food: ['#sound'],
  english: ['#sound'],
  baibain: ['#scene', '#play', '#step', '#reset', '#speed', '#range', '#timeline', '#reference', '[data-dialog="assumptionsDialog"]']
};

function gameURL(base, route, mode) {
  return `${base}/${mode === 'embedded' ? `index.html?game=${route}` : `${games[route]}?standalone=1`}`;
}

async function gameFrame(page, route, mode) {
  if (mode === 'embedded') {
    const host = page.locator('#gameFrame');
    await host.waitFor();
    const frame = await (await host.elementHandle()).contentFrame();
    assert(frame, 'The shell exposes a loaded #gameFrame');
    await frame.waitForURL(url => url.pathname.endsWith('/' + games[route]));
    await frame.locator(required[route][0]).waitFor();
    assert.equal(page.frames().length, 2, 'Exactly one game iframe, without nested shells');
    return frame;
  }
  assert.equal(new URL(page.url()).pathname.split('/').pop(), games[route], 'Standalone remains the direct game');
  assert.equal(new URL(page.url()).searchParams.get('standalone'), '1', 'Direct uses the official opt-out');
  assert.equal(page.frames().length, 1, 'Standalone has no wrapper iframe');
  await page.locator(required[route][0]).waitFor();
  return page.mainFrame();
}

function fail(label, message, details) {
  report.failures.push({ label, message, ...(details ? { details } : {}) });
}

// Serve only workspace files. This ephemeral server is closed even on browser failures.
const server = http.createServer((req, res) => {
  let target;
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    target = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  } catch { return res.writeHead(400).end(); }
  if (!target.startsWith(root + path.sep) || target === publication || target.startsWith(publication + path.sep)) return res.writeHead(403).end();
  fs.readFile(target, (error, data) => {
    if (error) return res.writeHead(404).end();
    const type = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' }[path.extname(target)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(data);
  });
});

async function settle(frame, milliseconds = 90) {
  await frame.evaluate(() => document.fonts.ready);
  await frame.page().waitForTimeout(milliseconds);
}

async function theme(frame, route, embedded, label) {
  const result = await frame.evaluate(({ expected, route, embedded }) => {
    const issues = [];
    const style = getComputedStyle(document.documentElement);
    for (const [name, value] of Object.entries(expected)) {
      if (style.getPropertyValue(name).trim().toLowerCase() !== value) issues.push(`${name}: ${style.getPropertyValue(name).trim() || 'missing'}`);
    }
    const resource = (selector, attribute, file) => [...document.querySelectorAll(selector)].find(node =>
      new URL(node.getAttribute(attribute), location.href).pathname.endsWith('/' + file));
    const link = resource('head link[rel="stylesheet"][href]', 'href', 'games-theme.css');
    const script = resource('head script[src]', 'src', 'games-theme.js');
    if (!link || !link.sheet) issues.push('Shared stylesheet missing or not loaded');
    if (!script || script.async || script.defer) issues.push('Shared synchronous script missing');
    for (const node of document.querySelectorAll('head style')) {
      if (link && !(node.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING)) issues.push('Theme link precedes an inline style');
      if (script && !(node.compareDocumentPosition(script) & Node.DOCUMENT_POSITION_FOLLOWING)) issues.push('Theme script precedes an inline style');
    }
    if (!document.body.matches(`.game-page[data-game="${route}"]`)) issues.push('Body theme route/class missing');
    if (document.documentElement.classList.contains('is-embedded') !== embedded) issues.push('is-embedded does not match actual frame nesting');
    const body = getComputedStyle(document.body);
    if (body.fontFamily !== style.fontFamily) issues.push('Page font differs from shared Japanese system font');
    if (body.backgroundColor !== 'rgb(21, 25, 24)') issues.push(`Page background differs from shared neutral: ${body.backgroundColor}`);
    if (body.color !== 'rgb(244, 247, 243)') issues.push(`Page ink differs from shared foreground: ${body.color}`);
    return { issues, font: body.fontFamily, background: body.backgroundColor, color: body.color };
  }, { expected: tokens, route, embedded });
  for (const issue of result.issues) fail(label, issue);
  return result;
}

async function inspect(frame, options) {
  return frame.evaluate(async ({ phone, route, requiredSelectors, wrapper }) => {
    const issues = [], media = [], bounded = [];
    const tolerance = 2;
    const bounds = { width: innerWidth, height: innerHeight };
    const rect = el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const name = el => el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}${el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : ''} ${el.textContent.trim().slice(0, 35)}`;
    function visible(el) {
      if (!el.getClientRects().length || el.closest('[hidden], .visually-hidden, .sr-only')) return false;
      for (let node = el; node; node = node.parentElement) {
        const s = getComputedStyle(node);
        if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
      }
      return true;
    }
    // Only existing optional lists/dialogs may scroll. Main gameplay cannot earn an exemption.
    const scrollableSelector = '#phaseList, #sprunkiList, #gameMenu, #songPicker, dialog';
    function scrollOwner(el) {
      for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
        if (!node.closest(scrollableSelector)) continue;
        const s = getComputedStyle(node);
        if ((/(auto|scroll)/.test(s.overflowY) && node.scrollHeight > node.clientHeight + tolerance) ||
            (/(auto|scroll)/.test(s.overflowX) && node.scrollWidth > node.clientWidth + tolerance)) return node;
      }
      return null;
    }
    function fits(r, vertical = !phone) {
      return r.left >= -tolerance && r.right <= innerWidth + tolerance && (!vertical || (r.top >= -tolerance && r.bottom <= innerHeight + tolerance));
    }
    const add = (kind, el, details = {}) => issues.push({ kind, element: typeof el === 'string' ? el : name(el), ...details });
    for (const el of [document.documentElement, document.body]) {
      if (el.scrollWidth > innerWidth + tolerance) add('document horizontal overflow', el, { actual: el.scrollWidth, maximum: innerWidth });
      if (!phone && el.scrollHeight > innerHeight + tolerance) add('document vertical overflow', el, { actual: el.scrollHeight, maximum: innerHeight });
    }
    if (scrollX || (!phone && scrollY)) add('document scrolled away from initial viewport', 'window', { x: scrollX, y: scrollY });
    for (const selector of requiredSelectors) {
      const elements = [...document.querySelectorAll(selector)];
      if (!elements.length) add('required gameplay control hidden/missing', selector);
      for (const el of elements) {
        if (!visible(el)) { add('required gameplay control hidden/missing', name(el)); continue; }
        const r = rect(el);
        if (r.width < 8 || r.height < 8 || (!scrollOwner(el) && !fits(r))) add('required gameplay control outside viewport', el, { rect: r });
      }
    }
    const selector = wrapper ? 'header, nav, dialog, h2, button, a, iframe' : 'button, input, select, summary, canvas, img, #hero > svg, #cards svg, #finishFoods svg, #albumGrid svg, .prediction-bun, .word-art, .swatch, .category .art, .finish-art, h1, h2, h3, p, label, [role="status"], [role="tablist"], #equation, #elapsed, #count, #mass, #height, #phaseName, #phaseMessage';
    for (const el of document.querySelectorAll(selector)) {
      if (!visible(el)) continue;
      const r = rect(el), owner = scrollOwner(el);
      if (r.width <= 0 || r.height <= 0) {
        if (el.matches('[role="status"], [aria-live], #predictionFeedback') && !el.textContent.trim() && !el.children.length) continue;
        add('visible element has no useful area', el); continue;
      }
      if (!owner && !fits(r)) add('element outside viewport', el, { rect: r });
      if (owner && !bounded.some(item => item.element === name(owner))) {
        const outer = rect(owner);
        bounded.push({ element: name(owner), rect: outer });
        if (!fits(outer, true)) add('scrollable list/dialog outside viewport', owner, { rect: outer });
      }
      if (/^(BUTTON|INPUT|SELECT|SUMMARY)$/.test(el.tagName)) {
        const s = getComputedStyle(el);
        if (!['normal', '0px'].includes(s.letterSpacing)) add('control letter spacing is not zero', el, { value: s.letterSpacing });
        if (['BUTTON', 'SELECT'].includes(el.tagName)) {
          const corners = [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomLeftRadius, s.borderBottomRightRadius];
          if (corners.some(corner => parseFloat(corner) > 8)) add('control radius exceeds shared 8px contract', el, { corners });
        }
        if (el.tagName === 'BUTTON') {
          if (el.scrollWidth > el.clientWidth + tolerance || el.scrollHeight > el.clientHeight + tolerance) add('button content overflows its own box', el, { client: [el.clientWidth, el.clientHeight], scroll: [el.scrollWidth, el.scrollHeight] });
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const text = walker.currentNode;
            if (!text.textContent.trim() || !visible(text.parentElement)) continue;
            const range = document.createRange(); range.selectNodeContents(text);
            for (const line of range.getClientRects()) {
              if (line.left < r.left - tolerance || line.right > r.right + tolerance || line.top < r.top - tolerance || line.bottom > r.bottom + tolerance) add('button text exceeds button rectangle', el, { text: text.textContent.trim(), button: r, textRect: { left: line.left, top: line.top, right: line.right, bottom: line.bottom } });
            }
          }
          for (const child of el.querySelectorAll('img, canvas, svg, span')) {
            if (!visible(child)) continue;
            const c = rect(child);
            if (c.left < r.left - tolerance || c.right > r.right + tolerance || c.top < r.top - tolerance || c.bottom > r.bottom + tolerance) add('button child exceeds button rectangle', el, { child: name(child), rect: c, button: r });
          }
        }
      }
      if (!owner && !wrapper) {
        for (let parent = el.parentElement; parent && parent !== document.documentElement; parent = parent.parentElement) {
          const s = getComputedStyle(parent), p = rect(parent);
          if (/(hidden|clip)/.test(s.overflowX) && (r.left < p.left - tolerance || r.right > p.right + tolerance)) add('element horizontally clipped by ancestor', el, { ancestor: name(parent), rect: r, ancestorRect: p });
          if (/(hidden|clip)/.test(s.overflowY) && (r.top < p.top - tolerance || r.bottom > p.bottom + tolerance)) add('element vertically clipped by ancestor', el, { ancestor: name(parent), rect: r, ancestorRect: p });
        }
      }
      if (!['CANVAS', 'IMG', 'svg'].includes(el.tagName) || (owner && !fits(r, true))) continue;
      const primary = ['space', 'noteCanvas', 'scene'].includes(el.id);
      const minWidth = primary ? (phone ? 200 : 280) : ['guess', 'food'].includes(route) && el.closest('#cards') ? 60 : route === 'addition' && el.closest('#groups') ? 24 : 16;
      const minHeight = primary ? (phone ? 110 : 150) : ['guess', 'food'].includes(route) && el.closest('#cards') ? 70 : 16;
      const item = { element: name(el), width: r.width, height: r.height };
      media.push(item);
      if (r.width < minWidth || r.height < minHeight) add('media too small for useful gameplay', el, { rect: r, minimum: [minWidth, minHeight] });
      if (el.tagName === 'IMG' && (!el.complete || !el.naturalWidth || !el.naturalHeight)) { add('image missing or undecoded', el, { src: el.getAttribute('src') }); continue; }
      try {
        const sample = document.createElement('canvas'); sample.width = sample.height = 64;
        const ctx = sample.getContext('2d', { willReadFrequently: true });
        let source = el;
        if (el.tagName === 'svg') {
          const standalone = el.cloneNode(true);
          // Inline SVG sprites reference symbols outside the rendered <svg>.
          // Carry those authored definitions into the isolated raster sample.
          const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
          const seen = new Set();
          const references = [...el.querySelectorAll('use')].map(use => use.getAttribute('href') || use.getAttribute('xlink:href'));
          while (references.length) {
            const reference = references.shift();
            if (!reference?.startsWith('#') || seen.has(reference)) continue;
            seen.add(reference);
            const definition = document.getElementById(reference.slice(1));
            if (!definition || el.contains(definition)) continue;
            defs.append(definition.cloneNode(true));
            for (const use of definition.querySelectorAll('use')) references.push(use.getAttribute('href') || use.getAttribute('xlink:href'));
          }
          if (defs.children.length) standalone.prepend(defs);
          source = new Image();
          source.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(standalone));
          await source.decode();
        }
        ctx.drawImage(source, 0, 0, 64, 64);
        const pixels = ctx.getImageData(0, 0, 64, 64).data;
        let opaque = 0; const colors = new Set();
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] > 8) {
          opaque++; colors.add(`${pixels[i] >> 4},${pixels[i + 1] >> 4},${pixels[i + 2] >> 4}`);
        }
        item.nontransparentPixels = opaque; item.colors = colors.size;
        // Sparse single-color notes/lanes on transparency are real drawing, not a blank canvas.
        if (opaque < 10 || (colors.size < 2 && opaque >= 64 * 64 - 10)) add('blank or uniform media', el, item);
        if (el.tagName === 'CANVAS' && primary && (el.width < r.width * .8 || el.height < r.height * .8)) add('canvas backing store undersized', el, { backing: [el.width, el.height], rect: r });
      } catch (error) { add('media pixel inspection failed', el, { error: error.message }); }
    }
    return { bounds, scroll: { x: scrollX, y: scrollY, width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }, issues, media, bounded };
  }, options);
}

async function checkNav(page, route, viewport, label) {
  const result = await page.evaluate(route => {
    const header = document.querySelector('#gameNavigation');
    const r = header?.getBoundingClientRect();
    const tabs = [...document.querySelectorAll('#gameNavigation .game-nav-shortcuts [data-nav-game]')];
    const menu = [...document.querySelectorAll('#gameNavigation #gameMenu [data-nav-game]')];
    const signature = el => {
      const s = getComputedStyle(el);
      return { font: s.fontFamily, size: s.fontSize, weight: s.fontWeight, spacing: s.letterSpacing, color: s.color, background: s.backgroundColor };
    };
    const frame = document.querySelector('#gameFrame').getBoundingClientRect();
    return {
      header: r ? { top: r.top, bottom: r.bottom, height: r.height, width: r.width } : null,
      frame: { top: frame.top, bottom: frame.bottom, width: frame.width, height: frame.height },
      active: tabs.filter(el => el.getAttribute('aria-current') === 'page').map(el => el.dataset.navGame),
      selectedClasses: tabs.filter(el => el.classList.contains('is-active')).map(el => el.dataset.navGame),
      menuActive: menu.filter(el => el.getAttribute('aria-current') === 'page').map(el => el.dataset.navGame),
      menuRoutes: menu.map(el => el.dataset.navGame),
      bodyRoute: document.body.dataset.game,
      tabs: tabs.map(el => ({ route: el.dataset.navGame, active: el.dataset.navGame === route, ...signature(el) })),
      nested: document.querySelectorAll('iframe').length
    };
  }, route);
  const navHeight = result.header?.bottom;
  if (!result.header || result.header.height < 44 || result.header.bottom >= viewport.height || Math.abs(result.header.top) > 1) fail(label, 'Parent navigation must remain visible above the game', result);
  if (JSON.stringify(result.active) !== JSON.stringify([route]) || JSON.stringify(result.selectedClasses) !== JSON.stringify([route]) || JSON.stringify(result.menuActive) !== JSON.stringify([route]) || result.bodyRoute !== route) fail(label, 'Active navigation route mismatch', result);
  if (JSON.stringify(result.menuRoutes) !== JSON.stringify(Object.keys(games)) || JSON.stringify(result.tabs.map(tab => tab.route)) !== JSON.stringify(Object.keys(games))) fail(label, 'Both navigation surfaces must retain all seven routes', result);
  if (Math.abs(result.frame.top - navHeight) > 1 || Math.abs(result.frame.height - (viewport.height - navHeight)) > 1 || result.frame.bottom > viewport.height + 1) fail(label, 'Iframe does not occupy actual remaining height', result);
  const active = result.tabs.find(tab => tab.active), inactive = result.tabs.filter(tab => !tab.active);
  const signature = tab => JSON.stringify({ font: tab.font, size: tab.size, weight: tab.weight, spacing: tab.spacing, color: tab.color, background: tab.background });
  if (active && inactive.some(tab => tab.font !== active.font || tab.size !== active.size || tab.spacing !== active.spacing)) fail(label, 'Navigation typography varies between routes', result.tabs);
  if (active && inactive.length && active.color === inactive[0].color && active.background === inactive[0].background) fail(label, 'Active tab has no color distinction', result.tabs);
  const key = `${viewport.width}x${viewport.height}`;
  if (active) {
    if (navSignatures.has(key) && navSignatures.get(key) !== signature(active)) fail(label, 'Selected tab appearance differs across games', { expected: navSignatures.get(key), actual: signature(active) });
    navSignatures.set(key, signature(active));
  }
  return result;
}

async function checkpoint(context, state, extraRequired = []) {
  const { page, frame, route, mode, viewport, entry } = context;
  await settle(frame);
  const label = `${entry.label}/${state}`;
  const requiredSelectors = [...required[route], ...extraRequired];
  if (route === 'moon' && mode === 'direct' && await frame.locator('#local-menu').count()) requiredSelectors.push('#local-menu');
  const result = await inspect(frame, { phone: viewport.phone, route, requiredSelectors, wrapper: false });
  for (const issue of result.issues) fail(label, issue.kind, issue);
  const capture = { state, ...result };
  if (mode === 'embedded') {
    capture.wrapper = await inspect(page.mainFrame(), { phone: viewport.phone, route, requiredSelectors: ['#gameNavigation', '#gameMenuToggle', '#gameFrame'], wrapper: true });
    for (const issue of capture.wrapper.issues) fail(label + '/wrapper', issue.kind, issue);
    capture.nav = await checkNav(page, route, viewport, label);
    if (Math.abs(result.bounds.height - capture.nav.frame.height) > 1 || Math.abs(result.bounds.width - capture.nav.frame.width) > 1) fail(label, 'Inner viewport dimensions differ from the actual iframe', result.bounds);
  }
  const png = screenshots || route === 'english' ? await page.screenshot({ fullPage: false }) : null;
  if (route === 'english') {
    const offset = mode === 'embedded' ? await page.locator('#gameFrame').boundingBox() : { x: 0, y: 0 };
    capture.art = await frame.evaluate(async ({ png, offset }) => {
      const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0);
      return [...document.querySelectorAll('.word-art, .swatch, .category .art, .finish-art')].filter(el => el.checkVisibility()).map(el => {
        const r = el.getBoundingClientRect();
        const x = Math.max(0, Math.round(r.left + offset.x)), y = Math.max(0, Math.round(r.top + offset.y));
        const width = Math.min(Math.round(r.width), canvas.width - x), height = Math.min(Math.round(r.height), canvas.height - y);
        const colors = new Set();
        if (width > 0 && height > 0) {
          const pixels = ctx.getImageData(x, y, width, height).data;
          for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] > 8) colors.add(`${pixels[i] >> 4},${pixels[i + 1] >> 4},${pixels[i + 2] >> 4}`);
        }
        return { class: el.className, text: el.textContent, width, height, colors: colors.size };
      });
    }, { png: png.toString('base64'), offset });
    if (!capture.art.length || capture.art.some(item => item.width < 24 || item.height < 24 || item.colors < 3)) fail(label, 'English pictured choices must have nonblank, useful rendered assets', capture.art);
  }
  if (screenshots) {
    capture.screenshot = `${entry.label.replaceAll('/', '-')}-${state}.png`;
    fs.writeFileSync(path.join(artifacts, capture.screenshot), png);
  }
  entry.states.push(capture);
}

async function click(frame, selector) { await frame.locator(selector).click({ timeout: 4000 }); }

async function additionFlow(c) {
  const f = c.frame;
  await f.locator('#level').selectOption('20');
  await checkpoint(c, 'max20', ['#equation', '#answers button', '#groups']);
  for (const operation of ['add', 'subtract']) {
    if (operation === 'subtract') await click(f, '#subtractMode');
    let sawTwenty = false;
    // Observe generated questions; use only restart/answer controls to reach the maximum-density case.
    for (let attempt = 0; attempt < 80; attempt++) {
      const numbers = await f.locator('#equation > span').allTextContents();
      if ((operation === 'add' ? Number(numbers[0]) + Number(numbers[2]) : Number(numbers[0])) === 20) { sawTwenty = true; break; }
      await click(f, '#restart');
    }
    assert(sawTwenty, `Could not sample a 20-character ${operation} question after 80 restarts`);
    await checkpoint(c, `${operation}-twenty-characters`, ['#equation', '#answers button', '#groups']);
    for (let round = 0; round < 5; round++) {
      const numbers = await f.locator('#equation > span').allTextContents();
      const answer = operation === 'add' ? Number(numbers[0]) + Number(numbers[2]) : Number(numbers[0]) - Number(numbers[2]);
      if (round === 0) {
        const wrong = f.locator('#answers button').filter({ hasNotText: new RegExp(`^${answer}$`) }).first();
        await wrong.click();
        assert(await f.locator('#next').isHidden(), 'Wrong addition answer must remain retryable');
        await checkpoint(c, `${operation}-retry`, ['#answers button']);
      }
      await f.locator('#answers button').filter({ hasText: new RegExp(`^${answer}$`) }).click();
      if (round === 0) await checkpoint(c, `${operation}-solved`, ['#next']);
      await click(f, '#next');
    }
    await f.locator('#party').waitFor({ state: 'visible' });
    await checkpoint(c, `${operation}-party`, ['#again', '#partyTitle']);
    await click(f, '#again');
  }
  if (await f.locator('#handsOn').count()) {
    await click(f, '#subtractMode');
    await f.locator('#handsOn').check();
    const numbers = await f.locator('#equation > span').allTextContents();
    const removed = Number(numbers[2]), remaining = Number(numbers[0]) - removed;
    await checkpoint(c, 'hands-on-start', ['#handsOn', '#groups', '#answers button']);
    for (let index = 0; index < removed; index++) {
      assert.equal(await f.locator('#answers button:enabled').count(), 0, 'Hands-on answers wait for the requested removals');
      await f.locator('#left button:not(:disabled)').last().click();
      assert.equal(await f.locator('#left .gone').count(), index + 1);
    }
    assert.equal(await f.locator('#left button:not(:disabled)').count(), remaining, 'Remaining physical counters match subtraction');
    await checkpoint(c, 'hands-on-removed', ['#handsOn', '#answers button']);
    if (remaining) {
      await f.locator('#left button:not(:disabled)').first().click();
      assert.equal((await f.locator('#left .count-tag').allTextContents()).filter(text => text.trim() === '1').length, 1, 'Remaining counter can be counted');
      await checkpoint(c, 'hands-on-counted', ['#groups']);
    }
    await f.locator('#answers button').filter({ hasText: new RegExp(`^${remaining}$`) }).click();
    await checkpoint(c, 'hands-on-solved', ['#next']);
    await click(f, '#next');
  }
}

async function guessFlow(c) {
  const f = c.frame;
  if (await f.locator('#sound').getAttribute('aria-pressed') === 'true') await click(f, '#sound');
  await click(f, '#hintButton');
  await checkpoint(c, 'hint', ['#hintImage', '#cards button', '#listen', '#hintButton']);
  const target = (await f.locator('#targetName').textContent()).trim();
  const correctLabel = (await f.locator('#cards button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))).find(label => label.includes(`${target}を`));
  assert(correctLabel, 'Visible question name identifies a choice');
  const labels = await f.locator('#cards button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')));
  await f.getByRole('button', { name: labels.find(label => label !== correctLabel), exact: true }).click();
  assert(await f.locator('#next').isHidden(), 'Wrong guess cannot expose next');
  assert.equal(await f.locator('.star.earned').count(), 0, 'Wrong guess cannot earn a star');
  await checkpoint(c, 'retry-with-hint', ['#hintImage', '#cards button']);
  if (await f.locator('#hint').getAttribute('data-level') !== null) {
    assert.equal(await f.locator('#hint').getAttribute('data-level'), '1', 'Wrong answer preserves the current hint stage');
    await click(f, '#hintButton');
    assert.equal(await f.locator('#hint').getAttribute('data-level'), '2');
    await checkpoint(c, 'hint-color', ['#hintImage', '#hintColor', '#hintButton']);
    await click(f, '#hintButton');
    assert.equal(await f.locator('#hint').getAttribute('data-level'), '3');
    assert(await f.locator('#hintButton').isDisabled(), 'Full hint has no fourth stage');
    await checkpoint(c, 'hint-full', ['#hintImage', '#hintButton']);
  }
  const collectedTargets = [];
  for (let round = 0; round < 5; round++) {
    const name = (await f.locator('#targetName').textContent()).trim();
    const choices = await f.locator('#cards button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')));
    const label = choices.find(value => value.includes(`${name}を`));
    assert(label, 'Visible target has an answer');
    collectedTargets.push(await f.getByRole('button', { name: label, exact: true }).getAttribute('data-id'));
    await f.getByRole('button', { name: label, exact: true }).click();
    assert.equal(await f.locator('.star.earned').count(), round + 1);
    if (round === 0 || round === 4) await checkpoint(c, `correct-${round + 1}`, ['#next']);
    await click(f, '#next');
    if (round < 4 && await f.locator('#hint').getAttribute('data-level') !== null) {
      assert.equal(await f.locator('#hint').getAttribute('data-level'), '0', 'New question resets progressive hint');
      assert(await f.locator('#hint').isHidden());
    }
  }
  await f.locator('#finish').waitFor({ state: 'visible' });
  await checkpoint(c, 'finish', ['#again', '#finishTitle']);
  if (await f.locator('#collectionSummary').count()) {
    assert.equal(await f.locator('#friends .friend').count(), 8, 'Collection retains all eight slots');
    assert.deepEqual((await f.locator('#friends button.owned').evaluateAll(nodes => nodes.map(node => node.dataset.id))).sort(), [...new Set(collectedTargets)].sort(), 'Completed round earns its pictured targets');
    await f.locator('#friends button.owned').last().click();
    await checkpoint(c, 'collection-selected', ['#collectionSummary', '#friends button.owned', '#again']);
  }
  await click(f, '#again');
  assert.equal(await f.locator('#cards button').count(), 3, 'Guess restart restores all choices');
}

async function englishFlow(c) {
  const f = c.frame;
  // English's pressed sound button means muted, unlike the original six games.
  if (await f.locator('#sound').getAttribute('aria-pressed') !== 'true') await click(f, '#sound');
  assert.equal(await f.locator('#categories button').count(), 3, 'All three English gardens are available');
  await checkpoint(c, 'home', ['#categories button']);
  c.entry.englishRounds = [];
  for (let category = 0; category < 3; category++) {
    const prefix = `garden-${category + 1}`;
    await f.locator('#categories button').nth(category).click();
    const vocabulary = await f.locator('#learn-grid button').evaluateAll(buttons => buttons.map(button => ({
      english: button.querySelector('strong').textContent.trim(), name: button.querySelector('small').textContent.trim()
    })));
    assert.equal(vocabulary.length, 6, 'Each garden has six pictured vocabulary words');
    assert.equal(new Set(vocabulary.map(word => word.english)).size, 6);
    await f.locator('#learn-grid button').last().click();
    await checkpoint(c, `${prefix}-learn`, ['#learn-title', '#learn [data-home]', '#learn-grid button', '#start']);
    await click(f, '#start');
    const targets = [];
    for (let index = 0; index < 5; index++) {
      const english = (await f.locator('#english').textContent()).trim();
      const target = vocabulary.find(word => word.english === english);
      assert(target, 'Visible English prompt matches the pictured vocabulary just learned');
      targets.push(english);
      assert.equal((await f.locator('#count').textContent()).trim(), `${index + 1} / 5`);
      assert.equal(await f.locator('#choices button:enabled').count(), 3);
      assert(await f.locator('#next').isHidden(), 'English next requires a correct answer');
      if (index === 0) {
        const labels = await f.locator('#choices button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')));
        const wrong = labels.find(label => label !== target.name);
        assert(wrong, 'English offers a wrong choice to retry');
        await f.locator('#choices').getByRole('button', { name: wrong, exact: true }).click();
        assert.equal((await f.locator('#english').textContent()).trim(), english, 'Wrong answer preserves English question');
        assert.equal(await f.locator('#choices button:enabled').count(), 3);
        assert(await f.locator('#next').isHidden(), 'Wrong English answer permits unlimited retry');
        await checkpoint(c, `${prefix}-wrong`, ['#choices button', '#listen', '#hint-toggle', '#feedback']);
        await click(f, '#hint-toggle');
        assert((await f.locator('#hint').textContent()).includes(target.name));
        await checkpoint(c, `${prefix}-hint`, ['#hint', '#choices button']);
      }
      await f.locator('#choices').getByRole('button', { name: target.name, exact: true }).click();
      assert.equal(await f.locator('#choices button:disabled').count(), 3);
      assert.equal((await f.locator('#stars').textContent()).split('\u2605').length - 1, index + 1);
      await checkpoint(c, `${prefix}-correct-${index + 1}`, ['#next', '#choices button', '#feedback']);
      await click(f, '#next');
    }
    assert.equal(new Set(targets).size, 5, 'English round contains five different target words');
    c.entry.englishRounds.push({ category, vocabulary, targets });
    await f.locator('#finish').waitFor({ state: 'visible' });
    await checkpoint(c, `${prefix}-finish`, ['#again', '#finish [data-home]']);
    if (await f.locator('#reviewWords').count()) {
      assert.equal(await f.locator('#reviewWords button').count(), 5, 'Finish lets the child review all five learned words');
      const reviewed = await f.locator('#reviewWords button strong').allTextContents();
      assert.deepEqual(reviewed.map(word => word.trim()).sort(), [...targets].sort(), 'Review cards match this completed round');
      await f.locator('#reviewWords button').last().click();
      await checkpoint(c, `${prefix}-review`, ['#reviewWords button', '#again']);
    }
    await click(f, '#again');
    assert.equal(await f.locator('#choices button:enabled').count(), 3, 'English replay starts a fresh round');
    assert.equal((await f.locator('#count').textContent()).trim(), '1 / 5');
    await checkpoint(c, `${prefix}-again`, ['#quiz [data-home]', '#listen', '#choices button']);
    await click(f, '#quiz [data-home]');
    await f.locator('#home').waitFor({ state: 'visible' });
  }
}

const normalizeClue = text => text.replace(/\s+/g, ' ').trim();
let foodOracle;
function loadFoodOracle() {
  if (foodOracle) return foodOracle;
  // Load the static authored data in Node, never FoodQuiz/ FoodQuizBank from the page.
  const bank = require(path.join(root, 'food-quiz-bank.js'));
  assert(Array.isArray(bank.questions) && Array.isArray(bank.foods) && Array.isArray(bank.levels), 'Food bank exports questions, foods and levels');
  const counts = { easy: 400, normal: 350, hard: 250 };
  assert.equal(bank.questions.length, 1000, 'Complete 1,000-question bank is required');
  assert.equal(bank.foods.length, 50, 'All 50 pictured foods are present');
  assert.deepEqual(bank.levels.map(level => level.id).sort(), Object.keys(counts).sort());
  const foods = new Map(bank.foods.map(food => [food.id, food]));
  const byClue = new Map(), ids = new Set();
  for (const question of bank.questions) {
    assert(Object.hasOwn(counts, question.difficulty), `Known difficulty: ${question.id}`);
    assert.equal(typeof question.clue, 'string');
    assert(!ids.has(question.id), `Unique food question ID: ${question.id}`);
    ids.add(question.id);
    assert.equal(question.choices.length, 3, `Three answers: ${question.id}`);
    assert.equal(new Set(question.choices).size, 3, `Distinct answers: ${question.id}`);
    assert(question.choices.every(id => /^[a-z0-9_-]+$/i.test(id) && foods.has(id)), `Existing food choices: ${question.id}`);
    assert(question.choices.includes(question.answer), `Answer is a choice: ${question.id}`);
    const key = `${question.difficulty}:${normalizeClue(question.clue)}`;
    assert(!byClue.has(key), `Unambiguous clue within difficulty: ${question.id}`);
    byClue.set(key, question);
  }
  for (const [difficulty, count] of Object.entries(counts)) {
    assert.equal(bank.questions.filter(question => question.difficulty === difficulty).length, count, `${difficulty} question count`);
  }
  report.foodBank = { questions: bank.questions.length, foods: bank.foods.length, counts, oracle: 'Node static bank matched against visible difficulty, clue and choices' };
  foodOracle = { levels: bank.levels, foods, byClue, counts };
  return foodOracle;
}

async function foodFlow(c) {
  const f = c.frame, oracle = loadFoodOracle();
  const startControls = ['#startButton', '#startTitle', '#difficultyEasy', '#difficultyNormal', '#difficultyHard', '#difficultyHelp'];
  const playControls = ['#prompt', '#listen', '#cards button', '#changeDifficulty', '#levelLabel'];
  const finishControls = ['#again', '#finishDifficulty', '#finishTitle', '#finishLevel'];
  c.entry.foodRounds = [];
  const albumAvailable = await f.locator('#albumButton').count() > 0;
  const collectedFoods = new Set();

  async function album(state, requiredControls) {
    if (!albumAvailable) return;
    const progress = await f.locator('#stars .earned').count();
    await click(f, '#albumButton');
    await f.locator('#albumDialog').waitFor({ state: 'visible' });
    const ids = await f.locator('#albumGrid button').evaluateAll(buttons => buttons.map(button => button.dataset.food));
    assert.deepEqual([...ids].sort(), [...collectedFoods].sort(), 'Album contains only foods actually answered in this session');
    await checkpoint(c, `${state}-album`, ['#albumDialog', '#albumClose', '#albumStatus', ...requiredControls]);
    if (ids.length) {
      const button = f.locator('#albumGrid button').last();
      const name = await button.getAttribute('aria-label');
      await button.click();
      assert((await f.locator('#albumStatus').textContent()).includes(name), 'Album selection announces the pictured food');
      await checkpoint(c, `${state}-album-selected`, ['#albumDialog', '#albumClose']);
    }
    await click(f, '#albumClose');
    assert(await f.locator('#albumDialog').isHidden());
    assert.equal(await f.locator('#stars .earned').count(), progress, 'Opening the food album preserves round progress');
  }

  async function assertSelection(level) {
    const radios = await f.locator('#difficultyChoices [role="radio"]').evaluateAll(elements => elements.map(el => ({
      id: el.dataset.difficulty, checked: el.getAttribute('aria-checked'), tabIndex: el.tabIndex,
      text: el.textContent, count: el.querySelector('small')?.textContent
    })));
    assert.equal(radios.length, 3, 'Three visible difficulty choices');
    assert.deepEqual(radios.filter(radio => radio.checked === 'true').map(radio => radio.id), [level.id]);
    for (const radio of radios) {
      assert.equal(radio.tabIndex, radio.id === level.id ? 0 : -1, 'Difficulty radio has a single tab stop');
      assert.equal(Number(radio.count.replace(/\D/g, '')), oracle.counts[radio.id], 'UI advertises actual bank size');
    }
    assert((await f.locator('#difficultyHelp').textContent()).includes(level.description), 'Selection explains the chosen difficulty');
  }

  async function displayedQuestion(level) {
    assert.equal((await f.locator('#levelLabel').textContent()).trim(), level.name, 'Playing difficulty matches selection');
    const clue = await f.locator('#prompt').textContent();
    const question = oracle.byClue.get(`${level.id}:${normalizeClue(clue)}`);
    assert(question, `Displayed clue belongs to ${level.id}: ${clue}`);
    const cards = await f.locator('#cards button').evaluateAll(elements => elements.map(el => ({
      id: el.dataset.answer, label: el.getAttribute('aria-label'), text: el.querySelector('.food-name')?.textContent
    })));
    assert.deepEqual(cards.map(card => card.id).sort(), [...question.choices].sort(), 'Displayed choices match the authored question');
    for (const card of cards) {
      assert.equal(card.label, oracle.foods.get(card.id).name, 'Accessible food name matches the pictured choice');
      assert.equal(card.text, card.label, 'Visible and accessible food names agree');
    }
    return question;
  }

  async function finishRound(level, detailed) {
    const questions = [], targets = [];
    for (let index = 0; index < 5; index++) {
      const question = await displayedQuestion(level);
      questions.push(question.id); targets.push(question.answer);
      assert.equal(await f.locator('#stars .earned').count(), index);
      assert(await f.locator('#next').isHidden(), 'Unanswered question cannot advance');
      if (detailed) await checkpoint(c, `${level.id}-question-${index + 1}`, playControls);
      if (detailed && index === 0) {
        const clue = await f.locator('#prompt').textContent();
        await f.locator(`#cards button:not([data-answer="${question.answer}"])`).first().click();
        assert.equal(await f.locator('#prompt').textContent(), clue, 'Wrong answer preserves the question');
        assert.equal(await f.locator('#stars .earned').count(), 0, 'Wrong answer preserves stars');
        assert(await f.locator('#next').isHidden(), 'Wrong answer remains retryable');
        assert.equal(await f.locator('#cards button:enabled').count(), 3);
        await checkpoint(c, `${level.id}-wrong`, playControls);
      }
      await click(f, `#cards [data-answer="${question.answer}"]`);
      collectedFoods.add(question.answer);
      assert.equal(await f.locator('#stars .earned').count(), index + 1);
      assert.equal(await f.locator('#cards button:disabled').count(), 3);
      if (detailed) await checkpoint(c, `${level.id}-correct-${index + 1}`, [...playControls, '#next', '#feedback']);
      await click(f, '#next');
    }
    assert.equal(new Set(questions).size, 5, 'Five unique questions per round');
    assert.equal(new Set(targets).size, 5, 'Five different pictured answers per round');
    c.entry.foodRounds.push({ difficulty: level.id, questions, targets });
    await f.locator('#finish').waitFor({ state: 'visible' });
    assert((await f.locator('#finishLevel').textContent()).includes(level.name), 'Finish retains selected difficulty');
    assert.equal(await f.locator('#finishFoods svg').count(), 5, 'Finish shows five collected foods');
  }

  if (await f.locator('#sound').getAttribute('aria-pressed') === 'true') await click(f, '#sound');
  await checkpoint(c, 'start', startControls);
  await album('empty', startControls);
  await f.locator('#difficultyEasy').press('End');
  await assertSelection(oracle.levels.find(level => level.id === 'hard'));
  await f.locator('#difficultyHard').press('Home');
  await assertSelection(oracle.levels.find(level => level.id === 'easy'));
  for (const level of oracle.levels) {
    await click(f, `#difficultyChoices [data-difficulty="${level.id}"]`);
    await assertSelection(level);
    await checkpoint(c, `${level.id}-selected`, startControls);
    await click(f, '#startButton');
    await finishRound(level, true);
    await checkpoint(c, `${level.id}-finish`, finishControls);
    await album(`${level.id}-finish`, finishControls);
    await click(f, '#finishDifficulty');
    await f.locator('#start').waitFor({ state: 'visible' });
    await assertSelection(level);
    await checkpoint(c, `${level.id}-finish-difficulty`, startControls);
    await click(f, '#startButton');
    await finishRound(level, false);
    await click(f, '#again');
    await displayedQuestion(level);
    assert.equal(await f.locator('#stars .earned').count(), 0, 'Retry resets stars');
    assert.equal(await f.locator('#cards button:enabled').count(), 3, 'Retry restores all answers');
    await checkpoint(c, `${level.id}-retry`, playControls);
    await click(f, '#changeDifficulty');
    await f.locator('#start').waitFor({ state: 'visible' });
    await assertSelection(level);
    await checkpoint(c, `${level.id}-change-difficulty`, startControls);
  }
}

async function foodLongestFlows(browser, base) {
  const oracle = loadFoodOracle();
  const targets = viewports.filter(viewport => !viewport.phone);
  if (!targets.length) return;
  for (const mode of modes) for (const level of oracle.levels) {
    const pool = [...oracle.byClue.values()].filter(question => question.difficulty === level.id);
    const longest = [...pool].sort((a, b) => normalizeClue(b.clue).length - normalizeClue(a.clue).length || String(a.id).localeCompare(String(b.id)))[0];
    const entry = { label: `food-longest/${mode}/${level.id}`, question: longest.id, clue: longest.clue, length: normalizeClue(longest.clue).length, searched: 0, states: [] };
    report.foodLongest.push(entry);
    const page = await browser.newPage({ viewport: { width: targets[0].width, height: targets[0].height }, hasTouch: true });
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => fail(entry.label, 'Browser JavaScript error', { message: error.message }));
    try {
      await page.goto(gameURL(base, 'food', mode), { waitUntil: 'load' });
      const frame = await gameFrame(page, 'food', mode);
      await click(frame, '#sound');
      await click(frame, `#difficultyChoices [data-difficulty="${level.id}"]`);
      await click(frame, '#startButton');
      let found = false;
      const visited = new Set();
      for (let index = 0; index < pool.length; index++) {
        const clue = await frame.locator('#prompt').textContent();
        const question = oracle.byClue.get(`${level.id}:${normalizeClue(clue)}`);
        assert(question, `Visible search question belongs to ${level.id}`);
        assert(!visited.has(question.id), 'Question bank search does not repeat before exhausting its difficulty');
        visited.add(question.id); entry.searched++;
        if (question.id === longest.id) { found = true; break; }
        // Native control dispatch traverses the existing UI deck without app hooks or seeded randomness.
        const correct = frame.locator(`#cards [data-answer="${question.answer}"]`);
        assert(await correct.isEnabled(), 'Search answer is enabled');
        await correct.dispatchEvent('click');
        assert(await frame.locator('#next').isVisible(), 'Search answer unlocks Next');
        await frame.locator('#next').dispatchEvent('click');
        if (await frame.locator('#finish').isVisible()) await frame.locator('#again').dispatchEvent('click');
      }
      assert(found, `Longest ${level.id} clue was reachable through normal sessions`);
      for (const viewport of targets) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        assert.equal(normalizeClue(await frame.locator('#prompt').textContent()), normalizeClue(longest.clue), 'Resize preserves the actual longest question');
        await checkpoint({ page, frame, route: 'food', mode, viewport, entry }, `${viewport.width}x${viewport.height}`, ['#prompt', '#cards button', '#changeDifficulty', '#listen', '#levelLabel']);
      }
      console.log(`PASS ${entry.label}: ${entry.length} characters, ${entry.searched} UI questions searched, ${entry.states.length} viewports`);
    } catch (error) { fail(entry.label, 'Longest food clue flow failed', { message: error.message, stack: error.stack }); }
    finally { await page.close(); }
    fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  }
}

async function moonFlow(c) {
  const f = c.frame;
  if (await f.locator('#voiceButton').getAttribute('aria-pressed') === 'true') await click(f, '#voiceButton');
  await click(f, '#tabFriends');
  await checkpoint(c, 'friends', ['#sprunkiList']);
  await f.locator('#sprunkiList button').last().click();
  await checkpoint(c, 'friends-last-selected');
  for (const [selector, mode] of [['#tabQuiz', 'current'], ['#tabChallenge', 'future']]) {
    await click(f, selector);
    assert.equal(await f.locator('#quizPanel').getAttribute('data-mode'), mode);
    await checkpoint(c, `quiz-${mode}`, ['#quizPrompt', '#quizOptions button', '#quizNext']);
    for (let index = 0; index < await f.locator('#quizOptions button').count(); index++) {
      await f.locator('#quizOptions button').nth(index).click();
      if (await f.locator('#quizNext').isEnabled()) break;
    }
    assert(await f.locator('#quizNext').isEnabled(), `${mode} quiz can be answered`);
    await checkpoint(c, `quiz-${mode}-solved`, ['#quizNext']);
    await click(f, '#quizNext');
    assert(await f.locator('#quizNext').isDisabled(), 'Next quiz resets answer state');
  }
  await click(f, '#tabMoon');
  if (await f.locator('#albumButton').count()) {
    await f.locator('#phaseList button').last().click();
    await click(f, '#albumButton');
    assert.equal(await f.locator('#albumGrid button').count(), 16, 'Moon album retains sixteen phase slots');
    assert(await f.locator('#albumGrid button.collected').count() > 0, 'An observed phase is available in the album');
    await checkpoint(c, 'album', ['#moonAlbum', '#albumClose', '#albumStatus', '#albumGrid button']);
    await click(f, '#albumClose');
    assert(await f.locator('#moonAlbum').isHidden(), 'Album closes through its own control');
    await click(f, '#albumButton');
    await f.locator('#albumGrid button.collected').last().click();
    assert(await f.locator('#moonAlbum').isHidden(), 'Selecting an observed moon returns to the live scene');
    await checkpoint(c, 'album-recalled', ['#space', '#albumButton']);
  }
}

async function pianoFlow(c) {
  const f = c.frame;
  if (await f.locator('#soundButton').getAttribute('aria-pressed') === 'true') await click(f, '#soundButton');
  await click(f, '#menuButton');
  await checkpoint(c, 'menu', ['#gameMenu', '#menuCloseButton']);
  await click(f, '#menuCloseButton');
  await click(f, '#songButton');
  await checkpoint(c, 'song', ['#songPicker', '#songPickerClose']);
  await f.locator('#categoryTabs button').last().click();
  await checkpoint(c, 'song-last-category', ['#songPickerClose']);
  await f.locator('#songGrid button').first().click();
  await click(f, '#startButton');
  await c.page.waitForTimeout(350);
  await checkpoint(c, 'playing', ['#piano']);
  const before = await f.locator('#noteCanvas').evaluate(canvas => canvas.toDataURL());
  await c.page.waitForTimeout(250);
  const after = await f.locator('#noteCanvas').evaluate(canvas => canvas.toDataURL());
  assert.notEqual(after, before, 'Playing piano canvas must animate');
  await click(f, '#pauseButton');
  assert.equal((await f.locator('#pauseButton').textContent()).trim(), 'RESUME');
  await click(f, '#menuButton');
  await checkpoint(c, 'paused-menu', ['#pauseButton', '#menuCloseButton']);
  await click(f, '#menuCloseButton');
  await checkpoint(c, 'paused', ['#piano']);
  if (await f.locator('#melodyRecord').count()) {
    const controls = ['#melodyRecord', '#melodyPlay', '#melodyStop', '#melodyStatus', '#piano'];
    await click(f, '#melodyRecord');
    assert.equal(await f.locator('#melodyRecord').getAttribute('aria-pressed'), 'true');
    for (const index of [0, 2, 4]) await f.locator('#whiteKeys button').nth(index).click();
    await checkpoint(c, 'recorder-recording', controls);
    await click(f, '#melodyStop');
    assert.equal(await f.locator('#melodyRecord').getAttribute('aria-pressed'), 'false');
    assert.match(await f.locator('#melodyStatus').textContent(), /3\s*おん/, 'Three physical key presses were recorded');
    assert(await f.locator('#melodyPlay').isEnabled());
    await checkpoint(c, 'recorder-saved', controls);
    await click(f, '#melodyPlay');
    assert.equal(await f.locator('#melodyPlay').getAttribute('aria-pressed'), 'true');
    await checkpoint(c, 'recorder-playback', controls);
    await click(f, '#melodyStop');
    assert.equal(await f.locator('#melodyPlay').getAttribute('aria-pressed'), 'false');
    await checkpoint(c, 'recorder-stopped', controls);
  }
}

async function baibainFlow(c) {
  const f = c.frame;
  await click(f, '#step');
  assert.equal((await f.locator('#elapsed').textContent()).trim(), '00:05:00');
  await checkpoint(c, 'step');
  await click(f, '#play');
  assert.equal(await f.locator('#play').getAttribute('aria-pressed'), 'true');
  const start = Number(await f.locator('#timeline').inputValue());
  await c.page.waitForTimeout(300);
  assert(Number(await f.locator('#timeline').inputValue()) > start, 'Baibain play advances timeline');
  await click(f, '#play');
  await checkpoint(c, 'paused');
  await f.locator('#range').selectOption('86400');
  await click(f, '#openMilestones');
  await checkpoint(c, 'milestones', ['#milestonesDialog', '#milestonesDialog [data-close-dialog]']);
  await f.locator('#cosmicMilestones button').last().click();
  if (await f.locator('#milestonesDialog').isVisible()) await click(f, '#milestonesDialog [data-close-dialog]');
  await checkpoint(c, 'cosmic', ['#spaceComparison']);
  await f.locator('#timeline').evaluate(el => { el.value = '86400'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal((await f.locator('#elapsed').textContent()).trim(), '24:00:00');
  assert(await f.locator('#step').isDisabled(), '24h step is disabled');
  await checkpoint(c, '24h', ['#spaceComparison']);
  for (const [id, state] of [['exactDialog', '24h-exact'], ['observationDialog', '24h-observation'], ['assumptionsDialog', '24h-details']]) {
    await click(f, `[data-dialog="${id}"]`);
    assert(await f.locator(`#${id}`).getAttribute('open') !== null);
    await checkpoint(c, state, [`#${id}`, `#${id} [data-close-dialog]`]);
    await click(f, `#${id} [data-close-dialog]`);
    assert(await f.locator(`#${id}`).isHidden(), 'Details dialog closes via its own visible button');
  }
  if (await f.locator('#openPrediction').count()) {
    const before = await f.locator('#timeline').inputValue();
    await click(f, '#openPrediction');
    const controls = ['#predictionDialog', '#predictionChoices button', '#predictionNext', '#predictionDialog [data-close-dialog]'];
    for (let index = 0; index < 4; index++) {
      const count = Number(await f.locator('#predictionCount').textContent());
      assert.equal(await f.locator('#predictionChoices button:enabled').count(), 3);
      assert(await f.locator('#predictionNext').isDisabled());
      if (index === 0) {
        await f.locator(`#predictionChoices button:not([data-count="${count * 2}"])`).first().click();
        assert.equal(Number(await f.locator('#predictionCount').textContent()), count);
        assert(await f.locator('#predictionNext').isDisabled(), 'Wrong prediction can be retried');
        await checkpoint(c, 'prediction-wrong', controls);
      }
      await f.locator(`#predictionChoices button[data-count="${count * 2}"]`).click();
      assert(await f.locator('#predictionNext').isEnabled());
      assert.equal(await f.locator('#predictionChoices button:disabled').count(), 3);
      await checkpoint(c, `prediction-solved-${index + 1}`, controls);
      await click(f, '#predictionNext');
    }
    await checkpoint(c, 'prediction-next', controls);
    await click(f, '#predictionDialog [data-close-dialog]');
    assert(await f.locator('#predictionDialog').isHidden());
    assert.equal(await f.locator('#timeline').inputValue(), before, 'Prediction activity does not mutate the observation timeline');
  }
}

async function navigation(browser, base) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 600 } });
  page.setDefaultTimeout(5000);
  try {
    await page.goto(`${base}/index.html?game=moon`);
    for (const route of Object.keys(games)) {
      const previous = await page.evaluate(() => ({ route: document.body.dataset.game, length: history.length }));
      await page.locator('#gameNavigation #gameMenuToggle').click();
      const menu = page.locator('#gameNavigation #gameMenu');
      await menu.waitFor({ state: 'visible' });
      const menuLayout = await inspect(page.mainFrame(), { phone: false, route, requiredSelectors: ['#gameNavigation #gameMenu', '#gameNavigation #gameMenuClose', '#gameNavigation #gameMenu [data-nav-game]'], wrapper: true });
      for (const issue of menuLayout.issues) fail(`navigation/${route}/menu`, issue.kind, issue);
      if (screenshots) await page.screenshot({ path: path.join(artifacts, `navigation-${route}-menu.png`) });
      await menu.locator(`[data-nav-game="${route}"]`).click();
      await page.waitForURL(url => url.searchParams.get('game') === route);
      await gameFrame(page, route, 'embedded');
      assert(await menu.isHidden(), 'Choosing a game closes the shell menu');
      assert.equal(await page.evaluate(() => history.length), previous.length + (previous.route === route ? 0 : 1), 'Only the top-level route adds a history entry');
      await checkNav(page, route, { width: 1024, height: 600 }, `navigation/${route}`);
      assert.equal(page.frames().length, 2, 'Navigation never nests wrappers');
      report.navigation.push(route);
    }
    await page.evaluate(() => history.back());
    const backRoute = Object.keys(games).at(-2), forwardRoute = Object.keys(games).at(-1);
    await page.waitForURL(url => url.searchParams.get('game') === backRoute);
    await gameFrame(page, backRoute, 'embedded');
    await checkNav(page, backRoute, { width: 1024, height: 600 }, 'navigation/history-back');
    report.navigation.push('history-back');
    await page.evaluate(() => history.forward());
    await page.waitForURL(url => url.searchParams.get('game') === forwardRoute);
    await gameFrame(page, forwardRoute, 'embedded');
    await checkNav(page, forwardRoute, { width: 1024, height: 600 }, 'navigation/history-forward');
    report.navigation.push('history-forward');
    report.redirects = [];
    for (const route of Object.keys(games)) {
      // The initial HTML intentionally replaces itself; wait for the destination,
      // not the load event of an abandoned document and its media requests.
      await page.goto(`${base}/${games[route]}`, { waitUntil: 'commit' });
      await page.waitForURL(url => url.pathname.endsWith('/index.html') && url.searchParams.get('game') === route, { waitUntil: 'domcontentloaded' });
      await gameFrame(page, route, 'embedded');
      await checkNav(page, route, { width: 1024, height: 600 }, `navigation/${route}/direct-redirect`);
      report.redirects.push({ route, url: page.url() });
    }
  } catch (error) { fail('navigation', error.message, await page.evaluate(() => ({ url: location.href, active: document.body.dataset.game, historyLength: history.length, iframe: document.querySelector('iframe')?.getAttribute('src') })).catch(() => ({}))); }
  finally { await page.close(); }
}

async function detectorSelfTest(browser) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 600 } });
  try {
    await page.setContent('<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}button{position:absolute;left:20px;top:30px;width:50px;height:18px;white-space:nowrap;overflow:hidden}.clip{position:absolute;top:100px;width:50px;height:50px;overflow:hidden}.clip button{left:80px;top:0;width:50px;height:40px}#outside{position:absolute;top:700px}canvas{position:absolute;top:200px;width:300px;height:150px}</style><button>Unmistakably overflowing button label</button><div class="clip"><button>Clip</button></div><button id="outside">Below</button><canvas width="300" height="150"></canvas>');
    const result = await inspect(page.mainFrame(), { phone: false, route: 'piano', requiredSelectors: ['#outside'], wrapper: false });
    for (const kind of ['button text exceeds button rectangle', 'element horizontally clipped by ancestor', 'required gameplay control outside viewport', 'blank or uniform media']) {
      assert(result.issues.some(issue => issue.kind === kind), `Detector self-test must catch ${kind} despite body overflow:hidden`);
    }
    await page.locator('canvas').evaluate(canvas => {
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(10, 10, 120, 8);
    });
    const sparse = await inspect(page.mainFrame(), { phone: false, route: 'piano', requiredSelectors: [], wrapper: false });
    assert(!sparse.issues.some(issue => issue.kind === 'blank or uniform media'), 'Sparse monochrome drawing over transparency is not blank');
    await page.setContent('<svg width="0" height="0"><defs><symbol id="sample" viewBox="0 0 40 34"><path d="M2 2H38V32H2Z" fill="#d69a53"/><path d="M8 8H30V25H8Z" fill="#75472d"/></symbol></defs></svg><svg class="prediction-bun" width="40" height="34" viewBox="0 0 40 34"><use href="#sample"/></svg><p id="predictionFeedback" role="status"></p>');
    const sprite = await inspect(page.mainFrame(), { phone: false, route: 'baibain', requiredSelectors: [], wrapper: false });
    assert.equal(sprite.media.length, 1, 'The actual sprite is inspected');
    assert(sprite.media[0].nontransparentPixels > 10 && sprite.media[0].colors > 1, 'Referenced SVG symbol renders in the pixel detector');
    assert(!sprite.issues.length, 'Valid SVG use and empty live status are not false positives');
    report.detectorSelfTest = 'PASS: text overflow, clipped child, offscreen gameplay, blank versus sparse canvas, SVG symbols and empty status';
  } finally { await page.close(); }
}

async function run() {
  assert(navigationOnly || viewports.filter(viewport => !viewport.phone).length < 6 || process.env.IPAD_FINAL_READY === '1', 'Wait for the parent final-ready handoff, then set IPAD_FINAL_READY=1 for the full matrix; use IPAD_VIEWPORTS=1024x600 for interim checks');
  fs.mkdirSync(artifacts, { recursive: true });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    await detectorSelfTest(browser);
    if (navigationOnly) { await navigation(browser, base); return; }
    for (const viewport of viewports) for (const mode of modes) for (const route of routes) {
      const entry = { label: `${route}/${mode}/${viewport.width}x${viewport.height}`, states: [] };
      report.cases.push(entry);
      const countBefore = report.failures.length;
      const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1, hasTouch: true });
      page.setDefaultTimeout(5000);
      page.on('pageerror', error => fail(entry.label, 'Browser JavaScript error', { message: error.message }));
      page.on('response', response => {
        if (response.url().startsWith(base) && !response.ok() && !response.url().endsWith('/favicon.ico')) fail(entry.label, 'Asset request failed', { status: response.status(), url: response.url() });
      });
      try {
        await page.goto(gameURL(base, route, mode), { waitUntil: 'load' });
        const frame = await gameFrame(page, route, mode);
        await frame.locator(required[route][0]).waitFor();
        await settle(frame, 180);
        entry.theme = await theme(frame, route, mode === 'embedded', entry.label);
        const context = { page, frame, route, mode, viewport, entry };
        await checkpoint(context, 'initial');
        if (!layoutOnly) await ({ addition: additionFlow, guess: guessFlow, food: foodFlow, moon: moonFlow, piano: pianoFlow, baibain: baibainFlow, english: englishFlow })[route](context);
      } catch (error) {
        fail(entry.label, 'Game flow failed', { message: error.message, stack: error.stack });
        if (screenshots) await page.screenshot({ path: path.join(artifacts, `${entry.label.replaceAll('/', '-')}-flow-error.png`) }).catch(() => {});
      } finally { await page.close(); }
      const count = report.failures.length - countBefore;
      console.log(`${count ? 'FAIL' : 'PASS'} ${entry.label}: ${entry.states.length} states, ${count} issues`);
      fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
    }
    if (!layoutOnly && routes.includes('food') && process.env.IPAD_FOOD_LONGEST !== '0') await foodLongestFlows(browser, base);
    if (!layoutOnly && modes.includes('embedded') && routes.length === Object.keys(games).length) await navigation(browser, base);
  } finally { if (browser) await browser.close(); }
}

run().catch(error => { fail('runner', error.message); }).finally(async () => {
  if (server.listening) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  report.finished = new Date().toISOString();
  fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  const checkpoints = report.cases.reduce((sum, entry) => sum + entry.states.length, 0);
  const longestChecks = report.foodLongest.reduce((sum, entry) => sum + entry.states.length, 0);
  console.log(`\n${report.failures.length ? 'FAIL' : 'PASS'}: ${report.cases.length} route/viewports, ${checkpoints} checkpoints, ${longestChecks} longest-clue checks, ${report.navigation.length} navigation checks, ${report.failures.length} issues. Report: ${path.join(artifacts, 'report.json')}`);
  for (const failure of report.failures.slice(0, 20)) console.error(`${failure.label}: ${failure.message} ${JSON.stringify(failure.details || {})}`);
  if ((!navigationOnly && (!report.cases.length || !checkpoints)) || (navigationOnly && report.navigation.length !== Object.keys(games).length + 2) || report.failures.length) process.exitCode = 1;
});
