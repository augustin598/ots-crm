import { describe, expect, test } from 'bun:test';
import {
	parseTikTokRejectReason,
	formatDeadlineDate,
	describeStatus,
	isCriticalStatus,
} from './status-copy';

describe('parseTikTokRejectReason', () => {
	test('standard TikTok format', () => {
		const out = parseTikTokRejectReason(
			'1:Your account has been suspended due to suspicious activity.,endtime:2035-09-03 15:25:11',
		);
		expect(out).toEqual({
			message: 'Your account has been suspended due to suspicious activity.',
			endsAt: '2035-09-03 15:25:11',
		});
	});

	test('no endtime — keep whole message without code prefix', () => {
		const out = parseTikTokRejectReason('2:Some other reason');
		expect(out).toEqual({ message: 'Some other reason', endsAt: null });
	});

	test('unknown format — returns as-is', () => {
		const out = parseTikTokRejectReason('totally new format');
		expect(out).toEqual({ message: 'totally new format', endsAt: null });
	});

	test('null / empty → null', () => {
		expect(parseTikTokRejectReason(null)).toBe(null);
		expect(parseTikTokRejectReason('')).toBe(null);
	});
});

describe('formatDeadlineDate', () => {
	test('space-separated TikTok format → Romanian long date', () => {
		expect(formatDeadlineDate('2036-03-15 13:26:50')).toBe('15 martie 2036');
	});

	test('ISO format', () => {
		expect(formatDeadlineDate('2035-09-03T15:25:11')).toBe('3 septembrie 2035');
	});

	test('invalid string → returned as-is', () => {
		expect(formatDeadlineDate('not a date')).toBe('not a date');
	});

	test('null → null', () => {
		expect(formatDeadlineDate(null)).toBe(null);
	});
});

describe('isCriticalStatus', () => {
	test('suspended + payment_failed are critical', () => {
		expect(isCriticalStatus('suspended')).toBe(true);
		expect(isCriticalStatus('payment_failed')).toBe(true);
	});
	test('others are not', () => {
		expect(isCriticalStatus('risk_review')).toBe(false);
		expect(isCriticalStatus('grace_period')).toBe(false);
		expect(isCriticalStatus('closed')).toBe(false);
		expect(isCriticalStatus('ok')).toBe(false);
	});
});

describe('describeStatus', () => {
	test('ok → null (nothing to explain)', () => {
		expect(
			describeStatus({
				provider: 'tiktok',
				paymentStatus: 'ok',
				rawDisableReason: null,
				rejectReasonMessage: null,
				rejectReasonEndsAt: null,
			}),
		).toBe(null);
	});

	test('TikTok suspicious-activity rejection → RO translation with deadline', () => {
		const out = describeStatus({
			provider: 'tiktok',
			paymentStatus: 'risk_review',
			rawDisableReason: null,
			rejectReasonMessage:
				'Your account has been suspended due to suspicious or unusual activity or a violation of the TikTok Advertising Guidelines.',
			rejectReasonEndsAt: '2036-03-15 13:26:50',
		});
		expect(out?.headline).toBe('Cont restricționat de TikTok');
		expect(out?.body).toContain('activități suspecte');
		expect(out?.suggestion).toContain('Account Review');
		expect(out?.deadline).toBe('15 martie 2036');
	});

	test('TikTok suspended with rejection → critical headline', () => {
		const out = describeStatus({
			provider: 'tiktok',
			paymentStatus: 'suspended',
			rawDisableReason: null,
			rejectReasonMessage:
				'Your account has been suspended due to suspicious or unusual activity.',
			rejectReasonEndsAt: null,
		});
		expect(out?.headline).toBe('Cont suspendat de TikTok');
	});

	test('TikTok unknown rejection message → falls back to raw + generic suggestion', () => {
		const out = describeStatus({
			provider: 'tiktok',
			paymentStatus: 'risk_review',
			rawDisableReason: null,
			rejectReasonMessage: 'Some new TikTok reason nobody has translated yet.',
			rejectReasonEndsAt: null,
		});
		expect(out?.body).toBe('Some new TikTok reason nobody has translated yet.');
		expect(out?.suggestion).toContain('TikTok Business Support');
	});

	test('TikTok budget_exceeded override', () => {
		const out = describeStatus({
			provider: 'tiktok',
			paymentStatus: 'risk_review',
			rawDisableReason: 'budget_exceeded',
			rejectReasonMessage: null,
			rejectReasonEndsAt: null,
		});
		expect(out?.headline).toBe('Buget consumat');
		expect(out?.suggestion).toContain('crește bugetul');
	});

	test('TikTok no_delivery override', () => {
		const out = describeStatus({
			provider: 'tiktok',
			paymentStatus: 'risk_review',
			rawDisableReason: 'no_delivery',
			rejectReasonMessage: null,
			rejectReasonEndsAt: null,
		});
		expect(out?.headline).toBe('Reclame oprite');
		expect(out?.body).toContain('nicio reclamă');
	});

	test('generic grace_period (any provider)', () => {
		const out = describeStatus({
			provider: 'meta',
			paymentStatus: 'grace_period',
			rawDisableReason: null,
			rejectReasonMessage: null,
			rejectReasonEndsAt: null,
		});
		expect(out?.headline).toContain('grație');
	});

	test('generic payment_failed', () => {
		const out = describeStatus({
			provider: 'google',
			paymentStatus: 'payment_failed',
			rawDisableReason: null,
			rejectReasonMessage: null,
			rejectReasonEndsAt: null,
		});
		expect(out?.headline).toBe('Plata a eșuat');
	});

	test('generic suspended without rejection', () => {
		const out = describeStatus({
			provider: 'meta',
			paymentStatus: 'suspended',
			rawDisableReason: null,
			rejectReasonMessage: null,
			rejectReasonEndsAt: null,
		});
		expect(out?.headline).toBe('Cont suspendat');
	});

	test('closed → terminal body', () => {
		const out = describeStatus({
			provider: 'tiktok',
			paymentStatus: 'closed',
			rawDisableReason: null,
			rejectReasonMessage: null,
			rejectReasonEndsAt: null,
		});
		expect(out?.body).toContain('închis definitiv');
	});
});

