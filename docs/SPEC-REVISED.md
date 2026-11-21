# Intygskollen — Revised Product & Design Spec

> **One-liner:** Records the doctor–patient consultation, generates a visit summary and the right Swedish sick-leave certificate (**AG 1-14** for days 1–14 to the employer, or **FK 7804** for day 15+ to Försäkringskassan), links every claim back to the exact spoken moment (*"Show the receipts"*), and flags missing requirements or privacy issues before issuance.

---

## 1. Users, Problem & Positioning

- **Primary users:** General Practitioners (GPs) in Swedish primary care. Initial target: **Primärvården Skåne**.
- **Core problem:**
  1. Consultation documentation and sick-leave certificates consume heavy physician time during tight 15-minute visits.
  2. Swedish sick leave splits cleanly into two legally distinct certificates that doctors must route correctly:
     - **AG 1-14 (*Läkarintyg om arbetsförmåga – sjuklöneperioden*):** Required for **days 1–14** (typically from day 8) for employed patients, addressed to the **employer**. Crucially, the patient has **no obligation to share their diagnosis** with their employer — disclosing it requires explicit patient consent.
     - **FK 7804 (*Läkarintyg för sjukpenning*):** Required from **day 15 onward** (or when sick leave is expected to exceed 14 days, or for unemployed patients), addressed to **Försäkringskassan (FK)**. FK frequently returns FK 7804 for completion (*komplettering*) — most commonly due to an incomplete **DFA chain** (unclear link between Diagnosis, Functional impairment, and concrete Activity limitation in relation to work tasks, or missing objective clinical findings).
  3. Catching missing details or wrong certificate selection weeks later forces the doctor to reopen a forgotten case and re-contact the patient.
- **Product scope:** Intygskollen is a **clinical visit & documentation workspace** covering **consultation recording + visit summary** and **sick-leave certificate drafting + quality assurance (both `AG 1-14` and `FK 7804`)**, with future extensibility to *Journal* and *AG 7804*.
- **Adoption path:**
  - For **AG 1-14**, Webcert does *not* transmit electronically to employers — the certificate is actually **printed or downloaded as a PDF** and handed to the employer by the patient. Intygskollen's structured PDF output matches real clinical workflow immediately.
  - For **FK 7804**, Region Skåne doctors submit digitally via **Webcert**. For the hackathon, Intygskollen provides **per-field copy to Webcert** plus a structured **FK 7804 PDF** preview/copy, with native Webcert/EHR integration planned together with Primärvården Skåne's digitalization leadership.

---

## 2. Core UX Principles & Design Metaphors

1. **Clinical context over technical files (No `R1, R2` dictaphone UI):**
   - Start inside a **Patient Profile → Visit (Consultation)** rather than a generic list of raw audio recordings.
   - Split form factors by real workflow: **Mobile** focuses on discreet consultation recording; **Desktop** focuses on debrief, review, editing, and signing.
2. **Visit as a container (1..N recordings):**
   - A single visit can contain multiple audio clips: e.g., **(1) Patient consultation** + **(2) Short doctor voice addendum/dictation** after the patient leaves (a natural way for doctors to dictate objective clinical status or close red FK gaps in 10 seconds).
   - All clips merge into one unified visit timeline transcript.
3. **"Auto-draft, verify by exception" (No click-heavy wizard):**
   - Doctors will not manually proofread a full transcript before generating documents.
   - Stopping a recording triggers parallel generation automatically so the doctor lands directly in the **Debrief view**, reviewing only highlighted gaps and warnings.
4. **Transcript as Single Source of Truth (No "telephone game"):**
   - The **Visit Summary**, **AG 1-14 / FK 7804**, and (future) **Journal** are all generated **directly from the transcript** in parallel — never `Transcript → Summary → Certificate`, which drops detail and breaks receipt traceability.
5. **2-Column Split-Screen Debrief ("Evidence Bench / Grammarly for Certificates"):**
   - Replace the cramped 3-column layout with collapsible document panel.
   - **Left column (Source & Overview):** Toggle/sections for **Visit Summary** and **Timestamped Transcript** (`läk:` / `pat:` / `diktat:`, uncertain ASR words highlighted, inline audio clip playback).
   - **Right column (Active Document):** Auto-routed sick-leave certificate workspace switching cleanly between **`AG 1-14` (Dag 1–14 · Arbetsgivare)** and **`FK 7804` (Dag 15+ · Försäkringskassan)** (plus a disabled *"Coming soon"* tab for *Journal*), featuring inline field warnings, pre-flight checklist at top, and clickable receipt badges on every sentence.
