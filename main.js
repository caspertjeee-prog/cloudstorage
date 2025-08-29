import * as THREE from 'three';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js?module';
import { RGBELoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/RGBELoader.js?module';

const dbg = document.getElementById('debug');

// Renderer
const canvas = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, powerPreference:'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85; // slightly dimmer for natural blend
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);

// Scene & camera
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth/innerHeight, 0.1, 100);
camera.position.set(0, 0.6, 5);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 2.0;
controls.maxDistance = 10.0;
controls.minPolarAngle = 0.05;
controls.maxPolarAngle = Math.PI - 0.05;

// === Cloud sprite texture ===
function makeSoftSprite(size = 256){
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = size;
  const ctx = cvs.getContext('2d');
  const g = ctx.createRadialGradient(size/2,size/2,0,size/2,size/2,size/2);
  // Softer, dimmer, longer falloff to avoid a chalky blob
  g.addColorStop(0.00, 'rgba(245,245,245,0.65)');
  g.addColorStop(0.35, 'rgba(245,245,245,0.28)');
  g.addColorStop(1.00, 'rgba(245,245,245,0.00)');
  ctx.fillStyle = g; ctx.fillRect(0,0,size,size);
  const tex = new THREE.CanvasTexture(cvs);
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// === Cloud geometry ===
function createCloud(){
  const group = new THREE.Group();

  // --- Simple 3D value noise (fast + no deps) -----------------------------
  function hash(x, y, z){
    return Math.fract(Math.sin(x*127.1 + y*311.7 + z*74.7)*43758.5453);
  }
  function lerp(a,b,t){ return a+(b-a)*t; }
  Math.fract = (x)=>x-Math.floor(x);
  function valueNoise(x,y,z){
    const xi=Math.floor(x), yi=Math.floor(y), zi=Math.floor(z);
    const xf=x-xi, yf=y-yi, zf=z-zi;
    const u=xf*xf*(3-2*xf), v=yf*yf*(3-2*yf), w=zf*zf*(3-2*zf);
    let n000=hash(xi,yi,zi), n100=hash(xi+1,yi,zi), n010=hash(xi,yi+1,zi), n110=hash(xi+1,yi+1,zi);
    let n001=hash(xi,yi,zi+1), n101=hash(xi+1,yi,zi+1), n011=hash(xi,yi+1,zi+1), n111=hash(xi+1,yi+1,zi+1);
    let nx00=lerp(n000,n100,u), nx10=lerp(n010,n110,u), nx01=lerp(n001,n101,u), nx11=lerp(n011,n111,u);
    let nxy0=lerp(nx00,nx10,v), nxy1=lerp(nx01,nx11,v);
    return lerp(nxy0,nxy1,w); // 0..1
  }
  function fbm(x,y,z){
    let f=0, amp=0.5, freq=1.0;
    for(let i=0;i<4;i++){ f+=valueNoise(x*freq,y*freq,z*freq)*amp; amp*=0.5; freq*=2.0; }
    return f; // ~0..1
  }

  // --- Sprite (soft, long falloff)
  const sprite = makeSoftSprite(256);

  // --- Lobe descriptors to get a two-puff shape like your ref
  const LOBES = [
    { c:new THREE.Vector3(0.00, 0.00, 0.00), r:1.0 },
    { c:new THREE.Vector3(0.70, 0.05, 0.00), r:0.65 }
  ];

  // Helper: signed distance to blobby union of lobes (metaball-ish)
  function blobbySDF(p){
    let d=Infinity;
    for(const {c,r} of LOBES){ d=Math.min(d, p.clone().sub(c).length()/r); }
    return d; // <1 inside, ~1 at surface
  }

  // We’ll build 3 shells: core, mid, fringe (different sizes/opacities)
  const shells = [
    { count: 4500, jitter: 0.015, size: 0.26, opacity: 0.80 }, // core
    { count: 3800, jitter: 0.020, size: 0.22, opacity: 0.65 }, // mid
    { count: 3200, jitter: 0.030, size: 0.18, opacity: 0.50 }  // fringe wisps
  ];

  const colorTop  = new THREE.Color(0xE9EEF2);
  const colorBase = new THREE.Color(0xC8D0D6);

  for(const shell of shells){
    const positions = new Float32Array(shell.count*3);
    const colors    = new Float32Array(shell.count*3);
    let i=0, ci=0, n=0, guard=0;

    while(n<shell.count && guard<shell.count*8){ guard++;
      // sample around a unit sphere then warp by SDF + fbm for lumpy silhouette
      let x=Math.random()*2-1, y=Math.random()*2-1, z=Math.random()*2-1;
      const d=Math.hypot(x,y,z); if(d>1) continue;

      // base ellipsoid with vertical squash and slight horizontal stretch
      const P = new THREE.Vector3(x*1.10, y*0.80, z*0.95);

      // compute density from blobby SDF and noise
      const sdf = blobbySDF(P);
      const n3  = fbm(P.x*1.8, P.y*1.8, P.z*1.8); // detail
      const density = (1.2 - sdf) + (n3-0.5)*0.6; // inside if > 0

      // bias towards lower half for a heavier base
      const baseBias = THREE.MathUtils.clamp(0.25 - P.y*0.35, -0.2, 0.5);

      if(density + baseBias < 0.02) continue; // reject airy outskirts

      // final position: push outward by noise to create cauliflower edge
      const rPush = (n3-0.5)*shell.jitter;
      P.x += x * rPush; P.y += y * rPush; P.z += z * rPush;

      positions[i++] = P.x; positions[i++] = P.y; positions[i++] = P.z;

      // vertex color gradient top->base
      const h = THREE.MathUtils.clamp((P.y + 0.9)/1.8, 0, 1);
      const c = colorBase.clone().lerp(colorTop, h);
      colors[ci++] = c.r; colors[ci++] = c.g; colors[ci++] = c.b;

      n++;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions,3));
    geom.setAttribute('color',    new THREE.BufferAttribute(colors,3));

    const mat = new THREE.PointsMaterial({
      map: sprite,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      opacity: shell.opacity,
      size: shell.size,
      sizeAttenuation: true
    });

    group.add(new THREE.Points(geom, mat));
  }

  return group;
}

const cloud = createCloud();
scene.add(cloud);

// === HDRI background ===
const pmrem = new THREE.PMREMGenerator(renderer);
pmrem.compileEquirectangularShader();

new RGBELoader().setPath('./').load('hdri.hdr', (hdr)=>{
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = hdr;
  dbg.textContent = 'HDRI loaded';
  start();
}, undefined, (err)=>{
  console.warn('HDRI failed to load', err);
  dbg.textContent = 'HDRI failed to load (check file name/path)';
  start();
});

// Resize
addEventListener('resize', ()=>{
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
function animate(){
  const t = clock.getElapsedTime();
  cloud.rotation.y = 0.04*t;
  cloud.position.y = Math.sin(t*0.5)*0.025;
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
function start(){ requestAnimationFrame(animate); }
