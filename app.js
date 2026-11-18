import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildLithophane, toSTL, to3MF, PLATES } from './litho.js';

const $ = (id) => document.getElementById(id);
const api = (window.__litho = { ready: false, buildCount: 0, building: false, stats: null, params: null, error: null });

// ---------- sample image (drawn here, no external photo) ----------
function drawSample() {
  const c = document.createElement('canvas');
  c.width = 1200; c.height = 900;
  const g = c.getContext('2d');
  const bg = g.createRadialGradient(600, 360, 40, 600, 430, 760);
  bg.addColorStop(0, '#ffffff'); bg.addColorStop(0.5, '#e4e4e4'); bg.addColorStop(1, '#7a7a7a');
  g.fillStyle = bg; g.fillRect(0, 0, 1200, 900);
  // light rays
  g.save(); g.translate(600, 380); g.globalAlpha = 0.18; g.fillStyle = '#ffffff';
  for (let a = 0; a < 16; a++) { g.rotate(Math.PI / 8); g.beginPath(); g.moveTo(0, 0); g.lineTo(900, -70); g.lineTo(900, 70); g.closePath(); g.fill(); }
  g.restore();
  // stars
  const star = (x, y, r) => { g.beginPath(); for (let i = 0; i < 10; i++) { const rr = i % 2 ? r * 0.45 : r; const a = -Math.PI / 2 + (i * Math.PI) / 5; g.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a)); } g.closePath(); g.fill(); };
  g.fillStyle = '#2a2a2a';
  star(220, 150, 34); star(980, 150, 34); star(140, 330, 22); star(1060, 330, 22);
  // football
  g.save(); g.translate(600, 395); g.rotate(-0.32);
  const rx = 340, ry = 185;
  const ball = new Path2D();
  ball.moveTo(-rx, 0);
  ball.bezierCurveTo(-rx * 0.62, -ry * 1.33, rx * 0.62, -ry * 1.33, rx, 0);
  ball.bezierCurveTo(rx * 0.62, ry * 1.33, -rx * 0.62, ry * 1.33, -rx, 0);
  g.shadowColor = 'rgba(0,0,0,0.45)'; g.shadowBlur = 40; g.shadowOffsetY = 18;
  const bf = g.createRadialGradient(-90, -95, 20, 0, 0, 400);
  bf.addColorStop(0, '#9a6a45'); bf.addColorStop(0.45, '#5a321b'); bf.addColorStop(1, '#1c0d05');
  g.fillStyle = bf; g.fill(ball);
  g.shadowColor = 'transparent';
  g.save(); g.clip(ball);
  g.fillStyle = '#f2f2f2';
  g.fillRect(-rx * 0.74, -ry * 1.3, 30, ry * 2.6); g.fillRect(rx * 0.74 - 30, -ry * 1.3, 30, ry * 2.6);
  const hl = g.createRadialGradient(-110, -110, 10, -110, -110, 190);
  hl.addColorStop(0, 'rgba(255,255,255,0.35)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = hl; g.fillRect(-rx, -ry * 1.3, rx * 2, ry * 2.6);
  g.restore();
  g.lineWidth = 8; g.strokeStyle = '#140904'; g.stroke(ball);
  g.strokeStyle = '#f7f7f7'; g.lineCap = 'round';
  g.lineWidth = 13; g.beginPath(); g.moveTo(-150, -12); g.quadraticCurveTo(0, -26, 150, -12); g.stroke();
  g.lineWidth = 11;
  for (let i = -3; i <= 3; i++) { const x = i * 40; g.beginPath(); g.moveTo(x, -50); g.lineTo(x, 22); g.stroke(); }
  g.restore();
  // lettering
  g.fillStyle = '#161616';
  g.font = '900 132px "Arial Black", "Segoe UI", Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.fillText('GAME DAY', 600, 820);
  g.fillRect(250, 838, 700, 12);
  return c;
}

// ---------- three.js scene ----------
const stage = $('stage');
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 1, 6000);
camera.up.set(0, 0, 1);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

