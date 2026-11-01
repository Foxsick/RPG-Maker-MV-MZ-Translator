const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { randomBytes, createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const token = randomBytes(24).toString('hex');
function chooseFolder() {
  return new Promise((resolve,reject)=>{
    const script="[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; $dialog=New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description='Выберите папку игры'; if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($dialog.SelectedPath) }; $dialog.Dispose()";
    execFile('powershell.exe',['-NoProfile','-STA','-Command',script],{encoding:'utf8',windowsHide:true},(error,stdout)=>error?reject(error):resolve(stdout));
  });
}
let state = {running:false, message:'Готово'};
const dbFiles = new Set(['Actors.json','Classes.json','Skills.json','Items.json','Weapons.json','Armors.json','Enemies.json','States.json']);
function collect(file, obj) {
  const refs=[]; const add=(o,k)=>{if(typeof o[k]==='string' && /[\p{L}]/u.test(o[k])) refs.push([o,k]);};
  function walk(x) {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) { for(const y of x) walk(y); return; }
    if (typeof x.code==='number' && Array.isArray(x.parameters)) {
      const p=x.parameters;
      if ([401,405,402].includes(x.code)) add(p,x.code===402?1:0);
      if (x.code===101) add(p,4);
      if (x.code===102 && Array.isArray(p[0])) for(let i=0;i<p[0].length;i++) add(p[0],i);
      return;
    }
    for (const [k,v] of Object.entries(x)) { if (k !== '_original') walk(v); }
  }
  walk(obj);
  if (dbFiles.has(file) && Array.isArray(obj)) for (const x of obj) if(x) for(const k of ['name','nickname','profile','description','message1','message2','message3','message4']) add(x,k);
  if (/^Map\d+\.json$/.test(file)) add(obj,'displayName');
  if (file==='System.json') {
    for(const k of ['gameTitle','currencyUnit']) add(obj,k);
    for(const k of ['armorTypes','elements','equipTypes','skillTypes','weaponTypes']) if(Array.isArray(obj[k])) obj[k].forEach((_,i)=>add(obj[k],i));
    const terms=obj.terms||{}; for(const v of Object.values(terms)) if(v && typeof v==='object') for(const k of Object.keys(v)) add(v,k);
  }
  return refs;
}
function protect(s) { let parts=[]; let text=s.replace(/\\[A-Za-z]+(?:\[[^\]]*\])?|\\[{}.!|><^$]|%\d+|\{\d+\}/g, m=>{let t=`ZXQ${parts.length}QXZ`; parts.push([t,m]); return t;});return {text,parts}; }
function restore(s,parts) { for(const [t,v] of parts){if(s.split(t).length!==2) {const error=new Error('Переводчик изменил служебный код: '+t);error.code='PLACEHOLDER_CHANGED';throw error;} s=s.replace(t,()=>v);} return s; }
function findGame(input) {
  if(typeof input!=='string' || !input.trim()) throw Error('Укажите папку игры.');
  const start=path.resolve(input.trim());
  if (!fs.existsSync(start) || !fs.statSync(start).isDirectory()) throw Error('Папка игры не найдена.');
  function direct(dir) {
    if(fs.existsSync(path.join(dir,'data','System.json'))) return {game:path.basename(dir).toLowerCase()==='www'?path.dirname(dir):dir,data:path.join(dir,'data')};
    if(fs.existsSync(path.join(dir,'www','data','System.json'))) return {game:dir,data:path.join(dir,'www','data')};
    return null;
  }
  const found=direct(start); if(found) return found;
  const candidates=fs.readdirSync(start,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>direct(path.join(start,e.name))).filter(Boolean);
  if(candidates.length===1) return candidates[0];
  if(candidates.length>1) throw Error('Найдено несколько игр. Укажите папку нужной игры точнее.');
  throw Error('Не найдены data/System.json или www/data/System.json. Укажите папку игры.');
}
function timeEstimate(start,completed,total) {
  if(!completed) return 'Оставшееся время: рассчитывается…';
  const seconds=Math.ceil((Date.now()-start)/1000/completed*(total-completed));
  if(seconds<60) return `Осталось примерно ${seconds} сек.`;
  if(seconds<3600) return `Осталось примерно ${Math.ceil(seconds/60)} мин.`;
  return `Осталось примерно ${Math.floor(seconds/3600)} ч ${Math.ceil((seconds%3600)/60)} мин.`;
}
// Reflow only standard Show Text commands. Leave scripts and plugin commands untouched.
function wrapText(text, limit) {
  const tokens=text.match(/\\[A-Za-z]+(?:\[[^\]]*\])?|\\[{}.!|><^$]|[^\s\\]+|\\|\s+/gu)||[];
  const lines=[]; let line='', width=0, pendingSpace='';
  const flush=()=>{lines.push(line.trimEnd());line='';width=0;pendingSpace='';};
  for(const token of tokens) {
    if(/^\s+$/u.test(token)){if(line)pendingSpace=' ';continue;}
    if(/^\\(?:[A-Za-z]+(?:\[[^\]]*\])?|[{}.!|><^$])$/.test(token)){line+=pendingSpace+token;width+=pendingSpace.length;pendingSpace='';continue;}
    const chars=Array.from(token); let offset=0;
    if(width && width+pendingSpace.length+chars.length>limit) flush();
    if(pendingSpace){line+=pendingSpace;width+=pendingSpace.length;pendingSpace='';}
    while(offset<chars.length){if(width>=limit)flush();const chunk=chars.slice(offset,offset+limit-width);line+=chunk.join('');width+=chunk.length;offset+=chunk.length;if(offset<chars.length)flush();}
  }
  if(line||!lines.length)lines.push(line.trimEnd());
  return lines;
}
function reflowMessages(obj, limit, pageLines, selectedHeaders, untouchedParams) {
  function walk(x){
    if(!x||typeof x!=='object')return;
    if(Array.isArray(x)){
      for(let i=0;i<x.length;i++){
        const header=x[i]; if(!header||header.code!==101||!Array.isArray(header.parameters)||(selectedHeaders&&!selectedHeaders.has(header)))continue;
        let end=i+1, lines=[];
        if(untouchedParams){let j=i+1,skip=false;while(j<x.length&&x[j]?.code===401&&x[j].indent===header.indent){if(untouchedParams.has(x[j].parameters))skip=true;j++;}if(skip){i=j-1;continue;}}
        while(end<x.length&&x[end]&&x[end].code===401&&x[end].indent===header.indent&&typeof x[end].parameters?.[0]==='string'){
          for(const text of wrapText(x[end].parameters[0],limit))lines.push({...x[end],parameters:[text,...x[end].parameters.slice(1)]});end++;
        }
        if(end===i+1)continue;
        const result=[]; for(let n=0;n<lines.length;n++){if(n>0&&n%pageLines===0)result.push({...header,parameters:[...header.parameters]});result.push(lines[n]);}
        x.splice(i+1,end-i-1,...result);i+=result.length;
      }
      for(const item of x)walk(item);return;
    }
    for(const [key,value] of Object.entries(x))if(key!=='_original')walk(value);
  }
  walk(obj);
}
// Starting-map order is an approximation: the actual event execution depends on the game.
function selectTestDialogs(data, limit=10) {
  const system=JSON.parse(fs.readFileSync(path.join(data,'System.json'),'utf8'));
  const startFile='Map'+String(system.startMapId||0).padStart(3,'0')+'.json';
  const all=fs.readdirSync(data).filter(f=>/^Map\d+\.json$/.test(f)).sort();
  const files=[startFile,'CommonEvents.json',...all.filter(f=>f!==startFile)].filter((f,i,a)=>a.indexOf(f)===i&&fs.existsSync(path.join(data,f)));
  const docs=[]; let dialogs=0;
  for(const f of files){
    const obj=JSON.parse(fs.readFileSync(path.join(data,f),'utf8')), refs=[], headers=new WeakSet();
    function walk(x){
      if(!x||typeof x!=='object'||dialogs>=limit)return;
      if(Array.isArray(x)){
        for(let i=0;i<x.length&&dialogs<limit;i++){
          const header=x[i];
          if(header?.code===101&&Array.isArray(header.parameters)){
            let j=i+1, lines=[];
            while(j<x.length&&x[j]?.code===401&&x[j].indent===header.indent&&typeof x[j].parameters?.[0]==='string'){if(/[\p{L}]/u.test(x[j].parameters[0]))lines.push([x[j].parameters,0]);j++;}
            if(lines.length){headers.add(header);refs.push(...lines);if(typeof header.parameters[4]==='string'&&/[\p{L}]/u.test(header.parameters[4]))refs.push([header.parameters,4]);dialogs++;i=j-1;continue;}
          }
          walk(header);
        }return;
      }
      for(const [k,v] of Object.entries(x))if(k!=='_original')walk(v);
    }
    walk(obj);if(refs.length)docs.push({f,obj,refs,headers});if(dialogs>=limit)break;
  }
  if(!dialogs)throw Error('Не найдены стандартные диалоги для теста.');
  return {docs,dialogs,startFile};
}
async function translate(opt){
  const {game,data}=findGame(opt.game);
  const lineLimit=Number(opt.lineLimit||32), pageLines=Number(opt.pageLines||4);
  if(!Number.isInteger(lineLimit)||lineLimit<10||lineLimit>150||!Number.isInteger(pageLines)||pageLines<1||pageLines>10) throw Error('Допустимая длина строки: 10–150, строк в окне: 1–10.');
  if(!['free','official','deepl','ollama','openai'].includes(opt.mode)) throw Error('Выберите способ перевода.');
  if(!opt.target || !/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(opt.target)) throw Error('Укажите корректный код языка перевода, например ru.');
  const providers=opt.all ? ['free',...(opt.deeplKey?['deepl']:[])] : [opt.mode];
  if(providers.includes('official')&&!opt.key) throw Error('Укажите ключ Google Cloud API.');
  if(providers.includes('deepl')&&!opt.deeplKey) throw Error('Укажите ключ DeepL API Free.');
  if(providers.includes('openai')&&!opt.aiKey) throw Error('Укажите ключ OpenAI API.');
  if(providers.some(p=>p==='ollama'||p==='openai')&&!opt.aiModel) throw Error('Укажите имя модели нейросети.');
  const outputMode=opt.all?'all-'+providers.join('-'):opt.mode;
  const identity=createHash('sha256').update(path.resolve(game).toLowerCase()).digest('hex').slice(0,10);
  const test=opt.test===true;
  const out=test?path.join(root,'translated_data',path.basename(game)+'-'+identity,opt.target.toLowerCase(),'test-'+Date.now()+'-'+randomBytes(3).toString('hex'),'data'):path.join(root,'translated_data',path.basename(game)+'-'+identity,opt.target.toLowerCase(),outputMode,'data'); fs.mkdirSync(out,{recursive:true});
  const cachePath=path.join(root,'translator-cache.json'); let cache={}; try{cache=JSON.parse(fs.readFileSync(cachePath,'utf8'));}catch{}
  let docs=[], unique=new Map(), count=0, selection;
  if(test){selection=selectTestDialogs(data);docs=selection.docs;}
  else for(const f of fs.readdirSync(data).filter(f=>f.endsWith('.json'))){const obj=JSON.parse(fs.readFileSync(path.join(data,f),'utf8'));docs.push({f,obj,refs:collect(f,obj)});}
  for(const {refs} of docs)for(const [o,k] of refs){unique.set(o[k],null);count++;}
  const items=[...unique.keys()], assigned=new Map(); items.forEach((s,i)=>assigned.set(s,providers[i%providers.length]));
  const cacheKey=(provider,s)=>JSON.stringify(provider==='official'?[opt.source,opt.target,s]:['ollama','openai'].includes(provider)?[provider,opt.aiModel,opt.source,opt.target,s]:[provider,opt.source,opt.target,s]);
  const missing=items.filter(s=>!Object.hasOwn(cache,cacheKey(assigned.get(s),s)));
  const started=Date.now(); let completed=0; const fallback=new Map(), attempts=new Map();
  const names={free:'Google без ключа',deepl:'DeepL',official:'Google Cloud',ollama:'Ollama',openai:'OpenAI'};
  const distribution=providers.map(p=>names[p]+': '+items.filter(s=>assigned.get(s)===p).length).join(', ');
  const progress=()=>{state.message='Распределение уникальных фрагментов: '+distribution+'.\nПереведено '+completed+' из '+missing.length+' новых фрагментов.\n'+timeEstimate(started,completed,missing.length);}; progress();
  try {
    for(const provider of providers){
      const pending=missing.filter(s=>assigned.get(s)===provider);
      for(let i=0;i<pending.length;){
        const batch=[];let size=0, limit=(attempts.has(pending[i])||['free','ollama','openai'].includes(provider))?1:30;
        while(i<pending.length && batch.length<limit && (!batch.length||!attempts.has(pending[i])) && (size+pending[i].length<10000 || !batch.length)){const s=pending[i++];batch.push(s);size+=s.length;}
        const protectedBatch=batch.map(protect); let translated;
        if(provider==='free'){
          const url=new URL('https://translate.googleapis.com/translate_a/single');
          for(const [k,v] of Object.entries({client:'gtx',sl:opt.source||'auto',tl:opt.target,dt:'t',q:protectedBatch[0].text})) url.searchParams.set(k,v);
          let response;
          for(let attempt=0;attempt<4;attempt++) {response=await fetch(url,{signal:AbortSignal.timeout(60000)});if(response.status!==429&&response.status<500) break;if(attempt<3){state.message='Google временно ограничил запросы. Повторная попытка '+(attempt+1)+' из 3…';await new Promise(r=>setTimeout(r,2000*2**attempt));}}
          if(!response.ok) throw Error('Google вернул код '+response.status+'. Повторите позже.');
          const result=await response.json();if(!Array.isArray(result[0])||!result[0].length||result[0].some(x=>!Array.isArray(x)||typeof x[0]!=='string')) throw Error('Получен неожиданный ответ Google.');
          translated=[result[0].map(x=>x[0]).join('')];
        } else if(provider==='ollama'||provider==='openai'){
          const instruction='Translate the user text into language '+opt.target+(opt.source?' from '+opt.source:'')+'. Return only the translation, with no explanation. Preserve every ZXQ...QXZ placeholder exactly, without adding or removing any.';
          const isLocal=provider==='ollama';
          const url=isLocal?'http://127.0.0.1:11434/api/chat':'https://api.openai.com/v1/responses';
          const payload=isLocal?{model:opt.aiModel,stream:false,messages:[{role:'system',content:instruction},{role:'user',content:protectedBatch[0].text}]}:{model:opt.aiModel,store:false,instructions:instruction,input:protectedBatch[0].text};
          const headers={'Content-Type':'application/json'};if(!isLocal)headers.Authorization='Bearer '+opt.aiKey;
          const response=await fetch(url,{method:'POST',headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(180000)});
          const result=await response.json();if(!response.ok)throw Error(names[provider]+': '+(result.error?.message||result.error||response.status));
          const output=isLocal?result.message?.content:result.output?.filter(x=>x.type==='message').flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');
          if(typeof output!=='string'||!output.trim())throw Error(names[provider]+': пустой ответ.');
          translated=[output.trim()];
        } else if(provider==='deepl'){
          const payload={text:protectedBatch.map(x=>x.text),target_lang:opt.target.toUpperCase()};if(opt.source)payload.source_lang=opt.source.toUpperCase();
          const response=await fetch('https://api-free.deepl.com/v2/translate',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'DeepL-Auth-Key '+opt.deeplKey},body:JSON.stringify(payload),signal:AbortSignal.timeout(60000)});
          const result=await response.json();if(!response.ok)throw Error('DeepL: '+(result.message||('код '+response.status)));
          translated=result.translations?.map(x=>x.text);
        } else {
          const payload={q:protectedBatch.map(x=>x.text),target:opt.target,format:'text'};if(opt.source)payload.source=opt.source;
          const response=await fetch('https://translation.googleapis.com/language/translate/v2?key='+encodeURIComponent(opt.key),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(60000)});
          const result=await response.json();if(!response.ok)throw Error('Google API: '+(result.error?.message||response.status));
          translated=result.data?.translations?.map(x=>x.translatedText.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|#39);/gi,(m,e)=>{let t=e.toLowerCase();if(t[0]==='#')return String.fromCodePoint(t[1]==='x'?parseInt(t.slice(2),16):parseInt(t.slice(1),10));return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[t]||m;}));
        }
        if(!Array.isArray(translated)||translated.length!==batch.length||translated.some(x=>typeof x!=='string'))throw Error(names[provider]+': неполный ответ.');
        for(let j=0;j<batch.length;j++){
          const source=batch[j];
          try{cache[cacheKey(provider,source)]=restore(translated[j],protectedBatch[j].parts);completed++;}
          catch(error){
            if(error.code!=='PLACEHOLDER_CHANGED')throw error;
            const attempt=(attempts.get(source)||0)+1;attempts.set(source,attempt);
            if(attempt<=2){pending.splice(i,0,source);}
            else{fallback.set(source,{provider,reason:error.message,attempts:attempt});completed++;}
          }
        }
        progress();
        if(provider!=='free'||completed%10===0)fs.writeFileSync(cachePath,JSON.stringify(cache),'utf8');
        if(provider==='free')await new Promise(r=>setTimeout(r,300));
      }
    }
  } finally {fs.writeFileSync(cachePath,JSON.stringify(cache),'utf8');}
  const report=[];
  for(const {f,obj,refs,headers} of docs){const untouched=new WeakSet();for(const [o,k] of refs){const source=o[k];if(fallback.has(source)){untouched.add(o);report.push({file:f,original:source,...fallback.get(source)});}else o[k]=cache[cacheKey(assigned.get(source),source)];}reflowMessages(obj,lineLimit,pageLines,headers,untouched);fs.writeFileSync(path.join(out,f),JSON.stringify(obj),'utf8');}
  let reportMessage='';if(report.length){const reportPath=path.join(path.dirname(out),'untranslated-control-codes-'+Date.now()+'.json');fs.writeFileSync(reportPath,JSON.stringify(report,null,2),'utf8');reportMessage='\nСтрок оставлено в оригинале: '+report.length+'. Отчёт: '+reportPath+'\n';}
  state.message=(test?'Тестовый перевод: '+selection.dialogs+' диалогов. Выбор начинается с '+selection.startFile+'; порядок появления зависит от игры.\n':'')+'Готово: '+count+' фрагментов.\nРаспределение уникальных фрагментов: '+distribution+'.'+reportMessage+'\n\nПереведённые файлы: '+out+'\n\nСкопируйте содержимое этой папки в папку data копии игры, соответствующую:\n'+data+'\nПри копировании подтвердите замену файлов.';
}
const locales=JSON.parse(fs.readFileSync(path.join(__dirname,'languages.json'),'utf8'));
const page=`<!doctype html><html lang="ru"><meta charset="utf-8"><title>Переводчик RPG Maker</title><style>body{font:16px system-ui;background:#f3f5f9;color:#243047;max-width:760px;margin:50px auto;padding:0 20px}main{background:white;padding:30px;border-radius:14px;box-shadow:0 3px 20px #0001}label{display:block;margin-top:18px;font-weight:600}input,select{box-sizing:border-box;width:100%;padding:10px;margin-top:6px;border:1px solid #b9c1ce;border-radius:6px;font:inherit}button{background:#345ed4;color:white;border:0;border-radius:6px;padding:12px 22px;margin-top:22px;font:inherit;cursor:pointer}#status{white-space:pre-wrap;margin-top:20px}details{margin-top:20px}summary{cursor:pointer;font-weight:600}small[hidden]{display:none}small{color:#586577;display:block;line-height:1.5;margin-top:8px}</style><main><label><span data-i18n="language">Язык интерфейса</span><select id="language"></select></label><h1 data-i18n="title">Переводчик RPG Maker</h1><p><span data-i18n="intro">Перевод JSON-файлов RPG Maker MV/MZ через Google и DeepL.</span></p><label><span data-i18n="folder">Папка игры</span><input id="game" data-placeholder="folderHint" placeholder="Папка с Game.exe или вложенная папка www"></label><button type="button" id="browse"><span data-i18n="browse">Выбрать папку…</span></button><details><summary data-i18n="settings">Настройки перевода</summary><label><span data-i18n="mode">Способ перевода</span><select id="mode"><option value="free" data-i18n="free">Google без API-ключа</option><option value="deepl" data-i18n="deepl">DeepL API Free (с ключом)</option><option value="ollama" data-i18n="ollama">Ollama (локально)</option><option value="openai" data-i18n="openai">OpenAI API</option><option value="official" data-i18n="official">Google Cloud Translation API (с ключом)</option></select></label><label style="display:flex;align-items:center;gap:8px"><input style="width:auto" type="checkbox" id="all"> <span data-i18n="all">Переводить всеми доступными бесплатными средствами</span></label><small><span data-i18n="allHelp">Распределяет уникальные фрагменты поровну между Google и DeepL. Для DeepL нужен ключ; без него используется только Google.</span></small><label id="aiModelLabel" hidden><span data-i18n="aiModel">Модель нейросети</span><input id="aiModel" placeholder="gpt-4.1-mini / qwen2.5"></label><label id="aiKeyLabel" hidden><span data-i18n="aiKey">Ключ OpenAI API</span><input id="aiKey" type="password" autocomplete="off"></label><small id="aiHelp" hidden data-i18n="aiHelp">Ollama должна быть запущена на этом компьютере; OpenAI API может быть платным. Укажите установленную или доступную модель.</small><label id="deeplLabel" hidden><span data-i18n="deeplKey">Ключ DeepL API Free</span><input id="deeplKey" type="password" autocomplete="off"></label><label id="keyLabel" hidden><span data-i18n="googleKey">API-ключ Google Cloud</span><input id="key" type="password" autocomplete="off"></label><label><span data-i18n="source">Язык оригинала (необязательно, например en или ja)</span><input id="source" data-placeholder="auto" placeholder="Определить автоматически"></label><label><span data-i18n="target">Язык перевода</span><input id="target" value="ru"></label><label><span data-i18n="lineLimit">Примерная длина строки диалога</span><input type="number" id="lineLimit" value="32" min="10" max="150"></label><label><span data-i18n="pageLines">Строк в окне диалога</span><input type="number" id="pageLines" value="4" min="1" max="10"></label><small><span data-i18n="wrapHelp">Длинные диалоги переносятся на новые строки и, при необходимости, на следующие окна. Если текст всё ещё выходит за край, уменьшите длину строки.</span></small></details><button id="run"><span data-i18n="run">Перевести</span></button> <button id="test"><span data-i18n="test">Тестовый перевод</span></button><small data-i18n="testHelp">Переводит до 10 диалогов, начиная с начальной карты. Их порядок появления зависит от игры. Результат сохраняется отдельно.</small><div id="status">Готово</div><p><small><span data-i18n="note">Результаты каждой игры сохраняются отдельно в папке translated_data; после перевода будет указан путь для установки. Оставшееся время примерное. Исходные файлы не изменяются. Текст отправляется выбранным переводчикам. Официальный API может быть платным; режим без ключа может иметь ограничения. Переводы сохраняются в локальный кэш.</span></small></p></main><script>const locales=${JSON.stringify(locales).replace(/</g,'\u003c')};let savedLanguage=localStorage.getItem('interfaceLanguage');let systemLanguages=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language];let systemLanguage=systemLanguages.filter(Boolean).map(code=>Object.keys(locales).find(key=>key.toLowerCase()===code.toLowerCase())||Object.keys(locales).find(key=>key.toLowerCase()===code.split('-')[0].toLowerCase())).find(Boolean);let lang=(savedLanguage&&locales[savedLanguage])?savedLanguage:(systemLanguage||locales.ru&&'ru'||Object.keys(locales)[0]);const languageSelect=document.querySelector('#language');for(const [code,entry] of Object.entries(locales)){let option=document.createElement('option');option.value=code;option.textContent=entry.name;languageSelect.append(option)}languageSelect.value=lang;let lastStatus='';function t(key){return locales[lang].strings[key]??locales.ru.strings[key]??key}function translateStatus(text){let map=locales[lang].status||{};for(const key of Object.keys(map).sort((a,b)=>b.length-a.length))text=text.split(key).join(map[key]);return text}function refreshLanguage(){document.documentElement.lang=lang;document.title=t('title');document.querySelectorAll('[data-i18n]').forEach(el=>el.textContent=t(el.dataset.i18n));document.querySelectorAll('[data-placeholder]').forEach(el=>el.placeholder=t(el.dataset.placeholder));document.querySelector('#status').textContent=translateStatus(lastStatus)}languageSelect.onchange=()=>{lang=languageSelect.value;localStorage.setItem('interfaceLanguage',lang);refreshLanguage()};refreshLanguage();const token=${JSON.stringify(token)};document.querySelector('#game').value=${JSON.stringify(fs.readdirSync(root).find(n=>fs.existsSync(path.join(root,n,'data','System.json')))||'')};let g=document.querySelector('#game'); if(g.value)g.value=${JSON.stringify(root)}+'\\\\'+g.value;document.querySelector('#browse').onclick=async()=>{let b=document.querySelector('#browse');b.disabled=true;try{let r=await fetch('/browse',{method:'POST',headers:{'X-Token':token}});if(!r.ok)throw Error(await r.text());let result=await r.json();if(result.path)document.querySelector('#game').value=result.path}catch(e){document.querySelector('#status').textContent=t('browseError')+e.message}finally{b.disabled=false}};function updateMode(){let all=document.querySelector('#all').checked,mode=document.querySelector('#mode').value;document.querySelector('#mode').disabled=all;document.querySelector('#keyLabel').hidden=all||mode!=='official';document.querySelector('#deeplLabel').hidden=!all&&mode!=='deepl';document.querySelector('#aiModelLabel').hidden=all||!['ollama','openai'].includes(mode);document.querySelector('#aiKeyLabel').hidden=all||mode!=='openai';document.querySelector('#aiHelp').hidden=all||!['ollama','openai'].includes(mode)};document.querySelector('#mode').onchange=updateMode;document.querySelector('#all').onchange=updateMode;async function startTranslation(test){document.querySelector('#run').disabled=true;document.querySelector('#test').disabled=true;let body={test};for(let id of ['game','mode','key','deeplKey','aiModel','aiKey','source','target','lineLimit','pageLines'])body[id]=document.querySelector('#'+id).value.trim();body.all=document.querySelector('#all').checked;let r=await fetch('/run',{method:'POST',headers:{'Content-Type':'application/json','X-Token':token},body:JSON.stringify(body)});if(!r.ok)document.querySelector('#status').textContent=await r.text();};document.querySelector('#run').onclick=()=>startTranslation(false);document.querySelector('#test').onclick=()=>startTranslation(true);setInterval(async()=>{let s=await (await fetch('/status')).json();lastStatus=s.message;document.querySelector('#status').textContent=translateStatus(lastStatus);document.querySelector('#run').disabled=s.running;document.querySelector('#test').disabled=s.running},1000)</script></html>`;
http.createServer((req,res)=>{if(req.method==='GET'&&req.url==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(page);return;}if(req.method==='GET'&&req.url==='/status'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(state));return;}if(req.method==='POST'&&req.url==='/browse'&&req.headers['x-token']===token){chooseFolder().then(folder=>{res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({path:folder}));}).catch(()=>{res.writeHead(500);res.end('Не удалось открыть окно выбора папки Windows.');});return;}if(req.method==='POST'&&req.url==='/run'&&req.headers['x-token']===token){if(state.running){res.writeHead(409);res.end('Перевод уже выполняется');return;}let body='';req.on('data',c=>{body+=c;if(body.length>20000)req.destroy()});req.on('end',()=>{try{const opt=JSON.parse(body);state={running:true,message:'Анализ файлов…'};translate(opt).catch(e=>{state.message='Ошибка: '+e.message}).finally(()=>{state.running=false});res.end('OK');}catch{res.writeHead(400);res.end('Неверный запрос');}});return;}res.writeHead(404);res.end();}).listen(0,'127.0.0.1',function(){console.log('Откройте в браузере: http://127.0.0.1:'+this.address().port);});
