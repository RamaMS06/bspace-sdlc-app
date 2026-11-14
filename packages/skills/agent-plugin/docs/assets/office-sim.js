// Agent Office preview — shared sample scenario, state, side panels and pixel art. The page only
// supplies draw(); world coordinates are canvas pixels (384×216). Colours are token names from office.css.
const trackEl=document.getElementById('track'),unitsEl=document.getElementById('units'),needsEl=document.getElementById('needs'),logEl=document.getElementById('log'),itersEl=document.getElementById('iters');
const ROOMS=[
 {k:'brainstorm',n:'1 Brainstorm',f:'intent.md · G1',x:0,w:64},
 {k:'design',n:'2 Design',f:'design.md · C1 G2',x:64,w:72},
 {k:'slice',n:'3 Slice',f:'spec.md · score.json',x:136,w:120},
 {k:'verify',n:'4 Run-verify',f:'plan.md run:',x:256,w:64},
 {k:'close',n:'5 Close',f:'close.md',x:320,w:64}];
// roles stay neutral (same sprite, name label); only status gets colour
const ROLE={manager:{n:'Manager'},analyst:{n:'Analyst'},designer:{n:'Designer'},dev:{n:'Dev'},
 vue:{n:'Dev Vue'},qa:{n:'QA'},lead:{n:'Lead'},verifier:{n:'Verifier'}};
// desk anchor = left end of the desk top; the worker stands at x+5 behind it
const D={analyst:[30,62],designer:[100,62],f1:[158,50],f2:[196,50],f3:[234,50],vue:[196,90],qa:[288,62],lead:[352,62],mgr:[56,168]};
const PANTRY=[[300,192],[314,202],[328,190],[342,200],[356,192],[370,204],[322,210],[350,212],[336,178],[364,180]];
// ART — token lookup (C.bg → '#000F19'), pixel sprite, floor; drawn into 3D textures
const C=new Proxy({},{get:(o,k)=>o[k]||(o[k]=getComputedStyle(document.documentElement).getPropertyValue('--'+k).trim())});
const SPR=["..hhhh..",".hhhhhh.",".hssssh.",".sesses.","..ssss..",".ccaacc.","sccaaccs","s.cccc.s","..cccc..","..pppp.."];
const BACK=SPR.map((row,j)=>j>=2&&j<=4?row.replace(/[se]/g,'h'):row);
const LEG=[["..p..p..","..k..k.."],[".p....p.","k......k"]];
// phase → status token; bubble kind → [fill, text]
const TONE={todo:null,active:'accent',done:'ok',blocked:'bad'};
const BUB={plain:['neutral-100','neutral-800'],warn:['warning-500','neutral-800'],err:['danger-500','neutral-0'],blocked:['danger-600','neutral-0'],ok:['success-500','neutral-0']};
function bubbleOf(c,t){if(c.say&&t<c.sayUntil)return{s:c.say,k:'plain'};
 if(c.path.length)return null;
 if(c.mode==='type')return{s:'.'.repeat(1+(t*3|0)%3),k:'plain'};
 if(c.mode==='ask')return{s:'? you',k:'warn'};
 if(c.mode==='alert')return(t*3|0)%2?{s:'! NEEDS YOU',k:'err'}:null;
 if(c.mode==='err')return{s:'✗ '+c.err,k:'err'};
 if(c.mode==='blocked')return{s:'✗ BLOCKED',k:'blocked'};
 if(c.mode==='done')return{s:'✓',k:'ok'};return null;}
// status → token; shows on the shirt and the desk screen
function toneOf(c,t){return c.mode==='type'?'accent':c.mode==='ask'?'warn':c.mode==='alert'?((t*3|0)%2?'bad':null):c.mode==='err'||c.mode==='blocked'?'bad':c.mode==='done'?'ok':null;}
function screenTone(k,t){const o=Object.values(chars).find(c=>c.desk===k&&!c.path.length);return o?toneOf(o,t):null;}
function palOf(c,t){return{h:'hair',s:'skin',e:'neutral-800',c:'body',a:(!c.path.length&&toneOf(c,t))||'body-2',p:'body-2',k:'grey-850'};}
function paintSprite(g,x,y,c,t,f,back){const p=palOf(c,t);
 (back?BACK:SPR).concat(LEG[f]).forEach((row,j)=>{for(let i=0;i<8;i++)if(row[i]!=='.'){g.fillStyle=C[p[row[i]]];g.fillRect(x+i,y+j,1,1);}});}
