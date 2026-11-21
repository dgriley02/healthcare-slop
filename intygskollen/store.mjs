// Shared recording store so phone and desktop see the same data.
// Demo persistence: data/db.json + data/audio/<id>. Only synthetic / role-played data belongs here.
// Clients get live updates over Server-Sent Events (/api/events) and refetch /api/recordings.
import { readFile, writeFile, mkdir, unlink, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import vm from 'node:vm';
import { randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { transcribe, sonioxConfigured, startRealtime } from './soniox.mjs';
import { runChecks } from './rules.mjs';

const DIR = new URL('./data/', import.meta.url);
const AUDIO = new URL('./audio/', DIR);
const DB = new URL('./db.json', DIR);
export const RETENTION_DAYS = 7; // audio is deleted this many days after the first signature
const db = { nextId: 1, recordings: [], patients: [], session: { state: 'idle', version: 0 } };

// Synthetic demo patients. Personnummer use the made-up serial "TFnn" so they can never match a real person.
const PATIENT_SEED = [
  ['Erik Lund', 34], ['Sara Holm', 41], ['Amira Haddad', 52], ['Jonas Berg', 27], ['Birgitta Ek', 63], ['Ali Karimi', 38], ['Maja Lind', 31],
  ['Fatima Noor', 45], ['Karin Sjö', 49], ['Daniel Moore', 36], ['Layla Hassan', 29], ['Reza Ahmadi', 34], ['Hodan Ali', 41], ['Senait Tesfay', 37],
  ['Karwan Rashid', 44], ['Emir Hodžić', 58], ['Piotr Nowak', 39], ['Ayşe Yılmaz', 67], ['Olena Kovalenko', 33], ['Aino Virtanen', 71],
  ['Erkki Niemi', 64], ['Ánne Sara', 26], ['Milan Kaldaras', 47], ['Rivka Goldberg', 82], ['Lars Persson', 55], ['Emma Nilsson', 23], ['Michael Brown', 38],
];
function seedPatients() {
  PATIENT_SEED.forEach(([name, age], i) => {
    const id = 'P' + (i + 1), existing = db.patients.find(p => p.id === id);
    if (existing) { Object.assign(existing, { name, age }); return; } // keep demo patients in line with the seed list
    const y = 2026 - age, m = String(1 + (i * 5) % 12).padStart(2, '0'), d = String(1 + (i * 7) % 28).padStart(2, '0');
    db.patients.push({ id, name, age, personnummer: `${y}${m}${d}-TF${String(i + 1).padStart(2, '0')}` });
  });
}

/* ---------- persistence & events ---------- */
let saveTimer;
const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => writeFile(DB, JSON.stringify(db)).catch(e => console.error('save', e.message)), 200); };
const clients = new Set();
function changed() { save(); for (const res of clients) res.write('data: change\n\n'); broadcast({ type: 'change' }); }

/* ---------- WebSocket: instant sync + live view of a recording on the other devices ---------- */
const sockets = new Set(), wsTokens = new Map(); // token -> expiry (issued over the password-protected HTTP API)
function broadcast(msg, except) { const s = JSON.stringify(msg); for (const ws of sockets) if (ws !== except && ws.readyState === 1) ws.send(s); }
/* Separate binary channel for the live audio stream: the recording device sends PCM frames, the server replicates them
   to every other connected device. The server also measures each device's latency (ping/pong) and tells all devices
   one shared display delay, so the waveform appears at the same moment on the phone and on the desktop. */
