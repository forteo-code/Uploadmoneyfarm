# Waar dit verkocht wordt, en hoe

Dit document zet op een rij wat er uit het haalbaarheidsonderzoek komt, wat daar
mijn eigen inschatting bij is, en wat er nog nagevraagd moet worden. Die drie zijn
uit elkaar gehouden, want ze zijn niet even hard.

## Het aanbod

> **Automatische inkomende factuurverwerking voor Moneybird en Exact Online.
> Vaste projectprijs €4.500. Levering binnen twee weken.**

Eén ding, één prijs, één termijn. Niet "AI-automatisering voor het MKB" — dat kopen
mensen niet omdat ze niet weten wat ze krijgen.

Uit het onderzoek: inkomende factuur- en bonverwerking scoort van alle onderzochte
diensten het hoogst op vraag, zit in de bandbreedte €4.500–€7.500, kost weinig
bouwtijd, en draait op API's (Moneybird, Exact Online) die goed genoeg
gedocumenteerd zijn om er in een week doorheen te zijn. Dat is de reden dat dit het
eerste product is en niet iets anders.

## Wat er nu staat, en wat dat waard is in een gesprek

Het onderzoek is expliciet over wat een koper nodig heeft voordat hij tekent: *een
werkende demonstratie van een vergelijkbare automatisering op een testomgeving met
herkenbare data*. Niet een deck, niet een referentie, een werkend ding.

Dat is precies wat er staat:

- Negen Nederlandse facturen van vijf verschillende sjablonen, met Nederlandse
  bedragen, Nederlandse btw-tarieven en Nederlandse identifiers.
- Vier daarvan bevatten een fout die een medewerker die het eindtotaal overtikt
  niet ziet, en die er in de demo binnen een seconde uit rolt met de reden erbij.
- De boeking die eruit komt is de payload die Moneybird en Exact daadwerkelijk
  verwachten, zichtbaar op het scherm.
- Draait op een laptop met `npm install && npm run build && node dist/server.js`,
  ook zonder internet en zonder API-sleutel.

De demonstratie die het gesprek wint is niet "kijk, hij leest de factuur". Iedereen
kan facturen lezen. Het is **`06-iban-advocaten.pdf`**: een factuur waarvan het
rekeningnummer niet bestaat, met "let op: gewijzigd rekeningnummer" eronder. Dat is
de factuur die betaald zou worden, en waar het geld niet meer terugkomt. Zet die als
tweede in de demo, meteen na een schone.

## De volgorde van een gesprek

1. Schone factuur. Gelezen, gecontroleerd, geboekt. Vijf seconden.
2. De IBAN-factuur. Niet geboekt, met de reden.
3. De rekenfout. €10 verschil op €3.326, over het hoofd te zien door iedereen.
4. *"Hoeveel inkomende facturen per maand?"* — en dan hun eigen factuur uploaden.

Stap 4 vereist een API-sleutel in de omgeving. Zonder sleutel draait de demo alleen
op de voorbeelden, en dat merkt de prospect.

## Wat het kost om te draaien

Geschat, niet gemeten, en dat verschil moet je niet wegpoetsen: een factuur van één
pagina is ruwweg 2.500 tokens invoer en 1.200 tokens uitvoer, wat op de huidige
tarieven neerkomt op ongeveer **4 eurocent per document**. Bij 500 facturen per maand
is dat €20 aan modelkosten.

Reken dat pas voor als het gemeten is met `node dist/cli.js --samples` met een echte
sleutel. De demo toont de werkelijke kosten per document zodra die er is.

De marge is niet het punt van de eerste klant. De eerste klant is er om te kunnen
zeggen dat er een eerste klant is.

## Hoe je aan die eerste klant komt — en hoe niet

**Dit is het onderdeel waarin ik eerder ongelijk had en dat rechtgezet moet worden.**
Ik heb eerder koude e-mailwerving aangeraden. Uit het onderzoek dat je aanleverde
blijkt dat dat voor een groot deel van de doelgroep niet mag.

Wat het onderzoek stelt, in mijn woorden:

- Artikel 11.7 Telecommunicatiewet behandelt eenmanszaken, ZZP'ers, VOF's en
  maatschappen voor het spamverbod als natuurlijke personen. Ongevraagde
  commerciële e-mail daarheen vereist toestemming of een bestaande klantrelatie.
