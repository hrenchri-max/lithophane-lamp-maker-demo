// Lithophane geometry + STL / 3MF writers. Pure functions, units = millimetres, Z up.
//
// The mesh is a closed solid: a relief surface (thickness follows image darkness),
// a smooth back / inner surface, and side walls (open panels) or top and bottom
// rims (cylinder). Every edge is shared by exactly two triangles.

export const PLATES = [
  { id: 'x1', label: 'Bambu Lab X1 / P1 / A1', size: [256, 256, 256] },
  { id: 'a1mini', label: 'Bambu Lab A1 mini', size: [180, 180, 180] },
];

// Draw the source into a w x h canvas (cover crop) and return luminance 0..1.
export function sampleLuminance(source, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, h);
  const sw = source.width, sh = source.height;
  const s = Math.max(w / sw, h / sh);
  const dw = sw * s, dh = sh * s;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, (w - dw) / 2, (h - dh) / 2, dw, dh);
  const d = g.getImageData(0, 0, w, h).data;
  const L = new Float32Array(w * h);
  for (let k = 0, p = 0; k < L.length; k++, p += 4) {
    L[k] = (0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]) / 255;
  }
  return L;
}

function bilinear(L, cw, ch, px, py, wrapX) {
  py = Math.min(ch - 1, Math.max(0, py));
  let x0 = Math.floor(px), y0 = Math.floor(py);
  const fx = px - x0, fy = py - y0;
  let x1 = x0 + 1;
  const y1 = Math.min(ch - 1, y0 + 1);
  if (wrapX) { x0 = ((x0 % cw) + cw) % cw; x1 = ((x1 % cw) + cw) % cw; }
  else { x0 = Math.min(cw - 1, Math.max(0, x0)); x1 = Math.min(cw - 1, Math.max(0, x1)); }
  const a = L[y0 * cw + x0], b = L[y0 * cw + x1], c = L[y1 * cw + x0], d = L[y1 * cw + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/**
 * p = { shape: 'flat'|'curved'|'cylinder', width, height, curveAngle, innerDiameter, copies,
 *       tmin, tmax, border, res (samples per mm), brightness (-0.5..0.5), contrast (0.5..2), invert }
 */
export function buildLithophane(p, source) {
  const res = p.res;
  const tmin = Math.max(0.2, p.tmin);
  const tmax = Math.max(tmin + 0.1, p.tmax);
  const H = p.height;
  const cyl = p.shape === 'cylinder';
  const curved = p.shape === 'curved';
  const b = Math.max(0, Math.min(p.border, H / 2 - 1, cyl ? Infinity : p.width / 2 - 1));
  const k = cyl ? Math.max(1, Math.round(p.copies || 1)) : 1;

  let W, R = 0, alpha = 0, nx;
  if (cyl) {
    R = p.innerDiameter / 2;
    W = Math.PI * p.innerDiameter;               // inner circumference
    nx = Math.max(48, Math.round(W * res));      // columns wrap, no duplicate seam column
  } else {
    W = p.width;
    nx = Math.max(4, Math.round(W * res) + 1);
    if (curved) { alpha = (p.curveAngle * Math.PI) / 180; R = W / alpha; } // arc length = width
  }
  const ny = Math.max(4, Math.round(H * res) + 1);

  // Image area and its luminance grid
  const imgW = cyl ? W / k : W - 2 * b;
  const imgH = H - 2 * b;
  const cw = Math.max(2, Math.round(imgW * res));
  const ch = Math.max(2, Math.round(imgH * res));
  const L = sampleLuminance(source, cw, ch);

  const nv = nx * ny;
  const T = new Float32Array(nv);
  const dz = H / (ny - 1);
  const dxs = cyl ? 0 : W / (nx - 1);
  for (let j = 0; j < ny; j++) {
    const z = H - j * dz;
    const vy = (H - z - b) / imgH;
    for (let i = 0; i < nx; i++) {
      let t = tmax;
      let ux, inside;
      if (cyl) { ux = ((i / nx) * k) % 1; inside = vy >= -1e-9 && vy <= 1 + 1e-9; }
      else { ux = (i * dxs - b) / imgW; inside = ux >= -1e-9 && ux <= 1 + 1e-9 && vy >= -1e-9 && vy <= 1 + 1e-9; }
      if (inside) {
        let l = bilinear(L, cw, ch, ux * cw - 0.5, vy * ch - 0.5, cyl);
        l = (l - 0.5) * p.contrast + 0.5 + p.brightness;
        l = Math.min(1, Math.max(0, l));
        if (p.invert) l = 1 - l;
        t = tmin + (tmax - tmin) * (1 - l);        // darker pixel = thicker = blocks more light
      }
      T[j * nx + i] = t;
    }
  }

  // Vertices: front (relief) block then back (smooth) block
  const pos = new Float32Array(nv * 2 * 3);
  for (let j = 0; j < ny; j++) {
    const z = H - j * dz;
    for (let i = 0; i < nx; i++) {
      const v = j * nx + i, t = T[v];
      const f = v * 3, bk = (nv + v) * 3;
      if (!cyl && !curved) {
        const x = -W / 2 + i * dxs;
        pos[f] = x; pos[f + 1] = -t; pos[f + 2] = z;
        pos[bk] = x; pos[bk + 1] = 0; pos[bk + 2] = z;
      } else {
        const phi = cyl
          ? -Math.PI / 2 + (i / nx - 0.5 / k) * 2 * Math.PI   // a copy is centred on the front (-Y)
          : -Math.PI / 2 - alpha / 2 + (i / (nx - 1)) * alpha;
        const c = Math.cos(phi), s = Math.sin(phi);
        pos[f] = (R + t) * c; pos[f + 1] = (R + t) * s; pos[f + 2] = z;
        pos[bk] = R * c; pos[bk + 1] = R * s; pos[bk + 2] = z;
      }
    }
  }

  // Triangles
  const quadsX = cyl ? nx : nx - 1;
  const nb = cyl ? 2 * nx : 2 * (nx - 1) + 2 * (ny - 1);
  const nTri = 4 * quadsX * (ny - 1) + 2 * nb;
  const idx = new Uint32Array(nTri * 3);
  let o = 0;
  const F = (i, j) => j * nx + i;
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < quadsX; i++) {
      const i1 = (i + 1) % nx;
      const a = F(i, j), bq = F(i1, j), c = F(i1, j + 1), d = F(i, j + 1);
      idx[o++] = a; idx[o++] = bq; idx[o++] = c;
      idx[o++] = a; idx[o++] = c; idx[o++] = d;
      idx[o++] = a + nv; idx[o++] = c + nv; idx[o++] = bq + nv;
      idx[o++] = a + nv; idx[o++] = d + nv; idx[o++] = c + nv;
    }
  }
  const wall = (pp, q) => {
    idx[o++] = q; idx[o++] = pp; idx[o++] = pp + nv;
    idx[o++] = q; idx[o++] = pp + nv; idx[o++] = q + nv;
  };
  if (cyl) {
    for (let i = 0; i < nx; i++) wall(F(i, 0), F((i + 1) % nx, 0));
    for (let i = 0; i < nx; i++) wall(F((i + 1) % nx, ny - 1), F(i, ny - 1));
  } else {
    for (let i = 0; i < nx - 1; i++) wall(F(i, 0), F(i + 1, 0));
    for (let j = 0; j < ny - 1; j++) wall(F(nx - 1, j), F(nx - 1, j + 1));
    for (let i = nx - 2; i >= 0; i--) wall(F(i + 1, ny - 1), F(i, ny - 1));
    for (let j = ny - 2; j >= 0; j--) wall(F(0, j + 1), F(0, j));
  }

  // Outward orientation: signed volume must be positive
  let vol = signedVolume(pos, idx);
  if (vol < 0) {
    for (let t = 0; t < idx.length; t += 3) { const s = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = s; }
    vol = -vol;
  }

  // Centre on X/Y, sit on Z = 0
  const bb = bbox(pos);
  const cx = (bb.min[0] + bb.max[0]) / 2, cy = (bb.min[1] + bb.max[1]) / 2, mz = bb.min[2];
  for (let q = 0; q < pos.length; q += 3) { pos[q] -= cx; pos[q + 1] -= cy; pos[q + 2] -= mz; }
  const size = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]];

  // Light transmission per vertex (for the backlit preview), 0 = blocked, 1 = thinnest
  const kAtt = 1.25;
  const tr = new Float32Array(nv * 2);
  const lo = Math.exp(-kAtt * (tmax - tmin));
  for (let v = 0; v < nv; v++) {
    const e = (Math.exp(-kAtt * (T[v] - tmin)) - lo) / (1 - lo);
    tr[v] = e; tr[nv + v] = e;
  }

  return {
    positions: pos, index: idx, transmission: tr,
    stats: {
      shape: p.shape, columns: nx, rows: ny, vertices: nv * 2, triangles: nTri,
      size, volume: vol, innerDiameter: cyl ? p.innerDiameter : null,
      tmin, tmax, border: b, res, imageArea: [cyl ? W : W - 2 * b, imgH],
    },
  };
}