// neutral 8px checker, status tint on top
function paintFloor(g,x,y,w,h,st){for(let i=0;i<w;i+=8)for(let j=0;j<h;j+=8){g.fillStyle=C[((i+j)/8)%2?'sunken':'surface'];g.fillRect(x+i,y+j,Math.min(8,w-i),Math.min(8,h-j));}
 if(TONE[st]){g.fillStyle=C[TONE[st]+'-soft'];g.fillRect(x,y,w,h);}}
function update(){for(const c of Object.values(chars)){if(!c.path.length)continue;
 const [tx,ty]=c.path[0],dx=tx-c.x,dy=ty-c.y,d=Math.hypot(dx,dy);
 if(d<=1.8){c.x=tx;c.y=ty;c.path.shift();if(!c.path.length&&c.gone)delete chars[c.id];}else{c.x+=dx/d*1.8;c.y+=dy/d*1.8;}}}
let chars,phase,units,iters,ev,now,T0,pi,SCRIPT,LOOP,variant='happy';
function add(id,role,x,y,label){chars[id]={id,r:ROLE[role],x,y,path:[],mode:'idle',label,desk:null};}
function go(id,dest){const c=chars[id];c.path=[[c.x,126],[dest[0],126],dest];}
function toDesk(id,k,m){const c=chars[id];c.desk=k;c.mode=m;go(id,[D[k][0]+5,D[k][1]+2]);}
function toPantry(id){const c=chars[id];c.desk=null;c.mode='done';go(id,PANTRY[pi++%PANTRY.length]);}
function spawn(id,role,label,desk){add(id,role,D.mgr[0]+5,D.mgr[1]+14,label);toDesk(id,desk,'type');}
function mode(id,m,err){chars[id].mode=m;chars[id].err=err;}
// verifier: fresh worker per failed score, stands beside the desk, writes verify.md, leaves
function verify(desk,s){const id='vf'+desk;add(id,'verifier',D.mgr[0]+5,D.mgr[1]+14,'');const c=chars[id];
 c.mode='type';go(id,[D[desk][0]-17,D[desk][1]+2]);say(id,s,3.5);}
function leave(id){const c=chars[id];if(!c)return;c.gone=true;c.desk=null;go(id,[D.mgr[0]+5,D.mgr[1]+14]);}
function iter(unit,s,k){(iters[unit]=iters[unit]||[]).push([s,k]);renderUI();}
function say(id,s,dur){chars[id].say=s;chars[id].sayUntil=now+dur;}
const cls=s=>s==='done'?'done':s==='needs-context'||s==='blocked'?'needs':s==='awaiting-human'?'human':'run';
function setUnit(id,p){let u=units.find(u=>u.id===id);if(!u){u={id,metric:null,note:'',ask:''};units.push(u);}Object.assign(u,p);renderUI();}
function renderUI(){
 trackEl.innerHTML=ROOMS.map(r=>`<span class="${phase[r.k]}">${phase[r.k]==='done'?'✓ ':phase[r.k]==='blocked'?'✗ ':''}${r.n}</span>`).join('');
 unitsEl.innerHTML='<tr><th>Unit</th><th>Who</th><th>Status</th><th>Metric</th></tr>'+units.map(u=>`<tr><td>${u.id}</td><td>${u.who}</td><td><span class="badge st-${cls(u.status)}">${u.status}</span></td><td>${u.metric==null?(u.note||'—'):`<span class="bar"><i style="width:${u.metric}%;background:${u.metric>=98?'var(--ok)':u.metric<60?'var(--bad)':'var(--accent)'}"></i></span> <span class="num">${u.metric}%</span>`}</td></tr>`).join('');
 const n=units.filter(u=>u.ask);needsEl.textContent=n.length?'Needs you: '+n.map(u=>u.id+' — '+u.ask).join(' · '):'';
 itersEl.innerHTML=Object.keys(iters).map(u=>`<div>${u}: ${iters[u].map(([s,k])=>`<i class="k-${k}">${s}</i>`).join('→')}</div>`).join('')||'—';}
function log(who,s,e){logEl.insertAdjacentHTML('afterbegin',`<li${e?' class="e"':''}><time>00:${String(now|0).padStart(2,'0')}</time><b>${who}</b> ${s}</li>`);}

