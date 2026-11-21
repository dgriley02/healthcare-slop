# Live demo: 40-second follow-up visit with an interpreter, extended sick leave + prescription

**Patient:** Michael Brown, P27, 38 years old, demo personnummer 19881115-TF27. He speaks English and has an interpreter.

**First visit, 12 days ago:** already in his history as R79, and also done with an interpreter. It holds everything FK 7804 needs:
- Occupation: undersköterska at a care home. His tasks are transferring and showering residents and lifting.
- Diagnosis: lumbago with sciatica.
- Findings: Lasègue positive on the left at 40 degrees, forward bending to the knees.
- Sick leave: 100 % for 12 days.

The app sends earlier visits by the same patient along as background. The diagnosis, occupation and start of the sick period come from there; today's findings come from the live conversation.

## Roles
| Role | Language |
|---|---|
| Doctor (L) | Swedish |
| Interpreter (T) | Swedish ↔ English |
| Patient (P) | English |

## Flow
1. Search for "Michael" and open Michael Brown.
2. Click **Nytt möte**. The phone switches to the recorder automatically.
3. Start recording on the phone and play out the script (about 40 seconds).
4. Stop. Everyone lands on the transcript, with speakers labelled `läk`, `tolk` and `pat`.
5. The cards are drafted automatically (about 15 seconds). Open **Intyg från dag 15** and show:
   - the DFA status
   - the source references, both `U..` from today and `R79:U..` from the first visit
   - the 50 % sick leave
6. Open **Recept**: naproxen.
7. Click **Godkänn och för över till Webcert** and show the status flow.

## Script (about 40 seconds)

The script is in Swedish and English because the conversation itself is.

> **L:** Hej Michael, hur är ryggen?
>
> **T:** How is your back?
>
> **P:** Better, but it still shoots down my left leg. I can't lift the residents yet.
>
> **T:** Bättre, men det strålar fortfarande ner i vänster ben. Han kan inte lyfta brukarna än.
>
> **L:** Lasègue är positiv vid 60 grader och framåtböjningen når mitten av underbenen. Inga lyft eller duschhjälp, men dokumentation halva dagen går bra. Sjukskrivning 50 procent i två veckor, och naproxen 250 milligram två gånger dagligen i tio dagar.
>
> **T:** Lasègue is positive at 60 degrees. No lifting or showering residents, but paperwork half days is fine. Fifty percent sick leave for two weeks, and naproxen 250 milligrams twice daily for ten days.

**Tips:**
- Say "Lasègue" and "naproxen" clearly.
- Keep a short pause between the lines.
- The interpreter should start each line in the other language straight away. Soniox often puts voices that follow each other closely into one voice, and the app then separates the lines by language.

## Dress rehearsal (with the script as the transcript)

**Speakers:** all 6 lines correctly classified (läkare, tolk, patient, tolk, läkare, tolk).

**FK 7804:**
- Score 100/100, with D, F, A and the chain all approved and no warnings.
- The diagnosis and occupation are taken from the first visit, the findings (Lasègue 60°, forward bending) from today.
- Sick leave: 50 % for 14 days, a total of 26 days, under the recommendation of 28 (demo values).

**Prescription:** naproxen 250 mg twice a day.
