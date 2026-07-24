import { describe, expect, test, mock, beforeEach } from 'bun:test';

// Bun's mock.module() must be set up BEFORE the module under test loads.
//
// `$lib/server/db/schema` is deliberately left REAL (unmocked): schema.ts has
// zero `$env` dependency — it's pure `sqliteTable(...)` metadata — so letting
// it load for real means `table.claudeIntegration.tenantId` stays a genuine
// Drizzle Column and `eq(...)` inside index.ts's `readRow()` runs exactly as
// in production. Only the DB *client* (`$lib/server/db`, which needs
// `$env/dynamic/private` to build a libsql client), the plugin registry, the
// crypto layer, and the logger are faked.
type Row = Record<string, unknown>;

// --- db.select().from().where().limit() — call-count-based fake -----------
// Each readRow() call pops one queued rows-batch, so tests that expect two
// reads (decrypt-retry cases) can vary the row across the two calls.
let selectQueue: Row[][] = [];
let selectInvocations = 0;

function makeSelectChain() {
	const chain: Record<string, unknown> = {};
	chain.from = () => chain;
	chain.where = () => chain;
	chain.limit = () => Promise.resolve(selectQueue.shift() ?? []);
	return chain;
}

const fakeDb = {
	select: () => {
		selectInvocations++;
		return makeSelectChain();
	}
};

mock.module('$lib/server/db', () => ({ db: fakeDb }));

// --- plugin registry ---------------------------------------------------
let pluginActive = true;

mock.module('../registry', () => ({
	getPluginRegistry: () => ({
		isPluginActiveForTenant: async (_tenantId: string, _pluginName: string) => pluginActive
	})
}));

// --- crypto: decrypt() + DecryptionError --------------------------------
// FakeDecryptionError is exported from this SAME mock factory, and index.ts
// imports DecryptionError from the identical mocked './crypto' specifier —
// so `e instanceof DecryptionError` inside getClaudeClient is checked against
// the exact class reference thrown here, exercising the real branch (not a
// look-alike class that would silently fail `instanceof`).
class FakeDecryptionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DecryptionError';
	}
}

type DecryptStep = 'ok' | 'decryption-error';
let decryptQueue: DecryptStep[] = [];
let decryptInvocations = 0;

function fakeDecrypt(_tenantId: string, _ciphertext: string): string {
	decryptInvocations++;
	const step = decryptQueue.shift() ?? 'ok';
	if (step === 'decryption-error') {
		throw new FakeDecryptionError('decrypt failed (fake, simulated Turso transient read)');
	}
	return 'sk-ant-api03-DECRYPTED-FAKE-KEY';
}

mock.module('./crypto', () => ({
	decrypt: fakeDecrypt,
	DecryptionError: FakeDecryptionError
}));

// --- logger: no-op -------------------------------------------------------
mock.module('$lib/server/logger', () => ({
	logWarning: () => {},
	logInfo: () => {},
	logError: () => {},
	serializeError: (e: unknown) => ({
		message: e instanceof Error ? e.message : String(e),
		stack: ''
	})
}));

const { getClaudeClient } = await import('./index');

function makeRow(overrides: Row = {}): Row {
	return {
		id: 'row-1',
		tenantId: 'tenant-1',
		apiKeyEncrypted: 'aa:bb:cc',
		keyType: 'api',
		keyHint: 'KEY1',
		defaultModel: 'claude-sonnet-5',
		isActive: true,
		lastTestedAt: null,
		lastError: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides
	};
}

describe('getClaudeClient', () => {
	beforeEach(() => {
		pluginActive = true;
		selectQueue = [];
		selectInvocations = 0;
		decryptQueue = [];
		decryptInvocations = 0;
	});

	test('plugin inactive → resolves null (db not even read)', async () => {
		pluginActive = false;

		const result = await getClaudeClient('tenant-1');

		expect(result).toBeNull();
		expect(selectInvocations).toBe(0);
	});

	test('no row → null', async () => {
		selectQueue = [[]];

		const result = await getClaudeClient('tenant-1');

		expect(result).toBeNull();
		expect(selectInvocations).toBe(1);
	});

	test('row with isActive=false → null', async () => {
		selectQueue = [[makeRow({ isActive: false })]];

		const result = await getClaudeClient('tenant-1');

		expect(result).toBeNull();
		expect(selectInvocations).toBe(1);
		expect(decryptInvocations).toBe(0);
	});

	test('happy path (active plugin + active row, decrypt succeeds) → client carries row keyType/defaultModel', async () => {
		selectQueue = [[makeRow({ keyType: 'oat', defaultModel: 'claude-opus-4-8' })]];
		decryptQueue = ['ok'];

		const result = await getClaudeClient('tenant-1');

		expect(result).not.toBeNull();
		expect(result?.keyType).toBe('oat');
		expect(result?.defaultModel).toBe('claude-opus-4-8');
		expect(selectInvocations).toBe(1);
		expect(decryptInvocations).toBe(1);
	});

	test('decrypt throws DecryptionError once, succeeds on fresh-read retry → returns client (db read twice)', async () => {
		selectQueue = [[makeRow()], [makeRow({ defaultModel: 'claude-haiku-4-5-20251001' })]];
		decryptQueue = ['decryption-error', 'ok'];

		const result = await getClaudeClient('tenant-1');

		expect(result).not.toBeNull();
		expect(result?.defaultModel).toBe('claude-haiku-4-5-20251001');
		expect(selectInvocations).toBe(2);
		expect(decryptInvocations).toBe(2);
	});

	test('decrypt throws DecryptionError twice → rejects (genuine corruption surfaces)', async () => {
		selectQueue = [[makeRow()], [makeRow()]];
		decryptQueue = ['decryption-error', 'decryption-error'];

		await expect(getClaudeClient('tenant-1')).rejects.toThrow(/decrypt failed/);
		expect(selectInvocations).toBe(2);
		expect(decryptInvocations).toBe(2);
	});
});
