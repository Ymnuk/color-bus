// ============================================================
// Color Bus — round puzzle: a crowd "picture" of colored little
// people must be fully seated into buses. 5 parking lanes with
// queues of buses; the head bus of each lane can be released
// (tapped). It drives to the stop, matching reachable people run
// to it automatically; the player can also tap people to send
// them. A full bus departs on its own. Departing half-empty or
// a deadlock = lost round.
// ============================================================
import { M4, clamp, lerp, rand, randInt, transformPoint } from './math.js';
import { LEVELS, genEndlessRound } from './levels.js';

export const COLORS = [
  { name:'red',    hex:'#ff5b5b', rgb:[1.00,0.36,0.36] },
  { name:'blue',   hex:'#4aa3ff', rgb:[0.29,0.64,1.00] },
  { name:'green',  hex:'#3ddc84', rgb:[0.24,0.86,0.52] },
  { name:'yellow', hex:'#ffd23f', rgb:[1.00,0.82,0.25] },
  { name:'purple', hex:'#b072ff', rgb:[0.69,0.45,1.00] },
  { name:'orange', hex:'#ff9f43', rgb:[1.00,0.62,0.26] },
];

const LETTERS={R:0,B:1,G:2,Y:3,P:4,O:5};

export const GRID_COLS = 4;
export const ST_IDLE='idle', ST_RUN='run', ST_BOARD='board';

let uid=1;

export class Game {
  constructor(){
    this.persons=[]; this.buses=[]; this.fx=[];
    this.lanes=[[],[],[],[],[]];
    this.score=0; this.best=+(localStorage.getItem('colorbus_best')||0);
    this.state='menu'; this.time=0; this.diff=0;
    this.mode='campaign'; this.levelIdx=0;
    this.listeners={};
    this.padGrid=[]; this.reachSet=new Set();
    this.gridStr=['....','....','....'];
    this.layout();
  }
  on(ev,fn){ (this.listeners[ev]=this.listeners[ev]||[]).push(fn); }
  emit(ev,a){ for(const f of this.listeners[ev]||[]) f(a); }

  layout(){
    this.rows=Math.max(3,this.gridStr.length);
    this.GRID_ROWS=this.rows;
    this.CELL_W=1.7;
    this.CELL_H=Math.min(1.5,7.6/this.rows);
    this.PAD_CZ=4.4+(this.rows-3)*0.1;
    this.ROAD_Z=-2.0;
    this.LANE_GAP=1.95;
    this.LANE_Z=i=>this.ROAD_Z+1.55+i*this.LANE_GAP;
    this.STOP_X=2.2;
    this.SLOT_DX=4.4;
    this.MOVE_SPD=4.2;
  }
  cellPos(r,c){
    return [ (c-(GRID_COLS-1)/2)*this.CELL_W,
             this.PAD_CZ+(r-(this.rows-1)/2)*this.CELL_H ];
  }

  // ---------- rounds ----------
  startGame(mode){
    this.mode=mode; this.levelIdx=0; this.score=0; this.diff=0;
    this.emit('score',this.score);
    this.loadRound();
    this.state='play';
  }
  loadRound(){
    let def;
    if(this.mode==='campaign'&&this.levelIdx<LEVELS.length) def=LEVELS[this.levelIdx];
    else def=genEndlessRound(this.diff);
    this.roundName=def.name||('Раунд '+(this.levelIdx+1));
    this.gridStr=def.grid;
    this.layout();
    this.persons=[]; this.buses=[]; this.fx=[];
    this.padGrid=Array.from({length:this.rows},()=>new Array(GRID_COLS).fill(null));
    this.lanes=[[],[],[],[],[]];
    for(let r=0;r<this.rows;r++){
      const row=def.grid[r]||'';
      for(let c=0;c<GRID_COLS;c++){
        const ch=row[c]||'.';
        if(ch==='.') continue;
        const ci=LETTERS[ch]; if(ci===undefined) continue;
        const pos=this.cellPos(r,c);
        const p={ id:uid++, colorIdx:ci, state:ST_IDLE, cell:[r,c],
          pos:[...pos], home:[...pos], heading:Math.PI, phase:rand(0,6.28),
          target:null, boardSlot:0, scale:1, bt:0 };
        this.padGrid[r][c]=p; this.persons.push(p);
      }
    }
    for(let li=0;li<5;li++){
      const q=def.lanes[li]||[];
      q.forEach((d,i)=>{
        const b={ id:uid++, lane:li, slot:i, colorIdx:d.color, cap:d.cap, taken:0,
          num:d.num||randInt(1,9), seats:new Array(d.cap).fill(false),
          state:'queued', x:this.STOP_X+(i+1)*this.SLOT_DX, pullT:0, waitT:0, releaseT:0,
          wobble:rand(0,6.28), queue:[] };
        this.lanes[li].push(b); this.buses.push(b);
      });
    }
    this.recalcAll();
    this.totalPeople=this.persons.length;
    this.boarded=0;
    this.roundT=0; this.warnTick=0; this.deadlockT=0;
    this.emit('round',{name:this.roundName,idx:this.levelIdx});
  }
  nextLevel(){
    this.levelIdx++; this.diff++;
    this.loadRound();
  }

