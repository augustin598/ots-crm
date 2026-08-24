import { describe, it, expect, mock, beforeEach } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: { SQLITE_PATH: ':memory:' } }));
mock.module('$env/static/private', () => ({ SQLITE_PATH: ':memory:' }));

/**
 * Starea din DB pe care o servește mock-ul de `db`. Fiecare test o rescrie
 * înainte de a chema loaderul.
 */
type Row = Record<string, unknown>;
const state: { tenant: Row | null; signToken: Row | null; contract: Row | null; client: Row | null } =
	{ tenant: null, signToken: null, contract: null, client: null };

// Loaderul face patru select-uri, în ordine: tenant → sign token → contract → client.
let selectCall = 0;
const order = ['tenant', 'signToken', 'contract', 'client'] as const;

mock.module('$lib/server/db', () => ({
	db: {
		select: () => ({
			from: () => ({
				where: () => ({
					limit: () => {
						const key = order[Math.min(selectCall, order.length - 1)];
						selectCall++;
						const row = state[key];
						return Promise.resolve(row ? [row] : []);
					}
				})
			})
		}),
		transaction: async (fn: (tx: unknown) => unknown) =>
			fn({
				update: () => ({ set: () => ({ where: () => Promise.resolve() }) })
			})
	}
}));

mock.module('$lib/server/db/schema', () => ({
	tenant: { id: 'id', slug: 'slug' },
	contractSignToken: { id: 'id', token: 'token', tenantId: 'tenant_id' },
	contract: { id: 'id', clientId: 'client_id' },
	client: { id: 'id' }
}));

mock.module('$lib/server/plugins/hooks', () => ({
	getHooksManager: () => ({ emit: async () => {} })
}));
mock.module('$lib/server/logger', () => ({ logError: () => {} }));

const { load, actions } = await import('../+page.server.js');

const TENANT = { id: 'tenant-1', slug: 'ots', name: 'ONE TOP', email: 'a@b.ro', city: 'Suceava' };
const CLIENT = { id: 'client-1', name: 'Client SRL', businessName: 'Client SRL', email: 'c@d.ro' };

const HOUR = 60 * 60 * 1000;

function setup(opts: {
	used: boolean;
	expiresAt: Date;
	beneficiarSignedAt: Date | null;
}) {
	selectCall = 0;
	state.tenant = TENANT;
	state.signToken = {
		id: 'tok-1',
		contractId: 'contract-1',
		tenantId: TENANT.id,
		used: opts.used,
		expiresAt: opts.expiresAt
	};
	state.contract = {
		id: 'contract-1',
		tenantId: TENANT.id,
		clientId: CLIENT.id,
		contractNumber: 'CTR-0005',
		contractTitle: 'Test',
		contractDate: new Date('2026-04-20'),
		status: 'expired',
		prestatorSignedAt: new Date('2026-04-20'),
		beneficiarSignedAt: opts.beneficiarSignedAt,
		beneficiarSignatureName: opts.beneficiarSignedAt ? 'GALANI ALICE' : null
	};
	state.client = CLIENT;
}

const event = { params: { tenant: 'ots', token: 'raw-token' } };

function signRequest() {
	const body = new URLSearchParams({
		signatureName: 'Ion Popescu',
		signatureImage: 'data:image/png;base64,iVBORw0KGgo='
	});
	return {
		params: event.params,
		request: new Request('http://localhost/sign/ots/raw-token?/sign', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body
		})
	};
}

describe('link de semnare — token activ', () => {
	beforeEach(() =>
		setup({ used: false, expiresAt: new Date(Date.now() + HOUR), beneficiarSignedAt: null })
	);

	it('încarcă pagina în mod semnabil', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const data: any = await load(event as any);
		expect(data.readOnly).toBe(false);
		expect(data.contract.beneficiarSignedAt).toBeNull();
	});
});

describe('link de semnare — token consumat pe contract semnat (arhivă)', () => {
	beforeEach(() =>
		setup({
			used: true,
			expiresAt: new Date(Date.now() - HOUR),
			beneficiarSignedAt: new Date('2026-04-24T11:40:02.617Z')
		})
	);

	it('rămâne accesibil, în citire', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const data: any = await load(event as any);
		expect(data.readOnly).toBe(true);
		expect(data.contract.beneficiarSignatureName).toBe('GALANI ALICE');
	});

	it('nu mai permite semnarea', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const result: any = await actions.sign(signRequest() as any);
		expect(result.status).toBe(400);
		expect(result.data.error).toBe('Link invalid sau expirat');
	});
});

describe('link de semnare — token consumat pe contract nesemnat', () => {
	beforeEach(() =>
		setup({ used: true, expiresAt: new Date(Date.now() - HOUR), beneficiarSignedAt: null })
	);

	it('rămâne mort (400)', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await expect(load(event as any)).rejects.toMatchObject({ status: 400 });
	});
});

describe('link de semnare — token expirat, nefolosit, contract nesemnat', () => {
	beforeEach(() =>
		setup({ used: false, expiresAt: new Date(Date.now() - HOUR), beneficiarSignedAt: null })
	);

	it('rămâne mort (400)', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await expect(load(event as any)).rejects.toMatchObject({ status: 400 });
	});
});
