// Wires the page: pick a layout and a grade, type the title, click a
// panel to re-crop it, drop in your own photos, export the poster as a
// PNG in 1080x1080, 1080x1350 or 1920x1080. Three live mini-previews
// show every post size at once. A `?shot=` query sets up a fixed scene
// for a screenshot instead (./shots.js).

import { SAMPLES, sampleById, characterSamples } from './samples.js';
import { LAYOUTS, layoutById, panelsFor } from './layouts.js';
import { GRADES } from './grades.js';
import { renderPoster } from './render.js';
import { detectFaceAnchor, scoreFace } from './photos.js';
import { TITLE_PRESETS, SIZES, sizeById, TITLE_FONTS, SCRIPT_FONTS, EDITION_TAG } from './presets.js';
import { exportPosterPNG, exportAllSizes, downloadBlob } from './exporter.js';
import { shotScene, markShotReady } from './shots.js';

const canvas = document.getElementById('poster');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const query = new URLSearchParams(location.search);
const scene = query.get('shot') ? shotScene(query) : null;

/** The poster's state: everything a render needs, nothing more. */
let state = defaultState();
let images = new Map();
let selectedPanel = -1;
let history = [];
let historyAt = -1;

function defaultState(preset = 0) {
  const p = TITLE_PRESETS[preset];
  return {
    layoutId: 'cast-mosaic',
    gradeId: 'sunset-gold',
    sizeId: '1920x1080',
    title: p.title,
    subtitle: p.subtitle,
    tagline: p.tagline,
    quote: p.quote,
    source: p.source,
    edition: EDITION_TAG,
    titleFont: 'Anton',
    scriptFont: 'Pacifico',
    assignments: {},
    tweaks: {},
  };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

async function loadSamples() {
  for (const s of SAMPLES) {
    const img = await loadImage(s.src);
    images.set(s.id, { img, face: s.face, faceScore: s.faceScore });
  }
}

/**
 * Auto-fill by face quality: the best face becomes the first (hero)
 * panel, the next-best faces fill the other panels, scenes fill what
 * is left. Uploads join the ranking with the score their skin scan gave
 * them, so a stranger's best photo can take the hero slot too.
 */
function autoFill() {
  const layout = layoutById(state.layoutId);
  const ranked = [...images.entries()]
    .map(([id, entry]) => ({ id, score: entry.faceScore ?? 0.5 }))
    .sort((a, b) => b.score - a.score);
  const faces = ranked.filter((r) => r.score >= 0.85);
  const rest = ranked.filter((r) => r.score < 0.85);
  const order = [...faces, ...rest];
  state.assignments = {};
  layout.panels.forEach((panel, i) => {
    state.assignments[i] = order[i % order.length].id;
  });
  state.tweaks = {};
}

/** Preview resolution for the editor canvas, from the chosen post size. */
function previewSize() {
  const size = sizeById(state.sizeId);
  const scale = size.w >= size.h ? 960 / size.w : 720 / size.w;
  return { w: Math.round(size.w * scale), h: Math.round(size.h * scale) };
}

let rafPending = false;
function redraw() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    const size = scene?.mode === 'cover'
      ? { w: window.innerWidth, h: window.innerHeight }
      : previewSize();
    if (canvas.width !== size.w || canvas.height !== size.h) {
      canvas.width = size.w;
      canvas.height = size.h;
    }
    renderPoster(ctx, state, images, size.w, size.h);
    drawSelection(size.w, size.h);
    renderMinis();
  });
}

/** The three live mini-previews: 16:9, 4:5 and 1:1 of the same poster. */
function renderMinis() {
  const minis = [
    ['miniWide', 192, 108],
    ['miniPortrait', 144, 180],
    ['miniSquare', 160, 160],
  ];
  for (const [id, w, h] of minis) {
    const cv = document.getElementById(id);
    if (!cv) continue;
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    renderPoster(cv.getContext('2d'), state, images, w, h);
  }
}

