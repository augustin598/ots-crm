/**
 * Pure Romanian copy helpers for ad-account status surfaces.
 *
 * Shared between the client-side Svelte alert card and the server-side
 * email digest so the wording and actionable suggestions stay identical
 * across channels. No dependencies — safe to import from both browser
 * and server code.
 */

export interface StatusDetails {
	headline: string;
	body: string;
	suggestion: string;
	deadline: string | null;
}

export interface DescribeStatusInput {
	provider: 'meta' | 'google' | 'tiktok';
	paymentStatus: 'ok' | 'grace_period' | 'risk_review' | 'payment_failed' | 'suspended' | 'closed';
	/** Secondary reason (e.g., 'budget_exceeded' / 'no_delivery' for TikTok health override). */
	rawDisableReason: string | null;
	/** TikTok only: parsed human message from rejection_reason. */
	rejectReasonMessage: string | null;
	/** TikTok only: parsed endtime from rejection_reason. */
	rejectReasonEndsAt: string | null;
	/** Google only: `customer.suspension_reasons` enum names (uppercase). */
	googleSuspensionReasons?: string[] | null;
	/** Provider-native primary status code (Meta numeric account_status as string, etc.). Used by Meta branch. */
	rawStatusCode?: string | null;
}

/**
 * Parse TikTok `rejection_reason` string into structured pieces.
 * Shape observed 2026-04-24: `1:<message>,endtime:2035-09-03 15:25:11`.
 * Returns null for null/empty; falls back to the raw string as message if
 * the format doesn't match (forward-compat with TikTok format changes).
 */
export function parseTikTokRejectReason(raw: string | null): {
	message: string;
	endsAt: string | null;
} | null {
	if (!raw) return null;
	const endMatch = raw.match(/,endtime:(.+?)$/);
	const endsAt = endMatch ? endMatch[1].trim() : null;
	const withoutEnd = endMatch && endMatch.index != null ? raw.slice(0, endMatch.index) : raw;
	const codeMatch = withoutEnd.match(/^\d+:(.+)$/);
	const message = codeMatch ? codeMatch[1].trim() : withoutEnd.trim();
	return { message, endsAt };
}

/**
 * RO translation + actionable suggestion for a single Google Ads
 * `customer.suspension_reasons` enum value. Unknown codes fall through to
 * a generic "motiv nespecificat" + "deschide ticket support" suggestion.
 */
export function translateGoogleSuspensionReason(reason: string): {
	label: string;
	suggestion: string;
} {
	switch (reason) {
		case 'UNPAID_BALANCE':
			return {
				label: 'Sold neachitat',
				suggestion:
					'Deschide Google Ads → Billing → Summary și achită soldul restant pentru a relua livrarea reclamelor.',
			};
		case 'SUSPICIOUS_PAYMENT_ACTIVITY':
			return {
				label: 'Activitate de plată suspicioasă',
				suggestion:
					'Verifică metoda de plată în Google Ads → Billing, confirmă proprietatea cardului, contactează suportul dacă persistă.',
			};
		case 'CIRCUMVENTING_SYSTEMS':
			return {
				label: 'Eludarea sistemelor Google',
				suggestion:
					'Suspendare gravă pentru încercarea de a eluda politicile Google Ads. Depune un recurs oficial prin Google Ads Help Center și pregătește documentație care demonstrează conformitate cu politicile.',
			};
		case 'MISREPRESENTATION':
			return {
				label: 'Reprezentare falsă a afacerii',
				suggestion:
					'Google a identificat informații false sau inexacte despre afacere. Dacă datele din Google Ads sunt corecte, deschide un apel oficial prin Google Ads Help Center, cu documente de identitate a firmei.',
			};
		case 'UNACCEPTABLE_BUSINESS_PRACTICES':
			return {
				label: 'Practici comerciale inacceptabile',
				suggestion:
					'Revizuiește reclamele și landing page-ul conform politicilor Google Ads (înșelăciune utilizatori, taxe ascunse). Depune appeal după remediere.',
			};
		case 'UNAUTHORIZED_ACCOUNT_ACTIVITY':
			return {
				label: 'Activitate neautorizată',
				suggestion:
					'Schimbă parola Google imediat, activează 2FA, revocă accesul utilizatorilor suspecți din Google Ads → Access & security.',
			};
		default:
			return {
				label: 'Motiv nespecificat',
				suggestion: 'Deschide un ticket în Google Ads Support pentru detalii despre suspendare.',
			};
	}
}