export function signedVolume(pos, idx) {
  let v = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
    const bx = pos[b], by = pos[b + 1], bz = pos[b + 2];
    const cx = pos[c], cy = pos[c + 1], cz = pos[c + 2];
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

export function bbox(pos) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let q = 0; q < pos.length; q += 3) {
    for (let a = 0; a < 3; a++) { const x = pos[q + a]; if (x < min[a]) min[a] = x; if (x > max[a]) max[a] = x; }
  }
  return { min, max };
}

// ---------- STL (binary) ----------
export function toSTL(pos, idx, title) {
  const n = idx.length / 3;
  const buf = new ArrayBuffer(84 + 50 * n);
  const dv = new DataView(buf);
  const head = ('Lithophane Lamp Maker ' + (title || '')).slice(0, 79);
  for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i) & 0x7f);
  dv.setUint32(80, n, true);
  let off = 84;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    dv.setFloat32(off, nx, true); dv.setFloat32(off + 4, ny, true); dv.setFloat32(off + 8, nz, true);
    off += 12;
    for (const v of [a, b, c]) {
      dv.setFloat32(off, pos[v], true); dv.setFloat32(off + 4, pos[v + 1], true); dv.setFloat32(off + 8, pos[v + 2], true);
      off += 12;
    }
    dv.setUint16(off, 0, true); off += 2;
  }
  return new Blob([buf], { type: 'model/stl' });
}

