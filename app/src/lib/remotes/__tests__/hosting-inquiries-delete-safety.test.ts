import { describe, test, expect, mock, beforeEach } from 'bun:test';

/**
 * Task 16 — DELETE safety check on hostingInquiry.
 *
 * Once an inquiry has been converted to a DA-provisioned hostingAccount
 * (i.e. hostingAccountId IS NOT NULL), the inquiry IS the audit history for
 * that account. Deleting it would silently lose the source-of-truth for
 * "how this account got provisioned" (contact name, payment status, accept
 * timestamps). Admins must delete the hostingAccount first if truly defunct.
 */

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$env/dynamic/public', () => ({ env: {} }));

// CRITICAL: eagerly load real $lib/server/db/schema BEFORE mocking. This is
// the same pattern used in app/src/lib/server/hosting/__tests__/notifications.test.ts.
// Bun runs all test files in one process and `mock.module()` calls leak across
// files (notably tasks.remote.test.ts in this same directory mocks schema with
// a shape that lacks `hostingInquiry`, leaving the namespace undefined when our
// remote reads `table.hostingInquiry.*`). The eager import ensures bun has the
// REAL module cached; our mock.module below then OVERLAYS — replacing only the
// names we provide and leaving everything else intact, regardless of what
// other files in the suite did before us.
await import('$lib/server/db/schema');

// ─── Request context ──────────────────────────────────────────────────────────

let currentEvent: any = null;

mock.module('$app/server', () => ({
	query: (schemaOrFn: any, fn?: Function) => fn ?? schemaOrFn,
	command: (schemaOrFn: any, fn?: Function) => fn ?? schemaOrFn,
	getRequestEvent: () => currentEvent
}));

// ─── Fake DB ──────────────────────────────────────────────────────────────────

const selectQueue: Array<unknown[]> = [];
const deleteCalls: Array<{ where: unknown }> = [];

function makeChain(rows: unknown[]): any {
	const p = Promise.resolve(rows);
	return Object.assign(p, {
		from: () => makeChain(rows),
		innerJoin: () => makeChain(rows),
		leftJoin: () => makeChain(rows),
		where: () => makeChain(rows),
		orderBy: () => makeChain(rows),
		limit: () => makeChain(rows),
		offset: () => makeChain(rows),
		groupBy: () => makeChain(rows),
		returning: () => makeChain(rows),
		set: () => makeChain(rows)
	});
}

// ─── Schema mock ──────────────────────────────────────────────────────────────
//
// Re-mocks $lib/server/db/schema with all the names hosting-inquiries.remote.ts
// reads. Required because tasks.remote.test.ts (which bun loads before this
// file when running the directory) installs its own schema mock that lacks
// these names — so our remote sees `table.hostingInquiry === undefined` at
// runtime. Combined with the eager-load above, our mock is an OVERLAY on top
// of the real module; the names we provide here win.

const col = (n: string) => n;

mock.module('$lib/server/db/schema', () => ({
	hostingInquiry: {
		id: col('id'),
		tenantId: col('tenantId'),
		hostingProductId: col('hostingProductId'),
		contactName: col('contactName'),
		contactEmail: col('contactEmail'),
		contactPhone: col('contactPhone'),
		companyName: col('companyName'),
		vatNumber: col('vatNumber'),
		message: col('message'),
		status: col('status'),
		source: col('source'),
		ipAddress: col('ipAddress'),
		createdAt: col('createdAt'),
		contactedAt: col('contactedAt'),
		clientId: col('clientId'),
		requestedDomain: col('requestedDomain'),
		paymentMethod: col('paymentMethod'),
		paymentStatus: col('paymentStatus'),
		paidAt: col('paidAt'),
		paidAmountCents: col('paidAmountCents'),
		paymentReference: col('paymentReference'),
		acceptedByUserId: col('acceptedByUserId'),
		acceptedAt: col('acceptedAt'),
		hostingAccountId: col('hostingAccountId'),
		stripeCheckoutSessionId: col('stripeCheckoutSessionId'),
		updatedAt: col('updatedAt')
	},
	hostingProduct: {
		id: col('id'),
		tenantId: col('tenantId'),
		name: col('name'),
		price: col('price'),
		currency: col('currency'),
		billingCycle: col('billingCycle'),
		daServerId: col('daServerId'),
		daPackageId: col('daPackageId')
	},
	hostingAccount: {
		id: col('id'),
		tenantId: col('tenantId'),
		daUsername: col('daUsername'),
		domain: col('domain'),
		status: col('status')
	},
	client: {
		id: col('id'),
		tenantId: col('tenantId'),
		name: col('name'),
		businessName: col('businessName'),
		status: col('status'),
		onboardingStatus: col('onboardingStatus'),
		updatedAt: col('updatedAt')
	}
}));

