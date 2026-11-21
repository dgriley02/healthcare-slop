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

// More synthetic consultations covering the after-work cards (recept, lab, röntgen, remiss, uppföljning, patientinfo)
// and certificate combinations. Doctors state drugs, doses and orders explicitly so the drafts have something to cite.
Object.assign(window.SUMMARIES, {
  'Halsfluss, recept + labb': 'Halsont och feber sedan tre dagar. Positivt strep A-test, CRP 48. Fenoximetylpenicillin 1 g x 3 i 10 dagar. Ingen sjukskrivning.',
  'Diabetes typ 2, kontroll': 'Årskontroll typ 2-diabetes. HbA1c 62. Metformin höjs till 1 g x 2. Provtagning och sköterskebesök om tre månader, fotundersökning.',
  'Fotled, röntgen + dag 8-14': 'Snubblade i trappa, svullen vänster fotled, ömhet över laterala malleolen. Röntgen fotled. Ibuprofen. Snickare, sjukskriven 100 % i 12 dagar.',
  'Knä, MR + remisser + FK': 'Vridvåld höger knä vid fotboll, låsningar, positivt McMurray. MR knä, remiss ortoped och fysioterapeut. Kock, sjukskriven 100 % i fyra veckor.',
  'Hjärtklappning, utredning': 'Episoder av hjärtklappning och trötthet. Labb: blodstatus, TSH, ferritin, elektrolyter. EKG på mottagningen. Tydliga varningstecken till patienten.',
  'Depression, allt i ett': 'Måttlig depression, MADRS 24. Sertralin 50 mg. Remiss psykolog för KBT. Lärare, sjukskriven 50 % i sex veckor. Återbesök om två veckor.',
  'Lunginflammation, svenska + engelska': 'Engelsktalande patient med feber och hosta. CRP 120, nedsatt andningsljud höger bas. Lungröntgen, amoxicillin. Sjukskriven 100 % i en vecka.',
});
Object.assign(window.SAMPLES, {
  'Halsfluss, recept + labb': [
    L('Läkare', 'Hej, vad gäller det idag?'),
    L('Patient', 'Jag har haft jätteont i halsen i tre dagar och feber, runt 39 grader.'),
    L('Läkare', 'Har du hosta eller snuva?'),
    L('Patient', 'Nej, ingen hosta alls. Det gör bara ont att svälja.'),
    L('Läkare', 'Jag tittar i halsen. Tonsillerna är förstorade med beläggningar och du har ömma körtlar på halsen. Vi tar ett snabbtest för streptokocker och ett CRP.'),
    L('Läkare', 'Strep A-testet är positivt och CRP är 48.'),
    L('Läkare', 'Du får Kåvepenin, fenoximetylpenicillin 1 gram tre gånger om dagen i tio dagar. Är du allergisk mot penicillin?'),
    L('Patient', 'Nej, inte vad jag vet.'),
    L('Läkare', 'Bra. Ta paracetamol vid behov mot smärtan. Hör av dig om du får svårt att svälja saliv, svårt att andas eller inte kan öppna munnen ordentligt.'),
    L('Patient', 'Behöver jag ett intyg till jobbet?'),
    L('Läkare', 'Nej, du har varit sjuk i tre dagar så det räcker med sjukanmälan till arbetsgivaren.'),
  ],
  'Diabetes typ 2, kontroll': [
    L('Läkare', 'Välkommen på årskontrollen för din diabetes. Hur har det gått?'),
    L('Patient', 'Det har gått okej, men jag har slarvat lite med maten under hösten.'),
    L('Läkare', 'Ditt HbA1c är 62, det var 54 för ett år sedan. Blodtrycket idag är 138 över 84.'),
    L('Patient', 'Det låter inte så bra.'),
    L('Läkare', 'Vi höjer metformin till 1 gram två gånger om dagen. Du tar 500 milligram två gånger nu, eller hur?'),
    L('Patient', 'Ja, det stämmer.'),
    L('Läkare', 'Jag skriver en labbremiss: HbA1c, lipidstatus, kreatinin med eGFR och urin-albumin-kreatininkvot. Ta proverna fastande om tre månader, en vecka före besöket.'),
    L('Läkare', 'Du får en tid hos diabetessköterskan om tre månader och sköterskan gör en fotundersökning då.'),
    L('Läkare', 'Jag remitterar dig också till ögonbottenfotografering, det är två år sedan senast.'),
    L('Patient', 'Ska jag tänka på något med den högre dosen?'),
    L('Läkare', 'Ta tabletterna med mat. Magbesvär är vanligt de första veckorna. Hör av dig om du får kraftiga magbesvär eller känner dig väldigt trött och illamående.'),
  ],
  'Fotled, röntgen + dag 8-14': [
    L('Läkare', 'Hej, vad har hänt?'),
    L('Patient', 'Jag snubblade i trappan för en vecka sedan och vrickade vänster fot. Den är fortfarande svullen och jag kan knappt stödja på den.'),
    L('Läkare', 'Vad jobbar du med?'),
    L('Patient', 'Jag är snickare. Jag går på byggarbetsplatser hela dagarna, klättrar på stegar och bär virke.'),
    L('Läkare', 'Jag undersöker. Det är kraftig svullnad lateralt och du är öm när jag trycker bakom yttre fotknölen. Du kan inte gå fyra steg utan hjälp.'),
    L('Läkare', 'Enligt Ottawa-reglerna ska vi röntga. Jag skriver en röntgenremiss för vänster fotled, frågeställning fraktur i laterala malleolen.'),
    L('Läkare', 'Du får ibuprofen 400 milligram tre gånger om dagen i fem dagar, ta det med mat.'),
    L('Patient', 'Jag har varit hemma en vecka redan. Behöver jag intyg?'),
    L('Läkare', 'Ja, från dag åtta behöver arbetsgivaren ett läkarintyg. Jag sjukskriver dig på heltid i tolv dagar till att börja med, du kan inte gå på stegar eller bära med foten så här.'),
    L('Läkare', 'Om röntgen visar en fraktur ringer jag dig och då remitterar vi till ortopeden.'),
  ],
  'Knä, MR + remisser + FK': [
    L('Läkare', 'Hej, berätta om knät.'),
    L('Patient', 'Jag vred höger knä när jag spelade fotboll för tre veckor sedan. Det låser sig ibland och svullnar efter jobbet.'),
    L('Läkare', 'Vad har du för arbete?'),
    L('Patient', 'Jag är kock. Jag står upp tio timmar om dagen, går mycket och bär tunga kastruller och lådor.'),
    L('Läkare', 'Jag undersöker. Det finns en lätt svullnad, ömhet över mediala ledspringan och McMurrays test är positivt medialt. Böjning går till 100 grader. Korsbanden är stabila.'),
    L('Läkare', 'Det talar för en meniskskada. Jag skriver en remiss för MR höger knä, frågeställning medial meniskskada. Har du pacemaker eller metall i kroppen?'),
    L('Patient', 'Nej.'),
    L('Läkare', 'Jag skickar också en remiss till ortopeden för bedömning av eventuell artroskopi, och en remiss till fysioterapeut för träning under tiden.'),
    L('Läkare', 'Du kan inte stå och gå tio timmar med ett knä som låser sig. Jag sjukskriver dig på heltid i fyra veckor.'),
    L('Patient', 'Kan jag ta något mot värken?'),
    L('Läkare', 'Paracetamol 1 gram upp till tre gånger om dagen vid behov. Vi har ett återbesök efter MR-svaret, ungefär om tre veckor.'),
  ],
  'Hjärtklappning, utredning': [
    L('Läkare', 'Hej, vad kan jag hjälpa dig med?'),
    L('Patient', 'Jag har fått hjärtklappning några gånger i veckan den senaste månaden och jag är så trött hela tiden.'),
    L('Läkare', 'Hur länge håller det i sig och har du svimmat eller haft ont i bröstet?'),
    L('Patient', 'Några minuter. Jag har inte svimmat och inte ont i bröstet.'),
    L('Läkare', 'Hjärta och lungor låter normalt, pulsen är regelbunden 84 och blodtrycket 126 över 78.'),
    L('Läkare', 'Vi tar ett EKG här på mottagningen idag. Jag skriver också en labbremiss: blodstatus, TSH, ferritin och elektrolyter, natrium, kalium och kalcium.'),
    L('Läkare', 'Om proverna är normala gör vi en långtids-EKG. Jag ringer dig med svaren om en vecka.'),
    L('Läkare', 'Om du får hjärtklappning med bröstsmärta, andnöd eller känner dig svimfärdig ska du ringa 112 direkt.'),
    L('Patient', 'Okej, tack.'),
  ],
  'Depression, allt i ett': [
    L('Läkare', 'Hej, hur mår du sedan sist?'),
    L('Patient', 'Inte bra. Jag sover dåligt, har ingen ork och gråter mycket. Det har varit så i två månader.'),
    L('Läkare', 'Vad jobbar du med?'),
    L('Patient', 'Jag är lärare på högstadiet. Jag klarar inte att planera lektionerna eller hålla fokus i klassrummet. Jag glömmer saker hela tiden.'),
    L('Läkare', 'Har du haft tankar på att ta ditt liv?'),
    L('Patient', 'Nej, inga sådana tankar.'),
    L('Läkare', 'Din MADRS-skattning är 24, det motsvarar en måttlig depression. Du har nedsatt koncentration och minne och tydlig psykomotorisk hämning här på besöket.'),
    L('Läkare', 'Jag föreslår sertralin 50 milligram en gång om dagen. De första veckorna kan du må lite illa och sova sämre.'),
    L('Läkare', 'Jag skickar en remiss till psykolog här på vårdcentralen för KBT.'),
    L('Läkare', 'Du klarar inte hela tjänsten nu. Jag sjukskriver dig på 50 procent i sex veckor, så att du kan arbeta förmiddagar med färre lektioner.'),
    L('Läkare', 'Vi ses på återbesök om två veckor för att se hur medicinen fungerar, och sköterskan ringer dig om en vecka.'),
    L('Läkare', 'Om du får tankar på att skada dig själv ska du ringa 112 eller söka akut psykiatri direkt.'),
  ],
  'Lunginflammation, svenska + engelska': [
    L('Läkare', 'Hej, do you prefer English?'),
    L('Patient', 'Yes please. I have had fever and a bad cough for five days, and it hurts on the right side when I breathe.'),
    L('Läkare', 'What do you work with?'),
    L('Patient', 'I work in a warehouse, driving a forklift and carrying boxes.'),
    L('Läkare', 'Your temperature is 38.9, saturation 94 percent. I hear reduced breath sounds and crackles at the right base. CRP is 120.'),
    L('Läkare', 'This looks like pneumonia. I will send you for a chest X-ray today, to confirm a right-sided pneumonia.'),
    L('Läkare', 'Du får amoxicillin 750 milligram tre gånger om dagen i sju dagar. Sorry, amoxicillin 750 milligrams three times a day for seven days.'),
    L('Patient', 'I am not allergic to anything. Can I go back to work?'),
    L('Läkare', 'No, with fever and breathlessness you cannot do heavy lifting. I will put you on full sick leave for one week.'),
    L('Läkare', 'Come back or call 1177 if you get more short of breath, chest pain or if the fever is still there after three days on antibiotics. We will check CRP again in two weeks.'),
  ],
});