import { translateGoogleSuspensionReason, translateGoogleSuspensionReasons } from './status-copy';

describe('translateGoogleSuspensionReason', () => {
	test('UNPAID_BALANCE → billing copy', () => {
		const out = translateGoogleSuspensionReason('UNPAID_BALANCE');
		expect(out.label).toBe('Sold neachitat');
		expect(out.suggestion).toContain('Billing');
	});
	test('SUSPICIOUS_PAYMENT_ACTIVITY → payment method copy', () => {
		const out = translateGoogleSuspensionReason('SUSPICIOUS_PAYMENT_ACTIVITY');
		expect(out.label).toBe('Activitate de plată suspicioasă');
		expect(out.suggestion).toContain('metoda de plată');
	});
	test('CIRCUMVENTING_SYSTEMS → policy appeal copy', () => {
		const out = translateGoogleSuspensionReason('CIRCUMVENTING_SYSTEMS');
		expect(out.label).toBe('Eludarea sistemelor Google');
		expect(out.suggestion).toContain('Help Center');
	});
	test('MISREPRESENTATION → identity copy', () => {
		const out = translateGoogleSuspensionReason('MISREPRESENTATION');
		expect(out.label).toBe('Reprezentare falsă a afacerii');
	});
	test('UNACCEPTABLE_BUSINESS_PRACTICES → practices copy', () => {
		const out = translateGoogleSuspensionReason('UNACCEPTABLE_BUSINESS_PRACTICES');
		expect(out.label).toBe('Practici comerciale inacceptabile');
	});
	test('UNAUTHORIZED_ACCOUNT_ACTIVITY → security copy', () => {
		const out = translateGoogleSuspensionReason('UNAUTHORIZED_ACCOUNT_ACTIVITY');
		expect(out.suggestion).toContain('2FA');
	});
	test('UNSPECIFIED / UNKNOWN → generic fallback', () => {
		expect(translateGoogleSuspensionReason('UNSPECIFIED').label).toBe('Motiv nespecificat');
		expect(translateGoogleSuspensionReason('UNKNOWN').label).toBe('Motiv nespecificat');
	});
	test('unknown string → generic fallback (forward-compat)', () => {
		const out = translateGoogleSuspensionReason('SOMETHING_NEW');
		expect(out.label).toBe('Motiv nespecificat');
	});
});

describe('translateGoogleSuspensionReasons (array)', () => {
	test('empty array / null → null', () => {
		expect(translateGoogleSuspensionReasons([])).toBe(null);
		expect(translateGoogleSuspensionReasons(null)).toBe(null);
	});
	test('single reason returns that translation', () => {
		const out = translateGoogleSuspensionReasons(['UNPAID_BALANCE']);
		expect(out?.label).toBe('Sold neachitat');
	});
	test('multiple reasons — joins labels with " · ", uses first suggestion', () => {
		const out = translateGoogleSuspensionReasons(['UNPAID_BALANCE', 'SUSPICIOUS_PAYMENT_ACTIVITY']);
		expect(out?.label).toBe('Sold neachitat · Activitate de plată suspicioasă');
		expect(out?.suggestion).toContain('Billing');
	});
});