const hemi = new THREE.HemisphereLight(0xffffff, 0x3a3a40, 1.25);
hemi.position.set(0, 0, 1);
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(-160, -260, 220);
const rim = new THREE.DirectionalLight(0xffe2b8, 0.9);
rim.position.set(220, 180, 120);
scene.add(hemi, key, rim);

const matLit = new THREE.MeshStandardMaterial({ color: 0xf2eee6, roughness: 0.62, metalness: 0 });
const matBacklit = new THREE.MeshBasicMaterial({ vertexColors: true });

let plateGrid = null;
function setPlate(size) {
  if (plateGrid) { scene.remove(plateGrid); plateGrid.geometry.dispose(); }
  plateGrid = new THREE.GridHelper(size, size / 16, 0x5a606b, 0x2c3038);
  plateGrid.rotation.x = Math.PI / 2;
  plateGrid.material.transparent = true;
  plateGrid.material.opacity = 0.55;
  scene.add(plateGrid);
}

let mesh = null;
let dirty = true;
function resize() {
  const r = stage.getBoundingClientRect();
  renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false);
  camera.aspect = r.width / Math.max(1, r.height);
  camera.updateProjectionMatrix();
  dirty = true;
}
new ResizeObserver(resize).observe(stage);
resize();

function frame(size) {
  const radius = Math.hypot(size[0], size[1], size[2]) / 2;
  const fov = (camera.fov * Math.PI) / 180;
  const fit = camera.aspect < 1 ? Math.atan(Math.tan(fov / 2) * camera.aspect) : fov / 2;
  const d = (radius / Math.sin(fit)) * 1.12;
  const target = new THREE.Vector3(0, 0, size[2] * 0.5);
  const dir = new THREE.Vector3(0.32, -1, 0.34).normalize();
  camera.position.copy(target).addScaledVector(dir, d);
  camera.near = Math.max(0.5, d / 100); camera.far = d * 20; camera.updateProjectionMatrix();
  controls.target.copy(target);
  controls.update();
}

// Render only when something changed (orbit, rebuild, resize): keeps phones cool.
const invalidate = () => { dirty = true; };
controls.addEventListener('change', invalidate);
(function loop() {
  requestAnimationFrame(loop);
  controls.update();
  if (dirty) { dirty = false; renderer.render(scene, camera); }
})();

// ---------- UI state ----------
let source = drawSample();
let sourceName = 'Built-in football artwork';
let backlit = true;
let last = null;
let lastShape = null;

function drawThumb() {
  const t = $('thumb'), g = t.getContext('2d');
  g.fillStyle = '#1b1f26'; g.fillRect(0, 0, t.width, t.height);
  const s = Math.min(t.width / source.width, t.height / source.height);
  const w = source.width * s, h = source.height * s;
  g.drawImage(source, (t.width - w) / 2, (t.height - h) / 2, w, h);
  $('photoName').textContent = sourceName;
}

function readParams() {
  const shape = $('shape').value;
  const n = (id, d) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : d; };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  return {
    shape,
    width: clamp(n('width', 120), 20, 250),
    height: clamp(shape === 'cylinder' ? n('heightCyl', 120) : n('height', 90), 20, 250),
    curveAngle: clamp(n('curveAngle', 120), 30, 180),
    innerDiameter: clamp(n('innerDiameter', 80), 30, 240),
    copies: parseInt($('copies').value, 10) || 1,
    tmin: clamp(n('tmin', 0.8), 0.4, 3),
    tmax: clamp(n('tmax', 3), 1, 8),
    border: clamp(n('border', 3), 0, 20),
    res: parseFloat($('res').value) || 3,
    brightness: n('brightness', 0) / 100,
    contrast: n('contrast', 100) / 100,
    invert: $('invert').checked,
  };
}

function syncVisibility() {
  const s = $('shape').value;
  document.querySelectorAll('.only-cyl').forEach((e) => (e.hidden = s !== 'cylinder'));
  document.querySelectorAll('.only-panel').forEach((e) => (e.hidden = s === 'cylinder'));
  document.querySelectorAll('.only-curved').forEach((e) => (e.hidden = s !== 'curved'));
  $('curveVal').textContent = $('curveAngle').value + '°';
  $('brightVal').textContent = (+$('brightness').value > 0 ? '+' : '') + $('brightness').value;
  $('contrastVal').textContent = $('contrast').value + '%';
}

