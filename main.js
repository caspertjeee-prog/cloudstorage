import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const canvas  = document.getElementById('app');      // canvas in index.html
const loading = document.getElementById('loading');

console.log('main.js loaded from', import.meta.url);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 1000);
camera.position.set(0.9, 0.8, 1.8);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.DirectionalLight(0xffffff, 0.5).position.set(5,6,2));

const pmrem = new THREE.PMREMGenerator(renderer);
pmrem.compileEquirectangularShader();

// Use YOUR actual filenames (you said they're in the same folder):
const HDRI_URL  = './environment.hdr';  // was "hdri.hdr" in your other project
const MODEL_URL = './model.glb';        // add your model here

function centerAndScale(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3(); const center = new THREE.Vector3();
  box.getSize(size); box.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const scale = 1.2 / maxDim;
  obj.scale.setScalar(scale);
  obj.position.sub(center.multiplyScalar(scale));
}

// 1) Load HDRI
new RGBELoader().load(
  HDRI_URL,
  (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = hdr;                              // comment this line to hide sky
    scene.environment = pmrem.fromEquirectangular(hdr).texture;
    hdr.dispose();

    // 2) Load GLB
    new GLTFLoader().load(
      MODEL_URL,
      (gltf) => {
        const root = gltf.scene || gltf.scenes?.[0];
        centerAndScale(root);
        scene.add(root);
        loading.style.display = 'none';
      },
      undefined,
      (err) => { console.error('Failed to load GLB', err); loading.textContent = 'Failed to load model.glb'; }
    );
  },
  undefined,
  (err) => { console.error('Failed to load HDRI', err); loading.textContent = 'Failed to load environment.hdr'; }
);

function tick(){
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