// SCENARIO — sample run; the real viewer derives the same events from intent/ files and progress.md
const next=(k,s)=>{say('mgr','next: '+s,2.5);phase[k]='active';log('Manager','next: '+s);renderUI();};
const fin=(k,id,unit,note)=>{phase[k]='done';setUnit(unit,{status:'done',note,ask:''});toPantry(id);log(chars[id].r.n,unit+' '+note);};
// fidelity round: <98% → exit 1 (verifier next), ≥98% → exit 0
const fid=(unit,r,m,note)=>{setUnit(unit,{metric:m});iter(unit,'r'+r+' '+m+'%'+(note||''),m>=98?'ok':note?'bad':'run');log('Dev',unit+' r'+r+' fidelity '+m+'%'+(note||''));};
// gate fail: red bubble on the worker, red log line, red chip in ITERATIONS
const fail=(id,unit,chip,msg)=>{mode(id,'err',chip);iter(unit,chip,'bad');log(chars[id].r.n,unit+' '+msg,1);};
const COMMON=[
 [0.5,()=>next('brainstorm','1 Brainstorm — no intent.md')],
 [1.2,()=>{spawn('an','analyst','intent','analyst');setUnit('intent',{who:'Analyst',status:'running',note:'Q&A'});iter('intent','Q1–Q5','run');}],
 [3,()=>fail('an','intent','G1 ✗','G1 fail: 1 [NEEDS CLARIFICATION] — saldo cuti 0?')],
 [4.5,()=>{mode('an','ask');setUnit('intent',{status:'awaiting-human',ask:'saldo cuti 0 → boleh submit?'});iter('intent','ask user','info');}],
 [6.5,()=>{say('an','approved',1.5);iter('intent','G1 ✓','ok');fin('brainstorm','an','intent','G1 pass');}],
 [7.5,()=>next('design','2 Design — no design.md')],
 [8.2,()=>{spawn('ds','designer','design','designer');setUnit('design',{who:'Designer',status:'running',note:'component plan'});iter('design','C1 ✓','ok');}],
 [10.5,()=>fail('ds','design','GD2 ✗','GD2 fail: 2 hard-coded colour, 1 text no DS style')],
 [12,()=>{mode('ds','type');iter('design','fix → GD2 ✓','ok');log('Designer','design fix 3 nodes → GD2 pass');}],
 [13,()=>{mode('ds','ask');setUnit('design',{status:'awaiting-human',ask:'designer review (GD3)'});iter('design','review','info');}],
 [15.5,()=>{say('ds','reviewed',1.5);iter('design','G2 ✓','ok');fin('design','ds','design','G2 pass');}],
 [16.5,()=>next('slice','3 Slice — SDD × 4 units')],
 [17.1,()=>{spawn('d1','dev','header','f1');spawn('d2','dev','balance','f2');spawn('d3','dev','form','f3');spawn('vu','vue','web','vue');
  ['header','balance','form'].forEach(u=>setUnit(u,{who:'Dev',status:'running'}));setUnit('web',{who:'Dev Vue',status:'running',note:'plan.md'});}],
 [20,()=>{fid('header',1,72);fid('balance',1,64);fid('form',1,55);
  verify('f2','verify: badge −8px');verify('f3','verify: logo = text?');
  fail('vu','web','validate ✗','validate-slice.sh exit 1: 2 Coverage rows missing');}],
 [22.5,()=>{leave('vff2');leave('vff3');mode('vu','type');iter('web','fix → validate ✓','ok');log('Dev Vue','web Coverage fixed → validate pass');}],
 [24,()=>{fid('header',2,91);fid('balance',2,85);fid('form',2,58);}],
 [26,()=>{mode('vu','ask');setUnit('web',{status:'awaiting-human',ask:'web: approve plan (step 15)'});iter('web','ask user','info');}],
 [27,()=>{fid('header',3,98.6);setUnit('header',{status:'done'});toPantry('d1');fid('balance',3,93);fid('form',3,58.2,' no progress');}],
 [28.5,()=>{iter('web','approved → .vue ✓','ok');setUnit('web',{status:'done',ask:'',note:'lint ✓'});toPantry('vu');}],
 [30,()=>{fid('balance',4,98.2);setUnit('balance',{status:'done'});toPantry('d2');
  fid('form',4,58.3,' no progress');mode('d3','alert');iter('form','exit 4 STOP','bad');
  setUnit('form',{status:'needs-context',ask:'form stuck 58% ×2 — logo text atau asset? lihat diff.png'});log('Dev','form diff_renders exit 4 → NEEDS_CONTEXT',1);}],
 [34,()=>{say('d3','logo = asset',1.8);mode('d3','type');iter('form','ctx → --continue','info');setUnit('form',{status:'running',ask:''});log('Manager','form answer recorded → --continue');}],
 [37,()=>{fid('form',5,99.1);setUnit('form',{status:'done'});phase.slice='done';toPantry('d3');renderUI();}],
 [38,()=>next('verify','4 Run-verify — no run: line')],
 [38.6,()=>{spawn('qa','qa','run','qa');setUnit('run',{who:'QA',status:'running',note:'headless'});}],
 [40.5,()=>{say('qa','4 viewports ✓',1.8);iter('run','headless ✓','ok');setUnit('run',{note:'device'});}]];
