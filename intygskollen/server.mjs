// Intygskollen: drafts an FK 7804 sick-pay certificate from a consultation transcript
// and checks it against Försäkringskassan's DFA-chain requirements.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { runChecks } from './rules.mjs';
import { buildFk7804, buildAg114, buildAg7804 } from './pdf.mjs';
import { init, createApi, attachWs } from './store.mjs';
import { sonioxConfigured } from './soniox.mjs';

try { process.loadEnvFile(); } catch {} // optional .env with ANTHROPIC_API_KEY
const KEY_OK = /^sk-ant-[A-Za-z0-9_-]{20,}/.test(process.env.ANTHROPIC_API_KEY || '');
const client = KEY_OK ? new Anthropic({ maxRetries: 4 }) : null; // extra retries: venue wifi drops connections
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || '';
const MODEL = process.env.MODEL || 'claude-opus-5-5';
const EFFORT = process.env.EFFORT || 'low';
const SPEED = process.env.SPEED ?? 'fast'; // Opus 5.5 fast mode: ~5 s instead of ~15 s, 2x token price
if (!KEY_OK) console.warn('ANTHROPIC_API_KEY saknas. Lägg in den i .env och starta om.');
const PORT = process.env.PORT || 3000;

const Claim = z.object({
  text: z.string().describe('One sentence in Swedish clinical certificate language'),
  evidence: z.array(z.string()).describe('IDs of the transcript lines (e.g. "U4") that support this sentence'),
});
const Check = z.object({
  status: z.enum(['ok', 'warn', 'missing']),
  reason: z.string().describe('Short Swedish explanation for the doctor'),
});
const Certificate = z.object({
  diagnosis: z.object({ icd10: z.string(), text: z.string(), evidence: z.array(z.string()) }),
  occupation: z.object({ text: z.string(), evidence: z.array(z.string()) }),
  function_impairment: z.array(Claim),
  activity_limitation: z.array(Claim),
  treatment: z.array(Claim),
  sick_leave: z.object({ degree: z.enum(['25', '50', '75', '100']), days: z.number().int(), evidence: z.array(z.string()) }),
  prognosis: z.object({
    option: z.enum(['full_after_end', 'full_after_months', 'not_full', 'uncertain']),
    months: z.number().int().describe('Only for full_after_months, else 0'),
    reason: z.string().describe('Basis for the assessment if uncertain, else empty string'),
  }).describe('FK 7804 question 9: prognosis for return to current occupation'),
  work_measures: z.string().describe('FK 7804 question 10: non-healthcare measures that could help return to work, only if discussed, else empty string'),
  motivation_longer_leave: z.string().describe('Justification if sick leave is longer than usual, else empty string'),
  dfa: z.object({ diagnosis: Check, function_impairment: Check, activity_limitation: Check, chain: Check }),
  questions_to_ask: z.array(z.string()).describe('Questions the doctor should ask before the patient leaves, to close gaps FK would request completion for'),
  patient_summary: z.string().describe('2-4 sentences in plain Swedish for the patient: what happens next with FK'),
});

const SYSTEM = `Du är ett dokumentationsstöd för läkare i svensk primärvård. Du skriver ett UTKAST till Försäkringskassans "Läkarintyg för sjukpenning" (FK 7804) utifrån ett transkriberat patientbesök. Läkaren granskar, redigerar och signerar. Du beslutar ingenting.

Regler:
- Använd ENDAST information som finns i transkriptet. Hitta aldrig på fynd, mätvärden, diagnoser eller arbetsuppgifter. Saknas något: lämna fältet tomt och flagga det.
- Varje mening ska ha evidence = ID:n för de rader i transkriptet som stöder den.
- Följ DFA-kedjan: Diagnos -> Funktionsnedsättning (observerade fynd, helst grader/mått/testresultat, inte bara patientens upplevelse) -> Aktivitetsbegränsning (konkret vad patienten inte kan göra, kopplat till patientens faktiska arbetsuppgifter). Varje led ska rimligen följa av föregående.
- Bedöm varje led i "dfa" strikt, så som en handläggare på Försäkringskassan skulle göra. Vanligaste orsaken till kompletteringsbegäran är otydlig aktivitetsbegränsning, därefter otydlig funktionsnedsättning.
- questions_to_ask: konkreta frågor/undersökningar läkaren kan göra innan patienten går, för att täppa till luckorna.`;

