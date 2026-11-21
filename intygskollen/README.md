# Intygskollen

Records a doctor-patient consultation, transcribes it, and drafts the journal note, Försäkringskassan's FK 7804 sick-pay certificate and the employer certificate. Every sentence links back to the transcript, and the FK certificate is checked against FK's DFA requirements (diagnosis, functional impairment, activity limitation). The doctor reviews and signs. Demo for Primärvården Skåne: synthetic data only.

## Run

    npm install
    cp .env.example .env     # add ANTHROPIC_API_KEY, SONIOX_API_KEY (optional), ACCESS_PASSWORD (optional)
    npm start                # http://localhost:3000
    ./tunnel.sh              # optional: public HTTPS URL (written to tunnel-url.txt), needs cloudflared

`./restart.sh` restarts only the server; a running tunnel keeps its URL.

## Structure

- `server.mjs`: HTTP server and Claude calls (structured outputs; Opus 5.5, low effort, fast mode). It labels speakers, writes the summary, and generates the journal, FK and employer documents.
- `store.mjs`: shared store that keeps phone and desktop in sync.
  - Persistence: `data/db.json` plus `data/audio/`.
  - Live updates over SSE, with polling as a fallback.
  - Audio is deleted 7 days after signing.
- `rules.mjs`: deterministic checks on the FK draft:
  - each sentence's cited transcript lines exist and support it
  - the functional impairment includes measurable findings
  - the activity limitation is tied to the patient's job
  - the sick-leave length is within the recommendation (demo values)
- `pdf.mjs`: fills FK's own FK 7804 form (`templates/fk7804.pdf`).
- `public/`: UI.
  - Recorder using the browser's speech recognition (Chrome/Edge/Safari), 26 languages; documents are always written in Swedish.
  - Playback, where clicking a transcript line plays that moment.
  - Document flow: transcript, then journal, then FK or employer certificate.
  - Vim editing of the journal note.
  - "Send via Webcert" is simulated in the demo.

## Also included

- **Soniox** (`soniox.mjs`): if `SONIOX_API_KEY` is set, the uploaded audio is transcribed with stt-async-v6, which gives:
  - per-word timestamps and confidence
  - speaker diarization
  - several languages in the same conversation
  - support for any browser

  Audio and transcript are deleted at Soniox right after transcription.
- **Forms**: FK 7804 (Försäkringskassan), AG 1-14 (employer, sick-pay period days 8-14) and AG 7804 (employer, from day 15), filled from the drafts.
- **After-work cards** chosen by the doctor: prescription, lab request, X-ray request, referral, follow-up list and patient information. Every item cites the transcript.
- **Example conversations** in `public/samples.js` cover the cards and their combinations. They are added to the database on start.

## Limitations

- Without Soniox, transcription uses the browser (Chrome sends audio to Google). Use role-played conversations only.
- The recommended sick-leave lengths are demo values; replace them with Socialstyrelsen's försäkringsmedicinskt beslutsstöd.
- There is no real Webcert integration.