const audioSockets = new Set();
const SYNC_MIN = 120, SYNC_MAX = +(process.env.AUDIO_SYNC_MAX_MS || 600), JITTER_MS = 150;
function onAudioSocket(ws) {
  ws.rtt = null; audioSockets.add(ws);
  ws.on('close', () => audioSockets.delete(ws));
  ws.on('message', (data, isBinary) => {
    if (isBinary) { // audio frame: only the device that currently records may stream
      if (ws.device && db.session.state === 'recording' && ws.device === db.session.recorder) {
        for (const o of audioSockets) if (o !== ws && o.readyState === 1) o.send(data, { binary: true });
        liveTranscribe(data);
      }
      return;
    }
    try {
      const m = JSON.parse(data);
      if (m.type === 'hello') ws.device = String(m.device);
      if (m.type === 'pong') { const r = Date.now() - m.t; ws.rtt = ws.rtt == null ? r : ws.rtt * 0.7 + r * 0.3; }
    } catch {}
  });
}
// Live text: the same stream goes to Soniox's real-time API; its text is sent to every device (recorder included).
let rt = null, rtVersion = null, lastLive = 0;
function liveTranscribe(frame) {
  if (!sonioxConfigured()) return;
  if (!rt || rtVersion !== db.session.version) {
    rt?.end(); rtVersion = db.session.version;
    let added = '', partial = '', timer = null;
    const flush = () => { timer = null; lastLive = Date.now(); broadcast({ type: 'live', source: 'soniox', add: added, partial: partial.slice(-200) }); added = ''; };
    rt = startRealtime(live => { // final text is append-only: collect it between sends (~8 per second)
      added += live.add; partial = live.partial;
      if (!timer) timer = setTimeout(flush, Math.max(0, 125 - (Date.now() - lastLive)));
    });
  }
  rt.send(Buffer.from(frame).subarray(4)); // strip our 4-byte sample index
}
function endLive() { rt?.end(); rt = null; }

setInterval(() => {
  const now = Date.now();
  const receivers = [...audioSockets].filter(w => w.rtt != null && w.device !== db.session.recorder);
  const ms = receivers.length ? Math.round(Math.min(SYNC_MAX, Math.max(SYNC_MIN, Math.max(...receivers.map(w => w.rtt / 2)) + JITTER_MS))) : 0;
  const msg = JSON.stringify({ type: 'delay', ms }), ping = JSON.stringify({ type: 'ping', t: now });
  for (const w of audioSockets) if (w.readyState === 1) { w.send(ping); w.send(msg); }
}, 1000).unref();

export function attachWs(server) {
  const wss = new WebSocketServer({ noServer: true }), awss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://x'), token = url.searchParams.get('token');
    if (!wsTokens.has(token) || wsTokens.get(token) < Date.now()) return socket.destroy();
    if (url.pathname === '/audio') return awss.handleUpgrade(req, socket, head, onAudioSocket);
    if (url.pathname !== '/ws') return socket.destroy();
    wss.handleUpgrade(req, socket, head, ws => {
      sockets.add(ws);
      ws.on('close', () => sockets.delete(ws));
      ws.on('message', raw => { // the recording device streams waveform + live text; relay it to the others
        try { const m = JSON.parse(raw); if (m.type === 'live' && db.session.state === 'recording' && m.device === db.session.recorder) broadcast({ type: 'live', text: String(m.text || '').slice(-400), elapsed: m.elapsed }, ws); } catch {}
      });
    });
  });
}