// One structured-output call to Claude, with automatic fallback from fast mode to standard speed.
async function llm(schema, system, user, opts = {}) {
  if (!client) throw Object.assign(new Error('API-nyckel saknas. Lägg in ANTHROPIC_API_KEY i .env och starta om servern.'), { status: 503 });
  const call = speed => client.messages.parse({
    model: opts.model || MODEL,
    ...(speed === 'fast' ? { speed: 'fast' } : {}),
    max_tokens: 16000,
    output_config: { effort: opts.effort || EFFORT, format: zodOutputFormat(schema) },
    system,
    messages: [{ role: 'user', content: user }],
  });
  const speed = opts.speed ?? SPEED;
  let msg;
  try { msg = await call(speed); }
  catch (e) {
    if (speed !== 'fast' || !(e instanceof Anthropic.APIError) || ![400, 429, 529].includes(e.status)) throw e;
    console.warn(`Fast mode unavailable (${e.status}), retrying at standard speed`);
    msg = await call('');
  }
  if (msg.stop_reason === 'refusal') throw Object.assign(new Error('Modellen avböjde förfrågan'), { status: 422 });
  if (msg.stop_reason === 'max_tokens') throw Object.assign(new Error('Svaret blev för långt'), { status: 502 });
  return { out: noDashes(msg.parsed_output), usage: msg.usage };
}
// House style: no en/em dashes in generated text.
const noDashes = v => typeof v === 'string' ? v.replace(/\s+[–—]\s+/g, ', ').replace(/[–—]/g, '-')
  : Array.isArray(v) ? v.map(noDashes) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, noDashes(x)])) : v;
const fmt = transcript => transcript.map(u => `${u.header ? `\n${u.header}\n` : ''}${u.id} [${u.speaker}${u.speakerDetail ? `, ${u.speakerDetail}` : ''}]: ${u.text}`).join('\n');
// Documents later in the flow (FK, employer) also get the doctor's journal note as context; evidence must still cite transcript lines.
const withJournal = j => (j ? `\n\nJournalanteckning (granskad av läkaren, som sammanhang; evidence ska fortfarande vara transkriptets rad-ID:n):\n${j}` : '');
// Earlier meetings with the same patient (newest first, within a size budget) are context, e.g. for an extended sick leave:
// their lines have ids like "R72:U9" and may be cited as evidence. Today's date lets the model count the sick period.
const withPrior = prior => (prior.length ? `\n\nTidigare besök för samma patient (underlag; rad-ID:n som "R72:U9" får användas som evidence):\n${fmt(prior)}` : '');
const withDate = today => (today ? `Dagens datum (detta besök): ${today}.\n` : '');
const GROUNDING = 'Om tidigare besök finns med: använd dem som underlag (t.ex. diagnos, yrke, sjukperiodens början och tidigare fynd) men låt dagens besök gälla för nuvarande status. Vid förlängning av sjukskrivning: räkna sjukperioden från första sjukdagen. Varje rad anger vem som talar (läkare, patient, sjuksköterska, anhörig, tolk m.fl.). Repliker från Övrig (personer utan del i vården) är inte medicinsk information. Det en anhörig eller annan person säger om patienten ska återges som deras uppgift, inte som patientens egen. Använd ENDAST information som finns i transkriptet. Hitta aldrig på fynd, mätvärden, diagnoser eller uppgifter. Varje mening ska ha evidence = ID:n för de rader som stöder den. Använd inte tankstreck (– eller —). Samtalet kan vara på ett annat språk än svenska; skriv ändå alltid dokumentet på svenska.';

export async function analyze({ transcript, journal, lang, prior = [], today }, opts = {}) {
  const { out: cert, usage } = await llm(Certificate, SYSTEM, `${withDate(today)}Transkript:\n${fmt(transcript)}${withJournal(journal)}${withPrior(prior)}\n\nSkriv utkastet.`, opts);
  return { cert, checks: runChecks(cert, [...transcript, ...prior], lang), usage };
}

