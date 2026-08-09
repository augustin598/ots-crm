import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Rulat ÎNTR-UN PROCES SEPARAT (vezi `download-evidence.test.ts`), fiindcă
// `mock.module` din Bun e global pe tot rulajul: primul fișier care linkuiește
// `$lib/server/db` îi fixează forma, iar înregistrările ulterioare nu mai pot
// adăuga nume. Într-un `bun test` pe tot repo-ul, mock-urile de aici ar fi
// înlocuite de ale altcuiva, iar testele ar verifica altceva decât cred.
//
// De aceea fișierul NU se numește `*.test.ts` — nu vrem să fie descoperit
// automat, ci pornit explicit, singur, cu registrul de module curat.

type InsertCall = { values: Record<string, unknown>; conflict: Record<string, unknown> };

const inserts: InsertCall[] = [];
const inArrayCalls: string[][] = [];
const warnings: Array<{ message: string; opts?: Record<string, unknown> }> = [];
let selectRows: Array<{ gmailMessageId: string; downloadedAt: Date | null }> = [];
let failInsert = false;

/**
 * Eroare-santinelă: testul „nu aruncă dacă DB-ul pică” trebuie să verifice că
 * exact ACEASTA a fost înghițită. Altfel un TypeError (ex. tabela ajunsă
 * undefined dintr-un mock global al altui fișier) ar trece drept succes.
 */
const SENTINEL_DB_ERROR = new Error('SENTINEL_DB_DOWN');

mock.module('$lib/server/db', () => {
	const selectChain = {
		from: () => selectChain,
		where: async () => selectRows,
	};
	return {
		db: {
			select: () => selectChain,
			insert: () => ({
				values: (values: Record<string, unknown>) => ({
					onConflictDoUpdate: async (conflict: Record<string, unknown>) => {
						if (failInsert) throw SENTINEL_DB_ERROR;
						inserts.push({ values, conflict });
					},
				}),
			}),
		},
	};
});

mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logWarning: (_source: string, message: string, opts?: Record<string, unknown>) => {
		warnings.push({ message, opts });
	},
	logError: () => {},
	serializeError: (e: unknown) => String(e),
}));

mock.module('$lib/server/db/schema', () => ({
	gmailInvoiceDownload: new Proxy({}, { get: (_t, p) => p }),
}));

mock.module('drizzle-orm', () => ({
	eq: () => ({}),
	and: () => ({}),
	inArray: (_col: unknown, values: string[]) => {
		inArrayCalls.push(values);
		return {};
	},
}));

const { sanitizeAttachmentFilename, recordDownload, getDownloadedMap } = await import(
	'../../download-evidence'
);

describe('recordDownload', () => {
	beforeEach(() => {
		inserts.length = 0;
		warnings.length = 0;
		failInsert = false;
	});

	it('scrie evidența cu upsert pe tripleta unică', async () => {
		await recordDownload('t1', 'u1', 'msg-1', 'factura.pdf', '12326');

		expect(inserts).toHaveLength(1);
		const { values, conflict } = inserts[0];
		expect(values.tenantId).toBe('t1');
		expect(values.gmailMessageId).toBe('msg-1');
		expect(values.attachmentFilename).toBe('factura.pdf');
		expect(values.bankReference).toBe('12326');
		expect(values.downloadedByUserId).toBe('u1');
		expect(values.downloadedAt).toBeInstanceOf(Date);
		expect(typeof values.id).toBe('string');

		expect(conflict.target).toEqual(['tenantId', 'gmailMessageId', 'attachmentFilename']);
		const set = conflict.set as Record<string, unknown>;
		expect(set.downloadedByUserId).toBe('u1');
		expect(set.downloadedAt).toBeInstanceOf(Date);
	});

	it('normalizează filename-ul lipsă și referința goală', async () => {
		await recordDownload('t1', null, 'msg-2', null);

		expect(inserts).toHaveLength(1);
		expect(inserts[0].values.attachmentFilename).toBe('atasament.pdf');
		expect(inserts[0].values.bankReference).toBeNull();
		expect(inserts[0].values.downloadedByUserId).toBeNull();
	});

	it('scrie normal, fără warning-uri, când DB-ul răspunde', async () => {
		await recordDownload('t1', 'u1', 'msg-ok', 'ok.pdf');
		expect(warnings).toEqual([]);
	});

	it('înghite EXACT eroarea de DB (santinelă) și logează un warning', async () => {
		failInsert = true;
		await expect(recordDownload('t1', 'u1', 'msg-3', 'x.pdf')).resolves.toBeUndefined();
		expect(inserts).toHaveLength(0);

		// Dacă aici ar apărea altceva (ex. TypeError fiindcă tabela e undefined),
		// testul cade — exact ce vrem: „DB picat” ≠ „cod stricat”.
		expect(warnings).toHaveLength(1);
		const metadata = warnings[0].opts?.metadata as Record<string, unknown>;
		expect(String(metadata.error)).toBe(`Error: ${SENTINEL_DB_ERROR.message}`);
		expect(String(metadata.error)).not.toContain('TypeError');
		expect(metadata.gmailMessageId).toBe('msg-3');
		expect(metadata.attachmentFilename).toBe('x.pdf');
		expect(warnings[0].opts?.tenantId).toBe('t1');
	});
});

