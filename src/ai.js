export function initAI(state){
  const btnGen = document.getElementById('btn-generate');
  const btnGenAll = document.getElementById('btn-generate-all');
  const btnCancel = document.getElementById('btn-cancel-ai');
  const aiError = document.getElementById('ai-error');
  const aiProgress = document.getElementById('ai-progress');
  const aiBar = document.getElementById('ai-bar');
  const aiText = document.getElementById('ai-progress-text');
  const aiStatus = document.getElementById('ai-status');

  let running=false;
  let abort=false;

  btnGen.addEventListener('click', ()=> generateOne(state.current));
  btnGenAll.addEventListener('click', generateAll);
  btnCancel.addEventListener('click', async ()=>{
    abort=true;
    try{ await window.api.cancelGenerate(); }catch{}
    hideProgress('Cancelled');
  });

  async function generateOne(idx){
    if(running) return;
    const entry = state.dataset[idx];
    if(!entry){ showError('No image selected'); return; }
    running=true; abort=false;
    showProgress(`Generating for ${entry.base}…`, 0);
    btnGen.disabled=true; btnGenAll.disabled=true; btnCancel.style.display='inline-block'; hideError();
    try{
      const json = await window.api.generateOne({ imagePath: entry.imgPath, folder: state.folder, base: entry.base });
      // populate as draft — do not auto-save
      json._meta = { generatedAt: new Date().toISOString(), model: 'ai' };
      entry.data = json;
      entry._aiDraft = true;
      if(idx===state.current){
        window.__fillForm && window.__fillForm(json);
        window.__drawBboxes && window.__drawBboxes();
        state.modified.add(idx);
        document.getElementById('unsaved-dot').style.display='inline-block';
        window.__renderGrid && window.__renderGrid();
      } else {
        // not current — still mark dirty so grid shows ai draft
        state.modified.add(idx);
        window.__renderGrid && window.__renderGrid();
      }
      showProgress(`Done — review & Save`, 100);
      setTimeout(hideProgress, 2000);
    }catch(e){
      showError(e.message||String(e));
      showProgress('Failed', 0);
    } finally {
      running=false; btnGen.disabled=false; btnGenAll.disabled=false; btnCancel.style.display='none';
    }
  }

  async function generateAll(){
    if(running) return;
    const todo = state.dataset.map((d,i)=> ({d,i})).filter(({d,i})=>{
      // skip saved that have meaningful content unless ai-draft? Spec: "all unprocessed" = empty
      const hasContent = !!(d.data.high_level_description || (d.data.style_description&&Object.keys(d.data.style_description).length) || (d.data.compositional_deconstruction&&d.data.compositional_deconstruction.elements&&d.data.compositional_deconstruction.elements.length));
      return !hasContent && !d._aiDraft && !state.modified.has(i);
    });
    if(!todo.length){ aiStatus.textContent='Nothing to generate (all have content or are drafts).'; setTimeout(()=> aiStatus.textContent='',3000); return; }
    if(!confirm(`Generate for ${todo.length} unprocessed images? This will call the local model ${todo.length} times and may take minutes.`)) return;
    running=true; abort=false;
    btnGen.disabled=true; btnGenAll.disabled=true; btnCancel.style.display='inline-block'; hideError();
    let ok=0, fail=0;
    for(let k=0;k<todo.length;k++){
      if(abort) break;
      const {d,i}=todo[k];
      showProgress(`Generating ${k+1}/${todo.length}: ${d.base}`, Math.round(((k)/todo.length)*100));
      aiText.textContent = `${k+1}/${todo.length} — ${ok} ok ${fail?`, ${fail} failed`:''}`;
      try{
        const json = await window.api.generateOne({ imagePath: d.imgPath, folder: state.folder, base: d.base });
        json._meta={generatedAt:new Date().toISOString()};
        d.data=json; d._aiDraft=true; state.modified.add(i); ok++;
        if(i===state.current){ window.__fillForm && window.__fillForm(json); window.__drawBboxes && window.__drawBboxes(); document.getElementById('unsaved-dot').style.display='inline-block'; }
        window.__renderGrid && window.__renderGrid();
      }catch(e){
        fail++;
        console.error('batch gen fail', d.base, e);
        // show but continue
        aiError.style.display='block';
        aiError.textContent += `\n[${d.base}] ${e.message}`;
      }
      // small pause to allow UI
      await new Promise(r=> setTimeout(r, 80));
    }
    running=false; btnGen.disabled=false; btnGenAll.disabled=false; btnCancel.style.display='none';
    showProgress(`Batch done — ${ok} ok, ${fail} failed. Review & Save all.`, 100);
    window.__renderGrid && window.__renderGrid();
    if(fail) aiError.style.display='block';
  }

  function showProgress(text, pct){
    aiProgress.style.display='block';
    aiBar.style.width = pct+'%';
    aiText.textContent = text;
    aiStatus.textContent = text;
  }
  function hideProgress(msg){
    if(msg) aiStatus.textContent=msg;
    aiProgress.style.display='none'; aiBar.style.width='0%';
  }
  function showError(msg){ aiError.style.display='block'; aiError.textContent=msg; }
  function hideError(){ aiError.style.display='none'; aiError.textContent=''; }
}
