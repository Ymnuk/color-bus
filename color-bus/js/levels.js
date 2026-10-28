// ============================================================
// Levels — crowd "pictures" (rows front→back), 5-lane bus queues.
// Bus capacity is 2 or 3 (bus number = free seats). A round is
// solved when every little person boards a bus.
// ============================================================
import { randInt } from './math.js';

export const LEVELS = [
  { name:'Первые пассажиры',
    grid:['..RR....','.YY.RR..','BB.YY...','RR.BB...','.GG.GG..'],
    lanes:[
      [{color:0,cap:2,num:7},{color:1,cap:3,num:9},{color:3,cap:3,num:5}],
      [{color:3,cap:2,num:4},{color:0,cap:3,num:3}],
      [{color:2,cap:2,num:6},{color:1,cap:2,num:8}],
      [{color:0,cap:3,num:2},{color:2,cap:3,num:9}],
      [{color:3,cap:2,num:1},{color:0,cap:3,num:6}],
    ]},
  { name:'Разминка',
    grid:['PP......','.RR.....','..YY....','.PP.....','RR..YY..','BB.GG...'],
    lanes:[
      [{color:4,cap:2,num:5},{color:0,cap:3,num:8},{color:3,cap:3,num:2}],
      [{color:4,cap:2,num:6},{color:1,cap:2,num:9}],
      [{color:0,cap:2,num:3},{color:3,cap:2,num:7}],
      [{color:2,cap:2,num:4},{color:4,cap:3,num:1}],
      [{color:0,cap:3,num:9},{color:2,cap:3,num:5},{color:3,cap:2,num:8}],
    ]},
  { name:'Плотный поток',
    grid:['RR.BB...','GGBB....','..YYRR..','PPOOGG..','PP..OO..'],
    lanes:[
      [{color:0,cap:2,num:3},{color:1,cap:3,num:8},{color:2,cap:3,num:5}],
      [{color:4,cap:2,num:9},{color:3,cap:2,num:6},{color:5,cap:3,num:2}],
      [{color:4,cap:2,num:7},{color:0,cap:3,num:4}],
      [{color:5,cap:2,num:1},{color:2,cap:3,num:8}],
      [{color:3,cap:2,num:9},{color:1,cap:2,num:3},{color:5,cap:3,num:6}],
    ]},
];

const LETTERS={R:0,B:1,G:2,Y:3,P:4,O:5};
const LROW=['R','B','G','Y','P','O'];

// split n people of one color into buses of 2 and 3 seats
function split(n){
  const out=[]; let left=n;
  while(left>0){
    if(left>=3 && Math.random()<0.55){ out.push(3); left-=3; }
    else { out.push(2); left-=2; }
  }
  return out;
}

// random-but-solvable endless round: each color count divisible by 6
export function genEndlessRound(diff){
  const rows=Math.min(3+Math.floor(diff/6),5);
  const cols=4;
  const nc = diff<4?3:(diff<12?4:(diff<24?5:6));
  const counts=[];
  for(let i=0;i<nc;i++) counts.push(0);
  let total=0;
  const maxCells=rows*cols;
  // distribute cells in multiples of 6 per color, then top-up with 2/3 pairs
  while(total+6<=maxCells && counts.length){
    const i=randInt(0,nc-1);
    counts[i]+=6; total+=6;
    if(Math.random()<0.35) break;
  }
  // fill remaining space: add chunks of 6 to random colors while fits
  while(total+6<=maxCells){
    const i=randInt(0,nc-1); counts[i]+=6; total+=6;
  }
  const cells=[];
  counts.forEach((n,i)=>{ for(let j=0;j<n;j++) cells.push(i); });
  for(let i=cells.length-1;i>0;i--){ const j=randInt(0,i); [cells[i],cells[j]]=[cells[j],cells[i]]; }
  const grid=[];
  let idx=0;
  for(let r=0;r<rows;r++){
    let row='';
    for(let c=0;c<cols;c++) row += idx<cells.length ? LROW[cells[idx++]] : '.';
    grid.push(row);
  }
  const all=[];
  counts.forEach((n,colorIdx)=>{ for(const cap of split(n)) all.push({color:colorIdx,cap}); });
  for(let i=all.length-1;i>0;i--){ const j=randInt(0,i); [all[i],all[j]]=[all[j],all[i]]; }
  const lanes=[[],[],[],[],[]];
  all.forEach((b,i)=>lanes[i%5].push({...b,num:randInt(1,9)}));
  return {grid,lanes,name:'Раунд'};
}
