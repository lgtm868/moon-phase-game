'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const context = {};
vm.runInNewContext(fs.readFileSync(path.join(root, 'moon-friends.js'), 'utf8'), context);
const friends = context.MoonFriends;
assert.equal(friends.length, 65);
assert.equal(new Set(friends.map(c => c.id)).size, 65);
assert.equal(friends.filter(c => c.group === 'サンリオ').length, 20);
assert.equal(friends.filter(c => c.group === 'ポケモン').length, 40);
for (const friend of friends) {
  assert.equal(friend.language, 'ja');
  assert(!friend.audio && !friend.music, 'No unrelated character music');
  assert(fs.statSync(path.join(root, friend.file)).size > 100);
}
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  fs.readFile(file, (err, data) => {
    if (err) return res.writeHead(404).end();
    const types = {'.svg':'image/svg+xml','.png':'image/png','.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.wav':'audio/wav','.mp3':'audio/mpeg'};
    res.writeHead(200, {'Content-Type':types[path.extname(file)] || 'application/octet-stream'}).end(data);
  });
});
(async () => {
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({headless:true, executablePath:process.env.CHROME_EXECUTABLE});
    const errors = [];
    for (const viewport of [{width:1280,height:800},{width:375,height:667},{width:844,height:390}]) {
      const page = await browser.newPage({viewport});
      page.on('pageerror', e => errors.push(e.message));
      page.on('response', r => {if(r.url().startsWith('http://127.0.0.1') && r.status() >= 400) errors.push(r.url());});
      await page.goto(`http://127.0.0.1:${server.address().port}/index.html?game=moon`);
      const frame = await (await page.locator('#gameFrame').elementHandle()).contentFrame();
      await frame.locator('#tabFriends').click();
      const buttons = frame.locator('#sprunkiList .sprunki-choice');
      assert.equal(await buttons.count(),100);
      assert.equal(new Set(await buttons.evaluateAll(bs=>bs.map(b=>b.dataset.characterId))).size,100);
      await frame.waitForFunction(()=>[...document.querySelectorAll('#sprunkiList img')].every(i=>i.complete && i.naturalWidth>0));
      for (const id of ['hello-kitty','kuromi','cinnamoroll','doraemon','pokemon-25','pokemon-778']) {
        const button=frame.locator(`[data-character-id="${id}"]`);
        await button.click();
        assert.equal(await button.getAttribute('aria-pressed'),'true');
        await button.click();
        assert.equal(await button.getAttribute('aria-pressed'),'false');
      }
      const geometry=await frame.locator('#sprunkiList').evaluate(el=>({height:el.clientHeight,scroll:el.scrollHeight,bottom:el.getBoundingClientRect().bottom,screen:innerHeight}));
      assert(geometry.height>0 && geometry.scroll>geometry.height,'Roster scrolls');
      assert(geometry.bottom<=geometry.screen+1,'Roster stays inside game viewport');
      // Stress canvas layout and selection bookkeeping with the full roster.
      await buttons.evaluateAll(bs=>bs.forEach(b=>{if(b.getAttribute('aria-pressed')!=='true')b.click();}));
      assert.equal(await frame.locator('.sprunki-choice[aria-pressed="true"]').count(),100);
      if(viewport.width===1280) await page.screenshot({path:'/tmp/moon-friends-100.png'});
      await page.close();
      console.log(`PASS ${viewport.width}x${viewport.height}: 100 images, Japanese roster, last-card access, toggle selection, all-selected render`);
    }
    assert.deepEqual(errors,[]);
  } finally {await browser?.close(); await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
