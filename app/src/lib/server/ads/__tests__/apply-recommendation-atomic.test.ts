/**
 * Sprint 4a Fix #2 — Atomic DB write test.
 * Simulates DB write failure after Meta API succeeds → recommendation stays 'approved'.
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test';

const approvedRec = {
	id: 'rec_atomic_test',
	tenantId: 'test-tenant',
	status: 'approved',
	platform: 'meta',
	action: 'pause_ad',
	externalCampaignId: 'camp_123',
	suggestedPayloadJson: '{}',
};

const updateCalls: Array<{ fields: Record<string, unknown>; kind: 'outer' | 'tx' }> = [];
let txUpdateShouldFail = false;

function makeSelectChain(opts: { recResult?: typeof approvedRec; accountsResult?: unknown[] } = {}) {
	return {
		from: () => ({
			where: (_cond?: unknown) => {
				const accountsResult = opts.accountsResult ?? [{ integrationId: 'fake-integration', metaAdAccountId: 'act_123' }];
				// Make the result thenable (for accounts query without .limit()) AND have a .limit() method
				const thenable: Promise<unknown[]> & { limit: (n: number) => Promise<typeof approvedRec[]> } = Object.assign(
					Promise.resolve(accountsResult),
					{
						limit: async (_n: number) => (opts.recResult ? [opts.recResult] : [approvedRec]),
					}
				);
				return thenable;
			},
		}),
	};
}

mock.module('$lib/server/db', () => ({
	db: {
		select: () => makeSelectChain(),
		update: () => ({
			set: (vals: Record<string, unknown>) => ({
				where: async () => {
					updateCalls.push({ fields: vals, kind: 'outer' });
				},
			}),
		}),
		transaction: async (fn: (tx: unknown) => Promise<void>) => {
			const tx = {
				select: () => ({
					from: () => ({
						where: () => ({
							limit: async () => [{ id: approvedRec.id, status: 'approved' }],
						}),
					}),
				}),
				update: () => ({
					set: (vals: Record<string, unknown>) => ({
						where: async () => {
							if (txUpdateShouldFail) {
								throw new Error('SQLITE_BUSY: database is locked');
							}
							updateCalls.push({ fields: vals, kind: 'tx' });
						},
					}),
				}),
			};
			return fn(tx);
		},
	},
}));

mock.module('$lib/server/meta-ads/client', () => ({
	getCampaignWithAdsets: async () => ({ daily_budget: null, accountCurrency: 'RON', adsets: [] }),
	toggleCampaignStatus: async () => {},
	updateCampaignBudget: async () => {},
	updateAdsetBudget: async () => {},
}));

mock.module('$lib/server/meta-ads/auth', () => ({
	getAuthenticatedToken: async () => ({ accessToken: 'fake-token' }),
}));

mock.module('$env/dynamic/private', () => ({
	env: { META_APP_SECRET: 'fake-secret' },
}));

mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logError: () => {},
	serializeError: (e: unknown) => ({ message: e instanceof Error ? e.message : String(e) }),
}));

mock.module('$lib/server/db/schema', () => ({
	adOptimizationRecommendation: { id: 'id', tenantId: 'tenant_id', status: 'status' },
	adMonitorTarget: {},
	metaAdsAccount: { tenantId: 'tenant_id', integrationId: 'integration_id', isActive: 'is_active' },
}));

beforeEach(() => {
	updateCalls.length = 0;
	txUpdateShouldFail = false;
});

describe('applyRecommendation — atomic DB write', () => {
	it('DB write fail after Meta success → result.ok is false', async () => {
		txUpdateShouldFail = true;
		const { applyRecommendation } = await import('../apply-recommendation');
		const result = await applyRecommendation('rec_atomic_test', 'test-tenant');

		expect(result.ok).toBe(false);
	});

	it('DB write fail → applyError is set (outer update called), no status=applied', async () => {
		txUpdateShouldFail = true;
		const { applyRecommendation } = await import('../apply-recommendation');
		await applyRecommendation('rec_atomic_test', 'test-tenant');

		// Outer update should have been called to set applyError
		const outerUpdates = updateCalls.filter((c) => c.kind === 'outer');
		expect(outerUpdates.length).toBeGreaterThanOrEqual(1);
		const errorUpdate = outerUpdates.find((c) => typeof c.fields.applyError === 'string');
		expect(errorUpdate).toBeDefined();

		// status='applied' must NOT appear in any call (status stays 'approved')
		const appliedCall = updateCalls.find((c) => c.fields.status === 'applied');
		expect(appliedCall).toBeUndefined();
	});

	it('DB write success → result.ok is true and tx update called with status=applied', async () => {
		txUpdateShouldFail = false;
		const { applyRecommendation } = await import('../apply-recommendation');
		const result = await applyRecommendation('rec_atomic_test', 'test-tenant');

		expect(result.ok).toBe(true);
		const txApplied = updateCalls.find((c) => c.kind === 'tx' && c.fields.status === 'applied');
		expect(txApplied).toBeDefined();
	});
});
