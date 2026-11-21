// Slotwise – shared data layer, risk model and intervention engine.
// Everything is stored in localStorage so the staff view and the patient portal
// stay in sync across browser tabs (via the `storage` event).

/* ---------- dates ---------- */
const DAY = 864e5;
const SLOTS = ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '13:00', '13:30', '14:00', '14:30', '15:00', '15:30'];
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / DAY);
const monday = (off = 0) => { const d = today(); return addDays(d, -((d.getDay() + 6) % 7) + off * 7); };
const isWeekend = d => d.getDay() === 0 || d.getDay() === 6;
const fmtDay = s => parse(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtLong = s => parse(s).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = p => `${Math.round(p * 100)}%`;
const rnd = () => Math.random();
const pick = a => a[Math.floor(rnd() * a.length)];

/* ---------- risk model ---------- */
// Logistic model. Default coefficients are hand-set from the published statistics of the
// Kaggle "Medical Appointment No Shows" dataset (base rate ~20%). Run train/train.py on the
// dataset to replace them with fitted weights (writes model.js -> window.MODEL).
const DEFAULT_MODEL = {
  source: 'heuristic',
  intercept: -1.75,
  lead: { '0': -1.55, '1-2': 0.05, '3-7': 0.25, '8-14': 0.45, '15-30': 0.6, '31+': 0.68 },
  age: { '0-17': 0.05, '18-35': 0.25, '36-55': 0, '56+': -0.3 },
  prev: { '0': 0, '1': 0.9, '2+': 1.6 },
  weekday: { 1: 0.05, 2: 0, 3: 0, 4: 0, 5: 0.08 },
  sms: -0.35,       // reminder sent
  confirmed: -1.0,  // patient actively confirmed (not in Kaggle data; literature-based)
};
const MODEL = { ...DEFAULT_MODEL, ...(window.MODEL || {}) };
const sig = z => 1 / (1 + Math.exp(-z));
const leadBin = n => n <= 0 ? '0' : n <= 2 ? '1-2' : n <= 7 ? '3-7' : n <= 14 ? '8-14' : n <= 30 ? '15-30' : '31+';
const ageBin = a => a < 18 ? '0-17' : a < 36 ? '18-35' : a < 56 ? '36-55' : '56+';
const prevBin = n => n <= 0 ? '0' : n === 1 ? '1' : '2+';

function risk(b) {
  const M = MODEL, lead = Math.max(0, daysBetween(b.createdAt, b.date)), wd = parse(b.date).getDay(), pv = b.prevNoShows || 0;
  const f = [
    [lead === 0 ? 'Same-day booking' : `Booked ${lead} day${lead === 1 ? '' : 's'} in advance`, M.lead[leadBin(lead)] || 0],
    [`Age group ${ageBin(b.age)}`, M.age[ageBin(b.age)] || 0],
    [pv ? `${pv} previous no-show${pv === 1 ? '' : 's'}` : 'No previous no-shows', M.prev[prevBin(pv)] || 0],
    ['Reminder sent', b.sms ? M.sms : 0],
    ['Attendance confirmed', b.confirmed ? M.confirmed : 0],
    [parse(b.date).toLocaleDateString('en-GB', { weekday: 'long' }), M.weekday[wd] || 0],
  ];
  const z = M.intercept + f.reduce((s, x) => s + x[1], 0), p = sig(z);
  const factors = f.filter(x => Math.abs(x[1]) > 0.01)
    .map(([label, w]) => ({ label, delta: p - sig(z - w) }))
    .sort((a, c) => Math.abs(c.delta) - Math.abs(a.delta));
  return { p, factors };
}
const level = p => p >= 0.4 ? 'high' : p >= 0.2 ? 'med' : 'low';
const LEVEL_LABEL = { high: 'High', med: 'Elevated', low: 'Low' };

// Tiered intervention policy: cheap actions for everyone, staff time only where it pays off.
function recommend(b) {
  if (b.status !== 'booked' || b.confirmed) return null;
  const { p } = risk(b);
  if (p >= 0.4) return { key: 'call', label: 'Phone call to confirm' };
  if (!b.sms) return { key: 'sms', label: p >= 0.2 ? 'SMS with confirm/cancel link' : 'Standard SMS reminder' };
  return null;
}
const OVERBOOK_THRESHOLD = 0.5;

/* ---------- storage ---------- */
const VERSION = 3;
const S = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem('sw.' + k)) ?? d; } catch { return d; } },
  set: (k, v) => localStorage.setItem('sw.' + k, JSON.stringify(v)),
};
const getB = () => S.get('bookings', []);
const setB = v => S.set('bookings', v);
const getW = () => S.get('waitlist', []);
const setW = v => S.set('waitlist', v);
const getLog = () => S.get('log', []);
const active = b => b.status !== 'cancelled';
const slotBookings = (date, time) => getB().filter(b => b.date === date && b.time === time && active(b));
const slotFree = (date, time) => slotBookings(date, time).length === 0;

