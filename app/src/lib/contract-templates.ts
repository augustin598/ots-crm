export interface ContractClause {
	number: string;
	title: string;
	paragraphs: string[];
}

export const DEFAULT_TEMPLATE_NAME = 'Prestări Servicii Informatice';

/**
 * Returns the default contract clauses (sections 1-23) for a
 * "Contract de Prestări Servicii Informatice".
 *
 * All sections are data-driven — the PDF generator renders them from this JSON.
 * Section 3 is special: the PDF generator injects the pricing table between
 * the section heading and the paragraphs.
 *
 * Special paragraph conventions:
 *   [center]text  – renders the paragraph centered (e.g. "și" separator)
 *
 * Placeholders available in paragraphs:
 *   Tenant:  {tenantName}, {tenantCui}, {tenantTradeRegister}, {tenantIban},
 *            {tenantIbanEuro}, {tenantBankName}, {tenantAddress}, {tenantCity},
 *            {tenantCounty}, {tenantPhone}, {tenantEmail}, {tenantLegalRepresentative}
 *   Client:  {clientName}, {clientCui}, {clientTradeRegister}, {clientIban},
 *            {clientBankName}, {clientAddress}, {clientCity}, {clientCounty},
 *            {clientPostalCode}, {clientPhone}, {clientEmail}, {clientLegalRepresentative}
 *   Contract:{contractDurationMonths}, {penaltyRate}, {prestatorEmail},
 *            {beneficiarEmail}, {hourlyRate}, {hourlyRateCurrency}, {contractDate},
 *            {paymentTermsDays}, {currency}, {billingFrequency}, {discountPercent},
 *            {discountedTotal}, {serviceDescription}
 */
