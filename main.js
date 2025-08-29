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
controls.minPolarAngle = 0.05; // allow almost full vertical orbit
controls.maxPolarAngle = Math.PI - 0.05;

// Optional subtle light; main lighting can come from environment
scene.add(new THREE.AmbientLight(0xffffff, 0.4));

// --- HDRI background/environment (no debug text)
new RGBELoader().setPath('./').load('hdri.hdr', (hdr)=>{
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = hdr;            // visible background
  scene.environment = hdr;           // simple env for orb material
});

// --- Orb field (InstancedMesh for performance)
const ORB_COUNT = 500;
const R_MIN = 12;   // ensure many orbs beyond max zoom
const R_MAX = 30;

const orbGeo = new THREE.SphereGeometry(0.15, 24, 16);
const orbMat = new THREE.MeshStandardMaterial({
  color: 0xeeeeff,
  roughness: 0.4,
  metalness: 0.0,
  envMapIntensity: 0.4
});
const orbs = new THREE.InstancedMesh(orbGeo, orbMat, ORB_COUNT);
scene.add(orbs);

const dummy = new THREE.Object3D();
const positions = new Array(ORB_COUNT);
const velocities = new Array(ORB_COUNT);

function randomInShell(r0, r1){
  // sample a random direction and radius between r0..r1
  const u = Math.random(); const v = Math.random();
  const theta = 2*Math.PI*u; const phi = Math.acos(2*v-1);
  const dir = new THREE.Vector3(
    Math.sin(phi)*Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi)*Math.sin(theta)
  );
  const r = r0 + Math.random()*(r1-r0);
  return dir.multiplyScalar(r);
}

for(let i=0;i<ORB_COUNT;i++){
  const p = randomInShell(R_MIN, R_MAX);
  positions[i] = p;
  // small random velocities
  const vel = new THREE.Vector3((Math.random()-0.5), (Math.random()-0.5), (Math.random()-0.5)).multiplyScalar(0.6);
  velocities[i] = vel;
  dummy.position.copy(p);
  dummy.updateMatrix();
  orbs.setMatrixAt(i, dummy.matrix);
}
orbs.instanceMatrix.needsUpdate = true;

// --- Resize
addEventListener('resize', ()=>{
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// --- Animate the swarm
const clock = new THREE.Clock();
function animate(){
  const dt = Math.min(clock.getDelta(), 0.033); // cap delta for stability

  const t = performance.now()*0.001;
  const center = new THREE.Vector3(Math.sin(t*0.1)*2, Math.cos(t*0.13)*1.5, Math.sin(t*0.07)*1.2);

  for(let i=0;i<ORB_COUNT;i++){
    const p = positions[i];
    const v = velocities[i];

    // gentle drift + slight attraction to a moving centroid
    const toCenter = center.clone().sub(p).multiplyScalar(0.02);
    v.addScaledVector(toCenter, dt);

    // small curl-like rotation around Y for variety
    v.add(new THREE.Vector3(-p.z, 0, p.x).multiplyScalar(0.0004));

    p.addScaledVector(v, dt);

    const len = p.length();
    if(len > R_MAX){
      // bounce back in
      p.multiplyScalar(R_MAX/len);
      v.multiplyScalar(-0.6);
    } else if(len < R_MIN*0.6){
      // nudge outward if too close to camera
      const dir = p.clone().normalize().multiplyScalar((R_MIN*0.8) - len);
      p.addScaledVector(dir, 0.5);
    }

    dummy.position.copy(p);
    dummy.rotation.y += dt*0.5; // subtle spin for sparkle
    dummy.updateMatrix();
    orbs.setMatrixAt(i, dummy.matrix);
  }
  orbs.instanceMatrix.needsUpdate = true;

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