const ENDS={
 recover:[
  [42.5,()=>fail('qa','run','overflow ✗','device: A RenderFlex overflowed by 12px')],
  [44.5,()=>{mode('qa','type');iter('run','fix 1/3 Expanded','run');log('QA','run fix round 1/3: Expanded in Row');}],
  [46.5,()=>{iter('run','device ✓','ok');fin('verify','qa','run','run: PASS iPhone 15');}],
  [47.5,()=>next('close','5 Close — no close.md')],
  [48.1,()=>{spawn('ld','lead','close','lead');setUnit('close',{who:'Lead',status:'running',note:'AC × platform'});}],
  [51.5,()=>{fin('close','ld','close','close.md ✓');say('mgr','DONE',4);}]],
 blocked:[
  [42.5,()=>fail('qa','run','pod ✗ 1/3','device r1: pod install failed (iOS 12 < DS min)')],
  [44.5,()=>{iter('run','pod ✗ 2/3','bad');log('QA','run r2: Podfile platform raised → still fails',1);}],
  [46.5,()=>{iter('run','pod ✗ 3/3','bad');log('QA','run r3: pod install --repo-update → fails',1);}],
  [48,()=>{mode('qa','blocked');iter('run','BLOCKED','bad');phase.verify='blocked';
   setUnit('run',{status:'blocked',note:'run: BLOCKED',ask:'run BLOCKED: pod install — opsi: update Xcode / CocoaPods'});log('QA','plan.md → run: BLOCKED pod install',1);}],
  [49.5,()=>{say('mgr','stop: run BLOCKED',5);log('Manager','stop — Close waits, not DONE',1);}]]};
// HAPPY — sample workflow for users: every gate passes, only the normal stops (approvals, one verify round)
const HAPPY=[
 [0.5,()=>next('brainstorm','1 Brainstorm — no intent.md')],
 [1.2,()=>{spawn('an','analyst','intent','analyst');setUnit('intent',{who:'Analyst',status:'running',note:'Q&A'});iter('intent','Q1–Q5','run');}],
 [3.5,()=>{mode('an','ask');setUnit('intent',{status:'awaiting-human',ask:'review intent.md'});iter('intent','ask user','info');}],
 [5.5,()=>{say('an','approved',1.5);iter('intent','G1 ✓','ok');fin('brainstorm','an','intent','G1 pass');}],
 [6.5,()=>next('design','2 Design — no design.md')],
 [7.2,()=>{spawn('ds','designer','design','designer');setUnit('design',{who:'Designer',status:'running',note:'component plan'});iter('design','C1 ✓','ok');}],
 [9.5,()=>{iter('design','GD2 ✓','ok');mode('ds','ask');setUnit('design',{status:'awaiting-human',ask:'designer review (GD3)'});iter('design','review','info');}],
 [11.5,()=>{say('ds','reviewed',1.5);iter('design','G2 ✓','ok');fin('design','ds','design','G2 pass');}],
 [12.5,()=>next('slice','3 Slice — SDD × 4 units')],
 [13.1,()=>{spawn('d1','dev','header','f1');spawn('d2','dev','balance','f2');spawn('d3','dev','form','f3');spawn('vu','vue','web','vue');
  ['header','balance','form'].forEach(u=>setUnit(u,{who:'Dev',status:'running'}));setUnit('web',{who:'Dev Vue',status:'running',note:'plan.md'});}],
 [16,()=>{fid('header',1,98.4);setUnit('header',{status:'done'});toPantry('d1');fid('form',1,98.1);setUnit('form',{status:'done'});toPantry('d3');
  fid('balance',1,90);verify('f2','verify: padding +4px');iter('web','validate ✓','ok');}],
 [18.5,()=>{leave('vff2');mode('vu','ask');setUnit('web',{status:'awaiting-human',ask:'web: approve plan (step 15)'});iter('web','ask user','info');}],
 [20,()=>{fid('balance',2,98.7);setUnit('balance',{status:'done'});toPantry('d2');}],
 [21.5,()=>{iter('web','approved → .vue ✓','ok');setUnit('web',{status:'done',ask:'',note:'lint ✓'});toPantry('vu');phase.slice='done';renderUI();}],
 [22.5,()=>next('verify','4 Run-verify — no run: line')],
 [23.1,()=>{spawn('qa','qa','run','qa');setUnit('run',{who:'QA',status:'running',note:'headless'});}],
 [25,()=>{say('qa','4 viewports ✓',1.8);iter('run','headless ✓','ok');setUnit('run',{note:'device'});}],
 [27,()=>{iter('run','device ✓','ok');fin('verify','qa','run','run: PASS iPhone 15');}],
 [28,()=>next('close','5 Close — no close.md')],
 [28.6,()=>{spawn('ld','lead','close','lead');setUnit('close',{who:'Lead',status:'running',note:'AC × platform'});}],
 [31.5,()=>{fin('close','ld','close','close.md ✓');say('mgr','DONE',4);}]];