6. **Pre-flight Checklist instead of an arbitrary 0–100 score:**
   - An uncalibrated AI score (e.g., *"74/100"*) creates false precision and clinician distrust.
   - Use a transparent **Pre-flight Checklist** tailored to the active certificate type:
     - **For `FK 7804`:** DFA chain completeness (objective clinical finding vs. subjective symptoms, concrete work-task activity limitation, FMB duration check, etc.), e.g., **`4/6 FK checks passed — Medium completion risk`**.
     - **For `AG 1-14`:** 14-day period bounds check, work-capacity impact & workplace adjustment clarity, and **explicit patient consent check for sharing diagnosis with the employer** (privacy-safe default: omit diagnosis unless consent is confirmed).
   - **Anti-hallucination rule:** If evidence for a required field is absent, the AI must **never invent clinical prose**. It renders an explicit **`[Saknas i samtalet]`** gap to prevent automation bias.
7. **"Show the receipts" + Inherited ASR Uncertainty:**
   - Every generated sentence in the certificate (`AG 1-14` or `FK 7804`) links to one or more transcript utterance IDs (e.g., `[U14 · 03:42]`). Clicking jumps to and highlights the utterance in the left pane and lets the doctor play that exact audio clip.
   - **Inherited ASR warning:** If a cited utterance contains a low-confidence ASR word, the certificate sentence automatically inherits a yellow audio warning (*"⚠️ Based on uncertain transcript word — click to listen"*).
   - **Edit provenance:** Once a doctor manually edits a sentence, its badge updates to **`Verifierad/redigerad av läkare`** so stale AI citations are never misleading.

---

## 3. User Flow & Views (12h Hackathon Scope)

### Desktop Web App (Primary Demo)
1. **Patient Profile & Visit Start:**
   - Synthetic patient header (e.g., *Anna Lindberg, 1984-05-12*) with list of visits showing clinical status pills (e.g., `2 FK-brister`, `Klar att signera`) and a **"Starta nytt besök"** CTA.
2. **Recording State (Lightweight):**
   - Clean active recording indicator (waveform, timer, stop button) — also usable as a quick **"Lägg till röstkomplettering"** modal/bar inside an existing visit.
3. **Debrief & Review View (2-Column Split-Screen — Main Workspace):**
   - **Left pane:**
     - **Sammanfattning** (concise structured visit summary for quick recall).
     - **Transkript** (diarized `läk:` / `pat:` / `diktat:` utterances with IDs, timestamps, highlighted uncertain ASR words, and click-to-play audio segments).
   - **Right pane:**
     - **Certificate Selector & Routing Banner:** Automatically selects **`AG 1-14` (Dag 1–14 · Arbetsgivare)** or **`FK 7804` (Dag 15+ · Försäkringskassan)** based on sick-leave duration & employment context, with one-click manual override and a mismatch warning if the doctor picks the wrong form for the stated period.
     - **Pre-flight Checklist** (`X/N` checks + Low/Medium/High risk, tailored to `AG 1-14` or `FK 7804`).
     - **Mode A — `FK 7804` Form (Day 15+ · Försäkringskassan):**
       - **Fält 3:** Baserat på (undersökning / samtal)
       - **Fält 4:** Diagnos (och eventuell angiven ICD-10)
       - **Fält 5:** Funktionsnedsättning *(distinguishes objective clinical findings vs. patient-reported symptoms)*
       - **Fält 6:** Aktivitetsbegränsning *(concrete impact on specific work tasks)*
       - **Fält 7:** Pågående / planerad medicinsk behandling & rehabilitering
       - **Fält 8:** Bedömning av arbetsförmåga (sysselsättning, sjukskrivningsgrad 25/50/75/100 %, period)
       - **Fält 9/10:** Prognos & övriga upplysningar (incl. FMB motivation prompt if duration exceeds reference)
     - **Mode B — `AG 1-14` Form (Days 1–14 · Arbetsgivare):**
       - **Diagnos-samtycke (Privacy Gate):** Explicit toggle *"Önskar patienten förmedla diagnos till arbetsgivaren? (Ja / Nej)"* — defaults to **Nej (dold på intyg)** if not confirmed in the transcript, with a pre-flight reminder to confirm with the patient.
       - **Sysselsättning / arbetsuppgifter:** Role and work tasks relevant to the employer.
       - **Nedsatt arbetsförmåga & påverkan på arbete:** How work capacity is reduced and what workplace adjustments could help (especially important when diagnosis is omitted).
       - **Bedömning & sjukskrivningsgrad:** 25/50/75/100 % and period strictly within days 1–14.
     - **Actions:** Per-field **Kopiera för Webcert**, inline edit, **Lägg till röstkomplettering**, **Signera**, and **Ladda ner PDF** (formatted as official `AG 1-14` with diagnosis redacted if consent = No, or `FK 7804` structure).

### Mobile Companion (Concept / Lightweight View)
- Minimal focused recorder view (patient context, large Start/Stop, live waveform, upload to visit).

---

