import * as THREE from 'three';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js?module';
import { RGBELoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/RGBELoader.js?module';

// ---------- Scene / Renderer ----------
const canvas = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 300);
camera.position.set(0, 0.5, 5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 2.0;
controls.maxDistance = 12.0;
controls.minPolarAngle = 0.05;
controls.maxPolarAngle = Math.PI - 0.05;

scene.add(new THREE.AmbientLight(0xffffff, 0.5));

// HDRI background (optional but nice)
new RGBELoader().setPath('./').load('hdri.hdr', (hdr) => {
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = hdr;
  scene.environment = hdr;
});

// ---------- Cloud storage helpers (talk to /api/notes/[id]) ----------
async function loadNote(id) {
  const r = await fetch(`/api/notes/${id}`);
  if (!r.ok) return { title: '', body: '' };
  return r.json();
}
async function saveNote(id, data) {
  const r = await fetch(`/api/notes/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: (data.title || '').slice(0, 120),
      body: (data.body || '').slice(0, 10000),
    }),
  });
  if (!r.ok) throw new Error('Save failed');
}
async function deleteNote(id) {
  await fetch(`/api/notes/${id}`, { method: 'DELETE' });
}

// ---------- Orb field (sprites) ----------
const ORB_COUNT = 500;
const R_MIN = 12;
const R_MAX = 30;
const SPEED = 0.35; // units/sec — slow & constant

function randomDir() {
  const u = Math.random(), v = Math.random();
  const theta = 2 * Math.PI * u, phi = Math.acos(2 * v - 1);
  return new THREE.Vector3(
    Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta)
  );
}
function randomInShell(r0, r1) {
  return randomDir().multiplyScalar(r0 + Math.random() * (r1 - r0));
}
function makeGlowSprite(size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.00, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.35, 'rgba(200,220,255,0.35)');
  g.addColorStop(1.00, 'rgba(255,255,255,0.00)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  return tex;
}

const spriteMap = makeGlowSprite();
const sprites = [];        // THREE.Sprite[]
const velocities = [];     // THREE.Vector3[]
const baseScales = [];     // number

for (let id = 0; id < ORB_COUNT; id++) {
  const mat = new THREE.SpriteMaterial({
    map: spriteMap,
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.9
  });
  const spr = new THREE.Sprite(mat);
  spr.position.copy(randomInShell(R_MIN, R_MAX));
  const s = 0.22 + Math.random() * 0.12; // slight size variety
  spr.scale.setScalar(s);
  baseScales[id] = s;
  spr.userData = { id };

  sprites.push(spr);
  scene.add(spr);

  velocities[id] = randomDir().setLength(SPEED);
}

// ---------- Hover + Click (raycasting) ----------
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let hovered = null; // Sprite currently hovered
let openId = null;  // number | null

function onPointerMove(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}
window.addEventListener('pointermove', onPointerMove);

function updateHover() {
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(sprites, false);
  const hit = hits.length ? hits[0].object : null;

  if (hit !== hovered) {
    if (hovered) hovered.scale.setScalar(baseScales[hovered.userData.id]);
    hovered = hit;
    if (hovered) hovered.scale.setScalar(baseScales[hovered.userData.id] * 1.6);
  }
}

window.addEventListener('click', () => {
  if (!hovered || overlay.classList.contains('open')) return;
  openNote(hovered.userData.id);
});

// ---------- Overlay UI ----------
const overlay = document.getElementById('overlay');
const backdrop = document.getElementById('backdrop');
const dlgTitle = document.getElementById('dlgTitle');
const titleEl = document.getElementById('title');
const bodyEl = document.getElementById('body');
const saveBtn = document.getElementById('saveBtn');
const closeBtn = document.getElementById('closeBtn');

async function openNote(id) {
  openId = id;
  dlgTitle.textContent = `Memory #${id}`;
  try {
    const data = await loadNote(id);
    titleEl.value = data?.title || '';
    bodyEl.value = data?.body || '';
  } catch {
    titleEl.value = '';
    bodyEl.value = '';
  }
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  titleEl.focus();
}
function closeNote() {
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
  openId = null;
}
backdrop.addEventListener('click', closeNote);
closeBtn.addEventListener('click', closeNote);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.classList.contains('open')) closeNote(); });

saveBtn.addEventListener('click', async () => {
  if (openId == null) return;
  try {
    await saveNote(openId, { title: titleEl.value, body: bodyEl.value });
  } catch (e) {
    console.error(e);
    // optional: show a small toast/message if save fails
  }
  closeNote();
});

// ---------- Animation loop (constant speed with gentle steering) ----------
const clock = new THREE.Clock();
function tick() {
  const dt = Math.min(clock.getDelta(), 0.033);
  const t = performance.now() * 0.001;

  for (let i = 0; i < ORB_COUNT; i++) {
    const spr = sprites[i];
    const v = velocities[i];

    // Small steering: rotate velocity around a time-varying axis
    const axis = new THREE.Vector3(
      Math.sin(0.37 * i + t * 0.9),
      Math.cos(0.23 * i + t * 1.1),
      Math.sin(0.19 * i - t * 0.7)
    ).normalize();
    v.applyAxisAngle(axis, 0.12 * dt);

    // Maintain constant speed
    v.setLength(SPEED);

    // Integrate
    spr.position.addScaledVector(v, dt);

    // Keep inside spherical shell
    const len = spr.position.length();
    if (len > R_MAX) {
      const n = spr.position.clone().normalize();
      const dot = v.dot(n);
      v.addScaledVector(n, -2 * dot).setLength(SPEED);
      spr.position.setLength(R_MAX - 0.001);
    }
    if (len < R_MIN * 0.5) {
      const n = spr.position.clone().normalize();
      const dot = v.dot(n);
      v.addScaledVector(n, -2 * dot).setLength(SPEED);
      spr.position.setLength(R_MIN * 0.5 + 0.001);
    }
  }

  updateHover();
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---------- Resize ----------
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
