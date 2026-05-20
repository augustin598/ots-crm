import { describe, it, expect } from 'bun:test';
import {
	serializeDAPackage,
	serializeDeletePackageBody,
	parseDAPackage,
	defaultPackageInput,
	type PackageInput
} from '../package-serializer';

function makeInput(overrides: Partial<PackageInput> = {}): PackageInput {
	return { ...defaultPackageInput(), ...overrides };
}

describe('serializeDAPackage', () => {
	it('null integer fields become "unlimited"', () => {
		const body = serializeDAPackage('p1', 'create', makeInput());
		expect(body.bandwidth).toBe('unlimited');
		expect(body.quota).toBe('unlimited');
		expect(body.nemails).toBe('unlimited');
		expect(body.mysql).toBe('unlimited');
		expect(body.email_daily_limit).toBe('unlimited');
		expect(body.cpu_quota).toBe('unlimited');
		expect(body.memory_max).toBe('unlimited');
	});

	it('numeric values render as decimal strings (no scientific notation, no decimals)', () => {
		const body = serializeDAPackage(
			'p2',
			'create',
			makeInput({
				bandwidth: 50000,
				quota: 5000,
				maxEmailAccounts: 100,
				cpuQuota: 400,
				memoryMax: 2_147_483_648 // 2 GiB
			})
		);
		expect(body.bandwidth).toBe('50000');
		expect(body.quota).toBe('5000');
		expect(body.nemails).toBe('100');
		expect(body.cpu_quota).toBe('400');
		expect(body.memory_max).toBe('2147483648');
	});

	it('truncates fractional input (DA only accepts integers)', () => {
		const body = serializeDAPackage('p3', 'create', makeInput({ bandwidth: 1500.99 }));
		expect(body.bandwidth).toBe('1500');
	});

	it('booleans render exactly "ON" or "OFF"', () => {
		const body = serializeDAPackage(
			'p4',
			'create',
			makeInput({ php: true, ssl: true, ssh: false, wordpress: false, jailed: true })
		);
		expect(body.php).toBe('ON');
		expect(body.ssl).toBe('ON');
		expect(body.ssh).toBe('OFF');
		expect(body.wordpress).toBe('OFF');
		expect(body.jailed).toBe('ON');
	});

	it('uses DA wire field names (not our camelCase column names)', () => {
		const body = serializeDAPackage('p5', 'create', makeInput());
		// Resource limits use DA's abbreviations
		expect(body.vdomains).toBeDefined();
		expect(body.nsubdomains).toBeDefined();
		expect(body.domainptr).toBeDefined();
		expect(body.nemails).toBeDefined();
		expect(body.nemailf).toBeDefined();
		expect(body.nemailml).toBeDefined();
		expect(body.nemailr).toBeDefined();
		expect(body.aftp).toBeDefined();
		// And our schema names must NOT leak into the wire
		expect(body.maxDomains).toBeUndefined();
		expect(body.anonymousFtp).toBeUndefined();
		expect(body.suspendAtLimit).toBeUndefined();
		// DA uses snake_case for these
		expect(body.suspend_at_limit).toBeDefined();
		expect(body.security_txt).toBeDefined();
	});

	it('includes action + add fields per DA bulk-form convention', () => {
		const create = serializeDAPackage('p6', 'create', makeInput());
		expect(create.action).toBe('create');
		expect(create.add).toBe('Submit');
		expect(create.packagename).toBe('p6');

		const modify = serializeDAPackage('p7', 'modify', makeInput());
		expect(modify.action).toBe('modify');
		expect(modify.packagename).toBe('p7');
	});

	it('omits skin/language when blank (DA rejects empty strings on some versions)', () => {
		const noSkin = serializeDAPackage(
			'p8',
			'create',
			makeInput({ skin: null, language: null })
		);
		expect(noSkin.skin).toBeUndefined();
		expect(noSkin.language).toBeUndefined();

		const withSkin = serializeDAPackage(
			'p9',
			'create',
			makeInput({ skin: 'evolution', language: 'ro' })
		);
		expect(withSkin.skin).toBe('evolution');
		expect(withSkin.language).toBe('ro');
	});

	it('default policy = allow_all_commands / allow_all, no selected[] keys', () => {
		const body = serializeDAPackage('p10', 'create', makeInput());
		expect(body.feature_sets_policy).toBe('allow_all_commands');
		expect(body.plugins_policy).toBe('allow_all');
		// No selected arrays emitted when policy is permissive
		const keys = Object.keys(body);
		expect(keys.some((k) => k.startsWith('feature_sets['))).toBe(false);
		expect(keys.some((k) => k.startsWith('plugins['))).toBe(false);
	});

	it('emits feature_sets[i] keys when policy=allow_selected_features', () => {
		const body = serializeDAPackage(
			'p11',
			'create',
			makeInput({
				featureSetsPolicy: 'allow_selected_features',
				featureSetsSelected: ['admin', 'reseller', 'user']
			})
		);
		expect(body['feature_sets[0]']).toBe('admin');
		expect(body['feature_sets[1]']).toBe('reseller');
		expect(body['feature_sets[2]']).toBe('user');
	});

	it('emits plugins[i] keys when policy restricts', () => {
		const denyBody = serializeDAPackage(
			'p12',
			'create',
			makeInput({
				pluginsPolicy: 'deny_selected',
				pluginsSelected: ['scary-plugin']
			})
		);
		expect(denyBody['plugins[0]']).toBe('scary-plugin');

		const allowBody = serializeDAPackage(
			'p13',
			'create',
			makeInput({
				pluginsPolicy: 'allow_selected',
				pluginsSelected: ['safe-plugin', 'other']
			})
		);
		expect(allowBody['plugins[0]']).toBe('safe-plugin');
		expect(allowBody['plugins[1]']).toBe('other');
	});
});