/**
 * Combine multiple suspension reasons into one details block: labels joined
 * with " · ", suggestion taken from the first (most relevant) reason. Returns
 * null for empty/null input.
 */
export function translateGoogleSuspensionReasons(
	reasons: string[] | null,
): { label: string; suggestion: string } | null {
	if (!reasons || reasons.length === 0) return null;
	const translated = reasons.map(translateGoogleSuspensionReason);
	return {
		label: translated.map((r) => r.label).join(' · '),
		suggestion: translated[0].suggestion,
	};
}

/**
 * RO translation + actionable suggestion for a single Meta `disable_reason`
 * numeric code (string form, e.g. "1"). Returns null for "0"/null/empty (no
 * override — caller falls back to translateMetaAccountStatus or generic copy).
 * Unknown non-zero codes return a generic "Motiv nespecificat" fallback AND
 * emit a console.warn for forward-compat surfacing of new Meta enums.
 */
export function translateMetaDisableReason(code: string | null): {
	label: string;
	suggestion: string;
} | null {
	if (code == null || code === '0' || code === '') return null;
	switch (code) {
		case '1':
			return {
				label: 'Încălcare politici reclame',
				suggestion:
					'Verifică Meta Business Suite → Account Quality, revizuiește reclamele respinse și depune appeal pentru fiecare.',
			};
		case '2':
			return {
				label: 'Verificare proprietate intelectuală',
				suggestion:
					'Meta verifică drepturi IP pe creative. Pregătește dovezi (facturi, contracte, licențe) pentru orice marcă, imagine sau material folosit în reclame, în caz de appeal.',
			};
		case '3':
			return {
				label: 'Risc de plată detectat',
				suggestion:
					'Verifică metoda de plată în Meta → Billing. Confirmă proprietatea cardului și actualizează dacă e expirat.',
			};
		case '4':
			return {
				label: 'Cont oprit (suspect duplicate/abuz)',
				suggestion:
					'Cont oprit — probabil duplicate sau abuz detectat de Meta. Contactează Meta Business Support pentru detalii și appeal.',
			};
		case '5':
			return {
				label: 'Cont reclame dezactivat',
				suggestion:
					'Meta a dezactivat contul de reclame. Deschide ticket prin Meta Business Suite → Help & Support pentru appeal.',
			};
		case '6':
			return {
				label: 'Business Manager dezactivat',
				suggestion:
					'Întregul Business Manager e dezactivat. Verifică emailurile de la Meta și depune appeal cât mai repede prin Help Center.',
			};
		case '7':
			return {
				label: 'Cont afiliat dezactivat',
				suggestion:
					'Contul afiliat al organizației a fost dezactivat. Contactează Meta Partner Support pentru detalii.',
			};
		case '8':
			return {
				label: 'Sold restant neachitat',
				suggestion:
					'Reclamele sunt blocate până achiti soldul restant. Deschide Meta → Billing → Payment Settings și plătește pentru a relua livrarea.',
			};
		case '9':
			return {
				label: 'Permisiuni revocate',
				suggestion:
					'Permisiunile pe contul de reclame au fost revocate. Verifică în Business Manager cine mai are acces și restabilește.',
			};
		case '11':
			return {
				label: 'Cont compromis',
				suggestion:
					'Meta a detectat compromitere. Schimbă parola, activează 2FA, revocă acces utilizatorilor suspecți, contactează Meta Security.',
			};
		case '12':
			return {
				label: 'Încălcare integritate business (risk/restriction)',
				suggestion:
					'Suspendare gravă pentru încălcarea politicilor business integrity. Deschide appeal oficial prin Meta Help Center → Account Quality → Business Integrity, și include CUI/J firmă, screenshot-uri și documente care atestă legitimitatea afacerii.',
			};
		default:
			console.warn(`[ads-status] Unknown Meta disable_reason: ${code}`);
			return {
				label: 'Motiv nespecificat',
				suggestion: 'Deschide ticket Meta Business Suite → Help & Support pentru detalii.',
			};
	}
}

/**
 * RO translation + suggestion pentru valori `account_status` Meta cu copy
 * specific. Returnează null pentru status-uri unde generic copy e adecvat
 * (1 ACTIVE) — caller-ul cade pe ramura generică.
 */