  // ---------- reachability (blocking picture) ----------
  occupied(r,c,self){
    if(c<0||c>=GRID_COLS) return false;   // side corridor free
    if(r>=this.rows) return false;        // past front row → road
    if(r<0) return true;                  // behind pad = wall
    const o=this.padGrid[r][c];
    return !!(o&&o!==self);
  }
  bfsToRoad(r0,c0,self){
    const seen=new Set([r0*GRID_COLS+c0]);
    let frontier=[[r0,c0]];
    while(frontier.length){
      const next=[];
      for(const [x,y] of frontier){
        for(const [nx,ny] of [[x+1,y],[x,y-1],[x,y+1],[x-1,y]]){
          if(ny<0||ny>=GRID_COLS) return true;
          if(nx>=this.rows) return true;
          if(nx<0) continue;
          if(this.occupied(nx,ny,self)) continue;
          const k=nx*GRID_COLS+ny;
          if(seen.has(k)) continue;
          seen.add(k); next.push([nx,ny]);
        }
      }
      frontier=next;
    }
    return false;
  }
  canExit(p){
    const [r,c]=p.cell;
    if(!this.occupied(r,c-1,p)||!this.occupied(r,c+1,p)||!this.occupied(r+1,c,p)){
      return this.bfsToRoad(r,c,p);
    }
    return false;
  }
  recalcAll(){
    this.reachSet=new Set();
    for(const p of this.persons)
      if(p.state===ST_IDLE&&p.cell&&this.canExit(p)) this.reachSet.add(p);
  }
  reachableOfColor(ci){
    return this.persons.filter(p=>p.state===ST_IDLE&&p.cell&&p.colorIdx===ci&&this.reachSet.has(p))
      .sort((a,z)=>a.cell[0]-z.cell[0]||a.cell[1]-z.cell[1]);
  }

  // ---------- dispatch ----------
  laneSpotFree(lane){
    return !this.lanes[lane].some(b=>b.state==='pulling'||b.state==='stopped');
  }
  dispatchLane(lane){
    if(this.state!=='play') return;
    const q=this.lanes[lane];
    if(!q.length){ this.emit('toast','В этом ряду нет автобусов'); return; }
    const head=q.find(b=>b.state==='queued');
    if(!head){
      if(q.some(b=>b.state==='pulling')) this.emit('toast','Автобус ещё выезжает…');
      return;
    }
    if(!this.laneSpotFree(lane)) return;
    head.state='pulling'; head.pullT=0; head.waitT=0;
    this.emit('dispatch-lane',lane);
  }

  sendToBus(p,b){
    const seat=b.seats.indexOf(false);
    if(seat<0) return false;
    b.seats[seat]=true; b.taken++;
    p.state=ST_RUN; p.target=b; p.boardSlot=seat;
    if(p.cell){ this.padGrid[p.cell[0]][p.cell[1]]=null; p.cell=null; }
    b.queue.push(p); p.queueIndex=b.queue.length-1;
    this.recalcAll();
    return true;
  }
  tryAutoBoard(b){
    if(b.taken>=b.cap) return;
    for(const p of this.reachableOfColor(b.colorIdx)){
      if(b.taken>=b.cap) break;
      this.sendToBus(p,b);
    }
  }

