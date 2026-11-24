// MeshBuilder -> THREE.BufferGeometry (Vertexfarben von sRGB nach linear)
import * as THREE from 'three';

export function toGeometry(mb, { srgbColors = true } = {}) {
  const g = new THREE.BufferGeometry();
  const n = mb.n;
  const pos = Float32Array.from(mb.pos), nor = Float32Array.from(mb.nor), uv = Float32Array.from(mb.uv);
  const col = new Float32Array(mb.col.length);
  if (srgbColors) for (let i = 0; i < col.length; i++) { const v = mb.col[i]; col[i] = v <= 0 ? 0 : Math.pow(v, 2.2); }
  else col.set(mb.col);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(n > 65535 ? Uint32Array.from(mb.idx) : Uint16Array.from(mb.idx), 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