// After recording: label speakers, flag likely misrecognised words, summarise. Never rewrites the transcript.
const Processed = z.object({
  segments: z.array(z.object({
    id: z.string(),
    speaker: z.enum(['Läkare', 'Patient', 'Sjuksköterska', 'Anhörig', 'Tolk', 'Annan vårdpersonal', 'Övrig', 'Okänd']),
    speaker_detail: z.string().describe('e.g. "dotter", "make", "fysioterapeut"; empty if unknown'),
    suspect_words: z.array(z.string()).describe('Words in this segment that look like speech-recognition errors (exact words as written)'),
  })),
  title: z.string().describe('Short Swedish title, e.g. "Ländryggssmärta, lagerarbetare"'),
  summary: z.string().describe('2-3 sentence clinical summary in Swedish'),
});
async function processTranscript({ transcript, lang }) {
  const { out } = await llm(Processed,
    'Du får ett automatiskt transkriberat vårdsamtal i svensk primärvård, uppdelat i segment. Segment kan ha ett röstnummer [röst N] från talarsepareringen. Det är ett starkt tips men inte säkert: talarsepareringen kan slå ihop två personer med liknande röster eller korta inpass. Ge normalt samma roll åt samma röst, men om innehållet tydligt visar att det är en annan person (t.ex. någon som kommer in i rummet, en annan relation till patienten, ett annat språk och sätt att tala) går innehållet före röstnumret. Tolk: en replik som återger det föregående replik sa, på ett annat språk (eller som återger patientens svar på svenska till läkaren), är Tolk, även om den har samma röstnummer som läkaren. Läkaren ställer egna frågor och gör bedömningar; tolken lägger inte till eget innehåll. Bara om det tydligt är läkaren själv som översätter (t.ex. "jag översätter") är det Läkare. Avgör för varje segment vem som talar utifrån innehållet: Läkare (ställer diagnos, undersöker, bedömer, förskriver), Patient (beskriver egna besvär i jagform), Sjuksköterska (mäter värden, praktiska moment, provtagning), Anhörig (familjemedlem eller närstående; talar om patienten i tredje person, t.ex. "min mamma"), Tolk (återger det som sägs på ett annat språk), Annan vårdpersonal (t.ex. fysioterapeut, undersköterska, kurator), Övrig (person utan del i vården, t.ex. vaktmästare eller annan som kommer in i rummet), Okänd. Ange speaker_detail när det framgår (t.ex. "dotter", "make", "fysioterapeut", annars tom sträng). Markera ord som troligen är feltolkade av taligenkänningen (t.ex. medicinska termer som blivit fel). Skriv en kort sammanfattning där det framgår vem som sa vad när det spelar roll.' + GROUNDING,
    `Språk (taligenkänning): ${lang || 'sv-SE'}. Titel och sammanfattning på svenska; suspect_words exakt som de står i segmenten.\nSegment:\n${transcript.map(u => `${u.id}: ${u.text}`).join('\n')}`, { effort: 'low' });
  return out;
}

