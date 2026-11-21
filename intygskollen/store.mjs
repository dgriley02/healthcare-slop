// Shared recording store so phone and desktop see the same data.
// Demo persistence: data/db.json + data/audio/<id>. Only synthetic / role-played data belongs here.
// Clients get live updates over Server-Sent Events (/api/events) and refetch /api/recordings.
import { readFile, writeFile, mkdir, unlink, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import vm from 'node:vm';
import { transcribe, sonioxConfigured } from './soniox.mjs';
import { runChecks } from './rules.mjs';

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
async function seedExamples() { // adds any example conversation that is not in the database yet
  const ctx = { window: {} };
  vm.runInNewContext(await readFile(new URL('./public/samples.js', import.meta.url), 'utf8'), ctx);
  const { SAMPLES, SUMMARIES } = ctx.window, names = Object.keys(SAMPLES);
  names.forEach((name, i) => {
    if (db.recordings.some(r => r.example && r.exampleKey === name)) return;
    const lines = SAMPLES[name], duration = lines.length * 22, per = duration / lines.length;
    db.recordings.push({
      id: 'R' + db.nextId++, title: name, exampleKey: name, patient: 'P' + (i + 1), example: true, createdAt: new Date(Date.now() - (names.length - i) * 5 * 36e5).toISOString(), duration,
      bars: Array.from({ length: Math.round(duration / 0.06 / 4) }, (_, k) => +(0.12 + Math.abs(Math.sin(k / 3)) * 0.45 * Math.random() + Math.random() * 0.15).toFixed(2)),
      transcript: lines.map((u, k) => ({ id: 'U' + (k + 1), speaker: u.speaker, text: u.text, start: k * per, words: exampleConfidence(u.text) })),
      summary: SUMMARIES[name], docs: {},
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
  await seedExamples(); save();
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
const NEEDS = { journal: null, fk: null, arb: null, recept: null, lab: null, rtg: null, remiss: null, uppfoljning: null, patientinfo: null };

export function createApi({ analyze, generateDoc, processTranscript, rankCards }) {
  async function runRank(r) {
    if (r.relevance?.loading || !r.transcript.length) return;
    r.relevance = { loading: true }; changed();
    try { r.relevance = await rankCards({ transcript: plain(r.transcript) }); }
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
  async function runProcess(r) {
    try {
      // Soniox diarization gives each line a voice number; it helps Claude tell doctor from patient.
      const p = await processTranscript({ transcript: r.transcript.map(u => ({ id: u.id, speaker: '?', text: u.voice ? `[röst ${u.voice}] ${u.text}` : u.text })), lang: r.lang });
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
    runRank(r);
  }
  async function runGenerate(r, kind) {
    r.docs[kind] = { loading: true }; changed();
    try {
      const args = { transcript: plain(r.transcript), lang: r.lang, journal: kind === 'journal' ? undefined : journalText(r) };
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
      if (sonioxConfigured() && r.audio) { // accurate server-side transcription; browser text was only a live preview
        r.stt = 'soniox'; changed();
        (async () => {
          try {
            const lines = await transcribe(await readFile(new URL(r.id, AUDIO)), r.audioType, r.lang);
            const langs = [...new Set(lines.flatMap(l => (l.lang || '').split('+')).filter(Boolean))];
            if (langs.length) r.lang = langs.join('+');
            if (lines.length) { r.transcript = lines; changed(); return runProcess(r); }
            r.note = 'Inget tal uppfattades.'; r.title = 'Ingen text';
          } catch (e) {
            r.note = `${e.message}. Visar webbläsarens transkribering i stället.`;
            r.stt = 'browser';
            if (segs.length) { r.transcript = browserLines(segs); changed(); return runProcess(r); }
          }
          r.processing = false; changed();
        })();
        return json(res, 202, {}), true;
      }
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
