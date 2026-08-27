const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');

let sharp;
try { sharp = require('sharp'); } catch(e) { console.warn('sharp not available', e); }

const SUPPORTED_IMG = new Set(['.jpg','.jpeg','.png','.webp','.bmp','.gif']);
// Resolve app root that survives rebuilds and works for both dev and portable
function getAppRoot() {
  if (!app.isPackaged) return path.join(__dirname, '..');
  const exeDir = path.dirname(app.getPath('exe'));
  // If running from out/win-unpacked inside repo (has package.json two levels up), use repo root so models survive rebuild
  const repoRoot = path.join(exeDir, '..', '..');
  try {
    if (fs.existsSync(path.join(repoRoot, 'package.json')) && fs.existsSync(path.join(repoRoot, 'models'))) {
      return repoRoot;
    }
    // Also check if repoRoot has models folder even without .gitkeep
    if (fs.existsSync(path.join(repoRoot, 'package.json'))) {
      return repoRoot;
    }
  } catch {}
  // Standalone portable (unzipped to Desktop etc.) — models next to exe
  return exeDir;
}
const APP_ROOT = getAppRoot();
const RESOURCES_DIR = app.isPackaged ? path.join(path.dirname(app.getPath('exe')), 'resources', 'app') : path.join(__dirname, '..');
const CONFIG_DIR = path.join(APP_ROOT, 'config');
const MODELS_DIR = path.join(APP_ROOT, 'models');
const PROMPTS_DIR = app.isPackaged ? path.join(RESOURCES_DIR, 'prompts') : path.join(__dirname, '..', 'prompts');
const BIN_CANDIDATES = app.isPackaged
  ? [path.join(APP_ROOT, 'bin'), path.join(RESOURCES_DIR, 'bin'), path.join(__dirname, '..', 'bin'), path.join(path.dirname(app.getPath('exe')), 'bin')]
  : [path.join(__dirname, '..', 'bin')];
const BIN_DIR = BIN_CANDIDATES[0];

let mainWindow, splash;
let llamaProc = null;
let llamaPort = 0;
let activeCancel = null;
let llamaLog = '';
// FrameForge fast path — loaded from app/src of https://github.com/Arnold2006/FrameForge
let frameforgePrompt, frameforgeGenSchema, frameforgeNormalize, frameforgeValidate;
try {
  const promptMod = require('./frameforge/prompt');
  const genSchemaMod = require('./frameforge/generation-schema');
  const normMod = require('./frameforge/normalize');
  const valMod = require('./frameforge/validate');
  frameforgePrompt = promptMod;
  frameforgeGenSchema = genSchemaMod.GENERATION_SCHEMA;
  frameforgeNormalize = normMod.normalizeCaption;
  frameforgeValidate = valMod.validateCaption;
  console.log('[frameforge] loaded prompt + schema (5s path)');
} catch(e) { console.warn('[frameforge] failed to load', e.message); }

function createSplash(){
  splash = new BrowserWindow({ width:380, height:260, frame:false, transparent:true, alwaysOnTop:true, center:true, resizable:false, show:true, skipTaskbar:false });
  splash.loadFile(path.join(__dirname, 'splash.html'));
  splash.on('closed', ()=>{ splash=null; });
}

function createWindow(){
  createSplash();
  mainWindow = new BrowserWindow({
    width: 1400, height: 900, minWidth: 1000, minHeight: 600, show:false, backgroundColor:'#181818',
    webPreferences: { preload: path.join(__dirname,'preload.js'), contextIsolation:true, nodeIntegration:false },
    autoHideMenuBar:true, title:'Ideogram 4 Dataset Editor'
  });
  mainWindow.once('ready-to-show', ()=> setTimeout(()=>{ if(splash) splash.close(); mainWindow.show(); mainWindow.focus(); }, 300));
  const isDev = !app.isPackaged;
  if(isDev){
    const devUrl='http://localhost:5173';
    const fallback=path.join(__dirname,'..','dist','index.html');
    function isViteReady(url){ return new Promise(res=>{ const req=http.get(url, r=>{ res(r.statusCode>=200&&r.statusCode<400); r.resume(); }); req.on('error',()=>res(false)); req.setTimeout(600,()=>{req.destroy();res(false);}); }); }
    (async()=>{ const start=Date.now(); while(Date.now()-start<15000){ if(await isViteReady(devUrl)){ mainWindow.loadURL(devUrl); return; } await new Promise(r=>setTimeout(r,300)); } mainWindow.loadFile(fallback); })();
    mainWindow.webContents.on('did-fail-load',(_e,c,d,u)=>{ if(!u.includes('5173')) console.error('did-fail-load',c,d,u); });
  } else {
    mainWindow.loadFile(path.join(__dirname,'..','dist','index.html'));
  }
}

app.whenReady().then(()=>{ ensureDirs(); createWindow(); });
app.on('window-all-closed', ()=>{ if(process.platform!=='darwin') app.quit(); });
app.on('before-quit', ()=>{ killLlama(); });
app.on('activate', ()=>{ if(BrowserWindow.getAllWindows().length===0) createWindow(); });

