export function initCanvas(state, { markDirty }){
  let selectedIdx = null;
  let dragState=null;
  let hitAreas={handles:{},delBtn:null,boxes:[]};

  const canvas=document.getElementById('bbox-canvas');
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('dblclick', onDblClick);
  canvas.addEventListener('mousemove', e=>{ if(!dragState) onMouseMove(e); });
  canvas.addEventListener('mouseleave', ()=>{ if(!dragState) canvas.style.cursor='default'; });

  function imgMetrics(){
    const imgEl=document.getElementById('img-wrap').querySelector('img');
    if(!imgEl||!imgEl.complete) return null;
    const rect=imgEl.getBoundingClientRect();
    const wrapRect=imgEl.parentElement.getBoundingClientRect();
    return {ox:rect.left-wrapRect.left, oy:rect.top-wrapRect.top, iw:rect.width, ih:rect.height, wrapRect};
  }
  function boxToScreen(b,m){ const x=m.ox+(b[1]/1000)*m.iw, y=m.oy+(b[0]/1000)*m.ih; const w=(b[3]-b[1])/1000*m.iw, h=(b[2]-b[0])/1000*m.ih; return {x,y,w,h}; }
  function screenToBboxPt(px,py,m){ return {bx:((px-m.ox)/m.iw)*1000, by:((py-m.oy)/m.ih)*1000}; }

  function drawBboxes(highlighted = state.selectedIdx){
    const m=imgMetrics();
    if(!m) return;
    canvas.width=m.wrapRect.width; canvas.height=m.wrapRect.height;
    canvas.style.width=m.wrapRect.width+'px'; canvas.style.height=m.wrapRect.height+'px';
    const ctx=canvas.getContext('2d');
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const d=state.dataset[state.current];
    if(!d) return;
    const els=(d.data.compositional_deconstruction||{}).elements||[];
    hitAreas={handles:{},delBtn:null,boxes:[]};
    els.forEach((el,i)=>{
      const b=el.bbox; if(!b||b.every(v=>v===0)){ hitAreas.boxes[i]=null; return; }
      const {x,y,w,h}=boxToScreen(b,m);
      hitAreas.boxes[i]={x,y,w,h};
      const isHi=i===highlighted;
      const labelColor=el.type==='text'?(isHi?'#185FA5':'#85B7EB'):(isHi?'#0F6E56':'#5DCAA5');
      ctx.strokeStyle=labelColor; ctx.lineWidth=isHi?2:1;
      ctx.strokeRect(x,y,w,h);
      if(isHi){ ctx.fillStyle=el.type==='text'?'rgba(55,138,221,0.08)':'rgba(29,158,117,0.08)'; ctx.fillRect(x,y,w,h); }
      const solid=el.type==='text'?'#185FA5':'#0F6E56';
      ctx.fillStyle=solid; ctx.font='bold 11px sans-serif';
      const labelW=w<44?44:w;
      ctx.fillRect(x,y-15,labelW+(isHi?16:0),15);
      ctx.fillStyle='white';
      const label=el.type==='text'?(el.text?`"${el.text.slice(0,12)}"`:el.desc?.slice(0,12)||'text'):el.desc?.slice(0,12)||'obj';
      ctx.fillText(`${i+1}. ${label}`, x+3, y-4);
      if(isHi){
        const delX=x+labelW, delY=y-15, delW=16, delH=15;
        ctx.strokeStyle='white'; ctx.lineWidth=1.3;
        ctx.beginPath(); ctx.moveTo(delX+5,delY+4); ctx.lineTo(delX+11,delY+11); ctx.moveTo(delX+11,delY+4); ctx.lineTo(delX+5,delY+11); ctx.stroke();
        hitAreas.delBtn={x:delX,y:delY,w:delW,h:delH,idx:i};
        const hs=7;
        const corners={nw:{x,y},ne:{x:x+w,y},sw:{x,y:y+h},se:{x:x+w,y:y+h}};
        Object.entries(corners).forEach(([key,pt])=>{
          ctx.fillStyle='white'; ctx.fillRect(pt.x-hs/2,pt.y-hs/2,hs,hs);
          ctx.strokeStyle=solid; ctx.lineWidth=1.3; ctx.strokeRect(pt.x-hs/2,pt.y-hs/2,hs,hs);
          hitAreas.handles[key]={x:pt.x-hs,y:pt.y-hs,w:hs*2,h:hs*2,idx:i};
        });
      }
    });
  }

  function canvasPoint(e){ const r=canvas.getBoundingClientRect(); return {x:e.clientX-r.left, y:e.clientY-r.top}; }
  function pointInRect(p,r){ return !!r && p.x>=r.x && p.x<=r.x+r.w && p.y>=r.y && p.y<=r.y+r.h; }

  function onMouseDown(e){
    if(!state.dataset.length) return;
    const m=imgMetrics(); if(!m) return;
    const p=canvasPoint(e);
    if(hitAreas.delBtn && pointInRect(p,hitAreas.delBtn)){
      e.preventDefault();
      const idx=hitAreas.delBtn.idx;
      // remove element via editor logic: replicate
      const d=state.dataset[state.current];
      d.data.compositional_deconstruction.elements.splice(idx,1);
      state.selectedIdx=null;
      // trigger re-render
      window.__fillForm && window.__fillForm(d.data);
      drawBboxes(null);
      if(markDirty) markDirty();
      return;
    }
    for(const key of ['nw','ne','sw','se']){
      const h=hitAreas.handles[key];
      if(h && pointInRect(p,h)){
        e.preventDefault();
        const el=state.dataset[state.current].data.compositional_deconstruction.elements[h.idx];
        dragState={mode:'resize', idx:h.idx, handle:key, orig:[...el.bbox]};
        document.body.style.userSelect='none';
        document.addEventListener('mousemove', onMouseMoveDrag);
        document.addEventListener('mouseup', onMouseUp);
        return;
      }
    }
    const els=(state.dataset[state.current].data.compositional_deconstruction||{}).elements||[];
    for(let i=els.length-1;i>=0;i--){
      const r=hitAreas.boxes[i];
      if(r && pointInRect(p,r)){
        e.preventDefault();
        // select/highlight — single click only moves, double-click jumps to element section
        state.selectedIdx=i;
        document.querySelectorAll('.el-card').forEach((c,idx)=> c.classList.toggle('el-highlight', idx===i));
        drawBboxes(i);
        const {bx,by}=screenToBboxPt(p.x,p.y,m);
        dragState={mode:'move', idx:i, startBx:bx, startBy:by, orig:[...els[i].bbox]};
        document.body.style.userSelect='none';
        document.addEventListener('mousemove', onMouseMoveDrag);
        document.addEventListener('mouseup', onMouseUp);
        return;
      }
    }
    if(state.selectedIdx!==null){
      state.selectedIdx=null;
      document.querySelectorAll('.el-card').forEach(c=> c.classList.remove('el-highlight'));
      drawBboxes(null);
    }
  }
  function onDblClick(e){
    if(!state.dataset.length) return;
    const m=imgMetrics(); if(!m) return;
    const p=canvasPoint(e);
    const els=(state.dataset[state.current].data.compositional_deconstruction||{}).elements||[];
    for(let i=els.length-1;i>=0;i--){
      const r=hitAreas.boxes[i];
      if(r && pointInRect(p,r)){
        e.preventDefault();
        state.selectedIdx=i;
        document.querySelectorAll('.el-card').forEach((c,idx)=> c.classList.toggle('el-highlight', idx===i));
        drawBboxes(i);
        const card=document.getElementById('elcard-'+i);
        if(card) card.scrollIntoView({block:'nearest',behavior:'smooth'});
        const body=document.getElementById('elbody-'+i);
        if(body && !body.classList.contains('open')) body.classList.add('open');
        // also ensure elements section is open
        const secBody=document.getElementById('body-elements');
        if(secBody && !secBody.classList.contains('open')){
          secBody.classList.add('open');
          const caret=document.getElementById('caret-elements');
          if(caret) caret.classList.add('open');
        }
        return;
      }
    }
  }
  function onMouseMove(e){
    const m=imgMetrics(); if(!m) return;
    const p=canvasPoint(e);
    let cursor='default';
    if(hitAreas.delBtn && pointInRect(p,hitAreas.delBtn)) cursor='pointer';
    else if(['nw','se'].some(k=> hitAreas.handles[k] && pointInRect(p,hitAreas.handles[k]))) cursor='nwse-resize';
    else if(['ne','sw'].some(k=> hitAreas.handles[k] && pointInRect(p,hitAreas.handles[k]))) cursor='nesw-resize';
    else {
      const els=(state.dataset[state.current]?.data.compositional_deconstruction||{}).elements||[];
      for(let i=els.length-1;i>=0;i--) if(hitAreas.boxes[i] && pointInRect(p,hitAreas.boxes[i])){ cursor='move'; break; }
    }
    canvas.style.cursor=cursor;
  }
  function onMouseMoveDrag(e){
    const m=imgMetrics(); if(!m) return;
    if(!dragState) return;
    const p=canvasPoint(e);
    const {bx,by}=screenToBboxPt(p.x,p.y,m);
    const el=state.dataset[state.current].data.compositional_deconstruction.elements[dragState.idx];
    const [ymin,xmin,ymax,xmax]=dragState.orig;
    const clamp=v=> Math.max(0,Math.min(1000,v));
    if(dragState.mode==='move'){
      const dx=bx-dragState.startBx, dy=by-dragState.startBy;
      const hgt=ymax-ymin, wid=xmax-xmin;
      let nymin=ymin+dy, nymax=ymax+dy, nxmin=xmin+dx, nxmax=xmax+dx;
      if(nymin<0){ nymin=0; nymax=hgt; }
      if(nymax>1000){ nymax=1000; nymin=1000-hgt; }
      if(nxmin<0){ nxmin=0; nxmax=wid; }
      if(nxmax>1000){ nxmax=1000; nxmin=1000-wid; }
      el.bbox=[Math.round(nymin),Math.round(nxmin),Math.round(nymax),Math.round(nxmax)];
    } else if(dragState.mode==='resize'){
      let nymin=ymin,nxmin=xmin,nymax=ymax,nxmax=xmax;
      const cbx=clamp(bx), cby=clamp(by);
      if(dragState.handle==='nw'){ nymin=Math.min(cby,ymax-5); nxmin=Math.min(cbx,xmax-5); }
      if(dragState.handle==='ne'){ nymin=Math.min(cby,ymax-5); nxmax=Math.max(cbx,xmin+5); }
      if(dragState.handle==='sw'){ nymax=Math.max(cby,ymin+5); nxmin=Math.min(cbx,xmax-5); }
      if(dragState.handle==='se'){ nymax=Math.max(cby,ymin+5); nxmax=Math.max(cbx,xmin+5); }
      el.bbox=[Math.round(nymin),Math.round(nxmin),Math.round(nymax),Math.round(nxmax)];
    }
    syncInputs(dragState.idx, el.bbox);
    drawBboxes(dragState.idx);
  }
  function onMouseUp(){
    document.removeEventListener('mousemove', onMouseMoveDrag);
    document.removeEventListener('mouseup', onMouseUp);
    document.body.style.userSelect='';
    if(dragState){
      // commit dirty
      const idx=dragState.idx;
      if(markDirty) markDirty();
      // also update form's element title
      const card=document.getElementById('elcard-'+idx);
      if(card){
        const desc=card.querySelector('.el-desc')?.value||'';
        const preview=(desc||'element').slice(0,40);
        const title=card.querySelector('.el-card-title');
        if(title) title.textContent=preview+(preview.length>=40?'…':'');
      }
      dragState=null;
    }
  }
  function syncInputs(idx,bbox){
    const card=document.getElementById('elcard-'+idx);
    if(!card) return;
    ['ymin','xmin','ymax','xmax'].forEach((k,j)=>{
      const inp=card.querySelector('.bbox-'+k);
      if(inp) inp.value=bbox[j];
    });
  }

  window.__drawBboxes = drawBboxes;
  window.addEventListener('resize', ()=> drawBboxes());
}
