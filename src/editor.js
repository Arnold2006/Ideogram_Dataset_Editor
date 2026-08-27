export function initEditor(state, { markDirty }){
  const els = {
    hld: document.getElementById('f-hld'),
    aesthetics: document.getElementById('f-aesthetics'),
    lighting: document.getElementById('f-lighting'),
    medium: document.getElementById('f-medium'),
    photoart: document.getElementById('f-photoart'),
    bg: document.getElementById('f-bg'),
  };
  els.hld.addEventListener('input', onFormChange);
  els.aesthetics.addEventListener('input', onFormChange);
  els.lighting.addEventListener('input', onFormChange);
  els.medium.addEventListener('input', onFormChange);
  els.photoart.addEventListener('input', onFormChange);
  els.bg.addEventListener('input', onFormChange);

  document.getElementById('pat-photo').addEventListener('click', ()=> setPhotoArt('photo'));
  document.getElementById('pat-art').addEventListener('click', ()=> setPhotoArt('art'));
  document.getElementById('btn-add-global-color').addEventListener('click', ()=> addColor('global'));
  document.getElementById('btn-add-obj').addEventListener('click', ()=> addElement('obj'));
  document.getElementById('btn-add-text').addEventListener('click', ()=> addElement('text'));

  function setPhotoArt(mode){
    state.photoArtMode[state.current]=mode;
    setPhotoArtUI(mode);
    onFormChange();
  }
  function setPhotoArtUI(mode){
    document.getElementById('pat-photo').className='pat-btn'+(mode==='photo'?' active':'');
    document.getElementById('pat-art').className='pat-btn'+(mode==='art'?' active':'');
  }

  function fillForm(data){
    const sd=data.style_description||{};
    const cd=data.compositional_deconstruction||{};
    els.hld.value=data.high_level_description||'';
    els.aesthetics.value=sd.aesthetics||'';
    els.lighting.value=sd.lighting||'';
    els.medium.value=sd.medium||'';
    const isPhoto=!!sd.photo;
    state.photoArtMode[state.current]= isPhoto?'photo':'art';
    setPhotoArtUI(isPhoto?'photo':'art');
    els.photoart.value=sd.photo||sd.art_style||'';
    renderGlobalPalette(sd.color_palette||[]);
    els.bg.value=cd.background||'';
    renderElements(cd.elements||[]);
    document.getElementById('unsaved-dot').style.display='none';
  }

  function renderGlobalPalette(colors){
    const c=document.getElementById('global-chips');
    c.innerHTML = colors.map((col,i)=> `<span class="chip"><span class="chip-sw" style="background:${esc(col)}"></span>${esc(col)}<button class="chip-del" data-i="${i}">×</button></span>`).join('');
    c.querySelectorAll('.chip-del').forEach(b=> b.addEventListener('click',()=> removeColor('global', parseInt(b.dataset.i,10))));
  }
  function renderElements(elements){
    const container=document.getElementById('el-sections');
    document.getElementById('el-count-badge').textContent=elements.length;
    if(!elements.length){ container.innerHTML='<div style="font-size:13px;color:var(--color-text-secondary);padding:8px 0 10px;text-align:center">No elements yet</div>'; return; }
    container.innerHTML = elements.map((el,i)=> elementHtml(el,i)).join('');
    container.querySelectorAll('.el-card-hdr').forEach(h=>{
      const idx=parseInt(h.dataset.idx,10);
      h.addEventListener('click', ()=> toggleEl(idx));
    });
    container.querySelectorAll('.el-del').forEach(b=>{
      const idx=parseInt(b.dataset.idx,10);
      b.addEventListener('click', (e)=>{ e.stopPropagation(); removeElement(idx); });
    });
    container.querySelectorAll('.el-desc').forEach(inp=>{
      const idx=parseInt(inp.dataset.idx,10);
      inp.addEventListener('input', ()=> onElChange(idx));
    });
    container.querySelectorAll('.el-text').forEach(inp=>{
      const idx=parseInt(inp.dataset.idx,10);
      inp.addEventListener('input', ()=> onElChange(idx));
    });
    container.querySelectorAll('.bbox-input').forEach(inp=>{
      const idx=parseInt(inp.dataset.idx,10);
      inp.addEventListener('input', ()=> onElChange(idx));
    });
    container.querySelectorAll('.btn-add-el-color').forEach(b=>{
      const idx=parseInt(b.dataset.idx,10);
      b.addEventListener('click', ()=> addElColor(idx));
    });
    container.querySelectorAll('.chip-del-el').forEach(b=>{
      const eidx=parseInt(b.dataset.eidx,10), cidx=parseInt(b.dataset.cidx,10);
      b.addEventListener('click', ()=> removeElColor(eidx,cidx));
    });
  }
  function elementHtml(el,i){
    const b=el.bbox||[0,0,0,0];
    const preview=el.desc?el.desc.slice(0,40)+(el.desc.length>40?'…':''):(el.type==='text'&&el.text?`"${el.text}"`:el.type==='obj'?'Object':'Text element');
    const textRow = el.type==='text'? `<div class="field"><label>Exact text string</label><input type="text" class="el-text" data-idx="${i}" value="${esc(el.text||'')}" placeholder="The text as it appears in the image"></div>`:'';
    const pal=(el.color_palette||[]).map((c,ci)=> `<span class="chip"><span class="chip-sw" style="background:${esc(c)}"></span>${esc(c)}<button class="chip-del chip-del-el" data-eidx="${i}" data-cidx="${ci}">×</button></span>`).join('');
    return `<div class="el-card" id="elcard-${i}" data-type="${el.type}">
      <div class="el-card-hdr" data-idx="${i}">
        <span class="el-badge ${el.type==='obj'?'badge-obj':'badge-txt'}">${el.type==='obj'?'Object':'Text'}</span>
        <span class="el-card-title">${esc(preview)}</span>
        <button class="el-del" data-idx="${i}" title="Delete element">✕</button>
        <span style="font-size:14px;color:var(--color-text-secondary)" id="elcaret-${i}">▾</span>
      </div>
      <div class="el-card-body" id="elbody-${i}">
        <div class="field"><label>Description</label><textarea class="el-desc" data-idx="${i}" rows="3" placeholder="Describe this element in detail…">${esc(el.desc||'')}</textarea></div>
        ${textRow}
        <div class="field">
          <label>Bounding box <span style="font-weight:400;text-transform:none;letter-spacing:0">— [ymin, xmin, ymax, xmax] on 0–1000 scale</span></label>
          <div class="bbox-grid">
            ${['ymin','xmin','ymax','xmax'].map((k,j)=> `<div class="bbox-cell"><label>${k}</label><input type="text" class="bbox-input bbox-${k}" data-idx="${i}" value="${b[j]||0}" style="text-align:center"></div>`).join('')}
          </div>
          <div class="field-hint">Values 0–1000. Tip: drag the box on the image to move it, drag a corner to resize, or click the × on the selected box to delete it.</div>
        </div>
        <div class="field">
          <label>Element color palette</label>
          <div class="palette-row elp-row-${i}">${pal}</div>
          <div class="add-color-row">
            <input type="color" id="elp-picker-${i}" value="#888888">
            <button class="tbar-btn btn-add-el-color" data-idx="${i}" style="font-size:12px;padding:5px 9px">+ Add</button>
          </div>
        </div>
      </div>
    </div>`;
  }
  function toggleEl(i){
    const body=document.getElementById('elbody-'+i);
    const caret=document.getElementById('elcaret-'+i);
    const isOpen=body.classList.contains('open');
    body.classList.toggle('open',!isOpen);
    if(caret) caret.style.transform = isOpen ? '' : 'rotate(180deg)';
    if(!isOpen){
      state.selectedIdx=i;
      document.querySelectorAll('.el-card').forEach((c,idx)=> c.classList.toggle('el-highlight', idx===i));
      window.__drawBboxes && window.__drawBboxes(i);
    } else if(state.selectedIdx===i){
      state.selectedIdx=null;
      document.querySelectorAll('.el-card').forEach(c=> c.classList.remove('el-highlight'));
      window.__drawBboxes && window.__drawBboxes(null);
    }
  }

  function getFormData(){
    const sd={};
    const a=els.aesthetics.value.trim(); if(a) sd.aesthetics=a;
    const l=els.lighting.value.trim(); if(l) sd.lighting=l;
    const m=els.medium.value.trim(); if(m) sd.medium=m;
    const pa=els.photoart.value.trim();
    const mode=state.photoArtMode[state.current]||'photo';
    if(pa) sd[mode==='photo'?'photo':'art_style']=pa;
    const gpal = Array.from(document.querySelectorAll('#global-chips .chip')).map(c=>{
      const sw=c.querySelector('.chip-sw');
      return sw? (sw.style.backgroundColor||sw.style.background||'') : '';
    }).filter(Boolean).map(normalizeColor).filter(Boolean);
    if(gpal.length) sd.color_palette=gpal;
    const elements = Array.from(document.querySelectorAll('.el-card')).map(card=>{
      const type=card.dataset.type;
      const el={type};
      const desc=card.querySelector('.el-desc')?.value.trim(); if(desc) el.desc=desc;
      if(type==='text'){ const t=card.querySelector('.el-text')?.value.trim(); if(t) el.text=t; }
      const bbox=['ymin','xmin','ymax','xmax'].map(k=> parseInt(card.querySelector('.bbox-'+k)?.value)||0);
      if(bbox.some(v=>v>0)) el.bbox=bbox;
      const epal = Array.from(card.querySelectorAll('.chip .chip-sw')).map(s=> s.style.backgroundColor||s.style.background||'').filter(Boolean).map(normalizeColor).filter(Boolean);
      if(epal.length) el.color_palette=epal;
      return el;
    });
    const result={};
    const hld=els.hld.value.trim(); if(hld) result.high_level_description=hld;
    if(Object.keys(sd).length) result.style_description=sd;
    result.compositional_deconstruction={ background: els.bg.value.trim()||'', elements };
    return result;
  }
  function normalizeColor(c){
    if(!c) return '';
    c=c.trim();
    if(c.startsWith('#')) return c.toUpperCase();
    // rgb(...) -> hex
    const m=c.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
    if(m){ const r=parseInt(m[1]),g=parseInt(m[2]),b=parseInt(m[3]); return '#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('').toUpperCase(); }
    return c;
  }
  function onFormChange(){
    // update dataset in place
    const d=state.dataset[state.current];
    if(!d) return;
    d.data = getFormData();
    markDirty();
    window.__drawBboxes && window.__drawBboxes();
  }
  function onElChange(i){
    onFormChange();
    const card=document.getElementById('elcard-'+i);
    const desc=card?.querySelector('.el-desc')?.value||'';
    const text=card?.querySelector('.el-text')?.value||'';
    const preview=(desc||text||'element').slice(0,40);
    const titleEl=card?.querySelector('.el-card-title');
    if(titleEl) titleEl.textContent = preview + (preview.length>=40?'…':'');
  }
  function addElement(type){
    const d=state.dataset[state.current]; if(!d) return;
    if(!d.data.compositional_deconstruction) d.data.compositional_deconstruction={background:'',elements:[]};
    if(!Array.isArray(d.data.compositional_deconstruction.elements)) d.data.compositional_deconstruction.elements=[];
    d.data.compositional_deconstruction.elements.push({type,desc:'',bbox:[0,0,0,0]});
    renderElements(d.data.compositional_deconstruction.elements);
    const idx=d.data.compositional_deconstruction.elements.length-1;
    const body=document.getElementById('elbody-'+idx);
    if(body){ body.classList.add('open'); const ta=body.querySelector('textarea'); if(ta) ta.focus(); }
    const secBody=document.getElementById('body-elements');
    if(secBody && !secBody.classList.contains('open')){ secBody.classList.add('open'); document.getElementById('caret-elements')?.classList.add('open'); }
    onFormChange();
  }
  function removeElement(i){
    const d=state.dataset[state.current]; if(!d) return;
    d.data.compositional_deconstruction.elements.splice(i,1);
    state.selectedIdx=null;
    renderElements(d.data.compositional_deconstruction.elements);
    window.__drawBboxes && window.__drawBboxes(null);
    onFormChange();
  }
  function addColor(scope){
    const picker=document.getElementById(scope==='global'?'global-picker':'elp-picker-'+scope);
    const color=picker.value;
    if(scope==='global'){
      const d=state.dataset[state.current]; if(!d) return;
      if(!d.data.style_description) d.data.style_description={};
      const pal=d.data.style_description.color_palette||[]; pal.push(color); d.data.style_description.color_palette=pal;
      renderGlobalPalette(pal);
    }
    onFormChange();
  }
  function addElColor(i){
    const picker=document.getElementById('elp-picker-'+i);
    const color=picker.value;
    const d=state.dataset[state.current]; if(!d) return;
    const el=d.data.compositional_deconstruction.elements[i];
    if(!el.color_palette) el.color_palette=[];
    el.color_palette.push(color);
    const row=document.querySelector('.elp-row-'+i);
    if(row){
      const chip=document.createElement('span'); chip.className='chip';
      chip.innerHTML=`<span class="chip-sw" style="background:${esc(color)}"></span>${esc(color)}<button class="chip-del chip-del-el" data-eidx="${i}" data-cidx="${el.color_palette.length-1}">×</button>`;
      row.appendChild(chip);
      chip.querySelector('button').addEventListener('click',()=> removeElColor(i, el.color_palette.length-1));
    }
    onFormChange();
  }
  function removeColor(scope, idx){
    if(scope==='global'){
      const d=state.dataset[state.current]; if(!d) return;
      const pal=(d.data.style_description?.color_palette||[]); pal.splice(idx,1); renderGlobalPalette(pal);
    }
    onFormChange();
  }
  function removeElColor(ei, ci){
    const d=state.dataset[state.current]; if(!d) return;
    const el=d.data.compositional_deconstruction.elements[ei];
    if(el?.color_palette) el.color_palette.splice(ci,1);
    // re-render that card's palette row
    const card=document.getElementById('elcard-'+ei);
    if(card){
      const chips=Array.from(card.querySelectorAll('.chip-del-el'));
      // simplest: re-render elements
      renderElements(d.data.compositional_deconstruction.elements);
      // reopen that card
      const body=document.getElementById('elbody-'+ei); if(body) body.classList.add('open');
    }
    onFormChange();
  }
  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  window.__fillForm = fillForm;
  window.__getFormData = getFormData;
  window.__onElChange = onElChange;
}
