// Deterministic checks that run on top of the LLM draft. These never trust the model:
// they verify evidence links, measurability and job linkage with plain code.

// DEMO VALUES: replace with Socialstyrelsen's försäkringsmedicinska beslutsstöd (open REST API, CC0).
export const RECOMMENDED_DAYS = {
  'M54.5': { label: 'Lumbago', days: 28 },
  'M54.4': { label: 'Lumbago med ischias', days: 28 },
  'F43.8A': { label: 'Utmattningssyndrom', days: 90 },
  'S83.2': { label: 'Meniskskada', days: 42 },
  'J06.9': { label: 'Övre luftvägsinfektion', days: 7 },
  'M75.1': { label: 'Rotatorkuffsyndrom', days: 42 },
};

const STOP = new Set('och att det som en på är för med inte har kan av till den han hon jag du vi ni om så men ska vid ett eller sig från'.split(' '));
const words = s => s.toLowerCase().replace(/[^a-zåäö0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !STOP.has(w));
const MEASURABLE = /\d|grader|°|positiv|negativ|nedsatt|kraft|rörlighet|lasegue|test|status|palp|ömhet|flexion|extension|MADRS|PHQ|KEDS|minne|koncentration/i;

// lang: BCP-47 code of the conversation. The word-overlap check only works when the transcript is Swedish like the certificate.
export function runChecks(cert, transcript, lang = 'sv-SE') {
  const swedish = !lang || lang.startsWith('sv');
  const byId = Object.fromEntries(transcript.map(u => [u.id, u.text]));
  const flags = [];

  // 1. Every claim must cite existing lines that share vocabulary with it (anti-hallucination).
  const claims = ['function_impairment', 'activity_limitation', 'treatment']
    .flatMap(sec => cert[sec].map((c, i) => ({ sec, i, ...c })));
  const support = {};
  for (const c of claims) {
    const cited = c.evidence.filter(id => byId[id]);
    // compare 5-letter stems so inflections match (strumpor/strumporna, böja/böjning)
    const stem = x => x.slice(0, 5);
    const srcWords = words(cited.map(id => byId[id]).join(' ')).map(stem);
    const w = words(c.text).map(stem);
    const overlap = w.length ? w.filter(x => srcWords.some(s => s.startsWith(x) || x.startsWith(s) || s.includes(x))).length / w.length : 0;
    const level = !cited.length ? 'none' : swedish && overlap < 0.2 ? 'weak' : 'ok';
    support[`${c.sec}.${c.i}`] = { level, overlap: Math.round(overlap * 100) };
    if (level !== 'ok') flags.push({ severity: level === 'none' ? 'fail' : 'warn', field: c.sec, text: `"${c.text}": ${level === 'none' ? 'saknar källa i samtalet' : 'svagt stöd i citerade rader'}` });
  }

  // 2. Functional impairment should contain observed, measurable findings.
  const fi = cert.function_impairment.map(c => c.text).join(' ');
  if (!fi.trim()) flags.push({ severity: 'fail', field: 'function_impairment', text: 'Funktionsnedsättning saknas.' });
  else if (!MEASURABLE.test(fi)) flags.push({ severity: 'warn', field: 'function_impairment', text: 'Inga observerade fynd eller mått. FK efterfrågar ofta grader, mått eller testresultat.' });

  // 3. Activity limitation must be concrete and linked to the actual job.
  const al = cert.activity_limitation.map(c => c.text).join(' ');
  const job = words(cert.occupation.text);
  if (!cert.occupation.text.trim()) flags.push({ severity: 'fail', field: 'occupation', text: 'Sysselsättning/arbetsuppgifter saknas, går inte att bedöma arbetsförmåga.' });
  if (!al.trim()) flags.push({ severity: 'fail', field: 'activity_limitation', text: 'Aktivitetsbegränsning saknas (vanligaste orsaken till komplettering).' });
  else if (job.length && !job.some(w => al.toLowerCase().includes(w.slice(0, 5))))
    flags.push({ severity: 'warn', field: 'activity_limitation', text: 'Aktivitetsbegränsningen nämner inte patientens arbetsuppgifter.' });

  // 4. Sick-leave length vs recommendation.
  const rec = RECOMMENDED_DAYS[cert.diagnosis.icd10.trim().toUpperCase()];
  let duration = null;
  if (rec) {
    duration = { recommended: rec.days, requested: cert.sick_leave.days, label: rec.label };
    if (cert.sick_leave.days > rec.days && !cert.motivation_longer_leave.trim())
      flags.push({ severity: 'warn', field: 'sick_leave', text: `${cert.sick_leave.days} dagar överstiger rekommenderade ${rec.days} för ${rec.label}. Motivering krävs.` });
  }

  const fails = flags.filter(f => f.severity === 'fail').length, warns = flags.length - fails;
  const dfaPenalty = Object.values(cert.dfa).reduce((s, c) => s + (c.status === 'missing' ? 20 : c.status === 'warn' ? 8 : 0), 0);
  const score = Math.max(0, 100 - fails * 20 - warns * 7 - dfaPenalty);
  return { flags, support, duration, score };
}