// Mixed-language consultations: the doctor speaks Swedish, the patient their own language (as transcribed by Soniox).
// National minority languages (finska, meänkieli, samiska, romani chib, jiddisch) and the largest immigrant languages.
// Written for the demo; texts in some languages should be checked by a native speaker before being shown publicly.
const P = text => L('Patient', text), D = text => L('Läkare', text);
window.SAMPLE_LANGS = Object.assign(window.SAMPLE_LANGS || {}, {
  'Arabiska: urinvägsinfektion': 'sv+ar', 'Persiska: migrän': 'sv+fa', 'Somaliska: astma': 'sv+so', 'Tigrinja: magsmärta': 'sv+ti',
  'Kurdiska: ryggskott, dag 8-14': 'sv+ckb', 'BKS: högt blodtryck': 'sv+bs', 'Polska: handskada, röntgen + FK': 'sv+pl', 'Turkiska: yrsel': 'sv+tr',
  'Ukrainska: sömnproblem efter trauma': 'sv+uk', 'Finska: knäartros': 'sv+fi', 'Meänkieli: diabeteskontroll': 'sv+fit', 'Nordsamiska: eksem': 'sv+se',
  'Romani: akut bronkit': 'sv+rom', 'Jiddisch: fall och höftsmärta': 'sv+yi',
});
Object.assign(window.SUMMARIES, {
  'Arabiska: urinvägsinfektion': 'Sveda vid vattenkastning sedan två dagar, ingen feber. Urinsticka positiv för nitrit. Pivmecillinam 400 mg x 3 i 3 dagar.',
  'Persiska: migrän': 'Återkommande ensidig huvudvärk med ljuskänslighet. Migrän. Sumatriptan 50 mg vid anfall, huvudvärksdagbok, återbesök om 2 månader.',
  'Somaliska: astma': 'Hosta och pip i bröstet nattetid, värre vid kyla. Misstänkt astma. Spirometri med reversibilitet, Bricanyl Turbuhaler vid behov.',
  'Tigrinja: magsmärta': 'Brännande smärta i övre buken i en månad. Helicobacter-test i avföring, blodstatus. Omeprazol 20 mg i 4 veckor.',
  'Kurdiska: ryggskott, dag 8-14': 'Ryggskott för en vecka sedan, lagerarbetare. Nedsatt rörlighet, negativ Lasègue. Sjukskriven 100 % i en vecka till, fysioterapeut.',
  'BKS: högt blodtryck': 'Blodtryck 162/98 vid upprepade mätningar. Labb: kreatinin, elektrolyter, lipider, HbA1c. Amlodipin 5 mg. Sköterskekontroll om 4 veckor.',
  'Polska: handskada, röntgen + FK': 'Byggarbetare som klämde höger hand. Svullnad över femte mellanhandsbenet. Röntgen hand. Sjukskriven 100 % i tre veckor.',
  'Turkiska: yrsel': 'Yrsel vid uppresning i två veckor. Ortostatiskt blodtrycksfall. Labb: blodstatus, elektrolyter, B12. Pausa hydroklortiazid.',
  'Ukrainska: sömnproblem efter trauma': 'Mardrömmar och sömnsvårigheter sedan flykten. Misstänkt PTSD. Remiss psykolog för traumafokuserad KBT, melatonin 2 mg.',
  'Finska: knäartros': 'Smärta i båda knäna vid gång, morgonstelhet under 30 minuter. Knäartros. Remiss fysioterapeut till artrosskola, paracetamol.',
  'Meänkieli: diabeteskontroll': 'Typ 2-diabetes, HbA1c 58. Fortsatt metformin. Labb inför nästa kontroll, fotundersökning hos sköterska.',
  'Nordsamiska: eksem': 'Kliande eksem i armvecken sedan vintern. Betametason kräm i två veckor, mjukgörande kräm dagligen.',
  'Romani: akut bronkit': 'Hosta i tio dagar efter förkylning, ingen feber, normala lungor. Akut bronkit, ingen antibiotika. Egenvårdsråd och varningstecken.',
  'Jiddisch: fall och höftsmärta': '82-årig kvinna som föll hemma, smärta i vänster höft, kan gå med stöd. Röntgen höft, paracetamol, remiss till fysioterapeut för fallprevention.',
});
Object.assign(window.SAMPLES, {
  'Arabiska: urinvägsinfektion': [
    D('Hej, vad gäller det idag?'), P('عندي حرقة عند التبول منذ يومين، وأحتاج للذهاب إلى الحمام كثيراً.'),
    D('Har du feber eller ont i ryggen?'), P('لا، ليس عندي حرارة ولا ألم في الظهر.'),
    D('Urinstickan visar nitrit och vita blodkroppar. Det är en okomplicerad urinvägsinfektion.'),
    D('Du får pivmecillinam, Selexid, 400 milligram tre gånger om dagen i tre dagar.'),
    P('هل يمكنني الذهاب إلى العمل؟'), D('Ja, du kan arbeta. Hör av dig om du får feber eller ont i ryggen.'),
  ],
  'Persiska: migrän': [
    D('Hej, berätta om huvudvärken.'), P('چند ماه است که هر هفته سردرد شدید یک‌طرفه دارم و نور اذیتم می‌کند.'),
    D('Mår du illa när det kommer?'), P('بله، حالت تهوع دارم و باید در اتاق تاریک دراز بکشم.'),
    D('Det låter som migrän. Neurologstatus är normalt.'),
    D('Du får sumatriptan 50 milligram, ta en tablett tidigt i anfallet, högst två per dygn.'),
    D('För huvudvärksdagbok så ses vi på återbesök om två månader.'), P('باشه، ممنون.'),
  ],
  'Somaliska: astma': [
    D('Hej, vad kan jag hjälpa dig med?'), P('Waxaan qabaa qufac iyo xiiq laabta ah habeenkii, gaar ahaan marka uu qabow yahay.'),
    D('Hur länge har du haft det?'), P('Ilaa saddex bilood. Marmarka neefta ayaa i dhegta.'),
    D('Jag hör lite pip på lungorna. Det kan vara astma.'),
    D('Jag skriver en remiss till spirometri med reversibilitetstest här på vårdcentralen.'),
    D('Du får Bricanyl Turbuhaler 0,5 milligram, en inhalation vid behov, högst sex per dygn.'),
    D('Sök vård direkt om du får svår andnöd som inte går över med medicinen.'),
  ],
  'Tigrinja: magsmärta': [
    D('Hej, berätta om magen.'), P('ኣብ ላዕለዋይ ክፋል ከብደይ ንሓደ ወርሒ ዝኸውን ዝሓርር ቃንዛ ኣለኒ።'),
    D('Är det värre när du är hungrig eller efter mat?'), P('ምስ ጠመኹ ይብርትዕ፣ ድሕሪ ምብላዕ ቁሩብ ይሓይሽ።'),
    D('Har du kräkts blod eller haft svart avföring?'), P('ኣይፋል፣ ከምኡ የለን።'),
    D('Jag skickar en labbremiss: Helicobacter pylori-antigen i avföring och blodstatus.'),
    D('Du får omeprazol 20 milligram en gång dagligen i fyra veckor. Jag ringer dig med provsvaren.'),
  ],
  'Kurdiska: ryggskott, dag 8-14': [
    D('Hej, hur är det med ryggen?'), P('هەفتەیەک لەمەوبەر لە کاتی هەڵگرتنی سندوقێک پشتم ئازاری گرت.'),
    D('Vad jobbar du med?'), P('لە کۆگا کار دەکەم و هەموو ڕۆژێک سندوقی قورس هەڵدەگرم.'),
    D('Framåtböjningen är nedsatt till 40 grader, Lasègue är negativ och neurologin är normal.'),
    D('Det är ett ryggskott. Du kan inte lyfta tungt än. Jag sjukskriver dig på heltid i en vecka till, så du har varit sjuk i två veckor totalt.'),
    D('Jag remitterar dig till fysioterapeut. Ta ibuprofen 400 milligram vid behov.'),
  ],
  'BKS: högt blodtryck': [
    D('Hej, sköterskan har mätt ditt blodtryck flera gånger.'), P('Da, rekli su mi da je pritisak visok. Ponekad me boli glava.'),
    D('Det är 162 över 98, även idag. Röker du?'), P('Ne, prestao sam prije pet godina.'),
    D('Jag skriver en labbremiss: kreatinin, natrium, kalium, lipidstatus och HbA1c, fastande.'),
    D('Du börjar med amlodipin 5 milligram en gång om dagen.'),
    D('Sköterskan kontrollerar blodtrycket om fyra veckor. Det kan bli lite svullet runt fotlederna.'),
  ],
  'Polska: handskada, röntgen + FK': [
    D('Hej, vad har hänt med handen?'), P('Przytrzasnąłem prawą rękę na budowie wczoraj. Jest spuchnięta i bardzo boli.'),
    D('Vad jobbar du med?'), P('Jestem robotnikiem budowlanym, noszę ciężkie rzeczy i używam narzędzi cały dzień.'),
    D('Det är svullnad och ömhet över femte mellanhandsbenet och nedsatt greppkraft.'),
    D('Jag skriver en röntgenremiss för höger hand, frågeställning fraktur i femte metakarpalbenet.'),
    D('Du kan inte greppa verktyg eller bära. Jag sjukskriver dig på heltid i tre veckor.'),
    D('Ta paracetamol 1 gram upp till tre gånger om dagen. Om röntgen visar fraktur remitterar vi till handkirurgen.'),
  ],
  'Turkiska: yrsel': [
    D('Hej, berätta om yrseln.'), P('İki haftadır ayağa kalktığımda başım dönüyor, bir kere neredeyse düşüyordum.'),
    D('Vilka mediciner tar du?'), P('Tansiyon için hidroklorotiyazid kullanıyorum.'),
    D('Blodtrycket är 132 liggande och 104 stående. Det är ett blodtrycksfall när du reser dig.'),
    D('Pausa hydroklortiazid. Jag skickar en labbremiss: blodstatus, natrium, kalium, kreatinin och B12.'),
    D('Res dig långsamt och drick ordentligt. Vi ses om två veckor.'),
  ],
  'Ukrainska: sömnproblem efter trauma': [
    D('Hej, hur sover du?'), P('Дуже погано. Мені сняться кошмари про війну, я прокидаюся кілька разів за ніч.'),
    D('Hur länge har det varit så?'), P('З того часу, як ми втекли, вже близько року.'),
    D('Har du tankar på att skada dig själv?'), P('Ні, таких думок немає.'),
    D('Det låter som posttraumatiskt stressyndrom. Jag skickar en remiss till psykolog för traumafokuserad KBT.'),
    D('Du kan ta melatonin 2 milligram en timme före sänggåendet. Vi ses om fyra veckor.'),
  ],
  'Finska: knäartros': [
    D('Hej, hur är det med knäna?'), P('Molempia polvia särkee kävellessä, varsinkin portaissa. Aamulla ne ovat jäykät noin puoli tuntia.'),
    D('Jag undersöker. Det knastrar i båda knäna och böjningen är lätt nedsatt.'),
    D('Det är knäartros. Den bästa behandlingen är träning, så jag skickar en remiss till fysioterapeut för artrosskola.'),
    P('Saanko jotain kipuun?'), D('Ta paracetamol 1 gram upp till tre gånger om dagen vid behov.'),
  ],
  'Meänkieli: diabeteskontroll': [
    D('Hej, välkommen på diabeteskontrollen.'), P('Hyvin mie olen pärjänny, mutta joskus mie unhotan ottaa tapletit.'),
    D('Ditt HbA1c är 58, det är nästan på målet. Fortsätt med metformin 1 gram två gånger om dagen.'),
    D('Jag skickar en labbremiss inför nästa kontroll: HbA1c, lipidstatus, kreatinin och urin-albumin.'),
    D('Sköterskan gör en fotundersökning om tre månader.'), P('Kiitos, se oon hyvä.'),
  ],
  'Nordsamiska: eksem': [
    D('Hej, vad gäller det?'), P('Mus lea sáhpánas ihtti gieđaid luovttain dálvvi rájes, ja dat gáskkiha olu.'),
    D('Det är ett torrt, rodnat eksem i armvecken.'),
    D('Du får betametason kräm, Betnovat, en gång om dagen i två veckor, sedan varannan dag i en vecka.'),
    D('Smörj mjukgörande kräm, Canoderm, dagligen även när det är bra.'), P('Giitu.'),
  ],
  'Romani: akut bronkit': [
    D('Hej, berätta om hostan.'), P('Kerdem kaśaj deś dives, palo e but šudrimos. Naj man tato.'),
    D('Lungorna låter normalt och syremättnaden är 98 procent.'),
    D('Det är en akut bronkit. Antibiotika hjälper inte, hostan kan sitta i några veckor.'),
    D('Drick varmt och vila. Sök vård igen om du får feber, andnöd eller hostar blod.'),
  ],
  'Jiddisch: fall och höftsmärta': [
    D('Hej, vad har hänt?'), P('איך בין געפֿאַלן אין דער היים נעכטן, און מײַן לינקע היפֿט טוט מיר וויי.'),
    D('Kan du gå?'), P('יאָ, אָבער נאָר מיט מײַן שטעקן.'),
    D('Det är ömhet över vänster höft men inget förkortat ben. Jag skriver en röntgenremiss för vänster höft.'),
    D('Ta paracetamol 1 gram tre gånger om dagen. Jag remitterar dig också till fysioterapeut för fallförebyggande träning.'),
  ],
});