describe('describeStatus — Google suspension', () => {
	test('Google suspended with UNPAID_BALANCE → composed headline', () => {
		const out = describeStatus({
			provider: 'google',
			paymentStatus: 'suspended',
			rawDisableReason: null,
			rejectReasonMessage: null,
			rejectReasonEndsAt: null,
			googleSuspensionReasons: ['UNPAID_BALANCE'],
		});
		expect(out?.headline).toBe('Cont suspendat de Google — Sold neachitat');
		expect(out?.suggestion).toContain('Billing');
	});
	test('Google risk_review with SUSPICIOUS_PAYMENT_ACTIVITY', () => {
		const out = describeStatus({
			provider: 'google',
			paymentStatus: 'risk_review',
			rawDisableReason: null,
			rejectReasonMessage: null,
			rejectReasonEndsAt: null,
			googleSuspensionReasons: ['SUSPICIOUS_PAYMENT_ACTIVITY'],
		});
		expect(out?.headline).toBe('Cont restricționat de Google — Activitate de plată suspicioasă');
	});
	test('Google suspended without suspension_reasons → falls through to generic', () => {
		const out = describeStatus({
			provider: 'google',
			paymentStatus: 'suspended',
			rawDisableReason: null,
			rejectReasonMessage: null,
			rejectReasonEndsAt: null,
			googleSuspensionReasons: null,
		});
		expect(out?.headline).toBe('Cont suspendat');
	});
});

import { translateMetaDisableReason, translateMetaAccountStatus } from './status-copy';

describe('translateMetaDisableReason', () => {
	test('1 ADS_INTEGRITY_POLICY → policy copy', () => {
		const out = translateMetaDisableReason('1');
		expect(out?.label).toBe('Încălcare politici reclame');
		expect(out?.suggestion).toContain('Account Quality');
	});
	test('2 ADS_IP_REVIEW → IP review copy', () => {
		const out = translateMetaDisableReason('2');
		expect(out?.label).toBe('Verificare proprietate intelectuală');
	});
	test('3 RISK_PAYMENT → payment risk copy', () => {
		const out = translateMetaDisableReason('3');
		expect(out?.label).toBe('Risc de plată detectat');
		expect(out?.suggestion).toContain('metoda de plată');
	});
	test('4 GRAY_ACCOUNT_SHUT_DOWN → gray copy', () => {
		const out = translateMetaDisableReason('4');
		expect(out?.label).toBe('Cont oprit (suspect duplicate/abuz)');
	});
	test('5 AD_ACCOUNT_DISABLED → ad account disabled copy', () => {
		const out = translateMetaDisableReason('5');
		expect(out?.label).toBe('Cont reclame dezactivat');
	});
	test('6 BUSINESS_DISABLED → business manager copy', () => {
		const out = translateMetaDisableReason('6');
		expect(out?.label).toBe('Business Manager dezactivat');
	});
	test('7 MPG_AFFILIATE_DISABLED → affiliate copy', () => {
		const out = translateMetaDisableReason('7');
		expect(out?.label).toBe('Cont afiliat dezactivat');
	});
	test('8 PRE_PAYMENT_ADS_DISABLED → unpaid copy', () => {
		const out = translateMetaDisableReason('8');
		expect(out?.label).toBe('Sold restant neachitat');
		expect(out?.suggestion).toContain('Billing');
	});
	test('9 PERMISSION_REVOKED → permission copy', () => {
		const out = translateMetaDisableReason('9');
		expect(out?.label).toBe('Permisiuni revocate');
	});
	test('11 COMPROMISED_ACCOUNT → security copy', () => {
		const out = translateMetaDisableReason('11');
		expect(out?.label).toBe('Cont compromis');
		expect(out?.suggestion).toContain('2FA');
	});
	test('12 BUSINESS_INTEGRITY_RS → integrity copy', () => {
		const out = translateMetaDisableReason('12');
		expect(out?.label).toBe('Încălcare integritate business (risk/restriction)');
	});
	test('0 NONE / null / empty → null (no override)', () => {
		expect(translateMetaDisableReason('0')).toBe(null);
		expect(translateMetaDisableReason(null)).toBe(null);
		expect(translateMetaDisableReason('')).toBe(null);
	});
	test('unknown numeric code → generic fallback (warn)', () => {
		const out = translateMetaDisableReason('99');
		expect(out?.label).toBe('Motiv nespecificat');
	});
});

