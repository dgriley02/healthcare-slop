// Fills the official certificate forms with the (doctor-reviewed) draft:
// - FK 7804  Läkarintyg för sjukpenning, to Försäkringskassan (templates/fk7804.pdf: FK's PDF with owner restrictions
//            removed by qpdf --decrypt; it has an XFA layer plus AcroForm fields, we fill the AcroForm fields and drop XFA)
// - AG 1-14  Läkarintyg om arbetsförmåga, sjuklöneperioden, to the employer (templates/ag114.pdf, SKR)
// - AG 7804  Läkarintyg om arbetsförmåga, arbetsgivaren, after day 14 (templates/ag7804.pdf, SKR)
// The SKR forms have generic field names ("Textfält 32"); the mapping below was made from field positions on each page.
import { readFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts } from 'pdf-lib';

// Helvetica (WinAnsi) covers Swedish letters; replace anything it cannot encode.
const clean = s => String(s ?? '').replace(/[‐-―]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
  .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF€]/g, '');
const DRAFT = 'UTKAST genererat av Intygskollen - granskas och signeras av läkare.';

async function openForm(template, overflowSuffix) {
  const doc = await PDFDocument.load(await readFile(new URL(`./templates/${template}`, import.meta.url)));
  const form = doc.getForm();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const overflow = [];
  const wrap = (text, size, width) => text.split('\n').flatMap(para => {
    const out = []; let cur = '';
    for (const w of para.split(' ')) {
      const t = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(t, size) > width && cur) { out.push(cur); cur = w; } else cur = t;
    }
    return [...out, cur];
  });
  // Some forms (SKR's) have no default appearance on their fields; give them one so the font size can be set.
  const fontSize = (t, size) => { try { t.setFontSize(size); } catch { t.acroField.setDefaultAppearance(`/Helv ${size} Tf 0 g`); } };
  // Text is shrunk to fit its box; whatever still doesn't fit is cut and collected in `overflow`.
  const set = (name, value, max = 10, title = '') => {
    if (value == null || value === '') return;
    const t = form.getTextField(name), text = clean(value);
    if (t.getMaxLength()) return t.setText(text.slice(0, t.getMaxLength()));
    const r = t.acroField.getWidgets()[0].getRectangle(), width = r.width - 6;
    if (r.height < 21) { // single-line box: only shrink to fit the width
      let size = max; while (size > 6 && font.widthOfTextAtSize(text, size) > width) size -= 0.5;
      t.setText(text); return fontSize(t, size);
    }
    const lineH = size => size * 1.18, fits = size => wrap(text, size, width).length * lineH(size) <= r.height - 3;
    let size = max;
    while (size > 6 && !fits(size)) size -= 0.5;
    let out = text;
    if (!fits(size)) {
      const lines = wrap(text, size, width), keep = Math.max(1, Math.floor((r.height - 3) / lineH(size)) - 1);
      out = lines.slice(0, keep).join(' ') + ` ... ${overflowSuffix}`;
      overflow.push(`${title}:\n${text}`);
    }
    if (wrap(out, size, width).length > 1 && !t.isMultiline()) t.enableMultiline();
    t.setText(out); fontSize(t, size);
  };
  const check = name => form.getCheckBox(name).check();
  const finish = () => { if (form.hasXFA?.() ?? true) try { form.deleteXFA(); } catch {} form.updateFieldAppearances(font); return doc.save(); };
  return { form, set, check, overflow, finish };
}

/* ---------- FK 7804 (to Försäkringskassan) ---------- */
const P1 = 'form1[0].#subform[0].', P2 = 'form1[0].Sida2[0].', P3 = 'form1[0].Sida3[0].', P4 = 'form1[0].Sida4[0].';
const FK_PNR = ['form1[0].#subform[0].Grupp_Sidhuvud[0].flt_txtPersonNr[0]', `${P2}flt_txtPersonNr[0]`, `${P3}flt_txtPersonNr[0]`, `${P4}flt_txtPersonNr[0]`, 'form1[0].#subform[4].Grupp_SIdh_5[0].flt_txtPersonNr[1]'];
const FK_PROGNOSIS = { full_after_end: '1', full_after_months: '2', not_full: '3', uncertain: '4' };