async function ensureDirs(){
  for(const d of [CONFIG_DIR, MODELS_DIR, PROMPTS_DIR, BIN_DIR]){ try{ await fsp.mkdir(d,{recursive:true}); }catch{} }
  // Migrate from old out/win-unpacked/* locations (pre-fix) to new APP_ROOT/* so uploads survive rebuilds
  if(app.isPackaged){
    const exeDir = path.dirname(app.getPath('exe'));
    const migrations = [
      [path.join(exeDir, 'models'), MODELS_DIR],
      [path.join(exeDir, 'bin'), BIN_DIR],
      [path.join(exeDir, 'config'), CONFIG_DIR],
    ];
    for(const [oldDir, newDir] of migrations){
      try{
        if(oldDir===newDir) continue;
        if(!fs.existsSync(oldDir)) continue;
        const oldFiles = await fsp.readdir(oldDir).catch(()=>[]);
        const newFiles = await fsp.readdir(newDir).catch(()=>[]);
        const oldHasData = oldFiles.some(f=>!f.startsWith('.') && f!=='.gitkeep');
        const newHasData = newFiles.some(f=>!f.startsWith('.') && f!=='.gitkeep');
        if(oldHasData && !newHasData){
          console.log(`[migrate] moving ${oldDir} -> ${newDir}`);
          for(const f of oldFiles){
            if(f==='.gitkeep') continue;
            const src=path.join(oldDir,f), dst=path.join(newDir,f);
            try{ await fsp.copyFile(src,dst); console.log(`[migrate] copied ${f}`); }catch(e){ console.warn(`[migrate] copy failed ${f}:`,e.message); }
          }
        }
      }catch(e){ console.warn('[migrate] failed',e.message); }
    }
  }
  try{ await fsp.writeFile(path.join(MODELS_DIR,'.gitkeep'),'',{flag:'wx'}); }catch{}
  try{ await fsp.writeFile(path.join(CONFIG_DIR,'.gitkeep'),'',{flag:'wx'}); }catch{}
  try{ await fsp.writeFile(path.join(BIN_DIR,'.gitkeep'),'',{flag:'wx'}); }catch{}
  // bootstrap default prompt copy if config missing
  try{
    const cfgPrompt = path.join(CONFIG_DIR,'prompt.txt');
    await fsp.access(cfgPrompt);
  }catch{
    try{
      const def = await fsp.readFile(path.join(PROMPTS_DIR,'ideogram4_default.txt'),'utf8');
      await fsp.writeFile(path.join(CONFIG_DIR,'prompt.txt'), def, 'utf8');
    }catch{}
  }
}

// dataset pairing — load folder, list images, no Filesystem Access API
async function listDatasetEntries(folder){
  const dirents = await fsp.readdir(folder,{withFileTypes:true});
  const byBase = {};
  for(const d of dirents){
    if(!d.isFile()) continue;
    const ext = path.extname(d.name).toLowerCase();
    const base = d.name.slice(0, d.name.length - path.extname(d.name).length);
    if(!byBase[base]) byBase[base]={base};
    if(SUPPORTED_IMG.has(ext)) byBase[base].imgName = d.name;
    if(ext==='.json') byBase[base].jsonName = d.name;
  }
  const entries=[];
  for(const v of Object.values(byBase)){
    if(!v.imgName) continue; // need image
    const imgPath = path.join(folder, v.imgName);
    const jsonPath = path.join(folder, v.jsonName || (v.base + '.json'));
    let data=null, hasJson=false, raw=null;
    if(v.jsonName){
      try{ raw = await fsp.readFile(jsonPath,'utf8'); data = JSON.parse(raw); hasJson = true; }catch{ data = {}; hasJson = !!v.jsonName; }
    } else {
      data = {};
    }
    // stat for mtime/size
    let stat=null; try{ stat=await fsp.stat(imgPath);}catch{}
    entries.push({ base:v.base, imgName:v.imgName, jsonName: path.basename(jsonPath), imgPath, jsonPath, hasJson, data, raw, size: stat?stat.size:0, mtime: stat?stat.mtimeMs:0 });
  }
  entries.sort((a,b)=>a.base.localeCompare(b.base));
  return entries;
}

ipcMain.handle('select-folder', async()=>{
  const win = BrowserWindow.getFocusedWindow()||mainWindow;
  try{ const r=await dialog.showOpenDialog(win,{properties:['openDirectory']}); if(r.canceled||!r.filePaths[0]) return null; return r.filePaths[0]; }
  catch{ const r2=await dialog.showOpenDialog({properties:['openDirectory']}); if(r2.canceled||!r2.filePaths[0]) return null; return r2.filePaths[0]; }
});
ipcMain.handle('check-path', async(_e,p)=>{ try{ const st=await fsp.stat(p); return {exists:true,isDirectory:st.isDirectory(),isFile:st.isFile(),path:p,dir:st.isDirectory()?p:path.dirname(p)};}catch(e){ return {exists:false,error:e.message,path:p}; }});
ipcMain.handle('list-dataset', async(_e,folder)=>{ if(!folder) return []; try{ await fsp.access(folder);}catch{ return [];} return await listDatasetEntries(folder); });