- Rechtspersonen (BV, NV, stichting) vallen daar buiten, mits je hun openbaar
  gepubliceerde zakelijke contactgegevens gebruikt en elke mail een werkende
  afmeldmogelijkheid bevat.
- De ACM handhaaft dit met boetes die in theorie tot €900.000 kunnen oplopen.

**Laat dit door een jurist bevestigen voordat je één mail stuurt.** Ik heb dit uit
een onderzoeksrapport, niet uit de wet zelf, en het verschil tussen "mag met
voorwaarden" en "mag niet" is hier een boete.

De praktische consequentie voor de lijst die je opbouwt: filter op rechtspersoon.
Het KvK Handelsregister geeft de rechtsvorm, dus dat filter is te maken. Administratie-
en accountantskantoren zijn bovendien vaker BV dan eenmanszaak, wat gunstig uitkomt.

Wat sowieso mag, ongeacht rechtsvorm:

- **LinkedIn.** Een connectieverzoek en een gesprek vallen hier niet onder.
- **Bellen.** Zakelijke telefoonnummers mogen gebeld worden; het Bel-me-niet-register
  is per 2021 vervangen door het recht van bezwaar, maar zakelijke koude acquisitie
  per telefoon blijft toegestaan. Ook dit: laat het bevestigen.
- **Fysiek langsgaan.** Bij een administratiekantoor van vier man werkt dat beter dan
  je zou denken.
- **De partnerroute.** Zie hieronder; dit is de beste van de vier.

## De partnerroute

Een administratiekantoor met dertig MKB-klanten heeft dertig keer hetzelfde probleem.
Verkoop je aan het kantoor in plaats van aan de ondernemer, dan verkoop je één keer en
lever je dertig keer.

Dat is ook waar het aanbod het scherpst is: een administratiekantoor rekent per uur
voor het inboeken van facturen, en weet dus tot op de euro wat het nu kost. Bij een
MKB'er is het "gedoe"; bij een kantoor is het een regel op de kostenplaats.

De opening is de demo, niet een pitch. *"Ik heb iets gebouwd dat inkomende facturen
inleest en controleert vóór ze in Moneybird komen. Mag ik het je twintig minuten
laten zien? Neem twee facturen mee waar iets mis mee is."*

## WBSO

Uit het onderzoek: WBSO verlaagt de loonheffing voor ontwikkeluren aan een eigen,
herbruikbaar product met een technisch nieuw element, bij 500+ uur per jaar. Dit
project is precies zo'n product — een eigen codebase, niet klantspecifiek maatwerk.

Wat daarvoor nodig is en er nog niet is: een urenadministratie vanaf dag één, en een
aanvraag vóórdat de uren gemaakt worden. Terugwerkende kracht bestaat niet. Als dit
serieus wordt, is de aanvraag de eerstvolgende actie, niet een latere.

Ook hier: de precieze voorwaarden komen uit het rapport en niet uit de RVO-regeling
zelf. Controleer ze bij de bron voordat je erop rekent.

## Waar dit misgaat

Eerlijk, zodat het geen verrassing is:

- **De voorbeeldset is te makkelijk.** Digitaal gerenderde PDF's zijn de nette helft
  van de werkelijkheid. Een gefotografeerde, gekreukte bon van een tankstation is de
  andere helft, en die zit er nog niet in. De eerste prospect die een telefoonfoto
  uploadt, is de echte test.
- **Er wordt nog niets echt geboekt.** De koppeling met Moneybird en Exact is een
  payload, geen `POST`. Verkoop het niet alsof het al boekt. "De boeking staat klaar in
  de vorm die Moneybird verwacht; de koppeling zetten we bij jou live" is waar, en is
  genoeg.
- **Vier eurocent per document is een schatting.** Meet het voordat je het noemt.
- **Eén klant is geen bedrijf.** Het onderzoek dat je aanleverde noemt de markt
  marginaal. Dat betekent niet dat er geen eerste klant is; het betekent dat je moet
  weten of er een tweede en een derde zijn voordat je er iets op bouwt. Verkoop er
  drie voordat je conclusies trekt.