describe('getDownloadedMap', () => {
	beforeEach(() => {
		inArrayCalls.length = 0;
		selectRows = [];
	});

	it('întoarce un Map gol fără să interogheze pentru listă goală', async () => {
		const map = await getDownloadedMap('t1', []);
		expect(map.size).toBe(0);
		expect(inArrayCalls).toHaveLength(0);
	});

	it('mapează messageId → data descărcării', async () => {
		const d = new Date('2026-08-01T10:00:00Z');
		selectRows = [{ gmailMessageId: 'msg-1', downloadedAt: d }];

		const map = await getDownloadedMap('t1', ['msg-1', 'msg-2']);
		expect(map.get('msg-1')).toEqual(d);
		expect(map.has('msg-2')).toBe(false);
	});

	it('păstrează cea mai recentă descărcare când sunt mai multe atașamente', async () => {
		const older = new Date('2026-07-01T10:00:00Z');
		const newer = new Date('2026-08-01T10:00:00Z');
		selectRows = [
			{ gmailMessageId: 'msg-1', downloadedAt: older },
			{ gmailMessageId: 'msg-1', downloadedAt: newer },
			{ gmailMessageId: 'msg-1', downloadedAt: null },
		];

		const map = await getDownloadedMap('t1', ['msg-1']);
		expect(map.get('msg-1')).toEqual(newer);
	});

	it('deduplică id-urile și le trimite în chunk-uri', async () => {
		const ids = Array.from({ length: 250 }, (_, i) => `msg-${i}`);
		await getDownloadedMap('t1', [...ids, 'msg-0']);

		expect(inArrayCalls).toHaveLength(2);
		expect(inArrayCalls[0]).toHaveLength(200);
		expect(inArrayCalls[1]).toHaveLength(50);
	});
});

describe('sanitizeAttachmentFilename', () => {
	it('păstrează un nume normal de factură', () => {
		expect(sanitizeAttachmentFilename('factura_12326.pdf')).toBe('factura_12326.pdf');
	});

	it('neutralizează încercările de path traversal', () => {
		const out = sanitizeAttachmentFilename('../../etc/passwd');
		expect(out).not.toContain('/');
		expect(out).not.toContain('\\');
		expect(out).not.toContain('..');
		expect(out.startsWith('.')).toBe(false);
	});

	it('neutralizează și separatorii Windows', () => {
		const out = sanitizeAttachmentFilename('..\\..\\windows\\system32\\config.sys');
		expect(out).not.toContain('\\');
		expect(out).not.toContain('..');
	});

	it('înlocuiește diacriticele românești', () => {
		const out = sanitizeAttachmentFilename('factură-română-ășțîâ.pdf');
		expect(out).toBe('factur_-rom_n_-_____.pdf');
		expect(out).toMatch(/^[a-zA-Z0-9-_. ]+$/);
	});

	it('taie numele foarte lungi păstrând extensia', () => {
		const long = `${'a'.repeat(300)}.pdf`;
		const out = sanitizeAttachmentFilename(long);
		expect(out.length).toBeLessThanOrEqual(120);
		expect(out.endsWith('.pdf')).toBe(true);
	});

	it('întoarce un nume implicit pentru valori goale', () => {
		expect(sanitizeAttachmentFilename('')).toBe('atasament.pdf');
		expect(sanitizeAttachmentFilename(null)).toBe('atasament.pdf');
		expect(sanitizeAttachmentFilename(undefined)).toBe('atasament.pdf');
		expect(sanitizeAttachmentFilename('   ')).toBe('atasament.pdf');
		// un nume format doar din caractere de cale nu poate rămâne gol
		expect(sanitizeAttachmentFilename('...')).toBe('atasament.pdf');
	});

	it('nu produce niciodată ghilimele care ar sparge Content-Disposition', () => {
		const out = sanitizeAttachmentFilename('fact"ura\r\n; filename=evil.pdf');
		expect(out).not.toContain('"');
		expect(out).not.toContain('\n');
		expect(out).not.toContain(';');
	});
});
