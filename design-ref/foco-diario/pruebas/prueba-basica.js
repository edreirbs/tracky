// Prueba básica de Foco Diario. Ver PARA-DESARROLLADORES.md.
// Usa una carpeta simulada (almacenamiento privado del navegador), nunca datos reales.
const {chromium}=require('playwright');
(async()=>{
 const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1280,height:1100}});
 const errs=[]; p.on('pageerror',e=>errs.push(e.message));
 await p.addInitScript(()=>{ window.showDirectoryPicker=async()=>{const d=await navigator.storage.getDirectory(); d.queryPermission=async()=>'granted'; d.requestPermission=async()=>'granted'; return d;}; });
 await p.goto('http://localhost:8765/Foco%20Diario.html'); await p.waitForTimeout(300);
 await p.evaluate(async()=>{const d=await navigator.storage.getDirectory(); for await (const [n] of d.entries()) await d.removeEntry(n,{recursive:true});});
 await p.click('[data-lk=pick]'); await p.waitForTimeout(300);
 await p.fill('#lkPw','secreta123'); await p.fill('#lkPw2','secreta123'); await p.check('#lkAck');
 await p.click('#lkForm button'); await p.waitForTimeout(2500);
 await p.keyboard.press('Control+k'); await p.waitForTimeout(300);
 await p.click('[data-act=arNew][data-type=contact]'); await p.waitForTimeout(200);
 await p.fill('#arTitle','Mtro. Javier Ortega'); await p.fill('#arCompany','Socio de Sofía'); await p.fill('#arPhone','55 2222 3333'); await p.fill('#arTags','socios, legal');
 await p.click('form[data-form=arForm] button.primary'); await p.waitForTimeout(1500);
 await p.click('#lockBtn'); await p.waitForTimeout(800);
 await p.fill('#lkPw','secreta123'); await p.click('#lkForm button'); await p.waitForTimeout(2500);
 await p.keyboard.press('Control+k'); await p.waitForTimeout(300);
 await p.fill('#arQ','socio'); await p.waitForTimeout(300);
 console.log('Busqueda "socio":', await p.$$eval('.ficha-t',e=>e.map(x=>x.textContent)));
 await p.fill('#arQ','viaticos'); await p.waitForTimeout(300);
 console.log('Busqueda "viaticos":', await p.$$eval('#arRes .t, .ficha-t',e=>e.map(x=>x.textContent)));
 console.log(errs.length ? 'ERRORES: '+errs.join(' | ') : 'OK: sin errores'); await b.close();
})();