const Journal = z.object({
  sections: z.array(z.object({ heading: z.string(), claims: z.array(Claim) }))
    .describe('Swedish journal note with the headings Kontaktorsak, Anamnes, Status, Bedömning, Åtgärd (skip a heading only if nothing was said about it)'),
});
const Arb = z.object({
  occupation: z.string().describe('Occupation and work tasks as stated in the conversation, else empty string'),
  work_capacity_reduced: z.boolean(),
  degree: z.enum(['25', '50', '75', '100', '0']),
  days: z.number().int(),
  description: z.array(Claim).describe('How work capacity is reduced in relation to the job - WITHOUT diagnosis or medical details (employer must not get the diagnosis)'),
  adjustments: z.array(Claim).describe('Possible adjustments at work that could enable partial work, only if discussed'),
});
// Clinical after-work drafts (doctor picks which ones). Every item cites transcript lines (evidence).
const Ev = z.array(z.string()).describe('IDs of transcript lines that support this item');
const Recept = z.object({
  prescriptions: z.array(z.object({ drug: z.string(), strength: z.string(), form: z.string().describe('e.g. tablett'), dosage: z.string(), amount: z.string().describe('pack size / quantity'),
    duration: z.string(), indication: z.string(), evidence: Ev })).describe('Only drugs the doctor said they will prescribe'),
  warnings: z.array(z.string()).describe('Missing or unclear info the doctor must fill in (e.g. dose not stated), mentioned allergies/interactions'),
});
const Lab = z.object({
  tests: z.array(z.object({ name: z.string().describe('e.g. Blodstatus, CRP, HbA1c'), reason: z.string(), evidence: Ev })),
  question: z.string().describe('Frågeställning'), urgency: z.enum(['rutin', 'brådskande', 'akut']), fasting: z.boolean(),
});
const Rtg = z.object({
  exam: z.string().describe('e.g. Slätröntgen höger axel, MR ländrygg'), question: z.string(), anamnesis: z.string(), status: z.string(),
  urgency: z.enum(['rutin', 'brådskande', 'akut']), contraindications: z.string().describe('Relevant for MR/contrast (pacemaker, pregnancy, kidney function), or "Inga kända"'), evidence: Ev,
});
const Remiss = z.object({
  to: z.string().describe('Receiving unit, e.g. Fysioterapeut, Ortopedmottagning'), question: z.string(), anamnesis: z.string(), status: z.string(),
  current_treatment: z.string(), urgency: z.enum(['rutin', 'brådskande', 'akut']), evidence: Ev,
});
const Followup = z.object({
  actions: z.array(z.object({ what: z.string(), when: z.string().describe('e.g. om 2 veckor, 2026-12-04'), who: z.enum(['läkare', 'sjuksköterska', 'fysioterapeut', 'vårdadministratör', 'patienten']), evidence: Ev })),
});
const PatientInfo = z.object({
  summary: z.string().describe('What happened at the visit, plain Swedish for the patient, 2-4 sentences'),
  self_care: z.array(z.string()), warning_signs: z.array(z.string()).describe('When to seek care again / call 1177 / 112'), next_steps: z.array(z.string()),
});
const AFTER = 'Skriv ett utkast som läkaren granskar. Ta bara med det som faktiskt sades eller beslutades i samtalet; föreslå inget nytt. Saknas något som behövs, lämna fältet tomt och nämn det.';
const DOCS = {
  recept: { schema: Recept, system: `Du skriver receptutkast för läkare i svensk primärvård utifrån ett transkriberat besök. ${AFTER} ${GROUNDING}` },
  lab: { schema: Lab, system: `Du skriver labbremiss för läkare i svensk primärvård utifrån ett transkriberat besök. ${AFTER} ${GROUNDING}` },
  rtg: { schema: Rtg, system: `Du skriver röntgenremiss (bild- och funktionsmedicin) för läkare i svensk primärvård utifrån ett transkriberat besök. ${AFTER} ${GROUNDING}` },
  remiss: { schema: Remiss, system: `Du skriver remiss till specialistvård eller rehabilitering för läkare i svensk primärvård utifrån ett transkriberat besök. ${AFTER} ${GROUNDING}` },
  uppfoljning: { schema: Followup, system: `Du skriver en åtgärdslista för uppföljning och bokning till vårdadministratören utifrån ett transkriberat besök. ${AFTER} ${GROUNDING}` },
  patientinfo: { schema: PatientInfo, system: `Du skriver ett meddelande till patienten via 1177 på enkel, vänlig svenska utifrån ett transkriberat besök. ${AFTER} ${GROUNDING}` },
  journal: { schema: Journal, system: 'Du skriver ett utkast till journalanteckning för läkare i svensk primärvård utifrån ett transkriberat besök. Kort, sakligt journalspråk. ' + GROUNDING },
  arb: { schema: Arb, system: 'Du skriver ett utkast till läkarintyg om arbetsförmåga till arbetsgivare (sjuklöneperioden). Arbetsgivaren får INTE veta diagnos eller medicinska detaljer. Beskriv bara hur arbetsförmågan påverkas i relation till arbetet. ' + GROUNDING },
};
// Which after-work cards matter for this conversation (shown first; the rest go under "Visa fler").
const CARD_KINDS = ['recept', 'lab', 'rtg', 'remiss', 'uppfoljning', 'patientinfo', 'arb', 'fk'];
const Relevance = z.object({
  cards: z.array(z.object({
    kind: z.enum(CARD_KINDS),
    relevant: z.boolean().describe('true only if the conversation clearly calls for this document'),
    score: z.number().int().describe('0-100, how strongly the conversation calls for it'),
    reason: z.string().describe('Very short Swedish reason citing what was said, max 8 words, e.g. "Läkaren förskrev Kåvepenin"'),
  })).describe('Exactly one entry per kind'),
});
export async function rankCards({ transcript, prior = [], today }) {
  const { out } = await llm(Relevance,
    `Du avgör vilka dokument en läkare i svensk primärvård behöver skapa efter ett besök. Typer: recept (läkemedel förskrevs), lab (prover beställdes), rtg (röntgen/MR/DT/ultraljud beställdes), remiss (remiss till annan vårdgivare, specialist, fysioterapeut, psykolog), uppfoljning (återbesök, telefonkontakt, bokningar), patientinfo (råd eller varningstecken gavs till patienten), arb (läkarintyg till arbetsgivaren för sjukskrivning dag 8-14), fk (sjukskrivning längre än 14 dagar: FK 7804 och AG 7804). Räkna sjukperioden från första sjukdagen som nämns i samtalet, inte från besöket. Sjukperiod upp till 7 dagar kräver inget intyg. Om perioden når dag 8-14 behövs arb. Om den passerar dag 14 behövs fk, och även arb om dag 8-14 ingår. Bedöm bara utifrån samtalet. ${GROUNDING}`,
    `${withDate(today)}Transkript:\n${fmt(transcript)}${withPrior(prior)}`, { effort: 'low' });
  return out;
}

