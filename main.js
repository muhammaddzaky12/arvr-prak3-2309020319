// ===== Bagian A: import dan variabel =====
import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

let camera, scene, renderer;
const controllers = [];
const interactables = []; // daftar objek yang boleh berinteraksi
const raycaster = new THREE.Raycaster();
const tempMatrix = new THREE.Matrix4();
const pointer = new THREE.Vector2();
const clock = new THREE.Clock();
const logBox = document.getElementById('log');
const lines = [];

// Daftar bentuk yang dipakai saat objek diklik/di-squeeze (berputar urut)
const shapeFactories = [
  { name: 'Kubus',    make: () => new THREE.BoxGeometry(0.3, 0.3, 0.3) },
  { name: 'Bola',     make: () => new THREE.SphereGeometry(0.18, 32, 16) },
  { name: 'Kerucut',  make: () => new THREE.ConeGeometry(0.16, 0.35, 32) },
  { name: 'Silinder', make: () => new THREE.CylinderGeometry(0.15, 0.15, 0.3, 32) },
  { name: 'Torus',    make: () => new THREE.TorusGeometry(0.15, 0.06, 16, 48) },
  { name: 'Oktahedron', make: () => new THREE.OctahedronGeometry(0.2) }
];

// Kontrol desktop (mirip A-Frame): drag mouse = lihat sekitar, WASD = jalan
let yaw = 0, pitch = 0;
const keys = {};
let dragging = false, dragDist = 0, lastX = 0, lastY = 0;
const MOVE_SPEED = 3;       // meter per detik
const LOOK_SPEED = 0.003;   // radian per piksel

// Log ke layar dan console, berguna sebagai bukti pengujian
function log(msg) {
  console.log(msg);
  lines.unshift(msg);
  lines.length = Math.min(lines.length, 5);
  logBox.textContent = lines.join(' | ');
}

// ===== Bagian B: scene dan objek interaktif =====
function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b1f2a);

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 50);
  camera.position.set(0, 1.6, 2);
  camera.rotation.order = 'YXZ';

  scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(2, 4, 2);
  scene.add(sun);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshStandardMaterial({ color: 0x2e3447 })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  scene.add(new THREE.GridHelper(10, 20, 0x555a6e, 0x3a3f52));

  // Tiga objek yang bisa disentuh/digenggam (angka = indeks bentuk awal)
  addObject(0, 0xe74c3c, -0.6, 1.2, -1);
  addObject(1, 0x3498db, 0, 1.2, -1);
  addObject(2, 0x2ecc71, 0.6, 1.2, -1);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true; // aktifkan WebXR
  renderer.domElement.style.touchAction = 'none';
  document.body.appendChild(renderer.domElement);
  document.body.appendChild(VRButton.createButton(renderer));

  setupControllers();
  setupDesktopControls();

  window.addEventListener('resize', onResize);
  renderer.setAnimationLoop(render);
}

function addObject(shapeIndex, color, x, y, z) {
  const mesh = new THREE.Mesh(
    shapeFactories[shapeIndex].make(),
    new THREE.MeshStandardMaterial({ color })
  );
  mesh.userData.shapeIndex = shapeIndex;
  mesh.position.set(x, y, z);
  scene.add(mesh);
  interactables.push(mesh);
}

// Ganti bentuk objek ke bentuk berikutnya, sekaligus acak warna
function changeShape(mesh) {
  const next = (mesh.userData.shapeIndex + 1) % shapeFactories.length;
  const oldGeometry = mesh.geometry;
  mesh.geometry = shapeFactories[next].make();
  oldGeometry.dispose(); // bebaskan memori geometri lama
  mesh.userData.shapeIndex = next;
  mesh.material.color.setHex(Math.floor(Math.random() * 0xffffff));
  return shapeFactories[next].name;
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ===== Bagian C: controller dan garis sinar =====
function setupControllers() {
  const modelFactory = new XRControllerModelFactory();

  for (let i = 0; i < 2; i++) {
    const controller = renderer.xr.getController(i);

    controller.addEventListener('connected', (e) => {
      controller.userData.gamepad = e.data.gamepad; // untuk haptic dan thumbstick
      controller.add(buildRay());
      log('Controller ' + i + ' terhubung (' + e.data.handedness + ')');
    });
    controller.addEventListener('disconnected', () => controller.clear());
    controller.addEventListener('selectstart', onSelectStart);
    controller.addEventListener('selectend', onSelectEnd);
    controller.addEventListener('squeezestart', onSqueezeStart);

    scene.add(controller);
    controllers.push(controller);

    const grip = renderer.xr.getControllerGrip(i);
    grip.add(modelFactory.createControllerModel(grip));
    scene.add(grip);
  }
}

function buildRay() {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -1)
  ]);
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xffffff }));
  line.name = 'ray';
  line.scale.z = 5; // panjang sinar 5 meter
  return line;
}

// ===== Bagian D: raycast, select/grab, release, squeeze =====