/* ---------- example recordings (synthetic) ---------- */
const hash = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const exampleConfidence = text => text.split(' ').map((w, i) => {
  const h = hash(w + i) % 100;
  return { w, c: h < 6 ? 0.45 + h / 20 : h < 16 ? 0.7 + (h - 6) / 100 : 0.9 + (h % 10) / 100 };
});
async function seedExamples() { // adds any example conversation that is not in the database yet
  const ctx = { window: {} };
  for (const f of ['samples.js', 'samples-samelang.js']) // the second file overrides some examples
    vm.runInNewContext(await readFile(new URL(`./public/${f}`, import.meta.url), 'utf8').catch(() => ''), ctx);
  const { SAMPLES, SUMMARIES, SAMPLE_LANGS = {}, SAMPLE_META = {} } = ctx.window, names = Object.keys(SAMPLES);
  names.forEach((name, i) => {
    const existing = db.recordings.find(r => r.example && r.exampleKey === name);
    if (existing) { // example text changed (e.g. now fully in the patient's language): refresh it and drop drafts built on the old text
      if (SAMPLE_LANGS[name] && existing.lang !== SAMPLE_LANGS[name]) {
        const per = existing.duration / SAMPLES[name].length;
        existing.transcript = SAMPLES[name].map((u, k) => ({ id: 'U' + (k + 1), speaker: u.speaker, text: u.text, start: k * per, words: exampleConfidence(u.text) }));
        existing.lang = SAMPLE_LANGS[name]; existing.docs = {}; delete existing.relevance;
      }
      return;
    }
    const lines = SAMPLES[name], duration = lines.length * 22, per = duration / lines.length;
    db.recordings.push({
      id: 'R' + db.nextId++, title: name, exampleKey: name, patient: SAMPLE_META[name]?.patient || 'P' + (i + 1), example: true, duration,
      createdAt: new Date(Date.now() - (SAMPLE_META[name]?.daysAgo != null ? SAMPLE_META[name].daysAgo * 864e5 : (names.length - i) * 5 * 36e5)).toISOString(),
      bars: Array.from({ length: Math.round(duration / 0.06 / 4) }, (_, k) => +(0.12 + Math.abs(Math.sin(k / 3)) * 0.45 * Math.random() + Math.random() * 0.15).toFixed(2)),
      transcript: lines.map((u, k) => ({ id: 'U' + (k + 1), speaker: u.speaker, text: u.text, start: k * per, words: exampleConfidence(u.text) })),
      summary: SUMMARIES[name], docs: {}, lang: SAMPLE_LANGS[name],
    });
  });
}

export async function init() {
  await mkdir(AUDIO, { recursive: true });
  try { Object.assign(db, JSON.parse(await readFile(DB, 'utf8'))); } catch {}
  for (const r of db.recordings) if (r.example) {
    r.exampleKey ??= r.title; // older databases
    if (/engelska/i.test(r.exampleKey)) r.lang ??= 'sv+en'; // mixed-language example
  }
  // drop example meetings whose example no longer exists (e.g. renamed demo patient)
  const ctx = { window: {} };
  for (const f of ['samples.js', 'samples-samelang.js']) vm.runInNewContext(await readFile(new URL(`./public/${f}`, import.meta.url), 'utf8').catch(() => ''), ctx);
  db.recordings = db.recordings.filter(r => !r.example || !r.exampleKey || ctx.window.SAMPLES?.[r.exampleKey]);
  await seedExamples(); seedPatients();
  db.session ??= { state: 'idle', version: 0 };
  if (db.session.state === 'recording' || db.session.state === 'uploading') db.session.state = 'ready'; // a restart interrupted it
  save();
  for (const r of db.recordings) { // generation interrupted by a restart: let the user retry
    r.processing = false;
    for (const d of Object.values(r.docs)) if (d.loading) { d.loading = false; d.error ??= 'Avbröts när servern startades om'; }
  }
  setInterval(purgeExpiredAudio, 60e3); purgeExpiredAudio();
}

async function purgeExpiredAudio() {
  for (const r of db.recordings) {
    if (!r.audio || !r.signedAt || Date.now() < Date.parse(r.signedAt) + RETENTION_DAYS * 864e5) continue;
    await unlink(new URL(r.id, AUDIO)).catch(() => {});
    r.audio = false; r.audioDeleted = true; changed();
  }
}