export async function generateDoc(kind, { transcript, journal, prior = [], today }) {
  const d = DOCS[kind];
  const { out } = await llm(d.schema, d.system, `${withDate(today)}Transkript:\n${fmt(transcript)}${withJournal(journal)}${withPrior(prior)}`);
  return out;
}

const api = createApi({ analyze, generateDoc, processTranscript, rankCards });
const TYPES = { '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
if (!process.env.NO_SERVER) await init();
const httpServer = process.env.NO_SERVER ? null : http.createServer(async (req, res) => {
  // Optional password (HTTP Basic auth, any username) so a public URL can't spend the API key.
  if (ACCESS_PASSWORD) {
    const [, b64] = (req.headers.authorization || '').split(' ');
    const pass = b64 ? Buffer.from(b64, 'base64').toString().split(':').slice(1).join(':') : '';
    if (pass !== ACCESS_PASSWORD) {
      res.writeHead(401, { 'www-authenticate': 'Basic realm="Intygskollen", charset="UTF-8"' });
      return res.end('Lösenord krävs');
    }
  }
  try {
    if (req.url === '/api/status') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ keyConfigured: KEY_OK, soniox: sonioxConfigured() }));
    }
    if (await api(req, res)) return;
    const pdfForm = { '/api/pdf': buildFk7804, '/api/pdf/fk7804': buildFk7804, '/api/pdf/ag114': buildAg114, '/api/pdf/ag7804': buildAg7804 }[req.url];
    if (req.method === 'POST' && pdfForm) {
      let body = '';
      for await (const c of req) body += c;
      const pdf = await pdfForm(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="intyg-utkast.pdf"' });
      return res.end(Buffer.from(pdf));
    }
    const route = { '/api/process': processTranscript, '/api/journal': b => generateDoc('journal', b), '/api/arb': b => generateDoc('arb', b) }[req.url];
    if (req.method === 'POST' && route) {
      let body = '';
      for await (const c of req) body += c;
      const result = await route(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(result));
    }
    if (req.method === 'POST' && req.url === '/api/analyze') {
      let body = '';
      for await (const c of req) body += c;
      const result = await analyze(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(result));
    }
    const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    if (path.includes('..')) throw Object.assign(new Error('bad path'), { status: 400 });
    const data = await readFile(join(import.meta.dirname, 'public', path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  } catch (e) {
    const status = e.code === 'ENOENT' ? 404 : e instanceof Anthropic.APIError ? (e.status || 502) : e.status || 500;
    console.error(e.message);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
});
if (httpServer) { attachWs(httpServer); httpServer.listen(PORT, () => console.log(`Intygskollen on http://localhost:${PORT}`)); }
