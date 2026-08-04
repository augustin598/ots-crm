import { describe, it, expect } from 'bun:test';

/**
 * Testele reale pentru `download-evidence` stau în `./isolated/*.checks.ts` și
 * rulează în PROCESE SEPARATE. Motivul: `mock.module` din Bun e global pe tot
 * rulajul și nu poate adăuga nume noi într-un modul deja linkuit, așa că într-un
 * `bun test` pe tot repo-ul mock-urile pe `$lib/server/db` ale altui fișier le
 * înlocuiesc pe ale noastre — testele ar fi trecut (sau picat) din alt motiv
 * decât cel verificat. Un proces separat înseamnă registru de module curat.
 *
 * Fișierele `.checks.ts` nu se numesc `*.test.ts` tocmai ca `bun test` să nu le
 * descopere singur și să le readucă în rulajul poluat.
 */
const runIsolated = (file: string) => {
	const path = new URL(`./isolated/${file}`, import.meta.url).pathname;
	const proc = Bun.spawnSync(['bun', 'test', path], { stdout: 'pipe', stderr: 'pipe' });
	return {
		exitCode: proc.exitCode,
		output: `${proc.stdout.toString()}\n${proc.stderr.toString()}`.trim()
	};
};

describe('download-evidence (procese izolate)', () => {
	it('sanitizeAttachmentFilename/recordDownload/getDownloadedMap trec cu DB-ul simulat', () => {
		const { exitCode, output } = runIsolated('download-evidence-db.checks.ts');
		if (exitCode !== 0) console.error(output);
		expect(exitCode).toBe(0);
		expect(output).toContain('0 fail');
	});

	it('recordDownload face upsert real pe libSQL în memorie', () => {
		const { exitCode, output } = runIsolated('download-evidence-libsql.checks.ts');
		if (exitCode !== 0) console.error(output);
		expect(exitCode).toBe(0);
		expect(output).toContain('0 fail');
	});
});