// ---------- 3MF (zip package) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crcUpdate(crc, bytes) {
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return crc;
}

async function packEntry(name, chunks) {
  // chunks: iterable of Uint8Array; returns deflated entry with CRC and sizes
  let crc = 0xffffffff, size = 0;
  if (typeof CompressionStream === 'undefined') {
    const parts = [];
    for (const c of chunks) { crc = crcUpdate(crc, c); size += c.length; parts.push(c); }
    const data = new Uint8Array(await new Blob(parts).arrayBuffer());
    return { name, data, crc: (crc ^ 0xffffffff) >>> 0, size, method: 0 };
  }
  const cs = new CompressionStream('deflate-raw');
  const out = new Response(cs.readable).arrayBuffer();
  const w = cs.writable.getWriter();
  for (const c of chunks) { crc = crcUpdate(crc, c); size += c.length; await w.write(c); }
  await w.close();
  const data = new Uint8Array(await out);
  return { name, data, crc: (crc ^ 0xffffffff) >>> 0, size, method: 8 };
}

function zipBlob(entries) {
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const nm = enc.encode(e.name);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0, true);
    h.setUint16(8, e.method, true); h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true);
    h.setUint32(14, e.crc, true); h.setUint32(18, e.data.length, true); h.setUint32(22, e.size, true);
    h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
    parts.push(h.buffer, nm, e.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0, true);
    c.setUint16(10, e.method, true); c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true);
    c.setUint32(16, e.crc, true); c.setUint32(20, e.data.length, true); c.setUint32(24, e.size, true);
    c.setUint16(28, nm.length, true); c.setUint16(30, 0, true); c.setUint16(32, 0, true);
    c.setUint16(34, 0, true); c.setUint16(36, 0, true); c.setUint32(38, 0, true); c.setUint32(42, offset, true);
    central.push(c.buffer, nm);
    offset += 30 + nm.length + e.data.length;
  }
  let cdSize = 0;
  for (const c of central) cdSize += c.byteLength;
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'model/3mf' });
}

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const num = (v) => { const s = v.toFixed(3); return s.indexOf('.') >= 0 ? s.replace(/0+$/, '').replace(/\.$/, '') : s; };

export async function to3MF(pos, idx, opts = {}) {
  const enc = new TextEncoder();
  const name = esc(opts.name || 'Lithophane');
  const cx = opts.plateCenter ?? 128, cy = opts.plateCenter ?? 128;
  function* model() {
    yield enc.encode(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n' +
      ' <metadata name="Title">' + name + '</metadata>\n' +
      ' <metadata name="Application">Lithophane Lamp Maker</metadata>\n' +
      ' <resources>\n  <object id="1" type="model" name="' + name + '">\n   <mesh>\n    <vertices>\n');
    const nv = pos.length / 3;
    const step = 20000;
    for (let s = 0; s < nv; s += step) {
      let str = '';
      const e = Math.min(nv, s + step);
      for (let v = s; v < e; v++) str += '     <vertex x="' + num(pos[v * 3]) + '" y="' + num(pos[v * 3 + 1]) + '" z="' + num(pos[v * 3 + 2]) + '"/>\n';
      yield enc.encode(str);
    }
    yield enc.encode('    </vertices>\n    <triangles>\n');
    const nt = idx.length / 3;
    for (let s = 0; s < nt; s += step) {
      let str = '';
      const e = Math.min(nt, s + step);
      for (let t = s; t < e; t++) str += '     <triangle v1="' + idx[t * 3] + '" v2="' + idx[t * 3 + 1] + '" v3="' + idx[t * 3 + 2] + '"/>\n';
      yield enc.encode(str);
    }
    yield enc.encode('    </triangles>\n   </mesh>\n  </object>\n </resources>\n <build>\n' +
      '  <item objectid="1" transform="1 0 0 0 1 0 0 0 1 ' + num(cx) + ' ' + num(cy) + ' 0"/>\n </build>\n</model>\n');
  }
  const ct = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n' +
    ' <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n' +
    ' <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n' +
    '</Types>\n';
  const rels = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
    ' <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n' +
    '</Relationships>\n';
  const entries = [
    await packEntry('[Content_Types].xml', [enc.encode(ct)]),
    await packEntry('_rels/.rels', [enc.encode(rels)]),
    await packEntry('3D/3dmodel.model', model()),
  ];
  return zipBlob(entries);
}
