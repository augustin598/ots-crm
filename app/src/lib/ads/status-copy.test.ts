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