function drawSelection(W, H) {
  if (selectedPanel < 0) return;
  const geo = panelsFor(layoutById(state.layoutId), W, H);
  const rect = geo.panels[selectedPanel];
  if (!rect) return;
  ctx.save();
  ctx.setLineDash([10, 8]);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffd76a';
  ctx.strokeRect(rect.x - 4, rect.y - 4, rect.w + 8, rect.h + 8);
  ctx.restore();
  const label = document.getElementById('panelLabel');
  if (label) {
    label.textContent = `Panel ${selectedPanel + 1} selected — zoom, nudge, flip and photo buttons below apply to it.`;
  }
}

function commit() {
  history = history.slice(0, historyAt + 1);
  history.push(JSON.stringify(state));
  if (history.length > 50) history.shift();
  historyAt = history.length - 1;
  redraw();
}

function restore(json) {
  state = JSON.parse(json);
  syncControls();
  redraw();
}

function syncControls() {
  document.getElementById('titleInput').value = state.title;
  document.getElementById('subtitleInput').value = state.subtitle;
  document.getElementById('quoteInput').value = state.quote;
  document.getElementById('taglineInput').value = state.tagline;
  document.getElementById('titleFontSelect').value = state.titleFont;
  document.getElementById('scriptFontSelect').value = state.scriptFont;
  document.querySelectorAll('#layoutRow button').forEach((b) => {
    b.classList.toggle('on', b.dataset.id === state.layoutId);
  });
  document.querySelectorAll('#gradeRow button').forEach((b) => {
    b.classList.toggle('on', b.dataset.id === state.gradeId);
  });
  document.querySelectorAll('#sizeRow button').forEach((b) => {
    b.classList.toggle('on', b.dataset.id === state.sizeId);
  });
}

function buildButtons() {
  const layoutRow = document.getElementById('layoutRow');
  for (const l of LAYOUTS) {
    const b = document.createElement('button');
    b.textContent = l.name;
    b.dataset.id = l.id;
    b.onclick = () => { state.layoutId = l.id; autoFill(); selectedPanel = -1; commit(); syncControls(); };
    layoutRow.appendChild(b);
  }
  const gradeRow = document.getElementById('gradeRow');
  for (const g of GRADES) {
    const b = document.createElement('button');
    b.textContent = g.name;
    b.dataset.id = g.id;
    b.onclick = () => { state.gradeId = g.id; commit(); syncControls(); };
    gradeRow.appendChild(b);
  }
  const sizeRow = document.getElementById('sizeRow');
  for (const s of SIZES) {
    const b = document.createElement('button');
    b.textContent = s.label;
    b.dataset.id = s.id;
    b.onclick = () => { state.sizeId = s.id; commit(); syncControls(); };
    sizeRow.appendChild(b);
  }
  const strip = document.getElementById('sampleStrip');
  for (const s of SAMPLES) {
    strip.appendChild(sampleButton(s.id, s.src, `${s.name} — ${s.role}`));
  }
  const presetSel = document.getElementById('presetSelect');
  TITLE_PRESETS.forEach((p, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = `${p.title} — ${p.subtitle}`;
    presetSel.appendChild(o);
  });
  presetSel.onchange = () => {
    const p = TITLE_PRESETS[Number(presetSel.value)];
    state.title = p.title;
    state.subtitle = p.subtitle;
    state.tagline = p.tagline;
    state.quote = p.quote;
    state.source = p.source;
    commit();
    syncControls();
  };
  const titleFontSel = document.getElementById('titleFontSelect');
  for (const f of TITLE_FONTS) {
    const o = document.createElement('option');
    o.value = f.id;
    o.textContent = f.label;
    titleFontSel.appendChild(o);
  }
  titleFontSel.onchange = () => { state.titleFont = titleFontSel.value; commit(); };
  const scriptFontSel = document.getElementById('scriptFontSelect');
  for (const f of SCRIPT_FONTS) {
    const o = document.createElement('option');
    o.value = f.id;
    o.textContent = f.label;
    scriptFontSel.appendChild(o);
  }
  scriptFontSel.onchange = () => { state.scriptFont = scriptFontSel.value; commit(); };
}

