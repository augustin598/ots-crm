import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { error } from '@sveltejs/kit';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$env/dynamic/public', () => ({ env: {} }));
mock.module('$env/static/public', () => ({}));

// ─── Request context: locals configurabile per test ─────────────────────────
let locals: Record<string, unknown> = {};
mock.module('$app/server', () => ({
	query: (schemaOrFn: unknown, fn?: unknown) => fn ?? schemaOrFn,
	command: (schemaOrFn: unknown, fn?: unknown) => fn ?? schemaOrFn,
	getRequestEvent: () => ({ locals })
}));
// Oglindește assertStaff (access.ts): actor de portal → 403, anonim / fără
// tenantUser → 401, staff → trece. Fără asta, mock-ul ar permite portalului
// exact ce apără garda reală.
mock.module('$lib/server/get-actor', () => ({
	requireStaff: async (event: { locals: Record<string, unknown> }) => {
		if (event.locals.isClientUser) throw error(403, 'Forbidden');
		if (!event.locals.user || !event.locals.tenantUser) throw error(401, 'Unauthorized');
		return { kind: 'tenant' };
	}
}));
mock.module('$lib/server/plugins/keez/db-retry', () => ({
	withTursoBusyRetry: (op: () => Promise<unknown>) => op()
}));

// ─── Catalogul (în prod vine din DB) ────────────────────────────────────────
type Rate = {
	id: string;
	slug: string;
	label: string;
	rateEur: number;
	sortOrder: number;
	isActive: boolean;
};
let rates: Rate[] = [];
let rules = {
	referenceRateSlug: null as string | null,
	lowCreditThresholdMinutes: 120,
	stepMinutes: 15,
	notifyEmail: true,
	notifyWhatsapp: true
};
const modes = [
	{
		id: 'm1',
		slug: 'standard',
		label: 'Standard',
		suffix: '',
		description: '',
		sla: '',
		multiplierPct: 100,
		maxHours: 100,
		sortOrder: 0,
		isActive: true
	},
	{
		id: 'm2',
		slug: 'urgent',
		label: 'Urgență',
		suffix: 'Urgență 48h',
		description: '',
		sla: '',
		multiplierPct: 150,
		maxHours: 40,
		sortOrder: 1,
		isActive: true
	}
];
mock.module('$lib/server/hourly-catalog', () => ({
	getHourlyCatalog: async (_tenantId: string, opts: { includeInactive?: boolean } = {}) => ({
		rates: opts.includeInactive ? rates : rates.filter((r) => r.isActive),
		modes,
		rules
	})
}));

// ─── DB: capturăm scrierile ─────────────────────────────────────────────────
type Write = {
	kind: 'insert' | 'upsert' | 'update';
	values?: Record<string, unknown>;
	set?: Record<string, unknown>;
};
let writes: Write[] = [];
mock.module('$lib/server/db', () => ({
	db: {
		insert: () => ({
			values: (values: Record<string, unknown>) => ({
				then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
					writes.push({ kind: 'insert', values });
					return Promise.resolve({ rowsAffected: 1 }).then(resolve, reject);
				},
				onConflictDoUpdate: async (cfg: { set: Record<string, unknown> }) => {
					writes.push({ kind: 'upsert', values, set: cfg.set });
					return { rowsAffected: 1 };
				}
			})
		}),
		update: () => ({
			set: (set: Record<string, unknown>) => ({
				where: async () => {
					writes.push({ kind: 'update', set });
				}
			})
		})
	}
}));
await import('$lib/server/db/schema');

const {
	getHourlyCatalogView,
	getHourlyRatesAdmin,
	createHourlyRate,
	updateHourlyRate,
	updateRateMode,
	updateHourCreditRules
} = await import('../hourly-rates.remote');

const rate = (over: Partial<Rate>): Rate => ({
	id: 'r',
	slug: 'development',
	label: 'Development',
	rateEur: 65,
	sortOrder: 0,
	isActive: true,
	...over
});

function asStaff(role: string) {
	locals = { user: { id: 'u1' }, tenant: { id: 't1' }, tenantUser: { role } };
}
/**
 * Utilizator de portal pe o rută /client/<slug>/*: acolo `locals.tenant` E setat
 * chiar dacă userul nu are tenantUser (vezi authorizeSecondaryEmailAccess, F8),
 * deci prezența tenant-ului nu poate fi luată drept dovadă de staff.
 */