function log(msg, kind = 'info') {
  const l = getLog();
  l.unshift({ at: Date.now(), msg, kind });
  S.set('log', l.slice(0, 200));
  window.dispatchEvent(new Event('sw-change'));
}
const ref = () => 'SW-' + Math.random().toString(36).slice(2, 6).toUpperCase();
const uid = () => Math.random().toString(36).slice(2, 10);

function addBooking(b) {
  const nb = { id: uid(), ref: ref(), createdAt: iso(today()), status: 'booked', sms: false, confirmed: false, prevNoShows: 0, source: 'patient', ...b };
  setB([...getB(), nb]);
  return nb;
}
function updateBooking(id, patch) { setB(getB().map(b => b.id === id ? { ...b, ...patch } : b)); }
const findBooking = id => getB().find(b => b.id === id);
const findByRef = r => getB().find(b => b.ref.toUpperCase() === r.trim().toUpperCase());

// Returning patients: look up no-show history by phone number.
function historyFor(phone) {
  const p = phone.replace(/\D/g, '');
  return getB().filter(b => b.phone.replace(/\D/g, '') === p && b.status === 'noshow').length;
}

/* ---------- interventions ---------- */
const who = b => `${b.name} (${fmtDay(b.date)} ${b.time})`;

function sendSms(id) {
  const b = findBooking(id); if (!b) return;
  updateBooking(id, { sms: true });
  log(`Reminder SMS with confirm/cancel link sent to ${who(b)}`, 'sms');
  // Simulated patient response
  setTimeout(() => {
    const cur = findBooking(id); if (!cur || cur.status !== 'booked') return;
    const { p } = risk(cur);
    const r = rnd();
    if (r < p * 0.4) cancelBooking(id, 'patient via SMS link');
    else if (r < p * 0.4 + (1 - p) * 0.6) { updateBooking(id, { confirmed: true }); log(`${cur.name} confirmed attendance via SMS link`, 'ok'); }
  }, 2500);
}

function callPatient(id) {
  const b = findBooking(id); if (!b) return;
  const { p } = risk(b);
  if (rnd() > 0.75) { log(`Called ${who(b)} – no answer, SMS sent instead`, 'warn'); sendSms(id); return; }
  if (rnd() < p * 0.35) { log(`Called ${b.name} – cannot attend, slot released`, 'warn'); cancelBooking(id, 'patient by phone'); return; }
  updateBooking(id, { confirmed: true, sms: true });
  log(`Called ${who(b)} – attendance confirmed`, 'ok');
}

function cancelBooking(id, by = 'staff') {
  const b = findBooking(id); if (!b) return;
  updateBooking(id, { status: 'cancelled' });
  log(`${who(b)} cancelled by ${by}`, 'warn');
  if (parse(b.date) >= today()) offerSlot(b.date, b.time);
}

/* ---------- waiting list ---------- */
const URGENCY = { priority: 0, routine: 1 };
function rankWaitlist(exclude = []) {
  return getW().filter(w => w.status === 'waiting' && !exclude.includes(w.id))
    .sort((a, c) => URGENCY[a.urgency] - URGENCY[c.urgency] || a.addedAt.localeCompare(c.addedAt));
}
function updateWait(id, patch) { setW(getW().map(w => w.id === id ? { ...w, ...patch } : w)); }

function offerSlot(date, time, exclude = []) {
  if (!slotFree(date, time)) return;
  const c = rankWaitlist(exclude)[0];
  if (!c) { log(`Slot ${fmtDay(date)} ${time} is open – waiting list empty`, 'warn'); return; }
  updateWait(c.id, { status: 'offered', offer: `${date} ${time}` });
  log(`Slot ${fmtDay(date)} ${time} offered to ${c.name} from waiting list`, 'sms');
  setTimeout(() => resolveOffer(c.id, date, time, exclude), 3000);
}