// ─── Side-effect mocks ────────────────────────────────────────────────────────

mock.module('$lib/server/logger', () => ({
	logError: () => {},
	logWarning: () => {},
	logInfo: () => {},
	serializeError: (err: unknown) => ({
		message: err instanceof Error ? err.message : String(err)
	})
}));

mock.module('$lib/server/stripe/post-payment/provision-da', () => ({
	provisionDirectAdminAccount: async () => ({
		hostingAccountId: 'noop',
		daUsername: 'noop',
		domain: 'noop',
		created: false
	})
}));

mock.module('$lib/server/hosting/create-account', () => ({
	createHostingAccountInternal: async () => ({
		id: 'noop',
		daUsername: 'noop',
		domain: 'noop'
	})
}));

mock.module('$lib/server/plugins/keez/db-retry', () => ({
	withTursoBusyRetry: async (fn: () => unknown) => fn()
}));

mock.module('$lib/server/get-actor', () => ({
	getActor: async () => ({
		kind: 'tenant',
		userId: 'user1',
		role: 'admin',
		tenantId: 'tenant-a'
	})
}));

mock.module('$lib/server/access', () => ({
	assertCan: () => {},
	can: () => true,
	assertAny: () => {},
	assertAll: () => {}
}));

mock.module('$lib/server/db', () => ({
	db: {
		select: () =>
			makeChain(selectQueue.length > 0 ? (selectQueue.shift() as unknown[]) : []),
		insert: () => ({ values: () => Promise.resolve() }),
		update: () => ({
			set: () => ({
				where: () => Promise.resolve()
			})
		}),
		delete: () => ({
			where: (predicate: unknown) => {
				deleteCalls.push({ where: predicate });
				return Promise.resolve();
			}
		}),
		transaction: (fn: Function) =>
			fn({
				select: () =>
					makeChain(selectQueue.length > 0 ? (selectQueue.shift() as unknown[]) : []),
				insert: () => ({ values: () => Promise.resolve() }),
				update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
				delete: () => ({ where: () => Promise.resolve() })
			})
	}
}));

const { deleteHostingInquiry } = await import('../hosting-inquiries.remote');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEvent(tenantId: string) {
	return {
		locals: {
			user: { id: 'user1', email: 'admin@example.com' },
			tenant: { id: tenantId, slug: tenantId }
		}
	};
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('deleteHostingInquiry — DELETE safety guard (Task 16)', () => {
	beforeEach(() => {
		selectQueue.length = 0;
		deleteCalls.length = 0;
		currentEvent = makeEvent('tenant-a');
	});

	test('refuses delete when the inquiry has a linked hostingAccountId (409 conflict)', async () => {
		// Lookup returns an inquiry that has been converted (hostingAccountId set).
		selectQueue.push([{ hostingAccountId: 'ha-123' }]);

		await expect(deleteHostingInquiry('inq-converted')).rejects.toMatchObject({
			status: 409
		});

		// No DELETE should have been issued — the guard fires before.
		expect(deleteCalls).toHaveLength(0);
	});

	test('allows delete when inquiry.hostingAccountId is null', async () => {
		// Lookup returns an inquiry that hasn't been converted (hostingAccountId null).
		selectQueue.push([{ hostingAccountId: null }]);

		const result = await deleteHostingInquiry('inq-pending');

		expect(result).toEqual({ success: true });
		// DELETE should fire exactly once.
		expect(deleteCalls).toHaveLength(1);
	});

	test('returns 404 when the inquiry does not exist (or belongs to another tenant)', async () => {
		// Lookup returns no rows — id doesn't exist in this tenant.
		selectQueue.push([]);

		await expect(deleteHostingInquiry('inq-missing')).rejects.toMatchObject({
			status: 404
		});

		// No DELETE should have been issued.
		expect(deleteCalls).toHaveLength(0);
	});
});
