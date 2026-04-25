import { describe, it, expect, mock } from 'bun:test';

// Stub SvelteKit virtual modules before sync.ts loads transitive imports
// (db → $env/dynamic/private). This test exercises a pure function — it does
// not need real DB / env / logging.
mock.module('$env/dynamic/private', () => ({ env: { SQLITE_PATH: ':memory:' } }));
mock.module('$env/static/private', () => ({ SQLITE_PATH: ':memory:' }));
mock.module('$lib/server/db', () => ({ db: {} }));
mock.module('$lib/server/notifications', () => ({
	clearNotificationsByType: () => Promise.resolve()
}));
mock.module('$lib/server/logger', () => ({
	serializeError: (e: any) => ({ message: e?.message ?? String(e), stack: '' }),
	logInfo: () => {},
	logWarning: () => {},
	logError: () => {}
}));

const { headerMatchesExisting } = await import('./sync');
import type { KeezInvoiceHeader } from './client';

// Minimal stand-in for `typeof table.invoice.$inferSelect` — we only need the
// fields the fingerprint actually reads. Cast to `any` at the call site.
type MinimalInvoice = {
	keezStatus: string | null;
	totalAmount: number | null;
	remainingAmount: number | null;
	dueDate: Date | null;
};

const baseExisting: MinimalInvoice = {
	keezStatus: 'Valid',
	totalAmount: 12000, // 120.00 RON in cents
	remainingAmount: 0,
	dueDate: new Date('2026-04-01T00:00:00.000Z')
};

const baseHeader: KeezInvoiceHeader = {
	externalId: 'abc',
	status: 'Valid',
	grossAmount: 120, // RON
	remainingAmount: 0,
	dueDate: 20260401
};

describe('headerMatchesExisting', () => {
	it('returns true on exact match', () => {
		expect(headerMatchesExisting(baseHeader, baseExisting as any)).toBe(true);
	});

	it('returns false when status differs', () => {
		const header = { ...baseHeader, status: 'Cancelled' };
		expect(headerMatchesExisting(header, baseExisting as any)).toBe(false);
	});

	it('returns false when grossAmount differs by 1 cent', () => {
		const header = { ...baseHeader, grossAmount: 120.01 };
		expect(headerMatchesExisting(header, baseExisting as any)).toBe(false);
	});

	it('returns true on tiny float noise that rounds to the same cent', () => {
		// Math.round(120.000001 * 100) === 12000 — should still match.
		const header = { ...baseHeader, grossAmount: 120.000001 };
		expect(headerMatchesExisting(header, baseExisting as any)).toBe(true);
	});

	it('returns false when remainingAmount differs', () => {
		const header = { ...baseHeader, remainingAmount: 50 };
		expect(headerMatchesExisting(header, baseExisting as any)).toBe(false);
	});

	it('treats undefined header.remainingAmount as 0', () => {
		const header = { ...baseHeader, remainingAmount: undefined };
		const existing = { ...baseExisting, remainingAmount: 0 };
		expect(headerMatchesExisting(header, existing as any)).toBe(true);
	});

	it('treats null existing.remainingAmount as 0', () => {
		const header = { ...baseHeader, remainingAmount: 0 };
		const existing = { ...baseExisting, remainingAmount: null };
		expect(headerMatchesExisting(header, existing as any)).toBe(true);
	});

	it('returns false when due date differs by one day', () => {
		const header = { ...baseHeader, dueDate: 20260402 };
		expect(headerMatchesExisting(header, baseExisting as any)).toBe(false);
	});

	it('handles null dueDate on both sides', () => {
		const header = { ...baseHeader, dueDate: undefined };
		const existing = { ...baseExisting, dueDate: null };
		expect(headerMatchesExisting(header, existing as any)).toBe(true);
	});

	it('returns false when one side has dueDate and the other does not', () => {
		const header = { ...baseHeader, dueDate: undefined };
		expect(headerMatchesExisting(header, baseExisting as any)).toBe(false);
	});

	it('trims whitespace on status (defensive against Keez API quirks)', () => {
		const header = { ...baseHeader, status: '  Valid  ' };
		expect(headerMatchesExisting(header, baseExisting as any)).toBe(true);
	});

	it('treats undefined header.status and null existing.keezStatus as equivalent', () => {
		const header = { ...baseHeader, status: undefined };
		const existing = { ...baseExisting, keezStatus: null };
		expect(headerMatchesExisting(header, existing as any)).toBe(true);
	});

	it('returns false when status case differs (Keez status enum is exact)', () => {
		const header = { ...baseHeader, status: 'valid' };
		expect(headerMatchesExisting(header, baseExisting as any)).toBe(false);
	});
});
