// Client for Intygskollen. All recordings, audio and documents live on the server (store.mjs) so phone and
// desktop stay in sync: the server pushes a "change" event over SSE and every open client refetches.
// Nothing patient-related is written to browser storage; only UI preferences (Vim mode) are stored locally.
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ICON = {
  mic: '<svg viewBox="0 0 24 24"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-2.1a7 7 0 0 0 6-6.9h-2Z"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7Z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zm6 0h4v14h-4z"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12Z"/></svg>',
};
const fmtDur = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const fmtTime = d => new Date(d).toLocaleString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const BAR_MS = 60; // one waveform bar per 60 ms while recording

/* ---------- preferences (per device; no patient data) ---------- */
const pref = { get: k => { try { return localStorage.getItem('ik.' + k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem('ik.' + k, v); } catch {} } };
const vimOn = () => pref.get('vim') === '1';
// Speech-recognition languages (the browser recognises one language per recording). Documents are always written in Swedish.
const LANGS = { 'sv-SE': 'Svenska', 'en-US': 'Engelska (USA)', 'en-GB': 'Engelska (UK)', 'he-IL': 'Hebreiska', 'ar-SA': 'Arabiska', 'fa-IR': 'Persiska',
  'so-SO': 'Somaliska', 'ti-ER': 'Tigrinja', 'tr-TR': 'Turkiska', 'ku-TR': 'Kurdiska', 'uk-UA': 'Ukrainska', 'ru-RU': 'Ryska', 'pl-PL': 'Polska',
  'bs-BA': 'Bosniska', 'sr-RS': 'Serbiska', 'fi-FI': 'Finska', 'da-DK': 'Danska', 'nb-NO': 'Norska', 'de-DE': 'Tyska', 'fr-FR': 'Franska',
  'es-ES': 'Spanska', 'it-IT': 'Italienska', 'pt-PT': 'Portugisiska', 'zh-CN': 'Kinesiska', 'th-TH': 'Thailändska', 'vi-VN': 'Vietnamesiska' };
const LANGNAME = Object.fromEntries(Object.entries(LANGS).map(([c, n]) => [c.slice(0, 2), n.replace(/ \(.*\)/, '')]));
Object.assign(LANGNAME, { ckb: 'Kurdiska (sorani)', fit: 'Meänkieli', se: 'Nordsamiska', rom: 'Romani chib', yi: 'Jiddisch', bs: 'Bosniska/kroatiska/serbiska', ti: 'Tigrinja', so: 'Somaliska', en: 'Engelska' });
const recLang = () => 'sv-SE'; // Soniox detects the language(s) itself; the browser preview listens for Swedish

/* ---------- server state & live sync ---------- */
let recordings = [], patients = [], session = null, retentionDays = 7, online = true, sonioxLive = false;
// Per tab (sessionStorage): two tabs on one computer are two devices, and a reload keeps the id so a running recording stays ours.
const DEVICE = (() => { try { return sessionStorage.getItem('ik.device') || (sessionStorage.setItem('ik.device', Math.random().toString(36).slice(2, 10)), sessionStorage.getItem('ik.device')); } catch { return Math.random().toString(36).slice(2, 10); } })();
const ui = {}; // per-recording view state that is local to this device: { open, vimEditing, wantOpen }
const uiOf = r => (ui[r.id] ??= {});
const patientOf = id => patients.find(p => p.id === id);
async function api(method, url, body, type = 'application/json') {
  const res = await fetch(url, { method, headers: body ? { 'content-type': type } : {}, body: type === 'application/json' && body ? JSON.stringify(body) : body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
async function load() {
  try {
    const d = await api('GET', '/api/state');
    recordings = d.recordings; patients = d.patients; retentionDays = d.retentionDays; online = true; sonioxLive = !!d.sonioxLive;
    const prev = session; session = d.session; followSession(prev);
    if (session.state !== 'recording' || session.recorder === DEVICE) ra = null; // the live stream belongs to one recording only
    if (prev && session.version !== prev.version) resetLive();
    for (const r of recordings) { // open a document automatically once the generation this device asked for is done
      const u = uiOf(r);
      if (u.wantOpen && r.docs[u.wantOpen]?.data) { u.open = u.wantOpen; u.wantOpen = null; }
      if (u.wantOpen && r.docs[u.wantOpen]?.error) u.wantOpen = null;
    }
  } catch { online = false; }
  render();
}
// The shared meeting drives navigation on every device: a new meeting opens the recorder everywhere,
// and when the recording is saved everyone moves on to the transcript.
function followSession(prev) {
  const s = session, active = ['ready', 'recording', 'uploading'].includes(s.state);
  if (!prev) { if (active && !location.hash.startsWith('#/r/')) location.hash = '#/mote'; return; }
  if (s.version !== prev.version && s.state === 'ready') location.hash = '#/mote';
  if (s.meetingId && s.meetingId !== prev.meetingId && location.hash === '#/mote') location.hash = `#/r/${s.meetingId}`;
}
// Re-render on every change, but never while the user is typing or editing.
let dirty = false;
const busy = () => { const a = document.activeElement; return a && (a.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName) && a.id !== 'q') || Object.values(ui).some(u => u.vimEditing); };
function render() { if (busy()) { dirty = true; return; } dirty = false; route(); }
document.addEventListener('focusout', () => setTimeout(() => dirty && render(), 0));
// WebSocket for instant sync and the live view of a recording made on another device; polling as fallback.
let ws = null;
async function connectWs() {
  try {
    const { token } = await api('GET', '/api/ws-token');
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?token=${token}`);
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.type === 'change') load(); if (m.type === 'live') onRemoteLive(m); };
    ws.onclose = () => { ws = null; setTimeout(connectWs, 2000); };
  } catch { setTimeout(connectWs, 3000); }
}
connectWs();
let lastPoll = '';
setInterval(async () => {
  try { const t = await (await fetch('/api/state')).text(); if (t !== lastPoll) { const first = !lastPoll; lastPoll = t; if (!first) load(); } } catch {}
}, 4000);

/* ---------- router ---------- */
const find = id => recordings.find(x => x.id === id);
function route() {
  const h = location.hash, m = h.match(/^#\/r\/(R\d+)/), r = m && find(m[1]), pm = h.match(/^#\/p\/(P\d+)/), p = pm && patientOf(pm[1]);
  document.querySelectorAll('.rail a[data-nav]').forEach(a => a.classList.toggle('on', h.startsWith('#/installningar')));
  if (!r) player.pause();
  if (r) renderDetail(r);
  else if (h.startsWith('#/installningar')) renderSettings();
  else if (h.startsWith('#/mote')) renderMeeting();
  else if (p) renderPatient(p);
  else renderPatients();
}
window.addEventListener('hashchange', () => { dirty = false; route(); });
const onDetail = r => location.hash === `#/r/${r.id}`;

/* ---------- patients: search, then the patient's meetings ---------- */
let query = '', openMenu = null;
const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s-]/g, '');
const meetingsOf = id => recordings.filter(r => r.patient === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
function patientRows() {
  const q = norm(query), list = patients.filter(p => !q || norm(p.name).includes(q) || norm(p.personnummer).includes(q));
  if (!online && !patients.length) return '<li class="muted small">Kan inte nå servern.</li>';
  return list.map(p => { const m = meetingsOf(p.id);
    return `<li><a href="#/p/${p.id}"><b>${esc(p.name)}</b><span class="m">${esc(p.personnummer)} · ${p.age} år</span>
      <span class="last">${m.length ? `${m.length} möte${m.length > 1 ? 'n' : ''} · senast ${fmtTime(m[0].createdAt)}` : 'Inga möten'}</span></a></li>`; }).join('')
    || '<li class="muted small">Ingen patient matchar sökningen.</li>';
}
function activeBanner() {
  const s = session; if (!s || !['ready', 'recording', 'uploading'].includes(s.state)) return '';
  const p = patientOf(s.patientId);
  return `<a class="banner" href="#/mote"><b>${s.state === 'recording' ? 'Inspelning pågår' : 'Pågående möte'}</b> med ${esc(p?.name)} · gå till mötet &rarr;</a>`;
}
function renderPatients() {
  $('#view').innerHTML = `<div class="page">${activeBanner()}<h1>Patienter</h1>
    <input id="q" class="search" type="search" placeholder="Sök på namn eller personnummer" value="${esc(query)}" autocomplete="off">
    <ul class="plist" id="plist">${patientRows()}</ul>
    <p class="privacy">Demo: syntetiska patienter och demo-personnummer (TF). Ingen riktig patientdata.</p></div>`;
  const q = $('#q'); q.oninput = () => { query = q.value; $('#plist').innerHTML = patientRows(); };
  if (!matchMedia('(pointer: coarse)').matches) q.focus();
}
function renderPatient(p) {
  const list = meetingsOf(p.id), s = session, busyRec = s && ['recording', 'uploading'].includes(s.state);
  $('#view').innerHTML = `<div class="page">${activeBanner()}
    <div class="phead"><a href="#/" class="icon back" aria-label="Till patientlistan">${ICON.back}</a>
      <div><h1>${esc(p.name)}</h1><span class="muted">${esc(p.personnummer)} · ${p.age} år</span></div>
      <button class="btn pri big" id="newMeeting" ${busyRec ? 'disabled title="En inspelning pågår"' : ''}>${ICON.mic} Nytt möte</button></div>
    <h2>Möten</h2>
    <ul class="mlist" id="mlist">${list.map(r => `<li><a href="#/r/${r.id}"><span class="t">${esc(r.title)}</span>
      <span class="m">${fmtTime(r.createdAt)} · ${fmtDur(r.duration)}${r.processing ? ' · <span class="pill warn">Bearbetar…</span>' : ''} · ${docSummary(r)}</span></a>
      <div class="menu-wrap"><button class="icon more" data-menu="${r.id}" aria-label="Fler val">${ICON.more}</button>
        ${openMenu === r.id ? `<div class="menu"><a href="#/r/${r.id}">Öppna</a><button data-rename="${r.id}">Byt namn</button><button data-del="${r.id}" class="bad">Ta bort</button></div>` : ''}</div></li>`).join('')
      || '<li class="muted small">Inga tidigare möten.</li>'}</ul></div>`;
  $('#newMeeting').onclick = () => newMeeting(p.id);
  $('#mlist').onclick = async e => {
    const t = e.target.closest('[data-menu],[data-del],[data-rename]'); if (!t) return;
    const { menu, del, rename } = t.dataset;
    if (menu) { openMenu = openMenu === menu ? null : menu; return renderPatient(p); }
    openMenu = null;
    if (del && confirm('Ta bort mötet? Ljud, transkript och dokument raderas på alla enheter.')) await api('DELETE', `/api/recordings/${del}`).catch(err => alert(err.message));
    if (rename) { const n = prompt('Nytt namn', find(rename)?.title); if (n?.trim()) await api('PATCH', `/api/recordings/${rename}`, { title: n.trim() }).catch(err => alert(err.message)); }
    renderPatient(p);
  };
}
const docSummary = r => { const d = Object.values(r.docs), done = d.filter(x => x.dispatch?.done).length; return d.length ? `${done}/${d.length} dokument klara` : 'inga dokument'; };
document.addEventListener('click', e => { if (openMenu && !e.target.closest('.menu-wrap')) { openMenu = null; route(); } });
async function newMeeting(patientId) {
  try { await api('POST', '/api/session', { action: 'new', patientId }); } catch (e) { return alert(e.message); }
  location.hash = '#/mote'; load();
}

/* ---------- meeting: one shared recorder, only one device records ---------- */
let rec = null;
function renderMeeting() {
  const s = session || { state: 'idle' }, p = patientOf(s.patientId);
  if (!p || s.state === 'idle' || s.state === 'done') {
    $('#view').innerHTML = `<div class="page"><h1>Inget pågående möte</h1><p class="muted">Välj en patient och tryck på Nytt möte.</p><a class="btn pri" href="#/">Till patientlistan</a></div>`;
    return;
  }
  const mine = !!rec, other = s.state === 'recording' && s.recorder !== DEVICE;
  const hint = mine ? 'Spelar in. Tryck för att stoppa.' : other ? 'Inspelningen görs på en annan enhet och visas här live.'
    : s.state === 'uploading' ? 'Sparar och transkriberar…' : 'Tryck för att börja spela in samtalet';
  $('#view').innerHTML = `<div class="meeting">
    <header class="dhead"><a href="#/p/${p.id}" class="icon back" aria-label="Till patienten">${ICON.back}</a>
      <div><h1>Nytt möte · ${esc(p.name)}</h1><span class="muted small">${esc(p.personnummer)} · ${p.age} år</span></div>
      ${!mine && !other && s.state === 'ready' ? '<button class="btn sm" id="cancelMeeting">Avbryt möte</button>' : ''}</header>
    <section class="stage">
      <div class="wave-wrap"><canvas id="wave"></canvas></div>
      <div class="timer" id="timer">${mine ? fmtDur((Date.now() - rec.start) / 1000) : other && ra ? fmtDur(ra.pos / SR_STREAM) : '0:00'}</div>
      ${s.state === 'uploading' && !mine ? '<div class="spinner"></div>'
        : `<button class="recbtn ${mine || other ? 'on' : ''} ${other ? 'remote' : ''}" id="recbtn" ${other ? 'disabled' : ''} aria-label="Starta/stoppa inspelning">${mine ? ICON.stop : ICON.mic}</button>`}
      <p class="live" id="live">${!sonioxLive && other && ra ? esc(ra.text) : ''}</p>
      <p class="hint" id="hint">${hint}</p>
    </section></div>`;
  if (sonioxLive) renderLiveInto($('#live'));
  $('#recbtn') && ($('#recbtn').onclick = () => (rec ? stopRecording() : startRecording()));
  $('#cancelMeeting') && ($('#cancelMeeting').onclick = async () => { await api('POST', '/api/session', { action: 'cancel', device: DEVICE }).catch(e => alert(e.message)); location.hash = `#/p/${p.id}`; });
  const st = mine ? rec.local : other ? ra : null;
  drawLive(st && st.pos != null ? st.bars.slice(Math.max(0, Math.floor(st.pos / SPB) - 400), Math.floor(st.pos / SPB)) : mine ? rec.bars : []);
}
/* ---------- live audio stream (separate binary WebSocket channel) ----------
   The recording device streams 16 kHz mono PCM; the server replicates it to the other devices and tells everyone one shared
   display delay (syncDelay). Receivers compute the waveform from the audio itself and play it out at real-time speed, syncDelay
   behind; the recorder delays its own waveform by the same amount, so both screens show the same thing at the same moment. */
const SR_STREAM = 16000, SPB = SR_STREAM * BAR_MS / 1000; // samples per waveform bar
let audioWs = null, syncDelay = 0, ra = null; // ra = audio received from the recording device
async function connectAudio() {
  try {
    const { token } = await api('GET', '/api/ws-token');
    audioWs = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/audio?token=${token}`);
    audioWs.binaryType = 'arraybuffer';
    audioWs.onopen = () => audioWs.send(JSON.stringify({ type: 'hello', device: DEVICE }));
    audioWs.onmessage = e => {
      if (typeof e.data !== 'string') return onAudioFrame(e.data);
      const m = JSON.parse(e.data);
      if (m.type === 'ping') audioWs.send(JSON.stringify({ type: 'pong', t: m.t }));
      if (m.type === 'delay') syncDelay = m.ms;
    };
    audioWs.onclose = () => { audioWs = null; setTimeout(connectAudio, 2000); };
  } catch { setTimeout(connectAudio, 3000); }
}
connectAudio();
// One stream model for both the receivers and the recording device itself: PCM frames (indexed by sample) are turned into
// waveform bars, and a play-out loop renders them at real-time speed, `playDelay()` behind the newest audio.
const playDelay = () => Math.max(syncDelay, 100); // at least ~2 frames, so the play-out never runs dry between frames
const newStream = idx => ({ bars: [], acc: 0, n: 0, level: 0, next: idx, pos: null, text: '' });
function feed(st, idx, pcm) { // pcm: Int16Array starting at sample idx
  const push = s2 => { st.acc += s2; if (++st.n === SPB) { // same smoothing everywhere, so all screens draw the same waveform
    st.level = st.level * 0.45 + Math.min(1, Math.sqrt(st.acc / SPB) * 4) * 0.55; st.bars.push(st.level); st.acc = 0; st.n = 0; } };
  for (let i = st.next; i < idx; i++) push(0); // gap (lost frames): silence
  for (const v of pcm) push((v / 32768) ** 2);
  st.next = idx + pcm.length;
  st.pos ??= Math.max(0, st.next - playDelay() * SR_STREAM / 1000);
}
function playOut(st, alive) { // render loop; `alive()` says when to stop
  let last = performance.now();
  const frame = now => {
    if (!alive()) return;
    const dt = Math.min(100, now - last); last = now;
    if (st.pos != null) {
      const target = st.next - playDelay() * SR_STREAM / 1000, lag = (target - st.pos) / SPB; // in bars
      st.pos = Math.min(st.next, Math.max(0, st.pos + dt * SR_STREAM / 1000 * (1 + Math.max(-0.5, Math.min(0.5, lag / 20)))));
      const b = st.pos / SPB, n = Math.floor(b);
      if (location.hash === '#/mote') drawLive(st.bars.slice(Math.max(0, n - 400), n), b - n);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
function onAudioFrame(buf) {
  if (rec) return;
  const idx = new DataView(buf).getUint32(0, true), pcm = new Int16Array(buf, 4);
  if (!ra || idx + SR_STREAM * 3 < ra.next) ra = newStream(idx); // new recording
  if (idx < ra.next) return; // duplicate / late frame
  feed(ra, idx, pcm);
  if (location.hash === '#/mote' && session?.state === 'recording' && (!$('#wave') || !$('#recbtn.remote'))) renderMeeting();
  if (!ra.loop) {
    const st = ra; st.loop = true;
    playOut(st, () => ra === st && !rec);
    const tick = setInterval(() => { // time follows the audio, in sync with the recording device
      if (ra !== st) return clearInterval(tick);
      const t = $('#timer'); if (t && location.hash === '#/mote' && st.pos != null) t.textContent = fmtDur(st.pos / SR_STREAM);
    }, 200);
  }
}
/* Live text view, written out like a chat model's answer: only final (never-changing) words are committed; the committed text
   is revealed character by character at a steady, smoothly adapting pace, with a soft fade at the leading edge.
   The box keeps 3 fixed rows and scrolls older rows away. */
let lv = null;
const LV_TAIL = 10; // characters in the fading leading edge
const newLive = () => ({ buf: '', used: 0, text: '', shown: 0, rate: 18, settle: 1, loop: false });
const resetLive = () => { lv = newLive(); const l = $('#live'); if (l) l.innerHTML = ''; };
function liveAdd(add, partial) {
  lv ??= newLive();
  lv.buf += add || '';
  let rest = lv.buf.slice(lv.used);
  const continues = partial && !/^\s/.test(partial) && !/[\s.,!?;:]$/.test(rest); // the last final word may continue in the partial
  if (continues) rest = rest.slice(0, rest.search(/\S*$/));
  const words = rest.split(/\s+/).filter(Boolean);
  if (words.length) { lv.text += (lv.text ? ' ' : '') + words.join(' '); lv.used += rest.length; }
  if (!lv.loop) { lv.loop = true; let last = performance.now(); requestAnimationFrame(function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    const backlog = lv.text.length - lv.shown;
    lv.rate += ((18 + Math.min(42, backlog * 0.6)) - lv.rate) * Math.min(1, dt * 2); // ease towards the target pace: no sudden speed changes
    lv.shown = Math.min(lv.text.length, lv.shown + lv.rate * dt);
    // caught up (sentence spoken): let the leading edge settle to full opacity instead of leaving the last word faded
    lv.settle = lv.shown < lv.text.length ? 0 : Math.min(1, lv.settle + dt / 0.4);
    drawLiveText();
    if (lv.shown < lv.text.length || lv.settle < 1) requestAnimationFrame(frame); else lv.loop = false;
  }); }
}
function drawLiveText() {
  const l = $('#live'); if (!l || !lv || location.hash !== '#/mote') return;
  if (!l.firstChild) { l.innerHTML = '<span class="solid"></span><span class="tail"></span>'; }
  const n = Math.floor(lv.shown), cut = Math.max(0, n - LV_TAIL), frac = lv.shown - n;
  l.firstChild.textContent = lv.text.slice(0, cut);
  l.lastChild.innerHTML = [...lv.text.slice(cut, n)].map((c, i, a) => `<span style="opacity:${(o => o + (1 - o) * lv.settle)(Math.max(0.08, Math.min(1, (a.length - i - frac) / LV_TAIL))).toFixed(2)}">${esc(c)}</span>`).join('');
  if (l.scrollHeight > l.clientHeight) l.scrollTop = l.scrollHeight;
}
function renderLiveInto(l) { if (l && lv) { l.innerHTML = ''; drawLiveText(); } } // after a re-render: show what was already written

function onRemoteLive(m) { // live text: Soniox real-time via the server (all devices), or the browser's preview from the recording device
  if (m.add !== undefined) return liveAdd(m.add, m.partial);
  if (ra) ra.text = m.text; if (rec) rec.liveText = m.text;
  const l = $('#live'); if (l && location.hash === '#/mote') l.textContent = m.text;
}

function setupCanvas(c) {
  const dpr = devicePixelRatio || 1;
  c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr;
  const g = c.getContext('2d'); g.scale(dpr, dpr); return g;
}
// Live waveform: drawn every animation frame; between two samples the bars slide smoothly by the elapsed fraction.
let liveCtx = null;
function drawLive(bars, frac = 0) {
  const c = $('#wave'); if (!c) return;
  const dpr = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  if (!liveCtx || liveCtx.canvas !== c || c.width !== Math.round(w * dpr)) { liveCtx = setupCanvas(c); } // resize only when needed
  const g = liveCtx; g.clearRect(0, 0, w, h);
  const step = 4, max = Math.floor(w / step) - 6, scrolling = bars.length > max, view = bars.slice(-max - 1);
  const shift = scrolling ? -frac * step : 0, head = Math.min(bars.length, max) * step + (scrolling ? 0 : frac * step);
  g.fillStyle = '#e4e7ec'; g.fillRect(0, h / 2 - 0.5, w, 1);
  g.fillStyle = '#e73534';
  view.forEach((v, i) => {
    const x = (scrolling ? i - 1 : i) * step + shift; if (x < -step) return;
    const bh = Math.max(2, v * h * 0.85);
    if (g.roundRect) { g.beginPath(); g.roundRect(x, (h - bh) / 2, 2.5, bh, 1.25); g.fill(); } else g.fillRect(x, (h - bh) / 2, 2.5, bh);
  });
  g.fillStyle = '#101828'; g.fillRect(head, 4, 2, h - 8);
}

async function startRecording() {
  try { await api('POST', '/api/session', { action: 'start', device: DEVICE }); } // the server makes sure only one device records
  catch (e) { return alert(e.message); }
  const state = { bars: [], start: Date.now(), chunks: [], segments: [], lang: recLang() };
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    state.ctx = new AudioContext();
    state.analyser = state.ctx.createAnalyser(); state.analyser.fftSize = 1024;
    const src = state.ctx.createMediaStreamSource(state.stream); src.connect(state.analyser);
    // Live audio stream to the other devices: 16 kHz mono PCM, 4-byte sample index + Int16 samples per frame.
    const proc = state.ctx.createScriptProcessor(2048, 1, 1), ratio = state.ctx.sampleRate / SR_STREAM;
    state.sampleIdx = 0; state.local = newStream(0);
    proc.onaudioprocess = e => {
      const inp = e.inputBuffer.getChannelData(0), n = Math.floor(inp.length / ratio), out = new Int16Array(n);
      for (let i = 0; i < n; i++) out[i] = Math.max(-1, Math.min(1, inp[Math.floor(i * ratio)])) * 32767;
      if (audioWs?.readyState === 1 && rec === state) {
        const buf = new ArrayBuffer(4 + out.byteLength);
        new DataView(buf).setUint32(0, state.sampleIdx, true); new Int16Array(buf, 4).set(out);
        audioWs.send(buf);
      }
      feed(state.local, state.sampleIdx, out); // the recorder draws from the same stream model (smooth, same delay)
      state.sampleIdx += n;
    };
    src.connect(proc); proc.connect(state.ctx.destination); state.proc = proc; // (outputs silence; needed for processing to run)
    state.mr = new MediaRecorder(state.stream); // saves the audio so the doctor can listen back
    state.mr.ondataavailable = e => e.data.size && state.chunks.push(e.data);
    state.mr.start(1000);
    state.start = Date.now(); // t=0 is when audio actually starts (not before the mic permission prompt)
  } catch { state.simulated = true; }
  rec = state; ra = null; resetLive(); renderMeeting();
  if (state.simulated) $('#hint').textContent = 'Ingen mikrofon, inget ljud sparas';

  const SR = !sonioxLive && (window.SpeechRecognition || window.webkitSpeechRecognition); // fallback only: Soniox real-time gives the live text via the server
  if (SR) { // live preview text from the browser
    const sr = new SR(); sr.lang = state.lang; sr.continuous = true; sr.interimResults = true;
    sr.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        state.phraseStart ??= (Date.now() - state.start) / 1000;
        if (res.isFinal) { state.segments.push({ text: res[0].transcript.trim(), conf: res[0].confidence || 0.9, start: Math.max(0, state.phraseStart - 0.5) }); state.phraseStart = null; }
        else interim += res[0].transcript;
      }
      state.interim = interim;
      state.liveText = [...state.segments.slice(-2).map(x => x.text), interim].join(' ').trim();
      const l = $('#live'); if (l && rec === state) l.textContent = state.liveText;
    };
    sr.onerror = e => {
      state.srError = e.error;
      if (e.error === 'audio-capture') state.analyser = null; // mic busy on some phones: continue without live waveform
      if (!['no-speech', 'aborted'].includes(e.error)) { const h = $('#hint'); if (h && rec === state) h.textContent = `Taligenkänning: ${e.error}`; }
    };
    sr.onend = () => { if (rec === state) try { sr.start(); } catch {} };
    try { sr.start(); state.sr = sr; } catch {}
  }
  const buf = new Uint8Array(1024);
  let level = 0; // smoothed amplitude so bars don't jitter
  state.timer = setInterval(() => {
    let v = 0.1 + Math.random() * 0.4;
    if (state.analyser) { state.analyser.getByteTimeDomainData(buf); v = Math.sqrt(buf.reduce((s, x) => s + ((x - 128) / 128) ** 2, 0) / buf.length) * 4; }
    level = level * 0.45 + Math.min(1, v) * 0.55;
    state.bars.push(+level.toFixed(3)); state.lastBar = performance.now();
    const t = $('#timer'); if (t && rec === state) t.textContent = fmtDur((Date.now() - state.start) / 1000);
  }, BAR_MS);
  state.liveTimer = setInterval(() => { // stream waveform + live text to the other devices (shown live there)
    if (!sonioxLive && ws?.readyState === 1) ws.send(JSON.stringify({ type: 'live', device: DEVICE, text: state.liveText || '', elapsed: (Date.now() - state.start) / 1000 }));
  }, 250);
  if (state.local) playOut(state.local, () => rec === state); // smooth, and delayed exactly like the other screens
  else { const frame = () => { if (rec !== state) return; drawLive(state.bars, 0); requestAnimationFrame(frame); }; requestAnimationFrame(frame); } // no mic: simulated
}

// Stopping saves the meeting on the server; every device then opens the transcript. Upload and processing continue in the background.
async function stopRecording() {
  const state = rec; rec = null;
  clearInterval(state.timer); clearInterval(state.liveTimer); state.proc?.disconnect();
  const duration = (Date.now() - state.start) / 1000;
  const bars = (state.local?.bars.length ? state.local.bars : state.bars).filter((_, i) => i % 2 === 0).map(v => +v.toFixed(2)); // half resolution is plenty for display
  await api('POST', '/api/session', { action: 'stop', device: DEVICE }).catch(() => {});
  renderMeeting();
  const created = api('POST', '/api/recordings', { duration, bars, device: DEVICE }).catch(e => (alert(`Kunde inte spara inspelningen: ${e.message}`), null));

  const srDone = state.sr ? new Promise(res => { state.sr.onend = res; state.sr.stop(); setTimeout(res, 1500); }) : null;
  const audioDone = state.mr?.state === 'recording' ? new Promise(res => { state.mr.onstop = res; state.mr.stop(); }) : null;
  await Promise.all([srDone, audioDone]);
  state.stream?.getTracks().forEach(t => t.stop()); state.ctx?.close();
  if (state.interim?.trim()) state.segments.push({ text: state.interim.trim(), conf: 0.6, start: Math.max(0, (state.phraseStart ?? duration) - 0.5) });

  const r = await created; if (!r) return;
  location.hash = `#/r/${r.id}`;
  if (state.chunks.length) await api('PUT', `/api/recordings/${r.id}/audio`, new Blob(state.chunks, { type: state.mr.mimeType }), state.mr.mimeType || 'audio/webm').catch(() => {});
  await api('POST', `/api/recordings/${r.id}/transcript`, { segments: state.segments, srError: state.srError, noSpeechRecognition: !state.sr, lang: state.lang }).catch(() => {});
}

/* ---------- playback ---------- */
const player = new Audio(); // one element for the whole app, so re-rendering never interrupts playback
let playingId = null;
player.addEventListener('loadedmetadata', () => { // MediaRecorder webm lacks a duration: make the browser compute it so seeking works
  if (player.duration === Infinity) { player.currentTime = 1e9; player.addEventListener('timeupdate', () => { player.currentTime = 0; }, { once: true }); }
});
['timeupdate', 'play', 'pause', 'ended'].forEach(ev => player.addEventListener(ev, () => updatePlayer()));
function loadAudio(r) { if (r.audio && playingId !== r.id) { playingId = r.id; player.src = `/api/recordings/${r.id}/audio`; } }
function seek(r, t) {
  if (!r.audio) return;
  loadAudio(r); player.currentTime = Math.max(0, Math.min(t, r.duration)); player.play();
}
function updatePlayer() {
  const r = playingId && find(playingId); if (!r || !onDetail(r)) return;
  const t = player.currentTime || 0;
  drawPlayer(r, t);
  const b = $('#playbtn'); if (b) b.innerHTML = player.paused ? ICON.play : ICON.pause;
  const tm = $('#ptime'); if (tm) tm.textContent = `${fmtDur(Math.min(t, r.duration))} / ${fmtDur(r.duration)}`;
  const cur = player.paused ? null : r.transcript.filter(u => u.start <= t).pop();
  document.querySelectorAll('.tline.playing').forEach(x => x.id !== cur?.id && x.classList.remove('playing'));
  if (cur) document.getElementById(cur.id)?.classList.add('playing');
}
function drawPlayer(r, t = 0) {
  const c = $('#pwave'); if (!c || !r.bars.length) return;
  const g = setupCanvas(c), w = c.clientWidth, h = c.clientHeight, n = Math.max(1, Math.floor(w / 3)), at = Math.min(1, t / r.duration);
  for (let i = 0; i < n; i++) {
    const slice = r.bars.slice(Math.floor(i / n * r.bars.length), Math.ceil((i + 1) / n * r.bars.length));
    const bh = Math.max(2, (slice.length ? Math.max(...slice) : 0.05) * h * 0.9);
    g.fillStyle = i / n < at ? '#e73534' : '#f1d1d0'; g.fillRect(i * 3, (h - bh) / 2, 2, bh);
  }
  g.fillStyle = 'rgba(16,24,40,.25)';
  r.transcript.forEach(u => g.fillRect(u.start / r.duration * w, 0, 1, 5)); // where each transcript line starts
  g.fillStyle = '#101828'; g.fillRect(at * w, 0, 2, h);
}

/* ---------- speaker roles ---------- */
const ROLE = { 'Läkare': { a: 'läk', c: 'sl' }, 'Patient': { a: 'pat', c: 'sp' }, 'Sjuksköterska': { a: 'ssk', c: 'sn' }, 'Anhörig': { a: 'anh', c: 'sa' },
  'Tolk': { a: 'tolk', c: 'st' }, 'Annan vårdpersonal': { a: 'vård', c: 'so' }, 'Övrig': { a: 'övr', c: 'sx' }, 'Okänd': { a: '?', c: '' } };
function speakerMenu(r, lineId, anchor) { // pick the role for this voice; with a Soniox voice id it applies to all of that voice's lines
  document.querySelector('.spkmenu')?.remove();
  const u = r.transcript.find(x => x.id === lineId), m = document.createElement('div');
  m.className = 'menu spkmenu';
  m.innerHTML = `<div class="small muted" style="padding:4px 8px">${u.voice ? `Röst ${esc(u.voice)}: gäller alla dess repliker` : 'Gäller den här repliken'}</div>`
    + Object.keys(ROLE).map(k => `<button data-role="${k}">${k}</button>`).join('');
  anchor.after(m);
  m.onclick = async e => {
    const role = e.target.closest('[data-role]')?.dataset.role; if (!role) return;
    const detail = ['Anhörig', 'Annan vårdpersonal'].includes(role) ? (prompt(role === 'Anhörig' ? 'Relation (t.ex. dotter, make)' : 'Yrke (t.ex. fysioterapeut)', '') || '') : '';
    m.remove();
    await api('POST', `/api/recordings/${r.id}/speaker`, { line: lineId, role, detail }).catch(err => alert(err.message));
  };
}
document.addEventListener('click', e => { if (!e.target.closest('.spkmenu, [data-spk]')) document.querySelector('.spkmenu')?.remove(); });

/* ---------- detail view: transcript + document flow ---------- */
const FLOW = {
  journal: { label: 'Journal', desc: 'Journalanteckning från samtalet', needs: null },
  recept: { label: 'Recept', desc: 'Läkemedel, styrka och dosering', needs: null, after: true },
  lab: { label: 'Labbremiss', desc: 'Analyser och frågeställning', needs: null, after: true },
  rtg: { label: 'Röntgenremiss', desc: 'Undersökning och frågeställning', needs: null, after: true },
  remiss: { label: 'Remiss', desc: 'Till specialist eller rehab', needs: null, after: true },
  uppfoljning: { label: 'Uppföljning', desc: 'Åtgärder till vårdadministratören', needs: null, after: true },
  patientinfo: { label: 'Patientinfo', desc: 'Meddelande via 1177', needs: null, after: true },
  arb: { label: 'Intyg dag 8-14', desc: 'Sjuklöneperioden: AG 1-14 till arbetsgivaren', needs: null, after: true },
  fk: { label: 'Intyg från dag 15', desc: 'Sjukpenning: FK 7804 och AG 7804', needs: null, after: true },
};
function renderDetail(r) {
  const u = uiOf(r);
  if (u.open && !r.docs[u.open]?.data) u.open = null; // e.g. deleted or regenerated on another device
  loadAudio(r);
  const keep = { t: $('#transcript')?.scrollTop, s: $('.side-col')?.scrollTop, id: $('.detail')?.dataset.id }; // keep scroll on live re-render
  const conf = c => (c < 0.6 ? 'low' : c < 0.85 ? 'mid' : '');
  const patient = patientOf(r.patient);
  const lines = r.transcript.map(x => `
    <div class="tline" id="${x.id}" data-t="${x.start ?? ''}"><button class="spk ${ROLE[x.speaker]?.c || ''}" data-spk="${x.id}" title="${esc(x.speaker || 'Okänd')}${x.speakerDetail ? ` (${esc(x.speakerDetail)})` : ''}${x.voice ? ` · röst ${esc(x.voice)}` : ''}. Klicka för att ändra.">${ROLE[x.speaker]?.a || '?'}${x.speakerDetail && x.speaker !== 'Patient' && x.speaker !== 'Läkare' ? `<small>${esc(x.speakerDetail)}</small>` : ''}</button>
      <span dir="auto">${x.words.map(w => conf(w.c) ? `<span class="w ${conf(w.c)}" title="Konfidens ${Math.round(w.c * 100)} %">${esc(w.w)}</span>` : esc(w.w)).join(' ')}</span>
      <span class="ts">${x.start != null ? fmtDur(x.start) : ''}</span></div>`).join('');
  $('#view').innerHTML = `
    <div class="detail" data-id="${r.id}">
      <header class="dhead"><a href="#/mote" class="icon back" id="again" aria-label="Spela in igen" title="Spela in igen">${ICON.back}</a>
        <div><h1>${r.id} · ${esc(r.title)}</h1><span class="muted small">${patient ? `<a href="#/p/${patient.id}">${esc(patient.name)}</a> · ${esc(patient.personnummer)} · ` : ''}${fmtTime(r.createdAt)} · ${fmtDur(r.duration)}${r.lang && !/^sv(-SE)?$/.test(r.lang) ? ` · samtal på ${LANGS[r.lang] || r.lang.split('+').map(c => LANGNAME[c] || c).join(' + ')}, dokument på svenska` : ''}${r.stt === 'soniox' ? ' · Soniox' : ''}</span></div></header>
      <div class="dgrid ${u.open ? 'doc-open' : ''}">
        <article class="card tcard">
          ${r.note ? `<p class="mock">${esc(r.note)}</p>` : ''}
          ${r.processing ? '<p class="muted">Bearbetar inspelningen: identifierar talare och sammanfattar…</p>' : r.summary ? `<p class="summary">${esc(r.summary)}</p>` : ''}
          <div class="trow"><h2>Transkribering ${r.transcript.length && !r.processing && !r.example ? '<button class="btn sm" id="reprocess" title="Kör talarroller och sammanfattning igen">Analysera talare igen</button>' : ''}${r.audio && sonioxLive && !r.processing ? '<button class="btn sm" id="retranscribe" title="Kör Soniox igen på det inspelade ljudet">Transkribera om</button>' : ''}</h2><span class="legend"><i class="w mid">osäker</i><i class="w low">mycket osäker</i></span></div>
          <div class="transcript" id="transcript">${lines || `<p class="muted">${r.processing ? 'Väntar på transkriptet…' : 'Inget transkript.'}</p>`}</div>
          <div class="player ${r.audio ? '' : 'noaudio'}">
            <button class="icon playbtn" id="playbtn" ${r.audio ? '' : 'disabled'} aria-label="Spela/pausa">${ICON.play}</button>
            <canvas id="pwave"></canvas>
            <span class="ptime" id="ptime">${r.audio ? `0:00 / ${fmtDur(r.duration)}` : r.example ? 'Exempel, inget ljud' : r.audioDeleted ? 'Ljudet raderat' : 'Inget ljud'}</span>
          </div>
          <p class="retention">${retentionText(r)}</p>
        </article>
        <section class="side-col card">${u.open ? docPanel(r) : flowHtml(r)}</section>
      </div>
    </div>`;
  if (keep.id === r.id) { if (keep.t != null) $('#transcript').scrollTop = keep.t; if (keep.s != null) $('.side-col').scrollTop = keep.s; }
  drawPlayer(r, playingId === r.id ? player.currentTime : 0); updatePlayer();
  if (u.open === 'journal' && u.vimEditing) mountVim(r);
  $('details.more')?.addEventListener('toggle', e => { u.moreOpen = e.target.open; }); // keep open across live re-renders
  if (u.open && r.docs[u.open]?.dispatch) $('.side-col').querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable')); // approved = read-only
  const side = $('.side-col');
  side.addEventListener('focusout', e => { const el = e.target.closest?.('[data-path]'); if (!el) return; const v = el.textContent.trim(); if (v !== el.dataset.orig) { el.dataset.orig = v; editDoc(r, 'set', el.dataset.path, v); } });
  side.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && e.target.closest?.('[data-path]')) { e.preventDefault(); e.target.blur(); } });
  $('#again').onclick = e => { e.preventDefault(); r.patient ? newMeeting(r.patient) : (location.hash = '#/'); }; // back = record again for the same patient
  $('#retranscribe') && ($('#retranscribe').onclick = () => confirm('Transkribera om från det inspelade ljudet? Utkast som byggde på det gamla transkriptet tas bort.') && api('POST', `/api/recordings/${r.id}/retranscribe`).catch(e => alert(e.message)));
  $('#reprocess') && ($('#reprocess').onclick = () => api('POST', `/api/recordings/${r.id}/reprocess`).catch(e => alert(e.message)));
  $('#playbtn').onclick = () => { loadAudio(r); player.paused ? player.play() : player.pause(); };
  $('#pwave').onclick = e => { const b = e.target.getBoundingClientRect(); seek(r, (e.clientX - b.left) / b.width * r.duration); };
  $('#transcript').onclick = e => {
    const sp = e.target.closest('[data-spk]'); if (sp) { e.stopPropagation(); return speakerMenu(r, sp.dataset.spk, sp); }
    const l = e.target.closest('.tline'); if (l?.dataset.t) seek(r, +l.dataset.t);
  };
  $('.side-col').onclick = async e => {
    const act = (method, path, body) => api(method, `/api/recordings/${r.id}/${path}`, body).catch(err => alert(err.message));
    const n = e.target.closest('[data-node]');
    if (n) {
      const k = n.dataset.node, d = r.docs[k];
      if (d?.data) { u.open = k; return renderDetail(r); }
      if (!d?.loading && canRun(r, k)) { u.wantOpen = k; act('POST', `generate/${k}`); }
      return;
    }
    if (e.target.closest('[data-close]')) { u.open = null; return renderDetail(r); }
    if (e.target.closest('[data-regen]')) { const k = u.open; u.open = null; u.wantOpen = k; return act('POST', `generate/${k}`); }
    const add = e.target.closest('[data-add]'), del = e.target.closest('[data-remove]');
    if (add) { const p = add.dataset.add; return editDoc(r, 'add', p, ADD_TEMPLATES[p.split('.').pop()] ?? ''); }
    if (del) return editDoc(r, 'remove', del.dataset.remove);
    if (e.target.closest('[data-vimedit]')) { u.vimEditing = true; return renderDetail(r); }
    if (e.target.closest('[data-send]')) return act('POST', `send/${u.open}`);
    const el = e.target.closest('[data-ev]'); if (!el) return;
    document.querySelectorAll('.tline.hl').forEach(x => x.classList.remove('hl'));
    const ids = el.dataset.ev.split(',').filter(Boolean);
    ids.forEach(id => document.getElementById(id)?.classList.add('hl'));
    document.getElementById(ids[0])?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
}
const canRun = (r, k) => !r.processing && r.transcript.length && (!FLOW[k].needs || r.docs[FLOW[k].needs]?.data);
function retentionText(r) {
  if (r.example) return '';
  if (r.audioDeleted) return `Ljudet raderades ${retentionDays} dagar efter godkännande. Texten finns kvar.`;
  if (!r.audio) return '';
  if (r.signedAt) return `Godkänt ${fmtTime(r.signedAt)}. Ljudet raderas automatiskt ${fmtTime(Date.parse(r.signedAt) + retentionDays * 864e5)}.`;
  return '';
}

function flowHtml(r) {
  const u = uiOf(r), R = r.relevance;
  const missing = !R || (R.cards || []).some(c => c.relevant && c.score >= 70 && !r.docs[c.kind]) || !r.docs.journal;
  if (missing && !R?.loading && !r.processing && r.transcript.length && !u.askedRank) { u.askedRank = true; api('POST', `/api/recordings/${r.id}/relevance`).catch(() => {}); }
  const rel = Object.fromEntries((R?.cards || []).map(c => [c.kind, c]));
  const kinds = Object.keys(FLOW).filter(k => FLOW[k].after);
  // Relevant or already created first (by score); the rest behind "Visa fler".
  const shown = R?.cards ? kinds.filter(k => rel[k]?.relevant || r.docs[k]).sort((a, b) => (rel[b]?.score ?? 0) - (rel[a]?.score ?? 0)) : kinds;
  const hidden = kinds.filter(k => !shown.includes(k));
  const node = k => {
    const f = FLOW[k], d = r.docs[k] || {}, ok = canRun(r, k);
    // Grey until the doctor approves, yellow while the hand-off steps run, green when every step is done.
    const x = d.dispatch;
    const state = d.loading ? 'loading' : d.error ? 'error' : !d.data ? (ok ? 'ready' : 'locked') : x?.done ? 'complete' : x ? 'mid' : 'draft';
    const action = { loading: 'Analyserar…', error: 'Försök igen', ready: 'Skapa', locked: 'Väntar på transkript', draft: 'Utkast klart, granska', complete: `Klar i ${SEND[k]?.[0]}`, mid: `Överförs till ${SEND[k]?.[0]}…` }[state];
    const why = rel[k]?.relevant && !d.data ? `<span class="why">${esc(rel[k].reason)}</span>` : '';
    return `<button class="node ${state} ${rel[k]?.relevant ? 'rel' : ''}" data-node="${k}" ${state === 'locked' ? 'disabled' : ''}>
      <span class="nl">${f.label}</span><span class="nd">${f.desc}</span>${why}<span class="na">${state === 'loading' ? '<i class="mini-spin"></i>' : ''}${action}</span>
      ${d.error ? `<span class="ne">${esc(d.error)}</span>` : ''}</button>`;
  };
  return `<h2>Dokument</h2>
    <div class="tree">
      <div class="node static"><span class="nl">Transkript</span><span class="nd">${r.processing ? 'Bearbetas…' : `${r.transcript.length} repliker`}</span></div>
      <div class="edge"></div>${node('journal')}<div class="edge"></div>
    </div>
    <div class="after-head"><h2>Efterarbete</h2><span class="small muted">${R?.loading || (!R && r.transcript.length) ? '<i class="mini-spin"></i> Bedömer vad samtalet kräver…' : R?.cards ? 'Sorterat efter vad samtalet kräver' : ''}</span></div>
    <div class="after-grid">${shown.map(node).join('') || '<p class="muted small">Samtalet verkar inte kräva något efterarbete.</p>'}</div>
    ${hidden.length ? `<details class="more" ${u.moreOpen ? 'open' : ''}><summary>Visa fler (${hidden.length})</summary><div class="after-grid">${hidden.map(node).join('')}</div></details>` : ''}`;
}
function docPanel(r) {
  const u = uiOf(r), k = u.open, d = r.docs[k];
  if (k === 'journal' && u.vimEditing) return `<div class="dochead"><b>Redigera journal (Vim)</b><span class="muted small">:w sparar · :q avbryter</span></div>
    <div id="vimHost" class="vimhost"><div class="spinner"></div></div>
    <div class="vimbar"><span id="vimMode">-- NORMAL --</span><span class="muted small">Källhänvisningar [U3] i slutet av raden behålls.</span></div>
    <div class="actions"><button class="btn" id="vimCancel">Avbryt</button> <button class="btn pri" id="vimSave">Spara</button></div>`;
  const locked = !!d.dispatch;
  return `<div class="dochead"><button class="btn sm" data-close>&larr; Flöde</button><span>${locked ? '<span class="pill ok">Godkänd, låst</span>' : `${k === 'journal' && vimOn() ? '<button class="btn sm" data-vimedit>Redigera (Vim)</button> ' : ''}<button class="btn sm" data-regen>Skapa om</button>`}</span></div>
    ${{ fk: fkHtml, journal: journalHtml, arb: arbHtml, ...AFTER_HTML }[k](d.data)}
    ${k === 'arb' ? `<p class="small muted">${d.data.days > 14 ? '<b>Sjukskrivningen är längre än 14 dagar.</b> Skapa även underlaget för sjukpenning (från dag 15): FK 7804 och AG 7804.' : 'Varar sjukskrivningen längre än 14 dagar behövs även FK 7804 och AG 7804 (från dag 15).'}</p>` : ''}
    <div class="actions">${k === 'fk' ? '<button class="btn sm" data-pdf="fk7804">FK 7804 som PDF</button> <button class="btn sm" data-pdf="ag7804">AG 7804 som PDF</button> ' : ''}${k === 'arb' ? '<button class="btn sm" data-pdf="ag114">AG 1-14 som PDF</button> ' : ''}
</div>
    ${dispatchHtml(k, d)}`;
}

// Hand-off to the Region Skåne systems (mocked on the server: a timed status flow, nothing is really sent).
const SEND = { journal: ['PMO', 'Godkänn och för över till PMO'], fk: ['Webcert', 'Godkänn och för över till Webcert'], arb: ['Webcert', 'Godkänn och för över till Webcert'],
  recept: ['PMO läkemedelsmodul', 'Godkänn och skicka e-recept'], lab: ['eLAB RS', 'Godkänn och beställ i eLAB RS'], rtg: ['Sectra', 'Godkänn och beställ i Sectra'],
  remiss: ['PMO', 'Godkänn och skicka konsultremiss'], uppfoljning: ['PASiS', 'Godkänn och skapa bevakning i PASiS'], patientinfo: ['1177 direkt', 'Godkänn och skicka via 1177 direkt'] };
function dispatchHtml(k, d) {
  const [system, label] = SEND[k] || [];
  if (!system) return '';
  const x = d.dispatch;
  const steps = x ? x.steps.map(s => `<li class="ok"><span>${esc(s.label)}</span><time>${new Date(s.at).toTimeString().slice(0, 8)}</time></li>`).join('')
    + (x.done ? '' : '<li class="pending"><i class="mini-spin"></i><span>Väntar på svar…</span></li>') : '';
  return `<div class="dispatch ${x?.done ? 'done' : ''}">
    <div class="dhd"><b>${esc(system)}</b>${x ? `<span class="ref">${esc(x.ref)}</span>` : ''}<span class="pill grey">Demointegration</span></div>
    ${x ? `<ol class="steps">${steps}</ol>` : ''}
    ${x ? `<p class="small muted">Godkänd ${fmtTime(d.approved || x.started)}. Dokumentet är låst; signeringen sker i ${esc(system)}.</p>`
      : `<button class="btn pri" data-send>${label}</button><p class="small muted">Granska utkastet ovan. Efter godkännande går det inte att ändra.</p>`}</div>`;
}

/* ---------- Vim editing of the journal (CodeMirror 5 + vim keymap, loaded on first use) ---------- */
const CM_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/';
let cmLoading;
function loadCodeMirror() {
  const css = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: CM_BASE + 'codemirror.min.css' });
  const js = src => new Promise((ok, fail) => document.head.append(Object.assign(document.createElement('script'), { src: CM_BASE + src, onload: ok, onerror: fail })));
  return (cmLoading ??= (document.head.append(css), js('codemirror.min.js').then(() => js('keymap/vim.min.js'))));
}
// The note is edited as plain text; source references stay as [U3 U4] at the end of each line.
const journalToText = j => j.sections.map(s => `## ${s.heading}\n${s.claims.map(c => `${c.text}${c.evidence.length ? ` [${c.evidence.join(' ')}]` : ''}`).join('\n')}`).join('\n\n');
function textToJournal(text) {
  const sections = [];
  for (const line of text.split('\n')) {
    const t = line.trim(); if (!t) continue;
    if (t.startsWith('## ')) { sections.push({ heading: t.slice(3).trim(), claims: [] }); continue; }
    if (!sections.length) sections.push({ heading: 'Anteckning', claims: [] });
    const m = t.match(/^(.*?)\s*\[((?:U\d+[\s,]*)*)\]$/);
    sections.at(-1).claims.push(m ? { text: m[1], evidence: m[2].match(/U\d+/g) || [] } : { text: t, evidence: [] });
  }
  return { sections };
}
async function mountVim(r) {
  const host = $('#vimHost'); if (!host) return;
  try { await loadCodeMirror(); } catch { host.innerHTML = '<p class="bad">Kunde inte ladda editorn (ingen internetanslutning?).</p>'; return; }
  if (!document.body.contains(host)) return;
  host.innerHTML = '';
  const u = uiOf(r);
  const cm = CodeMirror(host, { value: journalToText(r.docs.journal.data), keyMap: 'vim', lineWrapping: true, lineNumbers: true, autofocus: true });
  const done = () => { u.vimEditing = false; render(); };
  const save = async () => { await api('PUT', `/api/recordings/${r.id}/journal`, { data: textToJournal(cm.getValue()) }).catch(e => alert(e.message)); done(); };
  CodeMirror.Vim.defineEx('write', 'w', save);
  CodeMirror.Vim.defineEx('wq', 'wq', save);
  CodeMirror.Vim.defineEx('quit', 'q', done);
  CodeMirror.on(cm, 'vim-mode-change', e => { const m = $('#vimMode'); if (m) m.textContent = `-- ${e.mode.toUpperCase()} --`; });
  $('#vimSave').onclick = save; $('#vimCancel').onclick = done;
}

/* ---------- editable documents ----------
   Every editable field carries data-path (its place in the document data). Edits are saved to the server on blur,
   so they survive re-renders and show up on every device; the FK checks are re-run on the server. */
const refs = ids => ids?.length ? `<sup>${ids.join(' ')}</sup>` : '';
const ed = (path, text, ids, level = 'ok') => `<span class="claim ${level}" data-path="${path}" data-orig="${esc(text)}" data-ev="${(ids || []).join(',')}" contenteditable spellcheck="false">${esc(text)}</span>${refs(ids)} `;
const claimSpan = (path, text, ids, level) => ed(path, text, ids, level) + (ids && !ids.length ? '<sup class="bad">ingen källa</sup>' : '');
const addBtn = (path, label) => `<button class="add" data-add="${path}">+ ${label}</button>`;
const rm = path => `<button class="rm" data-remove="${path}" title="Ta bort">&times;</button>`;
const dl = rows => `<dl class="fk">${rows.filter(Boolean).map(([t, v]) => `<dt>${t}</dt><dd>${v}</dd>`).join('')}</dl>`;
const urg = u => `<span class="pill ${u === 'rutin' ? '' : 'warn'}">${esc(u)}</span>`;
const list = (path, items, label) => `<ul class="items">${items.map((x, i) => `<li>${ed(`${path}.${i}`, x)}${rm(`${path}.${i}`)}</li>`).join('')}</ul>${addBtn(path, label)}`;
const ADD_TEMPLATES = {
  prescriptions: { drug: '', form: '', strength: '', dosage: '', amount: '', duration: '', indication: '', evidence: [] },
  tests: { name: '', reason: '', evidence: [] }, actions: { what: '', when: '', who: 'läkare', evidence: [] },
  self_care: '', warning_signs: '', next_steps: '',
};
const AFTER_HTML = {
  recept: d => `<h2>Receptutkast</h2>${d.prescriptions.length ? `<table class="rx"><tr><th>Läkemedel</th><th>Styrka</th><th>Dosering</th><th>Mängd</th><th>Tid</th><th></th></tr>
    ${d.prescriptions.map((p, i) => `<tr><td>${ed(`prescriptions.${i}.drug`, p.drug, p.evidence)} ${ed(`prescriptions.${i}.form`, p.form)}<div class="small muted">${ed(`prescriptions.${i}.indication`, p.indication)}</div></td>
      <td>${ed(`prescriptions.${i}.strength`, p.strength)}</td><td>${ed(`prescriptions.${i}.dosage`, p.dosage)}</td><td>${ed(`prescriptions.${i}.amount`, p.amount)}</td><td>${ed(`prescriptions.${i}.duration`, p.duration)}</td><td>${rm(`prescriptions.${i}`)}</td></tr>`).join('')}</table>`
    : '<p class="muted">Inga läkemedel förskrevs i samtalet.</p>'}${addBtn('prescriptions', 'Läkemedel')}${d.warnings.map(w => `<div class="flag warn">${esc(w)}</div>`).join('')}`,
  lab: d => `<h2>Labbremiss</h2>${dl([['Frågeställning', ed('question', d.question)], ['Brådska', urg(d.urgency)], ['Fasta', d.fasting ? 'Ja' : 'Nej']])}
    <h3>Analyser</h3><ul class="items">${d.tests.map((t, i) => `<li><b>${ed(`tests.${i}.name`, t.name, t.evidence)}</b> <span class="small muted">${ed(`tests.${i}.reason`, t.reason)}</span>${rm(`tests.${i}`)}</li>`).join('')}</ul>${addBtn('tests', 'Analys')}`,
  rtg: d => `<h2>Röntgenremiss</h2>${dl([['Undersökning', ed('exam', d.exam, d.evidence)], ['Frågeställning', ed('question', d.question)], ['Anamnes', ed('anamnesis', d.anamnesis)], ['Status', ed('status', d.status)], ['Brådska', urg(d.urgency)], ['Kontraindikationer', ed('contraindications', d.contraindications)]])}`,
  remiss: d => `<h2>Remiss</h2>${dl([['Till', ed('to', d.to, d.evidence)], ['Frågeställning', ed('question', d.question)], ['Anamnes', ed('anamnesis', d.anamnesis)], ['Status', ed('status', d.status)], ['Pågående behandling', ed('current_treatment', d.current_treatment)], ['Brådska', urg(d.urgency)]])}`,
  uppfoljning: d => `<h2>Uppföljning</h2><p class="small muted">Åtgärdslista till vårdadministratören.</p><ul class="items todo">${d.actions.map((a, i) => `<li><div><input type="checkbox"> ${ed(`actions.${i}.what`, a.what, a.evidence)}${rm(`actions.${i}`)}</div>
      <span class="small muted">${ed(`actions.${i}.when`, a.when)} · ${ed(`actions.${i}.who`, a.who)}</span></li>`).join('')}</ul>${addBtn('actions', 'Åtgärd')}`,
  patientinfo: d => `<h2>Till patienten via 1177</h2><p class="patient">${ed('summary', d.summary)}</p>
    <h3>Egenvård</h3>${list('self_care', d.self_care, 'Råd')}<h3>Sök vård igen om</h3>${list('warning_signs', d.warning_signs, 'Varningstecken')}<h3>Nästa steg</h3>${list('next_steps', d.next_steps, 'Steg')}
`,
};

const journalHtml = j => `<h2>Journalanteckning</h2>${j.sections.map((sec, i) => `<h3>${ed(`sections.${i}.heading`, sec.heading)}</h3><p>${sec.claims.map((c, k) => claimSpan(`sections.${i}.claims.${k}.text`, c.text, c.evidence)).join('')}</p>`).join('')}`;
const arbHtml = a => `<p class="eyebrow">Sjuklöneperioden · dag 8-14</p><h2>Läkarintyg om arbetsförmåga</h2>
  <p class="small muted">Blankett AG 1-14 till arbetsgivaren. Dag 1-7 räcker patientens egen sjukanmälan; från dag 8 kan arbetsgivaren kräva läkarintyg. Innehåller ingen diagnos: arbetsgivaren har inte rätt till medicinska uppgifter.</p>
  <dl class="fk"><dt>Arbetsförmåga</dt><dd>${a.work_capacity_reduced ? `Nedsatt med ${ed('degree', a.degree)} % i ${ed('days', a.days)} dagar` : 'Inte nedsatt'}</dd>
  <dt>Sysselsättning</dt><dd>${ed('occupation', a.occupation || '')}</dd>
  <dt>Hur den påverkas</dt><dd data-arb="description">${a.description.map((c, i) => claimSpan(`description.${i}.text`, c.text, c.evidence)).join('') || '<em class="bad">Saknas</em>'}</dd>
  <dt>Arbetsförmåga trots sjukdom</dt><dd data-arb="adjustments">${a.adjustments.map((c, i) => claimSpan(`adjustments.${i}.text`, c.text, c.evidence)).join('') || '<span class="muted">Inga diskuterade</span>'}</dd></dl>`;

function fkHtml({ cert: c, checks: k }) {
  const claims = sec => c[sec].length ? c[sec].map((x, i) => claimSpan(`cert.${sec}.${i}.text`, x.text, x.evidence, k.support[`${sec}.${i}`]?.level)).join('') : '<em class="bad">Saknas</em>';
  const flags = f => k.flags.filter(x => x.field === f).map(x => `<div class="flag ${x.severity}">${esc(x.text)}</div>`).join('');
  const color = k.score >= 80 ? 'ok' : k.score >= 50 ? 'warn' : 'bad';
  const DFA = { diagnosis: 'D · Diagnos', function_impairment: 'F · Funktion', activity_limitation: 'A · Aktivitet', chain: 'Kedjan' };
  return `
    <p class="eyebrow">Sjukpenning · från dag 15</p><div class="fkhead"><div><h2>Läkarintyg för sjukpenning</h2><p class="small muted">Samma bedömning fyller två blanketter: FK 7804 till Försäkringskassan och AG 7804 till arbetsgivaren (utan diagnos).</p></div><div class="score ${color}">${k.score}<small>/100</small></div></div>
    <div class="dfa-row">${Object.entries(DFA).map(([key, l]) => `<div class="dfa ${c.dfa[key].status}" title="${esc(c.dfa[key].reason)}">${l}</div>`).join('')}</div>
    <dl class="fk">
      <dt>Diagnos</dt><dd data-field="diagnosis">${ed('cert.diagnosis.icd10', c.diagnosis.icd10)}${ed('cert.diagnosis.text', c.diagnosis.text, c.diagnosis.evidence)}</dd>
      <dt>Sysselsättning</dt><dd data-field="occupation">${ed('cert.occupation.text', c.occupation.text, c.occupation.evidence)}${flags('occupation')}</dd>
      <dt>Funktionsnedsättning</dt><dd data-field="function_impairment">${claims('function_impairment')}${flags('function_impairment')}</dd>
      <dt>Aktivitetsbegränsning</dt><dd data-field="activity_limitation">${claims('activity_limitation')}${flags('activity_limitation')}</dd>
      <dt>Åtgärder</dt><dd data-field="treatment">${claims('treatment')}</dd>
      <dt>Prognos</dt><dd data-field="prognosis">${esc(prognosisText(c.prognosis))}</dd>
      <dt>Åtgärder för återgång</dt><dd data-field="work_measures">${ed('cert.work_measures', c.work_measures)}</dd>
      <dt>Sjukskrivning</dt><dd>${ed('cert.sick_leave.degree', c.sick_leave.degree)} % i ${ed('cert.sick_leave.days', c.sick_leave.days, c.sick_leave.evidence)} dagar
        ${k.duration ? `<div class="small muted">Rekommenderat: ${k.duration.recommended} dagar (demovärden)</div>` : ''}${flags('sick_leave')}</dd>
      ${c.motivation_longer_leave || k.flags.some(f => f.field === 'sick_leave') ? `<dt>Motivering längre sjukskrivning</dt><dd>${ed('cert.motivation_longer_leave', c.motivation_longer_leave)}</dd>` : ''}
    </dl>
    ${c.questions_to_ask.length ? `<h3>Fråga innan patienten går</h3><ol>${c.questions_to_ask.map(q => `<li>${esc(q)}</li>`).join('')}</ol>` : ''}
    <h3>Till patienten</h3><p class="patient">${ed('cert.patient_summary', c.patient_summary)}</p>`;
}

// Save an edit / add or remove a list item. Applied locally first so the page doesn't flicker back.
function setLocal(obj, path, op, value) {
  const keys = path.split('.'), last = keys.pop(), o = keys.reduce((x, k) => x?.[k], obj); if (!o) return;
  if (op === 'set') o[last] = typeof o[last] === 'number' ? Number(value) || 0 : value;
  if (op === 'add') o[last].push(structuredClone(value));
  if (op === 'remove') o.splice(+last, 1);
}
function editDoc(r, op, path, value) {
  const k = uiOf(r).open, d = r.docs[k]; if (!d?.data) return;
  if (d.dispatch) return;
  setLocal(d.data, path, op, value);
  api('PATCH', `/api/recordings/${r.id}/doc/${k}`, { op, path, value }).catch(e => alert(`Kunde inte spara: ${e.message}`));
  if (op !== 'set') renderDetail(r);
}

const PROGNOSIS = {
  full_after_end: () => 'Patienten förväntas kunna återgå helt i nuvarande sysselsättning efter detta intygs slutdatum.',
  full_after_months: p => `Patienten förväntas kunna återgå helt i nuvarande sysselsättning efter ${p.months} månad(er).`,
  not_full: () => 'Patienten förväntas inte kunna återgå helt i nuvarande sysselsättning.',
  uncertain: p => `Prognosen för återgång i nuvarande sysselsättning är svårbedömd. ${p.reason}`,
};
const prognosisText = p => (p ? PROGNOSIS[p.option]?.(p) || '' : '');
const isoDate = d => new Date(d).toLocaleDateString('sv-SE');

// Collect the (possibly edited) certificate text from the page and download the filled FK 7804.
async function downloadPdf(r, formId) {
  if (formId === 'ag114') return downloadAg114(r);
  const c = r.docs.fk.data.cert;
  const field = name => {
    const dd = document.querySelector(`dd[data-field="${name}"]`); if (!dd) return '';
    const x = dd.cloneNode(true); x.querySelectorAll('sup,.flag,.small,em').forEach(n => n.remove());
    return x.textContent.replace(/\s+/g, ' ').trim();
  };
  const [icd10, ...rest] = field('diagnosis').split(' ');
  const patient = patientOf(r.patient);
  const body = {
    patient: patient ? patient.name : 'Ny patient', personnummer: patient?.personnummer || '', date: isoDate(r.createdAt),
    occupation: field('occupation'), icd10, diagnosis: rest.join(' '),
    function_impairment: field('function_impairment'), activity_limitation: field('activity_limitation'), treatment: field('treatment'),
    degree: c.sick_leave.degree, from: isoDate(Date.now()), to: isoDate(Date.now() + (c.sick_leave.days - 1) * 864e5), motivation: c.motivation_longer_leave,
    prognosis_option: c.prognosis?.option, prognosis_months: c.prognosis?.months, prognosis_reason: c.prognosis?.reason,
    work_measures: field('work_measures'), other: '',
  };
  return savePdf(formId, body, r);
}
function downloadAg114(r) {
  const a = r.docs.arb.data, patient = patientOf(r.patient);
  const text = cls => [...document.querySelectorAll(`[data-arb="${cls}"] .claim`)].map(x => x.textContent.trim()).join(' ');
  return savePdf('ag114', {
    patient: patient ? patient.name : 'Ny patient', personnummer: patient?.personnummer || '', date: isoDate(r.createdAt),
    occupation: a.occupation, description: text('description'), capacity_despite: text('adjustments'),
    degree: a.work_capacity_reduced ? a.degree : '', from: isoDate(Date.now()), to: isoDate(Date.now() + (Math.max(1, a.days) - 1) * 864e5),
  }, r);
}
async function savePdf(formId, body, r) {
  const res = await fetch(`/api/pdf/${formId}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) return alert('Kunde inte skapa PDF');
  const url = URL.createObjectURL(await res.blob());
  Object.assign(document.createElement('a'), { href: url, download: `${formId.toUpperCase()}-utkast-${r.id}.pdf` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-pdf]'); if (!b) return;
  const r = recordings.find(onDetail); if (r) downloadPdf(r, b.dataset.pdf);
});

/* ---------- patients & settings ---------- */
async function renderSettings() {
  const hasSR = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  $('#view').innerHTML = `<div class="page"><h1>Inställningar</h1>
    <div class="card srow"><div><b>Claude API</b><div class="muted small">Nyckeln läses från <code>.env</code> på servern och skickas aldrig till webbläsaren.</div></div><span id="apiStatus" class="pill">Kontrollerar…</span></div>
    <div class="card srow"><div><b>Synk</b><div class="muted small">Inspelningar, ljud och dokument sparas på servern och uppdateras live på alla inloggade enheter.</div></div><span class="pill ${online ? 'ok' : 'bad'}">${online ? 'Ansluten' : 'Offline'}</span></div>
    <div class="card srow"><div><b>Taligenkänning</b><div class="muted small">Soniox transkriberar inspelningen på servern: tider och säkerhet per ord, talarseparering och flera språk i samma samtal. Fungerar i alla webbläsare. Webbläsarens taligenkänning används för livetexten${hasSR ? '' : ' (stöds inte här)'} och som reserv.</div></div><span class="pill" id="sttStatus">Kontrollerar…</span></div>
    <div class="card srow"><div><b>Ljudlagring</b><div class="muted small">Ljudet sparas så att läkaren kan lyssna om transkriptet ser fel ut, och raderas automatiskt ${retentionDays} dagar efter att läkaren godkänt ett dokument. Bara texten sparas långsiktigt.</div></div><span class="pill">Godkännande + ${retentionDays} dagar</span></div>
    <div class="card srow"><div><b>Vim-läge</b><div class="muted small">Redigera journalanteckningar med Vim-kommandon (i, Esc, dd, :w, :q). Sparas på den här enheten.</div></div>
      <label class="switch"><input type="checkbox" id="vimToggle" ${vimOn() ? 'checked' : ''}><span></span></label></div>
    <div class="card srow"><div><b>Datahantering</b><div class="muted small">Servern loggar inga transkript. Rensa raderar allt på servern för alla enheter.</div></div><button class="btn" id="clearAll">Rensa alla inspelningar</button></div></div>`;
  $('#vimToggle').onchange = e => pref.set('vim', e.target.checked ? '1' : '0');
  $('#clearAll').onclick = async () => {
    if (!confirm('Rensa alla inspelningar på servern? Det gäller alla enheter.')) return;
    await api('DELETE', '/api/recordings').catch(e => alert(e.message)); location.hash = '#/';
  };
  try {
    const s = await (await fetch('/api/status')).json();
    $('#apiStatus').textContent = s.keyConfigured ? 'Ansluten' : 'Nyckel saknas';
    $('#apiStatus').className = 'pill ' + (s.keyConfigured ? 'ok' : 'bad');
    $('#sttStatus').textContent = s.soniox ? 'Soniox' : hasSR ? 'Endast webbläsaren' : 'Saknas';
    $('#sttStatus').className = 'pill ' + (s.soniox ? 'ok' : hasSR ? 'warn' : 'bad');
  } catch { $('#apiStatus').textContent = 'Servern svarar inte'; $('#apiStatus').className = 'pill bad'; }
}

window.addEventListener('resize', () => {
  const r = recordings.find(onDetail);
  r ? drawPlayer(r, playingId === r.id ? player.currentTime : 0) : drawLive(rec?.bars || []);
});
load();