function asClient() {
	locals = {
		user: { id: 'c1' },
		isClientUser: true,
		tenant: { id: 't1' },
		clientUser: { id: 'cu1', isPrimary: true },
		client: { id: 'cl1', tenantId: 't1' }
	};
}

/** Payload-uri valide, refolosite acolo unde contează doar garda, nu datele. */
const RATE_INPUT = { id: 'dev', label: 'Dev', rateEur: 66, sortOrder: 0, isActive: true };
const MODE_INPUT = {
	slug: 'urgent' as const,
	label: 'Urgență',
	suffix: '',
	description: '',
	sla: '',
	multiplierPct: 150,
	maxHours: 40,
	isActive: true
};
const RULES_INPUT = {
	referenceRateSlug: null,
	lowCreditThresholdMinutes: 60,
	stepMinutes: 15 as const,
	notifyEmail: true,
	notifyWhatsapp: true
};

beforeEach(() => {
	writes = [];
	rates = [
		rate({ id: 'dev', slug: 'development', label: 'Development', rateEur: 65, sortOrder: 0 }),
		rate({
			id: 'pm',
			slug: 'project-management',
			label: 'Project Management',
			rateEur: 55,
			sortOrder: 1
		}),
		rate({
			id: 'old',
			slug: 'devops-api',
			label: 'DevOps / API',
			rateEur: 80,
			sortOrder: 2,
			isActive: false
		})
	];
	rules = {
		referenceRateSlug: null,
		lowCreditThresholdMinutes: 120,
		stepMinutes: 15,
		notifyEmail: true,
		notifyWhatsapp: true
	};
	asStaff('owner');
});

describe('citire', () => {
	test('getHourlyCatalogView: staff primește doar activele, în forma publică', async () => {
		const view = await getHourlyCatalogView();
		expect(view.hourlyRates).toEqual([
			{ slug: 'development', label: 'Development', rate: 65 },
			{ slug: 'project-management', label: 'Project Management', rate: 55 }
		]);
		expect(view.rateModes.map((m) => m.slug)).toEqual(['standard', 'urgent']);
		expect(view.rateModes[1]).not.toHaveProperty('id');
	});

	test('getHourlyCatalogView: utilizatorul de portal al tenantului are acces', async () => {
		asClient();
		const view = await getHourlyCatalogView();
		expect(view.hourlyRates).toHaveLength(2);
	});

	test('getHourlyCatalogView: anonim → 401', async () => {
		locals = {};
		await expect(getHourlyCatalogView()).rejects.toMatchObject({ status: 401 });
	});

	test('getHourlyRatesAdmin: include inactivele, referința rezolvată și canEdit după rol', async () => {
		const admin = await getHourlyRatesAdmin();
		expect(admin.rates.map((r) => r.slug)).toEqual([
			'development',
			'project-management',
			'devops-api'
		]);
		expect(admin.referenceRateSlug).toBe('project-management');
		expect(admin.canEdit).toBe(true);

		asStaff('member');
		expect((await getHourlyRatesAdmin()).canEdit).toBe(false);
	});

	test('getHourlyRatesAdmin: utilizatorul de portal → 403', async () => {
		asClient();
		await expect(getHourlyRatesAdmin()).rejects.toMatchObject({ status: 403 });
	});

	test('getHourlyRatesAdmin: tenant setat dar fără tenantUser (rută /client) → 401', async () => {
		locals = { user: { id: 'u1' }, tenant: { id: 't1' }, tenantUser: null };
		await expect(getHourlyRatesAdmin()).rejects.toMatchObject({ status: 401 });
	});
});

