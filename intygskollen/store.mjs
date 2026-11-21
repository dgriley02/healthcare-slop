// Shared recording store so phone and desktop see the same data.
// Demo persistence: data/db.json + data/audio/<id>. Only synthetic / role-played data belongs here.
// Clients get live updates over Server-Sent Events (/api/events) and refetch /api/recordings.
import { readFile, writeFile, mkdir, unlink, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import vm from 'node:vm';

const DIR = new URL('./data/', import.meta.url);
const AUDIO = new URL('./audio/', DIR);
const DB = new URL('./db.json', DIR);
export const RETENTION_DAYS = 7; // audio is deleted this many days after the first signature
const db = { nextId: 1, recordings: [] };

/* ---------- persistence & events ---------- */
let saveTimer;
const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => writeFile(DB, JSON.stringify(db)).catch(e => console.error('save', e.message)), 200); };
const clients = new Set();
function changed() { save(); for (const res of clients) res.write('data: change\n\n'); }

/* ---------- example recordings (synthetic) ---------- */
const hash = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const exampleConfidence = text => text.split(' ').map((w, i) => {
  const h = hash(w + i) % 100;
  return { w, c: h < 6 ? 0.45 + h / 20 : h < 16 ? 0.7 + (h - 6) / 100 : 0.9 + (h % 10) / 100 };
});
async function seedExamples() {
  const ctx = { window: {} };
  vm.runInNewContext(await readFile(new URL('./public/samples.js', import.meta.url), 'utf8'), ctx);
  const { SAMPLES, SUMMARIES } = ctx.window, names = Object.keys(SAMPLES);
  names.forEach((name, i) => {
    const duration = 240 + i * 95, lines = SAMPLES[name], per = duration / lines.length;
    db.recordings.push({
      id: 'R' + db.nextId++, title: name, patient: 'P' + (i + 1), example: true, createdAt: new Date(Date.now() - (names.length - i) * 5 * 36e5).toISOString(), duration,
      bars: Array.from({ length: Math.round(duration / 0.06 / 4) }, (_, k) => +(0.12 + Math.abs(Math.sin(k / 3)) * 0.45 * Math.random() + Math.random() * 0.15).toFixed(2)),
      transcript: lines.map((u, k) => ({ id: 'U' + (k + 1), speaker: u.speaker, text: u.text, start: k * per, words: exampleConfidence(u.text) })),
      summary: SUMMARIES[name], docs: {},
    });
  });
}

export async function init() {
  await mkdir(AUDIO, { recursive: true });
  try { Object.assign(db, JSON.parse(await readFile(DB, 'utf8'))); } catch { await seedExamples(); save(); }
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
const plain = transcript => transcript.map(({ id, speaker, text }) => ({ id, speaker, text }));
const journalText = r => r.docs.journal?.data?.sections.map(s => `${s.heading}: ${s.claims.map(c => c.text).join(' ')}`).join('\n') || '';
const NEEDS = { journal: null, fk: 'journal', arb: 'journal' };

export function createApi({ analyze, generateDoc, processTranscript }) {
  async function runProcess(r) {
    try {
      const p = await processTranscript({ transcript: plain(r.transcript), lang: r.lang });
      const norm = w => w.toLowerCase().replace(/[^a-zåäö0-9]/g, '');
      for (const seg of p.segments) {
        const u = r.transcript.find(x => x.id === seg.id); if (!u) continue;
        u.speaker = seg.speaker;
        const sus = new Set(seg.suspect_words.map(norm));
        u.words.forEach(x => { if (sus.has(norm(x.w))) x.c = Math.min(x.c, 0.7); });
      }
      r.title = p.title; r.summary = p.summary;
    } catch (e) { r.note = `Kunde inte bearbeta transkriptet: ${e.message}`; }
    r.processing = false; changed();
  }
  async function runGenerate(r, kind) {
    r.docs[kind] = { loading: true }; changed();
    try {
      const args = { transcript: plain(r.transcript), lang: r.lang, journal: kind === 'journal' ? undefined : journalText(r) };
      const data = kind === 'fk' ? await analyze(args) : await generateDoc(kind, args);
      if (kind === 'journal') { delete r.docs.fk; delete r.docs.arb; } // documents built on an old journal are stale
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
    if (url === '/api/recordings' && req.method === 'POST') {
      const { duration = 0, bars = [], patient } = JSON.parse(await body(req) || '{}');
      const r = { id: 'R' + db.nextId++, title: 'Ny inspelning', patient, createdAt: new Date().toISOString(), duration, bars, transcript: [], summary: '', docs: {}, processing: true };
      db.recordings.push(r); changed();
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
      if (!segs.length) {
        r.processing = false; r.title = 'Ingen text';
        r.note = noSpeechRecognition ? 'Taligenkänning stöds inte i webbläsaren som spelade in. Använd Chrome.' : `Inget tal uppfattades${srError ? ` (${srError})` : ''}.`;
        changed();
      } else {
        r.transcript = segs.map((x, i) => ({ id: 'U' + (i + 1), speaker: '?', text: x.text.trim(), start: x.start, words: x.text.trim().split(/\s+/).map(w => ({ w, c: x.conf })) }));
        changed(); runProcess(r);
      }
      return json(res, 202, {}), true;
    }
    if (action === 'generate' && req.method === 'POST') {
      if (!(kind in NEEDS)) throw fail(400, 'Okänd dokumenttyp');
      if (r.processing || !r.transcript.length) throw fail(409, 'Transkriptet är inte klart');
      if (NEEDS[kind] && !r.docs[NEEDS[kind]]?.data) throw fail(409, 'Skapa journalen först');
      if (r.docs[kind]?.loading) return json(res, 202, {}), true;
      runGenerate(r, kind);
      return json(res, 202, {}), true;
    }
    if (action === 'journal' && req.method === 'PUT') { // edited by the doctor (e.g. in the Vim editor)
      const { data } = JSON.parse(await body(req));
      r.docs.journal = { data, edited: new Date().toISOString() }; delete r.docs.fk; delete r.docs.arb; changed();
      return json(res, 200, {}), true;
    }
    if (action === 'sign' && req.method === 'POST') {
      const d = r.docs[kind]; if (!d?.data) throw fail(409, 'Inget dokument att signera');
      d.signed ??= new Date().toISOString(); r.signedAt ??= d.signed; changed();
      return json(res, 200, {}), true;
    }
    if (action === 'webcert' && req.method === 'POST') { // DEMO: simulated hand-off, no real Webcert integration
      const d = r.docs.fk; if (!d?.signed) throw fail(409, 'Signera intyget först');
      if (!d.sent && !d.sending) { d.sending = true; changed(); setTimeout(() => { d.sending = false; d.sent = new Date().toISOString(); changed(); }, 1500); }
      return json(res, 202, {}), true;
    }
    throw fail(405, 'Metoden stöds inte');
  };
}