// Several speakers: doctor, patient, a relative and a nurse (for testing speaker roles).
Object.assign(window.SUMMARIES, {
  'Efter stroke, med fru och sköterska': 'Uppföljning sex veckor efter lindrig stroke. Frun beskriver trötthet och glömska, sköterskan har mätt blodtryck 148/88. Atorvastatin höjs, remiss arbetsterapeut, sjukskriven 50 % i fyra veckor.',
});
Object.assign(window.SAMPLES, {
  'Efter stroke, med fru och sköterska': [
    L('Läkare', 'Hej Lars, och välkommen. Är det din fru som följer med idag?'),
    L('Anhörig', 'Ja, jag är hans fru. Jag ville följa med för han glömmer ofta vad som sägs.'),
    L('Läkare', 'Bra att du är med. Sköterskan har tagit några värden före besöket.'),
    L('Sjuksköterska', 'Blodtrycket var 148 över 88 i sittande, pulsen 72 och regelbunden. Han väger 84 kilo.'),
    L('Läkare', 'Tack. Lars, hur känns det sedan strokeen för sex veckor sedan?'),
    L('Patient', 'Det är okej, men jag blir så trött. Efter två timmar på jobbet orkar jag inte mer.'),
    L('Anhörig', 'Han har också svårt att komma ihåg saker. Han har glömt sina tabletter flera gånger och tappar tråden när vi pratar.'),
    L('Läkare', 'Vad jobbar du med, Lars?'),
    L('Patient', 'Jag är ekonomiassistent. Jag sitter vid datorn och stämmer av fakturor hela dagarna.'),
    L('Läkare', 'Kraften i armar och ben är normal och talet är klart. Du klarar MoCA-testet med 24 poäng, lite nedsatt uppmärksamhet och minne.'),
    L('Läkare', 'Vi höjer atorvastatin till 80 milligram en gång om dagen, och blodtrycket behöver ner. Sköterskan följer upp blodtrycket om två veckor.'),
    L('Läkare', 'Jag skickar en remiss till arbetsterapeut för bedömning av kognition och anpassning i arbetet.'),
    L('Läkare', 'Du klarar inte heltid med den här tröttheten. Jag sjukskriver dig på 50 procent i fyra veckor.'),
    L('Sjuksköterska', 'Jag kan ge er en dosett och ringa om två veckor för blodtryckskontrollen.'),
    L('Anhörig', 'Det vore jättebra, tack.'),
  ],
});

