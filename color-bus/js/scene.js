// ============================================================
// Scene assembly: static environment, animated buses & persons,
// digit sprites (bus numbers), camera. Produces a flat drawList
// consumed by the WebGPU renderer.
// ============================================================
import { M4, clamp } from './math.js';
import { COLORS } from './game.js';

const ROAD_Z=-2.0;

// ---------- digit atlas (canvas → texture) ----------
export function makeDigitAtlas(){
  const cell=128, c=document.createElement('canvas');
  c.width=cell*10; c.height=cell;
  const x=c.getContext('2d');
  x.clearRect(0,0,c.width,c.height);
  x.font='900 96px "Arial Black", Arial, sans-serif';
  x.textAlign='center'; x.textBaseline='middle';
  for(let d=0;d<10;d++){
    x.fillStyle='#fff';
    x.shadowColor='rgba(0,0,0,.55)'; x.shadowBlur=6; x.shadowOffsetY=3;
    x.fillText(String(d), d*cell+cell/2, cell/2+4);
    x.shadowColor='transparent';
  }
  return c;
}
function digitUV(d){
  const s=d/10+0.004, e=(d+1)/10-0.004;
  return [s,0,e,1];
}

// ---------- helpers ----------
class Batch {
  constructor(){ this.list=[]; }
  push(mesh,m,color,kind=0,uv=[0,0,1,1],order=50){
    this.list.push({mesh,m:m.slice?m.slice():Array.from(m),color,kind,uv,order});
  }
}
const _m=M4.create(), _p=[0,0,0], _r=[0,0,0], _s=[1,1,1];
function mat(b,out,x,y,z,rx,ry,rz,sx,sy,sz){
  _p[0]=x;_p[1]=y;_p[2]=z; _r[0]=rx;_r[1]=ry;_r[2]=rz; _s[0]=sx;_s[1]=sy;_s[2]=sz;
  M4.compose(out,_p,_r,_s); return out;
}
function shadowAt(b,x,z,rad,alpha){
  const k=rad/0.55;
  mat(b,_m,x,0.014,z,0,0,0,k,1,k);
  b.push('shadow',_m,[0.07,0.12,0.18,alpha],1,null,10);
}

// digits helper: billboard quads facing camera at given world point
function drawNumber(b,num,x,y,z,scale,color,alpha,camPos){
  const str=String(num);
  const wq=scale*0.62, gap=scale*0.55;
  let fx=camPos[0]-x, fz=camPos[2]-z;
  const fl=Math.hypot(fx,fz)||1; fx/=fl; fz/=fl;
  const rx=fz, rz=-fx;
  const total=(str.length-1)*gap;
  for(let i=0;i<str.length;i++){
    const d=+str[i];
    const off=-total/2+i*gap;
    const px=x+rx*off, pz=z+rz*off;
    const ry=Math.atan2(fx,fz);
    mat(b,_m,px,y,pz,0,ry,0,wq,wq,1);
    b.push('quad1',_m,color,2,digitUV(d),80);
  }
}

// ---------- static environment ----------
const TREES=[[-16,-8],[-10,-8.5],[12,-8],[18,-8.5],[24,-8],[-22,12],[22,13]];
const BUSHES=[[-6,-7.6],[7,-7.8],[15,-7.6],[-18,11]];
const CLOUDS=[[0,14,-30],[18,16,-40],[-22,15,-36],[-8,17,-45]];

