// ============================================================
// Procedural 3D model factory — generates geometry for:
//  box, rounded bus body, wheels, windows, person (capsule),
//  road plane, shadow disc, gate arch, sign pole, tree.
// Each mesh = { vertices:Float32Array(pos xyz + normal xyz), indices:Uint16Array }
// ============================================================

class MeshBuilder {
  constructor(){ this.pos=[]; this.nrm=[]; this.idx=[]; }
  vert(p,n){ this.pos.push(p[0],p[1],p[2]); this.nrm.push(n[0],n[1],n[2]); return this.idx/1? (this.pos.length/3 -1):0; }
  get vcount(){ return this.pos.length/3; }
  tri(a,b,c){ this.idx.push(a,b,c); }
  quad(p0,p1,p2,p3,n){
    const i=this.vcount;
    for(const p of [p0,p1,p2,p3]) this.pos.push(p[0],p[1],p[2]), this.nrm.push(n[0],n[1],n[2]);
    this.idx.push(i,i+1,i+2, i,i+2,i+3);
  }
  build(){
    const n=this.pos.length/3;
    const out=new Float32Array(n*6);
    for(let i=0;i<n;i++){ out[i*6]=this.pos[i*3]; out[i*6+1]=this.pos[i*3+1]; out[i*6+2]=this.pos[i*3+2];
      out[i*6+3]=this.nrm[i*3]; out[i*6+4]=this.nrm[i*3+1]; out[i*6+5]=this.nrm[i*3+2]; }
    return { vertices:out, indices:new Uint16Array(this.idx) };
  }
}

// --- Box centered at origin with size s=[w,h,d] ---
export function makeBox(s){
  const [w,h,d]=s, x=w/2,y=h/2,z=d/2, b=new MeshBuilder();
  b.quad([-x,-y, z],[ x,-y, z],[ x, y, z],[-x, y, z],[0,0,1]);   // front
  b.quad([ x,-y,-z],[-x,-y,-z],[-x, y,-z],[ x, y,-z],[0,0,-1]);  // back
  b.quad([ x,-y, z],[ x,-y,-z],[ x, y,-z],[ x, y, z],[1,0,0]);   // right
  b.quad([-x,-y,-z],[-x,-y, z],[-x, y, z],[-x, y,-z],[-1,0,0]);  // left
  b.quad([-x, y, z],[ x, y, z],[ x, y,-z],[-x, y,-z],[0,1,0]);   // top
  b.quad([-x,-y,-z],[ x,-y,-z],[ x,-y, z],[-x,-y, z],[0,-1,0]);  // bottom
  return b.build();
}

// --- Rounded-corner extruded shape (for bus side profile in XY, extruded along Z) ---
function roundedRectProfile(pts, radius, segs=4){
  // pts: closed polygon [x,y]; returns array of outline points with corner arcs
  const out=[]; const n=pts.length;
  for(let i=0;i<n;i++){
    const prev=pts[(i-1+n)%n], cur=pts[i], next=pts[(i+1)%n];
    const v1=[cur[0]-prev[0],cur[1]-prev[1]], v2=[next[0]-cur[0],next[1]-cur[1]];
    const l1=Math.hypot(...v1), l2=Math.hypot(...v2);
    const u1=[v1[0]/l1,v1[1]/l1], u2=[v2[0]/l2,v2[1]/l2];
    const r=Math.min(radius, l1/2, l2/2);
    const a=[cur[0]-u1[0]*r, cur[1]-u1[1]*r];
    const c2=[cur[0]+u2[0]*r, cur[1]+u2[1]*r];
    // arc center approx: intersection offset — use cur pushed inward
    const bis=[(u2[0]-u1[0]),(u2[1]-u1[1])];
    const bl=Math.hypot(...bis)||1;
    const cx=cur[0]-bis[0]/bl*(r*1.35), cy=cur[1]-bis[1]/bl*(r*1.35);
    const a0=Math.atan2(a[1]-cy,a[0]-cx), a1=Math.atan2(c2[1]-cy,c2[0]-cx);
    let da=a1-a0; while(da<-Math.PI)da+=2*Math.PI; while(da>Math.PI)da-=2*Math.PI;
    for(let j=0;j<=segs;j++){
      const t=a0+da*(j/segs);
      out.push([cx+Math.cos(t)*r*1.28, cy+Math.sin(t)*r*1.28]);
    }
  }
  return out;
}