describe('permisiuni', () => {
	test('mutațiile cer owner sau admin', async () => {
		asStaff('member');
		await expect(createHourlyRate({ label: 'QA', rateEur: 50 })).rejects.toMatchObject({
			status: 403
		});
		await expect(updateHourlyRate(RATE_INPUT)).rejects.toMatchObject({ status: 403 });
		await expect(updateRateMode(MODE_INPUT)).rejects.toMatchObject({ status: 403 });
		await expect(updateHourCreditRules(RULES_INPUT)).rejects.toMatchObject({ status: 403 });
		expect(writes).toHaveLength(0);
	});

	test('utilizatorul de portal nu poate apela nicio mutație', async () => {
		asClient();
		await expect(createHourlyRate({ label: 'QA', rateEur: 50 })).rejects.toMatchObject({
			status: 403
		});
		await expect(updateHourlyRate(RATE_INPUT)).rejects.toMatchObject({ status: 403 });
		await expect(updateRateMode(MODE_INPUT)).rejects.toMatchObject({ status: 403 });
		await expect(updateHourCreditRules(RULES_INPUT)).rejects.toMatchObject({ status: 403 });
		expect(writes).toHaveLength(0);
	});
});

describe('createHourlyRate', () => {
	test('slug unic din denumire, sortOrder după ultimul, timestamp-uri explicite', async () => {
		asStaff('admin');
		const result = await createHourlyRate({ label: 'Development', rateEur: 70 });
		expect(result.slug).toBe('development-2');
		expect(writes).toHaveLength(1);
		const values = writes[0].values!;
		expect(values.slug).toBe('development-2');
		expect(values.sortOrder).toBe(3);
		expect(values.isActive).toBe(true);
		expect(values.tenantId).toBe('t1');
		expect(values.createdAt).toBeInstanceOf(Date);
		expect(values.updatedAt).toBeInstanceOf(Date);
	});

	test('denumire fără litere sau cifre → 400', async () => {
		await expect(createHourlyRate({ label: '!!!', rateEur: 70 })).rejects.toMatchObject({
			status: 400
		});
	});

	test('catalog gol → slug-ul de bază și sortOrder 0', async () => {
		rates = [];
		const result = await createHourlyRate({ label: 'QA', rateEur: 50 });
		expect(result.slug).toBe('qa');
		expect(writes).toHaveLength(1);
		expect(writes[0].values!.sortOrder).toBe(0);
	});
});

describe('updateHourlyRate', () => {
	test('actualizează câmpurile și updatedAt', async () => {
		await updateHourlyRate({ id: 'dev', label: 'Dev', rateEur: 66, sortOrder: 5, isActive: true });
		expect(writes).toEqual([
			{
				kind: 'update',
				set: expect.objectContaining({ label: 'Dev', rateEur: 66, sortOrder: 5, isActive: true })
			}
		]);
		expect(writes[0].set!.updatedAt).toBeInstanceOf(Date);
	});

	test('id necunoscut → 404', async () => {
		await expect(
			updateHourlyRate({ id: 'nope', label: 'X', rateEur: 10, sortOrder: 0, isActive: true })
		).rejects.toMatchObject({ status: 404 });
	});

	test('nu poți dezactiva ultima specializare activă', async () => {
		rates = [rate({ id: 'dev' })];
		await expect(
			updateHourlyRate({
				id: 'dev',
				label: 'Development',
				rateEur: 65,
				sortOrder: 0,
				isActive: false
			})
		).rejects.toMatchObject({ status: 400, body: { message: expect.stringMatching(/ultima/) } });
		expect(writes).toHaveLength(0);
	});

	test('nu poți dezactiva referința aleasă explicit', async () => {
		rules = { ...rules, referenceRateSlug: 'development' };
		await expect(
			updateHourlyRate({
				id: 'dev',
				label: 'Development',
				rateEur: 65,
				sortOrder: 0,
				isActive: false
			})
		).rejects.toMatchObject({ status: 400, body: { message: expect.stringMatching(/referin/) } });
	});

	test('o specializare deja inactivă se salvează — garda nu se declanșează', async () => {
		await updateHourlyRate({
			id: 'old',
			label: 'DevOps / API',
			rateEur: 80,
			sortOrder: 2,
			isActive: false
		});
		expect(writes).toHaveLength(1);
		expect(writes[0].kind).toBe('update');
		expect(writes[0].set).toMatchObject({ isActive: false });
	});
});