function buildEnvironment(b,t,g){
  const PAD_CZ=g.PAD_CZ, rows=g.rows||3, cols=4;
  // ground
  mat(b,_m,0,-0.05,0,0,0,0,1,1,1);
  b.push('ground',_m,[0.55,0.82,0.45],0,null,0);
  // road (wide enough for 5 lanes)
  mat(b,_m,0,0.005,ROAD_Z+3.9,0,0,0,1,1,1);
  b.push('roadWide',_m,[0.24,0.26,0.30],0,null,1);
  // lane divider stripes
  for(let i=1;i<5;i++){
    const z=g.LANE_Z(i)-g.LANE_GAP/2;
    mat(b,_m,0,0.008,z,0,0,0,1,1,1);
    b.push('laneStripe',_m,[0.95,0.9,0.3],0,null,2);
  }
  // stop line in front of the pad
  mat(b,_m,0,0.008,g.LANE_Z(4)+g.LANE_GAP/2+0.15,0,0,0,1,1,1);
  b.push('stopLine',_m,[0.95,0.95,0.98],0,null,2);
  // sidewalks behind the road and below the pad
  mat(b,_m,0,0.03,ROAD_Z-4.2,0,0,0,1,1,1);
  b.push('sidewalk',_m,[0.78,0.78,0.82],0,null,1);
  mat(b,_m,0,0.09,ROAD_Z-6.0,0,0,0,1,1,1);
  b.push('curb',_m,[0.9,0.9,0.93],0,null,2);
  // parking slots: colored head markings
  for(let i=0;i<5;i++){
    const z=g.LANE_Z(i);
    mat(b,_m,g.STOP_X,0.058,z,0,0,0,1,1,1);
    b.push('slotPad',_m,[0.86,0.88,0.94],0,null,3);
    // number plate on the ground for the head-of-queue bus
    const head=g.lanes[i]&&g.lanes[i].find(x=>x.state==='queued');
    if(head){
      mat(b,_m,g.STOP_X+2.2,0.062,z,0,0,0,1,1,1);
      b.push('arrow',_m,COLORS[head.colorIdx].rgb,0,null,4);
    }
  }
  // waiting pad (the crowd picture board)
  const padW=cols*g.CELL_W+1.4, padD=rows*g.CELL_H+1.2;
  mat(b,_m,0,0.055,PAD_CZ,0,0,0,1,1,1);
  b.push('padOuter',_m,[0.98,0.86,0.55],0,null,3);
  mat(b,_m,0,0.06,PAD_CZ,0,0,0,1,1,1);
  b.push('padInner',_m,[1.0,0.96,0.82],0,null,4);
  // grid cell markers + blocked tint
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    const gp=g.cellPos(r,c);
    const occ=g.padGrid&&g.padGrid[r][c];
    const p=occ;
    let col=[0.99,0.93,0.72];
    if(p){ col = g.reachSet&&g.reachSet.has(p)?[0.99,0.97,0.85]:[0.82,0.75,0.68]; }
    mat(b,_m,gp[0],0.068,gp[1],-Math.PI/2,0,0,g.CELL_W*0.82,g.CELL_H*0.8,1);
    b.push('quadP',_m,col,0,null,5);
  }
  // stop sign
  mat(b,_m,-5.6,1.7,ROAD_Z+2.6,0,0,0,1,1,1);
  b.push('pole',_m,[0.85,0.85,0.9],0,null,6);
  mat(b,_m,-5.6,3.1,ROAD_Z+2.6,0,Math.PI/2,0,1,1,1);
  b.push('signBoard',_m,[0.3,0.65,1.0],0,null,6);
  mat(b,_m,-5.6,3.1,ROAD_Z+2.55,0,0,0,0.55,0.4,1);
  b.push('box',_m,[1,1,1],0,null,7);
  // trees & bushes (sway)
  for(const [tx,tz] of TREES){
    const sw=Math.sin(t*0.8+tx)*0.03;
    shadowAt(b,tx,tz,0.9,0.16);
    mat(b,_m,tx,0.6,tz,0,0,0,1,1,1);
    b.push('trunk',_m,[0.52,0.36,0.22],0,null,8);
    mat(b,_m,tx,2.0,tz,sw,0,sw*1.4,1,1.15,1);
    b.push('foliage',_m,[0.24,0.66,0.34],0,null,8);
    mat(b,_m,tx+0.5,1.6,tz-0.3,0,0,0,0.6,0.6,0.6);
    b.push('foliage',_m,[0.3,0.74,0.4],0,null,8);
  }
  for(const [bx,bz] of BUSHES){
    mat(b,_m,bx,0.35,bz,0,0,0,1,0.8,1);
    b.push('bush',_m,[0.3,0.7,0.42],0,null,8);
  }
  // clouds drift
  for(const [cx,cy,cz] of CLOUDS){
    const dx=((t*0.45+cx)%60)-30;
    mat(b,_m,dx,cy,cz,0,0,0,2.2,1.1,1.4);
    b.push('cloud',_m,[1,1,1],0,null,6);
    mat(b,_m,dx+1.8,cy-0.25,cz+0.4,0,0,0,1.5,0.8,1.1);
    b.push('cloud',_m,[0.97,0.99,1],0,null,6);
    mat(b,_m,dx-1.7,cy-0.2,cz-0.3,0,0,0,1.3,0.75,1);
    b.push('cloud',_m,[0.97,0.99,1],0,null,6);
  }
}