export async function buildFk7804(f) {
  const { form, set, check, overflow, finish } = await openForm('fk7804.pdf', '(forts. på fortsättningsblad, sida 5)');
  set('form1[0].#subform[0].Grupp_Sidhuvud[0].flt_txtPatientensNamn[0]', f.patient);
  FK_PNR.forEach(n => set(n, f.personnummer));
  check(`${P1}Grupp_Modul2[0].ksr_FysisktVardmote[0]`); // 2. based on: examination at a physical visit
  set(`${P1}flt_datumUndersokningFysiskt[0]`, f.date);
  check(`${P1}Grupp_Modul3[0].ksr_NuvarandeArbete[0]`); // 3. current work
  set(`${P1}Grupp_Modul3[0].flt_txtYrkeArbetsuppgifter[0]`, f.occupation, 10, '3. Sysselsättning');
  set(`${P1}Grupp_Modul4[0].flt_txtDiagnoser[0]`, f.diagnosis, 10, '4. Diagnos'); // 4. ICD-10 code one character per box, no dot
  [...(f.icd10 || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()].slice(0, 5).forEach((ch, i) => set(`${P1}Grupp_Modul4[0].flt_txtDiaKod${i + 1}[0]`, ch));
  set(`${P2}Grupp_Modul5[0].flt_txtBeskrivUndersokningsfynd[0]`, f.function_impairment, 10, '5. Funktionsnedsättning');
  set(`${P2}Grupp_Modul6[0].flt_txtBeskrivAktivitetsbegransning[0]`, f.activity_limitation, 10, '6. Aktivitetsbegränsning');
  set(`${P2}Grupp_Modul7[0].flt_txtPagandeMedicinskBehandling[0]`, f.treatment, 10, '7. Medicinsk behandling');
  if (['25', '50', '75', '100'].includes(String(f.degree))) { // 8. reduced work capacity
    check(`${P2}Grupp_Modul8[0].ksr_${f.degree}procent[0]`);
    set(`${P2}Grupp_Modul8[0].flt_datumFranMed${f.degree}Procent[0]`, f.from);
    set(`${P2}Grupp_Modul8[0].flt_datumTillMed${f.degree}Procent[0]`, f.to);
  }
  set(`${P3}Grupp_Modul8_1[0].flt_txtArbetsförmaga[0]`, f.motivation, 9, '8. Motivering längre sjukskrivning');
  const opt = FK_PROGNOSIS[f.prognosis_option]; // 9. prognosis
  if (opt) form.getRadioGroup(`${P3}Grupp_Modul9[0].RadioButtonList4[0]`).select(opt);
  if (f.prognosis_option === 'full_after_months') set(`${P3}flt_numManadManader[0]`, String(f.prognosis_months || ''));
  if (f.prognosis_option === 'uncertain') set(`${P3}Grupp_Modul9[0].flt_txtAlternativFyra[0]`, f.prognosis_reason, 9, '9. Prognos');
  set(`${P3}Grupp_Modul10[0].flt_txtArbetslivsinriktadAtgarderUnderlatta[0]`, f.work_measures, 10, '10. Åtgärder');
  set(`${P3}Grupp_Modul11[0].flt_txtOvrigaUpplysningarl[0]`, [DRAFT, f.other].filter(Boolean).join('\n'), 9);
  if (overflow.length) set('form1[0].#subform[4].Grupp_Modul_14[0].flt_txtFortsattningsblad[0]', overflow.join('\n\n'), 10, '14. Fortsättningsblad');
  return finish();
}

/* ---------- AG 1-14 (to the employer, sick-pay period) ---------- */
const F = n => `Textfält ${n}`, K = n => `Kryssruta ${n}`;
export async function buildAg114(f) {
  const { set, check, finish } = await openForm('ag114.pdf', '(se journal)');
  set('Namn', f.patient); set('Personnummer', f.personnummer);
  check(K(53)); set(F(121), f.date);                    // based on: my examination of the patient
  check(K(6)); set(F(25), f.occupation, 10);            // current work: occupation and tasks
  check(K(47));                                         // share diagnosis with employer: No (only with the patient's consent)
  set(F(32), f.description, 10);                        // how the illness reduces work capacity
  if (f.capacity_despite) { check(K(39)); set(F(72), f.capacity_despite, 10); } else check(K(38)); // work capacity despite illness
  set(F(82), f.degree ? `${f.degree} %` : '');          // reduced by (percent)
  set(F(80), f.from); set(F(81), f.to);                 // period
  set(F(60), [DRAFT, f.other].filter(Boolean).join('\n'), 9);
  check(K(54));                                         // employer contact with care unit: No
  return finish();
}

/* ---------- AG 7804 (to the employer, after day 14; employer copy of FK 7804) ---------- */
const AG_DEGREE = { 25: [14, 41, 45], 50: [15, 40, 44], 75: [16, 39, 43], 100: [17, 38, 42] }; // checkbox, from, to
export async function buildAg7804(f) {
  const { set, check, finish } = await openForm('ag7804.pdf', '(se journal)');
  set('Namn', f.patient); set('Personnummer', f.personnummer);
  check(K(83)); set(F(12), f.date);                     // based on: my examination of the patient
  check(K(6)); set(F(25), f.occupation, 10);            // current work
  check(K(66));                                         // share diagnosis with employer: No (only with the patient's consent)
  set(F(32), f.function_impairment, 10);                // functional impairment
  set(F(148), f.activity_limitation, 10);               // activity limitation
  set(F(34), f.treatment, 10);                          // ongoing treatment
  const d = AG_DEGREE[f.degree];
  if (d) { check(K(d[0])); set(F(d[1]), f.from); set(F(d[2]), f.to); }
  set(F(46), f.motivation, 10);                         // longer than the decision support recommends, because
  const months = { 1: 23, 2: 24, 3: 25, 6: 26, 12: 27 };
  if (f.prognosis_option === 'full_after_end') check(K(19));
  if (f.prognosis_option === 'full_after_months') { check(K(20)); const m = [1, 2, 3, 6, 12].find(x => x >= (f.prognosis_months || 1)) || 12; check(K(months[m])); }
  if (f.prognosis_option === 'not_full') check(K(21));
  if (f.prognosis_option === 'uncertain') check(K(22));
  set(F(55), f.work_measures, 10);                      // measures that ease return to work
  set(F(60), [DRAFT, f.other].filter(Boolean).join('\n'), 9);
  check(K(78));                                         // employer contact with care unit: No
  return finish();
}
