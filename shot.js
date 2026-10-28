const puppeteer = require('puppeteer-core');
(async()=>{
  const browser = await puppeteer.launch({
    executablePath:'/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',
    args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader','--enable-webgpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({width:480,height:900});
  const logs=[];
  page.on('console',m=>logs.push(m.type()+': '+m.text()));
  page.on('pageerror',e=>logs.push('PAGEERROR: '+e.message));
  await page.goto('http://localhost:8099/',{waitUntil:'networkidle0'});
  await new Promise(r=>setTimeout(r,2500));
  await page.screenshot({path:'/tmp/menu.png'});
  // press play
  await page.click('#btnPlay');
  await new Promise(r=>setTimeout(r,4000));
  await page.screenshot({path:'/tmp/play1.png'});
  await new Promise(r=>setTimeout(r,6000));
  await page.screenshot({path:'/tmp/play2.png'});
  console.log(JSON.stringify(logs,null,1));
  await browser.close();
})().catch(e=>{console.error('FATAL',e);process.exit(1)});
