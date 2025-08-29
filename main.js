import * as THREE from 'three';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js?module';
import { RGBELoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/RGBELoader.js?module';

// --- Renderer
const canvas = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, powerPreference:'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);

// --- Scene & Camera
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth/innerHeight, 0.1, 200);
camera.position.set(0, 0.5, 5);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 2.0;
controls.maxDistance = 12.0;
controls.minPolarAngle = 0.05;
controls.maxPolarAngle = Math.PI - 0.05;

// Ambient light for a tiny bit of lift (sprites glow via additive blending)
scene.add(new THREE.AmbientLight(0xffffff, 0.4));

// --- HDRI background/environment
new RGBELoader().setPath('./').load('hdri.hdr', (hdr)=>{
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = hdr;
  scene.environment = hdr;
});

// ---------------- Glowing “orbs” as sprites (Points) ----------------
const ORB_COUNT = 500;
const R_MIN = 12;   // keep many orbs behind you even fully zoomed out
const R_MAX = 30;
const SPEED   = 0.35; // units/sec — slow & constant

// Soft radial sprite texture (glow)
function makeSoftSprite(size=256){
  const c=document.createElement('canvas'); c.width=c.height=size;
  const ctx=c.getContext('2d');
  const g=ctx.createRadialGradient(size/2,size/2,0,size/2,size/2,size/2);
  g.addColorStop(0.00,'rgba(255,255,255,0.95)');
  g.addColorStop(0.35,'rgba(255,255,255,0.35)');
  g.addColorStop(1.00,'rgba(255,255,255,0.00)');
  ctx.fillStyle=g; ctx.fillRect(0,0,size,size);
  const tex=new THREE.CanvasTexture(c);
  tex.minFilter=THREE.LinearFilter; tex.magFilter=THREE.LinearFilter;
  return tex;
}
const spriteTex = makeSoftSprite();

// Geometry & data
const geom = new THREE.BufferGeometry();
const pos = new Float32Array(ORB_COUNT*3);
const velocities = new Array(ORB_COUNT);

function randomInShell(r0,r1){
  const u=Math.random(), v=Math.random();
  const theta=2*Math.PI*u, phi=Math.acos(2*v-1);
  const dir=new THREE.Vector3(
    Math.sin(phi)*Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi)*Math.sin(theta)
  );
  const r = r0 + Math.random()*(r1-r0);
  return dir.multiplyScalar(r);
}

for(let i=0;i<ORB_COUNT;i++){
  const p = randomInShell(R_MIN, R_MAX);
  pos[i*3+0]=p.x; pos[i*3+1]=p.y; pos[i*3+2]=p.z;

  // random direction at constant speed
  const dir = randomInShell(1,1).normalize().multiplyScalar(SPEED);
  velocities[i] = dir;
}
geom.setAttribute('position', new THREE.BufferAttribute(pos,3));

const mat = new THREE.PointsMaterial({
  map: spriteTex,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  opacity: 0.9,
  size: 0.18,            // slightly smaller than before
  sizeAttenuation: true
});

const orbs = new THREE.Points(geom, mat);
scene.add(orbs);

// Resize
addEventListener('resize', ()=>{
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Animate — constant-speed drift with gentle steering
const clock = new THREE.Clock();
const tmp = new THREE.Vector3();
function animate(){
  const dt = Math.min(clock.getDelta(), 0.033);
  const arr = geom.getAttribute('position').array;
  const t = performance.now()*0.001;

  for(let i=0;i<ORB_COUNT;i++){
    const ix=i*3;
    tmp.set(arr[ix], arr[ix+1], arr[ix+2]);

    // Rotate velocity slightly around a time-varying axis (no acceleration spike)
    const v = velocities[i];
    const axis = new THREE.Vector3(
      Math.sin(0.37*i + t*0.9),
      Math.cos(0.23*i + t*1.1),
      Math.sin(0.19*i - t*0.7)
    ).normalize();
    v.applyAxisAngle(axis, 0.15*dt);

    // Maintain constant speed
    v.setLength(SPEED);

    // Integrate
    tmp.addScaledVector(v, dt);

    // Keep inside spherical shell (reflect if out of bounds)
    let len = tmp.length();
    if(len > R_MAX){
      const n = tmp.clone().normalize();
      const dot = v.dot(n);
      v.addScaledVector(n, -2*dot);      // reflect
      v.setLength(SPEED);
      tmp.setLength(R_MAX-0.001);
    }
    if(len < R_MIN*0.5){
      const n = tmp.clone().normalize();
      const dot = v.dot(n);
      v.addScaledVector(n, -2*dot);      // bounce outward
      v.setLength(SPEED);
      tmp.setLength(R_MIN*0.5+0.001);
    }

    // Write back
    arr[ix]=tmp.x; arr[ix+1]=tmp.y; arr[ix+2]=tmp.z;
  }

  geom.attributes.position.needsUpdate = true;

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