function sampleButton(id, src, label) {
  const b = document.createElement('button');
  b.className = 'sample';
  b.dataset.id = id;
  const img = document.createElement('img');
  img.src = src;
  img.alt = label;
  b.appendChild(img);
  const span = document.createElement('span');
  span.textContent = label;
  b.appendChild(span);
  b.onclick = () => {
    const target = selectedPanel >= 0 ? selectedPanel : 0;
    state.assignments[target] = id;
    commit();
  };
  return b;
}

/** A dropped or pasted photo joins the cast, face-scored like a sample. */
async function handleFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    const url = URL.createObjectURL(file);
    const img = await loadImage(url);
    const id = `up-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const face = detectFaceAnchor(img);
    const faceScore = scoreFace(img, face);
    images.set(id, { img, face, faceScore });
    const name = file.name.replace(/\.[^.]+$/, '').slice(0, 18) || 'Your photo';
    document.getElementById('sampleStrip').appendChild(sampleButton(id, url, `${name} — your photo`));
    state.assignments[0] = id;
    statusEl.textContent = `Loaded ${file.name} — face anchor found (score ${faceScore.toFixed(2)}), set as the hero.`;
  }
  commit();
}

function wireControls() {
  document.getElementById('titleInput').addEventListener('input', (e) => { state.title = e.target.value; redraw(); });
  document.getElementById('titleInput').addEventListener('change', commit);
  document.getElementById('subtitleInput').addEventListener('input', (e) => { state.subtitle = e.target.value; redraw(); });
  document.getElementById('subtitleInput').addEventListener('change', commit);
  document.getElementById('taglineInput').addEventListener('input', (e) => { state.tagline = e.target.value; redraw(); });
  document.getElementById('taglineInput').addEventListener('change', commit);
  document.getElementById('quoteInput').addEventListener('input', (e) => { state.quote = e.target.value; redraw(); });
  document.getElementById('quoteInput').addEventListener('change', commit);

  document.getElementById('zoomRange').addEventListener('input', (e) => {
    applyTweak('zoom', Number(e.target.value));
  });
  document.getElementById('zoomRange').addEventListener('change', commit);
  document.getElementById('nudgeX').addEventListener('input', (e) => {
    applyTweak('ox', Number(e.target.value));
  });
  document.getElementById('nudgeX').addEventListener('change', commit);
  document.getElementById('nudgeY').addEventListener('input', (e) => {
    applyTweak('oy', Number(e.target.value));
  });
  document.getElementById('nudgeY').addEventListener('change', commit);

  document.getElementById('upload').addEventListener('change', (e) => {
    handleFiles(e.target.files);
  });
  // Drop or paste a photo anywhere on the page.
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
  });
  document.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) handleFiles(files);
  });

  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * canvas.width;
    const y = ((e.clientY - r.top) / r.height) * canvas.height;
    const geo = panelsFor(layoutById(state.layoutId), canvas.width, canvas.height);
    selectedPanel = -1;
    for (let i = geo.panels.length - 1; i >= 0; i--) {
      const p = geo.panels[i];
      if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) {
        selectedPanel = i;
        break;
      }
    }
    redraw();
  });

  document.getElementById('flipBtn').addEventListener('click', () => {
    if (selectedPanel < 0) { statusEl.textContent = 'Click a panel first, then Flip.'; return; }
    const t = state.tweaks[selectedPanel] ?? {};
    t.flip = !t.flip;
    state.tweaks[selectedPanel] = t;
    commit();
  });
  document.getElementById('prevPhotoBtn').addEventListener('click', () => stepPhoto(-1));
  document.getElementById('nextPhotoBtn').addEventListener('click', () => stepPhoto(1));
  document.getElementById('resetBtn').addEventListener('click', () => {
    state = defaultState();
    autoFill();
    selectedPanel = -1;
    commit();
    syncControls();
    statusEl.textContent = 'Reset to the default poster.';
  });
  document.getElementById('autofillBtn').addEventListener('click', () => {
    autoFill();
    commit();
    statusEl.textContent = 'Auto-filled by face quality — best face is the hero.';
  });

  document.getElementById('exportBtn').addEventListener('click', async () => {
    const size = sizeById(state.sizeId);
    statusEl.textContent = `Exporting ${size.id}…`;
    const blob = await exportPosterPNG(state, images, size.w, size.h);
    downloadBlob(blob, `vice-heat-${size.id}.png`);
    statusEl.textContent = `Saved vice-heat-${size.id}.png (${size.w}×${size.h}).`;
  });
  document.getElementById('exportAllBtn').addEventListener('click', async () => {
    statusEl.textContent = 'Exporting all three sizes…';
    await exportAllSizes(state, images, SIZES, (s) => {
      statusEl.textContent = `Saved vice-heat-${s.id}.png.`;
    });
    statusEl.textContent = 'Saved all three sizes.';
  });
  document.getElementById('autoBtn').addEventListener('click', () => {
    const li = Math.floor(Math.random() * LAYOUTS.length);
    const gi = Math.floor(Math.random() * GRADES.length);
    const pi = Math.floor(Math.random() * TITLE_PRESETS.length);
    const p = TITLE_PRESETS[pi];
    state.layoutId = LAYOUTS[li].id;
    state.gradeId = GRADES[gi].id;
    state.title = p.title;
    state.subtitle = p.subtitle;
    state.tagline = p.tagline;
    state.quote = p.quote;
    state.source = p.source;
    autoFill();
    selectedPanel = -1;
    commit();
    syncControls();
    statusEl.textContent = `Auto Poster: ${LAYOUTS[li].name} + ${GRADES[gi].name} + “${p.title}”.`;
  });
  document.getElementById('undoBtn').addEventListener('click', () => {
    if (historyAt > 0) { historyAt--; restore(history[historyAt]); }
  });
  document.getElementById('redoBtn').addEventListener('click', () => {
    if (historyAt < history.length - 1) { historyAt++; restore(history[historyAt]); }
  });
}

function stepPhoto(dir) {
  if (selectedPanel < 0) { statusEl.textContent = 'Click a panel first, then pick its photo.'; return; }
  const chars = characterSamples().map((s) => s.id);
  const current = state.assignments[selectedPanel] ?? layoutById(state.layoutId).panels[selectedPanel].photo;
  const i = chars.indexOf(current);
  const next = chars[(i + dir + chars.length) % chars.length];
  state.assignments[selectedPanel] = next;
  const s = sampleById(next);
  statusEl.textContent = `Panel ${selectedPanel + 1} is now ${s.name} — ${s.role}.`;
  commit();
}

function applyTweak(key, value) {
  if (selectedPanel < 0) return;
  const t = state.tweaks[selectedPanel] ?? {};
  t[key] = value;
  state.tweaks[selectedPanel] = t;
  redraw();
}

async function start() {
  buildButtons();
  wireControls();
  if (scene) {
    const p = TITLE_PRESETS[scene.preset];
    state = defaultState(scene.preset);
    state.layoutId = scene.layout;
    state.gradeId = scene.grade;
    state.sizeId = scene.size;
    if (scene.mode === 'cover') document.body.classList.add('shot-cover');
  }
  syncControls();
  await document.fonts.load('100px Anton');
  await document.fonts.load('100px "Bebas Neue"');
  await document.fonts.load('40px Pacifico');
  await document.fonts.load('40px Sacramento');
  await document.fonts.ready;
  await loadSamples();
  autoFill();
  commit();
  redraw();
  statusEl.textContent = 'Ready — Cast Mosaic + Sunset Gold. Click a panel to crop it, then export.';
  if (scene) markShotReady();
}

start();