function resolveOffer(wid, date, time, exclude) {
  const w = getW().find(x => x.id === wid); if (!w || w.status !== 'offered') return;
  if (!slotFree(date, time)) { updateWait(wid, { status: 'waiting', offer: null }); return; }
  if (rnd() < 0.75) {
    addBooking({ name: w.name, age: w.age, phone: w.phone, reason: w.reason, date, time, source: 'waitlist', sms: true, confirmed: true, prevNoShows: historyFor(w.phone) });
    updateWait(wid, { status: 'booked', offer: null });
    log(`${w.name} accepted ${fmtDay(date)} ${time} – chair filled`, 'ok');
  } else {
    updateWait(wid, { status: 'waiting', offer: null });
    log(`${w.name} declined ${fmtDay(date)} ${time} – offering to next in line`, 'warn');
    offerSlot(date, time, [...exclude, wid]);
  }
}

function overbook(id) {
  const b = findBooking(id); if (!b) return;
  const c = rankWaitlist()[0];
  if (!c) { log('Overbooking not possible – waiting list empty', 'warn'); return; }
  addBooking({ name: c.name, age: c.age, phone: c.phone, reason: c.reason, date: b.date, time: b.time, source: 'waitlist', overbook: true, sms: true, confirmed: true, prevNoShows: historyFor(c.phone) });
  updateWait(c.id, { status: 'booked' });
  log(`Overbooked ${fmtDay(b.date)} ${b.time} with ${c.name} (primary risk ${pct(risk(b).p)})`, 'info');
}

function addToWaitlist(w) {
  setW([...getW(), { id: uid(), addedAt: iso(today()), status: 'waiting', urgency: 'routine', ...w }]);
  log(`${w.name} joined the waiting list`, 'info');
}

/* ---------- demo data ---------- */
function seed() {
  const first = ['Anna', 'Erik', 'Maja', 'Omar', 'Lina', 'Johan', 'Sara', 'Ali', 'Elsa', 'Noah', 'Ida', 'Leo', 'Fatima', 'Karl',
    'Astrid', 'Hugo', 'Nora', 'Mohammed', 'Ebba', 'Oscar', 'Wilma', 'Yusuf', 'Alva', 'Liam', 'Saga', 'Viktor', 'Amira', 'Axel'];
  const last = ['Svensson', 'Larsson', 'Nilsson', 'Haddad', 'Berg', 'Ek', 'Lindqvist', 'Karimi', 'Holm', 'Strand', 'Björk',
    'Andersson', 'Johansson', 'Ahmed', 'Persson', 'Lund', 'Eriksson', 'Novak', 'Sandberg', 'Olsson'];
  const phone = () => '07' + Math.floor(rnd() * 1e8).toString().padStart(8, '0');
  const patients = Array.from({ length: 60 }, () => {
    const r = rnd();
    return { name: `${pick(first)} ${pick(last)}`, age: Math.floor(rnd() ** 1.2 * 88) + 1, phone: phone(), prevNoShows: r < 0.72 ? 0 : r < 0.9 ? 1 : 2 + Math.floor(rnd() * 2) };
  });
  const reasons = ['Check-up', 'Follow-up', 'Vaccination', 'Blood test', 'Prescription renewal', 'Consultation'];
  const t = today(), out = [];
  for (let d = monday(-1); d <= addDays(monday(2), 4); d = addDays(d, 1)) {
    if (isWeekend(d)) continue;
    const date = iso(d), until = daysBetween(iso(t), date);
    SLOTS.forEach(time => {
      if (rnd() > (until < 0 ? 0.88 : until < 7 ? 0.8 : 0.55)) return;
      const pt = pick(patients);
      let lead = rnd() < 0.18 ? 0 : Math.ceil(rnd() ** 1.6 * 45);
      if (until > 0) lead = Math.max(lead, until);
      const b = { id: uid(), ref: ref(), ...pt, reason: pick(reasons), date, time, createdAt: iso(addDays(d, -lead)),
        sms: until < 0 ? lead >= 3 && rnd() < 0.55 : rnd() < 0.15, confirmed: false, status: 'booked', source: 'patient' };
      if (until < 0) b.status = rnd() < risk(b).p ? 'noshow' : 'attended';
      out.push(b);
    });
  }
  setB(out);
  setW(Array.from({ length: 8 }, (_, i) => {
    const pt = pick(patients);
    return { id: uid(), name: pt.name, age: pt.age, phone: pt.phone, reason: pick(reasons), urgency: i < 2 ? 'priority' : 'routine',
      addedAt: iso(addDays(t, -Math.floor(rnd() * 40) - 2)), status: 'waiting' };
  }));
  S.set('log', []);
  log('Demo data loaded', 'info');
  S.set('v', VERSION);
}
if (S.get('v', 0) !== VERSION) seed();
