// ========== Utility ==========
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const dpr = Math.max(1, window.devicePixelRatio || 1);

let rows = 30, cols = 30;
let grid, start, goal;
const CELL = { EMPTY:0, WALL:1 };
const COLOR = {
  empty: getCss('--cell'), wall:getCss('--wall'),
  start:getCss('--start'), goal:getCss('--goal'),
  open:getCss('--open'), closed:getCss('--closed'), path:getCss('--path')
};

function getCss(v){return getComputedStyle(document.documentElement).getPropertyValue(v).trim()}

// ========== Grid Setup ==========
function makeGrid(r=rows,c=cols){
  grid = Array.from({length:r}, (_,y)=> Array.from({length:c}, (_,x)=> ({
    y,x, type:CELL.EMPTY
  })));
  // defaults
  start = {y:Math.floor(r/2), x:Math.floor(c/4)};
  goal  = {y:Math.floor(r/2), x:Math.floor(c*3/4)};
}
function resize(){
  const rect = canvas.getBoundingClientRect();
  const s = Math.min(rect.width, rect.height);
  canvas.width = Math.floor(s * dpr); canvas.height = Math.floor(s * dpr);
  draw();
}
window.addEventListener('resize', resize);

// ========== Drawing ==========
function draw(state){
  const w = canvas.width, h = canvas.height;
  const cw = w/cols, ch = h/rows;
  ctx.clearRect(0,0,w,h);
  // cells
  for(let y=0;y<rows;y++){
    for(let x=0;x<cols;x++){
      const cell = grid[y][x];
      ctx.fillStyle = cell.type===CELL.WALL? COLOR.wall : COLOR.empty;
      ctx.fillRect(x*cw, y*ch, cw, ch);
    }
  }
  // overlays
  if(state){
    // closed set (visited)
    ctx.fillStyle = COLOR.closed;
    for(const key of state.closed){
      const [y,x] = key.split(',').map(Number);
      ctx.globalAlpha = .8; ctx.fillRect(x*cw, y*ch, cw, ch);
    }
    // open/frontier
    ctx.fillStyle = COLOR.open;
    ctx.globalAlpha = .7;
    for(const node of state.frontierArr){
      const {y,x} = node; ctx.fillRect(x*cw, y*ch, cw, ch);
    }
    ctx.globalAlpha = 1;
    // path
    if(state.path){
      ctx.fillStyle = COLOR.path;
      for(const p of state.path){
        ctx.fillRect(p.x*cw, p.y*ch, cw, ch);
      }
    }
  }
  // start/goal
  ctx.fillStyle = COLOR.start; ctx.fillRect(start.x*cw, start.y*ch, cw, ch);
  ctx.fillStyle = COLOR.goal; ctx.fillRect(goal.x*cw, goal.y*ch, cw, ch);

  // grid lines
  ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 1;
  for(let y=0;y<=rows;y++){ ctx.beginPath(); ctx.moveTo(0,y*ch); ctx.lineTo(w, y*ch); ctx.stroke(); }
  for(let x=0;x<=cols;x++){ ctx.beginPath(); ctx.moveTo(x*cw,0); ctx.lineTo(x*cw,h); ctx.stroke(); }
}

// ========== Interaction ==========
const tools = document.getElementById('tools');
let activeTool = 'wall';
tools.addEventListener('click', e=>{
  const t = e.target.closest('.tool'); if(!t) return;
  [...tools.children].forEach(c=>c.classList.remove('active'));
  t.classList.add('active'); activeTool = t.dataset.tool;
});

let isDown=false; let lastCell=null;
canvas.addEventListener('mousedown', e=>{ isDown=true; handlePointer(e); });
window.addEventListener('mouseup', ()=>{ isDown=false; lastCell=null; });
canvas.addEventListener('mousemove', e=>{ if(isDown) handlePointer(e); });
canvas.addEventListener('contextmenu', e=>{ e.preventDefault(); eraseAt(e); });

function posToCell(e){
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX-rect.left)/rect.width * cols);
  const y = Math.floor((e.clientY-rect.top)/rect.height * rows);
  return {x: clamp(x,0,cols-1), y: clamp(y,0,rows-1)};
}
function clamp(v,min,max){return Math.max(min, Math.min(max, v))}

function handlePointer(e){
  const {x,y} = posToCell(e);
  if(lastCell && lastCell.x===x && lastCell.y===y) return;
  lastCell = {x,y};
  if(activeTool==='wall') grid[y][x].type = CELL.WALL;
  else if(activeTool==='erase') grid[y][x].type = CELL.EMPTY;
  else if(activeTool==='start'){ start = {x,y}; }
  else if(activeTool==='goal'){ goal = {x,y}; }
  draw(runner?.state);
}
function eraseAt(e){ const {x,y}=posToCell(e); grid[y][x].type=CELL.EMPTY; draw(runner?.state); }