export function translateMetaAccountStatus(code: string | null): {
	label: string;
	suggestion: string;
} | null {
	if (code == null) return null;
	switch (code) {
		case '2':
			return {
				label: 'Cont dezactivat',
				suggestion:
					'Meta a dezactivat contul fără un motiv specific raportat. Verifică Meta Business Suite → Account Quality pentru detalii sau deschide ticket Help & Support.',
			};
		case '3':
			return {
				label: 'Plată în curs de procesare',
				suggestion:
					'Meta procesează ultima plată. Reclamele se vor relua automat în 1-2 ore. Dacă persistă peste 24h, verifică metoda de plată în Billing.',
			};
		case '7':
			return {
				label: 'Verificare cont în curs',
				suggestion:
					'Meta verifică contul pentru risc. Așteaptă 24-48h, fără acțiune necesară. Reclamele pot rula limitat în acest timp.',
			};
		case '8':
			return {
				label: 'Plată în așteptare',
				suggestion:
					'O plată e în așteptare la Meta. De obicei se rezolvă singur în câteva ore. Verifică Meta → Billing dacă persistă.',
			};
		case '9':
			return {
				label: 'Perioadă de grație — factură neachitată',
				suggestion:
					'Plata a eșuat — perioadă de grație activă (de obicei 7 zile). Achită soldul în Meta → Billing → Payment Settings pentru a evita oprirea automată.',
			};
		case '100':
			return {
				label: 'Cont programat pentru închidere',
				suggestion:
					'Cont marcat pentru închidere de Meta. Dacă e o eroare, contactează Meta Business Support imediat.',
			};
		case '101':
			return {
				label: 'Cont închis definitiv',
				suggestion:
					'Cont închis. Contactează Meta dacă închiderea e o eroare; altfel e terminal.',
			};
		default:
			return null;
	}
}

/** Format `2036-03-15 13:26:50` → `15 martie 2036`. Returns raw on parse failure. */
export function formatDeadlineDate(raw: string | null): string | null {
	if (!raw) return null;
	const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return raw;
	return date.toLocaleDateString('ro-RO', {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
	});
}

/** True if the status warrants red (critical) styling in UI + email. */
export function isCriticalStatus(status: DescribeStatusInput['paymentStatus']): boolean {
	return status === 'suspended' || status === 'payment_failed';
}

/**
 * Returns a structured Romanian explainer + actionable suggestion for a
 * flagged account. Returns null when no guidance applies (e.g. `ok`).
 */