// ---------- bus ----------
const BUS_COL_LIGHT=[0.95,0.97,1.0], GLASS=[0.55,0.78,0.95], DARK=[0.15,0.17,0.2];
function buildBus(b,bus,t,camPos,game){
  const col=COLORS[bus.colorIdx].rgb;
  const y=0.62+Math.sin(bus.wobble)*0.035;
  const bx=bus.x, bz=game.LANE_Z(bus.lane);
  mat(b,_m,bx,0.016,bz,0,0,0,2.1,1,0.95);
  b.push('busShadow',_m,[0.07,0.12,0.18,0.28],1,null,9);

  const put=(mesh,ox,oy,oz,rx=0,ry=0,rz=0,sx=1,sy=1,sz=1,color=DARK)=>{
    mat(b,_m,bx+ox,y+oy,bz+oz,rx,ry,rz,sx,sy,sz);
    b.push(mesh,_m,color,0,null,30);
  };
  put('busBody',0,0,0,0,Math.PI,0,1,1,1,col);
  put('bumper',0,-0.42,0,0,Math.PI,0,1,1,1,[col[0]*0.7,col[1]*0.7,col[2]*0.7]);
  for(let i=0;i<3;i++){
    const wx=0.9-i*0.95;
    put('window',wx,0.28,0.76,0,0,0,1,1,1,GLASS);
    put('window',wx,0.28,-0.76,0,0,0,1,1,1,GLASS);
  }
  put('windshield',-1.62,0.32,0,0,0,-0.3,1,1,1,GLASS);
  put('light',-1.72,-0.2,0.55,0,0,0,1,1,1,[1,0.95,0.6]);
  put('light',-1.72,-0.2,-0.55,0,0,0,1,1,1,[1,0.95,0.6]);
  put('light',1.72,-0.15,0.55,0,0,0,1,1,1,[0.9,0.2,0.2]);
  put('light',1.72,-0.15,-0.55,0,0,0,1,1,1,[0.9,0.2,0.2]);
  const spin=(bus.state==='stopped'||bus.state==='queued')?0:t*6;
  for(const [wx,wz] of [[-1.1,0.78],[-1.1,-0.78],[1.15,0.78],[1.15,-0.78]]){
    put('wheel',wx,-0.5,wz,spin,0,0,1,1,1,[0.12,0.12,0.14]);
    put('hub',wx,-0.5,wz,spin,0,0,1,1,1,[0.8,0.8,0.85]);
  }
  put('mirror',-1.75,0.25,0.85,0,0,0,1,1,1,DARK);
  put('mirror',-1.75,0.25,-0.85,0,0,0,1,1,1,DARK);
  put('antenna',0.6,0.95,0,Math.sin(t*5+bus.id)*0.1,0,0,1,1,1,DARK);
  put('door',-0.35,-0.1,0.79,0,0,0,1,1,1,[col[0]*0.55,col[1]*0.55,col[2]*0.55]);

  const active=bus.state==='pulling'||bus.state==='stopped';
  const queuedHead=!active&&bus.state==='queued'&&bus.slot===0;
  // floating badge with free seats
  if(active||queuedHead){
    const pulse=1+Math.sin(t*4)*0.06;
    const free=Math.max(0,bus.cap-bus.taken);
    drawNumber(b,active?free:bus.cap,bx+0.2,y+1.75,bz+0.6,0.55*pulse,col,0.98,camPos);
    // seat dots
    for(let i=0;i<bus.cap;i++){
      const filled=bus.seats[i];
      mat(b,_m,bx-0.55+i*0.36,y+1.32,bz+0.62,0,0,0,0.19,0.19,0.19);
      b.push('head',_m,filled?[0.2,0.85,0.4]:[1,1,1],0,null,32);
    }
    // ready-to-go glow ring when full
    if(bus.state==='stopped'&&bus.taken>=bus.cap){
      mat(b,_m,bx,0.02,bz,0,0,0,2.6,1,1.5);
      b.push('shadow',_m,[0.2,0.9,0.4,0.35+0.2*Math.sin(t*6)],1,null,11);
    }
  } else if(bus.state==='queued'){
    // dimmed: locked behind others
    drawNumber(b,bus.num,bx+0.2,y+1.5,bz+0.5,0.4,[0.5,0.55,0.6],0.7,camPos);
  }
}

