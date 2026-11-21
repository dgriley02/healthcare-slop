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
const recLang = () => 'sv-SE'; // Soniox detects the language(s) itself; the browser preview listens for Swedish

/* ---------- server state ---------- */
const PATIENTS = [ // synthetic demo patients
  { id: 'P1', name: 'Erik Lund', age: 34 }, { id: 'P2', name: 'Sara Holm', age: 41 }, { id: 'P3', name: 'Amira Haddad', age: 52 },
  { id: 'P4', name: 'Jonas Berg', age: 27 }, { id: 'P5', name: 'Birgitta Ek', age: 63 }, { id: 'P6', name: 'Ali Karimi', age: 38 },
  { id: 'P7', name: 'Maja Lind', age: 31 }, { id: 'P8', name: 'Fatima Noor', age: 45 }, { id: 'P9', name: 'Karin Sjö', age: 49 }, { id: 'P10', name: 'Daniel Moore', age: 36 },
];
let recordings = [], retentionDays = 7, online = true;
const ui = {}; // per-recording view state that is local to this device: { open, vimEditing, wantOpen }
const uiOf = r => (ui[r.id] ??= {});
async function api(method, url, body, type = 'application/json') {
  const res = await fetch(url, { method, headers: body ? { 'content-type': type } : {}, body: type === 'application/json' && body ? JSON.stringify(body) : body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
async function load() {
  try {
    const d = await api('GET', '/api/recordings');
    recordings = d.recordings; retentionDays = d.retentionDays; online = true;
    for (const r of recordings) { // open a document automatically once the generation this device asked for is done
      const u = uiOf(r);
      if (u.wantOpen && r.docs[u.wantOpen]?.data) { u.open = u.wantOpen; u.wantOpen = null; }
      if (u.wantOpen && r.docs[u.wantOpen]?.error) u.wantOpen = null;
    }
  } catch { online = false; }
  render();
}
// Live sync: re-render on every server change, but never while the user is typing or editing.
let dirty = false;
const busy = () => { const a = document.activeElement; return a && (a.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName)) || Object.values(ui).some(u => u.vimEditing); };
function render() { if (busy()) { dirty = true; return; } dirty = false; route(); }
document.addEventListener('focusout', () => setTimeout(() => dirty && render(), 0));
new EventSource('/api/events').onmessage = () => load();
// Fallback: some tunnels/proxies buffer SSE, so also poll (cheap: one small JSON request).
let lastPoll = '';
setInterval(async () => {
  try { const t = await (await fetch('/api/recordings')).text(); if (t !== lastPoll) { const first = !lastPoll; lastPoll = t; if (!first) load(); } } catch {}
}, 4000);

/* ---------- router ---------- */
const find = id => recordings.find(x => x.id === id);
function route() {
  const h = location.hash, m = h.match(/^#\/r\/(R\d+)/), r = m && find(m[1]);
  const section = h.startsWith('#/patienter') ? 'patienter' : h.startsWith('#/installningar') ? 'installningar' : 'inspelning';
  document.querySelectorAll('.rail a[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === section));
  if (!r) player.pause();
  if (r) renderDetail(r);
  else if (section === 'patienter') renderPatients();
  else if (section === 'installningar') renderSettings();
  else if (rec) refreshList(); // keep the live recorder intact while recording
  else renderRecord();
}
window.addEventListener('hashchange', () => { dirty = false; route(); });
const onDetail = r => location.hash === `#/r/${r.id}`;

/* ---------- recording view ---------- */
let rec = null, openMenu = null;
function listHtml() {
  if (!online && !recordings.length) return '<li class="muted small">Kan inte nå servern.</li>';
  return recordings.slice().reverse().map(r => `
    <li><a href="#/r/${r.id}"><b>${r.id}</b><span class="t">${esc(r.title)}</span>
      <span class="m">${r.processing ? '<span class="pill warn">Bearbetar…</span>' : `${fmtTime(r.createdAt)} · ${fmtDur(r.duration)}${r.audio ? ' · ljud' : ''}`}</span></a>
      <div class="menu-wrap"><button class="icon more" data-menu="${r.id}" aria-label="Fler val">${ICON.more}</button>
        ${openMenu === r.id ? `<div class="menu"><a href="#/r/${r.id}">Öppna</a><button data-rename="${r.id}">Byt namn</button><button data-del="${r.id}" class="bad">Ta bort</button></div>` : ''}</div></li>`).join('');
}
function refreshList() { const l = $('#list'); if (l) l.innerHTML = listHtml(); }
function renderRecord() {
  $('#view').innerHTML = `
    <div class="rec-layout">
      <section class="stage">
        <div class="wave-wrap"><canvas id="wave"></canvas></div>
        <div class="timer" id="timer">${rec ? fmtDur((Date.now() - rec.start) / 1000) : '0:00'}</div>
        <button class="recbtn ${rec ? 'on' : ''}" id="recbtn" aria-label="Starta/stoppa inspelning">${rec ? ICON.stop : ICON.mic}</button>
        <p class="live" id="live"></p>
        <p class="hint" id="hint">${rec ? 'Spelar in. Tryck för att stoppa.' : 'Tryck för att börja spela in samtalet'}</p>

      </section>
      <aside class="list"><h2>Inspelningar</h2><ul id="list">${listHtml()}</ul>
        <p class="privacy">Synkas mellan dina enheter. Demo: använd bara rollspelade samtal, ingen riktig patientdata.</p></aside>
    </div>`;
  $('#recbtn').onclick = () => (rec ? stopRecording() : startRecording());
  $('#list').onclick = async e => {
    const t = e.target.closest('[data-menu],[data-del],[data-rename]'); if (!t) return;
    const { menu, del, rename } = t.dataset;
    if (menu) { openMenu = openMenu === menu ? null : menu; return refreshList(); }
    openMenu = null;
    if (del && confirm(`Ta bort ${del}? Ljud, transkript och dokument raderas på alla enheter.`)) await api('DELETE', `/api/recordings/${del}`).catch(err => alert(err.message));
    if (rename) { const n = prompt('Nytt namn', find(rename)?.title); if (n?.trim()) await api('PATCH', `/api/recordings/${rename}`, { title: n.trim() }).catch(err => alert(err.message)); }
    refreshList();
  };
  drawLive(rec?.bars || []);
}
document.addEventListener('click', e => { if (openMenu && !e.target.closest('.menu-wrap')) { openMenu = null; refreshList(); } });

function setupCanvas(c) {
  const dpr = devicePixelRatio || 1;
  c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr;
  const g = c.getContext('2d'); g.scale(dpr, dpr); return g;
}
function drawLive(bars) {
  const c = $('#wave'); if (!c) return;
  const g = setupCanvas(c), w = c.clientWidth, h = c.clientHeight, step = 4, view = bars.slice(-(Math.floor(w / step) - 10));
  g.fillStyle = '#d0d5dd'; g.fillRect(0, h / 2 - 0.5, w, 1);
  g.fillStyle = '#e73534';
  view.forEach((v, i) => { const bh = Math.max(2, v * h * 0.9); g.fillRect(i * step, (h - bh) / 2, 2.5, bh); });
  g.fillStyle = '#101828'; g.fillRect(view.length * step, 4, 2, h - 8);
}

async function startRecording() {
  const state = { bars: [], start: Date.now(), chunks: [], segments: [], lang: recLang() };
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    state.ctx = new AudioContext();
    state.analyser = state.ctx.createAnalyser(); state.analyser.fftSize = 1024;
    state.ctx.createMediaStreamSource(state.stream).connect(state.analyser);
    state.mr = new MediaRecorder(state.stream); // saves the audio so the doctor can listen back
    state.mr.ondataavailable = e => e.data.size && state.chunks.push(e.data);
    state.mr.start(1000);
    state.start = Date.now(); // t=0 is when audio actually starts (not before the mic permission prompt)
  } catch { state.simulated = true; }
  rec = state; renderRecord();
  if (state.simulated) $('#hint').textContent = 'Ingen mikrofon, inget ljud sparas';

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) { // live Swedish speech recognition (Chrome sends audio to Google, demo only)
    const sr = new SR(); sr.lang = state.lang; sr.continuous = true; sr.interimResults = true;
    sr.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        state.phraseStart ??= (Date.now() - state.start) / 1000; // when this phrase began, for click-to-play
        if (res.isFinal) {
          state.segments.push({ text: res[0].transcript.trim(), conf: res[0].confidence || 0.9, start: Math.max(0, state.phraseStart - 0.5) });
          state.phraseStart = null;
        } else interim += res[0].transcript;
      }
      state.interim = interim;
      const l = $('#live'); if (l && rec === state) l.textContent = [...state.segments.slice(-2).map(x => x.text), interim].join(' ').trim();
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
  state.timer = setInterval(() => {
    let v = 0.1 + Math.random() * 0.4;
    if (state.analyser) { state.analyser.getByteTimeDomainData(buf); v = Math.sqrt(buf.reduce((s, x) => s + ((x - 128) / 128) ** 2, 0) / buf.length) * 4; }
    state.bars.push(Math.min(1, v));
    if (rec === state) { drawLive(state.bars); const t = $('#timer'); if (t) t.textContent = fmtDur((Date.now() - state.start) / 1000); }
  }, BAR_MS);
}

// Stopping creates the recording on the server and returns to an idle recorder right away.
// Audio upload and transcript processing continue in the background; all devices see the result.
async function stopRecording() {
  const state = rec; rec = null;
  clearInterval(state.timer);
  const duration = (Date.now() - state.start) / 1000;
  const bars = state.bars.filter((_, i) => i % 2 === 0).map(v => +v.toFixed(2)); // half resolution is plenty for display
  renderRecord();
  const created = api('POST', '/api/recordings', { duration, bars }).catch(e => (alert(`Kunde inte spara inspelningen: ${e.message}`), null));

  const srDone = state.sr ? new Promise(res => { state.sr.onend = res; state.sr.stop(); setTimeout(res, 1500); }) : null;
  const audioDone = state.mr?.state === 'recording' ? new Promise(res => { state.mr.onstop = res; state.mr.stop(); }) : null;
  await Promise.all([srDone, audioDone]);
  state.stream?.getTracks().forEach(t => t.stop()); state.ctx?.close();
  if (state.interim?.trim()) state.segments.push({ text: state.interim.trim(), conf: 0.6, start: Math.max(0, (state.phraseStart ?? duration) - 0.5) });

  const r = await created; if (!r) return;
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
  const patient = PATIENTS.find(p => p.id === r.patient);
  const lines = r.transcript.map(x => `
    <div class="tline" id="${x.id}" data-t="${x.start ?? ''}"><span class="spk ${x.speaker === 'Läkare' ? 'sl' : x.speaker === 'Patient' ? 'sp' : ''}">${{ Läkare: 'läk:', Patient: 'pat:' }[x.speaker] || 'tal:'}</span>
      <span dir="auto">${x.words.map(w => conf(w.c) ? `<span class="w ${conf(w.c)}" title="Konfidens ${Math.round(w.c * 100)} %">${esc(w.w)}</span>` : esc(w.w)).join(' ')}</span>
      <span class="ts">${x.start != null ? fmtDur(x.start) : ''}</span></div>`).join('');
  $('#view').innerHTML = `
    <div class="detail" data-id="${r.id}">
      <header class="dhead"><a href="#/" class="icon back" aria-label="Tillbaka">${ICON.back}</a>
        <div><h1>${r.id} · ${esc(r.title)}</h1><span class="muted small">${patient ? esc(patient.name) + ' · ' : ''}${fmtTime(r.createdAt)} · ${fmtDur(r.duration)}${r.lang && !/^sv(-SE)?$/.test(r.lang) ? ` · samtal på ${LANGS[r.lang] || r.lang.split('+').map(c => LANGNAME[c] || c).join(' + ')}, dokument på svenska` : ''}${r.stt === 'soniox' ? ' · Soniox' : ''}</span></div></header>
      <div class="dgrid ${u.open ? 'doc-open' : ''}">
        <article class="card tcard">
          ${r.note ? `<p class="mock">${esc(r.note)}</p>` : ''}
          ${r.processing ? '<p class="muted">Bearbetar inspelningen: identifierar talare och sammanfattar…</p>' : r.summary ? `<p class="summary">${esc(r.summary)}</p>` : ''}
          <div class="trow"><h2>Transkribering</h2><span class="legend"><i class="w mid">osäker</i><i class="w low">mycket osäker</i></span></div>
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
  $('#playbtn').onclick = () => { loadAudio(r); player.paused ? player.play() : player.pause(); };
  $('#pwave').onclick = e => { const b = e.target.getBoundingClientRect(); seek(r, (e.clientX - b.left) / b.width * r.duration); };
  $('#transcript').onclick = e => { const l = e.target.closest('.tline'); if (l?.dataset.t) seek(r, +l.dataset.t); };
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
  return `Ljudet sparas tills ett dokument godkänts och raderas ${retentionDays} dagar därefter.`;
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
const ed = (path, text, ids, level = 'ok') => `<span class="claim ${level}" data-path="${path}" data-orig="${esc(text)}" data-ev="${(ids || []).join(',')}" contenteditable>${esc(text)}</span>${refs(ids)} `;
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
  const patient = PATIENTS.find(p => p.id === r.patient);
  const body = {
    patient: patient ? patient.name : 'Ny patient', personnummer: 'ÅÅÅÅMMDD-XXXX (demo)', date: isoDate(r.createdAt),
    occupation: field('occupation'), icd10, diagnosis: rest.join(' '),
    function_impairment: field('function_impairment'), activity_limitation: field('activity_limitation'), treatment: field('treatment'),
    degree: c.sick_leave.degree, from: isoDate(Date.now()), to: isoDate(Date.now() + (c.sick_leave.days - 1) * 864e5), motivation: c.motivation_longer_leave,
    prognosis_option: c.prognosis?.option, prognosis_months: c.prognosis?.months, prognosis_reason: c.prognosis?.reason,
    work_measures: field('work_measures'), other: '',
  };
  return savePdf(formId, body, r);
}
function downloadAg114(r) {
  const a = r.docs.arb.data, patient = PATIENTS.find(p => p.id === r.patient);
  const text = cls => [...document.querySelectorAll(`[data-arb="${cls}"] .claim`)].map(x => x.textContent.trim()).join(' ');
  return savePdf('ag114', {
    patient: patient ? patient.name : 'Ny patient', personnummer: 'ÅÅÅÅMMDD-XXXX (demo)', date: isoDate(r.createdAt),
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
function renderPatients() {
  $('#view').innerHTML = `<div class="page"><h1>Patienter</h1><p class="muted">Syntetiska demopatienter, ingen riktig patientdata.</p>
    ${PATIENTS.map(p => {
      const recs = recordings.filter(r => r.patient === p.id);
      return `<div class="card prow"><div><b>${esc(p.name)}</b><span class="muted small"> · ${p.age} år</span></div>
        <div class="chips">${recs.map(r => `<a class="chip" href="#/r/${r.id}">${r.id} · ${fmtTime(r.createdAt)}</a>`).join('') || '<span class="muted small">Inga inspelningar</span>'}</div></div>`;
    }).join('')}</div>`;
}
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