// Extrude 2D outline along Z with flat caps + smooth-ish sides. Centered.
function extrudePolygon(b, outline, depth){
  const m=outline.length, half=depth/2;
  // side walls
  for(let i=0;i<m;i++){
    const j=(i+1)%m;
    const p0=[outline[i][0],outline[i][1],-half], p1=[outline[j][0],outline[j][1],-half];
    const p2=[outline[j][0],outline[j][1], half], p3=[outline[i][0],outline[i][1], half];
    const ex=p1[0]-p0[0], ey=p1[1]-p0[1]; const el=Math.hypot(ex,ey)||1;
    const n=[ey/el,-ex/el,0];
    b.quad(p0,p1,p2,p3,n);
  }
  // caps (fan triangulation around centroid)
  let cx=0,cy=0; for(const p of outline){cx+=p[0];cy+=p[1];} cx/=m; cy/=m;
  const ciC=b.vcount;
  b.pos.push(cx,cy,half); b.nrm.push(0,0,1);
  for(let i=0;i<m;i++){
    const j=(i+1)%m;
    const vi=b.vcount;
    b.pos.push(outline[i][0],outline[i][1],half); b.nrm.push(0,0,1);
    b.pos.push(outline[j][0],outline[j][1],half); b.nrm.push(0,0,1);
    b.tri(ciC,vi,vi+1);
  }
  const ciB=b.vcount;
  b.pos.push(cx,cy,-half); b.nrm.push(0,0,-1);
  for(let i=0;i<m;i++){
    const j=(i+1)%m;
    const vi=b.vcount;
    b.pos.push(outline[i][0],outline[i][1],-half); b.nrm.push(0,0,-1);
    b.pos.push(outline[j][0],outline[j][1],-half); b.nrm.push(0,0,-1);
    b.tri(ciB,vi+1,vi);
  }
}

// --- Bus body: rounded cabin profile (side view, X forward, Y up), extruded along Z(width) ---
export function makeBusBody(len=3.4, height=1.5, width=1.5){
  const b=new MeshBuilder();
  const L=len, H=height, r=0.32;
  const prof=[
    [-L/2, 0.28],            // rear bottom
    [-L/2, H-r],             // rear up
    [-L/2+r*0.6, H],         // roof rear
    [L/2-r*0.7, H],          // roof front
    [L/2, H*0.72],           // windshield slope top-front
    [L/2, 0.34],             // nose bottom
  ];
  const outline=roundedRectProfile(prof, r, 5);
  extrudePolygon(b, outline, width);
  const m=b.build();
  // shift so that vertical origin sits on wheel line (bottom at y=0)
  return m;
}