  tapAt(x,z){
    if(this.state!=='play') return;
    let best=null,bd=1e9;
    for(const p of this.persons){
      if(p.state!==ST_IDLE) continue;
      const d=Math.hypot(p.pos[0]-x,p.pos[1]-z);
      if(d<0.8&&d<bd){ bd=d; best=p; }
    }
    if(best){
      const bus=this.buses.find(b=>(b.state==='stopped'||(b.state==='pulling'&&b.pullT>0.9))
        &&b.colorIdx===best.colorIdx&&b.taken<b.cap);
      if(bus&&this.reachSet.has(best)){ this.sendToBus(best,bus); best.flashT=0.35; }
      else if(bus){ this.wiggle(best); this.emit('toast','Этот человечек заблокирован другими'); }
      else { this.wiggle(best); this.emit('toast','Нет подходящего автобуса на стоянке'); }
      return;
    }
    let bb=null,bbd=1e9;
    for(const b of this.buses){
      if(b.state==='leaving'||b.state==='gone') continue;
      const bz=this.LANE_Z(b.lane);
      if(Math.abs(b.x-x)<2.3&&Math.abs(bz-z)<1.0){
        const d=Math.abs(b.x-x)+Math.abs(bz-z);
        if(d<bbd){ bbd=d; bb=b; }
      }
    }
    if(bb){
      if(bb.state==='queued'){
        const head=this.lanes[bb.lane].find(x2=>x2.state==='queued');
        if(head===bb) this.dispatchLane(bb.lane);
        else this.emit('toast','Сначала выпустите тот, что впереди!');
      } else if(bb.state==='stopped'){
        if(bb.taken>=bb.cap){ bb.releaseT=0.5; }
        else this.emit('toast','Не хватает пассажиров ('+bb.taken+'/'+bb.cap+')');
      }
    }
  }
  wiggle(p){ p.wigT=0.4; }

  // ---------- game over ----------
  gameOver(reason){
    if(this.state!=='play') return;
    this.state='over';
    const rec=this.score>this.best;
    if(rec){ this.best=this.score; localStorage.setItem('colorbus_best',String(this.best)); }
    this.emit('gameover',{score:this.score,best:this.best,record:rec,reason});
  }
  addScore(n){
    this.score+=n;
    this.emit('score',this.score);
    if(this.score>this.best){ this.best=this.score; localStorage.setItem('colorbus_best',String(this.best)); this.emit('best',this.best); }
  }

  // ---------- update ----------
  update(dt){
    this.time+=dt;
    if(this.state==='menu'){ this.updateBuses(dt,true); return; }
    if(this.state==='celebrate'){
      this.celebT+=dt;
      this.updateBuses(dt,false);
      if(this.celebT>1.5){ this.state='play'; this.nextLevel(); }
      return;
    }
    if(this.state!=='play') return;
    this.roundT+=dt;

    // deadlock detection
    const moving=this.persons.some(p=>p.state!==ST_IDLE)||
      this.buses.some(b=>b.state==='pulling'||b.state==='stopped'||b.state==='leaving');
    let progress=false;
    if(moving) progress=true;
    else{
      for(const b of this.buses){
        if(b.state==='queued'&&this.reachableOfColor(b.colorIdx).length>0){ progress=true; break; }
      }
      if(!progress&&this.buses.every(b=>b.state==='gone')) progress=true; // handled as clear
    }
    if(!progress){
      this.deadlockT+=dt;
      if(this.deadlockT>1.8) this.gameOver('Тупик: никто не может выйти, а пустые автобусы не уедут');
    } else this.deadlockT=0;

    // periodic hint
    const docked=this.buses.filter(b=>b.state==='stopped'&&b.taken<b.cap);
    if(docked.length&&this.persons.length){
      this.warnTick+=dt;
      if(this.warnTick>9){ this.warnTick=0; this.emit('toast','Выпустите ряд с автобусом нужного цвета или тапните человечков'); }
    }

    this.updateBuses(dt,false);

    for(const p of this.persons){
      if(p.flashT) p.flashT=Math.max(0,p.flashT-dt);
      if(p.wigT) p.wigT=Math.max(0,p.wigT-dt);
      if(p.state===ST_RUN&&p.target){
        const b=p.target;
        const door=this.doorWorld(b);
        const spot=this.queueSpot(b,p.queueIndex||0);
        const front=(p.queueIndex||0)===0;
        const tx=front?door[0]:spot[0], tz=front?door[1]:spot[1];
        const dx=tx-p.pos[0], dz=tz-p.pos[1];
        const d=Math.hypot(dx,dz);
        if(front&&d<0.28&&b.state==='stopped'){ p.state=ST_BOARD; p.bt=0; }
        else if(d>0.03){
          const sp=this.MOVE_SPD;
          p.pos[0]+=dx/d*Math.min(sp*dt,d); p.pos[1]+=dz/d*Math.min(sp*dt,d);
          p.heading=Math.atan2(dx,dz);
          p.runPhase=(p.runPhase||0)+dt*11;
        }
      } else if(p.state===ST_BOARD){
        p.bt+=dt;
        p.scale=clamp(1-(p.bt/0.4),0.05,1);
        if(p.bt>0.4){
          p.gone=true; this.boarded++;
          const b=p.target;
          if(b){
            b.seats[p.boardSlot]=false;
            const qi=b.queue.indexOf(p);
            if(qi>=0){ b.queue.splice(qi,1); b.queue.forEach((q,i)=>{q.queueIndex=i;}); }
          }
          this.recalcAll();
        }
      }
    }
    this.persons=this.persons.filter(p=>!p.gone);

    // round cleared?
    if(this.persons.length===0&&this.boarded>=this.totalPeople){
      const bonus=50+Math.max(0,Math.round(40-this.roundT))*2;
      this.lastBonus=bonus;
      this.addScore(bonus);
      this.emit('roundClear',{bonus,name:this.roundName});
      this.state='celebrate'; this.celebT=0;
    }
    this.updateFx(dt);
  }

