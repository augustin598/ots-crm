import { describe, test, expect } from 'bun:test';
import { describeGoogleAdsError, classifyListInvoicesError } from '../sync-errors';

/** Shape thrown by the google-ads-api library (GoogleAdsFailure), NOT an Error instance. */
const googleAdsFailure = {
	errors: [
		{ error_code: { authorization_error: 'USER_PERMISSION_DENIED' }, message: 'User doesn\'t have permission to access customer.' }
	],
	request_id: 'abc123'
};

describe('describeGoogleAdsError', () => {
	test('Error → its message', () => {
		expect(describeGoogleAdsError(new Error('boom'))).toBe('boom');
	});

	test('GoogleAdsFailure object → code + message, never [object Object]', () => {
		const d = describeGoogleAdsError(googleAdsFailure);
		expect(d).toContain('USER_PERMISSION_DENIED');
		expect(d).toContain('permission');
		expect(d).not.toContain('[object Object]');
	});

	test('unknown object → JSON, capped', () => {
		const d = describeGoogleAdsError({ foo: 'x'.repeat(2000) });
		expect(d.length).toBeLessThanOrEqual(500);
		expect(d).toContain('foo');
	});
});

describe('classifyListInvoicesError', () => {
	test('not on monthly invoicing → not_monthly_invoicing', () => {
		expect(classifyListInvoicesError(new Error('BILLING_SETUP_NOT_ON_MONTHLY_INVOICING')).kind).toBe('not_monthly_invoicing');
		expect(classifyListInvoicesError(new Error('Invalid value for billingSetups')).kind).toBe('not_monthly_invoicing');
	});

	test('permission / customer gone → account_inaccessible', () => {
		const r = classifyListInvoicesError(googleAdsFailure);
		expect(r.kind).toBe('account_inaccessible');
		expect(r.message).toContain('USER_PERMISSION_DENIED');
		expect(classifyListInvoicesError({ errors: [{ error_code: { authentication_error: 'CUSTOMER_NOT_FOUND' } }] }).kind).toBe('account_inaccessible');
	});

	test('anything else → other with a readable message', () => {
		const r = classifyListInvoicesError(new Error('socket hang up'));
		expect(r).toEqual({ kind: 'other', message: 'socket hang up' });
	});
});