ipcMain.handle('get-thumbnail', async(_e,imagePath,size=280)=>{
  if(!sharp) throw new Error('sharp missing');
  const buf = await sharp(imagePath).rotate().resize(size,size,{fit:'inside',withoutEnlargement:true}).jpeg({quality:70}).toBuffer();
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
});
ipcMain.handle('get-image-data', async(_e,imagePath)=>{
  if(!sharp) throw new Error('sharp missing');
  const meta = await sharp(imagePath).rotate().metadata();
  const buf = await sharp(imagePath).rotate().resize(1600,1600,{fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer();
  return { dataUrl:`data:image/jpeg;base64,${buf.toString('base64')}`, width:meta.width, height:meta.height, format:meta.format };
});
ipcMain.handle('read-json', async(_e,jsonPath)=>{ const t=await fsp.readFile(jsonPath,'utf8'); return JSON.parse(t); });
ipcMain.handle('write-json', async(_e,jsonPath,data)=>{ const txt = typeof data==='string'?data:JSON.stringify(data,null,2); await fsp.writeFile(jsonPath,txt,'utf8'); return true; });
ipcMain.handle('write-json-atomic', async(_e,folder,base,data)=>{
  const jsonPath = path.join(folder, base + '.json');
  const txt = typeof data==='string'?data:JSON.stringify(data,null,2);
  await fsp.writeFile(jsonPath, txt, 'utf8');
  return jsonPath;
});

// models
function ggufMagicValid(buf){ return buf.length>=4 && buf[0]===0x47 && buf[1]===0x47 && buf[2]===0x55 && buf[3]===0x46; } // "GGUF"
ipcMain.handle('list-models', async()=>{
  await fsp.mkdir(MODELS_DIR,{recursive:true});
  const files = await fsp.readdir(MODELS_DIR);
  const out=[];
  for(const f of files){ if(!f.toLowerCase().endsWith('.gguf')) continue; const full=path.join(MODELS_DIR,f); try{ const st=await fsp.stat(full); const fd=await fsp.open(full,'r'); const buf=Buffer.alloc(4); await fd.read(buf,0,4,0); await fd.close(); const valid=ggufMagicValid(buf); out.push({name:f,path:full,size:st.size,mtime:st.mtimeMs,valid}); }catch(e){ out.push({name:f,error:e.message}); } }
  out.sort((a,b)=>a.name.localeCompare(b.name));
  let active=null; try{ const t=await fsp.readFile(path.join(MODELS_DIR,'active.json'),'utf8'); active=JSON.parse(t);}catch{}
  return {models:out, active};
});
ipcMain.handle('select-model-file', async()=>{
  const win=BrowserWindow.getFocusedWindow()||mainWindow;
  const r=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'GGUF',extensions:['gguf']}]}); if(r.canceled||!r.filePaths[0]) return null; return r.filePaths[0];
});
ipcMain.handle('upload-model', async(_e, srcPath)=>{
  if(!srcPath) throw new Error('No file selected');
  console.log('[models] upload request:', srcPath, '->', MODELS_DIR);
  await fsp.mkdir(MODELS_DIR,{recursive:true});
  const base = path.basename(srcPath);
  const dest = path.join(MODELS_DIR, base);
  // Validate source exists and is readable
  try { await fsp.access(srcPath); } catch(e){ throw new Error('Source file not accessible: '+e.message); }
  // For large gguf (up to 10GB), use streaming copy to avoid ENOMEM and show progress
  await new Promise((resolve, reject)=>{
    const rs = fs.createReadStream(srcPath);
    const ws = fs.createWriteStream(dest);
    let copied=0;
    rs.on('error', reject);
    ws.on('error', reject);
    ws.on('finish', resolve);
    rs.on('data', chunk=>{
      copied+=chunk.length;
      // throttle log every 500MB
      if(copied % (500*1024*1024) < chunk.length) console.log(`[models] copying ${base}: ${(copied/1024/1024).toFixed(0)} MB`);
    });
    rs.pipe(ws);
  });
  // validate magic after copy
  let fd;
  try{
    fd=await fsp.open(dest,'r'); const buf=Buffer.alloc(4); await fd.read(buf,0,4,0); await fd.close(); fd=null;
    if(!ggufMagicValid(buf)){
      try{ await fsp.unlink(dest); }catch{}
      throw new Error('Not a GGUF file (magic mismatch — file does not start with GGUF)');
    }
  } finally { if(fd) try{await fd.close();}catch{} }
  console.log('[models] saved to', dest, 'size', (await fsp.stat(dest)).size);
  return { name: base, path: dest };
});
ipcMain.handle('delete-model', async(_e,name)=>{
  const full=path.join(MODELS_DIR, name);
  await fsp.unlink(full);
  // clear active if deleting active
  try{ const t=await fsp.readFile(path.join(MODELS_DIR,'active.json'),'utf8'); const j=JSON.parse(t); if(j.model===name || j.mmproj===name){ await fsp.unlink(path.join(MODELS_DIR,'active.json')); killLlama(); } }catch{}
  return true;
});
ipcMain.handle('set-active-model', async(_e,name,mmproj)=>{
  await fsp.mkdir(MODELS_DIR,{recursive:true});
  const obj={model:name||null, mmproj: mmproj||null, updatedAt: Date.now()};
  await fsp.writeFile(path.join(MODELS_DIR,'active.json'), JSON.stringify(obj,null,2),'utf8');
  killLlama();
  return obj;
});
ipcMain.handle('get-active-model', async()=>{
  try{ const t=await fsp.readFile(path.join(MODELS_DIR,'active.json'),'utf8'); return JSON.parse(t);}catch{ return null;}
});

