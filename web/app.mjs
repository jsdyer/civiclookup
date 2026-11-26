import {validateConfig,validateQuery,requestURLs,nextPage,normalizeReceipt,validateReceipt,filterReps,receiptCSV,errorMessage} from './model.mjs?v=postal-matches-2';
const $=id=>document.getElementById(id);
let config,receipt,normalized,example,level='',busy=false,lastRequest=0;
function el(tag,content,className) { const node=document.createElement(tag); if(content!=null)node.textContent=content; if(className)node.className=className; return node; }
function link(label,url) { const a=el('a',label); a.href=url; a.target='_blank'; a.rel='noopener noreferrer'; a.referrerPolicy='no-referrer'; return a; }
function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
function date(value){return new Date(value).toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'UTC'})+' UTC';}
function setBusy(value){busy=value;$('query-fields').disabled=value;$('search-button').textContent=value?'Looking up…':'Find representatives ↗';$('load-example').disabled=value;$('preview-example').disabled=value;$('import-receipt').disabled=value;}
function updateMode(){const postal=document.querySelector('input[name="mode"]:checked').value==='postal';$('postal-fields').hidden=!postal;$('coordinate-fields').hidden=postal;}
function fillQuery(query){document.querySelector(`input[name="mode"][value="${query.mode}"]`).checked=true;if(query.mode==='postal')$('postal-code').value=query.postalCode;else{$('latitude').value=query.latitude;$('longitude').value=query.longitude;}updateMode();}
function queryFromForm(){const mode=document.querySelector('input[name="mode"]:checked').value;return validateQuery(mode==='postal'?{mode,postalCode:$('postal-code').value}:{mode,latitude:$('latitude').value,longitude:$('longitude').value});}
async function apiJSON(url){
  const delay=Math.max(0,config.requestGapMs-(Date.now()-lastRequest));if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
  lastRequest=Date.now();const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),config.timeoutMs);
  try {const response=await fetch(url,{headers:{Accept:'application/json'},signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});
    if(!response.ok){if(response.status===404)throw new Error('Represent has no record for that location. Check the input or try explicit coordinates.');if([429,503].includes(response.status))throw new Error('Represent is busy or rate-limiting requests. Wait a minute before trying again.');throw new Error(`Represent returned HTTP ${response.status}. Try again later or inspect the source directly.`);}
    if(!response.headers.get('content-type')?.includes('json'))throw new Error('Represent returned a page instead of API data. Try again later; a provider challenge may be blocking this request.');
    return await response.json();
  }finally{clearTimeout(timer);}
}
async function collect(query){
  const urls=requestURLs(query,config),responses={},sourceURLs=[];let complete=true;
  for(const [kind,initial]of Object.entries(urls)){
    let url=initial,objects=[],count=0,total=0;
    while(url&&count<config.maxPages){sourceURLs.push(url);const raw=await apiJSON(url);count++;
      if(kind==='postal'){responses.postal=raw;url=null;break;}
      if(!Array.isArray(raw.objects)||!raw.meta)throw new Error('Represent returned an unrecognized response. The earlier capture is unchanged.');
      objects.push(...raw.objects);total=raw.meta.total_count;url=raw.meta.next?nextPage(raw.meta.next,kind):null;
    }
    if(kind!=='postal')responses[kind]={objects,meta:{total_count:total,pages:count,next:url}};
    if(url)complete=false;
  }
  return validateReceipt({schemaVersion:1,provider:'Represent by Open North',capturedAt:new Date().toISOString(),query,responses,sourceURLs,complete});
}
function renderLevels(){const container=$('levels');container.replaceChildren();for(const name of ['',...normalized.levels]){const button=el('button',null,level===name?'active':'');button.type='button';button.setAttribute('aria-pressed',String(level===name));button.append(el('span',name||'All levels'),el('span',String(name?normalized.representatives.filter(r=>r.level===name).length:normalized.representatives.length),'count'));button.onclick=()=>{level=name;renderLevels();renderCards();};container.append(button);}}
function renderCards(){
  const reps=filterReps(normalized.representatives,level,$('filter').value),container=$('representatives');container.replaceChildren();$('result-count').textContent=`${reps.length} OF ${normalized.representatives.length} REPRESENTATIVES · SOURCE-REPORTED RECORDS`;$('empty-results').hidden=reps.length>0;
  $('empty-results').textContent=normalized.representatives.length?'No representatives match this filter.':'No representatives were returned for this location. Coverage may be missing; check the source or try another location.';
  reps.forEach(rep=>{const card=el('article',null,'rep-card'),top=el('div',null,'card-top');top.append(el('span',rep.level,'level-badge'),el('span',rep.office||'Elected official','office-badge'));card.append(top,el('h3',rep.name),el('p',rep.district||'District not supplied','district-line'),el('p',[rep.legislature,rep.party].filter(Boolean).join(' · '),'assembly-line'));const actions=el('div',null,'card-actions');if(rep.url)actions.append(link('Official profile ↗',rep.url));if(/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(rep.email)){const a=el('a','Email');a.href=`mailto:${encodeURIComponent(rep.email).replace('%40','@')}`;actions.append(a);const copy=el('button','Copy email','email-action');copy.type='button';copy.onclick=async()=>{try{await navigator.clipboard.writeText(rep.email);copy.textContent='Copied';}catch{copy.textContent=rep.email;}};actions.append(copy);}if(rep.sourceURL)actions.append(link('Source record ↗',rep.sourceURL));if(actions.childNodes.length)card.append(actions);if(rep.offices.length){const details=el('details');details.append(el('summary','Office contacts'));rep.offices.forEach(o=>details.append(el('p',[o.type||'Office',o.postal,o.tel?'Telephone: '+o.tel:''].filter(Boolean).join('\n'))));card.append(details);}card.append(el('p',rep.matches.join(' + '),'match-label'));container.append(card);});
}
function renderBoundaries(){const container=$('boundaries');container.replaceChildren();$('boundary-count').textContent=`${normalized.boundaries.length} records`;normalized.boundaries.forEach(b=>{const row=el('div',null,'boundary-row'),name=el('div'),set=el('div');name.append(b.url?link(b.name,b.url):el('span',b.name),el('span',b.id?`ID ${b.id}`:''));set.append(el('div',b.set||'Boundary set not supplied'));if(b.setURL)set.append(link('View boundary set',b.setURL));set.append(el('span',b.matches.join(' + ')));row.append(name,set,el('span',b.linked?'Linked to a representative':'Additional source boundary',b.linked?'linked':''));container.append(row);});}
function display(next,kind){const nextNormalized=normalizeReceipt(next);receipt=next;normalized=nextNormalized;level='';$('filter').value='';$('receipt-kind').textContent=kind==='live'?'LIVE LOOKUP · DATED RECEIPT':kind==='import'?'IMPORTED RECEIPT · UNVERIFIED FILE':'SAVED PUBLIC EXAMPLE · NOT A LIVE LOOKUP';$('results-heading').textContent=receipt.query.label||validateQuery(receipt.query).label;$('capture-summary').textContent=[normalized.place,`Retrieved ${date(receipt.capturedAt)}`].filter(Boolean).join(' · ');$('representative-count').textContent=normalized.representatives.length;
  let note=receipt.query.mode==='postal'?'Postal codes are approximate and can cross district boundaries. Available centroid and concordance matches are included; these are possible matches, not proof of electoral eligibility.':'These representatives were returned for one coordinate. Coverage and source freshness vary; confirm current officeholders on their official pages.';
  if(!receipt.complete)note='Partial capture: the configured page limit was reached. Additional source records were not collected. '+note;
  $('coverage-note').textContent=note;renderLevels();renderCards();renderBoundaries();$('receipt-detail').textContent=`Provider: ${receipt.provider}. Retrieved ${date(receipt.capturedAt)}. ${receipt.complete?'All returned API pages collected.':'Page limit reached; incomplete capture.'} This is the source as retrieved, not a verified statement of current officeholders.`;
  $('source-requests').replaceChildren(...receipt.sourceURLs.map(url=>{const li=el('li');li.append(link(url,url));return li;}));$('export-json').disabled=false;$('export-csv').disabled=false;
}
function download(content,type,name){const url=URL.createObjectURL(new Blob([content],{type})),a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function search(query){if(busy)return;setBusy(true);status('Checking representative and boundary records with Open North…');try{const next=await collect(query);display(next,'live');$('results-heading').focus();status(`Lookup complete. ${normalized.representatives.length} representative records returned. Save a receipt to keep this capture.`);}catch(error){status(`${errorMessage(error)} ${receipt?'The previous capture is unchanged.':''}`,true);}finally{setBusy(false);}}
$('lookup-form').addEventListener('submit',event=>{event.preventDefault();try{search(queryFromForm());}catch(error){status(error.message,true);}});
document.querySelectorAll('input[name="mode"]').forEach(input=>input.onchange=updateMode);
$('filter').oninput=()=>{if(normalized)renderCards();};
$('export-json').onclick=()=>download(JSON.stringify(receipt,null,2)+'\n','application/json',`civiclookup-${receipt.capturedAt.slice(0,10)}.json`);
$('export-csv').onclick=()=>download('\uFEFF'+receiptCSV(receipt),'text/csv;charset=utf-8',`civiclookup-${receipt.capturedAt.slice(0,10)}.csv`);
function viewExample(){if(!example)return;display(example,'example');$('results-heading').focus();status('Showing the saved public example. Search a location for a new response.');}
$('preview-example').onclick=viewExample;
$('load-example').onclick=viewExample;
$('import-receipt').onchange=async event=>{const file=event.target.files[0];if(!file)return;try{if(file.size>config.importMaxBytes)throw new Error(`Choose a receipt smaller than ${config.importMaxBytes/1000000} MB.`);const imported=validateReceipt(JSON.parse(await file.text()));display(imported,'import');status('Receipt opened locally. Its contents have not been verified against Open North.');}catch(error){status(`Could not open receipt: ${error.message} The previous capture is unchanged.`,true);}event.target.value='';};
async function init(){
  setBusy(true);
  try{const response=await fetch('./config.json');if(!response.ok)throw new Error('Could not load the app configuration.');config=validateConfig(await response.json());updateMode();config.presets.forEach(preset=>{const button=el('button',preset.label);button.type='button';button.onclick=()=>{fillQuery(preset);status(`${preset.label} coordinates filled in. Choose Find representatives to send this lookup.`);};$('presets').append(button);});
    const saved=await fetch(config.examplePath);if(!saved.ok)throw new Error('The saved example is unavailable. Enter a location to start a live lookup.');example=validateReceipt(await saved.json());display(example,'example');const place=example.query.label||validateQuery(example.query).label;$('preview-example').textContent='View the saved '+place+' example';$('preview-example').hidden=false;status('Showing the saved example below. Enter your location for a new lookup.');
  }catch(error){status(error.message,true);}finally{setBusy(!config);}
}
init();
