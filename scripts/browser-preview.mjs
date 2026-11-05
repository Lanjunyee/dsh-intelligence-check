import path from 'node:path';
import assert from 'node:assert/strict';

export async function verifyPreviews({ page, context, fixture, root, errors }) {
  await page.locator('#tab-tests').click();await page.locator('#prompt').selectOption('svg');
  fixture.manualSVG='```svg\n<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"><script>window.previewExecuted=true</script><rect width="200" height="100" fill="red"/><image href="https://external.invalid/pixel.png"/></svg>\n```';
  await page.locator('#run').click();
  await page.waitForFunction(()=>document.querySelector('#svgImage').naturalWidth===200,{},{timeout:15000});
  assert.equal(await page.evaluate(()=>window.previewExecuted),undefined);
  const pixels=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=200;canvas.height=100;
    const ctx=canvas.getContext('2d');ctx.drawImage(document.querySelector('#svgImage'),0,0);
    return [...ctx.getImageData(50,50,1,1).data];
  });
  assert.deepEqual(pixels,[255,0,0,255],'preview is not generated output');
  await page.locator('#prompt').selectOption('html');
  fixture.manualSVG='```html\n<!DOCTYPE html><html><body style="margin:0"><canvas id="live" width="200" height="100"></canvas><button onclick="document.body.dataset.clicked=1">Test</button><script>window.started=Date.now();try{parent.document.body.dataset.escaped=1}catch(e){window.isolated=true}try{localStorage.setItem("escape","1")}catch(e){window.storageBlocked=true}fetch("/api/state").catch(()=>window.networkBlocked=true);let n=0;setInterval(()=>{const c=document.querySelector("canvas").getContext("2d");c.fillStyle=(++n%2)?"red":"blue";c.fillRect(0,0,200,100)},100);</script></body></html>\n```';
  await page.locator('#run').click();
  const live=page.frameLocator('#htmlFrameHost iframe');
  await live.locator('#live').waitFor({timeout:15000});
  await page.waitForFunction(()=>document.querySelector('#htmlPreviewStatus').textContent==='预览已加载');
  await page.waitForTimeout(250);
  assert.equal(await live.locator('body').evaluate(()=>window.isolated&&window.storageBlocked&&window.networkBlocked),true,'preview escaped isolation');
  assert.equal(await page.evaluate(()=>document.body.dataset.escaped),undefined);
  const consoleURL=page.url();
  await live.locator('body').evaluate(()=>{
    try { top.location.href='https://external.invalid/escape'; } catch { window.topBlocked=true; }
    window.popupBlocked=window.open('https://external.invalid/popup')===null;
  });
  assert.equal(page.url(),consoleURL,'preview navigated management page');
  assert.equal(await live.locator('body').evaluate(()=>window.topBlocked&&window.popupBlocked),true,'preview acquired navigation or popup privilege');
  const start=await live.locator('body').evaluate(()=>window.started);
  const colors=new Set();
  for(let i=0;i<6;i++){
    colors.add(await live.locator('#live').evaluate(c=>[...c.getContext('2d').getImageData(50,50,1,1).data].join(',')));
    await page.waitForTimeout(75);
  }
  assert.equal(colors.size,2,'HTML canvas animation did not move');
  await live.getByRole('button',{name:'Test',exact:true}).click();
  assert.equal(await live.locator('body').getAttribute('data-clicked'),'1');
  await page.waitForTimeout(3200);
  assert.equal(await live.locator('body').evaluate(()=>window.started),start,'poll restarted HTML');
  for(const width of [1280,390,320]){
    await page.setViewportSize({width,height:900});
    await page.locator('#htmlPreview').screenshot({path:path.join(root,'artifacts',`html-preview-${width}.png`)});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'HTML preview overflow');
  }
  await page.locator('#stopHTML').click();assert.equal(await page.locator('#htmlFrameHost iframe').count(),0);
  await page.waitForTimeout(3200);assert.equal(await page.locator('#htmlFrameHost iframe').count(),0,'poll resumed stopped preview');
  await page.locator('#reloadHTML').click();await live.locator('#live').waitFor();
  assert.notEqual(await live.locator('body').evaluate(()=>window.started),start);
  for(const width of ['390','768','1280']){
    await page.locator('#htmlPreviewSize').selectOption(width);
    await page.waitForTimeout(100);
    assert.equal(await live.locator('body').evaluate(()=>innerWidth),Number(width)-2);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'fixed preview overflowed console');
  }
  await page.locator('#htmlPreviewSize').selectOption('');
  await page.locator('#tab-history').click();
  assert.equal(await page.locator('#htmlFrameHost iframe').count(),0,'hidden preview kept running');
  await page.locator('#tab-tests').click();
  assert.equal(await page.locator('#htmlFrameHost iframe').count(),0,'tab return auto-ran preview');
  await page.route('**/api/results/*/preview*',route=>route.fulfill({status:503,contentType:'text/html',body:'<!DOCTYPE html><html>gateway error</html>'}));
  await page.locator('#reloadHTML').click();
  await page.waitForFunction(()=>document.querySelector('#htmlPreviewStatus').textContent.includes('HTTP 503'));
  assert.equal(await page.locator('#htmlFrameHost iframe').count(),0,'failed response rendered as preview');
  await page.unroute('**/api/results/*/preview*');
  fixture.manualSVG='```html\n<p id="candidate">first</p>\n```\n```html\n<p id="candidate">second</p>\n```\n```css\np{color:rgb(255,0,0)}\n```\n```javascript\ndocument.querySelector("p").textContent="combined";\n```';
  await page.locator('#run').click();
  await page.waitForFunction(()=>document.querySelector('#htmlPreviewCandidate').options.length===3,{},{timeout:15000});
  await page.locator('#htmlPreviewCandidate').selectOption('1');
  await live.locator('#candidate').filter({hasText:'second'}).waitFor();
  await page.locator('#htmlPreviewCandidate').selectOption('2');
  await live.locator('#candidate').filter({hasText:'combined'}).waitFor();
  assert.equal(await live.locator('#candidate').evaluate(p=>getComputedStyle(p).color),'rgb(255, 0, 0)');
  await page.locator('#expandHTML').click();
  assert.equal(await page.locator('#expandHTML').getAttribute('aria-pressed'),'true');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#expandHTML').getAttribute('aria-pressed'),'false');
  assert.match(await page.locator('#testAnswer').textContent(),/first/,'combination modified raw answer');
  await page.locator('#prompt').selectOption('svg');assert.equal(await page.locator('#htmlFrameHost iframe').count(),0);
  assert.deepEqual(errors.filter(e=>!e.includes('502 (Bad Gateway)')&&!e.includes('503 (Service Unavailable)')&&!/Connecting to .*violates|Fetch API cannot load|Unsafe attempt to initiate navigation|Blocked opening/.test(e)),[]);
  console.log('PASS: HTML inline animation, canvas pixels, interaction, origin/storage/network isolation, stable polling, stop/reload and 320/390/1280px previews');
}