function plateInfo() { return PLATES.find((p) => p.id === $('plate').value) || PLATES[0]; }

const fmt = (v, d = 1) => v.toFixed(d);
function renderStats(st) {
  const [x, y, z] = st.size;
  const grams = (st.volume / 1000) * 1.24;
  const sz = (v) => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1));
  const cell = (k, v, wide) => `<div class="stat${wide ? ' wide' : ''}"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  $('stats').innerHTML =
    cell('Size (W × D × H)', `${sz(x)} × ${sz(y)} × ${sz(z)} mm`, true) +
    (st.shape === 'cylinder'
      ? cell('Inner diameter', fmt(st.innerDiameter) + ' mm')
      : cell('Image area', `${sz(st.imageArea[0])} × ${sz(st.imageArea[1])} mm`)) +
    cell('Thickness', fmt(st.tmin) + ' to ' + fmt(st.tmax) + ' mm') +
    cell('Triangles', st.triangles.toLocaleString('en-US')) +
    cell('PLA at 100% infill', '≈ ' + Math.round(grams) + ' g');
  const sel = plateInfo().id;
  $('fits').innerHTML = PLATES.map((p) => {
    const over = st.size.map((v, i) => v - p.size[i]);
    const ok = over.every((v) => v <= 0);
    const axis = ['width', 'depth', 'height'];
    const why = ok
      ? `${p.size.join(' × ')} mm build volume, ${fmt(Math.min(...p.size.map((s, i) => s - st.size[i])))} mm to spare`
      : 'Too big: ' + over.map((v, i) => (v > 0 ? `${axis[i]} over by ${fmt(v)} mm` : null)).filter(Boolean).join(', ') + `. Max ${p.size[0]} mm per side.`;
    return `<div class="fit ${ok ? 'ok' : 'bad'} ${p.id === sel ? 'sel' : ''}"><div class="ic">${ok ? '✓' : '!'}</div><div class="t"><b>${ok ? 'Fits' : 'Does not fit'} ${p.label}</b><span>${why}</span></div></div>`;
  }).join('');
  const fitsSel = st.size.every((v, i) => v <= plateInfo().size[i]);
  $('stageInfo').innerHTML = `<b>${fmt(x)} × ${fmt(y)} × ${fmt(z)} mm</b> · ${st.triangles.toLocaleString('en-US')} triangles · ${fitsSel ? 'fits ' : 'too big for '}${plateInfo().label.replace('Bambu Lab ', '')}`;
}

function applyColors(geo, tr) {
  const n = tr.length;
  const col = new Float32Array(n * 3);
  const dark = [0.07, 0.035, 0.015], warm = [1.0, 0.82, 0.55];
  const lin = (v) => Math.pow(v, 2.2);
  for (let v = 0; v < n; v++) {
    const e = Math.pow(tr[v], 0.85);
    col[v * 3] = lin(dark[0] + (warm[0] - dark[0]) * e);
    col[v * 3 + 1] = lin(dark[1] + (warm[1] - dark[1]) * e);
    col[v * 3 + 2] = lin(dark[2] + (warm[2] - dark[2]) * e);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

function setBacklit(on) {
  backlit = on;
  $('backlitBtn').classList.toggle('on', on);
  $('backlitBtn').setAttribute('aria-pressed', String(on));
  stage.classList.toggle('backlit', on);
  stage.classList.toggle('lit', !on);
  if (mesh) mesh.material = on ? matBacklit : matLit;
  if (plateGrid) plateGrid.visible = !on;
  invalidate();
}

function rebuild() {
  api.building = true;
  $('busyText').textContent = 'Building mesh';
  $('busy').hidden = false;
  requestAnimationFrame(() => setTimeout(() => {
    try {
      const p = readParams();
      const t0 = performance.now();
      const r = buildLithophane(p, source);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(r.positions, 3));
      geo.setIndex(new THREE.BufferAttribute(r.index, 1));
      geo.computeVertexNormals();
      applyColors(geo, r.transmission);
      if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
      mesh = new THREE.Mesh(geo, backlit ? matBacklit : matLit);
      scene.add(mesh);
      setPlate(plateInfo().size[0]);
      if (plateGrid) plateGrid.visible = !backlit;
      if (lastShape !== p.shape) frame(r.stats.size);
      lastShape = p.shape;
      last = { params: p, result: r };
      r.stats.buildMs = Math.round(performance.now() - t0);
      renderStats(r.stats);
      invalidate();
      api.stats = r.stats; api.params = p; api.error = null;
    } catch (e) {
      console.error(e);
      api.error = String(e && e.message || e);
    } finally {
      api.building = false; api.ready = true; api.buildCount++;
      $('busy').hidden = true;
    }
  }, 0));
}

let timer = 0;
function schedule() { syncVisibility(); clearTimeout(timer); timer = setTimeout(rebuild, 180); }

document.querySelectorAll('.panel input, .panel select').forEach((el) => {
  if (el.id === 'file' || el.id === 'plate' || el.id === 'fitting') return;
  el.addEventListener(el.type === 'range' ? 'input' : 'change', schedule);
  if (el.type === 'number') el.addEventListener('input', schedule);
});
$('fitting').addEventListener('change', () => {
  const v = $('fitting').value;
  if (v !== 'custom') $('innerDiameter').value = v;
  schedule();
});
$('innerDiameter').addEventListener('input', () => {
  const v = $('innerDiameter').value;
  $('fitting').value = ['60', '80', '100'].includes(v) ? v : 'custom';
});
$('plate').addEventListener('change', () => { if (last) { setPlate(plateInfo().size[0]); plateGrid.visible = !backlit; renderStats(last.result.stats); invalidate(); } });
$('backlitBtn').addEventListener('click', () => setBacklit(!backlit));
$('resetView').addEventListener('click', () => last && frame(last.result.stats.size));
$('sampleBtn').addEventListener('click', () => { source = drawSample(); sourceName = 'Built-in football artwork'; drawThumb(); schedule(); });

async function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  try {
    const bmp = await createImageBitmap(file);
    source = bmp; sourceName = file.name;
    drawThumb(); schedule();
  } catch (e) { alert('That image could not be opened. Try a JPG or PNG.'); }
}
$('file').addEventListener('change', (e) => loadFile(e.target.files[0]));
['dragenter', 'dragover'].forEach((t) => stage.addEventListener(t, (e) => { e.preventDefault(); $('drop').hidden = false; }));
['dragleave', 'drop'].forEach((t) => stage.addEventListener(t, (e) => { e.preventDefault(); $('drop').hidden = true; }));
stage.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));

// ---------- export ----------
function fileBase() {
  const s = last.result.stats;
  return `lithophane-${s.shape}-${s.size.map((v) => Math.round(v)).join('x')}mm`;
}
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
let exporting = false;
async function doExport(kind) {
  if (!last || exporting || api.building) return;
  exporting = true;
  const btns = ['exportStl', 'export3mf', 'exportStlTop', 'export3mfTop'].map($);
  btns.forEach((b) => (b.disabled = true));
  $('busyText').textContent = kind === '3mf' ? 'Packing 3MF' : 'Writing STL';
  $('busy').hidden = false;
  await new Promise((r) => setTimeout(r, 30));
  try {
    const { positions, index } = last.result;
    if (kind === 'stl') download(toSTL(positions, index, fileBase()), fileBase() + '.stl');
    else download(await to3MF(positions, index, { name: fileBase(), plateCenter: plateInfo().size[0] / 2 }), fileBase() + '.3mf');
  } catch (e) {
    console.error(e); api.error = String(e && e.message || e);
  } finally {
    exporting = false;
    btns.forEach((b) => (b.disabled = false));
    $('busy').hidden = true;
  }
}
$('exportStl').addEventListener('click', () => doExport('stl'));
$('exportStlTop').addEventListener('click', () => doExport('stl'));
$('export3mf').addEventListener('click', () => doExport('3mf'));
$('export3mfTop').addEventListener('click', () => doExport('3mf'));

syncVisibility();
drawThumb();
setBacklit(true);
rebuild();