// --- Cylinder (wheels, poles) axis along given dir; here axis = Z or Y ---
export function makeCylinder(radius, height, segs=18, axis='y'){
  const b=new MeshBuilder();
  const h=height/2;
  const ringTop=[], ringBot=[];
  for(let i=0;i<segs;i++){
    const t=i/segs*Math.PI*2, c=Math.cos(t), s=Math.sin(t);
    let pT,pB,n;
    if(axis==='y'){ pT=[c*radius,h,s*radius]; pB=[c*radius,-h,s*radius]; n=[c,0,s]; }
    else { pT=[h,c*radius,s*radius]; pB=[-h,c*radius,s*radius]; n=[0,c,s]; }
    ringTop.push(b.vert(pT,n)); ringBot.push(b.vert(pB,n));
  }
  for(let i=0;i<segs;i++){
    const j=(i+1)%segs;
    b.tri(ringBot[i],ringBot[j],ringTop[j]); b.tri(ringBot[i],ringTop[j],ringTop[i]);
  }
  const ct=b.vert(axis==='y'?[0,h,0]:[h,0,0], axis==='y'?[0,1,0]:[1,0,0]);
  const cb=b.vert(axis==='y'?[0,-h,0]:[-h,0,0], axis==='y'?[0,-1,0]:[-1,0,0]);
  for(let i=0;i<segs;i++){ const j=(i+1)%segs;
    b.tri(ct,ringTop[i],ringTop[j]); b.tri(cb,ringBot[j],ringBot[i]); }
  return b.build();
}

// --- Capsule (person torso/head): sphere-capped cylinder along Y ---
export function makeCapsule(radius, height, segs=14, rings=8){
  const b=new MeshBuilder();
  const cylH=height-radius*2;
  const grid=[];
  // top hemisphere
  for(let i=0;i<=rings;i++){
    const t=(i/rings)*(Math.PI/2); // 0..pi/2 from top
    const row=[];
    for(let j=0;j<segs;j++){
      const a=j/segs*Math.PI*2;
      const n=[Math.sin(t)*Math.cos(a), Math.cos(t), Math.sin(t)*Math.sin(a)];
      const y=cylH/2 + radius*Math.cos(t);
      const rr=radius*Math.sin(t);
      row.push(b.vert([rr*Math.cos(a), y, rr*Math.sin(a)], n));
    }
    grid.push(row);
  }
  // cylinder + bottom hemisphere rows
  const rows=[ [cylH/2,0], [cylH/2,Math.PI/2], [-cylH/2,Math.PI/2], [-cylH/2,Math.PI] ];
  // simpler: continue lat/long over full sphere range mapped
  const total=rings*2;
  for(let i=rings+1;i<=total+1;i++){
    const t=((i-1)/total)*Math.PI; // pi/2..pi
    const row=[];
    const st=Math.sin(t), ct2=Math.cos(t);
    for(let j=0;j<segs;j++){
      const a=j/segs*Math.PI*2;
      const n=[st*Math.cos(a), ct2, st*Math.sin(a)];
      const y=(ct2>=0? cylH/2 : -cylH/2) + radius*ct2;
      row.push(b.vert([radius*st*Math.cos(a), y, radius*st*Math.sin(a)], n));
    }
    grid.push(row);
  }
  for(let i=0;i<grid.length-1;i++){
    for(let j=0;j<segs;j++){
      const k=(j+1)%segs;
      b.tri(grid[i][j],grid[i+1][k],grid[i+1][j]);
      b.tri(grid[i][j],grid[i][k],grid[i+1][k]);
    }
  }
  return b.build();
}

// --- Sphere ---
export function makeSphere(radius, segs=16, rings=10){
  const b=new MeshBuilder(); const grid=[];
  for(let i=0;i<=rings;i++){
    const t=(i/rings)*Math.PI, st=Math.sin(t), ct=Math.cos(t), row=[];
    for(let j=0;j<segs;j++){
      const a=j/segs*Math.PI*2;
      const n=[st*Math.cos(a),ct,st*Math.sin(a)];
      row.push(b.vert([radius*n[0],radius*n[1],radius*n[2]],n));
    }
    grid.push(row);
  }
  for(let i=0;i<rings;i++)for(let j=0;j<segs;j++){
    const k=(j+1)%segs;
    b.tri(grid[i][j],grid[i+1][k],grid[i+1][j]);
    b.tri(grid[i][j],grid[i][k],grid[i+1][k]);
  }
  return b.build();
}

