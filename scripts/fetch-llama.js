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
  cpuAsset: 'llama-b10419-bin-win-cpu-x64.zip',
  cudaAsset: 'llama-b10419-bin-win-cuda-12.4-x64.zip',
  cpuUrl: 'https://github.com/ggml-org/llama.cpp/releases/download/b10419/llama-b10419-bin-win-cpu-x64.zip',
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
  // Try releases list and pick first b* with win-cpu-x64 (or avx2 fallback) — /releases/latest is v0.3.0, not b*
  // Require llama-b* prefix for both (not cudart-) and prefer 12.4 cuda
  try{
    const list = await httpsGetJson('https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=30');
    for(const data of list){
      if(!data.tag_name || !/^b\d+/.test(data.tag_name)) continue;
      const assets = data.assets || [];
      const cpu = assets.find(a=> /^llama-b.*-bin-win-cpu-x64\.zip$/i.test(a.name)) || assets.find(a=> /^llama-b.*-bin-win-avx2-x64\.zip$/i.test(a.name));
      if(!cpu) continue;
      const cuda = assets.find(a=> /^llama-b.*-bin-win-cuda-12\.4-x64\.zip$/i.test(a.name));
      // Only return if both CPU and CUDA server builds exist and tag is >= b6887 for Qwen3-VL
      const ver = parseInt(data.tag_name.slice(1),10);
      if(ver < 6887) continue;
      if(!cuda) continue; // skip releases without proper CUDA server (e.g. b10645)
      log('Latest via API: '+data.tag_name+' — '+cpu.name+' / '+cuda.name);
      return { cpuUrl: cpu.browser_download_url, cudaUrl: cuda.browser_download_url, tag: data.tag_name, cpuName: cpu.name, cudaName: cuda.name };
    }
  } catch(e){ log('GitHub API failed: '+e.message); }
  return null;
}

function getBinaryVersion(exe){
  try{
    const out = require('child_process').execSync(`"${exe}" --version`, {timeout:3000, windowsHide:true}).toString();
    const m = out.match(/b(\d+)/i);
    if(m) return parseInt(m[1],10);
  } catch{}
  return 0;
}
async function main(){
  const force = process.argv.includes('--force');
  let needCpu = !binExists('llama-server.exe');
  let needCuda = !binExists('llama-server-cuda.exe');
  // Force update outdated b<6887 for Qwen3-VL
  if(!force && binExists('llama-server.exe')){
    const ver = getBinaryVersion(path.join(BIN_DIR,'llama-server.exe'));
    if(ver && ver < 6887){
      log(`Existing binary b${ver} < b6887 — forcing update for Qwen3-VL`);
      needCpu = true; needCuda = true;
      // clean old zips to avoid cache hit on old name
      try{ for(const f of fs.readdirSync(BIN_DIR)) if(/llama-b4242.*\.zip$/i.test(f)) fs.unlinkSync(path.join(BIN_DIR,f)); }catch{}
    }
  }
  if(!needCpu && !needCuda && !force){
    log('llama-server binaries already present — nothing to do.');
    return;
  }
  if(force){ needCpu=true; if(!binExists('llama-server-cuda.exe') || true) needCuda=true; }
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
        // copy required DLLs next to it (cublas etc.) - overwrite to ensure version matches exe
        (function copyDlls(d){
          for(const e of fs.readdirSync(d,{withFileTypes:true})){
            const p=path.join(d,e.name);
            if(e.isDirectory()) copyDlls(p);
            else if(/\.dll$/i.test(e.name)){
              const dd = path.join(BIN_DIR, e.name);
              try{ fs.copyFileSync(p, dd); log('Copied dll '+e.name); }catch{}
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
