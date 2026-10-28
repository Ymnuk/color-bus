// ============================================================
// Color Bus — entry point: WebGPU init, scene build, input, HUD
// ============================================================
import { Renderer } from './renderer.js';
import { MeshBuilder } from './models.js';
import { Game, COLORS } from './game.js';
import { M4, clamp, lerp, rand } from './math.js';
import { buildSceneDraw, makeDigitAtlas } from './scene.js';

const canvas = document.getElementById('gl');
const loader = document.getElementById('loader');
const startScreen = document.getElementById('startScreen');
const overScreen = document.getElementById('overScreen');
const scoreVal = document.getElementById('scoreVal');
const bestVal = document.getElementById('bestVal');
const cardScore = document.getElementById('cardScore');
const finalScore = document.getElementById('finalScore');
const recordFlag = document.getElementById('recordFlag');
const toastEl = document.getElementById('toast');
const gpuBadge = document.getElementById('gpuBadge');

const game = new Game();
let renderer=null, models=null, digitAtlas=null, camera=null;
let soundOn=true, actx=null;

// ---------- tiny synth sounds ----------
function beep(freq, dur=0.12, type='sine', gain=0.18, slide=0){
  if(!soundOn) return;
  try{
    actx = actx || new (window.AudioContext||window.webkitAudioContext)();
    if(actx.state==='suspended') actx.resume();
    const o=actx.createOscillator(), g=actx.createGain();
    o.type=type; o.frequency.value=freq;
    if(slide) o.frequency.exponentialRampToValueAtTime(Math.max(30,freq+slide), actx.currentTime+dur);
    g.gain.setValueAtTime(gain, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime+dur);
    o.connect(g).connect(actx.destination);
    o.start(); o.stop(actx.currentTime+dur+0.02);
  }catch(e){}
}
const sfx={
  board:()=>beep(660,0.09,'triangle',0.12,220),
  depart:()=>{beep(520,0.14,'square',0.08,-120); setTimeout(()=>beep(780,0.18,'triangle',0.14,180),90);},
  deny:()=>beep(180,0.18,'sawtooth',0.1,-60),
  over:()=>{beep(400,0.3,'sawtooth',0.12,-260); setTimeout(()=>beep(200,0.5,'sawtooth',0.12,-120),220);},
};

// ---------- HUD glue ----------
bestVal.textContent=game.best;
game.on('score',v=>{ scoreVal.textContent=v; cardScore.classList.remove('pop'); void cardScore.offsetWidth; cardScore.classList.add('pop'); });
game.on('best',v=>{ bestVal.textContent=v; });
game.on('toast',msg=>showToast(msg));
game.on('dispatch-lane',()=>beep(500,0.1,'square',0.07,-80));
game.on('depart',b=>{ if(b&&b.taken>=b.cap) sfx.depart(); });
game.on('roundClear',r=>{ beep(660,0.12,'triangle',0.14,200); setTimeout(()=>beep(880,0.18,'triangle',0.14,160),110); });
game.on('gameover',({score,best,record,reason})=>{
  sfx.over();
  finalScore.textContent=score;
  recordFlag.classList.toggle('show',record);
  document.getElementById('overSub').textContent = reason||'';
  overScreen.classList.remove('hidden');
});
let toastT=null;
function showToast(msg){
  toastEl.textContent=msg; toastEl.classList.add('show');
  clearTimeout(toastT); toastT=setTimeout(()=>toastEl.classList.remove('show'),1600);
}

document.getElementById('btnSound').addEventListener('click',e=>{
  soundOn=!soundOn; e.currentTarget.textContent=soundOn?'🔊':'🔇';
});

// ---------- resize ----------
function resize(){
  const dpr=Math.min(window.devicePixelRatio||1, 2);
  const w=Math.floor(canvas.clientWidth*dpr), h=Math.floor(canvas.clientHeight*dpr);
  if(canvas.width!==w||canvas.height!==h){ canvas.width=w; canvas.height=h; }
}
window.addEventListener('resize',resize);

// ---------- input ----------
function pointerToWorld(ev){
  const rect=canvas.getBoundingClientRect();
  const x=(ev.clientX-rect.left), y=(ev.clientY-rect.top);
  return game.pickGround(camera, x, y, rect.width, rect.height);
}
canvas.addEventListener('pointerdown',ev=>{
  ev.preventDefault();
  if(game.state!=='play') return;
  const p=pointerToWorld(ev);
  if(p) game.tapAt(p[0],p[1]);
},{passive:false});

document.getElementById('btnPlay').addEventListener('click',()=>{
  startScreen.classList.add('hidden');
  game.startGame('campaign');
  beep(880,0.1,'triangle',0.1,140);
});
document.getElementById('btnEndless').addEventListener('click',()=>{
  startScreen.classList.add('hidden');
  game.startGame('endless');
  beep(720,0.1,'triangle',0.1,140);
});
document.getElementById('btnRestart').addEventListener('click',()=>{
  overScreen.classList.add('hidden');
  game.startGame(game.mode);
});
window.addEventListener('keydown',e=>{
  if(game.state!=='play') return;
  const m={'Digit1':0,'Digit2':1,'Digit3':2,'Digit4':3,'Digit5':4}[e.code];
  if(m!==undefined){ game.dispatchLane(m); }
});

// ---------- main loop ----------
let last=performance.now();
function frame(now){
  const dt=Math.min((now-last)/1000, 0.05); last=now;
  resize();
  game.update(dt);
  const {drawList,cam}=buildSceneDraw(renderer,models,game,canvas.width,canvas.height);
  camera=cam;
  renderer.submit(cam, drawList);
  requestAnimationFrame(frame);
}

// ---------- boot ----------
async function boot(){
  let usingFallback=false;
  try{
    renderer=await Renderer.create(canvas);
    gpuBadge.textContent='WebGPU · 3D';
    gpuBadge.classList.add('gpu');
  }catch(err){
    console.warn('WebGPU unavailable:',err);
    gpuBadge.textContent='WebGPU недоступен';
    loader.querySelector('.loadText').textContent='Для этой игры нужен браузер с WebGPU (Chrome/Edge/Safari 18+).';
    return;
  }
  models=buildModels();
  for(const [name,mesh] of Object.entries(models)) renderer.registerMesh(name,mesh);
  // quad meshes must be registered AFTER the digit atlas exists so pipelines include texture BGL
  digitAtlas=makeDigitAtlas();
  renderer.setDigitAtlas(digitAtlas);
  { const q=renderer.makeQuadMesh(1,1);
    for(const nm of ['quad1','quadP','roadWide','laneStripe','stopLine','slotPad','padOuter','blockMark'])
      renderer.registerMesh(nm,q);
    // arrow marker (triangle-ish quad) — reuse a flat plane mesh
    const ab=new MeshBuilder();
    ab.quad([-0.5,-0.2,0],[0.5,-0.2,0],[0.5,0.2,0],[-0.5,0.2,0],[0,0,1]);
    ab.quad([-0.2,0.2,0],[0.2,0.2,0],[0,0.7,0],[0,0.2,0],[0,0,1]);
    renderer.registerMesh('arrow',ab.build()); }

  game.initMenuDemo();

  loader.classList.add('hidden');
  requestAnimationFrame(t=>{ last=t; frame(t); });
}
boot();
