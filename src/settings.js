export function initSettings(state){
  const overlay=document.getElementById('settings-overlay');
  const drawer=document.getElementById('settings-drawer');
  const btnOpen=document.getElementById('btn-settings');
  const btnClose=document.getElementById('btn-close-settings');

  function open(){ overlay.style.display='block'; drawer.style.display='block'; refreshModels(); loadPrompt(); refreshInferenceStatus(); refreshGpuStatus(); }
  function close(){ overlay.style.display='none'; drawer.style.display='none'; }
  btnOpen.addEventListener('click', open);
  btnClose.addEventListener('click', close);
  overlay.addEventListener('click', close);

  // models
  const modelList=document.getElementById('model-list');
  document.getElementById('btn-upload-model').addEventListener('click', async()=>{
    const src = await window.api.selectModelFile();
    if(!src) return;
    try{
      const res = await window.api.uploadModel(src);
      await refreshModels();
      alert('Uploaded: '+res.name);
    }catch(e){ alert('Upload failed: '+e.message); }
  });
  document.getElementById('btn-refresh-models').addEventListener('click', refreshModels);
  document.getElementById('btn-test-model').addEventListener('click', async()=>{
    const btn=document.getElementById('btn-test-model');
    btn.disabled=true; btn.textContent='Testing…';
    try{ const j=await window.api.testModel(); alert('Model OK — returned keys: '+Object.keys(j).join(', ')); }
    catch(e){ alert('Test failed: '+e.message); }
    finally{ btn.disabled=false; btn.textContent='Test model'; refreshInferenceStatus(); }
  });
  document.getElementById('btn-restart-server').addEventListener('click', async()=>{ await window.api.restartServer(); refreshInferenceStatus(); alert('Server restarted'); });

  async function refreshModels(){
    if(!window.api) return;
    modelList.innerHTML='<div style="font-size:12px;color:var(--color-text-secondary)">Loading…</div>';
    try{
      const {models, active} = await window.api.listModels();
      if(!models.length){ modelList.innerHTML='<div style="font-size:12px;color:var(--color-text-secondary)">No .gguf files in <code>models/</code>. Upload Huihui-Qwen3-VL-4B + mmproj-F16.gguf.</div>'; return; }
      // try to detect mmproj candidates
      const mmprojs = models.filter(m=> m.name.toLowerCase().includes('mmproj'));
      modelList.innerHTML = models.map(m=>{
        const isActive = active && active.model===m.name;
        const sizeGb = (m.size/1024/1024/1024).toFixed(2);
        const valid = m.valid ? '✓' : '⚠ invalid';
        const isMmproj = m.name.toLowerCase().includes('mmproj');
        return `<div style="display:flex;align-items:center;gap:8px;padding:6px;border:0.5px solid ${isActive?'#1D9E75':'var(--color-border-tertiary)'};border-radius:8px;margin-bottom:6px;background:${isActive?'#0f2a1e':'transparent'}">
          <input type="radio" name="active-model" ${isActive?'checked':''} data-name="${m.name}" ${isMmproj?'disabled title="Select a main model, not mmproj"':''}>
          <div style="flex:1;min-width:0"><div style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${m.name} ${isMmproj?'(mmproj)':''}</div><div style="font-size:11px;color:var(--color-text-secondary)">${sizeGb} GB · ${valid}</div></div>
          <button class="tbar-btn" data-del="${m.name}" style="padding:4px 8px;font-size:11px">Delete</button>
        </div>`;
      }).join('');
      if(mmprojs.length){
        const sel = document.createElement('div');
        sel.style.cssText='margin-top:8px;padding:8px;border:0.5px dashed var(--color-border-secondary);border-radius:8px';
        sel.innerHTML=`<div style="font-size:12px;margin-bottom:6px">mmproj (vision projector) for active model:</div>
          <select id="mmproj-select" style="width:100%;background:#242424;color:#f0f0f0;border:0.5px solid #3a3a3a;border-radius:8px;padding:6px">
            <option value="">(none / single-file model)</option>
            ${mmprojs.map(p=> `<option value="${p.name}" ${active&&active.mmproj===p.name?'selected':''}>${p.name}</option>`).join('')}
          </select>`;
        modelList.appendChild(sel);
        sel.querySelector('#mmproj-select').addEventListener('change', async (e)=>{
          const activeRadio = modelList.querySelector('input[name="active-model"]:checked');
          const modelName = activeRadio ? activeRadio.dataset.name : (active?active.model:null);
          if(!modelName){ alert('Select a main model first'); return; }
          await window.api.setActiveModel(modelName, e.target.value||null);
          refreshModels(); refreshInferenceStatus();
        });
      }
      modelList.querySelectorAll('input[name="active-model"]').forEach(r=>{
        r.addEventListener('change', async()=>{
          const name=r.dataset.name;
          // keep current mmproj selection if any
          const mmSel=document.getElementById('mmproj-select');
          const mmproj = mmSel ? mmSel.value : (active?active.mmproj:null);
          await window.api.setActiveModel(name, mmproj||null);
          refreshModels(); refreshInferenceStatus();
        });
      });
      modelList.querySelectorAll('[data-del]').forEach(b=>{
        b.addEventListener('click', async()=>{
          if(!confirm('Delete '+b.dataset.del+'?')) return;
          await window.api.deleteModel(b.dataset.del);
          refreshModels(); refreshInferenceStatus();
        });
      });
    }catch(e){ modelList.innerHTML='<div style="color:var(--color-text-danger)">'+e.message+'</div>'; }
  }

  async function refreshInferenceStatus(){
    const el=document.getElementById('inference-status');
    try{
      const st=await window.api.getInferenceStatus();
      const active=await window.api.getActiveModel();
      el.textContent = `Active: ${active? active.model + (active.mmproj? ' + '+active.mmproj:'') : '(none)'} · Server: ${st.running? 'running on :'+st.port : 'stopped'}`;
    }catch(e){ el.textContent='Status error: '+e.message; }
  }
  async function refreshGpuStatus(){
    const detail=document.getElementById('gpu-status-detail');
    const badge=document.getElementById('gpu-badge');
    const preview=document.getElementById('log-preview');
    try{
      const gpu=await window.api.getGpuStatus();
      const logs=await window.api.getLogs();
      const msg=gpu?.msg || gpu?.exe || 'No GPU info yet — run Test model or Generate to start server';
      if(detail) detail.textContent=msg + (gpu?.useGpu ? '\n✓ GPU acceleration active' : '\n○ CPU mode — will be ~10x slower. Check nvidia-smi and bin/llama-server-cuda.exe');
      if(badge){
        badge.style.display='inline-block';
        badge.textContent=gpu?.useGpu ? 'GPU ✓' : 'CPU';
        badge.style.background=gpu?.useGpu ? '#1D9E75' : '#3a3a3a';
        badge.style.color='white';
        badge.title=msg + '\nClick to view logs';
      }
      if(preview){
        if(logs){
          preview.textContent=logs.slice(-3000);
          preview.style.display='block';
        } else {
          preview.style.display='none';
        }
      }
    }catch(e){
      if(detail) detail.textContent='GPU check failed: '+e.message+'\nLogs at logs/app.log';
      if(badge){ badge.style.display='inline-block'; badge.textContent='LOG'; badge.style.background='#BA7517'; }
    }
  }
  // Auto-refresh GPU status when drawer opens and when app logs arrive
  if(window.api.onGpuStatus) window.api.onGpuStatus(()=>refreshGpuStatus());
  if(window.api.onAppLog){
    window.api.onAppLog((msg)=>{
      const p=document.getElementById('log-preview');
      if(p && p.style.display!=='none'){
        p.textContent=(p.textContent+'\n'+msg).slice(-4000);
        p.scrollTop=p.scrollHeight;
      }
    });
  }

  // prompt
  const fPrompt=document.getElementById('f-system-prompt');
  const promptStatus=document.getElementById('prompt-status');
  document.getElementById('btn-save-prompt').addEventListener('click', async()=>{
    const t=fPrompt.value;
    if(!t.trim()){ promptStatus.textContent='Prompt is empty — will fallback to default'; promptStatus.style.color='#BA7517'; return; }
    await window.api.savePrompt(t);
    promptStatus.textContent='Saved.'; promptStatus.style.color='#1D9E75'; setTimeout(()=> promptStatus.textContent='',2000);
  });
  document.getElementById('btn-restore-prompt').addEventListener('click', async()=>{
    const def=await window.api.restorePrompt();
    fPrompt.value=def; promptStatus.textContent='Restored default.'; promptStatus.style.color='#1D9E75';
  });
  document.getElementById('btn-validate-prompt').addEventListener('click', ()=>{
    const t=fPrompt.value;
    const errs=[];
    if(t.length<100) errs.push('Prompt seems very short (<100 chars).');
    if(!t.toLowerCase().includes('bbox')) errs.push('Missing bbox instruction.');
    if(!t.includes('0..1000') && !t.includes('0–1000') && !t.includes('0-1000')) errs.push('Missing 0..1000 scale note.');
    if(!t.includes('JSON')) errs.push('Missing JSON instruction.');
    if(errs.length) { promptStatus.textContent='Warnings: '+errs.join(' '); promptStatus.style.color='#BA7517'; }
    else { promptStatus.textContent='Prompt looks good.'; promptStatus.style.color='#1D9E75'; }
  });
  async function loadPrompt(){
    try{ fPrompt.value = await window.api.getPrompt(); }catch{}
  }
  // Logs & GPU buttons
  document.getElementById('btn-open-logs')?.addEventListener('click', ()=> window.api.openLogs());
  document.getElementById('btn-open-log-file')?.addEventListener('click', ()=> window.api.openLogFile());
  document.getElementById('btn-copy-logs')?.addEventListener('click', async()=>{
    try{ const t=await window.api.getLogs(); await navigator.clipboard.writeText(t); alert('Copied last log to clipboard'); }catch(e){ alert('Copy failed: '+e.message); }
  });
  document.getElementById('btn-refresh-gpu')?.addEventListener('click', refreshGpuStatus);
  document.getElementById('gpu-badge')?.addEventListener('click', ()=>{
    // Open settings and refresh
    overlay.style.display='block'; drawer.style.display='block';
    refreshModels(); loadPrompt(); refreshInferenceStatus(); refreshGpuStatus();
  });
  // Also update toolbar badge on load
  refreshGpuStatus();
}
