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
        text: 'Läkarbesök i svensk primärvård: samtal mellan läkare och patient om symtom, undersökning, diagnos och sjukskrivning. Tolk, anhöriga eller sjuksköterska kan delta. Med tolk växlar samtalet mellan svenska och patientens språk.',
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
// a pause over 1.5 s, a language switch at a word boundary (doctor and interpreter are often merged into one voice by
// diarization, but they speak different languages), a sentence end followed by a short pause, or after a sentence once
// the line is long.
function toLines(tokens) {
  const lines = [];
  let line = null, prevEnd = 0;
  for (const t of tokens) {
    if (!t.text) continue;
    t.text = t.text.replace(/\s*[–—]+\s*/g, ', ').replace(/^, /, ','); // house style: no dashes (a lone dash token becomes a comma)
    const speaker = t.speaker ?? '1';
    const lastW = line?.words.at(-1)?.w || '', sentenceEnd = /[.?!]$/.test(lastW), wordStart = /^\s/.test(t.text);
    const longLine = line && line.words.length > 25 && sentenceEnd;
    const langSwitch = line && wordStart && t.language && line.lang && t.language !== line.lang && /\p{L}/u.test(t.text);
    const pausedSentence = line && sentenceEnd && t.start_ms - prevEnd > 600;
    if (!line || speaker !== line.voice || t.start_ms - prevEnd > 1500 || longLine || langSwitch || pausedSentence) {
      line = { voice: speaker, start: t.start_ms / 1000, words: [], langs: new Set(), lang: t.language };
      lines.push(line);
    }
    if (t.language) { line.langs.add(t.language); line.lang ??= t.language; }
    const newWord = !line.words.length || /^\s/.test(t.text);
    if (newWord) line.words.push({ w: t.text.trim(), c: t.confidence ?? 1 });
    else { const w = line.words.at(-1); w.w += t.text; w.c = Math.min(w.c, t.confidence ?? 1); }
    prevEnd = t.end_ms;
  }
  return lines.filter(l => l.words.some(w => w.w)).map((l, i) => ({
    id: 'U' + (i + 1), speaker: '?', voice: l.voice, lang: [...l.langs].join('+') || undefined,
    text: l.words.map(w => w.w).join(' ').replace(/\s+([,.?!])/g, '$1').replace(/,+/g, ',').replace(/\s{2,}/g, ' ').trim(), start: l.start,
    words: l.words.filter(w => /[\p{L}\p{N}]/u.test(w.w) || !/^[,\s]*$/.test(w.w)).map(w => ({ w: w.w.replace(/^,\s*/, '').trim() || w.w, c: +w.c.toFixed(2) })),
  }));
}

/* ---------- real-time (live text while recording) ----------
   The server forwards the PCM stream it already receives from the recording device to Soniox's real-time API (stt-rt-v6)
   and hands the text to every connected device. Docs: https://docs.soniox.com/api-reference/stt/websocket-api
   The API key goes in the Authorization header of the WebSocket upgrade (the api_key config field is deprecated). */
import WebSocket from 'ws';
const RT_URL = 'wss://stt-rt.soniox.com/transcribe-websocket';
export function startRealtime(onText, { sampleRate = 16000 } = {}) {
  const ws = new WebSocket(RT_URL, { headers: { Authorization: `Bearer ${key()}` } });
  const queue = []; let open = false, ended = false;
  const speech = t => t.text !== '<end>'; // <end> marks an endpoint (pause), not speech
  // Final tokens never change and arrive once: pass on only what was added. The non-final tail is rewritten by every response.
  const emit = (added, nonFinal) => onText({
    add: added.filter(speech).map(t => t.text).join('').replace(/\s*[–—]\s*/g, ', '), partial: nonFinal.filter(speech).map(t => t.text).join('').replace(/\s*[–—]\s*/g, ', '),
    langs: [...new Set([...added, ...nonFinal].map(t => t.language).filter(Boolean))],
  });
  ws.on('open', () => {
    ws.send(JSON.stringify({
      model: 'stt-rt-v6', audio_format: 'pcm_s16le', sample_rate: sampleRate, num_channels: 1,
      language_hints: ['sv'], enable_language_identification: true, enable_speaker_diarization: true, enable_endpoint_detection: true,
      context: { text: 'Läkarbesök i svensk primärvård: samtal mellan läkare och patient. Tolk, anhöriga eller sjuksköterska kan delta och samtalet kan växla språk.', terms: ['sjukskriver', 'sjukskrivning', 'ländryggen', 'Lasègue', 'Försäkringskassan', 'arbetsförmåga'] },
      client_reference_id: 'intygskollen-live',
    }));
    open = true; for (const b of queue.splice(0)) ws.send(b); if (ended) ws.send('');
  });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.error_code) return console.warn(`Soniox realtid ${m.error_code} ${m.error_type || ''}: ${m.error_message || ''}`);
    const toks = m.tokens || [];
    if (toks.length) emit(toks.filter(t => t.is_final), toks.filter(t => !t.is_final));
  });
  ws.on('error', e => console.warn('Soniox realtid:', e.message));
  const keepalive = setInterval(() => { if (open && ws.readyState === 1) ws.send(JSON.stringify({ type: 'keepalive' })); }, 5000);
  ws.on('close', () => clearInterval(keepalive));
  return {
    send(pcm) { if (ended) return; if (open && ws.readyState === 1) ws.send(pcm); else queue.push(pcm); },
    end() { if (ended) return; ended = true; if (open && ws.readyState === 1) ws.send(''); setTimeout(() => ws.terminate(), 8000).unref(); }, // empty text frame = end of audio
  };
}