describe('updateRateMode', () => {
	test('standard rămâne 100% și activ', async () => {
		await expect(
			updateRateMode({
				slug: 'standard',
				label: 'Standard',
				suffix: '',
				description: '',
				sla: '',
				multiplierPct: 150,
				maxHours: 100,
				isActive: true
			})
		).rejects.toMatchObject({ status: 400, body: { message: expect.stringMatching(/standard/) } });
		expect(writes).toHaveLength(0);
	});

	test('standard nu poate fi dezactivat nici la 100%', async () => {
		await expect(
			updateRateMode({
				slug: 'standard',
				label: 'Standard',
				suffix: '',
				description: '',
				sla: '',
				multiplierPct: 100,
				maxHours: 100,
				isActive: false
			})
		).rejects.toMatchObject({ status: 400, body: { message: expect.stringMatching(/standard/) } });
		expect(writes).toHaveLength(0);
	});

	test('regim absent din setul tenantului → 404, nu update pe zero rânduri', async () => {
		await expect(
			updateRateMode({
				slug: 'weekend',
				label: 'Weekend',
				suffix: 'Weekend',
				description: '',
				sla: '',
				multiplierPct: 170,
				maxHours: 40,
				isActive: true
			})
		).rejects.toMatchObject({ status: 404 });
		expect(writes).toHaveLength(0);
	});

	test('un regim obișnuit poate fi dezactivat', async () => {
		await updateRateMode({ ...MODE_INPUT, isActive: false });
		expect(writes).toHaveLength(1);
		expect(writes[0].kind).toBe('update');
		expect(writes[0].set).toMatchObject({ isActive: false });
	});

	test('un regim obișnuit se actualizează', async () => {
		await updateRateMode({
			slug: 'urgent',
			label: 'Urgență',
			suffix: 'Urgență 24h',
			description: 'd',
			sla: 's',
			multiplierPct: 160,
			maxHours: 30,
			isActive: true
		});
		expect(writes).toEqual([
			{
				kind: 'update',
				set: expect.objectContaining({
					label: 'Urgență',
					suffix: 'Urgență 24h',
					multiplierPct: 160,
					maxHours: 30
				})
			}
		]);
	});
});

describe('updateHourCreditRules', () => {
	test('referință inactivă → 400', async () => {
		await expect(
			updateHourCreditRules({
				referenceRateSlug: 'devops-api',
				lowCreditThresholdMinutes: 60,
				stepMinutes: 15,
				notifyEmail: true,
				notifyWhatsapp: true
			})
		).rejects.toMatchObject({ status: 400, body: { message: expect.stringMatching(/activ/) } });
		expect(writes).toHaveLength(0);
	});

	test('referință activă → se salvează ca atare', async () => {
		await updateHourCreditRules({ ...RULES_INPUT, referenceRateSlug: 'development' });
		expect(writes).toHaveLength(1);
		expect(writes[0].kind).toBe('upsert');
		expect(writes[0].values!.referenceRateSlug).toBe('development');
		expect(writes[0].set!.referenceRateSlug).toBe('development');
	});

	test('referință inexistentă → 400', async () => {
		await expect(
			updateHourCreditRules({ ...RULES_INPUT, referenceRateSlug: 'nu-exista' })
		).rejects.toMatchObject({ status: 400, body: { message: expect.stringMatching(/exist/) } });
		expect(writes).toHaveLength(0);
	});

	test('upsert pe tenant; referința goală se salvează ca null', async () => {
		await updateHourCreditRules({
			referenceRateSlug: '',
			lowCreditThresholdMinutes: 90,
			stepMinutes: 30,
			notifyEmail: false,
			notifyWhatsapp: true
		});
		expect(writes).toHaveLength(1);
		expect(writes[0].kind).toBe('upsert');
		expect(writes[0].values).toMatchObject({
			tenantId: 't1',
			referenceRateSlug: null,
			lowCreditThresholdMinutes: 90,
			stepMinutes: 30,
			notifyEmail: false,
			notifyWhatsapp: true,
			updatedByUserId: 'u1'
		});
		expect(writes[0].set).toMatchObject({
			referenceRateSlug: null,
			lowCreditThresholdMinutes: 90,
			stepMinutes: 30,
			updatedByUserId: 'u1'
		});
		expect(writes[0].values!.createdAt).toBeInstanceOf(Date);
	});
});
