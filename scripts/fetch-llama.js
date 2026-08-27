#!/usr/bin/env node
// Download llama.cpp binaries automatically if missing.
// - Fetches latest release via GitHub API; falls back to pinned release.
// - Downloads CPU and optionally CUDA builds into bin/
// - No admin, no deps beyond Node 18+ (fetch built-in) + PowerShell Expand-Archive on Windows.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const https = require('https');
const { execSync, spawnSync } = require('child_process');

const BIN_DIR = path.join(__dirname, '..', 'bin');
const PINNED = {
  // Pinned known-good release if GitHub API fails. Must be b6887+ for Qwen3-VL support.
  tag: 'b10419',
  cpuAsset: 'llama-b10419-bin-win-avx2-x64.zip',
  cudaAsset: 'llama-b10419-bin-win-cuda-12.4-x64.zip',
  cpuUrl: 'https://github.com/ggml-org/llama.cpp/releases/download/b10419/llama-b10419-bin-win-avx2-x64.zip',
  cudaUrl: 'https://github.com/ggml-org/llama.cpp/releases/download/b10419/llama-b10419-bin-win-cuda-12.4-x64.zip',
};

function log(m){ console.log('[fetch-llama] ' + m); }

async function ensureBinDir(){ await fsp.mkdir(BIN_DIR, {recursive:true}); }

function binExists(name){
  const p = path.join(BIN_DIR, name);
  try{ return fs.existsSync(p) && fs.statSync(p).size > 1024; } catch{ return false; }
}

function httpsGetJson(url){
  return new Promise((resolve,reject)=>{
    const req = https.get(url, {headers:{'User-Agent':'ideogram4-fetch','Accept':'application/vnd.github+json'}}, res=>{
      if(res.statusCode>=300 && res.statusCode<400 && res.headers.location){
        // follow redirect (ggerganov -> ggml-org)
        httpsGetJson(res.headers.location).then(resolve, reject); return;
      }
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{
        if(res.statusCode>=200 && res.statusCode<300){ try{ resolve(JSON.parse(d)); } catch(e){ reject(e); } }
        else reject(new Error('HTTP '+res.statusCode+': '+d.slice(0,400)));
      });
    });
    req.on('error',reject);
    req.setTimeout(8000, ()=>{ req.destroy(); reject(new Error('timeout')); });
  });
}

function httpsDownload(url, dest){
  return new Promise((resolve,reject)=>{
    log('Downloading '+url);
    const file = fs.createWriteStream(dest);
    const req = https.get(url, {headers:{'User-Agent':'ideogram4-fetch','Accept':'application/octet-stream'}}, res=>{
      if(res.statusCode>=300 && res.statusCode<400 && res.headers.location){
        // redirect
        file.close(); fs.unlink(dest, ()=>{});
        httpsDownload(res.headers.location, dest).then(resolve, reject);
        return;
      }
      if(res.statusCode!==200){ file.close(); fs.unlink(dest, ()=>{}); reject(new Error('HTTP '+res.statusCode+' '+url)); return; }
      res.pipe(file);
      file.on('finish', ()=> file.close(resolve));
    });
    req.on('error', e=>{ file.close(); try{fs.unlinkSync(dest);}catch{} reject(e); });
    req.setTimeout(30000, ()=>{ req.destroy(); file.close(); try{fs.unlinkSync(dest);}catch{} reject(new Error('timeout '+url)); });
  });
}