// Menghitung objek yang terkena sinar dari sebuah controller
function getIntersections(controller) {
  tempMatrix.identity().extractRotation(controller.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
  return raycaster.intersectObjects(interactables, false);
}

// Getaran singkat pada controller (jika perangkat mendukung)
function pulse(controller, strength = 0.5, ms = 80) {
  const gp = controller.userData.gamepad;
  const actuator = gp && gp.hapticActuators && gp.hapticActuators[0];
  if (actuator && actuator.pulse) actuator.pulse(strength, ms);
}

// Trigger ditekan: genggam objek yang terkena sinar
function onSelectStart(event) {
  const controller = event.target;
  const hits = getIntersections(controller);
  if (hits.length > 0) {
    const obj = hits[0].object;
    controller.attach(obj); // objek menjadi anak controller
    controller.userData.selected = obj;
    pulse(controller);
    log('GRAB: ' + obj.geometry.type);
  }
}

// Trigger dilepas: kembalikan objek ke scene di posisi terakhirnya
function onSelectEnd(event) {
  const controller = event.target;
  const obj = controller.userData.selected;
  if (obj) {
    scene.attach(obj); // posisi dunia tetap terjaga
    controller.userData.selected = undefined;
    log('RELEASE: ' + obj.geometry.type);
  }
}

// Grip ditekan: ganti bentuk dan warna objek yang disorot
function onSqueezeStart(event) {
  const controller = event.target;
  const hits = getIntersections(controller);
  if (hits.length > 0) {
    const name = changeShape(hits[0].object);
    pulse(controller, 0.3, 50);
    log('SQUEEZE: bentuk jadi ' + name);
  }
}

// ===== Bagian E: loop render (hover, skala, gerak desktop) =====
function render() {
  const delta = clock.getDelta();

  // Reset sorotan semua objek
  interactables.forEach((o) => o.material.emissive.setHex(0x000000));

  controllers.forEach((c) => {
    const held = c.userData.selected;
    if (held) {
      // Objek sedang digenggam: sorot dan izinkan ubah skala dengan thumbstick
      held.material.emissive.setHex(0x222222);
      const gp = c.userData.gamepad;
      if (gp && gp.axes.length >= 4) {
        const y = gp.axes[3]; // sumbu Y thumbstick
        if (Math.abs(y) > 0.15) { // abaikan drift kecil
          held.scale.multiplyScalar(1 - y * 0.02).clampScalar(0.3, 3);
        }
      }
    } else if (c.children.length > 0) {
      // Controller sudah terhubung dan tidak memegang apa pun: cek hover
      const hits = getIntersections(c);
      if (hits.length > 0) hits[0].object.material.emissive.setHex(0x444444);
    }
  });

  if (!renderer.xr.isPresenting) updateDesktopCamera(delta);
  renderer.render(scene, camera);
}

// ===== Bagian F: kontrol desktop (drag mouse + WASD) dan klik objek =====
function setupDesktopControls() {
  window.addEventListener('keydown', (e) => { keys[e.code] = true; });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  renderer.domElement.addEventListener('pointerdown', (e) => {
    dragging = true;
    dragDist = 0;
    lastX = e.clientX;
    lastY = e.clientY;
  });

  window.addEventListener('pointermove', (e) => {
    if (!dragging || renderer.xr.isPresenting) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    dragDist += Math.abs(dx) + Math.abs(dy);
    yaw -= dx * LOOK_SPEED;
    pitch -= dy * LOOK_SPEED;
    pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch));
  });

  window.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    // Gerakan mouse kecil dianggap klik, bukan drag
    if (dragDist < 5) onClickObject(e);
  });
}

function updateDesktopCamera(delta) {
  camera.rotation.set(pitch, yaw, 0);

  const forward = (keys['KeyW'] || keys['ArrowUp'] ? 1 : 0) - (keys['KeyS'] || keys['ArrowDown'] ? 1 : 0);
  const strafe = (keys['KeyD'] || keys['ArrowRight'] ? 1 : 0) - (keys['KeyA'] || keys['ArrowLeft'] ? 1 : 0);
  if (forward === 0 && strafe === 0) return;

  const step = MOVE_SPEED * delta;
  // Gerak mendatar mengikuti arah hadap (yaw), tinggi mata tetap
  camera.position.x += (-Math.sin(yaw) * forward + Math.cos(yaw) * strafe) * step;
  camera.position.z += (-Math.cos(yaw) * forward - Math.sin(yaw) * strafe) * step;
}

// Klik mouse pada objek: ganti bentuk dan warna
function onClickObject(e) {
  if (renderer.xr.isPresenting) return;
  pointer.set(
    (e.clientX / window.innerWidth) * 2 - 1,
    -(e.clientY / window.innerHeight) * 2 + 1
  );
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(interactables, false);
  if (hits.length > 0) {
    const name = changeShape(hits[0].object);
    log('CLICK (desktop): bentuk jadi ' + name);
  }
}


// ===== Langkah 9: panggil init() sekali saja, paling bawah =====
init();