// --- Plane (ground / road) XZ, size w x d, optional upward normal ---
export function makePlane(w,d){
  const b=new MeshBuilder();
  b.quad([-w/2,0,-d/2],[-w/2,0,d/2],[w/2,0,d/2],[w/2,0,-d/2],[0,1,0]);
  return b.build();
}

// --- Torus-like flat disc (shadow blob) ---
export function makeDisc(radius, segs=24){
  const b=new MeshBuilder(); const c=b.vert([0,0,0],[0,1,0]);
  const ring=[];
  for(let i=0;i<segs;i++){ const a=i/segs*Math.PI*2;
    ring.push(b.vert([Math.cos(a)*radius,0,Math.sin(a)*radius],[0,1,0])); }
  for(let i=0;i<segs;i++){ const j=(i+1)%segs; b.tri(c,ring[j],ring[i]); }
  return b.build();
}

// --- Dashed road stripe set baked into one mesh (X direction road) ---
export function makeStripes(length, dashLen, gap, width, count){
  const b=new MeshBuilder();
  const step=dashLen+gap;
  const start=-((count-1)*step)/2;
  for(let i=0;i<count;i++){
    const cx=start+i*step;
    if(Math.abs(cx)>length/2) continue;
    b.quad([cx-width/2,0.012,cx===start?-dashLen/2:-dashLen/2],[0,0,0],[0,0,0],[0,0,0],[0,1,0]); // placeholder no-op
  }
  // rebuild properly as thin boxes on ground
  const bb=new MeshBuilder();
  for(let i=0;i<count;i++){
    const cx=start+i*step;
    if(Math.abs(cx)+dashLen/2>length/2) continue;
    const p0=[cx-dashLen/2,0.012,-width/2], p1=[cx+dashLen/2,0.012,-width/2],
          p2=[cx+dashLen/2,0.012,width/2],  p3=[cx-dashLen/2,0.012,width/2];
    bb.quad(p0,p1,p2,p3,[0,1,0]);
  }
  return bb.build();
}

// --- All models dictionary ---
export function buildModels(){
  return {
    box:        makeBox([1,1,1]),
    busBody:    makeBusBody(),
    wheel:      makeCylinder(0.34,0.3,16,'z'),
    hub:        makeCylinder(0.16,0.34,12,'z'),
    window:     makeBox([0.9,0.62,0.06]),
    windshield: makeBox([0.08,0.7,1.2]),
    light:      makeBox([0.1,0.16,0.26]),
    plate:      makeBox([0.5,0.42,0.06]),
    bumper:     makeBox([3.5,0.18,1.55]),
    mirror:     makeBox([0.12,0.3,0.08]),
    head:       makeSphere(0.24,14,8),
    torso:      makeCapsule(0.19,0.62,12,5),
    legs:       makeBox([0.3,0.34,0.18]),
    arm:        makeCapsule(0.07,0.34,8,3),
    ground:     makePlane(120,120),
    road:       makePlane(120,7),
    sidewalk:   makePlane(120,3.4),
    curb:       makeBox([120,0.18,0.3]),
    stopPad:    makeBox([9,0.1,7]),
    padInner:   makeBox([8.2,0.11,6.2]),
    shadow:     makeDisc(0.55,20),
    busShadow:  makeDisc(1,24),
    stripes:    makeStripes(120,2.2,1.6,0.22,40),
    pole:       makeCylinder(0.09,3.2,10,'y'),
    signBoard:  makeBox([1.1,0.8,0.08]),
    archPost:   makeBox([0.5,3.2,0.5]),
    archTop:    makeBox([9,0.5,0.5]),
    trunk:      makeCylinder(0.22,1.2,10,'y'),
    foliage:    makeSphere(1.05,12,8),
    cloud:      makeSphere(1,10,6),
    bush:       makeSphere(0.6,10,6),
    antenna:    makeCylinder(0.03,0.5,6,'y'),
    door:       makeBox([0.05,1.0,0.7]),
  };
}
