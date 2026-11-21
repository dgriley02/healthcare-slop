# AI-stöd för läkarintyg och kliniskt efterarbete i Sverige

En kompakt sammanfattning av den svenska sjukskrivningsprocessen, kliniska scenarion samt hur en osynlig AI-assistent bör utformas för att maximera nyttan för läkaren.

---

## 1. Sjukskrivningsprocessen & Infrastruktur

* **Dag 1–7:** Sjukanmälan görs enbart till arbetsgivaren. Inget läkarintyg krävs normalt (undantag: krav på förstadagsintyg eller arbetssökande som anmäler till FK dag 1).
* **Dag 8–14:** Läkarintyg krävs för fortsatt sjuklön från arbetsgivaren. Skickas **inte** till Försäkringskassan (FK); patienten lämnar det till arbetsgivaren (diagnos kan döljas).
* **Från dag 15:** Arbetsgivaren sjukanmäler till FK. Patienten ansöker om sjukpenning och läkarintyg (**blankett FK 7804**) skickas till FK.
* **Teknisk överföring:** Sker digitalt via journalsystemet/Webcert och **Ineras Intygstjänst** efter signering med SITHS-kort. Intyget hamnar direkt i FK:s system samt under *Intyg* på **1177.se**.
* **AI:ns roll & begränsning:** Transporten är redan automatiserad – flaskhalsen är formuleringen. AI får **aldrig** fatta beslut eller signera självständigt, utan agerar beslutsstöd och utkastgenerator åt legitimerad läkare.

---

## 2. Kärnan i FK 7804: DFA-kedjan

För att undvika avslag eller kompletteringsbegäran från FK måste fritextfälten följa en strikt logik:
1. **D – Diagnos:** Medicinsk diagnos (ICD-10-kod).
2. **F – Funktionsnedsättning:** Läkarens *egna objektiva observationer/undersökningsfynd* (t.ex. *"Nedsatt rörlighet i ländrygg"* – **aldrig** enbart *"Patienten uppger att..."*).
3. **A – Aktivitetsbegränsning:** Hur funktionsnedsättningen konkret hindrar patienten från att utföra sina specifika arbetsuppgifter.

---

## 3. Relationen mellan besök och intyg (4 typfall)

Det finns ingen formell "ansökan" om intyg före besök; intyget är resultatet av en medicinsk bedömning. Systemet måste därför hantera både **besöksdrivna** och **behovsdrivna (asynkrona)** ingångar:

| Scenario | Klinisk regel & hantering | AI-lösningens agerande |
| :--- | :--- | :--- |
| **1. Tackar nej på besöket, ångrar sig 2 dagar senare** | Inget nytt fysiskt besök krävs. Läkaren kan utfärda intyg baserat på den färska journalanteckningen + kort telefonkontakt (daterat från besöksdagen). | Hämtar statusfynd från journalen 48h tidigare + patientens chattmeddelande och lägger ett färdigt intygsutkast i läkarens signeringskorg. |
| **2. Försämring 5 dagar efter besök** | Äldre journalstatus räcker ej då sjukdomsbilden ändrats. Kräver ny bedömning via video/telefon eller fysiskt besök. | Flaggar att ny medicinsk bedömning krävs och förbereder underlag inför telefon-/videomöte. |
| **3. Söker vård i efterhand ("Retroaktivt")** | Läkare är mycket restriktiva. FK godkänner normalt inte sjukskrivning före första vårdkontakt (undantag: svår sjukdom/akutvård). | Varnar om retroaktivitet och efterfrågar eventuella akutjournaler eller medicinska skäl till sen kontakt. |
| **4. Förlängning av pågående sjukskrivning** | Fysiskt besök behövs sällan om vårdplanen följs. Sker via telefon/digital avstämning. | Ställer 3–4 kontrollfrågor till patienten, uppdaterar texten från föregående intyg med nya datum och skapar utkast. |

---

## 4. Läkarens efterarbete (ordnat efter frekvens)

För att vara "osynlig" bör AI-tjänsten inte vara ett separat intygsverktyg, utan fånga hela efterarbetet från ett och samma samtal:

1. **Journalanteckning & kodning (~100 %):** Strukturerad journaltext (*Anamnes, Status, Bedömning, Plan*) + ICD-10- och KVÅ-koder.
2. **Läkemedelsförskrivning (~50–70 %):** Extraherar preparat, styrka och dosering till färdiga receptutkast.
3. **Prover & undersökningar (~40–50 %):** Förbereder labbremisser (t.ex. blodstatus, CRP) och röntgenremisser med frågeställning.
4. **Uppföljning & bokning (~30–40 %):** Skapar åtgärdslista/bevakning till vårdadministratör (t.ex. *"Telefontid om 2 veckor"*).
5. **Remisser (~15–25 %):** Sammanställer anamnes, status och frågeställning till specialistvård eller rehab (fysioterapeut/arbetsterapeut).
6. **Patientinformation (~15–25 %):** Genererar begripliga egenvårdsråd och varningssignaler att skicka via 1177.
7. **Intyg & utlåtanden (~10–15 %):** FK 7804 (sjukpenning), VAB-intyg, LUH (vid långtidssjukskrivning) samt körkorts-/reseintyg.

---

## 5. Rekommenderad produktarkitektur ("Osynligt flöde")

* **Pre-visit (Valfri chatt):** Patienten beskriver sitt yrke, arbetsuppgifter och hinder via länk före besök (eller vid asynkron förfrågan).
* **In-visit (Ambient Scribe):** AI:n lyssnar i bakgrunden och separerar patientens berättelse (*anamnes*) från läkarens fynd (*status*).
* **Post-visit (Dynamiska "Action Cards"):** Baserat på vad som faktiskt sades presenteras klickbara kort efter besöket:
  * *Alltid:* `[Journalanteckning + ICD-10]`
  * *Vid behov:* `[Receptutkast]` | `[Labbremiss]` | `[FK 7804: Utkast]` | `[Patientsammanfattning]`
* **Pre-flight check & injicering:** AI:n kontrollerar DFA-logik och sjukskrivningslängd mot Socialstyrelsens försäkringsmedicinska beslutsstöd, och fyller automatiskt i fälten i Webcert/journalsystemet inför läkarens SITHS-signering.