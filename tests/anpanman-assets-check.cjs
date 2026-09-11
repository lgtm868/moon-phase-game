'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const runtime = 'C:/Users/shohe/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/';
const { PNG } = require(runtime + 'pngjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || runtime + 'playwright');
const root = path.resolve(__dirname, '..');
const ids = ['anpanman','baikinman','dokinchan','shokupanman','currypanman','melonpanna','rollpanna','creampanda','jamojisan','batakosan'];
const html = fs.readFileSync(path.join(root, 'moon-phase-game.html'), 'utf8');
const artifact = path.join(root, 'output', 'anpanman-assets');
fs.mkdirSync(artifact, { recursive: true });
const report = { status: 'running', assets: [], viewports: [], limits: 'Per-draw pixel differences prove rendering, not final overlap-free visibility, likeness or official authorization.' };
const reportFile = path.join(artifact,'report.json');
fs.writeFileSync(reportFile,JSON.stringify(report,null,2));
(async () => {
  for (const id of ids) {
    const file = 'assets/anpanman/' + id + '.png';
    assert(html.includes('file: "' + file + '"'), id + ': game must reference the new image');
    const png = PNG.sync.read(fs.readFileSync(path.join(root, file)));
    let transparent = 0, visible = 0, left = png.width, top = png.height, right = 0, bottom = 0;
    for (let y=0; y<png.height; y++) for(let x=0; x<png.width; x++) {
      const alpha = png.data[(y*png.width+x)*4+3];
      if (alpha < 8) transparent++;
      if (alpha > 32) {visible++;left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
    }
    assert(png.width >= 256 && png.height >= 256, id + ': adequate resolution');
    assert(transparent / (png.width*png.height) > .15, id + ': real transparent background required');
    assert(visible / (png.width*png.height) > .08, id + ': nonempty sprite');
    assert(left > 1 && top > 1 && right < png.width-2 && bottom < png.height-2, id + ': silhouette must not touch image edges');
    report.assets.push({id,file,width:png.width,height:png.height,transparent:transparent/(png.width*png.height),bounds:{left,top,right,bottom}});
  }
  const browser = await chromium.launch({headless:true,channel:'chrome',args:['--allow-file-access-from-files']});
  try {
    for (const [width,height] of [[1024,600],[1180,820],[390,844]]) {
      const page = await browser.newPage({viewport:{width,height}});
      await page.addInitScript(() => {
        const original = CanvasRenderingContext2D.prototype.drawImage;
        window.__spriteDraws = {};
        CanvasRenderingContext2D.prototype.drawImage = function(image, ...args) {
          const src = image instanceof HTMLImageElement ? image.src : '';
          if (this.canvas.id !== 'space' || !src || !window.__auditSprites?.includes(src) || window.__spriteDraws[src] >= 4) {
            return original.call(this, image, ...args);
          }
          // Compare the same draw operation, so orbit animation cannot fake a pass.
          const before = this.getImageData(0, 0, this.canvas.width, this.canvas.height).data;
          const result = original.call(this, image, ...args);
          const after = this.getImageData(0, 0, this.canvas.width, this.canvas.height).data;
          let changed = 0;
          for (let i = 0; i < after.length; i += 4) {
            if (after[i+3] > 32 && (Math.abs(after[i]-before[i]) > 8 || Math.abs(after[i+1]-before[i+1]) > 8 || Math.abs(after[i+2]-before[i+2]) > 8 || Math.abs(after[i+3]-before[i+3]) > 8)) changed++;
          }
          window.__spriteDraws[src] = Math.max(window.__spriteDraws[src] || 0, changed);
          return result;
        };
      });
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(pathToFileURL(path.join(root,'moon-phase-game.html')).href);
      await page.locator('#tabFriends').click();
      const sprites = page.locator('#sprunkiList img[src*="assets/anpanman/"]');
      assert.equal(await sprites.count(),10);
      await page.waitForFunction(()=>[...document.querySelectorAll('#sprunkiList img[src*="assets/anpanman/"]')].every(img=>img.complete&&img.naturalWidth>=256));
      await page.evaluate(() => {
        window.__auditSprites = [...document.querySelectorAll('#sprunkiList img')].map(img => img.src);
      });
      const selections = [];
      for(let i=0;i<10;i++) {
        const sprite = sprites.nth(i);
        const src = await sprite.getAttribute('src');
        await page.evaluate(() => { window.__spriteDraws = {}; });
        await sprite.click();
        assert.equal(await sprite.locator('..').getAttribute('aria-pressed'), 'true');
        await page.waitForFunction(src => (window.__spriteDraws[src] || 0) >= 4, src);
        selections.push({id:ids[i],changedPixels:await page.evaluate(src => window.__spriteDraws[src],src)});
      }
      const viewportReport = {width,height,selections,combinedStatus:'pending'};
      report.viewports.push(viewportReport);
      const choices = page.locator('#sprunkiList .sprunki-choice');
      assert.equal(await choices.count(),35,'Combined roster must contain 20 base, 10 Anpanman and 5 MOD characters');
      await page.waitForFunction(() => [...document.querySelectorAll('#sprunkiList img')].every(img => img.complete));
      const missing = await page.locator('#sprunkiList img').evaluateAll(images => images.filter(img => !img.naturalWidth).map(img => img.src));
      assert.deepEqual(missing, [], 'Combined roster assets must be ready: ' + missing.join(', '));
      for(let i=0;i<35;i++) {
        if(await choices.nth(i).getAttribute('aria-pressed') !== 'true') await choices.nth(i).click();
      }
      assert.equal(await page.locator('#sprunkiList [aria-pressed="true"]').count(),35);
      await page.evaluate(() => { window.__spriteDraws = {}; });
      await page.waitForFunction(() => window.__auditSprites.every(src => (window.__spriteDraws[src] || 0) >= 4));
      const combined = await page.evaluate(() => window.__auditSprites.map(src => ({src,changedPixels:window.__spriteDraws[src]})));
      const overflow = await page.evaluate(()=>({x:document.documentElement.scrollWidth>innerWidth+1,y:document.documentElement.scrollHeight>innerHeight+1}));
      assert.deepEqual(overflow,{x:false,y:false});
      assert.deepEqual(errors,[]);
      await page.screenshot({path:path.join(artifact,`friends-${width}x${height}.png`)});
      Object.assign(viewportReport,{loaded:35,combinedStatus:'passed',combined,overflow});
      await page.close();
    }
  } finally {await browser.close();}
  report.status = 'passed';
  fs.writeFileSync(reportFile,JSON.stringify(report,null,2));
  console.log('PASS 10 transparent sprite assets; actual sprite draw pixel changes and combined 35 selection/fit in 3 viewports. Likeness requires visual review.');
})().catch(error=>{report.status='failed';report.error=error.message;fs.writeFileSync(reportFile,JSON.stringify(report,null,2));console.error(error);process.exitCode=1;});