// prompts
ipcMain.handle('get-prompt', async()=>{
  try{ const t=await fsp.readFile(path.join(CONFIG_DIR,'prompt.txt'),'utf8'); if(t.trim()) return t; }catch{}
  try{ return await fsp.readFile(path.join(PROMPTS_DIR,'ideogram4_default.txt'),'utf8'); }catch{ return ''; }
});
ipcMain.handle('save-prompt', async(_e,text)=>{
  await fsp.mkdir(CONFIG_DIR,{recursive:true});
  await fsp.writeFile(path.join(CONFIG_DIR,'prompt.txt'), text||'', 'utf8');
  return true;
});
ipcMain.handle('restore-prompt', async()=>{
  const def = await fsp.readFile(path.join(PROMPTS_DIR,'ideogram4_default.txt'),'utf8');
  await fsp.mkdir(CONFIG_DIR,{recursive:true});
  await fsp.writeFile(path.join(CONFIG_DIR,'prompt.txt'), def, 'utf8');
  return def;
});

// llama.cpp inference — handles both exeDir/bin and resources/app/bin (fix for electron-builder)
function findLlamaBinary(name){
  for(const dir of BIN_CANDIDATES){
    const p = path.join(dir, name);
    try{ if(fs.existsSync(p) && fs.statSync(p).size>1024) return p; }catch{}
    const sub = path.join(dir, 'llama-server', name);
    try{ if(fs.existsSync(sub)) return sub; }catch{}
  }
  return path.join(BIN_DIR, name);
}
function getLlamaBinary(){
  const cuda = findLlamaBinary('llama-server-cuda.exe');
  const cpu = findLlamaBinary('llama-server.exe');
  if(fs.existsSync(cuda)) return cuda;
  if(fs.existsSync(cpu)) return cpu;
  return cpu;
}
async function ensureLlamaBinaryAvailable(){
  const cpu = findLlamaBinary('llama-server.exe');
  if(fs.existsSync(cpu) && fs.statSync(cpu).size>1024) return cpu;
  // try to auto-download (internet required, once)
  logToDialog('llama-server not found — downloading automatically...');
  try{ await downloadLlamaBinaries(); }catch(e){ console.warn('auto-download failed', e); }
  const after = findLlamaBinary('llama-server.exe');
  if(fs.existsSync(after)) return after;
  throw new Error('llama-server binary not found at '+cpu+'. Auto-download failed — check internet or place llama-server.exe (and cuda variant) in bin/. See bin/README.md or run: node scripts/fetch-llama.js');
}
function logToDialog(msg){
  try{ if(mainWindow) mainWindow.webContents.send('generate-progress',{log:msg}); }catch{}
  console.log('[llama] '+msg);
}
async function downloadLlamaBinaries(){
  // Reuse scripts/fetch-llama.js logic inline so it works in packaged app without external node.
  // Downloads pinned release via HTTPS and expands via PowerShell Expand-Archive.
  const targetDir = BIN_DIR;
  await fsp.mkdir(targetDir,{recursive:true});
  const pinTag='b10419';
  const pinCpuUrl='https://github.com/ggml-org/llama.cpp/releases/download/b10419/llama-b10419-bin-win-avx2-x64.zip';
  const pinCudaUrl='https://github.com/ggml-org/llama.cpp/releases/download/b10419/llama-b10419-bin-win-cuda-12.4-x64.zip';
  // try GitHub API for latest
  async function fetchJson(url){
    return new Promise((res,rej)=>{
      const req=https.get(url,{headers:{'User-Agent':'ideogram4','Accept':'application/vnd.github+json'}}, r=>{
        if(r.statusCode>=300&&r.statusCode<400&&r.headers.location){
          fetchJson(r.headers.location).then(res,rej); return;
        }
        let d=''; r.on('data',c=>d+=c); r.on('end',()=>{
          if(r.statusCode>=200&&r.statusCode<300){ try{res(JSON.parse(d));}catch(e){rej(e);} } else rej(new Error('HTTP '+r.statusCode));
        });
      });
      req.on('error',rej); req.setTimeout(8000,()=>{req.destroy();rej(new Error('timeout'));});
    });
  }
  function dl(url,dest){
    return new Promise((res,rej)=>{
      logToDialog('Downloading '+url);
      const file=fs.createWriteStream(dest);
      const req=https.get(url,{headers:{'User-Agent':'ideogram4'}}, r=>{
        if(r.statusCode>=300&&r.statusCode<400&&r.headers.location){
          file.close(); try{fs.unlinkSync(dest);}catch{}
          dl(r.headers.location,dest).then(res,rej); return;
        }
        if(r.statusCode!==200){ file.close(); try{fs.unlinkSync(dest);}catch{} rej(new Error('HTTP '+r.statusCode)); return; }
        r.pipe(file); file.on('finish',()=>file.close(res));
      });
      req.on('error',e=>{ file.close(); try{fs.unlinkSync(dest);}catch{} rej(e); });
      req.setTimeout(30000,()=>{req.destroy(); file.close(); try{fs.unlinkSync(dest);}catch{} rej(new Error('timeout'));});
    });
  }
  function expand(zip, out){
    if(process.platform==='win32'){
      const ps=`Expand-Archive -LiteralPath '${zip}' -DestinationPath '${out}' -Force`;
      require('child_process').execSync(`powershell -NoProfile -Command "${ps.replace(/"/g,'`"')}"`,{stdio:'inherit'});
    } else require('child_process').execSync(`unzip -o "${zip}" -d "${out}"`,{stdio:'inherit'});
  }
  let cpuUrl=pinCpuUrl, cudaUrl=pinCudaUrl;
  try{
    const list=await fetchJson('https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=30');
    for(const data of list){
      if(!data.tag_name || !/^b\d+/.test(data.tag_name)) continue;
      const ver=parseInt(data.tag_name.slice(1),10);
      if(ver < 6887) continue;
      const assets=data.assets||[];
      const cpu=assets.find(a=>/^llama-b.*-bin-win-cpu-x64\.zip$/i.test(a.name)) || assets.find(a=>/^llama-b.*-bin-win-avx2-x64\.zip$/i.test(a.name));
      if(!cpu) continue;
      const cuda=assets.find(a=>/^llama-b.*-bin-win-cuda-12\.4-x64\.zip$/i.test(a.name));
      if(!cuda) continue;
      cpuUrl=cpu.browser_download_url; cudaUrl=cuda.browser_download_url;
      logToDialog(`Latest via API: ${data.tag_name} — ${cpu.name} / ${cuda.name}`);
      break;
    }
  }catch{}
  const jobs=[];
  if(!fs.existsSync(findLlamaBinary('llama-server.exe'))) jobs.push({url:cpuUrl, target:'llama-server.exe'});
  if(!fs.existsSync(findLlamaBinary('llama-server-cuda.exe')) && cudaUrl) jobs.push({url:cudaUrl, target:'llama-server-cuda.exe'});
  for(const job of jobs){
    const zipName=path.basename(job.url);
    const zipPath=path.join(targetDir, zipName);
    const tmpDir=path.join(targetDir,'_dl_tmp');
    try{
      await fsp.mkdir(tmpDir,{recursive:true});
      if(!fs.existsSync(zipPath)) await dl(job.url, zipPath);
      expand(zipPath, tmpDir);
      // find exe
      let found=null;
      (function walk(d){ for(const e of fs.readdirSync(d,{withFileTypes:true})){ const p=path.join(d,e.name); if(e.isDirectory()) walk(p); else if(/^llama-server(\.exe)?$/i.test(e.name) && !found) found=p; } })(tmpDir);
      if(found){
        const dest=path.join(targetDir, job.target);
        fs.copyFileSync(found, dest);
        logToDialog('Installed '+dest);
        // copy dlls — overwrite to match exe version
        (function copyDlls(d){ for(const e of fs.readdirSync(d,{withFileTypes:true})){ const p=path.join(d,e.name); if(e.isDirectory()) copyDlls(p); else if(/\.dll$/i.test(e.name)){ const dd=path.join(targetDir,e.name); try{fs.copyFileSync(p,dd);}catch{} } } })(tmpDir);
      }
      try{ fs.rmSync(tmpDir,{recursive:true,force:true}); }catch{}
    } catch(e){ logToDialog('Download failed for '+job.target+': '+e.message); try{fs.rmSync(path.join(targetDir,'_dl_tmp'),{recursive:true,force:true});}catch{} }
  }
}
function killLlama(){
  if(llamaProc){ try{ llamaProc.kill(); }catch{} llamaProc=null; llamaPort=0; }
  if(activeCancel){ try{ activeCancel.abort(); }catch{} activeCancel=null; }
}
async function hasNvidia(){
  try{ const {execSync}=require('child_process'); execSync('nvidia-smi',{stdio:'ignore',timeout:2000}); return true; }catch{ return false; }
}
function getBinaryVersion(exe){
  try{
    const out = require('child_process').execSync(`"${exe}" --version`, {timeout:3000, windowsHide:true}).toString();
    const m = out.match(/b(\d+)/i);
    if(m) return parseInt(m[1],10);
  } catch{}
  return 0;
}
async function ensureLlamaRunning(){
  if(llamaProc && llamaPort) return llamaPort;
  const cfg = await (async()=>{ try{ return JSON.parse(await fsp.readFile(path.join(MODELS_DIR,'active.json'),'utf8'));}catch{ return null; }})();
  if(!cfg||!cfg.model) throw new Error('No active model selected. Upload Huihui-Qwen3-VL-4B gguf + mmproj-F16.gguf and select it in Settings.');
  const modelPath = path.join(MODELS_DIR, cfg.model);
  try{ await fsp.access(modelPath);}catch{ throw new Error('Active model file not found: '+cfg.model); }
  let mmprojPath=null;
  if(cfg.mmproj){ mmprojPath = path.join(MODELS_DIR, cfg.mmproj); try{ await fsp.access(mmprojPath);}catch{ throw new Error('mmproj file not found: '+cfg.mmproj); } }
  let bin;
  try{ bin = await ensureLlamaBinaryAvailable(); } catch(e){ throw e; }
  try{ await fsp.access(bin);}catch{ throw new Error('llama-server binary not found at '+bin+'. Auto-download failed — check internet or run: node scripts/fetch-llama.js'); }
  // Auto-update outdated binary for Qwen3-VL (needs b6887+, pinned b10419)
  if(cfg.model && cfg.model.toLowerCase().includes('qwen3')){
    const ver = getBinaryVersion(bin);
    if(ver && ver < 6887){
      logToDialog(`Binary ${bin} is b${ver} < b6887 — too old for Qwen3-VL, auto-updating to ${'b10419'}...`);
      try{
        for(const name of ['llama-server.exe','llama-server-cuda.exe']) { try{ await fsp.unlink(findLlamaBinary(name)); }catch{} }
        for(const f of await fsp.readdir(BIN_DIR).catch(()=>[])) if(/llama-b4242.*\.zip$/i.test(f)) try{ await fsp.unlink(path.join(BIN_DIR,f)); }catch{}
      }catch{}
      await downloadLlamaBinaries().catch(()=>{});
      bin = await ensureLlamaBinaryAvailable();
    }
  }
  // pick port
  const net=require('net');
  const getPort=()=> new Promise((res,rej)=>{ const s=net.createServer(); s.listen(0,()=>{ const p=s.address().port; s.close(()=>res(p)); }); s.on('error',rej); });
  llamaPort = await getPort();
  const { spawn } = require('child_process');
  // Match FrameForge (much faster): large context, flash-attn, full GPU offload, jinja, no-webui
  const CONTEXT_SIZE = 32768;
  const cudaBin = findLlamaBinary('llama-server-cuda.exe');
  const useGpu = fs.existsSync(cudaBin) && await hasNvidia();
  let exe = useGpu ? cudaBin : bin;
  const args = [
    '--model', modelPath,
    '--ctx-size', String(CONTEXT_SIZE),
    '--port', String(llamaPort),
    '--host', '127.0.0.1',
    '--no-webui',
    '--jinja',
    '--flash-attn', 'on',
    '--parallel', '1',
    '--log-disable',
  ];
  if(mmprojPath) args.push('--mmproj', mmprojPath);
  if(useGpu) args.push('--n-gpu-layers', '99');
  console.log(`[llama] Using ${useGpu ? 'GPU' : 'CPU'} — exe=${path.basename(exe)} ctx=${CONTEXT_SIZE} ${useGpu ? 'layers=99 flash-attn=on' : ''} mmproj=${mmprojPath ? 'yes' : 'no'}`);
  llamaLog='';
  llamaProc = spawn(exe, args, { stdio:['ignore','pipe','pipe'] });
  llamaProc.stdout.on('data',d=>{ const s=d.toString(); llamaLog+=(s+'\n'); if(llamaLog.length>8000) llamaLog=llamaLog.slice(-8000); console.log('[llama]', s.slice(0,500)); });
  llamaProc.stderr.on('data',d=>{ const s=d.toString(); llamaLog+=(s+'\n'); if(llamaLog.length>8000) llamaLog=llamaLog.slice(-8000); console.log('[llama]', s.slice(0,500)); });
  llamaProc.on('exit',(code,signal)=>{ console.log('llama exit',code,signal, llamaLog.slice(-500)); llamaProc=null; llamaPort=0; });
  // wait for /health
  const start=Date.now();
  while(Date.now()-start<30000){
    try{
      const ok = await new Promise((res)=>{
        const req=http.get(`http://127.0.0.1:${llamaPort}/health`, r=>{ res(r.statusCode>=200&&r.statusCode<400); r.resume(); });
        req.on('error',()=>res(false)); req.setTimeout(800,()=>{req.destroy();res(false);});
      });
      if(ok) return llamaPort;
    }catch{}
    await new Promise(r=>setTimeout(r,400));
    if(!llamaProc){
      const tail = llamaLog ? ('\nLast log:\n'+llamaLog.slice(-1200)) : '';
      // detect outdated binary for Qwen3-VL — auto-update
      if(/unknown.*qwen3/i.test(llamaLog) || /unknown model architecture/i.test(llamaLog)){
        logToDialog('Outdated binary detected (b4242) for Qwen3-VL — auto-updating to b10419...');
        try{
          for(const name of ['llama-server.exe','llama-server-cuda.exe']) { try{ await fsp.unlink(findLlamaBinary(name)); }catch{} }
          for(const f of await fsp.readdir(BIN_DIR).catch(()=>[])) if(/llama-b4242.*\.zip$/i.test(f)) try{ await fsp.unlink(path.join(BIN_DIR,f)); }catch{}
          await downloadLlamaBinaries();
        } catch(e){ logToDialog('auto-update failed: '+e.message); }
        throw new Error('llama-server was outdated (b4242) for Qwen3-VL and has been auto-updated to b10419.'+tail
          + '\n\nPlease click Test model again. If it still fails, run: node scripts/fetch-llama.js');
      }
      throw new Error('llama-server exited unexpectedly'+tail);
    }
  }
  throw new Error('llama-server did not become ready in 30s');
}

