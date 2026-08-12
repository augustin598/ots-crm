#!/usr/bin/env bun
/**
 * Rulează suita de teste cu UN PROCES PER FIȘIER.
 *
 * De ce nu `bun test` direct: `mock.module()` din Bun scrie într-un registru
 * GLOBAL, iar `bun test` rulează toate fișierele în același proces. 44 dintre
 * fișierele noastre de test înlocuiesc `$lib/server/db/schema` cu un mock parțial
 * (doar tabelele de care au nevoie), 52 înlocuiesc `$lib/server/db`. Primul fișier
 * care face asta strică modulul pentru TOATE fișierele care rulează după el —
 * de aici erori absurde de tipul `table.adsOptimizationTask is undefined` în teste
 * care n-au nicio legătură cu ads.
 *
 * Rezultatul: `bun test` raporta ~238 eșecuri fantomă pe main, ceea ce făcea suita
 * inutilizabilă ca semnal — nimeni nu mai putea distinge o regresie reală.
 *
 * Bun nu are un flag de izolare (verificat pe 1.3.10), deci izolăm noi: fiecare
 * fișier primește proces propriu, rulate în paralel cu un plafon de concurență.
 *
 * Utilizare:
 *   bun run test                      # toate testele
 *   bun run test stripe               # doar fișierele cu „stripe" în cale
 *   bun run test --verbose            # afișează output-ul complet al fișierelor picate
 */

import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { cpus } from 'node:os';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const filters = args.filter((a) => !a.startsWith('--'));

function findTestFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			findTestFiles(full, out);
		} else if (entry.endsWith('.test.ts')) {
			out.push(full);
		}
	}
	return out;
}

const allFiles = findTestFiles(SRC).sort();
const files = filters.length
	? allFiles.filter((f) => filters.some((needle) => f.includes(needle)))
	: allFiles;

if (files.length === 0) {
	console.error(
		filters.length
			? `Niciun fișier de test nu se potrivește cu: ${filters.join(', ')}`
			: 'Niciun fișier de test găsit.'
	);
	process.exit(1);
}

type Result = {
	file: string;
	pass: number;
	fail: number;
	crashed: boolean;
	output: string;
};

async function runFile(file: string): Promise<Result> {
	const proc = Bun.spawn(['bun', 'test', file], {
		cwd: ROOT,
		stdout: 'pipe',
		stderr: 'pipe'
	});

	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited
	]);

	// Bun scrie sumarul pe stderr.
	const output = `${stdout}${stderr}`;
	const pass = Number(output.match(/^\s*(\d+) pass$/m)?.[1] ?? 0);
	const fail = Number(output.match(/^\s*(\d+) fail$/m)?.[1] ?? 0);
	// Fișier care a murit fără să raporteze nimic (import rupt, throw la nivel de modul).
	const crashed = exitCode !== 0 && pass === 0 && fail === 0;

	return { file, pass, fail, crashed, output };
}

const CONCURRENCY = Math.max(2, Math.min(8, cpus().length - 2));
const results: Result[] = [];
let cursor = 0;
let done = 0;

process.stdout.write(
	`Rulez ${files.length} fișiere de test, ${CONCURRENCY} procese în paralel...\n\n`
);

async function worker() {
	while (cursor < files.length) {
		const file = files[cursor++];
		const result = await runFile(file);
		results.push(result);
		done++;

		const short = relative(SRC, file);
		const bad = result.fail > 0 || result.crashed;
		const mark = bad ? '✗' : '✓';
		const detail = result.crashed
			? 'CRASH (fișierul nu a putut rula)'
			: `${result.pass} pass${result.fail ? `, ${result.fail} fail` : ''}`;
		process.stdout.write(
			`${mark} [${String(done).padStart(3)}/${files.length}] ${short} — ${detail}\n`
		);
	}
}

const started = Date.now();
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

const failing = results.filter((r) => r.fail > 0 || r.crashed).sort((a, b) => b.fail - a.fail);
const totalPass = results.reduce((n, r) => n + r.pass, 0);
const totalFail = results.reduce((n, r) => n + r.fail, 0);

process.stdout.write(`\n${'─'.repeat(70)}\n`);
process.stdout.write(
	`${totalPass} pass · ${totalFail} fail · ${failing.length}/${files.length} fișiere cu probleme · ${elapsed}s\n`
);

if (failing.length > 0) {
	process.stdout.write(`\nFișiere cu eșecuri:\n`);
	for (const r of failing) {
		process.stdout.write(
			`  ${relative(SRC, r.file)} — ${r.crashed ? 'CRASH' : `${r.fail} fail`}\n`
		);
	}
	if (verbose) {
		for (const r of failing) {
			process.stdout.write(`\n${'═'.repeat(70)}\n${relative(SRC, r.file)}\n${'═'.repeat(70)}\n`);
			process.stdout.write(r.output);
		}
	} else {
		process.stdout.write(`\nRulează cu --verbose pentru output complet.\n`);
	}
	process.exit(1);
}

process.stdout.write('\nToate testele trec.\n');