// DEMO: the first visit for the live demo (patient Michael Brown, P27, English-speaking, with an interpreter), dated 12 days back.
// It holds everything FK 7804 needs (occupation and tasks, diagnosis, measured findings, activity limitations tied to the job,
// treatment, sick-leave period), so a 40-second follow-up visit recorded live can produce a valid extended certificate.
const DEMO_KEY = 'Demo: Michael, första besöket (ryggskott, tolk)';
window.SAMPLE_META = Object.assign(window.SAMPLE_META || {}, { [DEMO_KEY]: { patient: 'P27', daysAgo: 12 } });
window.SAMPLE_LANGS = Object.assign(window.SAMPLE_LANGS || {}, { [DEMO_KEY]: 'sv+en' });
Object.assign(window.SUMMARIES, {
  [DEMO_KEY]: 'Engelsktalande undersköterska, besök med tolk. Lyfte en brukare i förrgår. Akut lumbago med ischias vänster: Lasègue positiv vänster vid 40 grader, framåtböjning till knäna, normal kraft och reflexer. Ibuprofen, remiss fysioterapeut, sjukskriven 100 % i tolv dagar.',
});
Object.assign(window.SAMPLES, {
  [DEMO_KEY]: [
    L('Läkare', 'Hej Michael, vad har hänt?'),
    L('Tolk', 'Hi Michael, what happened?'),
    L('Patient', 'I hurt my lower back two days ago when I lifted a resident at work. Since then the pain shoots down my left leg.'),
    L('Tolk', 'Han fick ont i ländryggen i förrgår när han lyfte en brukare på jobbet. Sedan dess strålar smärtan ner i vänster ben.'),
    L('Läkare', 'Vad jobbar du med?'),
    L('Tolk', 'What is your job?'),
    L('Patient', 'I work full time as an assistant nurse at a care home. I help the residents move, I shower them, make beds and lift a lot all day.'),
    L('Tolk', 'Han är undersköterska på ett äldreboende, heltid. Han hjälper brukarna att förflytta sig, duschar dem, bäddar sängar och lyfter mycket hela dagarna.'),
    L('Patient', 'I cannot bend forward, I cannot sit for more than fifteen minutes, and this morning I could not put on my socks.'),
    L('Tolk', 'Han kan inte böja sig framåt, kan inte sitta mer än en kvart och kunde inte ta på sig strumporna i morse.'),
    L('Läkare', 'Jag undersöker dig. Framåtböjningen är kraftigt nedsatt, fingertopparna når till knäna. Lasègue är positiv vänster vid 40 grader. Kraft, reflexer och känsel i benen är normala.'),
    L('Läkare', 'Det här är en akut lumbago med ischiassmärta. Med de fynden kan du inte förflytta brukare, lyfta eller hjälpa till i duschen, och du kan inte sitta längre stunder.'),
    L('Tolk', 'This is acute low back pain with sciatica. With these findings you cannot move residents, lift or help with showering, and you cannot sit for long.'),
    L('Läkare', 'Du får ibuprofen 400 milligram tre gånger om dagen i en vecka och en remiss till fysioterapeut. Jag sjukskriver dig på heltid i tolv dagar och vi ses innan den tar slut.'),
    L('Tolk', 'You get ibuprofen 400 milligrams three times a day for a week and a referral to a physiotherapist. You are on full sick leave for twelve days, and you will come back before it ends.'),
    L('Patient', 'Okay, thank you.'),
  ],
});