function stripFences(s){
  let t=s.trim();
  if(t.startsWith('```')){ t=t.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''); }
  return t;
}
function validateSchema(obj){
  if(typeof obj!=='object'||obj===null) throw new Error('not an object');
  if(typeof obj.high_level_description!=='string') obj.high_level_description = obj.high_level_description||'';
  if(!obj.style_description||typeof obj.style_description!=='object') obj.style_description={};
  if(!obj.compositional_deconstruction||typeof obj.compositional_deconstruction!=='object') obj.compositional_deconstruction={background:'',elements:[]};
  if(typeof obj.compositional_deconstruction.background!=='string') obj.compositional_deconstruction.background='';
  if(!Array.isArray(obj.compositional_deconstruction.elements)) obj.compositional_deconstruction.elements=[];
  for(const el of obj.compositional_deconstruction.elements){
    if(el.type!=='obj'&&el.type!=='text') throw new Error('element type must be obj or text');
    if(!Array.isArray(el.bbox)||el.bbox.length!==4) throw new Error('bbox must be [ymin,xmin,ymax,xmax]');
    for(const v of el.bbox){ if(!Number.isInteger(v)||v<0||v>1000) throw new Error('bbox values must be integers 0..1000'); }
    if(el.bbox[0]>=el.bbox[2]||el.bbox[1]>=el.bbox[3]){
      if(!(el.bbox[0]===0&&el.bbox[1]===0&&el.bbox[2]===0&&el.bbox[3]===0)) throw new Error('bbox ymin<xmax etc');
    }
  }
  const allowedTop=new Set(['high_level_description','style_description','compositional_deconstruction']);
  for(const k of Object.keys(obj)) if(!allowedTop.has(k)) delete obj[k];
  return obj;
}
// — FrameForge fast path (5s) — uses SYSTEM_PROMPT+FEW_SHOT, json_schema strict, streaming
function buildFrameForgeMessages(description, imageBase64, lastErrors, aspectRatio="1:1"){
  if(!frameforgePrompt) return null;
  const { SYSTEM_PROMPT, FEW_SHOT } = frameforgePrompt;
  const [arW, arH] = aspectRatio.split(":").map(Number);
  const gridW = arW >= arH ? 1000 : Math.round(1000 * arW / arH);
  const gridH = arH >= arW ? 1000 : Math.round(1000 * arH / arW);
  const arNote = `\n\nTarget aspect ratio: ${aspectRatio} (bbox grid is ${gridW}x${gridH}, x in [0,${gridW}], y in [0,${gridH}]). Place and size all bboxes to suit this canvas shape.`;
  const styleNote = `\n\nYou MUST always include the "style_description" object in your output. It is required, never optional. Choose either the photograph variant (with fields: aesthetics, lighting, photo, medium="photograph", color_palette) or the art variant (with fields: aesthetics, lighting, medium, art_style, color_palette). Always populate all fields with rich, specific values. Never omit style_description.`;
  const sysPrompt = SYSTEM_PROMPT + styleNote + arNote;
  const messages = [{ role: "system", content: sysPrompt }];
  for(const [user, response] of FEW_SHOT){
    messages.push({ role: "user", content: user });
    messages.push({ role: "assistant", content: response });
  }
  const errorSuffix = lastErrors.length>0 ? "\n\n(Your previous answer had these problems, fix them: " + lastErrors.join("; ") + ")" : "";
  let userContent;
  if(imageBase64){
    const base64Data = imageBase64.replace(/^data:[^;]+;base64,/, "");
    userContent = [
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Data}` } },
      { type: "text", text: (description ? `Analyse this image and use it as the subject. Additional context: ${description}` : "Analyse this image carefully and generate a detailed Ideogram 4 JSON prompt for it.") + errorSuffix }
    ];
  } else {
    userContent = (description || "Generate an Ideogram 4 JSON prompt.") + errorSuffix;
  }
  messages.push({ role: "user", content: userContent });
  return messages;
}
async function callLlamaServerFrameForge(messages, onChunk){
  const port = await ensureLlamaRunning();
  const body = JSON.stringify({
    model: "local",
    messages,
    temperature: 0.7,
    max_tokens: 3000,
    stream: true,
    response_format: { type: "json_schema", json_schema: { name: "ideogram_prompt", schema: frameforgeGenSchema, strict: true } }
  });
  const controller = new AbortController();
  activeCancel = controller;
  const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: controller.signal
  });
  if(!res.ok){
    const err = await res.text().catch(()=>String(res.status));
    activeCancel=null;
    throw new Error(`llama-server error ${res.status}: ${err.slice(0,600)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer="", fullText="";
  while(true){
    const { done, value } = await reader.read();
    if(done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for(const line of lines){
      if(!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if(data === "[DONE]") continue;
      try{
        const evt = JSON.parse(data);
        const chunk = evt.choices?.[0]?.delta?.content ?? "";
        if(chunk){ fullText += chunk; if(onChunk) onChunk(chunk); }
      }catch{}
    }
  }
  activeCancel=null;
  return fullText;
}
async function generateWithFrameForge(imagePath, customSystemPrompt){
  const port = await ensureLlamaRunning();
  // read image as base64 data url (like FrameForge)
  const imgBuf = await fsp.readFile(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  const mime = ext==='.png'?'image/png': ext==='.webp'?'image/webp': ext==='.gif'?'image/gif':'image/jpeg';
  const b64 = imgBuf.toString('base64');
  const dataUrl = `data:${mime};base64,${b64}`;
  // Use FrameForge pipeline if available, else fallback to custom prompt
  if(frameforgePrompt && frameforgeGenSchema && frameforgeNormalize && frameforgeValidate){
    const MAX_ATTEMPTS=2;
    let lastErrors=[];
    for(let attempt=1; attempt<=MAX_ATTEMPTS; attempt++){
      const messages = buildFrameForgeMessages("", dataUrl, lastErrors, "1:1");
      let text;
      try{
        text = await callLlamaServerFrameForge(messages, ()=>{});
      } catch(err){
        // fallback to non-schema if json_schema not supported by this build
        if(/json_schema|response_format/i.test(String(err.message))){
          console.warn('[frameforge] json_schema not supported, falling back to plain');
          return callLlamaChatFallback(imagePath, customSystemPrompt);
        }
        throw err;
      }
      let raw;
      try{ raw=JSON.parse(text); } catch{ lastErrors=["output was not parseable JSON"]; continue; }
      const normalized = frameforgeNormalize(raw);
      if(!normalized.ok){ lastErrors=[normalized.reason]; continue; }
      const { valid, errors } = frameforgeValidate(normalized.value);
      if(!valid){ lastErrors=errors; continue; }
      return normalized.value;
    }
    throw new Error(`Could not produce a valid Ideogram caption after ${MAX_ATTEMPTS} attempts. Last: ${lastErrors.join('; ')}`);
  }
  // fallback
  return callLlamaChatFallback(imagePath, customSystemPrompt);
}
async function callLlamaChatFallback(imagePath, systemPrompt){
  const port = await ensureLlamaRunning();
  const imgBuf = await fsp.readFile(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  const mime = ext==='.png'?'image/png': ext==='.webp'?'image/webp': ext==='.gif'?'image/gif':'image/jpeg';
  const b64 = imgBuf.toString('base64');
  const dataUrl = `data:${mime};base64,${b64}`;
  const body = JSON.stringify({
    model: 'ideogram4',
    messages: [
      { role:'system', content: systemPrompt },
      { role:'user', content: [ {type:'text', text:'Caption this image as JSON.'}, {type:'image_url', image_url:{url:dataUrl}} ] }
    ],
    temperature: 0.2,
    max_tokens: 2048,
    stream: false
  });
  const controller = new AbortController();
  activeCancel = controller;
  const resp = await new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port, path:'/v1/chat/completions', method:'POST', headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}}, res=>{
      let d=''; res.on('data',c=>d+=c); res.on('end',()=> resolve({status:res.statusCode, body:d}));
    });
    req.on('error',reject);
    controller.signal.addEventListener('abort',()=>{ req.destroy(); reject(new Error('Cancelled')); });
    req.write(body); req.end();
  });
  activeCancel=null;
  if(resp.status<200||resp.status>=300) throw new Error(`llama-server ${resp.status}: ${resp.body.slice(0,600)}`);
  let j; try{ j=JSON.parse(resp.body);}catch{ throw new Error('Invalid JSON from server: '+resp.body.slice(0,400)); }
  const content = j.choices?.[0]?.message?.content || j.choices?.[0]?.text || '';
  let text = stripFences(String(content));
  let parsed;
  try{ parsed=JSON.parse(text); }catch(e){
    const m=text.match(/\{[\s\S]*\}/);
    if(m){ try{ parsed=JSON.parse(m[0]); }catch{} }
    if(!parsed) throw new Error('Model did not return valid JSON. Raw: '+text.slice(0,800));
  }
  return validateSchema(parsed);
}
async function callLlamaChat(imagePath, systemPrompt){
  // Prefer FrameForge fast path (5s) — falls back to plain if needed
  try{
    if(frameforgePrompt) return await generateWithFrameForge(imagePath, systemPrompt);
  } catch(e){
    console.warn('[frameforge] fast path failed, fallback:', e.message);
  }
  return callLlamaChatFallback(imagePath, systemPrompt);
}

ipcMain.handle('generate-one', async(_e, opts)=>{
  const { imagePath, folder, base } = opts||{};
  const p = imagePath || (folder&&base? path.join(folder, base + path.extname((await fsp.readdir(folder)).find(n=>n.startsWith(base+'.'))||'')) : null);
  let imgPath = opts.imagePath;
  if(!imgPath && opts.folder && opts.base){
    const files=await fsp.readdir(opts.folder);
    const hit = files.find(n=> n.startsWith(opts.base+'.') && SUPPORTED_IMG.has(path.extname(n).toLowerCase()));
    if(!hit) throw new Error('Image not found for base '+opts.base);
    imgPath = path.join(opts.folder, hit);
  }
  if(!imgPath) throw new Error('No imagePath');
  // Use FrameForge pipeline directly (ignores custom prompt — FrameForge prompt is optimized for speed/quality).
  // If user has a custom prompt in config/prompt.txt, it will be used as fallback only.
  const customPrompt = await (async()=>{ try{ const t=await fsp.readFile(path.join(CONFIG_DIR,'prompt.txt'),'utf8'); if(t.trim().length>20) return t; }catch{} return null; })();
  // If custom prompt exists and FrameForge is disabled, use it; otherwise FrameForge fast path uses its own SYSTEM_PROMPT.
  // We pass customPrompt for fallback.
  const json = await generateWithFrameForge(imgPath, customPrompt || await fsp.readFile(path.join(PROMPTS_DIR,'ideogram4_default.txt'),'utf8').catch(()=>customPrompt));
  return json;
});

ipcMain.handle('cancel-generate', async()=>{ if(activeCancel) activeCancel.abort(); killLlama(); return true; });
ipcMain.handle('get-inference-status', async()=>{ return { running: !!llamaProc, port: llamaPort, pid: llamaProc?llamaProc.pid:null }; });
ipcMain.handle('restart-server', async()=>{ killLlama(); return true; });
ipcMain.handle('test-model', async()=>{
  // tiny 1x1 png test
  const tmp = path.join(app.getPath('temp'), 'ideogram4_test.png');
  if(sharp){
    const buf=await sharp({create:{width:1,height:1,channels:3,background:{r:128,g:128,b:128}}}).png().toBuffer();
    await fsp.writeFile(tmp, buf);
  } else {
    throw new Error('sharp missing for test');
  }
  const prompt = await (async()=>{ try{ return await fsp.readFile(path.join(CONFIG_DIR,'prompt.txt'),'utf8'); }catch{ return await fsp.readFile(path.join(PROMPTS_DIR,'ideogram4_default.txt'),'utf8'); }})();
  const j=await callLlamaChat(tmp, prompt);
  return j;
});

ipcMain.handle('open-path', async(_e,p)=> shell.openPath(p));