window.addEventListener('keydown', e=>{
  if(e.key.toLowerCase()==='s'){ activeTool='start'; setToolUI('start'); }
  if(e.key.toLowerCase()==='g'){ activeTool='goal'; setToolUI('goal'); }
});
function setToolUI(id){ [...tools.children].forEach(c=> c.classList.toggle('active', c.dataset.tool===id)); }

// ========== Algorithms ==========
function neighbors(y,x){
  const out=[]; const dirs=[[1,0],[-1,0],[0,1],[0,-1]]; // 4 directions
  for(const [dy,dx] of dirs){
    const ny=y+dy,nx=x+dx;
    if(ny>=0&&ny<rows&&nx>=0&&nx<cols && grid[ny][nx].type!==CELL.WALL) out.push({y:ny,x:nx});
  }
  return out;
}
const key = (y,x)=> `${y},${x}`;
const manhattan = (a,b)=> Math.abs(a.x-b.x)+Math.abs(a.y-b.y);

class PriorityQueue {
  constructor(compare){ this._a=[]; this._c=compare; }
  push(v){ this._a.push(v); this._up(this._a.length-1); }
  _up(i){ const a=this._a,c=this._c; while(i>0){ const p=(i-1>>1); if(c(a[i],a[p])>=0) break; [a[i],a[p]]=[a[p],a[i]]; i=p; } }
  pop(){ if(this._a.length===0) return undefined; const a=this._a; const top=a[0]; const v=a.pop(); if(a.length){ a[0]=v; this._down(0); } return top; }
  _down(i){ const a=this._a,c=this._c; for(;;){ const l=i*2+1,r=l+1; let m=i; if(l<a.length&&c(a[l],a[m])<0) m=l; if(r<a.length&&c(a[r],a[m])<0) m=r; if(m===i) break; [a[i],a[m]]=[a[m],a[i]]; i=m; } }
  get size(){ return this._a.length; }
  toArray(){ return this._a.slice(); }
}
function reconstruct(came, end){
  const p=[]; let cur=key(end.y,end.x);
  while(came.has(cur)){
    const [y,x]=cur.split(',').map(Number); p.push({y,x});
    cur=came.get(cur);
  }
  p.reverse(); return p;
}

// --- BFS ---
function* bfsGen(){
  const q=[start]; const seen=new Set([key(start.y,start.x)]); const came=new Map();
  while(q.length){
    const v=q.shift(); if(v.y===goal.y&&v.x===goal.x) return {came};
    for(const n of neighbors(v.y,v.x)){
      const k=key(n.y,n.x);
      if(!seen.has(k)){ seen.add(k); came.set(k, key(v.y,v.x)); q.push(n);}
    }
    yield {frontier:q.slice(), closed:new Set(seen), came};
  }
  return {came:null, closed:seen};
}
// --- DFS ---
function* dfsGen(){
  const st=[start]; const seen=new Set([key(start.y,start.x)]); const came=new Map();
  while(st.length){
    const v=st.pop(); if(v.y===goal.y&&v.x===goal.x) return {came};
    for(const n of neighbors(v.y,v.x)){
      const k=key(n.y,n.x);
      if(!seen.has(k)){ seen.add(k); came.set(k, key(v.y,v.x)); st.push(n);}
    }
    yield {frontier:st.slice(), closed:new Set(seen), came};
  }
  return {came:null, closed:seen};
}
// --- Greedy Best-First ---
function* greedyGen(){
  const pq=new PriorityQueue((a,b)=> a.h-b.h);
  const seen=new Set([key(start.y,start.x)]); const came=new Map();
  pq.push({...start, h:manhattan(start,goal)});
  while(pq.size){
    const v=pq.pop(); if(v.y===goal.y&&v.x===goal.x) return {came};
    for(const n of neighbors(v.y,v.x)){
      const k=key(n.y,n.x);
      if(!seen.has(k)){ seen.add(k); came.set(k, key(v.y,v.x)); pq.push({...n, h:manhattan(n,goal)});}
    }
    yield {frontier:pq.toArray(), closed:new Set(seen), came};
  }
  return {came:null, closed:seen};
}
// --- A* ---
function* astarGen(){
  const g=new Map([[key(start.y,start.x),0]]); const came=new Map();
  const pq=new PriorityQueue((a,b)=> a.f-b.f);
  pq.push({...start, f:manhattan(start,goal)});
  const seen=new Set();
  while(pq.size){
    const v=pq.pop(); const vk=key(v.y,v.x);
    if(seen.has(vk)){ yield {frontier:pq.toArray(), closed:new Set(seen), came}; continue;}
    seen.add(vk);
    if(v.y===goal.y&&v.x===goal.x) return {came};
    for(const n of neighbors(v.y,v.x)){
      const nk=key(n.y,n.x); const tentative=(g.get(vk)||0)+1;
      if(!g.has(nk) || tentative < g.get(nk)){
        g.set(nk, tentative);
        came.set(nk, vk);
        const f = tentative + manhattan(n, goal);
        pq.push({...n, f});
      }
    }
    yield {frontier:pq.toArray(), closed:new Set(seen), came};
  }
  return {came:null, closed:seen};
}