// ---------- person ----------
const SKIN=[0.99,0.82,0.65];
function buildPerson(b,p,t,camPos,game){
  const col=COLORS[p.colorIdx].rgb;
  let x=p.pos[0], z=p.pos[1];
  let rotY=p.heading||0;
  let scale=p.scale||1;
  let bob=0, legSw=0, armSw=0;
  if(p.state==='idle'){
    bob=Math.sin(t*2+p.phase)*0.03;
    rotY=Math.PI+Math.sin(t*0.7+p.phase)*0.12;
  } else if(p.state==='run'){
    bob=Math.abs(Math.sin(p.runPhase))*0.09;
    legSw=Math.sin(p.runPhase)*0.7;
    armSw=Math.sin(p.runPhase)*0.9;
  }
  if(p.wigT>0){ x+=Math.sin(t*40)*0.06; }
  const lift=p.flashT? 0.25*(p.flashT/0.35):0;

  if(p.state!=='board') shadowAt(b,x,z,0.38*scale,0.22);

  // blocked marker: dark cross overlay quad at feet
  if(p.state==='idle' && game.reachSet && !game.reachSet.has(p)){
    mat(b,_m,x,0.075,z,0,0,0,0.5,0.5,1);
    b.push('blockMark',_m,[0.85,0.25,0.25,0.85],0,null,12);
  }

  const put=(mesh,ox,oy,oz,rx,ry,rz,sx,sy,sz,color)=>{
    mat(b,_m,x+ox*scale, oy*scale+bob+lift+(p.state==='board'?0:0), z+oz*scale, rx,ry+rotY,rz, sx*scale,sy*scale,sz*scale);
    b.push(mesh,_m,color,0,null,40);
  };
  const baseY=0;
  put('legs',0.1,0.17,0, legSw,0,0, 0.85,1,0.8,[0.25,0.32,0.45]);
  put('legs',-0.1,0.17,0, -legSw,0,0, 0.85,1,0.8,[0.25,0.32,0.45]);
  put('torso',0,0.62,0,0,0,0,1,1,1,col);
  put('head',0,1.06,0,0,0,0,1,1,1,SKIN);
  put('arm',0.24,0.66,0, armSw,0,0.3, 1,1,1, col.map(c=>clamp(c*0.8,0,1)));
  put('arm',-0.24,0.66,0, -armSw,0,-0.3, 1,1,1, col.map(c=>clamp(c*0.8,0,1)));
  if(p.flashT){
    mat(b,_m,x,0.03,z,0,0,0,(1-p.flashT/0.35)*0.9+0.4,1,(1-p.flashT/0.35)*0.9+0.4);
    b.push('shadow',_m,[1,1,1,0.5*p.flashT/0.35],1,null,11);
  }
}

// ---------- camera ----------
function computeCamera(aspect){
  const proj=M4.create(), view=M4.create();
  const wide=aspect>=1.15;
  const eye = wide ? [3.2,10.5,17.5] : [2.4,12.5,16.8];
  const look= wide ? [-1.2,0.6,3.4] : [-0.8,0.5,4.0];
  const fovy = wide ? 0.86 : 1.0;
  M4.perspective(proj,fovy,aspect,0.5,120);
  M4.lookAt(view,eye,look,[0,1,0]);
  const lightDir=[-0.45,-0.85,-0.3];
  const ll=Math.hypot(...lightDir);
  return {
    proj:Array.from(proj), view:Array.from(view),
    lightDir:[lightDir[0]/ll,lightDir[1]/ll,lightDir[2]/ll,0],
    ambient:[0.62,0.72,0.85,1],
    camPos:[...eye,1], time:0, eye, look
  };
}

// ---------- main build ----------
export function buildSceneDraw(renderer,models,game,w,h){
  const t=game.time;
  const aspect=w/h;
  const cam=computeCamera(aspect);
  cam.time=t;
  const camPos=cam.eye;
  const b=new Batch();
  buildEnvironment(b,t,game);
  // draw far lanes first (higher Z behind? lanes sorted by z desc for transparency)
  const buses=[...game.buses].sort((a,z)=>z.lane-a.lane);
  for(const bus of buses) buildBus(b,bus,t,camPos,game);
  const ps=[...game.persons].sort((a,z)=>z.pos[1]-a.pos[1]);
  for(const p of ps) buildPerson(b,p,t,camPos,game);
  for(const f of game.fx){
    if(f.type==='text'&&f.t>=0){
      const k=f.t/1.2;
      drawNumberPlain(b,f.txt,f.x,f.y+k*1.2,f.z,0.5,[1,0.85,0.2],1-k,camPos);
    }
  }
  return {drawList:b.list, cam};
}

function drawNumberPlain(b,str,x,y,z,size,color,alpha,camPos){
  const chars=[...str];
  const gap=size*0.55;
  let fx=camPos[0]-x, fz=camPos[2]-z;
  const fl=Math.hypot(fx,fz)||1; fx/=fl; fz/=fl;
  const rx=fz, rz=-fx;
  const plus=chars[0]==='+';
  const digits=plus?chars.slice(1):chars;
  const total=(digits.length-1)*gap + (plus?gap:0);
  let cursor=-total/2;
  if(plus){
    mat(b,_m,x+rx*cursor,y,z+rz*cursor,0,Math.atan2(fx,fz),Math.PI/4,size*0.16,size*0.55,1);
    b.push('box',_m,[...color,alpha],0,null,81);
    mat(b,_m,x+rx*cursor,y,z+rz*cursor,0,Math.atan2(fx,fz),-Math.PI/4,size*0.16,size*0.55,1);
    b.push('box',_m,[...color,alpha],0,null,81);
    cursor+=gap;
  }
  for(const ch of digits){
    const d=+ch;
    mat(b,_m,x+rx*cursor,y,z+rz*cursor,0,Math.atan2(fx,fz),0,size*0.62,size*0.62,1);
    b.push('quad1',_m,[...color,alpha],2,digitUV(d),80);
    cursor+=gap;
  }
}
