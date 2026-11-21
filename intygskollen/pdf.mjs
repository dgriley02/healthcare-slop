// Fills Försäkringskassan's own FK 7804 form (templates/fk7804.pdf).
// The template is FK's published PDF with the owner restrictions removed (qpdf --decrypt). It has an XFA layer plus
// ordinary AcroForm fields; we fill the AcroForm fields and drop the XFA layer so every PDF viewer shows the values.
import { readFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const TEMPLATE = new URL('./templates/fk7804.pdf', import.meta.url);
const P1 = 'form1[0].#subform[0].', P2 = 'form1[0].Sida2[0].', P3 = 'form1[0].Sida3[0].', P4 = 'form1[0].Sida4[0].';
const PNR = ['form1[0].#subform[0].Grupp_Sidhuvud[0].flt_txtPersonNr[0]', `${P2}flt_txtPersonNr[0]`, `${P3}flt_txtPersonNr[0]`, `${P4}flt_txtPersonNr[0]`, 'form1[0].#subform[4].Grupp_SIdh_5[0].flt_txtPersonNr[1]'];
const DEGREE = { 100: '100', 75: '75', 50: '50', 25: '25' };
const PROGNOSIS = { full_after_end: '1', full_after_months: '2', not_full: '3', uncertain: '4' };

// Helvetica (WinAnsi) covers Swedish letters; replace anything it cannot encode.
const clean = s => String(s ?? '').replace(/[‐-―]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
  .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF€]/g, '');

export async function buildFk7804(f) {
  const doc = await PDFDocument.load(await readFile(TEMPLATE));
  const form = doc.getForm();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  // Text is shrunk to fit its box; whatever still doesn't fit continues on the continuation sheet (page 5).
  const overflow = [];
  const wrap = (text, size, width) => text.split('\n').flatMap(para => {
    const out = []; let cur = '';
    for (const w of para.split(' ')) {
      const t = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(t, size) > width && cur) { out.push(cur); cur = w; } else cur = t;
    }
    return [...out, cur];
  });
  const set = (name, value, max = 10, title = '') => {
    if (!value) return;
    const t = form.getTextField(name), text = clean(value);
    if (t.getMaxLength()) return t.setText(text.slice(0, t.getMaxLength()));
    const r = t.acroField.getWidgets()[0].getRectangle(), width = r.width - 6;
    if (r.height < 20) { // single-line box: only shrink to fit the width
      let size = max; while (size > 6 && font.widthOfTextAtSize(text, size) > width) size -= 0.5;
      t.setText(text); return t.setFontSize(size);
    }
    const lineH = size => size * 1.18, fits = size => wrap(text, size, width).length * lineH(size) <= r.height - 3;
    let size = max;
    while (size > 6 && !fits(size)) size -= 0.5;
    let out = text;
    if (!fits(size)) { // still too long at 6 pt: keep what fits, move the rest
      const lines = wrap(text, size, width), keep = Math.max(1, Math.floor((r.height - 3) / lineH(size)) - 1);
      out = lines.slice(0, keep).join(' ') + ' ... (forts. på fortsättningsblad, sida 5)';
      overflow.push(`${title}:\n${text}`);
    }
    if (wrap(out, size, width).length > 1 && !t.isMultiline()) t.enableMultiline();
    t.setText(out); t.setFontSize(size);
  };
  const check = name => form.getCheckBox(name).check();

  set('form1[0].#subform[0].Grupp_Sidhuvud[0].flt_txtPatientensNamn[0]', f.patient);
  PNR.forEach(n => set(n, f.personnummer));

  // 2. Intyget är baserat på
  check(`${P1}Grupp_Modul2[0].ksr_FysisktVardmote[0]`);
  set(`${P1}flt_datumUndersokningFysiskt[0]`, f.date);

  // 3. Sysselsättning
  check(`${P1}Grupp_Modul3[0].ksr_NuvarandeArbete[0]`);
  set(`${P1}Grupp_Modul3[0].flt_txtYrkeArbetsuppgifter[0]`, f.occupation, 10, '3. Sysselsättning');

  // 4. Diagnos: text + ICD-10 code, one character per box, without the dot
  set(`${P1}Grupp_Modul4[0].flt_txtDiagnoser[0]`, f.diagnosis, 10, '4. Diagnos');
  [...(f.icd10 || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()].slice(0, 5)
    .forEach((ch, i) => set(`${P1}Grupp_Modul4[0].flt_txtDiaKod${i + 1}[0]`, ch));

  // 5-7
  set(`${P2}Grupp_Modul5[0].flt_txtBeskrivUndersokningsfynd[0]`, f.function_impairment, 10, '5. Funktionsnedsättning');
  set(`${P2}Grupp_Modul6[0].flt_txtBeskrivAktivitetsbegransning[0]`, f.activity_limitation, 10, '6. Aktivitetsbegränsning');
  set(`${P2}Grupp_Modul7[0].flt_txtPagandeMedicinskBehandling[0]`, f.treatment, 10, '7. Medicinsk behandling');

  // 8. Nedsättning av arbetsförmåga
  const deg = DEGREE[f.degree];
  if (deg) {
    check(`${P2}Grupp_Modul8[0].ksr_${deg}procent[0]`);
    set(`${P2}Grupp_Modul8[0].flt_datumFranMed${deg}Procent[0]`, f.from);
    set(`${P2}Grupp_Modul8[0].flt_datumTillMed${deg}Procent[0]`, f.to);
  }
  set(`${P3}Grupp_Modul8_1[0].flt_txtArbetsförmaga[0]`, f.motivation, 9, '8. Motivering längre sjukskrivning');

  // 9. Prognos
  const opt = PROGNOSIS[f.prognosis_option];
  if (opt) form.getRadioGroup(`${P3}Grupp_Modul9[0].RadioButtonList4[0]`).select(opt);
  if (f.prognosis_option === 'full_after_months') set(`${P3}flt_numManadManader[0]`, String(f.prognosis_months || ''));
  if (f.prognosis_option === 'uncertain') set(`${P3}Grupp_Modul9[0].flt_txtAlternativFyra[0]`, f.prognosis_reason, 9, '9. Prognos');

  // 10-11
  set(`${P3}Grupp_Modul10[0].flt_txtArbetslivsinriktadAtgarderUnderlatta[0]`, f.work_measures, 10, '10. Åtgärder');
  set(`${P3}Grupp_Modul11[0].flt_txtOvrigaUpplysningarl[0]`,
    ['UTKAST genererat av Intygskollen - granskas och signeras av läkare.', f.other].filter(Boolean).join('\n'), 9);

  if (overflow.length) set('form1[0].#subform[4].Grupp_Modul_14[0].flt_txtFortsattningsblad[0]', overflow.join('\n\n'), 10, '14. Fortsättningsblad');
  form.deleteXFA();
  form.updateFieldAppearances(font);
  return doc.save();
}