## 4. Technical Architecture (Hybrid AI + Deterministic Verification)

Designed to maximize **40% Technology Execution** without heavy infrastructure complexity, targeting **< 5–6 seconds** end-to-end latency.

### 4.1 Hybrid Speech-to-Text (STT)
- **Pre-recorded synthetic Swedish cases (2–3 visits):** Real synthetic/acted Swedish audio files paired with timestamped transcripts containing planted FK gaps (e.g., missing clinical status / vague work impact) and planted low-confidence ASR words (e.g., duration or sick-leave percentage). Guarantees a rock-solid demo with real audio-clip receipt playback.
- **Live Swedish STT (simple API — e.g., Whisper / Gemini Audio):** Powers live recording tests and the **10-second doctor voice addendum** on stage, appending new `[Diktat]` utterances to the visit transcript and re-running extraction.

### 4.2 Two-Layer Intelligence Pipeline

```
Visit Audio Clip(s)
  └──► Unified Transcript: Utterances [U1..Un] (speaker, start_ms, end_ms, uncertain_words[])
         │
         ├──► [LLM Call A — Parallel] Visit Summary (structured JSON)
         └──► [LLM Call B — Parallel] Certificate Extraction (structured JSON with source_ids,
                │                      evidence_type, duration_days, employment_status,
                │                      employer_diagnosis_consent)
                ▼
         [Deterministic Verification Engine (Code — zero LLM guesswork)]
           1. Certificate Routing (14-Day Rule):
              - Employed + total duration ≤ 14 days ──► route to `AG 1-14`
              - Duration > 14 days (day 15+) or unemployed ──► route to `FK 7804`
              - Flag mismatch warning if user manually selects the wrong form for the period
           2. Citation Integrity Check: verify every source_id exists in [U1..Un] (strip/flag invalid IDs)
           3. ASR Uncertainty Propagation: if any cited utterance has uncertain_words[], attach yellow audio warning
           4. Form-Specific Rule Checks:
              - [FK 7804] DFA Checks: flag Field 5 if only `patient_reported` and no `clinical_finding`;
                flag Field 6 if no concrete work task / functional threshold mentioned;
                flag missing required fields explicitly as `[Saknas i samtalet]`
              - [FK 7804] FMB Reference Lookup: compare doctor-stated duration against a small local JSON
                table of 5–8 common primary care diagnoses (verified against Socialstyrelsen FMB)
              - [AG 1-14] Privacy & Period Guardrails: flag if sick-leave period exceeds day 14;
                flag if patient consent to share diagnosis with employer is `missing`;
                deterministically redact diagnosis from AG 1-14 output/PDF unless consent == `yes`
                │
                ▼
         Verified Certificate (AG 1-14 or FK 7804) + Pre-flight Checklist + Audio Receipts
```

### 4.3 Core Data Model (JSON Contract)

```json
{
  "visit_id": "v_001",
  "patient": { "id": "p_001", "name": "Anna Lindberg", "birth_date": "1984-05-12" },
  "clips": [
    { "clip_id": "c_1", "kind": "consultation", "audio_url": "/audio/case1.mp3" },
    { "clip_id": "c_2", "kind": "dictation", "audio_url": "/audio/case1_addendum.webm" }
  ],
  "utterances": [
    {
      "id": "U14",
      "clip_id": "c_1",
      "speaker": "pat",
      "start_ms": 112000,
      "end_ms": 118500,
      "text": "Jag klarar max femton minuter vid kassan innan ryggen låser sig.",
      "uncertain_words": [{ "word": "femton", "confidence": 0.58 }]
    }
  ],
  "summary": {
    "chief_complaint": "...",
    "key_points": ["..."],
    "plan": ["..."]
  },
  "certificate_routing": {
    "recommended_type": "fk_7804",
    "selected_type": "fk_7804",
    "sick_leave_days": 21,
    "employment_status": "employed",
    "mismatch_warning": null
  },
  "ag_1_14": {
    "share_diagnosis_with_employer": "missing",
    "diagnosis_redacted_in_export": true,
    "preflight": { "passed": 3, "total": 4, "risk_level": "medium", "checks": [] },
    "fields": {
      "work_tasks": { "sentences": [] },
      "work_capacity_impact": { "sentences": [] },
      "sick_leave_period": { "degree_percent": 100, "start_date": "2026-11-21", "end_date": "2026-11-30" }
    }
  },
  "fk_7804": {
    "preflight": {
      "passed": 4,
      "total": 6,
      "risk_level": "medium",
      "checks": [
        {
          "id": "dfa_clinical_finding",
          "field": "field_5",
          "status": "fail",
          "label": "Fält 5 saknar objektivt kliniskt fynd",
          "detail": "Endast patientens subjektiva besvär nämns i samtalet. Komplettera med statusfynd."
        }
      ]
    },
    "fields": {
      "field_6_activity_limitation": {
        "sentences": [
          {
            "id": "s_6_1",
            "text": "Patienten uppger svårighet att sitta/stå i kassan längre än ca 15 minuter p.g.a. rygglåsning.",
            "source_ids": ["U14"],
            "evidence_type": "patient_reported",
            "asr_warnings": [
              { "utterance_id": "U14", "word": "femton", "start_ms": 112000 }
            ],
            "edited_by_doctor": false
          }
        ]
      }
    }
  }
}
```