function expandZip(zipPath, destDir){
  // Use PowerShell Expand-Archive (Windows) or unzip (unix)
  if(process.platform==='win32'){
    const ps = `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force`;
    try{
      execSync(`powershell -NoProfile -Command "${ps.replace(/"/g,'`"')}"`, {stdio:'inherit'});
      return true;
    } catch(e){
      log('Expand-Archive failed: '+e.message);
      return false;
    }
  } else {
    try{ execSync(`unzip -o "${zipPath}" -d "${destDir}"`, {stdio:'inherit'}); return true; } catch{ return false; }
  }
}

async function findLatestUrls(){
  try{
    const data = await httpsGetJson('https://api.github.com/repos/ggml-org/llama.cpp/releases/latest');
    const assets = data.assets || [];
    // prefer avx2 and cuda 12.4 builds
    const cpu = assets.find(a=> /bin-win-avx2-x64\.zip$/i.test(a.name));
    const cuda = assets.find(a=> /bin-win-cuda.*x64\.zip$/i.test(a.name));
    if(cpu){
      log('Latest via API: '+cpu.name+' / '+(cuda?cuda.name:'(no cuda)'));
      return { cpuUrl: cpu.browser_download_url, cudaUrl: cuda?cuda.browser_download_url:null, tag: data.tag_name, cpuName: cpu.name, cudaName: cuda?cuda.name:null };
    }
  } catch(e){ log('GitHub API failed: '+e.message); }
  return null;
}

async function main(){
  const needCpu = !binExists('llama-server.exe');
  const needCuda = !binExists('llama-server-cuda.exe');
  if(!needCpu && !needCuda){
    log('llama-server binaries already present — nothing to do.');
    return;
  }
  await ensureBinDir();
  let urls = await findLatestUrls();
  if(!urls){
    log('Falling back to pinned '+PINNED.tag);
    urls = { cpuUrl: PINNED.cpuUrl, cudaUrl: PINNED.cudaUrl, cpuName: PINNED.cpuAsset, cudaName: PINNED.cudaAsset };
  }
  const tasks=[];
  if(needCpu && urls.cpuUrl) tasks.push({url:urls.cpuUrl, name:urls.cpuName, target:'llama-server.exe'});
  if(needCuda && urls.cudaUrl) tasks.push({url:urls.cudaUrl, name:urls.cudaName, target:'llama-server-cuda.exe'});

  for(const t of tasks){
    const zipPath = path.join(BIN_DIR, t.name);
    const tmpDir = path.join(BIN_DIR, '_dl_tmp');
    try{
      await fsp.mkdir(tmpDir, {recursive:true});
      if(!fs.existsSync(zipPath)){
        await httpsDownload(t.url, zipPath);
      } else log('Using cached '+zipPath);
      // expand to tmp then move binaries to bin/
      const ok = expandZip(zipPath, tmpDir);
      if(!ok) throw new Error('unzip failed');
      // find llama-server.exe inside tmp
      const candidates = [];
      (function walk(d){
        for(const e of fs.readdirSync(d,{withFileTypes:true})){
          const p=path.join(d,e.name);
          if(e.isDirectory()) walk(p);
          else if(e.isFile() && /^llama-server(\.exe)?$/i.test(e.name)) candidates.push(p);
        }
      })(tmpDir);
      // also check for cuda variant naming: sometimes still llama-server.exe but from cuda zip
      // For cuda task, just copy whatever llama-server.exe found as cuda filename.
      for(const src of candidates){
        const destName = t.target;
        const dest = path.join(BIN_DIR, destName);
        // copy exe
        fs.copyFileSync(src, dest);
        log('Installed '+dest);
        // copy required DLLs next to it (cublas etc.) - copy all dlls from tmp
        (function copyDlls(d){
          for(const e of fs.readdirSync(d,{withFileTypes:true})){
            const p=path.join(d,e.name);
            if(e.isDirectory()) copyDlls(p);
            else if(/\.dll$/i.test(e.name)){
              const dd = path.join(BIN_DIR, e.name);
              if(!fs.existsSync(dd)) try{ fs.copyFileSync(p, dd); log('Copied dll '+e.name); }catch{}
            }
          }
        })(tmpDir);
        break; // use first
      }
      // cleanup
      try{ fs.rmSync(tmpDir,{recursive:true,force:true}); }catch{}
      // keep zip for cache
    } catch(e){
      log('Failed '+t.name+': '+e.message);
      try{ fs.rmSync(path.join(BIN_DIR,'_dl_tmp'),{recursive:true,force:true}); }catch{}
    }
  }
  // final check
  log('Done. CPU exists='+binExists('llama-server.exe')+' CUDA exists='+binExists('llama-server-cuda.exe'));
  if(!binExists('llama-server.exe')){
    console.error('ERROR: llama-server.exe still missing after download. Check internet and GitHub releases.');
    process.exit(1);
  }
}

main().catch(e=>{ console.error(e); process.exit(1); });