  doorWorld(b){ return [b.x-0.35,this.LANE_Z(b.lane)+0.95]; }
  queueSpot(b,i){ const d=this.doorWorld(b); return [d[0],d[1]+0.7+i*0.72]; }

  updateBuses(dt,menu){
    for(const b of this.buses){
      b.wobble+=dt*8;
      if(menu){ b.x-=dt*7; if(b.x<-30) b.x=rand(30,60); continue; }
      if(b.state==='pulling'){
        b.pullT+=dt;
        const k=clamp(b.pullT/1.15,0,1);
        b.x=lerp(this.STOP_X+(b.slot+1)*this.SLOT_DX,this.STOP_X,k*k*(3-2*k));
        if(b.pullT>0.9) this.tryAutoBoard(b);
        if(b.pullT>=1.15){ b.state='stopped'; b.waitT=0; this.tryAutoBoard(b); }
      } else if(b.state==='stopped'){
        this.tryAutoBoard(b);
        if(b.taken>=b.cap){ b.releaseT+=dt; if(b.releaseT>0.5){ b.state='leaving'; this.emit('depart',b); } }
        else b.releaseT=0;
      } else if(b.state==='leaving'){
        b.x-=dt*11;
        if(b.x<-26){
          b.state='gone';
          if(b.taken>=b.cap){
            const pts=b.cap*10+5;
            this.addScore(pts);
            this.fx.push({type:'text',txt:'+'+pts,x:0,y:2.2,z:this.LANE_Z(b.lane),t:-0.2});
          } else {
            this.emit('failBus',b);
            this.gameOver('Автобус уехал полупустым — раунд провален');
          }
        }
      }
    }
  }
  updateFx(dt){
    for(const f of this.fx){ f.t+=dt; if(f.t>1.3) f.dead=true; }
    this.fx=this.fx.filter(f=>!f.dead);
  }

  // menu attract data
  initMenuDemo(){
    this.gridStr=['RR.BB...','.YY.GG..','PP.OO...'];
    this.layout();
    this.persons=[]; this.buses=[]; this.fx=[];
    this.padGrid=Array.from({length:this.rows},()=>new Array(GRID_COLS).fill(null));
    this.lanes=[[],[],[],[],[]];
    for(let r=0;r<this.rows;r++)for(let c=0;c<GRID_COLS;c++){
      const ch=(this.gridStr[r]||'')[c]||'.'; if(ch==='.')continue;
      const ci=LETTERS[ch]; if(ci===undefined)continue;
      const pos=this.cellPos(r,c);
      const p={id:uid++,colorIdx:ci,state:ST_IDLE,cell:[r,c],pos:[...pos],home:[...pos],
        heading:Math.PI,phase:rand(0,6.28),target:null,boardSlot:0,scale:1,bt:0};
      this.padGrid[r][c]=p; this.persons.push(p);
    }
    for(let i=0;i<4;i++){
      const b={id:uid++,lane:i%5,slot:9,colorIdx:randInt(0,5),cap:3,taken:0,num:randInt(1,9),
        seats:[false,false,false],state:'menu',pullT:0,waitT:0,releaseT:0,
        x:12+i*9,wobble:rand(0,6.28),queue:[]};
      this.buses.push(b);
    }
    this.recalcAll();
  }

  pickGround(camera, sx, sy, cssW, cssH){
    const pv=M4.create(); M4.multiply(pv,camera.proj,camera.view);
    const inv=M4.invert(M4.create(),pv);
    if(!inv) return null;
    const ndcX=(sx/cssW)*2-1, ndcY=-((sy/cssH)*2-1);
    const near=transformPoint(inv,[ndcX,ndcY,-1]);
    const far =transformPoint(inv,[ndcX,ndcY, 1]);
    const dx=far[0]-near[0], dy=far[1]-near[1], dz=far[2]-near[2];
    if(Math.abs(dy)<1e-6) return null;
    const t=(0-near[1])/dy;
    if(t<0) return null;
    return [near[0]+dx*t, near[2]+dz*t];
  }
}
