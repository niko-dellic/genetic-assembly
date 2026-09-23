import { chromium, firefox, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../../docs/dist/',import.meta.url));
const server=createServer(async(req,res)=>{
 try {
  let path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(path.endsWith('/')) path+='index.html'; else if(!extname(path)) path+='.html';
  const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
  res.setHeader('Content-Type',types[extname(path)]??'application/octet-stream');
  res.end(await readFile(resolve(root,'.'+path)));
 } catch {res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
 browser=await ({chromium,firefox,webkit}[process.env.GA_BROWSER??'chromium']).launch({headless:true});
 const page=await browser.newPage(); const errors=[];
 page.on('pageerror',error=>{errors.push(error.message);console.error(error.message)});
 const url=process.env.DOCS_TEST_URL??`http://127.0.0.1:${server.address().port}`;
 await page.goto(url+'/docs/live-neighborhood.html');
 await page.getByRole('button',{name:'Run neighborhood study',exact:true}).click();
 await page.waitForFunction(()=>['completed','Failed'].some(status=>document.querySelector('.live-study [role=status]')?.textContent?.includes(status)),{},{timeout:120000});
 assert.equal(await page.locator('.live-study [role=alert]').count()?await page.locator('.live-study [role=alert]').first().textContent():'','');
 await page.locator('.live-study svg [role=button]').first().click();
 await page.getByRole('button',{name:'Generate selected replay',exact:true}).click();
 await page.getByText('Replay ready — select its job in the inspector',{exact:true}).waitFor();
 await page.locator('[data-jobs] button').filter({hasText:'replay'}).first().click();
 await page.getByRole('button',{name:'Open replay',exact:true}).first().click();
 await page.locator('input[type=range]').first().waitFor();
 const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Export session',exact:true}).click();await (await downloaded).saveAs(`/tmp/ga-browser-neighborhood-${process.env.GA_BROWSER??'chromium'}.ga.json`);
 await page.getByRole('button',{name:'Run neighborhood study',exact:true}).click();
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.live-study [role=status]')?.textContent?.toLowerCase().includes('cancelled'));
 assert.deepEqual(errors,[]);
 console.log('Live browser neighborhood: baseline, WASM search, validation, selected replay and export passed.');
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
