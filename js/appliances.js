// Бытовая техника, с которой взаимодействует призрак: телевизор и краны с водой
import * as THREE from 'three';
import { G, isClient, isHost, netSend } from './state.js';
import { mat, box, interactables, roomAt } from './world.js';
import { sfx } from './audio.js';

export const appliances = [];

export function buildAppliances(scene) {
  // телевизор в гостиной (экран поверх корпуса)
  const c = document.createElement('canvas'); c.width = 64; c.height = 48;
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.52), new THREE.MeshBasicMaterial({ color: 0x050505 }));
  scr.position.set(0.345, 0.85, 7.8); scr.rotation.y = Math.PI / 2;
  scene.add(scr);
  const tv = { kind: 'tv', name: 'Телевизор', x: 0.5, z: 7.8, on: false, mesh: scr, canvas: c, tex, nextFrame: 0, nextSnd: 0 };
  scr.userData.kind = 'appliance'; scr.userData.app = tv;
  interactables.push(scr);
  appliances.push(tv);

  // краны: кухня, раковина и ванна в ванной
  const taps = [
    { name: 'Кран на кухне', x: 2.6, y: 0.95, z: 0.32, sink: true },
    { name: 'Кран в ванной', x: 13.2, y: 0.85, z: 5.86, sink: false },
    { name: 'Кран ванны', x: 15.75, y: 0.62, z: 4.55, sink: false },
  ];
  for (const t of taps) {
    const g = new THREE.Group();
    g.position.set(t.x, t.y, t.z);
    if (t.sink) box(0.4, 0.02, 0.3, 0x9aa0a6, 0, 0.005, 0.08, g);
    const pipe = box(0.03, 0.16, 0.03, 0xb8c0c8, 0, 0.08, 0, g);
    const spout = box(0.03, 0.03, 0.12, 0xb8c0c8, 0, 0.15, 0.05, g);
    const handle = box(0.07, 0.015, 0.015, 0xd04040, 0, 0.17, -0.01, g);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.14, 5), new THREE.MeshBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.6 }));
    water.position.set(0, 0.07, 0.1); water.visible = false; g.add(water);
    if (t.x > 15) g.rotation.y = -Math.PI / 2;
    if (t.z > 5.5) g.rotation.y = Math.PI;
    scene.add(g);
    const a = { kind: 'tap', name: t.name, x: t.x, z: t.z, on: false, until: 0, water, handle, nextSnd: 0 };
    for (const m of [pipe, spout, handle]) { m.userData.kind = 'appliance'; m.userData.app = a; interactables.push(m); }
    appliances.push(a);
  }
}

export function toggleAppliance(a, by = 'player') {
  if (by === 'player' && isClient()) {
    netSend('app', { i: appliances.indexOf(a) });
    a.predUntil = performance.now() + 1200;
    G.noRelay++; try { toggleAppliance(a, 'pred'); } finally { G.noRelay--; }
    return;
  }
  a.on = !a.on;
  if (a.kind === 'tap') { a.until = a.on ? G.t + (by === 'ghost' ? 20 : 999) : 0; sfx.click(a.x, a.z); }
  if (a.kind === 'tv') { sfx.click(a.x, a.z); if (!a.on) a.mesh.material.map = null, a.mesh.material.color.setHex(0x050505), a.mesh.material.needsUpdate = true; }
}

export function appliancePrompt(a) {
  if (a.kind === 'tv') return a.on ? 'Выключить телевизор' : 'Включить телевизор';
  return a.on ? 'Закрыть: ' + a.name : 'Открыть: ' + a.name;
}

export function updateAppliances(dt) {
  for (const a of appliances) {
    if (a.kind === 'tv' && a.on) {
      if (G.t > a.nextFrame) {
        a.nextFrame = G.t + 0.08;
        const x = a.canvas.getContext('2d'), img = x.createImageData(64, 48);
        for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
        x.putImageData(img, 0, 0);
        a.tex.needsUpdate = true;
        if (a.mesh.material.map !== a.tex) { a.mesh.material.map = a.tex; a.mesh.material.color.setHex(0xffffff); a.mesh.material.needsUpdate = true; }
      }
      if (G.t > a.nextSnd) { a.nextSnd = G.t + 1.4; if (isHost()) sfx.tvStatic(a.x, a.z); }
    }
    if (a.kind === 'tap') {
      if (a.on && isHost() && G.t > a.until) a.on = false;
      a.water.visible = a.on;
      a.handle.rotation.y = a.on ? 0.9 : 0;
      if (a.on) {
        a.water.scale.set(1 + Math.random() * 0.3, 1, 1 + Math.random() * 0.3);
        if (G.t > a.nextSnd) { a.nextSnd = G.t + 0.9; if (isHost()) sfx.water(a.x, a.z); }
      }
    }
  }
}

export function nearAppliances(x, z, r) {
  return appliances.filter(a => !a.on && Math.hypot(a.x - x, a.z - z) < r && roomAt(a.x, a.z) !== '.');
}

// сеть: включённые приборы битовой маской
export function appliancesBits() { let b = 0; appliances.forEach((a, i) => { if (a.on) b |= 1 << i; }); return b; }
export function applyAppliancesBits(b) {
  const t = performance.now();
  appliances.forEach((a, i) => {
    const on = !!(b & (1 << i));
    if (on !== a.on && !(a.predUntil > t)) {
      a.on = on;
      if (a.kind === 'tv' && !on) { a.mesh.material.map = null; a.mesh.material.color.setHex(0x050505); a.mesh.material.needsUpdate = true; }
    }
  });
}