describe('translateMetaAccountStatus', () => {
	test('2 DISABLED → disabled copy', () => {
		const out = translateMetaAccountStatus('2');
		expect(out?.label).toBe('Cont dezactivat');
	});
	test('3 UNSETTLED → processing copy', () => {
		const out = translateMetaAccountStatus('3');
		expect(out?.label).toBe('Plată în curs de procesare');
		expect(out?.suggestion).toContain('1-2 ore');
	});
	test('7 PENDING_RISK_REVIEW → review copy', () => {
		const out = translateMetaAccountStatus('7');
		expect(out?.label).toBe('Verificare cont în curs');
	});
	test('8 PENDING_SETTLEMENT → pending payment copy', () => {
		const out = translateMetaAccountStatus('8');
		expect(out?.label).toBe('Plată în așteptare');
	});
	test('9 IN_GRACE_PERIOD → grace copy', () => {
		const out = translateMetaAccountStatus('9');
		expect(out?.label).toBe('Perioadă de grație — factură neachitată');
		expect(out?.suggestion).toContain('Billing');
	});
	test('100 PENDING_CLOSURE → closure copy', () => {
		const out = translateMetaAccountStatus('100');
		expect(out?.label).toBe('Cont programat pentru închidere');
	});
	test('101 CLOSED → terminal copy', () => {
		const out = translateMetaAccountStatus('101');
		expect(out?.label).toBe('Cont închis definitiv');
	});
	test('1 ACTIVE / others → null (use generic)', () => {
		expect(translateMetaAccountStatus('1')).toBe(null);
		expect(translateMetaAccountStatus('99')).toBe(null);
		expect(translateMetaAccountStatus(null)).toBe(null);
	});
});

describe('describeStatus — Meta', () => {
	test('Meta suspended with disable_reason=1 (ADS_INTEGRITY_POLICY)', () => {
		const out = describeStatus({
			provider: 'meta',
			paymentStatus: 'suspended',
			rawDisableReason: '1',
			rejectReasonMessage: null,
			rejectReasonEndsAt: null,
		});
		expect(out?.headline).toBe('Cont suspendat de Meta — Încălcare politici reclame');
		expect(out?.suggestion).toContain('Account Quality');
	});

	test('Meta payment_failed with disable_reason=8 (PRE_PAYMENT_ADS_DISABLED)', () => {
		const out = describeStatus({
			provider: 'meta',
			paymentStatus: 'payment_failed',
			rawDisableReason: '8',
			rejectReasonMessage: null,
			rejectReasonEndsAt: null,
		});
		expect(out?.headline).toBe('Plata a eșuat pe Meta — Sold restant neachitat');
	});

	test('Meta grace_period with account_status=9 (IN_GRACE_PERIOD)', () => {
		const out = describeStatus({
			provider: 'meta',
			paymentStatus: 'grace_period',
			rawDisableReason: null,
			rejectReasonMessage: null,
			rejectReasonEndsAt: null,
			rawStatusCode: '9',
		});
		expect(out?.headline).toBe('Cont Meta — Perioadă de grație — factură neachitată');
	});

	test('Meta risk_review with account_status=7 (PENDING_RISK_REVIEW)', () => {
		const out = describeStatus({
			provider: 'meta',
			paymentStatus: 'risk_review',
			rawDisableReason: null,
			rejectReasonMessage: null,
			rejectReasonEndsAt: null,
			rawStatusCode: '7',
		});
		expect(out?.headline).toBe('Cont Meta — Verificare cont în curs');
	});

	test('Meta closed → terminal CLOSED message (no Meta prefix)', () => {
		const out = describeStatus({
			provider: 'meta',
			paymentStatus: 'closed',
			rawDisableReason: null,
			rejectReasonMessage: null,
			rejectReasonEndsAt: null,
			rawStatusCode: '101',
		});
		expect(out?.headline).toBe('Cont închis definitiv');
	});

	test('Meta suspended without disable_reason → falls through to generic', () => {
		const out = describeStatus({
			provider: 'meta',
			paymentStatus: 'suspended',
			rawDisableReason: null,
			rejectReasonMessage: null,
			rejectReasonEndsAt: null,
		});
		expect(out?.headline).toBe('Cont suspendat'); // generic, no Meta-specific
	});

	test('Meta with unknown disable_reason=99 → headline includes "Motiv nespecificat"', () => {
		const out = describeStatus({
			provider: 'meta',
			paymentStatus: 'suspended',
			rawDisableReason: '99',
			rejectReasonMessage: null,
			rejectReasonEndsAt: null,
		});
		expect(out?.headline).toBe('Cont suspendat de Meta — Motiv nespecificat');
	});
});
