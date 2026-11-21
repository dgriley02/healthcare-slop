// Server-side transcription of a recorded consultation with Soniox (async API, stt-async-v6).
// Gives per-word timestamps and confidence, speaker diarization and per-word language identification,
// so a conversation that mixes e.g. Swedish and Hebrew is transcribed correctly. Works with audio from any browser.
// Docs: https://docs.soniox.com/stt/async/async-transcription
const BASE = 'https://api.soniox.com/v1';
const key = () => process.env.SONIOX_API_KEY || '';
export const sonioxConfigured = () => key().length > 10;

async function call(method, path, body, isForm) {
  const res = await fetch(BASE + path, {
    method,
    headers: { authorization: `Bearer ${key()}`, ...(body && !isForm ? { 'content-type': 'application/json' } : {}) },
    body: isForm ? body : body && JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Soniox ${res.status}: ${data.message || data.error_message || res.statusText}`);
  return data;
}

// audio: Buffer, type: MIME type, lang: selected language (e.g. 'he-IL'); Swedish is always hinted too.
export async function transcribe(audio, type, lang) {
  const form = new FormData();
  form.append('file', new Blob([audio], { type }), type.includes('mp4') ? 'audio.mp4' : 'audio.webm');
  const file = await call('POST', '/files', form, true);
  let tr;
  try {
    const hints = [...new Set(['sv', (lang || 'sv').slice(0, 2)])];
    tr = await call('POST', '/transcriptions', {
      model: 'stt-async-v6', file_id: file.id, language_hints: hints,
      enable_speaker_diarization: true, enable_language_identification: true,
      context: {
        text: 'Läkarbesök i svensk primärvård: samtal mellan läkare och patient om symtom, undersökning, diagnos och sjukskrivning.',
        terms: ['sjukskriver', 'sjukskrivning', 'heltid', 'deltid', 'ländryggen', 'ländrygg', 'ischias', 'lumbago', 'Lasègue', 'abduktion', 'rotatorkuff',
          'utmattningssyndrom', 'fysioterapeut', 'remiss', 'Försäkringskassan', 'arbetsförmåga', 'funktionsnedsättning', 'aktivitetsbegränsning'],
      },
    });
    for (let i = 0; ; i++) { // poll until done (a few minutes of audio takes seconds)
      const s = await call('GET', `/transcriptions/${tr.id}`);
      if (s.status === 'completed') break;
      if (s.status === 'error' || s.status === 'failed') throw new Error(`Soniox: ${s.error_message || s.error_type || 'transkriberingen misslyckades'}`);
      if (i > 240) throw new Error('Soniox: tidsgräns');
      await new Promise(r => setTimeout(r, 1000));
    }
    const { tokens } = await call('GET', `/transcriptions/${tr.id}/transcript`);
    return toLines(tokens);
  } finally { // don't keep patient audio at Soniox longer than needed
    if (tr) await call('DELETE', `/transcriptions/${tr.id}`).catch(() => {});
    await call('DELETE', `/files/${file.id}`).catch(() => {});
  }
}

// Tokens -> transcript lines. A token starting with a space begins a new word. A new line starts on a speaker change,
// a pause over 1.5 s, or after a sentence once the line is long.
function toLines(tokens) {
  const lines = [];
  let line = null, prevEnd = 0;
  for (const t of tokens) {
    if (!t.text) continue;
    const speaker = t.speaker ?? '1';
    const longLine = line && line.words.length > 25 && /[.?!]$/.test(line.words.at(-1)?.w || '');
    if (!line || speaker !== line.voice || t.start_ms - prevEnd > 1500 || longLine) {
      line = { voice: speaker, start: t.start_ms / 1000, words: [], langs: new Set() };
      lines.push(line);
    }
    if (t.language) line.langs.add(t.language);
    const newWord = !line.words.length || /^\s/.test(t.text);
    if (newWord) line.words.push({ w: t.text.trim(), c: t.confidence ?? 1 });
    else { const w = line.words.at(-1); w.w += t.text; w.c = Math.min(w.c, t.confidence ?? 1); }
    prevEnd = t.end_ms;
  }
  return lines.filter(l => l.words.some(w => w.w)).map((l, i) => ({
    id: 'U' + (i + 1), speaker: '?', voice: l.voice, lang: [...l.langs].join('+') || undefined,
    text: l.words.map(w => w.w).join(' '), start: l.start, words: l.words.map(w => ({ w: w.w, c: +w.c.toFixed(2) })),
  }));
}
