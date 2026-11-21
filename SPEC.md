- Intygskollen: product spec

  One line: records the doctor–patient conversation and drafts Försäkringskassan's (FK) sick-pay certificate, FK 7804.
  It flags what would make FK send the certificate back. The doctor reviews and signs.

  Users: GPs in Swedish primary care. First target: Primärvården Skåne.

  Problem: writing certificates costs doctors time, and FK often sends them back for completion, most often because the
  activity limitation is unclear. (Supported by opinion pieces and audits, not a hard figure.)

  Flow

  1. Record the consultation: live waveform, start/stop button, list of recordings (R1, R2…).
  2. Transcribe: lines labelled läk:/pat:, uncertain words highlighted. (Mocked)
  3. Generate a document: Journal (mocked), Intyg → FK (real) / Arb (mocked).
  4. Review: score, warnings, and links back to the conversation.
  5. Edit, sign, and download a PDF in FK 7804's structure.

  Views

  - Recording: desktop/tablet has three columns (menu, waveform + button, list); mobile stacks them.
  - Detail: summary and transcript on the left, a collapsible document panel, tool column on the right.
  - Patients: synthetic patients linked to their recordings.
  - Settings: whether the API key is set up, speech-recognition status, language, data handling, clear all recordings.

  Data / privacy

  - Synthetic data only.
  - Recordings and transcripts live in browser memory only; nothing is saved in the browser.
  - The server never logs transcripts.

  Not done

  - Real Swedish speech recognition, with speaker separation and confidence per word.
  - Journal and Arb generation.
  - Socialstyrelsen's recommended sick-leave lengths (replacing the demo values).
  - Webcert integration.
  - HTTPS for the phone microphone.
  - Test suite with planted errors (detection rate, false flags).
  - Speed: about 23 seconds per certificate.

  Compliance (for the pitch)

  - Human in the loop: the AI drafts, the doctor signs.
  - Likely a medical device under EU MDR, and possibly high-risk under the EU AI Act.