// LIVE — real run: hooks/office_state.py writes .office/state.js after every artifact write; the page
// re-adds that <script> (file:// cannot fetch). ?state=<file url> switches the page to live mode.
const STATE_URL=new URLSearchParams(location.search).get('state');
// desk slots per room, 40 px apart, 3 rows; ponytail: >3 rows per room overlap — widen ROOMS when that happens
function slot(room,i){const r=ROOMS.find(r=>r.k===room),cols=Math.max(1,Math.floor(r.w/40));
 return [r.x+(r.w-cols*40)/2+20+(i%cols)*40,46+Math.floor(i/cols)*32];}
function applyState(st){phase=st.phases;units=st.units;iters=st.iters;
 document.querySelector('h1').textContent='Agent Office · '+st.intent;
 const seated=st.agents.filter(a=>a.room&&!a.beside);
 for(const k in D)if(k!=='mgr'&&!seated.some(a=>a.id===k))delete D[k];
 seated.forEach(a=>{if(D[a.id])return;const used=Object.values(D).filter(d=>d.room===a.room).map(d=>d.i);
  let i=0;while(used.includes(i))i++;D[a.id]=Object.assign(slot(a.room,i),{room:a.room,i});});
 st.agents.forEach(a=>{
  if(a.role==='manager'){if(chars.mgr.said!==a.say){chars.mgr.said=a.say;say('mgr',a.say,4);}return;}
  if(a.beside){if(!chars[a.id]&&D[a.beside]){add(a.id,'verifier',D.mgr[0]+5,D.mgr[1]+14,'');chars[a.id].mode='type';
   go(a.id,[D[a.beside][0]-17,D[a.beside][1]+2]);say(a.id,'verify.md',3);}return;}
  if(!chars[a.id])spawn(a.id,a.role,a.unit,a.id);else if(chars[a.id].desk!==a.id)toDesk(a.id,a.id,a.mode);
  mode(a.id,a.mode,a.err);});
 // gone from state: workers finished (pantry), verifiers leave
 for(const id in chars){const c=chars[id];if(id==='mgr'||c.gone||st.agents.some(a=>a.id===id))continue;
  if(c.r===ROLE.verifier)leave(id);else if(c.desk)toPantry(id);}
 logEl.innerHTML=st.log.slice().reverse().map(([t,who,s,e])=>`<li${e?' class="e"':''}><time>${t}</time><b>${who}</b> ${s}</li>`).join('');
 renderUI();}
let seen=0;
function pull(){const s=document.createElement('script');s.src=STATE_URL+'?'+Date.now();
 s.onload=s.onerror=()=>{s.remove();const st=window.OFFICE_STATE;if(st&&st.t!==seen){seen=st.t;applyState(st);}};
 document.head.appendChild(s);}

function reset(){chars={};units=[];iters={};ev=0;pi=0;T0=performance.now();now=0;logEl.innerHTML='';
 SCRIPT=STATE_URL?[]:variant==='happy'?HAPPY:COMMON.concat(ENDS[variant]);LOOP=STATE_URL?Infinity:SCRIPT[SCRIPT.length-1][0]+6;
 document.querySelectorAll('[data-v]').forEach(b=>b.classList.toggle('on',b.dataset.v===variant));
 phase={brainstorm:'todo',design:'todo',slice:'todo',verify:'todo',close:'todo'};
 add('mgr','manager',D.mgr[0]+5,D.mgr[1]+2,'');chars.mgr.desk='mgr';renderUI();}
function frame(ts){now=(ts-T0)/1000;while(ev<SCRIPT.length&&SCRIPT[ev][0]<=now)SCRIPT[ev++][1]();
 if(now>LOOP)reset();update();draw();requestAnimationFrame(frame);}
// called by the page once its draw() exists
function start(){document.querySelectorAll('[data-v]').forEach(b=>{b.onclick=()=>{variant=b.dataset.v;reset();};b.parentElement.hidden=!!STATE_URL;});
 if(STATE_URL){for(const k in D)if(k!=='mgr')delete D[k];reset();pull();setInterval(pull,1500);}else reset();
 requestAnimationFrame(frame);}
