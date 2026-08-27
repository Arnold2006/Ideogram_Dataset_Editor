import { createAppState } from './state.js';
import { initGrid } from './grid.js';
import { initEditor } from './editor.js';
import { initCanvas } from './canvas.js';
import { initAI } from './ai.js';
import { initSettings } from './settings.js';

const state = createAppState();

// Fallback for Node server (FrameForge engine) when not in Electron
if(!window.api){
  const API_BASE = `http://${location.hostname}:7860`;
  console.log('[api] Using HTTP fallback at', API_BASE, '(FrameForge engine)');
  window.api = {
    selectFolder: async ()=>{
      const folder = prompt("Enter dataset folder path (e.g. C:\\path\\to\\images):");
      return folder && folder.trim() ? folder.trim() : null;
    },
    listDataset: async (folder)=>{
      const r=await fetch(`${API_BASE}/api/list-dataset`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({folder})});
      if(!r.ok) throw new Error(await r.text());
      return r.json();
    },
    getThumbnail: async (imagePath,size)=>{
      const r=await fetch(`${API_BASE}/api/get-thumbnail`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({imagePath,size})});
      if(!r.ok) throw new Error(await r.text());
      const j=await r.json(); return j.dataUrl;
    },
    getImageData: async (imagePath)=>{
      const r=await fetch(`${API_BASE}/api/get-image-data`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({imagePath})});
      if(!r.ok) throw new Error(await r.text());
      return r.json();
    },
    writeJson: async (jsonPath,data)=>{
      const r=await fetch(`${API_BASE}/api/write-json`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonPath,data})});
      if(!r.ok) throw new Error(await r.text());
      return r.json();
    },
    listModels: async ()=>{
      const r=await fetch(`${API_BASE}/api/models`); if(!r.ok) throw new Error(await r.text()); return r.json();
    },
    selectModelFile: async ()=>{ alert("Upload via Settings > Upload .gguf — pick file in dialog"); return null; },
    uploadModel: async (srcPath)=>{ throw new Error("Upload via HTTP not yet implemented — copy .gguf to models/ manually"); },
    deleteModel: async (name)=>{
      const r=await fetch(`${API_BASE}/api/delete-model`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name})});
      if(!r.ok) throw new Error(await r.text()); return true;
    },
    setActiveModel: async (name,mmproj)=>{
      const r=await fetch(`${API_BASE}/api/set-active-model`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,mmproj})});
      if(!r.ok) throw new Error(await r.text()); return r.json();
    },
    getActiveModel: async ()=>{
      const r=await fetch(`${API_BASE}/api/get-active-model`); if(!r.ok) return null; return r.json();
    },
    generateOne: async (opts)=>{
      const r=await fetch(`${API_BASE}/api/generate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(opts)});
      if(!r.ok) throw new Error(await r.text());
      // NDJSON streaming — we need to handle chunked response like FrameForge
      const text=await r.text();
      const lines=text.trim().split("\n");
      let last=null;
      for(const line of lines){
        try{
          const evt=JSON.parse(line);
          if(evt.type==="done" && evt.prompt) last=evt.prompt;
          if(evt.type==="done" && evt.prompt_compact) last=JSON.parse(evt.prompt_compact);
        }catch{}
      }
      if(last) return last;
      // Fallback: try to parse as single JSON
      try{ return JSON.parse(text); }catch{ throw new Error("Invalid generation response"); }
    },
    getInferenceStatus: async ()=>{
      const r=await fetch(`${API_BASE}/api/health`); if(!r.ok) return {running:false}; const j=await r.json(); return {running:j.status==="ok", port:7860};
    },
    getGpuStatus: async ()=>{
      const r=await fetch(`${API_BASE}/api/health`); if(!r.ok) return null; const j=await r.json(); return {useGpu: j.vision, msg:`Model: ${j.model || "none"} — ${j.vision?"GPU":"CPU"}`};
    },
    getLogs: async ()=>"",
    openLogs: async ()=>{},
    openLogFile: async ()=>{},
    getPrompt: async ()=>"",
    savePrompt: async ()=>{},
    restorePrompt: async ()=>"",
    checkPath: async (p)=>{ const r=await fetch(`${API_BASE}/api/check-path`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({path:p})}); return r.json(); },
    restartServer: async ()=>{},
    testModel: async ()=>{
      const r=await fetch(`${API_BASE}/api/test-model`,{method:"POST"}); if(!r.ok) throw new Error(await r.text()); return r.json();
    },
  };
}

document.getElementById('btn-open-folder').addEventListener('click', openFolder);
document.getElementById('btn-choose-folder-2').addEventListener('click', openFolder);
document.getElementById('btn-refresh').addEventListener('click', ()=> state.folder && loadDataset(state.folder));
document.getElementById('btn-save').addEventListener('click', saveCurrent);
document.getElementById('btn-save-all').addEventListener('click', saveAll);
document.getElementById('btn-prev').addEventListener('click', ()=> navigate(-1));
document.getElementById('btn-next').addEventListener('click', ()=> navigate(1));

window.addEventListener('dragover', e=> e.preventDefault());
window.addEventListener('drop', async e=>{
  e.preventDefault();
  if(!window.api) return;
  // try to get folder from drop
  const files = Array.from(e.dataTransfer.files||[]);
  if(!files.length) return;
  let p='';
  try{ p = window.api.getPathForFile(files[0]) || files[0].path || ''; }catch{ p=files[0].path||''; }
  if(!p) return;
  try{
    const info = await window.api.checkPath(p);
    let folder = p;
    if(info.exists) folder = info.isDirectory ? info.path : info.dir;
    else if(/\.[a-z0-9]{2,5}$/i.test(p)) folder = p.replace(/[/\\][^/\\]+$/,'');
    await loadDataset(folder);
  }catch{}
});

initGrid(state, { onSelect: goTo, saveCurrentIfDirty });
initEditor(state, { markDirty, draw: ()=>window.__drawBboxes && window.__drawBboxes() });
initCanvas(state, { markDirty });
initAI(state);
initSettings(state);

async function openFolder(){
  if(!window.api){ alert('Open Folder requires the desktop app (Electron). Run: npm run electron:dev'); return; }
  const f = await window.api.selectFolder();
  if(f) await loadDataset(f);
}

async function loadDataset(folder){
  state.folder = folder;
  state.dataset = await window.api.listDataset(folder);
  // normalize data defaults: keep in-memory for missing jsons
  for(const e of state.dataset){
    if(!e.data || typeof e.data!=='object') e.data={};
    if(!e.data.compositional_deconstruction) e.data.compositional_deconstruction={background:'',elements:[]};
    if(!Array.isArray(e.data.compositional_deconstruction.elements)) e.data.compositional_deconstruction.elements=[];
    e._hasJson = !!e.hasJson;
    e._dirty = false;
    e._aiDraft = !!(e.data && e.data._meta && e.data._meta.generatedAt);
  }
  state.current = 0;
  state.modified = new Set();
  document.getElementById('btn-refresh').style.display='inline-block';
  if(!state.dataset.length){
    document.getElementById('grid-empty').style.display='block';
    document.getElementById('grid-empty').textContent='No images in folder.';
    return;
  }
  document.getElementById('grid-empty').style.display='none';
  renderAll();
}

function renderAll(){
  window.__renderGrid && window.__renderGrid();
  renderEntry();
  updateToolbar();
}

function renderEntry(){
  const d = state.dataset[state.current];
  if(!d) return;
  const imgWrap = document.getElementById('img-wrap');
  // remove old img
  const old = imgWrap.querySelector('img');
  if(old) old.remove();
  const im = document.createElement('img');
  im.alt = d.imgName;
  // use getImageData for display
  window.api.getImageData(d.imgPath).then(({dataUrl})=>{
    im.src = dataUrl;
    im.onload = ()=> window.__drawBboxes && window.__drawBboxes();
  }).catch(()=>{
    im.src = d.imgPath; // fallback
    im.onload = ()=> window.__drawBboxes && window.__drawBboxes();
  });
  imgWrap.insertBefore(im, imgWrap.firstChild);
  document.getElementById('img-name').textContent = d.imgName + (d._hasJson ? '' : '  (new — not yet saved)');
  document.getElementById('drop-zone').style.display='none';
  document.getElementById('editor').style.display='block';
  document.getElementById('counter').style.display='inline';
  document.getElementById('counter').textContent = `${state.current+1} / ${state.dataset.length}`;
  document.getElementById('progress-bar').style.width = ((state.current+1)/state.dataset.length*100).toFixed(1)+'%';
  document.getElementById('progress-wrap').style.display='block';
  document.getElementById('nav-btns').style.display='flex';
  document.getElementById('btn-prev').disabled = state.current===0;
  document.getElementById('btn-next').disabled = state.current===state.dataset.length-1;
  window.__fillForm && window.__fillForm(d.data);
  window.__drawBboxes && setTimeout(()=>window.__drawBboxes(), 80);
  window.__renderGrid && window.__renderGrid();
  updateToolbar();
}

function updateToolbar(){
  const has = state.dataset.length>0;
  document.getElementById('unsaved-dot').style.display = state.modified && state.modified.has(state.current) ? 'inline-block' : 'none';
}

async function saveCurrentIfDirty(){
  if(state.modified && state.modified.has(state.current)){
    await saveCurrent();
  }
}

async function saveCurrent(){
  const d = state.dataset[state.current];
  if(!d) return;
  const data = window.__getFormData ? window.__getFormData() : d.data;
  // strip internal _meta before save? keep but allow editing; ensure schema
  const toSave = JSON.parse(JSON.stringify(data));
  delete toSave._meta;
  delete toSave._hasJson;
  await window.api.writeJson(d.jsonPath, toSave);
  d.data = toSave;
  d._hasJson = true;
  d._aiDraft = false;
  state.modified.delete(state.current);
  document.getElementById('unsaved-dot').style.display='none';
  const si=document.getElementById('save-indicator'); si.classList.add('show'); setTimeout(()=>si.classList.remove('show'),1500);
  window.__renderGrid && window.__renderGrid();
}

async function saveAll(){
  for(let i=0;i<state.dataset.length;i++){
    // if current, use form
    let data;
    if(i===state.current && window.__getFormData) data = window.__getFormData();
    else data = state.dataset[i].data;
    const toSave = JSON.parse(JSON.stringify(data||{}));
    delete toSave._meta;
    await window.api.writeJson(state.dataset[i].jsonPath, toSave);
    state.dataset[i].data = toSave;
    state.dataset[i]._hasJson = true;
    state.dataset[i]._aiDraft = false;
  }
  state.modified.clear();
  document.getElementById('unsaved-dot').style.display='none';
  const si=document.getElementById('save-indicator'); si.textContent='✓ All saved'; si.classList.add('show'); setTimeout(()=>{si.classList.remove('show'); si.textContent='✓ Saved';},2000);
  window.__renderGrid && window.__renderGrid();
}

async function navigate(dir){
  const n = state.current + dir;
  if(n<0||n>=state.dataset.length) return;
  await saveCurrentIfDirty();
  state.current=n;
  renderEntry();
}
async function goTo(i){
  if(i===state.current) return;
  await saveCurrentIfDirty();
  state.current=i;
  renderEntry();
}

function markDirty(){
  state.modified.add(state.current);
  const d = state.dataset[state.current];
  if(d){ d.data = window.__getFormData ? window.__getFormData() : d.data; d._dirty=true; }
  document.getElementById('unsaved-dot').style.display='inline-block';
  window.__renderGrid && window.__renderGrid();
}

// keyboard
document.addEventListener('keydown', e=>{
  if(!state.dataset.length) return;
  const tag=document.activeElement.tagName;
  if(tag==='TEXTAREA'||tag==='INPUT'||tag==='SELECT') return;
  if(e.key==='ArrowRight') navigate(1);
  if(e.key==='ArrowLeft') navigate(-1);
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){ e.preventDefault(); saveCurrent(); }
  if(e.key.toLowerCase()==='b' && (e.ctrlKey||e.metaKey)){ e.preventDefault(); document.getElementById('btn-bbox-toggle')?.click(); }
});

// section toggles
document.querySelectorAll('.section-hdr').forEach(h=>{
  h.addEventListener('click', ()=>{
    const sec = h.dataset.section || h.id.replace('hdr-','');
    const body = document.getElementById('body-'+sec);
    const caret = document.getElementById('caret-'+sec);
    if(!body) return;
    const open = body.classList.contains('open');
    body.classList.toggle('open', !open);
    if(caret) caret.classList.toggle('open', !open);
  });
});
// allow header id hdr-ai too
document.getElementById('hdr-ai')?.addEventListener('click', ()=>{
  const b=document.getElementById('body-ai'); const c=document.getElementById('caret-ai');
  const open=b.classList.contains('open'); b.classList.toggle('open',!open); c.classList.toggle('open',!open);
});

document.getElementById('btn-bbox-toggle').addEventListener('click', ()=>{
  const rc=document.getElementById('right-col');
  rc.classList.toggle('bbox-full');
  setTimeout(()=> window.__drawBboxes && window.__drawBboxes(), 100);
  localStorage.setItem('bboxFull', rc.classList.contains('bbox-full')?'1':'0');
});
if(localStorage.getItem('bboxFull')==='1') document.getElementById('right-col').classList.add('bbox-full');

// expose for modules
window.__state = state;
window.__renderEntry = renderEntry;
window.__updateToolbar = updateToolbar;
window.__saveCurrentIfDirty = saveCurrentIfDirty;
