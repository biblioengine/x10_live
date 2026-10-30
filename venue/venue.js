// 実況会場：歩き回れる3Dの会場（野外ステージ＋オーロラビジョン、光る床、群衆、劇場5棟、地下鉄の入口）
// index.html から import() で読み込み、start(root, api) で開く。three.js は index.html の importmap から。
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';

const BASE = new URL('./', import.meta.url).href;
const MOB = matchMedia('(pointer:coarse)').matches;

// world と同じ詰め方の形データを THREE の形に戻す
function assetGeo(A, smooth){
  const bin=(b64,T)=>{const s=atob(b64);const u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return new T(u.buffer)};
  const q=bin(A.p,Uint16Array),idx=bin(A.i,A.u32?Uint32Array:Uint16Array),pos=new Float32Array(q.length);
  for(let i=0;i<q.length/3;i++)for(let j=0;j<3;j++)pos[i*3+j]=A.lo[j]+q[i*3+j]/65535*A.sc[j];
  let g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos,3));g.setIndex(new THREE.BufferAttribute(idx,1));
  if(!smooth)g=g.toNonIndexed();g.computeVertexNormals();return g;
}

export async function start(root, X){
  let alive=true;const cleanups=[];
  const on=(t,ev,fn,o)=>{t.addEventListener(ev,fn,o);cleanups.push(()=>t.removeEventListener(ev,fn,o))};
  root.innerHTML=`<canvas class="vcv"></canvas>
    <div class="vtop"><button type="button" class="vback" aria-label="会場を出る">◀︎</button><span class="vtt">実況会場</span></div>
    <button type="button" class="vsnd" aria-label="音楽のオン・オフ"></button>
    <div class="vload">会場を準備中…</div>
    <div class="vhint">${MOB?'左下を押して動かすと歩く（大きく倒すと走る）・右側をドラッグで見回す':'WASD／矢印キーで歩く・Shiftで走る・ドラッグで見回す'}</div>
    <div class="vstick" hidden><i></i></div>
    <div class="vbtns"><button type="button" class="vdance" hidden>踊る</button><button type="button" class="vexit" hidden>会場を出る</button></div>
    <div class="vgoin" hidden><button type="button" class="vopen"></button></div>
    <div class="vscr" hidden><button type="button" class="vscrb"></button></div>
    <div class="vplay" hidden><div class="vpbox"><button type="button" class="vpx" aria-label="上映を閉じる">×</button><div class="vpf"></div></div></div>
    <div class="vslide" hidden><button type="button" data-sl="-1" aria-label="前のカード">◀︎</button><span class="vsn"></span><button type="button" data-sl="1" aria-label="次のカード">▶︎</button></div>`;
  const cv=root.querySelector('.vcv'),ld=root.querySelector('.vload'),hint=root.querySelector('.vhint');
  const bScr=root.querySelector('.vscrb'),vplay=root.querySelector('.vplay');
  // 野外スクリーンの上映：ステージの前でボタンを押すと、YouTube の再生画面を重ねて開く（押すまで読み込まない）
  const closeShow=()=>{vplay.hidden=true;vplay.querySelector('.vpf').innerHTML='';X.bgm&&X.bgm.resume()};
  on(vplay,'click',e=>{if(e.target===vplay||e.target.closest('.vpx'))closeShow()});
  on(bScr,'click',()=>{const s=X.screening&&X.screening();if(!s)return;X.bgm&&X.bgm.pause();
    vplay.querySelector('.vpf').innerHTML=`<iframe src="https://www.youtube-nocookie.com/embed/${s.id}?autoplay=1&playsinline=1&rel=0" title="${s.title.replace(/[<>&"]/g,'')}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;vplay.hidden=false});
  cleanups.push(()=>{vplay.querySelector('.vpf').innerHTML=''});
  const bOpen=root.querySelector('.vopen'),bDance=root.querySelector('.vdance'),bExit=root.querySelector('.vexit'),slide=root.querySelector('.vslide'),stickEl=root.querySelector('.vstick');
  root.querySelector('.vback').onclick=()=>X.close();
  {const sb=root.querySelector('.vsnd'),paint=()=>{const o=X.music.on();sb.textContent=o?'♪':'♪';sb.classList.toggle('off',!o);sb.setAttribute('aria-pressed',o)};paint();sb.onclick=()=>{X.music.toggle();paint()}}bExit.onclick=()=>X.close();
  setTimeout(()=>hint.classList.add('fade'),7000);

  // ---------- 描画の準備 ----------
  const R=new THREE.WebGLRenderer({canvas:cv,antialias:!MOB,powerPreference:'high-performance'});
  R.setPixelRatio(Math.min(devicePixelRatio||1,MOB?1.5:2));R.outputColorSpace=THREE.SRGBColorSpace;
  // 会場はずっと夜（パーティの演出のため）。?day=1 で確認用に昼にできる
  const FIN=!!(X.ended&&X.ended());
  const qd=/[?&]day=([01])/.exec(location.search);
  const DAY=qd?qd[1]==='1':false;
  const BG=DAY?0xcfdbe6:0x07080d;
  const scene=new THREE.Scene();scene.background=new THREE.Color(BG);scene.fog=new THREE.Fog(BG,DAY?60:34,DAY?160:100);
  const cam=new THREE.PerspectiveCamera(55,1,.1,600);
  scene.add(DAY?new THREE.HemisphereLight(0xe4eeff,0x8c8478,1.6):new THREE.HemisphereLight(0x9aa6ff,0x1a1420,1.1));
  const sun=new THREE.DirectionalLight(DAY?0xfff1dc:0xffffff,DAY?2.1:.9);sun.position.set(-10,20,15);scene.add(sun);
  // 周りの空（360度の画像を大きな球の内側に貼る。カメラと一緒に動かして、遠くの景色に見せる）
  const sky=new THREE.Mesh(new THREE.SphereGeometry(400,48,24),new THREE.MeshBasicMaterial({side:THREE.BackSide,fog:false,depthWrite:false,toneMapped:false,color:DAY?0xffffff:0x000000}));
  sky.renderOrder=-1;scene.add(sky);
  {const fb=document.createElement('canvas');fb.width=8;fb.height=256;const x=fb.getContext('2d'),g=x.createLinearGradient(0,0,0,256);
    if(DAY){g.addColorStop(0,'#4f8fd6');g.addColorStop(.42,'#a9cdef');g.addColorStop(.5,'#e3eef7');g.addColorStop(.52,'#c9d3db');g.addColorStop(1,'#9aa3aa')}
    else{g.addColorStop(0,'#000000');g.addColorStop(1,'#000000')}
    x.fillStyle=g;x.fillRect(0,0,8,256);const t=new THREE.CanvasTexture(fb);t.colorSpace=THREE.SRGBColorSpace;sky.material.map=t;sky.material.color.set(0xffffff);sky.material.needsUpdate=true}
  // 遠くの山並み：会場をぐるっと囲む稜線を3重に（遠いほど空の色に溶ける）。空と同じくカメラと一緒に動かす
  const hills=new THREE.Group();scene.add(hills);
  {const LAY=DAY?[[330,58,0x9fb6cc,3.1],[270,44,0x7f9bb0,7.7],[215,30,0x5f7d6a,12.9]]:[[330,58,0x0d1220,3.1],[270,44,0x0a0e18,7.7],[215,30,0x070a10,12.9]];
    const nz=(x,s)=>{let v=0,a=1,f=1,t=0;for(let k=0;k<5;k++){v+=a*Math.sin(x*f+s*1.7+k*2.3)*Math.sin(x*f*.53+s+k*1.1);t+=a;a*=.5;f*=2.07}return v/t};
    for(const [r,hgt,col,seed] of LAY){const N=360,P=[],I=[];
      for(let i=0;i<=N;i++){const a=i/N*Math.PI*2,x=Math.sin(a)*r,z=Math.cos(a)*r;
        // ステージの後ろ（北）を少し高く
        const north=Math.max(0,-Math.cos(a));const y=hgt*(.35+.65*(.5+.5*nz(a*3,seed)))*(.8+.35*north);
        P.push(x,-20,z,x,y,z);if(i<N){const k=i*2;I.push(k,k+1,k+2,k+1,k+3,k+2)}}
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(P,3));g.setIndex(I);
      {const hm=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:col,fog:false,side:THREE.DoubleSide,depthWrite:false}));hm.renderOrder=-.5;hills.add(hm)}}}
  new THREE.TextureLoader().load(BASE+(DAY?'sky_day.jpg':'sky_night.jpg'),t=>{if(!alive)return;t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;sky.material.map=t;sky.material.needsUpdate=true},undefined,()=>{});
  const resize=()=>{const w=root.clientWidth,h=root.clientHeight;R.setSize(w,h,false);cam.aspect=w/h;cam.updateProjectionMatrix()};
  on(window,'resize',resize);resize();

  // ---------- 光る床：2mの升目が、それぞれの色で点滅する ----------
  const floorMat=new THREE.ShaderMaterial({uniforms:{uT:{value:0},uFog:{value:new THREE.Color(BG)},uDay:{value:DAY?1:0}},
    vertexShader:`varying vec2 vP;void main(){vec4 w=modelMatrix*vec4(position,1.);vP=w.xz;gl_Position=projectionMatrix*viewMatrix*w;}`,
    fragmentShader:`uniform float uT;uniform vec3 uFog;uniform float uDay;varying vec2 vP;
      float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
      float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*n2(p);p*=2.03;a*=.5;}return v;}
      vec3 hsv(float h,float s,float v){vec3 k=clamp(abs(mod(h*6.+vec3(0,4,2),6.)-3.)-1.,0.,1.);return v*mix(vec3(1),k,s);}
      void main(){vec2 c=floor(vP/2.),f=fract(vP/2.);float a=h(c),b=h(c+17.3);
        float d=min(min(f.x,1.-f.x),min(f.y,1.-f.y));float line=smoothstep(.035,.0,d);
        vec3 o;
        if(uDay>.5){
          // 昼：色つきのタイルは淡く、光らせない。雲の影がゆっくり流れる
          vec3 col=hsv(a,.35,.82);o=mix(vec3(.74,.75,.77),col,.45)*(.92+.08*b);o=mix(o,vec3(.55,.56,.6),line*.6);
          float cl=fbm(vP*.022+vec2(uT*.010,uT*.006));float sh=smoothstep(.46,.62,cl);o*=1.-.5*sh;
        }else{
          float blink=pow(.5+.5*sin(uT*(1.2+b*3.)+a*60.),5.);
          vec3 col=hsv(fract(a+uT*.02),.8,1.);
          o=col*(.05+.55*blink)+col*line*.55+vec3(.06)*line;
        }
        float r=length(vP);o=mix(o,uFog,smoothstep(42.,60.,r));gl_FragColor=vec4(o,1.);}`});
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(130,130),floorMat);floor.rotation.x=-Math.PI/2;scene.add(floor);

  // ---------- 形データ（ステージ・群衆・劇場・地下鉄） ----------
  const G=await (await fetch(BASE+'geo.json')).json();if(!alive)return;
  const lam=c=>new THREE.MeshLambertMaterial({color:c});
  const OB=[]; // ぶつかる場所（x0,x1,z0,z1）
  // 野外ステージ：奥（北）に、正面を手前（南）に向けて
  const SZ=-30;
  const stage=new THREE.Group();stage.position.set(0,0,SZ);scene.add(stage);
  stage.add(new THREE.Mesh(assetGeo(G.stage_frame,true),lam(0xb9bcc4)));
  stage.add(new THREE.Mesh(assetGeo(G.stage_deck,false),lam(0x2a2c32)));
  OB.push([-10.6,11.7,SZ-7.9,SZ-0.1]);
  // オーロラビジョン（ステージ背面の大画面）
  const AV=document.createElement('canvas');AV.width=1024;AV.height=465;const avx=AV.getContext('2d');
  const avTex=new THREE.CanvasTexture(AV);avTex.colorSpace=THREE.SRGBColorSpace;
  const aurora=new THREE.Mesh(new THREE.PlaneGeometry(8.4,3.81),new THREE.MeshBasicMaterial({map:avTex,toneMapped:false}));
  aurora.position.set(.65,3.2,-7.6);stage.add(aurora);
  // ステージ両脇のビジョン：速報を左右で別々に流す
  const SIDE=[-7.125,8.245].map((x,i)=>{const c=document.createElement('canvas');c.width=512;c.height=445;const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;
    const m=new THREE.Mesh(new THREE.PlaneGeometry(3.5,3.04),new THREE.MeshBasicMaterial({map:t,toneMapped:false}));m.position.set(x,3.41,-.1);stage.add(m);return{c,cx:c.getContext('2d'),t,i}});
  // ステージの光の柱（左右に振れる）
  const beams=[];{const bg=new THREE.ConeGeometry(1.1,16,20,1,true);bg.translate(0,-8,0);
    [0xff3d7f,0x3dd6ff,0xffd23d,0x8a5bff,0x3dff9e,0xff7a3d].forEach((c,i)=>{const m=new THREE.Mesh(bg,new THREE.MeshBasicMaterial({color:c,transparent:true,opacity:.16,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide}));
      m.position.set(-8+i*3.4,5.9,-1.2);m.visible=!DAY;stage.add(m);beams.push(m)})}
  // 花火：ステージの奥の空に、数秒おきに打ち上げる（音なし。スマホは粒を少なめに）
  const FW=[],fwV=new THREE.Vector3();{const NP=MOB?70:140,PAL=[0xff3d7f,0x3dd6ff,0xffd23d,0x8a5bff,0x3dff9e,0xff7a3d,0xffffff];
    // 粒を丸くぼかす（四角に見えないように）
    const dotTex=(()=>{const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d'),gr=x.createRadialGradient(32,32,0,32,32,32);
      gr.addColorStop(0,'rgba(255,255,255,1)');gr.addColorStop(.35,'rgba(255,255,255,.8)');gr.addColorStop(1,'rgba(255,255,255,0)');x.fillStyle=gr;x.fillRect(0,0,64,64);
      const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t})();
    const mk=()=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(NP*3),3));
      const m=new THREE.PointsMaterial({map:dotTex,size:MOB?2.2:1.8,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false,fog:false,toneMapped:false});
      const pts=new THREE.Points(g,m);pts.frustumCulled=false;pts.visible=false;scene.add(pts);
      return{pts,g,m,vel:new Float32Array(NP*3),t:0,life:0,stage:0,o:new THREE.Vector3(),top:0}};
    for(let i=0;i<(MOB?4:6);i++)FW.push(mk());
    let next=1;
    const launch=()=>{const f=FW.find(f=>!f.pts.visible);if(!f)return;f.stage=1;f.t=0;f.pts.visible=true;
      // どこを向いていても背景に見えるよう、今見ている方向（左右45度くらい）を中心に、ときどき別の方向にも上げる
      const fwd=cam.getWorldDirection(fwV),ang=Math.atan2(fwd.x,fwd.z)+(Math.random()<.75?(Math.random()-.5)*1.6:(Math.random()-.5)*Math.PI*2),d=55+Math.random()*30;
      f.o.set(cam.position.x+Math.sin(ang)*d,0,cam.position.z+Math.cos(ang)*d);
      // 建物や群衆の上の空（画面の上の端より少し下）で開くように、遠いほど高く
      f.top=cam.position.y+d*(.1+Math.random()*.05);
      f.m.color.setHex(PAL[Math.floor(Math.random()*PAL.length)]);f.m.opacity=1;
      const a=f.g.attributes.position.array;for(let i=0;i<NP;i++){a[i*3]=f.o.x;a[i*3+1]=4;a[i*3+2]=f.o.z}f.g.attributes.position.needsUpdate=true};
    var fireworks=dt=>{next-=dt;if(next<=0){launch();if(Math.random()<.3)launch();next=1.2+Math.random()*2.8}
      for(const f of FW){if(!f.pts.visible)continue;f.t+=dt;const a=f.g.attributes.position.array;
        if(f.stage===1){// 打ち上げ：1本の光がのぼる
          const y=4+(f.top-4)*Math.min(1,f.t/1.1);for(let i=0;i<NP;i++){a[i*3]=f.o.x;a[i*3+1]=y-(i%8)*.12;a[i*3+2]=f.o.z}
          if(f.t>=1.1){f.stage=2;f.t=0;f.life=1.8+Math.random()*.8;const sp=5+Math.random()*3.5;
            for(let i=0;i<NP;i++){const u=Math.random()*2-1,th=Math.random()*Math.PI*2,r=Math.sqrt(1-u*u),k=sp*(.85+Math.random()*.15);
              f.vel[i*3]=r*Math.cos(th)*k;f.vel[i*3+1]=u*k;f.vel[i*3+2]=r*Math.sin(th)*k;a[i*3]=f.o.x;a[i*3+1]=f.top;a[i*3+2]=f.o.z}}}
        else{// 開いて、重力で垂れながら消える
          const drag=Math.exp(-1.6*dt);for(let i=0;i<NP;i++){f.vel[i*3]*=drag;f.vel[i*3+1]=f.vel[i*3+1]*drag-4.5*dt;f.vel[i*3+2]*=drag;
            a[i*3]+=f.vel[i*3]*dt;a[i*3+1]+=f.vel[i*3+1]*dt;a[i*3+2]+=f.vel[i*3+2]*dt}
          const q=f.t/f.life;f.m.opacity=Math.max(0,1-q*q)*(.75+.25*Math.sin(f.t*40));if(q>=1)f.pts.visible=false}
        f.g.attributes.position.needsUpdate=true}}}
  // 天井から落ちる光：会場のあちこちに光の筋と床の光の輪。照らす場所を絶えず動かす
  const spots=[];{
    const cone=new THREE.ConeGeometry(1,1,28,1,true);cone.translate(0,-.5,0); // 先端（光源）が原点、下に広がる
    const beamMat=c=>new THREE.ShaderMaterial({uniforms:{uC:{value:new THREE.Color(c)}},transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide,
      vertexShader:`varying float vY;varying vec3 vN;varying vec3 vV;void main(){vY=uv.y;vec4 mv=modelViewMatrix*vec4(position,1.);vN=normalize(normalMatrix*normal);vV=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}`,
      fragmentShader:`uniform vec3 uC;varying float vY;varying vec3 vN;varying vec3 vV;void main(){float e=pow(abs(dot(vN,vV)),1.5);gl_FragColor=vec4(uC*(.07+.5*vY)*e,1.);}`});
    const pc=document.createElement('canvas');pc.width=pc.height=128;{const x=pc.getContext('2d'),g=x.createRadialGradient(64,64,0,64,64,64);g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(.5,'rgba(255,255,255,.45)');g.addColorStop(1,'rgba(255,255,255,0)');x.fillStyle=g;x.fillRect(0,0,128,128)}
    const poolTex=new THREE.CanvasTexture(pc),poolGeo=new THREE.PlaneGeometry(1,1);poolGeo.rotateX(-Math.PI/2);
    const COLS=[0xff3d7f,0x3dd6ff,0xffd23d,0x8a5bff,0x3dff9e,0xff7a3d,0xffffff,0xff4dd2,0x4d7aff,0xb6ff3d,0xff3d3d,0x3dfff0];
    for(let i=0;i<14;i++){const c=COLS[i%COLS.length];
      const top=new THREE.Vector3((i%7-3)*11,15,i<7?-14:12);
      const m=new THREE.Mesh(cone,beamMat(c));m.frustumCulled=false;scene.add(m);
      const pool=new THREE.Mesh(poolGeo,new THREE.MeshBasicMaterial({map:poolTex,color:c,transparent:true,opacity:1,blending:THREE.AdditiveBlending,depthWrite:false}));pool.position.y=.03;scene.add(pool);
      m.visible=pool.visible=!DAY;
      spots.push({m,pool,top,ph:Math.random()*100,sp:.18+Math.random()*.22,ax:10+Math.random()*16,az:8+Math.random()*14,ang:.13+Math.random()*.08})}
  }
  const _d=new THREE.Vector3(),_up=new THREE.Vector3(0,-1,0);
  function moveSpots(t){for(const s of spots){
    const tx=s.top.x+Math.sin(t*s.sp+s.ph)*s.ax,tz=s.top.z+Math.sin(t*s.sp*1.37+s.ph*1.7)*s.az;
    _d.set(tx-s.top.x,-s.top.y,tz-s.top.z);const L=_d.length();_d.normalize();
    s.m.position.copy(s.top);s.m.quaternion.setFromUnitVectors(_up,_d);const R=L*Math.tan(s.ang);s.m.scale.set(R,L,R);
    s.pool.position.x=tx;s.pool.position.z=tz;s.pool.scale.setScalar(R*3.2)}}
  // 群衆：ステージの前に（world と同じ並び）
  const crowdGeo=assetGeo(G.crowd,true),crowdMat=lam(0xe9eaee);
  const crowd=new THREE.Mesh(crowdGeo,crowdMat);crowd.position.set(.6,0,SZ+17.5);crowd.rotation.y=Math.PI;scene.add(crowd);
  // ステージ前にもう2ブロック（左右に並べ、向きと左右を変えて同じ並びに見えないように）
  {const a=new THREE.Mesh(crowdGeo,crowdMat);a.position.set(-9.4,0,SZ+37);a.rotation.y=-Math.PI*.5;a.scale.x=-1;scene.add(a);
   const b=new THREE.Mesh(crowdGeo,crowdMat);b.position.set(10.6,0,SZ+37);b.rotation.y=Math.PI*.5;scene.add(b)}
  // 地下鉄の入口：ここから入って、ここから出る
  const SUB=new THREE.Vector3(0,0,28);
  const sub=new THREE.Group();sub.position.copy(SUB);sub.rotation.y=Math.PI;scene.add(sub);
  sub.add(new THREE.Mesh(assetGeo(G.sub_body,false),lam(0x2c2f36)));
  sub.add(new THREE.Mesh(assetGeo(G.sub_lamps,true),new THREE.MeshLambertMaterial({color:0x6b5a3a,emissive:0xffd68a,emissiveIntensity:.55})));
  {const b=new THREE.Box3().setFromObject(sub);OB.push([b.min.x,b.max.x,b.min.z,b.max.z])}

  // ---------- 劇場5棟：幕の前の画面に、それぞれの表示 ----------
  const thGeo=[assetGeo(G.th_stage,false),assetGeo(G.th_frame,false),assetGeo(G.th_curtain,true)],thMat=[lam(0x3a3c43),lam(0x6b6e76),lam(0x4a4d55)];
  const TH=[];
  const DEF=[['member','メンバー一覧',-27,-18,1],['profile','プロフィールカード',-27,0,1],['net','交流ネットワーク',-27,18,1],['board','途中経過',27,-18,-1],['cal','カレンダー',27,0,-1],['rank','通算成績',27,18,-1]];
  for(const [key,title,x,z,side] of DEF){
    const g=new THREE.Group();g.position.set(x,0,z);g.rotation.y=side*Math.PI/2;scene.add(g);
    thGeo.forEach((geo,i)=>g.add(new THREE.Mesh(geo,thMat[i])));
    const c=document.createElement('canvas');c.width=1024;c.height=363;const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;
    const scr=new THREE.Mesh(new THREE.PlaneGeometry(8.6,3.05),new THREE.MeshBasicMaterial({map:t,toneMapped:false}));scr.position.set(0,2.05,-1.6);g.add(scr);
    // 看板
    const sc=document.createElement('canvas');sc.width=512;sc.height=96;const sx=sc.getContext('2d');
    sx.fillStyle='#0b0c12';sx.fillRect(0,0,512,96);sx.strokeStyle='#ffd23d';sx.lineWidth=6;sx.strokeRect(3,3,506,90);
    sx.fillStyle='#ffd23d';sx.font='700 46px "Noto Sans JP",sans-serif';sx.textAlign='center';sx.textBaseline='middle';sx.shadowColor='#ffb21a';sx.shadowBlur=14;sx.fillText(title,256,50);
    const st=new THREE.CanvasTexture(sc);st.colorSpace=THREE.SRGBColorSpace;
    const sign=new THREE.Mesh(new THREE.PlaneGeometry(4.8,.9),new THREE.MeshBasicMaterial({map:st,toneMapped:false}));sign.position.set(0,4.6,1.6);g.add(sign);
    // ぶつかる範囲（向きを回したあとの幅と奥行き）
    OB.push([x-2.5,x+2.5,z-5.4,z+5.4]);
    // 画面の前の「立ち位置」（劇場の正面、6m手前）
    const front=new THREE.Vector3(x+side*6,0,z);
    TH.push({key,title,g,c,cx:c.getContext('2d'),t,scr,front});
  }

  // 各劇場の前に、群衆から10人ずつ分けて立たせる
  {const idx=crowdGeo.index.array,pos=crowdGeo.attributes.position.array,n=pos.length/3,par=new Int32Array(n);for(let i=0;i<n;i++)par[i]=i;
    const f=i=>{while(par[i]!==i){par[i]=par[par[i]];i=par[i]}return i};
    for(let t=0;t<idx.length;t+=3){const a=f(idx[t]),b=f(idx[t+1]),c=f(idx[t+2]);par[b]=a;par[f(c)]=a}
    // つながった部品ごとにまとめ、近い部品（同じ人の別パーツ）を1人にする
    const comp=new Map();for(let t=0;t<idx.length;t+=3){const r=f(idx[t]);let c=comp.get(r);if(!c){c={tris:[],x0:1e9,x1:-1e9,z0:1e9,z1:-1e9};comp.set(r,c)}c.tris.push(t);
      for(let k=0;k<3;k++){const v=idx[t+k];const x=pos[v*3],z=pos[v*3+2];if(x<c.x0)c.x0=x;if(x>c.x1)c.x1=x;if(z<c.z0)c.z0=z;if(z>c.z1)c.z1=z}}
    const people=[];for(const c of comp.values()){const cx=(c.x0+c.x1)/2,cz=(c.z0+c.z1)/2;const p=people.find(q=>Math.hypot(q.cx-cx,q.cz-cz)<.35);if(p){p.tris.push(...c.tris)}else people.push({cx,cz,tris:c.tris})}
    const big=people.filter(p=>p.tris.length>60);
    let sd=11;const rnd=()=>(sd=(sd*16807)%2147483647)/2147483647;
    const P=[],I=[];let vo=0;
    for(const T of TH){const side=T.g.rotation.y>0?1:-1,bx=T.g.position.x,bz=T.g.position.z;
      for(let k=0;k<10;k++){const pp=big[Math.floor(rnd()*big.length)];
        // 劇場の正面、2.5〜6.5m手前に、真ん中を少し空けて散らす
        let dz;do{dz=(rnd()-.5)*9}while(Math.abs(dz)<1.1);const dx=side*(4.6+rnd()*4.5);
        const tx=bx+dx,tz=bz+dz,yaw=(side>0?-Math.PI/2:Math.PI/2)+(rnd()-.5)*1.2,cy=Math.cos(yaw),sy=Math.sin(yaw);
        const map=new Map();
        for(const t of pp.tris)for(let j=0;j<3;j++){const v=idx[t+j];let nv=map.get(v);
          if(nv===undefined){const x=pos[v*3]-pp.cx,y=pos[v*3+1],z=pos[v*3+2]-pp.cz;P.push(tx+x*cy+z*sy,y,tz-x*sy+z*cy);nv=vo++;map.set(v,nv)}I.push(nv)}}}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(P,3));g.setIndex(I);g.computeVertexNormals();
    scene.add(new THREE.Mesh(g,crowdMat))}
  // ---------- 自キャラ ----------
  // 凹（ボコ）かマスクマンか（会場に入る前のキャラクター選択で決まる）
  const BOKO=X.chara==='boko';
  const gl=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(BASE+(BOKO?'boko.glb?v=4':'chara.glb?v=2'));if(!alive)return;
  const me=gl.scene;me.traverse(o=>{if(o.isMesh){o.frustumCulled=false}});scene.add(me);
  // 凹：選んだトレーナーの柄を胸に描く（服の画像の胸の場所に重ねて、体に貼り直す）
  if(BOKO&&X.bokoShirt&&X.bokoShirt.img){try{
    const S=X.bokoShirt,art=await new Promise((ok,ng)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=ng;i.src=S.img});if(!alive)return;
    me.traverse(o=>{if(!o.isMesh||!o.material.map||!o.material.map.image)return;const src=o.material.map.image,W=src.width,H=src.height;
      const cv=document.createElement('canvas');cv.width=W;cv.height=H;const c=cv.getContext('2d');c.drawImage(src,0,0,W,H);
      // 胸の場所：体の左右 -0.21〜0.21m が画像の横 0.1〜0.9、高さ 0.22〜0.52m が画像の縦 0.06〜0.28（この服の画像は上下逆に入っている）
      const U=x=>(0.1+0.8*(x+0.21)/0.42)*W,Vy=z=>(0.06+0.22*(z-0.22)/0.30)*H;
      const w=S.w,h=w*art.height/art.width,x0=U(S.x-w/2),x1=U(S.x+w/2),yT=Vy(S.z+h/2),yB=Vy(S.z-h/2);
      c.save();c.translate(x0,yT);c.scale(1,-1);c.drawImage(art,0,0,x1-x0,yT-yB);c.restore();
      const old=o.material.map,t=new THREE.CanvasTexture(cv);t.flipY=old.flipY;t.colorSpace=old.colorSpace;t.wrapS=old.wrapS;t.wrapT=old.wrapT;
      o.material.map=t;o.material.needsUpdate=true})}catch(e){}}
  // マスクマン：選んだ参加者のアイコンを、コスチュームのお腹（「EL CHUPACABRA」の位置）に入れる。
  // 服の画像に丸く描くので、体に貼ると少し横に伸びる（そのままの味として残す）
  if(!BOKO&&X.mmIcon){try{
    const av=await new Promise((ok,ng)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=ng;i.src=X.mmIcon});if(!alive)return;
    me.traverse(o=>{if(!o.isMesh||!o.material.map||!o.material.map.image)return;const src=o.material.map.image,W=src.width,H=src.height;
      const cv=document.createElement('canvas');cv.width=W;cv.height=H;const c=cv.getContext('2d');c.drawImage(src,0,0,W,H);
      // この服の画像は上下が逆に入っているので、位置も絵も上下を返して描く
      const k=W/1024,cx=560*k,cy=H-882*k,R=75*k;
      c.beginPath();c.arc(cx,cy,R*1.09,0,Math.PI*2);c.fillStyle='#ffd23d';c.fill();
      c.save();c.beginPath();c.arc(cx,cy,R,0,Math.PI*2);c.clip();c.translate(cx,cy);c.scale(1,-1);
      const s=Math.max(2*R/av.width,2*R/av.height);c.drawImage(av,-av.width*s/2,-av.height*s/2,av.width*s,av.height*s);c.restore();
      const old=o.material.map,t=new THREE.CanvasTexture(cv);t.flipY=false;t.colorSpace=old.colorSpace;t.wrapS=old.wrapS;t.wrapT=old.wrapT;
      o.material.map=t;o.material.needsUpdate=true})}catch(e){}}
  me.position.set(SUB.x,0,SUB.z-8);me.rotation.y=Math.PI;
  const mixer=new THREE.AnimationMixer(me),A={};gl.animations.forEach(c=>A[c.name]=mixer.clipAction(c));
  const DANCES=Object.keys(A).filter(k=>/^dance\d+$/.test(k));DANCES.forEach(k=>{A[k].setLoop(THREE.LoopOnce,1);A[k].clampWhenFinished=true});
  let curA=null;
  const play=(k,fade=.25)=>{const a=A[k];if(curA===a)return;a.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();if(curA)a.crossFadeFrom(curA,fade,false);curA=a};
  let mode='stand',idleAt=performance.now();
  let lastD='';const pickDance=()=>{let k;do{k=DANCES[Math.floor(Math.random()*DANCES.length)]}while(k===lastD&&DANCES.length>1);lastD=k;return k};
  // ---- マスクマン ----
  // 止まっているときの立ち姿：見回し1の最初のコマで止める
  const standStill=BOKO?()=>{play('idle',.3)}:()=>{play('look1');A.look1.paused=true;A.look1.time=0};
  // ---- 凹：コークスクリュー・キップアップや前へ進むダンスでは、体ごと動く（root=腰の前後左右の動き） ----
  let RM=null;gl.scene.traverse(o=>{if(o.userData&&o.userData.root)RM=o.userData.root});
  let rmK=null,rmP0=null;
  const rmAt=(k,t)=>{const r=RM&&RM[k];if(!r)return [0,0];const T=r.t;let i=0;while(i<T.length-2&&T[i+1]<t)i++;const f=Math.min(1,Math.max(0,(t-T[i])/((T[i+1]-T[i])||1)));
    return [r.xz[i*2]+(r.xz[i*2+2]-r.xz[i*2])*f,r.xz[i*2+1]+(r.xz[i*2+3]-r.xz[i*2+1])*f]};
  const rmLocal=(x,z)=>{const c=Math.cos(me.rotation.y),s=Math.sin(me.rotation.y);return [x*c+z*s,-x*s+z*c]};
  const rmStart=(k,t)=>{rmK=k;const [x,z]=rmLocal(...rmAt(k,t));rmP0={x:me.position.x-x,z:me.position.z-z}};
  const rmUpdate=()=>{if(!rmK)return;const [x,z]=rmLocal(...rmAt(rmK,A[rmK].time));me.position.x=rmP0.x+x;me.position.z=rmP0.z+z;collide(me.position)};
  const once=(k,fade,back=false)=>{const a=A[k];a.setLoop(THREE.LoopOnce,1);a.clampWhenFinished=true;if(curA===a)curA=null;play(k,fade);
    if(back){a.timeScale=-1;a.time=a.getClip().duration}rmStart(k,a.time)};
  let runLoops=0;
  const bokoStand=()=>{rmK=null;mode='stand';idleAt=performance.now();standStill()};
  const bokoDance=()=>{rmK=null;mode='dance';const k=pickDance();if(curA===A[k])curA=null;play(k,.3);if(RM&&RM[k])rmStart(k,0)};
  // 頭で回る（Head Spinning）は1回が短いので、4回まわってから終わる
  if(BOKO&&A.dance2)A.dance2.setLoop(THREE.LoopRepeat,4);
  if(BOKO){A.run&&A.run.setLoop(THREE.LoopRepeat,Infinity);A.jacks&&A.jacks.setLoop(THREE.LoopRepeat,Infinity);
    // 走りを5回くり返すと、コークスクリュー・キップアップ
    mixer.addEventListener('loop',e=>{if(e.action===A.run&&mode==='run'){runLoops++;if(runLoops>=5){runLoops=0;mode='kipup';once('kipup',.15)}}})}
  standStill();
  mixer.addEventListener('finished',e=>{
    if(mode==='dance'){X.cheer&&X.cheer(true);if(BOKO)bokoStand();else{mode='look';play(Math.random()<.5?'look1':'look2',.4);A.look1.paused=false}return}
    if(!BOKO)return;
    // キップアップで立ち上がったら、そのまま立ち姿へ
    if(mode==='kipup'&&e.action===A.kipup){bokoStand()}});
  bDance.onclick=()=>{
    if(BOKO){if(mode==='kipup')return;bokoDance();return}
    const k=pickDance();mode='dance';A.look1.paused=false;if(curA===A[k])curA=null;play(k,.3)};

  // ---------- 操作 ----------
  const keys=new Set();
  on(window,'keydown',e=>{if(e.target.closest&&e.target.closest('input,textarea'))return;keys.add(e.key.toLowerCase());if(['arrowup','arrowdown','arrowleft','arrowright',' '].includes(e.key.toLowerCase()))e.preventDefault()});
  on(window,'keyup',e=>keys.delete(e.key.toLowerCase()));
  let yaw=0,pitch=.32,stick={id:null,x0:0,y0:0,dx:0,dy:0},look=null,tapStart=null;
  on(cv,'pointerdown',e=>{
    cv.setPointerCapture(e.pointerId);
    if(MOB&&e.clientX<innerWidth*.5&&e.clientY>innerHeight*.45&&stick.id===null){stick={id:e.pointerId,x0:e.clientX,y0:e.clientY,dx:0,dy:0};
      stickEl.hidden=false;stickEl.style.left=e.clientX+'px';stickEl.style.top=e.clientY+'px';stickEl.firstChild.style.transform='';return}
    look={id:e.pointerId,x:e.clientX,y:e.clientY};tapStart={x:e.clientX,y:e.clientY,t:performance.now()}});
  on(cv,'pointermove',e=>{
    if(e.pointerId===stick.id){let dx=e.clientX-stick.x0,dy=e.clientY-stick.y0;const L=Math.hypot(dx,dy),M=60;if(L>M){dx*=M/L;dy*=M/L}stick.dx=dx/M;stick.dy=dy/M;stickEl.firstChild.style.transform=`translate(${dx}px,${dy}px)`;return}
    if(look&&e.pointerId===look.id){yaw-=(e.clientX-look.x)*.006;pitch=Math.min(1.1,Math.max(.05,pitch+(e.clientY-look.y)*.004));look.x=e.clientX;look.y=e.clientY}});
  const up=e=>{
    if(e.pointerId===stick.id){stick={id:null,dx:0,dy:0};stickEl.hidden=true;return}
    if(look&&e.pointerId===look.id){look=null;
      // 動かさずに軽く押したとき：プロフィールカードの画面を押したら、その人の個人ページへ
      if(tapStart&&Math.hypot(e.clientX-tapStart.x,e.clientY-tapStart.y)<8&&performance.now()-tapStart.t<500)tap(e)}};
  on(cv,'pointerup',up);on(cv,'pointercancel',up);
  const ray=new THREE.Raycaster();
  function tap(e){const r=cv.getBoundingClientRect();ray.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),cam);
    const P=TH.find(t=>t.key==='profile');const hit=ray.intersectObject(P.scr)[0];
    if(hit&&hit.distance<30){const u=profList()[profI];if(u)X.peek('player',u.id)}}

  // ---------- 劇場の表示 ----------
  const IMG={};const img=u=>{const k=u.handle.toLowerCase();if(!IMG[k]){const im=new Image();im.onload=()=>{dirty=true};im.src=X.avatar(u);IMG[k]=im}return IMG[k]};
  let dirty=true;
  const circ=(cx,im,u,x,y,r)=>{cx.save();cx.beginPath();cx.arc(x,y,r,0,Math.PI*2);cx.closePath();cx.clip();
    if(im&&im.complete&&im.naturalWidth)cx.drawImage(im,x-r,y-r,r*2,r*2);else{cx.fillStyle=u.color||'#556';cx.fillRect(x-r,y-r,r*2,r*2)}cx.restore()};
  const ring=(cx,x,y,r,c,w)=>{cx.lineWidth=w;cx.strokeStyle='#2a2f3d';cx.beginPath();cx.arc(x,y,r,0,Math.PI*2);cx.stroke();
    if(c){cx.strokeStyle=c>=X.GOAL?'#ffc53d':'#6c90ff';cx.beginPath();cx.arc(x,y,r,-Math.PI/2,-Math.PI/2+Math.PI*2*Math.min(c,X.GOAL)/X.GOAL);cx.stroke()}};
  const short=(t,n)=>{t=[...(t.split(/[｜|]/)[0].trim()||t)];return t.length>n?t.slice(0,n).join('')+'…':t.join('')};
  const JP='"Noto Sans JP",sans-serif',NUM='"Roboto Mono",monospace';
  const bgPaint=(cx,W,H)=>{cx.fillStyle='#0d0f16';cx.fillRect(0,0,W,H)};
  const profList=()=>X.users();let profI=0;
  function drawTheaters(){
    const us=X.users(),tk=X.todayKey();
    for(const T of TH){const cx=T.cx,W=1024,H=363;bgPaint(cx,W,H);cx.textBaseline='middle';
      if(T.key==='member'){const C=13,cw=W/C,rows=Math.ceil(us.length/C),ch=Math.min(H/rows,cw);
        us.forEach((u,i)=>{const x=(i%C+.5)*cw,y=(Math.floor(i/C)+.5)*ch+(H-ch*rows)/2,r=ch*.36;circ(cx,img(u),u,x,y,r);ring(cx,x,y,r+5,X.dayCount(u.id,tk),5)})}
      else if(T.key==='profile'){const u=us[profI%Math.max(1,us.length)];if(u){const c=X.dayCount(u.id,tk),tt=X.totals(u.id);
        circ(cx,img(u),u,190,H/2,118);ring(cx,190,H/2,132,c,12);
        cx.fillStyle='#eef1f7';cx.textAlign='left';cx.font=`700 46px ${JP}`;cx.fillText(short(u.name,14),360,92);
        cx.fillStyle='#8a93a8';cx.font=`500 26px ${NUM}`;cx.fillText('@'+u.handle,362,142);
        const tag=X.tag(u);if(tag){cx.fillStyle='#cfd5e2';cx.font=`500 26px ${JP}`;cx.fillText(short(tag,26),362,190)}
        cx.fillStyle='#ffc53d';cx.font=`800 28px ${JP}`;cx.fillText(`今日 ${c}/${X.GOAL}　達成 ${tt.ach}日　通算 ${tt.all}本`,362,262);
        cx.fillStyle='#8a93a8';cx.font=`500 20px ${JP}`;cx.fillText(`${profI%us.length+1} / ${us.length}　画面を押すとこの人のページへ`,362,318)}}
      else if(T.key==='board'){const rows=us.map(u=>({u,c:X.dayCount(u.id,tk)})).sort((a,b)=>b.c-a.c).slice(0,12);
        cx.fillStyle='#ffc53d';cx.font=`800 26px ${JP}`;cx.textAlign='left';cx.fillText('今日の途中経過',24,26);
        rows.forEach((r,i)=>{const col=i%2,row=Math.floor(i/2),x=24+col*500,y=72+row*48;
          cx.fillStyle='#8a93a8';cx.font=`700 22px ${NUM}`;cx.textAlign='right';cx.fillText(i+1,x+26,y);
          circ(cx,img(r.u),r.u,x+56,y,18);cx.textAlign='left';cx.fillStyle='#eef1f7';cx.font=`700 22px ${JP}`;cx.fillText(short(r.u.name,9),x+84,y);
          for(let k=0;k<10;k++){cx.fillStyle=k<r.c?(r.c>=X.GOAL?'#ffc53d':'#6c90ff'):'#2a2f3d';cx.fillRect(x+284+k*15,y-9,12,18)}
          cx.fillStyle=r.c>=X.GOAL?'#ffc53d':'#eef1f7';cx.font=`700 22px ${NUM}`;cx.textAlign='right';cx.fillText(r.c,x+470,y)})}
      else if(T.key==='rank'){const rows=us.map(u=>({u,t:X.totals(u.id)})).sort((a,b)=>b.t.ach-a.t.ach||b.t.all-a.t.all).slice(0,12);
        cx.fillStyle='#ffc53d';cx.font=`800 26px ${JP}`;cx.textAlign='left';cx.fillText('通算成績（達成日数・投稿数）',24,26);
        rows.forEach((r,i)=>{const col=i%2,row=Math.floor(i/2),x=24+col*500,y=72+row*48;
          cx.fillStyle='#8a93a8';cx.font=`700 22px ${NUM}`;cx.textAlign='right';cx.fillText(i+1,x+26,y);
          circ(cx,img(r.u),r.u,x+56,y,18);cx.textAlign='left';cx.fillStyle='#eef1f7';cx.font=`700 22px ${JP}`;cx.fillText(short(r.u.name,9),x+84,y);
          cx.textAlign='right';cx.fillStyle='#ffc53d';cx.font=`700 22px ${NUM}`;cx.fillText(r.t.ach+'日',x+380,y);cx.fillStyle='#eef1f7';cx.fillText(r.t.all+'本',x+470,y)})}
      else if(T.key==='net'){netDraw(cx,W,H,us)}
      else if(T.key==='cal'){const ds=X.days(),n=ds.length;cx.fillStyle='#ffc53d';cx.font=`800 24px ${JP}`;cx.textAlign='left';cx.fillText('達成カレンダー（金色＝10本達成）',24,22);
        const top=44,cw=Math.min(28,(W-60)/Math.max(1,n)),rh=(H-top-8)/us.length,x0=(W-cw*n)/2;
        cx.fillStyle='#8a93a8';cx.font=`700 14px ${NUM}`;cx.textAlign='center';
        us.forEach((u,r)=>{const tt=X.totals(u.id);ds.forEach((k,c)=>{const v=tt.map[k]||0,y=top+r*rh;
          cx.fillStyle=k>tk?'#151823':k<tt.usk?'#1d2130':v>=X.GOAL?'#ffc53d':v?'#34405e':'#20253a';cx.fillRect(x0+c*cw+1,y+.5,cw-2,Math.max(1,rh-1))})})}
      T.t.needsUpdate=true}
    dirty=false;
  }
  // 交流ネットワーク：平面に一度だけ並べて描く
  let NL=null;
  function netDraw(cx,W,H,us){
    if(!NL||NL.n!==us.length){const idx=new Map(us.map((u,i)=>[u.handle.toLowerCase(),i])),E=new Map();
      for(const x of X.ix()){const a=idx.get(String(x.from).toLowerCase()),b=idx.get(String(x.to).toLowerCase());if(a==null||b==null||a===b)continue;const k=a<b?a+'-'+b:b+'-'+a;E.set(k,(E.get(k)||0)+1)}
      const edges=[...E].map(([k,w])=>{const [a,b]=k.split('-').map(Number);return{a,b,w}});
      const P=us.map((u,i)=>{const t=i*2.39996,r=Math.sqrt(i+.5)/Math.sqrt(us.length)*.5;return{x:.5+Math.cos(t)*r,y:.5+Math.sin(t)*r}});
      for(let it=0;it<260;it++){const a=.012*(1-it/260);
        for(let i=0;i<P.length;i++)for(let j=i+1;j<P.length;j++){let dx=P[i].x-P[j].x,dy=P[i].y-P[j].y,d=Math.max(.01,Math.hypot(dx,dy)),f=a*.02/(d*d);P[i].x+=dx/d*f;P[i].y+=dy/d*f;P[j].x-=dx/d*f;P[j].y-=dy/d*f}
        for(const e of edges){const p=P[e.a],q=P[e.b],dx=q.x-p.x,dy=q.y-p.y,d=Math.hypot(dx,dy),f=a*(d-.08)*Math.min(3,Math.log2(1+e.w));p.x+=dx*f;p.y+=dy*f;q.x-=dx*f;q.y-=dy*f}
        for(const p of P){p.x+=(.5-p.x)*a*.6;p.y+=(.5-p.y)*a*.6}}
      const xs=P.map(p=>p.x),ys=P.map(p=>p.y),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
      P.forEach(p=>{p.x=(p.x-x0)/Math.max(1e-3,x1-x0);p.y=(p.y-y0)/Math.max(1e-3,y1-y0)});NL={n:us.length,P,edges}}
    const px=p=>60+p.x*(W-120),py=p=>34+p.y*(H-68);
    cx.lineCap='round';for(const e of NL.edges){const p=NL.P[e.a],q=NL.P[e.b];cx.strokeStyle=`rgba(108,144,255,${Math.min(.75,.15+.12*Math.log2(1+e.w))})`;cx.lineWidth=Math.min(5,.8+Math.log2(1+e.w)*.7);cx.beginPath();cx.moveTo(px(p),py(p));cx.lineTo(px(q),py(q));cx.stroke()}
    us.forEach((u,i)=>{const p=NL.P[i];circ(cx,img(u),u,px(p),py(p),15)});
  }

  // ---------- オーロラビジョン ----------
  const head=new Image();head.src=BASE+'header.jpg';
  let avT=0,avAcc=0;const SC=FIN?['head','icons']:['head','x30','ttl']; // 終了後は、あたうるさんの画像と全員のアイコンを交互に
  const dec=t=>String(t).replace(/<[^>]+>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
  const tick=()=>{const it=X.tickerData();return it.length?it.map(x=>`【${x.tag}】${x.txt.replace(/<[^>]+>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&')}`).join('　／　'):'1日10投稿30日チャレンジ実況中'};
  let tickText=tick(),tickX=0;
  // 両脇のビジョン：速報を4件ずつ、数秒ごとに入れ替え
  let sideT=0;
  // 20秒ごとに5秒間、大きな文字を出す：最終週は「FINAL WEEK」、10/30は「HAPPY FRIDAY NIGHT!!!」、10/31は「LAST DAY OF OCTOBER !!!」、終了後は「congratulations！！！」
  const finalLabel=()=>{if(FIN||(X.ended&&X.ended()))return ['congratulations','！！！','#ffd23d'];const ds=X.days(),tk=X.todayKey(),last=ds[ds.length-1];
    return tk===last?['LAST DAY OF','OCTOBER !!!','#ff4d3a']:tk===last-1?['HAPPY FRIDAY','NIGHT!!!','#ff3d7f']:tk>=ds[Math.max(0,ds.length-7)]?['FINAL','WEEK','#ffb21a']:null};
  function drawSides(dt){sideT+=dt;const it=X.tickerData(),fl=sideT%20>=15?finalLabel():null;
    if(fl){for(const S of SIDE){const cx=S.cx,W=512,H=445;cx.fillStyle='#0b0a08';cx.fillRect(0,0,W,H);
        const on=Math.floor(sideT*3)%2===0,col=fl[2];
        cx.textAlign='center';cx.textBaseline='middle';
        // 文字数に合わせて、横幅に収まる大きさにそろえる
        let fs=130;cx.font=`${fs}px "Archivo Black","Archivo",sans-serif`;const mw=Math.max(cx.measureText(fl[0]).width,cx.measureText(fl[1]).width);
        if(mw>W-40){fs=Math.floor(fs*(W-40)/mw);cx.font=`${fs}px "Archivo Black","Archivo",sans-serif`}
        cx.fillStyle=on?col:'#3a2a20';cx.shadowColor=col;cx.shadowBlur=on?26:0;
        cx.fillText(fl[0],W/2,H/2-fs*.55);cx.fillText(fl[1],W/2,H/2+fs*.55);cx.shadowBlur=0;
        cx.fillStyle='rgba(0,0,0,.35)';for(let y=0;y<H;y+=4)cx.fillRect(0,y,W,1);S.t.needsUpdate=true}
      return}
    for(const S of SIDE){const cx=S.cx,W=512,H=445;cx.fillStyle='#0b0a08';cx.fillRect(0,0,W,H);
      cx.fillStyle='#ff4d3a';cx.font=`400 40px "DotGothic16",${JP}`;cx.textAlign='center';cx.textBaseline='middle';cx.shadowColor='#ff2a10';cx.shadowBlur=12;
      cx.fillText(Math.floor(sideT*2)%2?'● 速報':'○ 速報',W/2,40);cx.shadowBlur=0;
      cx.textAlign='left';
      if(!it.length){cx.fillStyle='#ffb21a';cx.font=`400 30px "DotGothic16",${JP}`;cx.fillText('まだ速報はありません',24,140)}
      else{const per=2,pages=Math.ceil(it.length/per),pg=(Math.floor(sideT/5)*2+S.i)%pages;
        it.slice(pg*per,pg*per+per).forEach((x,j)=>{const y=130+j*160;
          cx.fillStyle='#ff4d3a';cx.font=`400 36px "DotGothic16",${JP}`;cx.fillText('【'+x.tag+'】',16,y-30);
          cx.fillStyle='#ffb21a';cx.shadowColor='#ff8c00';cx.shadowBlur=10;cx.font=`400 40px "DotGothic16",${JP}`;
          // 2行まで折り返す
          const t=dec(x.txt);let l1='',i=0;while(i<t.length&&cx.measureText(l1+t[i]).width<W-32)l1+=t[i++];let l2=t.slice(i);
          if(cx.measureText(l2).width>W-32){while(l2&&cx.measureText(l2+'…').width>W-32)l2=l2.slice(0,-1);l2+='…'}
          cx.fillText(l1,16,y+22);if(l2)cx.fillText(l2,16,y+70);cx.shadowBlur=0})}
      // ドットの網目
      cx.fillStyle='rgba(0,0,0,.35)';for(let y=0;y<H;y+=4)cx.fillRect(0,y,W,1);
      S.t.needsUpdate=true}}
  function drawAurora(dt){const W=1024,H=465,cx=avx,TB=74,mh=H-TB;avT+=dt;
    const scr=X.screening&&X.screening(),SCN=scr?[...SC,'show']:SC;
    const i=Math.floor(avT/5)%SCN.length,k=SCN[i],p=(avT%5)/5;
    cx.fillStyle='#05060a';cx.fillRect(0,0,W,H);
    if(k==='show'&&scr){cx.textAlign='center';cx.textBaseline='middle';const on=Math.floor(avT*2)%2===0;
      cx.font=`800 64px ${JP}`;cx.fillStyle=on?'#ff3d7f':'#ffd23d';cx.shadowColor=cx.fillStyle;cx.shadowBlur=26;cx.fillText('▶ 上映中',W/2,mh/2-62);
      cx.font=`900 58px ${JP}`;cx.fillStyle='#fff';cx.shadowBlur=14;cx.fillText(scr.title,W/2,mh/2+30);
      cx.font=`700 30px ${JP}`;cx.fillStyle='#c9d2ff';cx.shadowBlur=0;cx.fillText('ステージの前のボタンで観られます',W/2,mh/2+110)}
    else if(k==='head'){if(head.complete&&head.naturalWidth){const s=Math.max(W/head.naturalWidth,mh/head.naturalHeight),w=head.naturalWidth*s,h=head.naturalHeight*s;cx.drawImage(head,(W-w)/2,(mh-h)/2,w,h)}}
    else if(k==='icons'){const us=X.users(),n=us.length;if(n){const aw=W-48,ah=mh-44;let best=0,bc=1;
        for(let c=1;c<=n;c++){const r=Math.ceil(n/c),s=Math.min(aw/c,ah/r);if(s>best){best=s;bc=c}}
        const rows=Math.ceil(n/bc),r=best*.42,x0=(W-best*bc)/2,y0=(mh-best*rows)/2;
        us.forEach((u,j)=>{const row=Math.floor(j/bc),inRow=row===rows-1?n-row*bc:bc,xo=(W-best*inRow)/2;
          circ(cx,img(u),u,xo+(j%bc+.5)*best,y0+(row+.5)*best,r)})}}
    else if(k==='x30'){const parts=['1','×','10','×','30'];cx.font='160px "Archivo Black","Archivo",sans-serif';cx.textBaseline='middle';cx.textAlign='left';
      const ws=parts.map(s=>cx.measureText(s).width+10),tw=ws.reduce((a,b)=>a+b,0);let x=(W-tw)/2;
      parts.forEach((s,j)=>{const hue=(avT*90+j*55)%360,b=Math.sin(avT*6+j)*10;cx.fillStyle=`hsl(${hue},95%,62%)`;cx.shadowColor=`hsl(${hue},95%,55%)`;cx.shadowBlur=28;cx.fillText(s,x,mh/2+b);x+=ws[j]});cx.shadowBlur=0}
    else{cx.textAlign='center';cx.textBaseline='middle';const hue=(avT*60)%360;
      cx.font=`900 74px ${JP}`;cx.fillStyle=`hsl(${hue},95%,65%)`;cx.shadowColor=cx.fillStyle;cx.shadowBlur=24;cx.fillText('1日10投稿',W/2,mh/2-58);
      cx.font=`900 64px ${JP}`;cx.fillStyle=`hsl(${(hue+150)%360},95%,65%)`;cx.shadowColor=cx.fillStyle;cx.fillText('30日チャレンジ実況中',W/2,mh/2+44);cx.shadowBlur=0}
    // 枠の電球（流れるように点滅）
    for(let j=0;j<40;j++){const on=(Math.floor(avT*8)+j)%4===0;cx.fillStyle=on?'#ffe08a':'#3a3220';const x=12+j*(W-24)/39;cx.beginPath();cx.arc(x,8,5,0,7);cx.fill();cx.beginPath();cx.arc(x,mh-8,5,0,7);cx.fill()}
    // 下の速報（電光掲示板）
    cx.fillStyle='#0b0a08';cx.fillRect(0,mh,W,TB);cx.font=`400 40px "DotGothic16",${JP}`;cx.textBaseline='middle';cx.textAlign='left';cx.fillStyle='#ffb21a';cx.shadowColor='#ff8c00';cx.shadowBlur=10;
    const tw=cx.measureText(tickText).width+120;tickX-=dt*140;if(tickX<-tw){tickX=0;tickText=tick()}
    cx.fillText(tickText,W+tickX,mh+TB/2);cx.fillText(tickText,W+tickX+tw,mh+TB/2);cx.shadowBlur=0;
    avTex.needsUpdate=true}

  // ---------- ぶつかり ----------
  const LIM=48,RAD=.45;
  function collide(p){p.x=Math.max(-LIM,Math.min(LIM,p.x));p.z=Math.max(-LIM,Math.min(LIM,p.z));
    for(const [x0,x1,z0,z1] of OB){if(p.x>x0-RAD&&p.x<x1+RAD&&p.z>z0-RAD&&p.z<z1+RAD){
      const dl=p.x-(x0-RAD),dr=(x1+RAD)-p.x,dn=p.z-(z0-RAD),ds=(z1+RAD)-p.z,m=Math.min(dl,dr,dn,ds);
      if(m===dl)p.x=x0-RAD;else if(m===dr)p.x=x1+RAD;else if(m===dn)p.z=z0-RAD;else p.z=z1+RAD}}}

  // ---------- 劇場の前に来たとき ----------
  bOpen.onclick=()=>{const k=bOpen.dataset.k;if(k==='profile'){const u=profList()[profI];if(u)X.peek('player',u.id)}else X.peek(k)};
  slide.addEventListener('click',e=>{const b=e.target.closest('[data-sl]');if(!b)return;const n=X.users().length||1;profI=(profI+ +b.dataset.sl+n)%n;dirty=true});

  // ---------- 毎フレーム ----------
  ld.remove();drawTheaters();
  const clock=new THREE.Clock();let thAcc=0,avA=0;const tmpV=new THREE.Vector3();
  const loop=()=>{if(!alive||paused)return;requestAnimationFrame(loop);const dt=Math.min(.05,clock.getDelta());
    floorMat.uniforms.uT.value+=dt;
    // 入力
    let ix=0,iz=0,run=false;
    if(keys.has('w')||keys.has('arrowup'))iz-=1;if(keys.has('s')||keys.has('arrowdown'))iz+=1;if(keys.has('a')||keys.has('arrowleft'))ix-=1;if(keys.has('d')||keys.has('arrowright'))ix+=1;
    run=keys.has('shift');
    if(stick.id!==null){ix=stick.dx;iz=stick.dy;run=Math.hypot(ix,iz)>.8}
    const mag=Math.min(1,Math.hypot(ix,iz));
    // 凹：キップアップの途中は動けない。ジャンピングジャック中に動かすと、そのまま歩き出す
    const busy=BOKO&&mode==='kipup';
    if(BOKO&&mode==='dance')rmUpdate();
    if(busy){rmUpdate();bDance.hidden=true;if(mag>.15)idleAt=performance.now()}
    else if(mag>.15){
      const fx=-Math.sin(yaw),fz=-Math.cos(yaw),rx=Math.cos(yaw),rz=-Math.sin(yaw);
      let dx=rx*ix-fx*iz,dz=rz*ix-fz*iz;const l=Math.hypot(dx,dz)||1;dx/=l;dz/=l;
      const sp=run?4:1.45;me.position.x+=dx*sp*dt;me.position.z+=dz*sp*dt;collide(me.position);
      const want=Math.atan2(dx,dz);let d=want-me.rotation.y;d=Math.atan2(Math.sin(d),Math.cos(d));me.rotation.y+=d*Math.min(1,dt*10);
      if(mode!==(run?'run':'walk')){mode=run?'run':'walk';if(A.look1)A.look1.paused=false;runLoops=0;play(mode,.2)}
      idleAt=performance.now();bDance.hidden=true;
    }else{
      if(mode==='walk'||mode==='run'){runLoops=0;if(BOKO)bokoStand();else{mode='stand';standStill()}}
      const idleT=(performance.now()-idleAt)/1000;
      if(idleT>5&&mode==='stand'){
        // 5秒なにもしなければ：マスクマンは見回す、凹はジャンピングジャック
        if(BOKO){mode='jacks';play('jacks',.4)}
        else{mode='look';A.look1.paused=false;play(Math.random()<.5?'look1':'look2',.4)}}
      bDance.hidden=false;
    }
    mixer.update(dt);
    // カメラ：自キャラの後ろから
    const dist=6,ty=me.position.y+1.5;
    cam.position.set(me.position.x+Math.sin(yaw)*Math.cos(pitch)*dist,ty+Math.sin(pitch)*dist,me.position.z+Math.cos(yaw)*Math.cos(pitch)*dist);
    cam.lookAt(me.position.x,ty,me.position.z);
    // 劇場の前・地下鉄の入口の近く
    const P=TH.find(t=>t.key==='profile');slide.hidden=me.position.distanceTo(P.front)>7;
    // 劇場の前：その劇場の画面を開くボタン（覗き窓から実況サイトの画面へ）
    {let near=null,nd=7;for(const T of TH){const d=me.position.distanceTo(T.front);if(d<nd){nd=d;near=T}}
      bOpen.parentNode.hidden=!near;if(near&&bOpen.dataset.k!==near.key){bOpen.dataset.k=near.key;bOpen.textContent=(near.key==='profile'?'このカードの人のページを開く':near.title+'を開く')+' ▶︎'}}
    {const s=X.screening&&X.screening(),nearStage=Math.abs(me.position.x)<16&&me.position.z>SZ&&me.position.z<SZ+22;
      bScr.parentNode.hidden=!(s&&nearStage&&vplay.hidden);if(s&&bScr.dataset.t!==s.title){bScr.dataset.t=s.title;bScr.textContent='▶ '+s.title+'を観る'}}
    if(!slide.hidden)slide.querySelector('.vsn').textContent=`${profI+1} / ${X.users().length}`;
    bExit.hidden=me.position.distanceTo(tmpV.set(SUB.x,0,SUB.z))>5.5;
    if(!DAY)moveSpots(clock.elapsedTime);
    sky.position.copy(cam.position);hills.position.set(cam.position.x,0,cam.position.z);
    // 光の柱
    beams.forEach((b,i)=>{b.rotation.z=Math.sin(clock.elapsedTime*.9+i*1.3)*.5;b.rotation.x=Math.cos(clock.elapsedTime*.7+i)*.25});
    // オーロラビジョン（1秒に20回まで描き直す）
    fireworks(dt);
    avA+=dt;if(avA>.05){drawAurora(avA);drawSides(avA);avA=0}
    thAcc+=dt;if(dirty&&thAcc>.3){drawTheaters();thAcc=0}
    R.render(scene,cam)};
  requestAnimationFrame(loop);
  if(/[?&]vdebug/.test(location.search))root.__dbg={me,TH,yaw:v=>{yaw=v},mode:()=>mode,hills,cam,sky};
  // データが更新されたら劇場も描き直す
  const iv=setInterval(()=>{dirty=true;NL=null},60000);cleanups.push(()=>clearInterval(iv));

  let paused=false;
  return {close(){alive=false;cleanups.forEach(f=>f());R.dispose();R.forceContextLoss?.()},refresh(){dirty=true;NL=null},
    pause(){paused=true;keys.clear()},resume(){if(!paused)return;paused=false;clock.getDelta();idleAt=performance.now();dirty=true;NL=null;requestAnimationFrame(loop)}};
}
