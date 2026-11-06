// Dev panel, shown with ?dev=1: transition speed scale 0.1-1x, scrub slider over the whole loop, live drag
// progress in pages, fps meter, freeze, hide UI. It never sits over the stage on desktop (docked right);
// on a phone it docks to the bottom and can be collapsed.
//
// createDevPanel(stage) where stage exposes: timeScale (get/set), frozen (get/set), position (get),
// setPosition(p), resume(), hideUI(bool), motion, stops, fps (get). Returns { el, update() } or null.

import { params } from './proto-api.js';

export function createDevPanel(stage) {
  if (params.get('dev') !== '1') return null;
  const css = `
  .lbx-dev{position:fixed;z-index:50;right:12px;top:12px;width:250px;font:12px/1.35 ui-monospace,Menlo,Consolas,monospace;
    color:#eee;background:rgba(16,16,20,.88);border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:10px 12px;
    -webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);user-select:none;touch-action:manipulation}
  .lbx-dev label{display:block;margin:7px 0 2px;color:#aaa}
  .lbx-dev input[type=range]{width:100%}
  .lbx-dev .row{display:flex;gap:10px;align-items:center;margin-top:6px}
  .lbx-dev b{color:#fff;font-weight:600}
  .lbx-dev .hd{display:flex;justify-content:space-between;color:#C9A56E;letter-spacing:.08em}
  .lbx-dev.min .bd{display:none}
  @media (max-width:520px){.lbx-dev{left:8px;right:8px;top:auto;bottom:8px;width:auto}}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const d = document.createElement('div'); d.className = 'lbx-dev';
  d.innerHTML = `<div class="hd"><span>DEV</span><span data-k="min" style="cursor:pointer">–</span></div><div class="bd">
    <label>speed <b data-k="sv">1.00x</b></label><input data-k="speed" type="range" min="0.1" max="1" step="0.05" value="1">
    <label>scrub (pages, 0 to ${stage.stops.length}) <b data-k="pv">0.000</b></label><input data-k="scrub" type="range" min="0" max="${stage.stops.length}" step="0.005" value="0">
    <div class="row"><span>drag <b data-k="dp">0.000</b> pg</span><span>fps <b data-k="fps">–</b></span></div>
    <div class="row"><span>stop <b data-k="stop">0</b></span><span>v <b data-k="vel">0.00</b> pg/s</span></div>
    <div class="row"><label style="margin:0"><input data-k="freeze" type="checkbox"> freeze</label>
      <label style="margin:0"><input data-k="hide" type="checkbox"> hide UI</label></div>
    <div class="row" style="color:#888" data-k="mode"></div></div>`;
  document.body.appendChild(d);
  const q = (k) => d.querySelector(`[data-k="${k}"]`);
  const speed = q('speed'), scrub = q('scrub'), freeze = q('freeze'), hide = q('hide');
  const sp = params.get('speed'); if (sp) { speed.value = sp; stage.timeScale = +sp; }
  speed.oninput = () => { stage.timeScale = +speed.value; };
  let scrubbing = false;
  scrub.oninput = () => { scrubbing = true; stage.setPosition(+scrub.value); freeze.checked = true; };
  scrub.onchange = () => { scrubbing = false; };
  freeze.onchange = () => { if (freeze.checked) stage.frozen = true; else stage.resume(); };
  hide.onchange = () => stage.hideUI(hide.checked);
  q('min').onclick = () => d.classList.toggle('min');
  const dev = stage.motion.deviations ? stage.motion.deviations() : {};
  q('mode').textContent = `input ${stage.motion.config.mode}` + (Object.keys(dev).length ? ` · tuned: ${Object.keys(dev).join(', ')}` : ' · native rules');
  return {
    el: d,
    update() {
      q('sv').textContent = (+stage.timeScale).toFixed(2) + 'x';
      const p = stage.position, n = stage.stops.length;
      q('pv').textContent = p.toFixed(3);
      if (!scrubbing) scrub.value = String(((p % n) + n) % n);
      q('dp').textContent = stage.motion.dragProgress.toFixed(3);
      q('fps').textContent = stage.fps ? stage.fps.toFixed(0) : '–';
      q('stop').textContent = String(stage.motion.selectedIndex);
      q('vel').textContent = stage.motion.velocity.toFixed(2);
      if (freeze.checked !== stage.frozen) freeze.checked = stage.frozen;
    },
  };
}