---

## 5. Winning 3-Minute Demo Flow

1. **Context & Smart Routing:** Open synthetic patient *Anna Lindberg* → select a pre-recorded consultation (>14 days sick leave) → system auto-routes to **`FK 7804`** and lands directly in the **2-column Debrief** (Summary + Transcript left, FK 7804 right). *(Optional 10-second contrast: briefly show a second ≤ 14-day visit auto-routed to **`AG 1-14`** where the diagnosis is automatically redacted until patient consent is toggled!)*
2. **"Show the receipts" + ASR Safety:** Show the **Pre-flight DFA Checklist** (`4/6 checks passed`). Click a yellow **ASR warning badge** on a sentence in FK 7804 → UI scrolls to `[U14]` and plays the exact 4-second audio clip so the doctor verifies the uncertain word instantly.
3. **No Hallucinations:** Show the red **`[Saknas i samtalet]`** gap in Field 5/6 (e.g., missing objective clinical status / concrete work-task limitation).
4. **Live Voice Addendum (Real STT):** Click **"Lägg till röstkomplettering"** live on stage for ~10 seconds and dictate the clinical status & work limitation → real Swedish STT appends `[Diktat]` to the transcript → FK 7804 updates in seconds with a new clickable receipt → Pre-flight checklist flips to **`6/6 Grön — Redo för Webcert / Signering`**.
5. **Output:** Click **Kopiera fält** (Webcert-ready for FK 7804) and **Signera & ladda ner PDF** (official PDF structure for AG 1-14 employer handoff / FK 7804 copy).

---

## 6. Privacy, Data & Compliance ("Regulatory by Design")

- **Regulatory by Design (EU MDR):**
  - Intygskollen is explicitly designed as an **administrative documentation and completeness-check tool**, *not* a clinical decision support system (SaMD).
  - The AI **never suggests diagnoses, treatments, or sick-leave durations**. It only structures statements already made by the doctor/patient and surfaces neutral form-completeness checks and official FMB reference ranges (e.g., *"Stated duration exceeds FMB reference — FK typically requires extra motivation in Field 10"*).
  - Keeping clinical judgment strictly with the physician (*human-in-the-loop*) minimizes EU MDR exposure and clearly defines where MDR classification would begin if clinical recommendations were added later.
- **EU AI Act:**
  - High-risk classification for public benefits (Annex III) targets authorities making eligibility decisions (e.g., FK's adjudication systems), not physician-side drafting assistants without automated decision-making; transparency and human oversight obligations are still respected by design.
- **Data Privacy (GDPR & Patientdatalagen / PDL):**
  - **Hackathon prototype:** 100% synthetic data only. Recordings and transcripts live in browser memory only; the server never logs transcripts.
  - **Production path (Region Skåne):** Switch inference endpoints to EU-hosted / zero-data-retention or regional on-prem models (e.g., KB-Whisper + EU-hosted LLM) under a Data Processing Agreement (PUB-avtal) compliant with GDPR and PDL.

---

## 7. Design Validation Checklist (During Hackathon)

- Match exact field numbering and headings from Försäkringskassan's official **FK 7804** form and SKR's **AG 1-14** employer sick-pay form (including the mandatory diagnosis-disclosure consent toggle on AG 1-14).
- Populate the small FMB JSON lookup table (5–8 common primary care diagnoses, e.g., acute lumbago, exhaustion disorder, depression, acute stress reaction) with verified reference lengths from Socialstyrelsen's FMB.
- Run a quick **10-minute hallway test** with an Everi Labs / healthcare mentor on the split-screen debrief UI: *"With 60 seconds before your next patient, do you immediately see what is missing and trust the receipt enough to sign?"*

---

## 8. Out of Scope for Hackathon (Post-Hackathon Roadmap)

- Native **Webcert / EHR (SDV)** integration (planned discovery with Primärvården Skåne).
- Full **Journal** and **AG 7804** (post-day-14 employer copy) generation (shown as "Coming soon" tabs).
- Production Swedish ASR with full speaker diarization and native word-level confidence scores.
- Complete Socialstyrelsen FMB database integration.
- Automated planted-error benchmark suite (detection rate, false-positive rate, ACI-Bench human vs. ASR robustness evaluation).
- Production mobile HTTPS / native app wrapper & SITHS-card signing.
