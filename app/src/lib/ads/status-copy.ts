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