export function describeStatus(input: DescribeStatusInput): StatusDetails | null {
	const { provider, paymentStatus, rawDisableReason, rejectReasonMessage, rejectReasonEndsAt } =
		input;
	const deadline = formatDeadlineDate(rejectReasonEndsAt);

	// TikTok returned an explicit rejection message (STATUS_LIMIT / STATUS_DISABLE
	// with a reason). Detect the well-known "suspicious or unusual activity"
	// template and translate; for unknown messages fall back to the raw string
	// so the client still has actionable text for an appeal.
	if (rejectReasonMessage && (paymentStatus === 'risk_review' || paymentStatus === 'suspended')) {
		const isSuspiciousActivity =
			/suspicious or unusual activity|violation of the TikTok Advertising Guidelines/i.test(
				rejectReasonMessage,
			);
		const headline =
			paymentStatus === 'suspended'
				? 'Cont suspendat de TikTok'
				: 'Cont restricționat de TikTok';
		if (isSuspiciousActivity) {
			return {
				headline,
				body: 'TikTok a restricționat acest cont din cauza unei activități suspecte sau a unei suspiciuni de încălcare a politicilor TikTok Ads.',
				suggestion:
					'Deschide un ticket „Account Review" în TikTok Business Support și depune appeal în maxim 3 zile lucrătoare.',
				deadline,
			};
		}
		return {
			headline,
			body: rejectReasonMessage,
			suggestion:
				'Deschide TikTok Ads Manager pentru detalii suplimentare sau contactează TikTok Business Support.',
			deadline,
		};
	}

	// TikTok-specific delivery issues (account STATUS_ENABLE but no delivery).
	if (provider === 'tiktok' && paymentStatus === 'risk_review' && rawDisableReason === 'budget_exceeded') {
		return {
			headline: 'Buget consumat',
			body: 'Campaniile au atins limita de buget. Reclamele nu mai rulează până la reset-ul zilnic sau o creștere de buget.',
			suggestion:
				'Deschide TikTok Ads Manager și crește bugetul campaniilor active, sau așteaptă reset-ul zilnic.',
			deadline: null,
		};
	}
	if (provider === 'tiktok' && paymentStatus === 'risk_review' && rawDisableReason === 'no_delivery') {
		return {
			headline: 'Reclame oprite',
			body: 'Contul este activ, dar nicio reclamă nu este livrată momentan. Cauze posibile: reclame respinse la audit, programare în afara orelor, reguli de livrare.',
			suggestion:
				'Deschide TikTok Ads Manager și verifică în secțiunea „Ads" starea fiecărei reclame — vei vedea ce e respins și de ce.',
			deadline: null,
		};
	}

	// Google with explicit suspension_reasons — translate each + compose headline.
	if (provider === 'google' && (paymentStatus === 'suspended' || paymentStatus === 'risk_review')) {
		const translated = translateGoogleSuspensionReasons(input.googleSuspensionReasons ?? null);
		if (translated) {
			return {
				headline:
					paymentStatus === 'suspended'
						? `Cont suspendat de Google — ${translated.label}`
						: `Cont restricționat de Google — ${translated.label}`,
				body: 'Google Ads a aplicat această restricție pe cont. Detalii de mai jos.',
				suggestion: translated.suggestion,
				deadline: null,
			};
		}
	}

	// Meta with explicit disable_reason — translate + compose headline keyed off
	// payment status. If disable_reason is missing or 0, fall through to
	// account_status translation (e.g. PENDING_RISK_REVIEW, IN_GRACE_PERIOD).
	if (provider === 'meta' && (
		paymentStatus === 'suspended' ||
		paymentStatus === 'risk_review' ||
		paymentStatus === 'payment_failed' ||
		paymentStatus === 'grace_period' ||
		paymentStatus === 'closed'
	)) {
		const reasonTranslated = translateMetaDisableReason(rawDisableReason);
		if (reasonTranslated) {
			const prefix =
				paymentStatus === 'payment_failed'
					? 'Plata a eșuat pe Meta'
					: paymentStatus === 'grace_period'
						? 'Cont Meta'
						: paymentStatus === 'suspended'
							? 'Cont suspendat de Meta'
							: paymentStatus === 'risk_review'
								? 'Cont Meta'
								: 'Cont închis pe Meta';
			return {
				headline: `${prefix} — ${reasonTranslated.label}`,
				body: 'Meta a aplicat această restricție pe cont. Detalii și pași de remediere mai jos.',
				suggestion: reasonTranslated.suggestion,
				deadline: null,
			};
		}
		const statusTranslated = translateMetaAccountStatus(input.rawStatusCode ?? null);
		if (statusTranslated) {
			return {
				headline:
					paymentStatus === 'closed'
						? statusTranslated.label
						: `Cont Meta — ${statusTranslated.label}`,
				body: 'Meta a aplicat această stare pe cont. Detalii și pași de remediere mai jos.',
				suggestion: statusTranslated.suggestion,
				deadline: null,
			};
		}
	}

	// Generic status-only variants — shared across Meta / Google / TikTok.
	switch (paymentStatus) {
		case 'grace_period':
			return {
				headline: 'Factură neachitată — perioadă de grație',
				body: 'Reclamele rulează, dar vor fi oprite automat dacă nu achiți soldul în zilele următoare.',
				suggestion: 'Apasă „Plătește" pentru a achita soldul restant acum.',
				deadline: null,
			};
		case 'payment_failed':
			return {
				headline: 'Plata a eșuat',
				body: 'Reclamele sunt oprite până la achitarea soldului sau actualizarea metodei de plată.',
				suggestion: 'Apasă „Plătește" sau actualizează cardul în setările contului de publicitate.',
				deadline: null,
			};
		case 'risk_review':
			return {
				headline: 'Cont în curs de verificare',
				body: 'Platforma verifică contul. Livrarea reclamelor poate fi limitată temporar.',
				suggestion: 'Deschide setările contului pentru a vedea ce acțiuni sunt cerute.',
				deadline: null,
			};
		case 'suspended':
			return {
				headline: 'Cont suspendat',
				body: 'Platforma a suspendat contul și reclamele nu mai rulează.',
				suggestion: 'Contactează suportul platformei pentru detalii și procedura de appeal.',
				deadline: null,
			};
		case 'closed':
			return {
				headline: 'Cont închis',
				body: 'Contul este închis definitiv.',
				suggestion: 'Contactează suportul platformei dacă închiderea este o eroare.',
				deadline: null,
			};
		case 'ok':
		default:
			return null;
	}
}