const generators = { bfs:bfsGen, dfs:dfsGen, greedy:greedyGen, astar:astarGen };

// ========== Runner ==========
const status = document.getElementById('status');
const algoSel = document.getElementById('algo');
const btnRun = document.getElementById('run');
const btnPause = document.getElementById('pause');
const btnStep = document.getElementById('step');
const btnReset = document.getElementById('reset');
const sizeSel = document.getElementById('size');
const btnClear = document.getElementById('clear');
const btnMaze = document.getElementById('maze');
const speed = document.getElementById('speed');

const sExpanded = document.getElementById('sExpanded');
const sFrontier = document.getElementById('sFrontier');
const sPath = document.getElementById('sPath');
const sTime = document.getElementById('sTime');
const fpsEl = document.getElementById('fps');

let runner=null; let raf=null; let lastTick=0, frames=0, lastFps=performance.now();
class Runner{
  constructor(kind){
    this.kind=kind; this.iter=generators[kind]();
    this.done=false;
    this.state={frontierArr:[], closed:new Set(), came:new Map(), path:null};
    this.startTime=performance.now(); this.expanded=0;
  }
  step(){
    if(this.done) return;
    const r=this.iter.next();
    if(r.value){
      const st=r.value;
      this.state.frontierArr = st.frontier? st.frontier: [];
      this.state.closed = st.closed? new Set([...st.closed]) : this.state.closed;
      this.state.came = st.came || this.state.came;
      this.expanded = this.state.closed.size;
    }
    if(r.done){
      this.done=true; const end=performance.now();
      sTime.textContent = Math.max(0, Math.round(end-this.startTime));
      if(r.value && r.value.came){
        const p = reconstruct(r.value.came, goal);
        this.state.path=p; sPath.textContent=p.length;
        document.getElementById('pathLen').textContent=p.length;
      } else {
        this.state.path=null; sPath.textContent=0;
      }
    }
  }
}

function animate(ts){
  raf = requestAnimationFrame(animate);
  const spd = +speed.value;
  if(!lastTick) lastTick=ts;
  const dt = ts-lastTick;
  if(dt>=1000/spd){
    lastTick=ts;
    if(runner && !paused) runner.step();
    updateUI(); draw(runner?.state);
  }
  frames++;
  if(performance.now()-lastFps>1000){
    fpsEl.textContent = frames; frames=0; lastFps=performance.now();
  }
}

function updateUI(){
  if(!runner){
    status.textContent = 'Ready';
    sFrontier.textContent=0; sExpanded.textContent=0;
    return;
  }
  status.textContent = runner.done? 'Done' : `Running: ${runner.kind.toUpperCase()}`;
  sExpanded.textContent = runner.expanded;
  sFrontier.textContent = runner.state.frontierArr.length;
  document.getElementById('expanded').textContent = runner.expanded;
}

// ========== Buttons ==========
let paused=false;
btnRun.onclick=()=>{ runner=new Runner(algoSel.value); paused=false; lastTick=0;
  sTime.textContent='0'; sPath.textContent='0'; animate(performance.now()); };
btnPause.onclick=()=>{ paused=!paused; btnPause.textContent = paused? 'Resume' : 'Pause'; };
btnStep.onclick=()=>{ if(!runner) runner=new Runner(algoSel.value); runner.step(); updateUI(); draw(runner.state); };
btnReset.onclick=()=>{ cancelAnimationFrame(raf); runner=null; paused=false;
  btnPause.textContent='Pause'; sTime.textContent='0'; sPath.textContent='0'; document.getElementById('pathLen').textContent='0'; updateUI(); draw(); };

sizeSel.onchange=()=>{ rows=cols=+sizeSel.value; makeGrid(rows,cols); resize(); };
btnClear.onclick=()=>{ for(const row of grid) for(const c of row) c.type=CELL.EMPTY; draw(); };
btnMaze.onclick=()=>{ for(const row of grid) for(const c of row) c.type=(Math.random()<0.3? CELL.WALL : CELL.EMPTY);
  grid[start.y][start.x].type=CELL.EMPTY; grid[goal.y][goal.x].type=CELL.EMPTY; draw(); };

// ========== Boot ==========
makeGrid(rows,cols); resize(); draw();
const ro = new ResizeObserver(()=> resize()); ro.observe(canvas);
