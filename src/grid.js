export function initGrid(state, { onSelect, saveCurrentIfDirty }){
  const grid = document.getElementById('grid');
  const empty = document.getElementById('grid-empty');
  const leftStatus = document.getElementById('left-status');
  const thumbs = {}; // path -> dataUrl

  async function renderGrid(){
    if(!state.dataset.length){ grid.innerHTML=''; empty.style.display='block'; leftStatus.style.display='none'; return; }
    empty.style.display='none';
    leftStatus.style.display='block';
    leftStatus.textContent = `${state.dataset.length} images · click thumbnail to edit · unsaved = blue dot`;
    // incremental thumbs: load in batches of 20
    grid.innerHTML = state.dataset.map((d,i)=>{
      const status = computeStatus(d,i,state);
      const badge = statusBadge(status);
      const thumbUrl = thumbs[d.imgPath] || '';
      const sel = i===state.current ? ' selected' : '';
      return `<div class="thumb${sel}" data-idx="${i}" title="${esc(d.imgName)}">
        ${thumbUrl ? `<img src="${thumbUrl}" alt="" loading="lazy">` : `<div style="position:absolute;inset:0;background:#1e222b"></div>`}
        <div class="thumb-badges">${badge}</div>
        <span class="thumb-status ${statusClass(status)}" title="${status}"></span>
        <div class="thumb-footer">${esc(d.base)}</div>
      </div>`;
    }).join('');
    grid.querySelectorAll('.thumb').forEach(el=>{
      el.addEventListener('click', async ()=>{
        const idx = parseInt(el.dataset.idx,10);
        if(idx===state.current) return;
        if(state.modified.has(state.current) && window.__saveCurrentIfDirty) await window.__saveCurrentIfDirty();
        onSelect(idx);
      });
    });
    // async thumb load
    loadThumbsBatched();
  }

  function computeStatus(entry, idx, st){
    if(st.modified.has(idx)) return 'edited';
    if(entry._aiDraft) return 'ai-draft';
    if(entry._hasJson){
      // check if json has content (not empty)
      const d=entry.data||{};
      const hasContent = !!(d.high_level_description || (d.style_description&&Object.keys(d.style_description).length) || (d.compositional_deconstruction&&d.compositional_deconstruction.elements&&d.compositional_deconstruction.elements.length));
      return hasContent ? 'saved' : 'empty';
    }
    return 'empty';
  }
  function statusBadge(s){
    if(s==='edited') return `<span class="badge badge-blue">unsaved</span>`;
    if(s==='ai-draft') return `<span class="badge badge-amber">AI draft</span>`;
    if(s==='saved') return `<span class="badge badge-green">saved</span>`;
    return `<span class="badge badge-gray">empty</span>`;
  }
  function statusClass(s){
    if(s==='edited') return 'edited';
    if(s==='ai-draft') return 'ai';
    if(s==='saved') return 'saved';
    return 'empty';
  }

  let thumbLoading=false;
  async function loadThumbsBatched(){
    if(thumbLoading) return;
    thumbLoading=true;
    const batch=20;
    const toLoad = state.dataset.filter(d=> !thumbs[d.imgPath]);
    for(let i=0;i<toLoad.length;i+=batch){
      const chunk = toLoad.slice(i,i+batch);
      await Promise.all(chunk.map(async d=>{
        try{
          const url = await window.api.getThumbnail(d.imgPath, 280);
          thumbs[d.imgPath]=url;
        }catch(e){ console.warn('thumb fail', d.imgName, e.message); }
      }));
      // re-render only if still same folder
      if(state.dataset.some(x=> chunk.some(c=>c.imgPath===x.imgPath))){
        // patch images without full re-render for perf
        chunk.forEach(d=>{
          const idx = state.dataset.findIndex(x=>x.imgPath===d.imgPath);
          const el = grid.querySelector(`.thumb[data-idx="${idx}"] img`);
          if(!el && thumbs[d.imgPath]){
            const thumbEl = grid.querySelector(`.thumb[data-idx="${idx}"]`);
            if(thumbEl){
              const img=document.createElement('img'); img.src=thumbs[d.imgPath]; img.alt=''; img.loading='lazy';
              thumbEl.insertBefore(img, thumbEl.firstChild);
            }
          } else if(el && thumbs[d.imgPath]) el.src = thumbs[d.imgPath];
        });
      }
      await new Promise(r=> setTimeout(r, 30));
    }
    thumbLoading=false;
  }

  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  window.__renderGrid = renderGrid;
}
