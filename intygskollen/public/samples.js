// Synthetic, role-played consultations written for the demo. No real patient data.
const L = (speaker, text) => ({ speaker, text });
window.SUMMARIES = {
  'Lagerarbetare, ländrygg': 'Akut lumbago med ischiassmärta vänster efter lyft på jobbet. Positiv Lasègue vänster vid 40°, normal neurologi. Smärtlindring, remiss till fysioterapeut, heltidssjukskrivning två veckor.',
  'Kontorist, utmattning (luckor)': 'Månader av trötthet och sömnstörning med tidigt uppvaknande. Misstänkt utmattningssyndrom. Ingen undersökning eller skattning dokumenterad. Planerad heltidssjukskrivning tre månader.',
  'Undersköterska, axel (lång sjukskrivning)': 'Smärta höger axel sedan sex veckor. Aktiv abduktion 80°, painful arc 70-110°, nedsatt utåtrotationskraft. Rotatorkuffsyndrom. Fysioterapi och kortisoninjektion, heltidssjukskrivning 60 dagar.',
};
window.SAMPLES = {
  'Lagerarbetare, ländrygg': [
    L('Läkare', 'Hej, vad kan jag hjälpa dig med idag?'),
    L('Patient', 'Jag fick ont i ländryggen i måndags när jag lyfte en låda på jobbet. Det strålar ner i vänster ben.'),
    L('Läkare', 'Vad jobbar du med?'),
    L('Patient', 'Jag är lagerarbetare på heltid. Jag plockar order och lyfter kartonger på upp till 20 kilo hela dagarna, och kör truck ibland.'),
    L('Läkare', 'Hur påverkar smärtan dig?'),
    L('Patient', 'Jag kan inte böja mig framåt alls och jag klarar inte att sitta mer än tjugo minuter. Igår kunde jag inte ens ta på mig strumporna.'),
    L('Läkare', 'Jag ska undersöka dig. Böj dig framåt så långt du kan.'),
    L('Läkare', 'Framåtböjningen är kraftigt nedsatt, fingertopparna når ungefär till knäna. Lasègues test är positivt vänster vid 40 grader. Reflexer och kraft i benen är normala.'),
    L('Läkare', 'Det här är ett akut lumbago med ischiassmärta. Inga tecken på nervpåverkan som kräver akut åtgärd.'),
    L('Läkare', 'Jag skriver ut smärtstillande och remitterar till fysioterapeut. Jag sjukskriver dig på heltid i två veckor och sedan ses vi igen.'),
    L('Patient', 'Okej, tack.'),
  ],
  'Kontorist, utmattning (luckor)': [
    L('Läkare', 'Välkommen. Berätta hur du mår.'),
    L('Patient', 'Jag orkar inte längre. Jag har varit trött i flera månader och nu går det inte.'),
    L('Läkare', 'Hur sover du?'),
    L('Patient', 'Dåligt. Jag vaknar klockan fyra och kan inte somna om.'),
    L('Läkare', 'Och jobbet?'),
    L('Patient', 'Jag jobbar på kontor. Det har varit mycket.'),
    L('Läkare', 'Det låter som utmattningssyndrom. Jag tycker att du ska vara hemma ett tag.'),
    L('Patient', 'Hur länge då?'),
    L('Läkare', 'Vi börjar med tre månader på heltid, så får vi se.'),
  ],
  'Undersköterska, axel (lång sjukskrivning)': [
    L('Läkare', 'Hej, hur är det med axeln?'),
    L('Patient', 'Höger axel har gjort ont i sex veckor. Jag kan inte lyfta armen över huvudet.'),
    L('Läkare', 'Vad har du för arbetsuppgifter?'),
    L('Patient', 'Jag är undersköterska på ett äldreboende. Jag hjälper de boende att förflytta sig, duschar dem och bäddar sängar.'),
    L('Läkare', 'Jag undersöker axeln. Aktiv abduktion når 80 grader, passivt 150. Painful arc mellan 70 och 110 grader. Nedsatt kraft vid utåtrotation.'),
    L('Läkare', 'Det här är ett rotatorkuffsyndrom. Du ska börja med träning hos fysioterapeut och vi ger en kortisoninjektion.'),
    L('Patient', 'Jag klarar inte förflyttningarna eller att hålla i duschen, det gör för ont.'),
    L('Läkare', 'Jag sjukskriver dig på heltid i 60 dagar.'),
  ],
};
