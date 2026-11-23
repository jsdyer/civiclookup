export const PROVIDER = 'https://represent.opennorth.ca';
const text = value => typeof value === 'string' ? value.slice(0, 10000) : '';
const array = value => Array.isArray(value) ? value : [];
export function validateQuery(input) {
  if (input?.mode === 'postal') {
    const postalCode = text(input.postalCode).toUpperCase().replace(/\s/g, '');
    if (!/^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/.test(postalCode)) throw new Error('Enter a Canadian postal code, such as K1A 0A6.');
    return { mode: 'postal', postalCode, label: `${postalCode.slice(0, 3)} ${postalCode.slice(3)}` };
  }
  if (input?.mode !== 'coordinates') throw new Error('Choose postal code or coordinates.');
  const latitude = Number(input.latitude), longitude = Number(input.longitude);
  if (input.latitude === '' || input.longitude === '' || input.latitude == null || input.longitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) throw new Error('Enter a latitude from −90 to 90 and a longitude from −180 to 180.');
  return { mode: 'coordinates', latitude, longitude, label: text(input.label) || `${latitude}, ${longitude}` };
}
export function validateConfig(config) {
  if (config?.apiBase !== PROVIDER) throw new Error('Configure the official Represent HTTPS API.');
  for (const [key, min, max] of [['pageSize',1,1000],['maxPages',1,10],['timeoutMs',1000,60000],['requestGapMs',1000,10000],['importMaxBytes',1000,10000000]]) {
    if (!Number.isInteger(config[key]) || config[key]<min || config[key]>max) throw new Error(`Invalid config setting: ${key}`);
  }
  validateQuery(config.defaultQuery);
  if (!Array.isArray(config.presets)) throw new Error('Presets must be a list.');
  config.presets.forEach(validateQuery);
  if (!/^\.\/data\/[a-zA-Z0-9_-]+\.json$/.test(config.examplePath)) throw new Error('Example must be a local data JSON file.');
  return config;
}
export function requestURLs(query, config) {
  const q = validateQuery(query);
  if (q.mode === 'postal') return { postal: `${config.apiBase}/postcodes/${q.postalCode}/` };
  const point = `${q.latitude},${q.longitude}`;
  return { representatives: `${config.apiBase}/representatives/?${new URLSearchParams({point,limit:config.pageSize})}`, boundaries: `${config.apiBase}/boundaries/?${new URLSearchParams({contains:point,limit:config.pageSize})}` };
}
export function safeURL(value, base) {
  try {
    if (!text(value) || /[\u0000-\u001f\u007f]/.test(value)) return '';
    const url = new URL(value, base);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
export function providerURL(value) {
  const url = safeURL(value, PROVIDER);
  return url && new URL(url).origin === PROVIDER ? url : '';
}
export function nextPage(value, kind) {
  const url = providerURL(value);
  if (!url || new URL(url).pathname !== `/${kind}/`) throw new Error('Represent returned an unexpected pagination link.');
  return url;
}
export function levelOf(rep) {
  const office = text(rep.elected_office).toUpperCase();
  if (office === 'MP' || rep.representative_set_name === 'House of Commons') return 'Federal';
  if (['MLA','MPP','MNA','MHA'].includes(office)) return 'Provincial / territorial';
  if (/MAYOR|COUNCILLOR|COUNCILOR|ALDERMAN|REEVE/.test(office)) return 'Municipal';
  return 'Other';
}
function addMatches(map, records, match, kind) {
  records.forEach(raw => {
    if (!raw || typeof raw !== 'object') return;
    const key = kind === 'representatives' ? [text(raw.name),text(raw.elected_office),text(raw.representative_set_name),text(raw.district_name),text(raw.related?.boundary_url)].join('|') : text(raw.url) || [text(raw.name),text(raw.boundary_set_name)].join('|');
    if (!text(raw.name)) return;
    if (map.has(key)) { if (!map.get(key).matches.includes(match)) map.get(key).matches.push(match); return; }
    if (kind === 'representatives') map.set(key, {
      name:text(raw.name), office:text(raw.elected_office), district:text(raw.district_name), legislature:text(raw.representative_set_name), level:levelOf(raw), party:text(raw.party_name), email:text(raw.email),
      url:safeURL(raw.url), sourceURL:safeURL(raw.source_url), boundaryURL:providerURL(raw.related?.boundary_url), matches:[match],
      offices:array(raw.offices).filter(o=>o&&typeof o==='object').map(o=>({type:text(o.type),postal:text(o.postal),tel:text(o.tel)}))
    });
    else map.set(key,{name:text(raw.name),set:text(raw.boundary_set_name),setURL:providerURL(raw.related?.boundary_set_url),url:providerURL(raw.url),id:text(raw.external_id),matches:[match]});
  });
}
export function validateReceipt(receipt) {
  if (receipt?.schemaVersion !== 1 || receipt.provider !== 'Represent by Open North' || !Number.isFinite(Date.parse(receipt.capturedAt))) throw new Error('Choose a Civic Lookup receipt JSON file.');
  validateQuery(receipt.query);
  if (!receipt.responses || typeof receipt.responses !== 'object' || !Array.isArray(receipt.sourceURLs) || !receipt.sourceURLs.length || receipt.sourceURLs.some(url=>!providerURL(url))) throw new Error('Receipt source information is invalid.');
  if (typeof receipt.complete !== 'boolean') throw new Error('Receipt completeness is missing.');
  if (receipt.query.mode === 'postal') {
    const p = receipt.responses.postal;
    if (!p || ['boundaries_centroid','boundaries_concordance'].some(k=>!Array.isArray(p[k])) || ['representatives_centroid','representatives_concordance'].some(k=>Object.hasOwn(p,k)&&!Array.isArray(p[k]))) throw new Error('Postal response is incomplete or unrecognized.');
    if (p.code !== validateQuery(receipt.query).postalCode) throw new Error('Postal receipt does not match its query.');
  } else {
    for (const kind of ['representatives','boundaries']) if (!Array.isArray(receipt.responses[kind]?.objects)) throw new Error('Coordinate response is incomplete or unrecognized.');
  }
  return receipt;
}
export function normalizeReceipt(receipt) {
  validateReceipt(receipt);
  const reps = new Map(), bounds = new Map();
  if (receipt.query.mode === 'postal') {
    const p=receipt.responses.postal;
    for (const [field, match] of [['centroid','Postal centroid'],['concordance','Postal concordance']]) {
      // Represent omits a representative group when it has no matches.
      // Preserve the original response in receipts; only the display uses an empty list.
      addMatches(reps,array(p[`representatives_${field}`]),match,'representatives'); addMatches(bounds,p[`boundaries_${field}`],match,'boundaries');
    }
  } else {
    addMatches(reps,receipt.responses.representatives.objects,'Coordinate match','representatives');
    addMatches(bounds,receipt.responses.boundaries.objects,'Coordinate match','boundaries');
  }
  const order=['Federal','Provincial / territorial','Municipal','Other'];
  const representatives=[...reps.values()].sort((a,b)=>order.indexOf(a.level)-order.indexOf(b.level)||a.name.localeCompare(b.name));
  const boundURLs = new Set(representatives.map(r=>r.boundaryURL).filter(Boolean));
  const boundaries=[...bounds.values()].map(b=>({...b,linked:boundURLs.has(b.url)})).sort((a,b)=>Number(b.linked)-Number(a.linked)||a.set.localeCompare(b.set)||a.name.localeCompare(b.name));
  return { representatives,boundaries,levels:order.filter(l=>representatives.some(r=>r.level===l)),place:receipt.query.mode==='postal'?[receipt.responses.postal.city,receipt.responses.postal.province].filter(Boolean).join(', '):'' };
}
export function filterReps(reps, level, search) {
  const words = search.trim().toLocaleLowerCase();
  return reps.filter(r=>(!level||r.level===level)&&(!words||[r.name,r.office,r.district,r.legislature,r.party].join(' ').toLocaleLowerCase().includes(words)));
}
const csvCell = value => '"'+String(value??'').replace(/^\s*[=+@-]/,"'$&").replaceAll('"','""')+'"';
export function receiptCSV(receipt) {
  const {representatives}=normalizeReceipt(receipt);
  return [['Name','Office','Level','District','Assembly','Party','Email','Official page','Source','Match method','Retrieved UTC','Query'],...representatives.map(r=>[r.name,r.office,r.level,r.district,r.legislature,r.party,r.email,r.url,r.sourceURL,r.matches.join('; '),receipt.capturedAt,receipt.query.label])].map(row=>row.map(csvCell).join(',')).join('\r\n');
}
export function errorMessage(error) {
  if (error?.name==='AbortError') return 'Represent did not respond in time. Try again later.';
  return error instanceof TypeError ? 'Represent could not be reached from this browser. A network, CORS, or provider restriction may be responsible. Try again later or open Represent directly.' : error.message || 'The lookup could not be completed.';
}