/* ---------- API ---------- */
const json = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
const body = async req => { const c = []; for await (const x of req) c.push(x); return Buffer.concat(c); };
const fail = (status, msg) => Object.assign(new Error(msg), { status });
const plain = transcript => transcript.map(({ id, speaker, speakerDetail, text }) => ({ id, speaker, speakerDetail, text }));
const journalText = r => r.docs.journal?.data?.sections.map(s => `${s.heading}: ${s.claims.map(c => c.text).join(' ')}`).join('\n') || '';
const browserLines = segs => segs.map((x, i) => ({ id: 'U' + (i + 1), speaker: '?', text: x.text.trim(), start: x.start, words: x.text.trim().split(/\s+/).map(w => ({ w, c: x.conf })) }));
// MOCKED integrations with the systems Region Skåne primary care uses (PMO, Webcert, eLAB RS, Sectra, PASiS, 1177 direkt).
// Nothing leaves the server: each step is just recorded with a timestamp so the UI can show a realistic status flow.
const ref = p => `${p}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
const ROUTES = {
  journal: () => ({ system: 'PMO', ref: ref('PMO'), steps: ['Journalanteckning förd till PMO', 'Signerad i PMO', 'Synlig i 1177 Journalen'] }),
  fk: () => ({ system: 'Webcert', ref: ref('WC'), steps: ['Utkast skapat i Webcert via PMO (Intygsmodulen)', 'Signerat med SITHS-kort', 'FK 7804 skickat till Försäkringskassan', 'Mottaget av Försäkringskassan', 'AG 7804 skapat från FK 7804, utan diagnos', 'Intygen tillgängliga för patienten i 1177 Intyg'] }),
  arb: () => ({ system: 'Webcert', ref: ref('WC'), steps: ['Utkast skapat i Webcert via PMO (Intygsmodulen)', 'Signerat med SITHS-kort', 'AG 1-14 tillgängligt för patienten i 1177 Intyg', 'Patienten kan skriva ut eller vidarebefordra till arbetsgivaren'] }),
  recept: d => ({ system: 'PMO läkemedelsmodul', ref: ref('RX'), steps: ['Receptförslag inlagt i PMO läkemedelsmodul', 'Kontrollerat mot Nationella läkemedelslistan: inga interaktioner', `E-recept signerat med SITHS och skickat till E-hälsomyndigheten (${d.prescriptions.length} st)`, 'Tillgängligt för uttag på apotek'] }),
  lab: d => ({ system: 'eLAB RS', ref: ref('LAB'), steps: [`Beställning skapad i eLAB RS (${d.tests.length} analyser)`, 'Signerad av beställande läkare', 'Etiketter klara för provtagning', 'Mottagen av Labmedicin Skåne'] }),
  rtg: d => ({ system: 'Sectra (SOM)', ref: ref('BFM'), steps: [`Remiss skapad i Sectra: ${d.exam}`, 'Signerad och skickad', 'Mottagen av Bild- och funktionsmedicin', `Prioriterad: ${d.urgency}, patienten kallas`] }),
  remiss: d => ({ system: 'PMO konsultremiss', ref: ref('REM'), steps: ['Konsultremiss skapad via PMO adressbok', `Signerad och skickad till ${d.to}`, 'Mottagen, under bedömning'] }),
  uppfoljning: d => ({ system: 'PASiS', ref: ref('PAS'), steps: [`Bevakning skapad i PASiS (${d.actions.length} åtgärder)`, 'Tilldelad vårdadministratör', 'Patienten kontaktas för bokning'] }),
  patientinfo: () => ({ system: '1177 direkt', ref: ref('1177'), steps: ['Meddelande skickat i läkarens namn via 1177 direkt', 'Avisering skickad till patienten (sms)', 'Läst av patienten'] }),
};
function dispatch(d, { system, ref, steps }) {
  d.dispatch = { system, ref, started: new Date().toISOString(), steps: [], done: false };
  const run = d.dispatch, delays = [300, 1200, 2500, 4000, 5500, 7000];
  steps.forEach((label, i) => setTimeout(() => {
    if (d.dispatch !== run) return;
    run.steps.push({ label, at: new Date().toISOString() });
    if (i === steps.length - 1) run.done = true;
    changed();
  }, delays[i] ?? 7000 + i * 1000));
  run.total = steps.length; changed();
}
const AUTO_MIN_SCORE = +(process.env.AUTO_MIN_SCORE || 70); // relevance needed for a card to be drafted automatically
// Earlier meetings with the same patient, newest first, within a character budget: context for documents such as an
// extended sick leave. Line ids are prefixed with the meeting id ("R72:U9") so they can be cited and checked.
const PRIOR_BUDGET = +(process.env.PRIOR_CONTEXT_CHARS || 24000);
function priorContext(r) {
  if (!r.patient) return [];
  const earlier = db.recordings.filter(x => x !== r && x.patient === r.patient && x.createdAt < r.createdAt && x.transcript.length)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const out = []; let used = 0;
  for (const m of earlier) {
    const header = `Besök ${m.id}, ${m.createdAt.slice(0, 10)}: ${m.title}`;
    const lines = m.transcript.map(u => ({ id: `${m.id}:${u.id}`, speaker: u.speaker, speakerDetail: u.speakerDetail, text: u.text }));
    const size = header.length + lines.reduce((n, u) => n + u.text.length + 30, 0);
    if (used + size > PRIOR_BUDGET) break;
    lines[0].header = header; out.push(...lines); used += size;
  }
  return out;
}
const NEEDS = { journal: null, fk: null, arb: null, recept: null, lab: null, rtg: null, remiss: null, uppfoljning: null, patientinfo: null };

export function createApi({ analyze, generateDoc, processTranscript, rankCards }) {
  async function runRank(r) {
    if (r.relevance?.loading || !r.transcript.length) return;
    r.relevance = { loading: true }; changed();
    try { r.relevance = await rankCards({ transcript: plain(r.transcript), prior: priorContext(r), today: r.createdAt.slice(0, 10) }); }
    catch (e) { r.relevance = { error: e.message }; }
    changed();
    autoGenerate(r);
  }
  // "Invisible" flow: draft the journal and every clearly relevant card in the background, so they are ready
  // when the doctor opens the conversation. The doctor still reviews and signs everything.
  function autoGenerate(r) {
    const kinds = ['journal', ...(r.relevance?.cards || []).filter(c => c.relevant && c.score >= AUTO_MIN_SCORE).map(c => c.kind)];
    for (const k of new Set(kinds)) if (k in NEEDS && !r.docs[k]) runGenerate(r, k);
  }
  // Soniox async transcription of the stored audio (also used by "Transkribera om"). Falls back to the browser's segments.
  function sonioxTranscribe(r, segs = []) {
    r.stt = 'soniox'; r.processing = true; changed();
    (async () => {
      try {
        const lines = await transcribe(await readFile(new URL(r.id, AUDIO)), r.audioType, r.lang);
        const langs = [...new Set(lines.flatMap(l => (l.lang || '').split('+')).filter(Boolean))];
        if (langs.length) r.lang = langs.join('+');
        if (lines.length) { r.transcript = lines; r.note = undefined; changed(); return runProcess(r); }
        r.note = 'Inget tal uppfattades.'; r.title = 'Ingen text';
      } catch (e) {
        r.note = `${e.message}. Visar webbläsarens transkribering i stället.`; r.stt = 'browser';
        if (segs.length) { r.transcript = browserLines(segs); changed(); return runProcess(r); }
      }
      r.processing = false; changed();
    })();
  }
  async function runProcess(r) {
    try {
      // Soniox diarization gives each line a voice number; it helps Claude tell doctor from patient.
      const p = await processTranscript({ transcript: r.transcript.map(u => ({ id: u.id, speaker: '?', text: u.voice ? `[röst ${u.voice}] ${u.text}` : u.text })), lang: r.lang });
      const norm = w => w.toLowerCase().replace(/[^a-zåäö0-9]/g, '');
      for (const seg of p.segments) {
        const u = r.transcript.find(x => x.id === seg.id); if (!u) continue;
        u.speaker = seg.speaker; u.speakerDetail = seg.speaker_detail || '';
        const sus = new Set(seg.suspect_words.map(norm));
        u.words.forEach(x => { if (sus.has(norm(x.w))) x.c = Math.min(x.c, 0.7); });
      }
      r.title = p.title; r.summary = p.summary;
    } catch (e) { r.note = `Kunde inte bearbeta transkriptet: ${e.message}`; }
    r.processing = false; changed();
    runRank(r);
  }
  async function runGenerate(r, kind) {
    r.docs[kind] = { loading: true }; changed();
    try {
      const args = { transcript: plain(r.transcript), lang: r.lang, journal: kind === 'journal' ? undefined : journalText(r), prior: priorContext(r), today: r.createdAt.slice(0, 10) };
      const data = kind === 'fk' ? await analyze(args) : await generateDoc(kind, args);
      r.docs[kind] = { data, createdAt: new Date().toISOString() };
    } catch (e) { r.docs[kind] = { error: e.message }; }
    changed();
  }

  return async function handle(req, res) {
    const url = req.url.split('?')[0];
    if (url === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no', connection: 'keep-alive' });
      res.flushHeaders?.();
      res.write('retry: 2000\n\n'); clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25e3); // keeps the tunnel from closing idle streams
      req.on('close', () => { clients.delete(res); clearInterval(ping); });
      return true;
    }
    if (url === '/api/recordings' && req.method === 'GET') return json(res, 200, { recordings: db.recordings, retentionDays: RETENTION_DAYS }), true;
    if (url === '/api/state' && req.method === 'GET') return json(res, 200, { recordings: db.recordings, patients: db.patients, session: db.session, retentionDays: RETENTION_DAYS, sonioxLive: sonioxConfigured() }), true;
    if (url === '/api/ws-token' && req.method === 'GET') { const t = randomBytes(16).toString('hex'); wsTokens.set(t, Date.now() + 12 * 36e5); return json(res, 200, { token: t }), true; }
    if (url === '/api/session' && req.method === 'POST') { // one shared "current meeting" so phone and desktop follow each other
      const { action, patientId, device } = JSON.parse(await body(req) || '{}'), s = db.session;
      if (action === 'new') {
        if (s.state === 'recording' || s.state === 'uploading') throw fail(409, 'En inspelning pågår redan');
        if (!db.patients.some(p => p.id === patientId)) throw fail(404, 'Okänd patient');
        db.session = { state: 'ready', patientId, version: (s.version || 0) + 1 };
      } else if (action === 'start') {
        if (s.state !== 'ready') throw fail(409, s.state === 'recording' ? 'Inspelningen pågår redan på en annan enhet' : 'Inget nytt möte är valt');
        Object.assign(s, { state: 'recording', recorder: device, startedAt: new Date().toISOString() });
      } else if (action === 'stop') {
        if (s.state !== 'recording' || s.recorder !== device) throw fail(409, 'Den här enheten spelar inte in');
        s.state = 'uploading'; endLive();
      } else if (action === 'cancel') {
        if (s.state === 'recording' && s.recorder !== device) throw fail(409, 'Inspelningen pågår på en annan enhet');
        db.session = { state: 'idle', version: (s.version || 0) + 1 }; endLive();
      } else throw fail(400, 'Okänd åtgärd');
      changed(); return json(res, 200, db.session), true;
    }
    if (url === '/api/recordings' && req.method === 'POST') {
      const { duration = 0, bars = [], device } = JSON.parse(await body(req) || '{}'), s = db.session;
      const patient = s.patientId;
      const r = { id: 'R' + db.nextId++, title: 'Ny inspelning', patient, createdAt: new Date().toISOString(), duration, bars, transcript: [], summary: '', docs: {}, processing: true };
      db.recordings.push(r);
      if (s.state === 'uploading' && s.recorder === device) Object.assign(s, { state: 'done', meetingId: r.id }); // every device now opens the transcript
      changed();
      return json(res, 201, r), true;
    }
    if (url === '/api/recordings' && req.method === 'DELETE') {
      for (const r of db.recordings) if (r.audio) await unlink(new URL(r.id, AUDIO)).catch(() => {});
      db.recordings = []; changed();
      return json(res, 200, {}), true;
    }

    const m = url.match(/^\/api\/recordings\/(R\d+)(?:\/([a-z]+))?(?:\/([a-z]+))?$/);
    if (!m) return false;
    const r = db.recordings.find(x => x.id === m[1]); if (!r) throw fail(404, 'Inspelningen finns inte');
    const [, , action, kind] = m;

    if (!action && req.method === 'PATCH') { const { title } = JSON.parse(await body(req)); if (title?.trim()) r.title = title.trim(); changed(); return json(res, 200, r), true; }
    if (!action && req.method === 'DELETE') {
      if (r.audio) await unlink(new URL(r.id, AUDIO)).catch(() => {});
      db.recordings.splice(db.recordings.indexOf(r), 1); changed(); return json(res, 200, {}), true;
    }
    if (action === 'audio' && req.method === 'PUT') {
      await writeFile(new URL(r.id, AUDIO), await body(req));
      r.audio = true; r.audioType = req.headers['content-type'] || 'audio/webm'; changed();
      return json(res, 200, {}), true;
    }
    if (action === 'audio' && req.method === 'GET') { // supports Range so the player can seek
      if (!r.audio) throw fail(404, 'Inget ljud');
      const file = new URL(r.id, AUDIO), { size } = await stat(file);
      const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
      if (range) {
        const start = range[1] ? +range[1] : 0, end = range[2] ? Math.min(+range[2], size - 1) : size - 1;
        res.writeHead(206, { 'content-type': r.audioType, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
        createReadStream(file, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { 'content-type': r.audioType, 'accept-ranges': 'bytes', 'content-length': size });
        createReadStream(file).pipe(res);
      }
      return true;
    }
    if (action === 'transcript' && req.method === 'POST') {
      const { segments = [], srError, noSpeechRecognition, lang } = JSON.parse(await body(req));
      if (lang) r.lang = String(lang).slice(0, 20);
      const segs = segments.filter(x => x.text?.trim());
      if (sonioxConfigured() && r.audio) { sonioxTranscribe(r, segs); return json(res, 202, {}), true; } // accurate server-side transcription; browser text was only a live preview
      r.stt = 'browser';
      if (!segs.length) {
        r.processing = false; r.title = 'Ingen text';
        r.note = noSpeechRecognition ? 'Taligenkänning stöds inte i webbläsaren som spelade in. Använd Chrome.' : `Inget tal uppfattades${srError ? ` (${srError})` : ''}.`;
        changed();
      } else {
        r.transcript = browserLines(segs);
        changed(); runProcess(r);
      }
      return json(res, 202, {}), true;
    }
    if (action === 'generate' && req.method === 'POST') {
      if (r.docs[kind]?.dispatch) throw fail(409, 'Dokumentet är redan godkänt och överfört');
      if (!(kind in NEEDS)) throw fail(400, 'Okänd dokumenttyp');
      if (r.processing || !r.transcript.length) throw fail(409, 'Transkriptet är inte klart');
      if (NEEDS[kind] && !r.docs[NEEDS[kind]]?.data) throw fail(409, 'Skapa journalen först');
      if (r.docs[kind]?.loading) return json(res, 202, {}), true;
      runGenerate(r, kind);
      return json(res, 202, {}), true;
    }
    if (action === 'journal' && req.method === 'PUT') { // edited by the doctor (e.g. in the Vim editor)
      if (r.docs.journal?.dispatch) throw fail(409, 'Journalen är godkänd och överförd och kan inte ändras');
      const { data } = JSON.parse(await body(req));
      r.docs.journal = { data, edited: new Date().toISOString() }; changed();
      return json(res, 200, {}), true;
    }
    if (action === 'doc' && req.method === 'PATCH') { // the doctor edits a field / adds or removes a list item
      const d = r.docs[kind]; if (!d?.data) throw fail(404, 'Dokumentet finns inte');
      if (d.dispatch) throw fail(409, 'Dokumentet är godkänt och överfört och kan inte ändras');
      const { op = 'set', path, value } = JSON.parse(await body(req));
      const keys = String(path || '').split('.'), last = keys.pop();
      if (!last || [...keys, last].some(k => ['__proto__', 'constructor', 'prototype'].includes(k))) throw fail(400, 'Ogiltig sökväg');
      const o = keys.reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), d.data);
      if (!o || typeof o !== 'object') throw fail(400, 'Ogiltig sökväg');
      if (op === 'set') o[last] = typeof o[last] === 'number' ? Number(value) || 0 : String(value ?? '').slice(0, 4000);
      else if (op === 'add' && Array.isArray(o[last])) o[last].push(value);
      else if (op === 'remove' && Array.isArray(o)) o.splice(+last, 1);
      else throw fail(400, 'Ogiltig ändring');
      d.edited = new Date().toISOString();
      if (kind === 'fk') d.data.checks = runChecks(d.data.cert, r.transcript, r.lang);
      changed(); return json(res, 200, {}), true;
    }
    if (action === 'retranscribe' && req.method === 'POST') { // new transcript from the stored audio; drafts built on the old one are dropped
      if (!r.audio || !sonioxConfigured()) throw fail(409, 'Inget ljud eller ingen Soniox-nyckel');
      if (Object.values(r.docs).some(d => d.dispatch)) throw fail(409, 'Ett dokument är redan godkänt och överfört');
      if (r.processing) throw fail(409, 'Bearbetas redan');
      r.docs = {}; delete r.relevance; sonioxTranscribe(r); return json(res, 202, {}), true;
    }
    if (action === 'reprocess' && req.method === 'POST') { // run speaker roles + summary again (keeps the text)
      if (!r.transcript.length || r.processing) throw fail(409, 'Inget transkript att analysera');
      r.processing = true; changed(); runProcess(r); return json(res, 202, {}), true;
    }
    if (action === 'speaker' && req.method === 'POST') { // the doctor corrects a speaker role (all lines of the same voice)
      const { line, role, detail = '' } = JSON.parse(await body(req));
      const ROLES = ['Läkare', 'Patient', 'Sjuksköterska', 'Anhörig', 'Tolk', 'Annan vårdpersonal', 'Övrig', 'Okänd'];
      const u = r.transcript.find(x => x.id === line); if (!u || !ROLES.includes(role)) throw fail(400, 'Ogiltig roll');
      for (const x of r.transcript) if (x === u || (u.voice && x.voice === u.voice)) { x.speaker = role; x.speakerDetail = String(detail).slice(0, 40); }
      changed(); return json(res, 200, {}), true;
    }
    if (action === 'relevance' && req.method === 'POST') { r.relevance?.cards ? autoGenerate(r) : runRank(r); return json(res, 202, {}), true; } // ranked before: just fill in missing drafts
    if (action === 'send' && req.method === 'POST') { // MOCK of the Region Skåne integration (see ROUTES)
      const route = ROUTES[kind], d = r.docs[kind];
      if (!route || !d?.data) throw fail(404, 'Inget dokument att skicka');
      // One action: the doctor approves the draft and it is handed over; signing happens in the target system (a step in the flow).
      if (!d.dispatch) { d.approved = new Date().toISOString(); r.signedAt ??= d.approved; dispatch(d, route(d.data)); }
      return json(res, 202, {}), true;
    }
    throw fail(405, 'Metoden stöds inte');
  };
}