export function getDefaultContractClauses(): ContractClause[] {
	return [
		{
			number: '1',
			title: 'Părțile contractante',
			paragraphs: [
				'1.1. **{tenantName}**, înregistrată la Oficiul Registrului Comerțului **{tenantCounty}**, având CUI **{tenantCui}** și numărul de înregistrare **{tenantTradeRegister}**, cu sediul social în municipiul **{tenantCity}**, **{tenantAddress}**, județul **{tenantCounty}**, cont bancar **{tenantIban}** deschis la **{tenantBankName}**, date de contact: telefon **{tenantPhone}**, reprezentată de administratorul **{tenantLegalRepresentative}**, în calitate de Prestator, pe de o parte,',
				'[center]și',
				'1.2. **{clientName}**, cu sediul în {clientCity}, Strada **{clientAddress}**, cod poștal **{clientPostalCode}**, având cod fiscal **{clientCui}** cu numărul de înregistrare **{clientTradeRegister}** și cont bancar **{clientIban}**, deschis la **{clientBankName}**, date de contact: telefon **{clientPhone}**, e-mail **{clientEmail}**, reprezentată de **{clientLegalRepresentative}**, cu funcția de **Administrator**, în calitate de Beneficiar, pe de altă parte, au convenit să încheie prezentul contract de prestări servicii, în conformitate cu următoarele clauze.'
			]
		},
		{
			number: '2',
			title: 'Scopul și obiectul contractului',
			paragraphs: [
				'{serviceDescription}',
				'[if:offerLink]• Oferta comercială detaliată poate fi consultată la adresa: **{offerLink}**',
				'• Orice modificare ulterioară a conținutului ofertei publicate la acest link nu va produce efecte asupra prezentului contract, decât dacă este acceptată în scris de ambele părți.'
			]
		},
		{
			number: '3',
			title: 'Prețul contractului',
			paragraphs: [
				'3.1 Prețul contractului reprezintă valoarea totală a serviciilor prestate pe întreaga durată a contractului.',
				'3.2 Tariful stabilit pentru executarea contractului, pe care Beneficiarul îl va achita Prestatorului, este de **{totalWithTVA} {currency} (inclusiv TVA {tvaRate}%)**, plata efectuându-se în lei la cursul BNR din ziua emiterii facturii.',
				'3.3 În cazul neplății unei facturi la termen, **{tenantName}** are dreptul de a solicita Beneficiarului **penalități de întârziere de {penaltyRate}% pe zi** calendaristică din valoarea facturii respective.',
				'3.4 Prețul pentru serviciile contractate a fost stabilit de comun acord de către ambele Părți contractante și poate fi modificat numai prin acordul scris al ambelor Părți.',
				'3.5 Plata trebuie efectuată în termen de **{paymentTermsDays} zile** lucrătoare de la primirea facturii, prin ordin de plată (transfer bancar).',
				'3.6 Plata va fi efectuată în întregime.',
				'3.7 Plata se va efectua în lei sau euro în funcție de moneda facturii, în contul bancar al Prestatorului deschis la {tenantBankName}:',
				'• Pentru plăți în lei: IBAN {tenantIban}',
				'• Pentru plăți în euro: IBAN {tenantIbanEuro}'
			]
		},
		{
			number: '4',
			title: 'Durata contractului',
			paragraphs: [
				'4.1 Prezentul contract intră în vigoare la data semnării de către ambele părți și rămâne valabil până la finalizarea completă a serviciilor contractate, respectiv livrarea setup-ului Google Ads conform specificațiilor din ofertă.',
				'4.2 Durata minimă a contractului este de minim **{contractDurationMonths} luni**, începând cu data semnării de către ambele părți. La expirarea acestei perioade, contractul se prelungește automat pentru perioade succesive egale. Factura se emite în prima zi a perioadei de facturare, iar plata pentru serviciile contractate va fi efectuată în avans. Pentru facturarea lunară, factura se emite în data de 1 a fiecărei luni, acoperind serviciile care urmează să fie prestate în luna respectivă.'
			]
		},
		{
			number: '5',
			title: 'Documentele contractului',
			paragraphs: [
				'5.1. Documentele contractului, sunt: prezentul contract, oferta comerciala, cerere din partea beneficiarului sau cerere din partea Beneficiarului, alte documente cu caracter contractual concomitente sau subsecvente semnării contractului'
			]
		},
		{
			number: '6',
			title: 'Obligațiile furnizorului',
			paragraphs: [
				'6.1 SC {tenantName} se obligă să presteze serviciile contractate, conform cerințelor Beneficiarului.',
				'6.2. Prestatorul are obligația la executarea întocmai și la timp a obligațiilor contractuale asumate prin prezentul contract.'
			]
		},
		{
			number: '7',
			title: 'Obligațiile beneficiarului',
			paragraphs: [
				'7.1 Beneficiarul se angajează să furnizeze Prestatorului datele de autentificare necesare pentru accesul la directorul rădăcină al site-ului și la baza de date aferentă acestuia.',
				'7.2 La solicitarea Prestatorului, Beneficiarul are obligația de a transmite informații, documente și alte materiale necesare pentru completarea tuturor secțiunilor inițiale obligatorii.',
				'7.3 Este strict interzisă închirierea sau vânzarea serviciilor contractate către terți, sub sancțiunile prevăzute în prezentul contract.',
				'7.4 Orice reclamație privind serviciile web sau facturarea acestora va fi adresată Serviciului Clienți al SC {tenantName}. Depunerea unei reclamații nu îl exonerează pe Beneficiar de obligația de a achita plățile datorate.',
				'7.5 Beneficiarul se obligă să furnizeze Prestatorului toate informațiile solicitate, pe care acesta le consideră necesare pentru îndeplinirea contractului. În cazul în care Beneficiarul nu furnizează informațiile necesare într-un termen de 5 zile lucrătoare de la solicitarea acestora, Prestatorul are dreptul de a suspenda serviciile până la primirea datelor solicitate, fără ca aceasta să afecteze obligațiile de plată ale Beneficiarului.'
			]
		},
		{
			number: '8',
			title: 'Sancțiuni pentru neîndeplinirea culpabilă a obligațiilor',
			paragraphs: [
				'8.1. In cazul in care din vina sa exclusiva, prestatorul nu reușește să-și respecte obligațiile asumate prin prezentul contract, se va deduce din valoarea facturii, o suma procentuala, reprezentand penalitati pentru obligațiile neîndeplinite.',
				'8.2. Beneficiarul își rezerva dreptul de a renunța oricând la contract, printr-o notificare scrisă adresată furnizorului, fara nici o compensatie, dacă acesta din urma da faliment, cu condiția ca aceasta anulare sa nu afecteze dreptul furnizorului la acțiunea în despăgubire pentru serviciile prestate.'
			]
		},
		{
			number: '9',
			title: 'Încetarea contractului',
			paragraphs: [
				'9.1 Prezentul contract, poate înceta în următoarele cazuri:',
				'9.2 Prin acordul părților;',
				'9.3 Prin denuntare unilaterala din partea SC {tenantName}, fără preaviz și drept de compensatii sau despăgubiri în următoarele situații:\n   - dacă Clientul vinde sau subinchiriaza serviciile oferite de către Prestator;',
				'9.4 Având în vedere că obiectul prezentului contract îl reprezintă o prestare unică de servicii, acesta se consideră încheiat la data livrării setup-ului și a achitării integrale a facturii corespunzătoare.',
				'9.5 Încetarea contractului nu aduce atingere obligațiilor scadente născute până la data încetării.',
				'9.6 Dacă se majorează tarifele abonamentului de furnizare serviciilor WEB contractate, caz în care Clientul are la dispoziție 10 zile calendaristice pentru a aduce la cunostinta SC {tenantName}, intenția de încetare a contractului. La expirarea acestei perioade, noile tarife se considera irevocabil acceptate.',
				'9.7 În cazul în care contractul încetează înainte de perioada contractuala stabilita de parti, din cauza nerespectării de către Client a prevederilor contractuale, Clientul va fi obligat la plata de despăgubiri către SC {tenantName}, care constau în contravaloarea abonamentului de servicii WEB contractat de catre Client, înmulțit cu numărul perioadelor de facturare rămase până la expirarea perioadei contractuale convenite.',
				'9.8 Încetarea contractului nu produce efecte asupra obligatiilor scadente rezultate din încetarea prezentului contract',
				'9.9 În cazul în care contractul se reziliază prin ajungerea la termen, se considera reziliat numai după plata tuturor obligatiilor, în condițiile arătate în prezentul contract.'
			]
		},
		{
			number: '10',
			title: 'Metode de notificare',
			paragraphs: [
				'10.1 Pentru realizarea notificărilor se vor folosi cu precădere adresele de poștă electronică indicate în cele ce urmează:',
				'10.2 Adresa de poștă electronică a prestatorului pentru trimiterea și recepționarea notificărilor este: **{prestatorEmail}**',
				'10.3 Adresa de poștă electronică a beneficiarului pentru trimiterea și recepționarea notificărilor este: **{beneficiarEmail}**',
				'10.4 Notificările transmise prin e-mail sunt considerate valabile și produc efecte legale, fără a necesita confirmarea explicită a primirii, exceptând cazurile în care se solicită expres confirmarea scrisă. Orice modificare a adresei de e-mail a uneia dintre părți trebuie comunicată celeilalte părți în termen de 3 zile lucrătoare.'
			]
		},
		{
			number: '11',
			title: 'Forța majoră',
			paragraphs: [
				'11.1 Forța majoră este un eveniment mai presus de controlul părților, care nu se datorează greșelii sau vinei acestora, care nu putea fi prevăzut la momentul încheierii prezentului contract și care face imposibilă executarea și îndeplinirea contractului;(calamități, războaie, etc).',
				'11.2 Forța majoră este constatată de o autoritate competentă.',
				'11.3 Forța majoră exonerează părțile contractante de îndeplinirea obligațiilor asumate prin prezentul contract, pe toată perioada în care aceasta acționează.',
				'11.4 Îndeplinirea contractului va fi suspendată în perioada de acțiune a forței majore, dar fără a prejudicia drepturile ce li se cuveneau părților până la apariția acesteia.',
				'11.5 Partea contractantă care invocă forța majoră are obligația de a notifica celeilalte părți, în maxim 3 zile, în mod complet, producerea acesteia și să ia orice măsuri care îi stau la dispoziție în vederea limitării consecințelor.'
			]
		},
		{
			number: '12',
			title: 'Soluționarea litigiilor',
			paragraphs: [
				'12.1 Beneficiarul și prestatorul vor depune toate eforturile pentru a rezolva pe cale amiabila, prin tratative directe, orice neintelegere sau disputa care se poate ivi între ei în cadrul sau în legătură cu îndeplinirea contractului.',
				'12.2 Dacă după 15 zile de la începerea tratativelor neoficiale, Beneficiarul și Prestatorul nu reușesc sa rezolve în mod amiabil o divergenta contractuala, fiecare poate solicita ca disputa se se soluționeze de către instanțele judecatoresti de la sediul prestatorului.'
			]
		},
		{
			number: '13',
			title: 'Limba care guvernează contractul',
			paragraphs: [
				'13.1 Limba care guvernează contractul, este limba romana. Comunicarea de orice natura, destinate optimizării colaborării dintre furnizor și client se fac în limba romana. Orice comunicare între părți va trebui sa fie făcută doar în scris, înregistrat atât în momentul transmiterii cât și în momentul primirii.'
			]
		},
		{
			number: '14',
			title: 'Comunicarea intre partile contractante',
			paragraphs: [
				'14.1 Comunicarile dintre parti se pot face și prin telefon, email sau Whatsapp în toate zilele saptamanii de luni pana vineri de la orele 9:00 pana la ora 17:00.'
			]
		},
		{
			number: '15',
			title: 'Despre obligația de confidențialitate',
			paragraphs: [
				'15.1 Părțile contractante se obligă să păstreze secretul privind toate informațiile și documentațiile de care au luat la cunoștință în cursul derulării prezentului contract, să nu le divulge terților și să păstreze secretul comercial, astfel încât să nu prejudicieze cu nimic cealaltă parte.',
				'15.2 Părțile contractante vor păstra în strictă confidențialitate toate datele și informațiile comerciale cu privire la prețuri, baze de date utilizate, logistică utilizată, etc, orice dezvăluire a acestor informații de către o parte contractantă care pot leza interesele celeilalte părți, poate atrage răspunderea părții implicate în instanță, cu recuperarea pagubelor create de către partea lezată.',
				'15.3 Excepție de la această clauză o constituie acordul părții contractante și informațiile notorii precum ofertele publice și promoțiile comerciale ale prestatorului.',
				'15.4 Încălcarea de către oricare dintre părți a obligației de confidențialitate, va da naștere, în sarcina părții aflate în culpă, a unei obligații de plată, cu titlul de clauză penală, sumelor avansate de către cealaltă parte, până la momentul respectiv, care se va cumula cu despăgubirile efective pentru prejudiciul suferit.',
				'15.5 Beneficiarul nu are dreptul să ofere acces terților la website, conturile de publicitate sau alte servicii contractate, pe durata contractului, fără acordul prealabil scris al Prestatorului sau înainte de rezilierea acestuia.'
			]
		},
		{
			number: '16',
			title: 'Servicii suplimentare opționale',
			paragraphs: [
				'16.1 La solicitarea beneficiarului, prestatorul poate să îi acorde și servicii de mentenanță sau administrare web, pentru un preț suplimentar.',
				'16.2 Prețul suplimentar va fi stabilit având ca bază de calcul tariful orar de **{hourlyRate} {hourlyRateCurrency} / oră (inclusiv TVA)**, calculat în funcție de sarcinile ce urmează să fie îndeplinite la cererea beneficiarului.',
				'16.3 Dacă serviciile suplimentare opționale descrise în alineatul anterior se vor solicita ulterior încheierii prezentului contract, prestarea acestora se va face ulterior încheierii unui Act Adițional în acest sens.'
			]
		},
		{
			number: '17',
			title: 'Drepturile de autor și accesul la conturile de publicitate',
			paragraphs: [
				'17.1. Drepturile de autor asupra materialelor create de {tenantName}\n{tenantName} deține toate drepturile de autor asupra materialelor realizate în cadrul prezentului contract, inclusiv, dar fără a se limita la, campanii publicitare, imagini, videoclipuri, conținut creativ și audiențe asociate acestora, conform prevederilor Legii nr. 8/1996 privind dreptul de autor și drepturile conexe.',
				'17.2. Cedarea drepturilor patrimoniale de autor\nDrepturile patrimoniale asupra materialelor create de {tenantName} pot fi transferate către Beneficiar doar printr-un acord scris, explicit, și contra unei compensații stabilite de comun acord. Cedarea acestor drepturi se realizează doar printr-un act adițional semnat de ambele părți, care va preciza în mod clar obiectul cedării și condițiile acesteia.',
				'17.3. Opțiunea de cumpărare a drepturilor de autor\nBeneficiarul poate solicita transferul drepturilor patrimoniale de autor asupra materialelor create, printr-un act adițional, contra unei taxe echivalente cu x% din valoarea contractului sau cu o sumă fixă prestabilită.',
				'17.4. Limitarea drepturilor Beneficiarului\nBeneficiarul nu dobândește automat niciun drept asupra materialelor create, decât dacă acest lucru a fost convenit expres în scris. Beneficiarul nu poate modifica, reproduce, distribui sau reutiliza materialele create de {tenantName} fără acordul scris al acestuia.',
				'17.5. Accesul la conturile de publicitate\nDacă Prestatorul creează conturile de publicitate pe platforme precum Google Ads, Facebook Ads, TikTok Ads sau altele similare, acestea rămân în proprietatea și sub controlul exclusiv al {tenantName}. Beneficiarul nu va avea acces direct la aceste conturi, campanii, audiențe sau alte setări, decât dacă părțile convin altfel în scris.',
				'17.6. Condiții de acces după rezilierea contractului\nBeneficiarul își pierde automat accesul la toate materialele și conturile gestionate de {tenantName}. Excepție fac situațiile în care s-a stabilit altfel printr-un acord scris. Dacă Beneficiarul a suportat integral costurile campaniilor publicitare, {tenantName} va furniza Beneficiarului un raport detaliat al performanțelor campaniei, cu condiția achitării tuturor obligațiilor contractuale.\nDupă rezilierea contractului, Beneficiarul nu va primi acces la audiențele personalizate, strategia de marketing utilizată și audiențele folosite în cadrul campaniilor desfășurate. {tenantName} va ceda accesul Beneficiarului la conturile de publicitate utilizate, inclusiv Google Ads, Facebook Ads și alte platforme relevante, numai după achitarea integrală a tuturor facturilor restante. Acest transfer de acces se va realiza în termen de 7 zile lucrătoare de la confirmarea achitării integrale a datoriilor contractuale.',
				'17.7. Restricționarea accesului din cauza neplății\nÎn cazul neachitării obligațiilor financiare, Prestatorul va notifica Beneficiarul și îi va acorda un termen de 10 zile pentru remedierea situației înainte de a restricționa accesul la materialele și conturile publicitare.',
				'17.8. Sancțiuni pentru utilizarea neautorizată\nUtilizarea neautorizată a materialelor create de {tenantName}, fără acordul scris al acestuia, atrage răspunderea Beneficiarului pentru prejudiciile cauzate, inclusiv suportarea daunelor-interese și a altor măsuri legale. {tenantName} își rezervă dreptul de a iniția acțiuni legale pentru protejarea drepturilor sale și recuperarea pierderilor cauzate.',
				'17.9. Dispoziții suplimentare\nOrice modificare sau extindere a drepturilor de autor și accesului la materialele contractate trebuie stabilită printr-un act adițional semnat de ambele părți.'
			]
		},
		{
			number: '18',
			title: 'Garanția serviciilor oferite',
			paragraphs: [
				'18.1. Prestatorul garantează că serviciile prestate respectă cerințele Beneficiarului și bunele practici în domeniu. În cazul unor erori sau neconformități ale serviciilor, Prestatorul se obligă să le corecteze fără costuri suplimentare, în termen de 5 zile de la notificarea scrisă a Beneficiarului.'
			]
		},
		{
			number: '19',
			title: 'Protecția datelor personale (GDPR)',
			paragraphs: [
				'19.1. Părțile se obligă să respecte prevederile GDPR privind protecția datelor personale. {tenantName} va prelucra datele Beneficiarului exclusiv în scopul executării contractului și nu le va divulga către terți, cu excepția cazului în care există o obligație legală.'
			]
		},
		{
			number: '20',
			title: 'Limitarea răspunderii Prestatorului',
			paragraphs: [
				'20.1. Prestatorul nu va fi răspunzător pentru pierderi financiare suferite de Beneficiar ca urmare a modificărilor efectuate de platforme terțe (Google, Facebook, etc.), probleme tehnice sau atacuri cibernetice asupra infrastructurii acestora. De asemenea, Prestatorul nu poate fi tras la răspundere pentru modificările de algoritmi ai platformelor de publicitate care pot influența performanța campaniilor desfășurate.'
			]
		},
		{
			number: '21',
			title: 'Încetarea contractului în caz de forță majoră',
			paragraphs: [
				'21.1. Dacă situația de forță majoră durează mai mult de 60 de zile și împiedică executarea obligațiilor contractuale, fiecare parte poate solicita încetarea contractului fără penalități.'
			]
		},
		{
			number: '22',
			title: 'Suport tehnic și actualizări',
			paragraphs: [
				'22.1. Prestatorul va oferi Beneficiarului suport tehnic de bază pentru implementarea serviciilor contractate, fără costuri suplimentare. Pentru cereri suplimentare care necesită modificări complexe sau mentenanță, Prestatorul poate percepe o taxă suplimentară, stabilită printr-un act adițional.'
			]
		},
		{
			number: '23',
			title: 'Mențiuni finale',
			paragraphs: [
				'23.1. Orice solicitare din partea beneficiarului privind modificarea circumstanțelor apărute după semnarea contractului poate fi acceptată și soluționată doar prin act adițional, în care vor fi specificate implicațiile asupra desfășurării contractului.',
				'23.2. Prezentul contract a fost încheiat la data de **{contractDate}**, în două exemplare electronice (.pdf), câte unul pentru fiecare parte. Fiecare parte va tipări contractul, îl va semna (preferabil pe fiecare pagină), va înscrie data semnării și va transmite varianta semnată și scanată celorlalte părți. În acest mod, fiecare parte va deține un original cu propria semnătură și o copie scanată cu semnătura celeilalte / celorlalte părți.',
				'23.3. Contractul la distanță este considerat încheiat în momentul în care ambele părți l-au semnat și transmis reciproc exemplarele semnate.'
			]
		}
	];
}
