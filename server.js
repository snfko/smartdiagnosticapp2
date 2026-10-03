const http = require('http');
const PORT = Number(process.env.PORT || 8787);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const MAX_BODY = 35_000_000;
const cors = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'Content-Type',
  'Access-Control-Allow-Methods':'POST, OPTIONS, GET'
};
function send(res,status,body){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...cors});res.end(JSON.stringify(body));}
function readBody(req){return new Promise((resolve,reject)=>{let data='';req.on('data',c=>{data+=c;if(data.length>MAX_BODY){reject(new Error('BODY_TOO_LARGE'));req.destroy();}});req.on('end',()=>{try{resolve(JSON.parse(data));}catch(e){reject(new Error('INVALID_JSON'));}});req.on('error',reject);});}
function promptFor(p){return `You are a careful vehicle diagnostic assistant. Analyze vehicle information, symptoms, and supplied images. Do not invent visual observations. Return ONLY JSON matching the requested schema. If exact part number or price is not supported, use "غير مؤكد". This is an assistive estimate, not a substitute for a qualified mechanic.\nVehicle: ${JSON.stringify({deviceType:p.deviceType,brand:p.brand,model:p.model,year:p.year,symptoms:p.symptoms,mode:p.mode})}`;}
async function callOpenAI(p){
  if(!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
  const content=[{type:'input_text',text:promptFor(p)}];
  for(const image of (Array.isArray(p.images)?p.images.slice(0,5):[])){
    if(typeof image==='string' && /^data:image\/(jpeg|jpg|png|webp);base64,/i.test(image)) content.push({type:'input_image',image_url:image,detail:'high'});
  }
  const schema={type:'object',additionalProperties:false,properties:{issue:{type:'string'},part:{type:'string'},location:{type:'string'},severity:{type:'string',enum:['low','medium','high']},confidence:{type:'number',minimum:0,maximum:100},reasons:{type:'array',items:{type:'string'}},partNumber:{type:'string'},partBrand:{type:'string'},price:{type:'string'},steps:{type:'array',items:{type:'string'}}},required:['issue','part','location','severity','confidence','reasons','partNumber','partBrand','price','steps']};
  const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:OPENAI_MODEL,input:[{role:'user',content}],text:{format:{type:'json_schema',name:'vehicle_diagnostic_report',strict:true,schema}},max_output_tokens:1400})});
  const raw=await r.text(); if(!r.ok) throw new Error(`OpenAI ${r.status}: ${raw.slice(0,800)}`);
  const data=JSON.parse(raw); const text=data.output_text || (data.output||[]).flatMap(x=>x.content||[]).map(x=>x.text||'').join(''); if(!text) throw new Error('OpenAI returned no report'); return JSON.parse(text);
}
const server=http.createServer(async(req,res)=>{
  if(req.method==='OPTIONS') return send(res,204,{});
  if(req.method==='GET' && req.url==='/health') return send(res,200,{ok:true,service:'smart-diagnostic-ai'});
  if(req.method==='POST' && req.url==='/analyze'){
    try{const payload=await readBody(req);if(!Array.isArray(payload.images)||!payload.images.length)return send(res,400,{error:'At least one image is required'});const report=await callOpenAI(payload);return send(res,200,{report});}
    catch(e){console.error(e);return send(res,500,{error:e.message||'Diagnostic failed'});}
  }
  send(res,404,{error:'Not found'});
});
server.listen(PORT,()=>console.log(`Smart Diagnostic backend listening on ${PORT}`));
