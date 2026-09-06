'use strict';
/* Public, read-only smoke. Requires --run after the publication owner confirms readiness.
 * Every non-read HTTP method is blocked before it reaches any remote server.
 * This test opens boards only; it never completes games, creates players or posts scores.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/shohe/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const PUBLIC_URL = 'https://lgtm868.github.io/moon-phase-game/';
const API_ORIGIN = 'https://moon-games-ranking.abccasfda.chatgpt.site';
const games = ['moon','piano','addition','guess','baibain','food','english'];
const defaultModes = { moon:'current', piano:'twinkle', addition:'add-5', guess:'default', baibain:'discoveries', food:'easy', english:'animals' };
const artifacts = path.resolve(__dirname,'../output/ranking-public-check');
async function main() {
  if (!process.argv.includes('--run')) { console.log('Prepared only. After publication confirmation: node tests/ranking-public-check.cjs --run'); return; }
  fs.mkdirSync(artifacts,{recursive:true});
  const report = { started:new Date().toISOString(), publicURL:PUBLIC_URL, viewport:{width:1133,height:744}, readOnly:true, cases:[], blockedWrites:[], scriptErrors:[], failedResources:[] };
  const browser = await chromium.launch({ executablePath:process.env.CHROME_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true });
  const context = await browser.newContext({ viewport:report.viewport, serviceWorkers:'block' });
  await context.route('**/*', route => {
    const request=route.request();
    if (!['GET','HEAD','OPTIONS'].includes(request.method())) {
      report.blockedWrites.push({method:request.method(),url:request.url()});
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  const page = await context.newPage();
  let activeGame='';
  page.on('pageerror',error=>report.scriptErrors.push({game:activeGame,message:error.message}));
  page.on('response',response=>{
    if(response.status()>=400&&response.url().startsWith(PUBLIC_URL)) report.failedResources.push({game:activeGame,status:response.status(),url:response.url()});
  });
  try {
    for (const game of games) {
      activeGame=game;
      const result={game,mode:defaultModes[game],pageStatus:null,apiStatus:null,entries:null,displayStatus:null,passed:false};
      report.cases.push(result);
      try {
        const response=await page.goto(PUBLIC_URL+'?game='+game,{waitUntil:'domcontentloaded',timeout:45000});
        result.pageStatus=response?.status();
        assert.equal(result.pageStatus,200,game+': published page responds 200');
        const parentButton=page.locator('#gameNavigation [data-ranking-open]');
        await parentButton.waitFor({state:'visible',timeout:30000});
        const gameFrame=page.frameLocator('#gameFrame');
        await gameFrame.locator('body').waitFor({state:'visible',timeout:30000});
        assert.equal(await gameFrame.locator('body').getAttribute('data-game'),game,game+': correct game iframe');
        await page.waitForFunction(()=>document.getElementById('gameFrame')?.contentWindow?.MoonRanking?.ready===true,{},{timeout:30000});
        assert.equal(await gameFrame.locator('#moonRankingDialog').evaluate(dialog=>dialog.open),false,game+': ranking not opened automatically');
        const boardResponsePromise=page.waitForResponse(response=>{
          const url=new URL(response.url());
          return url.origin===API_ORIGIN&&url.pathname==='/api/leaderboards'&&url.searchParams.get('game')===game&&response.request().method()==='GET';
        },{timeout:30000});
        await parentButton.click();
        const boardResponse=await boardResponsePromise;
        result.apiStatus=boardResponse.status();
        assert.equal(result.apiStatus,200,game+': leaderboard API responds 200');
        const board=await boardResponse.json();
        assert(Array.isArray(board.entries),game+': valid leaderboard response');
        result.entries=board.entries.length;
        await gameFrame.locator('#moonRankingDialog').waitFor({state:'visible'});
        assert.equal(await gameFrame.locator('#mrGame').inputValue(),game,game+': correct board selection');
        result.mode=await gameFrame.locator('#mrMode').inputValue();
        assert.equal(result.mode,defaultModes[game],game+': expected default mode');
        await gameFrame.locator('#mrList').getAttribute('aria-busy');
        await page.waitForFunction(()=>document.getElementById('gameFrame')?.contentDocument?.getElementById('mrList')?.getAttribute('aria-busy')==='false',{},{timeout:15000});
        result.displayStatus=await gameFrame.locator('#mrStatus').textContent();
        assert(result.displayStatus==='みんなの きろく'||result.displayStatus.includes('まだ きろくが ない'),game+': success or honest empty-state copy');
        assert.equal(await gameFrame.locator('.mr-publish').isVisible(),false,game+': no invented score or publication offer without play');
        assert.equal(await gameFrame.locator('#mrList li').count(),Math.min(board.entries.length,100),game+': rendered server entries');
        await page.screenshot({path:path.join(artifacts,game+'-ranking.png'),fullPage:false});
        await gameFrame.locator('.mr-close').click();
        assert.equal(await gameFrame.locator('#moonRankingDialog').evaluate(dialog=>dialog.open),false,game+': closes');
        assert.equal(await parentButton.evaluate(button=>button===document.activeElement),true,game+': parent focus restored');
        result.passed=true;
        console.log('PASS public GET/UI '+game+'/'+result.mode+': page200 API200, '+result.entries+' entries');
      } catch(error) {
        result.error=error.message;
        await page.screenshot({path:path.join(artifacts,game+'-failure.png'),fullPage:false}).catch(()=>{});
        // Missing published assets are reported once; the caller decides when to retry.
        if(report.failedResources.length||!result.apiStatus) throw error;
      }
    }
    assert.equal(report.blockedWrites.length,0,'No attempted network writes');
    assert.deepEqual(report.scriptErrors,[],'No published JavaScript exceptions');
    assert.deepEqual(report.failedResources,[],'No missing published UI assets');
    assert(report.cases.length===7&&report.cases.every(result=>result.passed),'All seven public ranking paths pass');
    report.passed=true;
    console.log('PASS public ranking smoke: seven games, GET-only shared boards, zero POST/PUT/PATCH/DELETE.');
  } finally {
    report.finished=new Date().toISOString();
    fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify(report,null,2)+'\n');
    await context.close(); await browser.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
