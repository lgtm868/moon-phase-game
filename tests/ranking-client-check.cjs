'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/shohe/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'games-ranking.js'), 'utf8');
new (require('node:vm').Script)(script);
const calls = [], errors = [];
let failScore = false, slowEasy = false;
const run = (id, mode = 'easy') => ({ runId: 'test-ranking-' + id, game: 'food', mode, metrics: { firstTry: 4, completed: 5, total: 5 } });
function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/games-ranking.css"><body data-game="food"><button data-ranking-open>らんきんぐ</button><script>window.MOON_RANKING_CONFIG={apiBase:location.origin};window.__moonRankingQueue=[' + JSON.stringify(run('queued-run')) + ']</script><script src="/games-ranking.js"></script></body></html>'); return;
  }
  if (url.pathname === '/games-ranking.js' || url.pathname === '/games-ranking.css') {
    res.writeHead(200, { 'Content-Type': url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css' }); res.end(fs.readFileSync(path.join(root, url.pathname.slice(1)))); return;
  }
  if (url.pathname === '/api/leaderboards') {
    calls.push({ method: req.method, path: url.pathname, game: url.searchParams.get('game'), mode: url.searchParams.get('mode') });
    const mode = url.searchParams.get('mode');
    if (slowEasy && mode === 'easy') await new Promise(resolve => setTimeout(resolve, 180));
    json(res, 200, { entries: [{ rank: 1, alias: mode === 'hard' ? 'ほしの ねこ' : '<img src=x onerror=alert(1)>', score: 4, unit: 'こ' }] }); return;
  }
  if (req.method === 'POST') {
    let raw = ''; for await (const chunk of req) raw += chunk;
    calls.push({ method: req.method, path: url.pathname, body: JSON.parse(raw), auth: req.headers.authorization });
    if (url.pathname === '/api/players') { json(res, 200, { token: 'test-anonymous-token', alias: 'そらの ぱんだ' }); return; }
    if (url.pathname === '/api/scores') {
      if (failScore) { failScore = false; json(res, 503, { error: { code: 'temporary', message: 'temporary' } }); return; }
      json(res, 200, { entry: { rank: 2, alias: 'そらの ぱんだ', score: 4 }, duplicate: false }); return;
    }
  }
    const candidate = path.resolve(root, '.' + decodeURIComponent(url.pathname));
  if (req.method === 'GET' && candidate.startsWith(root + path.sep) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.png':'image/png', '.mp3':'audio/mpeg' };
    res.writeHead(200, { 'Content-Type': types[path.extname(candidate)] || 'application/octet-stream' }); res.end(fs.readFileSync(candidate)); return;
  }
  res.writeHead(404); res.end();
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    assert.equal(calls.length, 0, 'Neither bootstrap nor queued completion makes network requests');
    assert.equal(await page.locator('[data-ranking-open]').textContent(), 'きろく', 'Pending navigation label stays compact');
    assert.equal(await page.locator('[data-ranking-open]').getAttribute('aria-label'), 'できた きろくを らんきんぐに のせる', 'Accessible label preserves full publishing action');
    assert.equal(await page.locator('#moonRankingDialog').evaluate(el => el.open), false, 'Completion does not open rankings automatically');
    await page.locator('[data-ranking-open]').click();
    await page.locator('#mrList li').waitFor();
    assert.equal(calls.filter(c => c.method === 'POST').length, 0, 'Viewing rankings and choosing an alias never publishes');
    assert.equal(await page.locator('#mrList img').count(), 0, 'Server names are rendered as text, never HTML');
    assert.equal(await page.locator('#mrPublish').textContent(), 'きろくを のせる', 'Dialog publish CTA keeps its full label');
    assert.equal(await page.locator('#mrAlias option').count(), 6, 'Only six predefined anonymous aliases');
    await page.locator('#mrAlias').selectOption('star-cat');
    assert.equal(calls.filter(c => c.method === 'POST').length, 0);
    await page.locator('#mrPublish').click();
    await page.waitForFunction(() => document.getElementById('mrPublish').textContent === 'のせたよ！');
    const posts = calls.filter(c => c.method === 'POST');
    assert.equal(posts.length, 2);
    assert.deepEqual(posts[0].body, { aliasId: 'star-cat' });
    assert.equal(posts[1].auth, 'Bearer test-anonymous-token');
    assert.deepEqual(posts[1].body, run('queued-run'));
    assert.equal(await page.evaluate(value => window.MoonRanking.complete(value), run('queued-run')), false, 'Duplicate completed runs remain published once');
    assert.equal(await page.evaluate(() => window.MoonRanking.complete({ runId: 'bad', game: 'food', mode: 'easy', metrics: { firstTry: 99, completed: 5, total: 5 } })), false);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#moonRankingDialog').evaluate(el => el.open), false);
    assert.equal(await page.locator('[data-ranking-open]').evaluate(el => el === document.activeElement), true, 'Focus returns after Escape');
    failScore = true;
    await page.evaluate(value => window.MoonRanking.complete(value), run('retry-run'));
    await page.locator('[data-ranking-open]').click();
    await page.locator('#mrPublish').click();
    await page.waitForFunction(() => document.getElementById('mrPublishStatus').textContent.includes('まだ のせられなかった'));
    assert.equal(await page.locator('#mrPublish').isEnabled(), true, 'Failed publishing offers explicit retry');
    await page.locator('#mrPublish').click();
    await page.waitForFunction(() => document.getElementById('mrPublish').textContent === 'のせたよ！');
    assert.equal(calls.filter(c => c.path === '/api/players').length, 1, 'Anonymous token reused');
    assert.equal(calls.filter(c => c.path === '/api/scores' && c.body.runId === 'test-ranking-retry-run').length, 2, 'Retry keeps the same idempotent run ID');
    slowEasy = true;
    await page.locator('#mrMode').selectOption('hard');
    await page.waitForFunction(() => document.getElementById('mrList').textContent.includes('ほしの ねこ'));
    await page.locator('#mrMode').selectOption('easy');
    await page.locator('#mrMode').selectOption('hard');
    await page.waitForTimeout(240);
    assert((await page.locator('#mrList').textContent()).includes('ほしの ねこ'), 'Stale board responses cannot overwrite selected mode');
    for (const [width, height] of [[320,568], [390,844], [1024,600]]) {
      await page.setViewportSize({ width, height });
      const layout = await page.locator('#moonRankingDialog').evaluate(el => {
        const r = el.getBoundingClientRect(), close = el.querySelector('.mr-close').getBoundingClientRect(), back = el.querySelector('.mr-return').getBoundingClientRect();
        return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, close:[close.width,close.height], back:[back.width,back.height], overflow:el.scrollWidth>el.clientWidth+1 };
      });
      assert(layout.left >= -1 && layout.right <= width+1 && layout.top >= -1 && layout.bottom <= height+1, 'Dialog fits '+width+'x'+height);
      assert(layout.close.every(v => v>=44) && layout.back.every(v=>v>=44), '44px close/return targets');
      assert(!layout.overflow, 'No horizontal dialog overflow');
    }
    await page.keyboard.press('Escape');
    await page.evaluate(() => { window.MOON_RANKING_CONFIG.apiBase=''; window.MoonRanking.open(); });
    await page.waitForFunction(() => document.getElementById('mrStatus').textContent.includes('じゅんびちゅう'));
    assert.equal(await page.locator('#mrList li').count(),0,'No fake offline ranking');
    const blockedStorage = await browser.newPage();
    await blockedStorage.addInitScript(() => { Object.defineProperty(window,'localStorage',{get(){throw new Error('blocked')}}); });
    await blockedStorage.goto(origin);
    await blockedStorage.locator('[data-ranking-open]').click();
    await blockedStorage.locator('#mrPublish').click();
    await blockedStorage.waitForFunction(() => document.getElementById('mrPublish').textContent === 'のせたよ！');
        const integrated = await browser.newPage({ viewport: { width:1024, height:600 } });
    await integrated.goto(origin + '/index.html?game=piano');
    await integrated.locator('[data-game-nav-actions] [data-ranking-open]').waitFor();
    const pianoFrame = integrated.frameLocator('#gameFrame');
    await pianoFrame.locator('#moonRankingLaunch').waitFor({ state:'attached' });
    assert.equal(await pianoFrame.locator('#moonRankingLaunch').isVisible(),false,'Embedded fallback cannot overlap piano keys');
    const occluded = await pianoFrame.locator('#piano').evaluate(piano => [...piano.querySelectorAll('.piano-key')].filter(key => {
      const r = key.getBoundingClientRect(); if (!r.width || !r.height) return false;
      const hit = document.elementFromPoint(r.left+r.width/2,r.bottom-12);
      return hit && !key.contains(hit) && hit!==key && hit.closest('.moon-ranking-launch');
    }).length);
    assert.equal(occluded,0,'No piano key covered by ranking launch button at 1024x600');
    await pianoFrame.locator('body').evaluate(() => { window.MOON_RANKING_CONFIG.apiBase=location.origin; });
    await integrated.locator('[data-ranking-open]').click();
    await pianoFrame.locator('#moonRankingDialog').waitFor({state:'visible'});
    assert.equal(await integrated.locator('#moonRankingDialog').evaluate(el=>el.open),false,'Parent delegates rankings to current iframe');
    await pianoFrame.locator('.mr-close').click();
    assert.equal(await integrated.locator('[data-ranking-open]').evaluate(el=>el===document.activeElement),true,'Parent nav focus restored after child dialog closes');
            await integrated.setViewportSize({width:1133,height:744});
    await pianoFrame.locator('body').evaluate(()=>window.MoonRanking.complete({runId:'test-ranking-compact-label',game:'piano',mode:'twinkle',metrics:{perfect:1,great:0,good:0,ok:0,miss:0,maxCombo:1,noteCount:1}}));
    assert.equal(await integrated.locator('[data-ranking-open]').textContent(),'きろく','1133px wide navigation uses compact pending label');
    const pendingLabelFits=await integrated.locator('[data-ranking-open]').evaluate(button=>{
      const range=document.createRange();range.selectNodeContents(button);const text=range.getBoundingClientRect(),box=button.getBoundingClientRect();
      return text.left>=box.left-1&&text.right<=box.right+1&&text.top>=box.top-1&&text.bottom<=box.bottom+1;
    });
    assert(pendingLabelFits,'Pending nav label stays within its button at1133px');
    const standaloneReports=[];
    for (const [file,dock] of [['moon-phase-game.html','.scene-actions'],['english-game.html','.app > header']]) {
      const standalone = await browser.newPage({viewport:{width:1024,height:600}});
      await standalone.goto(origin+'/'+file+'?standalone=1');
      await standalone.locator('#moonRankingLaunch').waitFor({state:'visible'});
      const dimensions = await standalone.locator('#moonRankingLaunch').evaluate((button,selector)=>{
        const rect=button.getBoundingClientRect();
        return {dock:button.parentElement.matches(selector),top:rect.top,bottom:rect.bottom,height:document.documentElement.scrollHeight,body:document.body.scrollHeight};
      },dock);
      assert(dimensions.dock, file+': launch docks inside existing header');
      assert(dimensions.top>=0&&dimensions.bottom<=601,file+': ranking launch inside 600px viewport '+JSON.stringify(dimensions));
      assert(dimensions.height<=602,file+': no added document overflow '+JSON.stringify(dimensions));
      await standalone.evaluate(()=>{window.MOON_RANKING_CONFIG.apiBase=location.origin;window.MoonRanking.open();});
      await standalone.locator('#mrList li').waitFor();
      const radii=await standalone.locator('#moonRankingDialog').evaluate(dialog=>[dialog,...dialog.querySelectorAll('button,select,.mr-publish,.mr-entry')].map(el=>parseFloat(getComputedStyle(el).borderTopLeftRadius)));
      standaloneReports.push({file,dimensions,radii});
      await standalone.close();
    }
    console.log('Standalone600:',JSON.stringify(standaloneReports));
    assert(standaloneReports.every(report=>report.radii.every(radius=>radius<=8)), 'All ranking surfaces/controls have radius <=8');
    assert.deepEqual(errors, []);
    console.log('PASS ranking client: no unsolicited writes/open, queued result, fixed aliases, text-only server data, auth, duplicate guard, retry same run ID, stale reads, Escape/focus, responsive dialog, offline honesty, storage unavailable.');
  } finally { if (browser) await browser.close(); await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}); }
})().catch(error => { console.error(error); process.exitCode=1; });