describe('serializeDeletePackageBody', () => {
	it('uses bulk-select shape with confirmation', () => {
		const body = serializeDeletePackageBody('zombie-pkg');
		expect(body.action).toBe('delete');
		expect(body.select0).toBe('zombie-pkg');
		expect(body.confirmed).toBe('Confirm');
	});
});

describe('parseDAPackage', () => {
	it('"unlimited" and empty become null', () => {
		const parsed = parseDAPackage({
			bandwidth: 'unlimited',
			quota: '',
			nemails: 'UNLIMITED',
			mysql: '5'
		});
		expect(parsed.bandwidth).toBeNull();
		expect(parsed.quota).toBeNull();
		expect(parsed.maxEmailAccounts).toBeNull();
		expect(parsed.maxDatabases).toBe(5);
	});

	it('booleans accept ON/OFF (case-insensitive)', () => {
		const parsed = parseDAPackage({ php: 'ON', ssl: 'on', ssh: 'OFF', wordpress: 'off' });
		expect(parsed.php).toBe(true);
		expect(parsed.ssl).toBe(true);
		expect(parsed.ssh).toBe(false);
		expect(parsed.wordpress).toBe(false);
	});

	it('missing keys default to false (boolean) or null (numeric)', () => {
		const parsed = parseDAPackage({});
		expect(parsed.php).toBe(false);
		expect(parsed.bandwidth).toBeNull();
		expect(parsed.skin).toBeNull();
		expect(parsed.language).toBeNull();
	});

	it('preserves DA snake_case + abbreviation mapping', () => {
		const parsed = parseDAPackage({
			vdomains: '5',
			nsubdomains: '10',
			domainptr: '2',
			suspend_at_limit: 'ON',
			io_read_bandwidth_max: '5000000',
			feature_sets_policy: 'allow_selected_features',
			plugins_policy: 'deny_selected'
		});
		expect(parsed.maxDomains).toBe(5);
		expect(parsed.maxSubdomains).toBe(10);
		expect(parsed.maxDomainPointers).toBe(2);
		expect(parsed.suspendAtLimit).toBe(true);
		expect(parsed.ioReadBandwidthMax).toBe(5_000_000);
		expect(parsed.featureSetsPolicy).toBe('allow_selected_features');
		expect(parsed.pluginsPolicy).toBe('deny_selected');
	});

	it('unknown plugins_policy values fall back to allow_all (safe default)', () => {
		const parsed = parseDAPackage({ plugins_policy: 'gibberish' });
		expect(parsed.pluginsPolicy).toBe('allow_all');
	});
});

describe('serialize → parse roundtrip', () => {
	it('preserves all numeric + boolean + policy fields through wire format', () => {
		const original = makeInput({
			bandwidth: 50000,
			quota: 5000,
			maxEmailAccounts: 100,
			maxDatabases: 25,
			maxDomains: 5,
			maxSubdomains: 10,
			maxDomainPointers: 2,
			cpuQuota: 400,
			memoryMax: 2_147_483_648,
			tasksMax: 512,
			php: true,
			ssl: true,
			ssh: false,
			jailed: true,
			suspendAtLimit: true,
			skin: 'evolution',
			language: 'ro',
			featureSetsPolicy: 'allow_selected_features',
			featureSetsSelected: ['admin', 'reseller']
		});

		const wire = serializeDAPackage('roundtrip', 'create', original);
		const parsed = parseDAPackage(wire);

		// Numeric
		expect(parsed.bandwidth).toBe(original.bandwidth);
		expect(parsed.quota).toBe(original.quota);
		expect(parsed.maxEmailAccounts).toBe(original.maxEmailAccounts);
		expect(parsed.maxDatabases).toBe(original.maxDatabases);
		expect(parsed.cpuQuota).toBe(original.cpuQuota);
		expect(parsed.memoryMax).toBe(original.memoryMax);
		expect(parsed.tasksMax).toBe(original.tasksMax);
		// Boolean
		expect(parsed.php).toBe(original.php);
		expect(parsed.ssl).toBe(original.ssl);
		expect(parsed.ssh).toBe(original.ssh);
		expect(parsed.jailed).toBe(original.jailed);
		expect(parsed.suspendAtLimit).toBe(original.suspendAtLimit);
		// Strings
		expect(parsed.skin).toBe(original.skin);
		expect(parsed.language).toBe(original.language);
		// Policy (selected arrays don't roundtrip via parse — they're meant to be
		// consumed from a different DA endpoint in v2; only the policy value does)
		expect(parsed.featureSetsPolicy).toBe(original.featureSetsPolicy);
	});

	it('null limits survive the roundtrip as null (via "unlimited")', () => {
		const original = makeInput(); // all nulls by default
		const wire = serializeDAPackage('p', 'create', original);
		const parsed = parseDAPackage(wire);
		expect(parsed.bandwidth).toBeNull();
		expect(parsed.quota).toBeNull();
		expect(parsed.maxEmailAccounts).toBeNull();
		expect(parsed.cpuQuota).toBeNull();
		expect(parsed.memoryMax).toBeNull();
	});
});
