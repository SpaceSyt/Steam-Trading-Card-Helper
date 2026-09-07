import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {getCurrencyContextById,parseCurrencyAmount} from '../src/services/currency.js';
import {getSellerReceiveForBuyerPrice,getBuyerPriceForSellerReceive} from '../src/utils/market-fees.js';

function buildOffsets(price,currency){
 const offsets=[-2,-1,0,1,2].map(offsetMinor=>{
  const requestedMinor=price+offsetMinor;
  const referenceMinor=Math.max(currency.minimumBuyerMinor,requestedMinor);
  const sellerNetMinor=getSellerReceiveForBuyerPrice(referenceMinor,currency);
  return {offsetMinor,requestedMinor,referenceMinor,minimumClamped:requestedMinor!==referenceMinor,sellerNetMinor,actualBuyerMinor:getBuyerPriceForSellerReceive(sellerNetMinor,currency)};
 });
 const baseline=offsets[2];
 for(const quote of offsets){quote.netChangeMinor=quote.sellerNetMinor-baseline.sellerNetMinor;quote.netChangePercent=baseline.sellerNetMinor>0?quote.netChangeMinor/baseline.sellerNetMinor*100:null;quote.actualPriceChangeMinor=quote.actualBuyerMinor-baseline.actualBuyerMinor;}
 return offsets;
}
function summarize(samples){
 return [-2,-1,1,2].map(offset=>{
  const quotes=samples.map(sample=>sample.offsets.find(q=>q.offsetMinor===offset));
  const relative=quotes.map(q=>Math.abs(q.netChangePercent)).filter(Number.isFinite).sort((a,b)=>a-b);
  return {offsetMinor:offset,samples:quotes.length,minimumClamped:quotes.filter(q=>q.minimumClamped).length,unchangedActualPrice:quotes.filter(q=>q.actualPriceChangeMinor===0).length,medianAbsoluteNetChangePercent:relative.length%2?relative[Math.floor(relative.length/2)]:(relative[relative.length/2-1]+relative[relative.length/2])/2,maximumAbsoluteNetChangePercent:relative.at(-1)};
 });
}
if(process.argv[2]==='--reanalyze'){
 const file=resolve(process.argv[3]);const data=JSON.parse(await readFile(file,'utf8'));const currency=getCurrencyContextById(data.currencyId);
 for(const sample of data.samples)sample.offsets=buildOffsets(parseCurrencyAmount(sample.response.lowest_price,currency),currency);
 data.summary=summarize(data.samples);data.reanalyzedAt=new Date().toISOString();
 await writeFile(file,JSON.stringify(data,null,2)+'\n');console.log(JSON.stringify(data.summary,null,2));process.exit(0);
}

// Offline priceoverview research. No currency conversion of the USD orderbook.
const sourceManifest=resolve(process.argv[2]);
const currencyId=Number(process.argv[3] || 23);
const currency=getCurrencyContextById(currencyId);
if(!currency.verified)throw Error('Unverified fee model');
const source=JSON.parse(await readFile(sourceManifest,'utf8'));
const startedAt=new Date().toISOString();
const output=resolve(`test/fixtures-public/market/snapshots/${startedAt.replace(/[:.]/g,'-')}-priceoverview-${currencyId}`);
await mkdir(output,{recursive:true});
const report={startedAt,currencyId,currencyCode:currency.code,sourceManifest:sourceManifest.replaceAll('\\','/').split('/test/')[1],authentication:'none',assumptions:['Priceoverview accepts an explicit currency but supplies no order depth.','Seller proceeds use the project default fee model. Native sale submission uses seller proceeds, so some requested prices round to the same actual listing price.','No execution-speed or profit-optimality claim can be made from these quotes alone.'],samples:[],errors:[]};
const save=()=>writeFile(resolve(output,'price-offsets.json'),JSON.stringify(report,null,2)+'\n');
const targets=[...new Set(source.samples.map(sample=>sample.marketHashName))];
for(const marketHashName of targets){
 const params=new URLSearchParams({appid:'753',currency:String(currencyId),market_hash_name:marketHashName});
 const url='https://steamcommunity.com/market/priceoverview/?'+params;
 try{
  const response=await fetch(url,{credentials:'omit',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(`HTTP ${response.status}`);
  const raw=await response.json();
  const price=raw.success?parseCurrencyAmount(raw.lowest_price,currency):null;
  if(!Number.isSafeInteger(price)||price<=0)throw Error('No usable lowest price');
  const offsets=buildOffsets(price,currency);
  const baseline=offsets[2];
  report.samples.push({marketHashName,sourceUrl:url,fetchedAt:new Date().toISOString(),currencyEvidence:'Explicit request parameter and currency-formatted priceoverview response; no eCurrency field in this endpoint.',response:{success:raw.success,lowest_price:raw.lowest_price,median_price:raw.median_price,volume:raw.volume},offsets});
  console.log(`${report.samples.length}/${targets.length} ${marketHashName}: ${raw.lowest_price}; net ${baseline.sellerNetMinor}`);
 }catch(error){report.errors.push({marketHashName,message:error.message});console.log(`${marketHashName}: ${error.message}`);if(error.message.includes('429')){await save();throw error;}}
 await save();await new Promise(resolve=>setTimeout(resolve,3500));
}
report.completedAt=new Date().toISOString();
report.summary=summarize(report.samples);
await save();console.log(output);console.log(JSON.stringify(report.summary));console.log('Userscript bytes:',(await stat('steam-trading-card-helper.user.js')).size);
