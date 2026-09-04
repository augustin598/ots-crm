/**
 * Gardă de build: prinde importurile dinamice pe care le strică bundler-ul.
 *
 * Vite 8 (rolldown 1.0.0-beta) compilează uneori `await import('$lib/…')` din
 * fișierele `.remote.ts` în literalmente `await void 0`. Build-ul trece, dev-ul
 * merge (Vite servește modulele nebundle-uite), dar în producție funcția crapă
 * cu „Cannot destructure property … from null or undefined value".
 *
 * Nimeni nu scrie `await void 0` de mână → orice apariție în output-ul de server
 * e un import dinamic mâncat de bundler. Fixul: transformă-l în import static
 * (sus, în capul fișierului).
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const ROOTS = ['.svelte-kit/output/server', 'build/server'];
const PATTERN = 'await void 0';

function* walk(dir: string): Generator<string> {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return; // directorul nu există (build parțial) — nu e treaba gărzii
	}
	for (const entry of entries) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) yield* walk(path);
		else if (path.endsWith('.js')) yield path;
	}
}

const hits: { file: string; line: number; text: string }[] = [];
for (const root of ROOTS) {
	for (const file of walk(root)) {
		const lines = readFileSync(file, 'utf8').split('\n');
		lines.forEach((text, i) => {
			if (text.includes(PATTERN)) hits.push({ file, line: i + 1, text: text.trim() });
		});
	}
}

if (hits.length) {
	console.error(
		`\n✗ ${hits.length} import(uri) dinamice stricate de bundler (compilate în \`${PATTERN}\`):\n`
	);
	for (const hit of hits) console.error(`  ${hit.file}:${hit.line}  ${hit.text}`);
	console.error(
		'\nÎn producție acestea crapă cu „Cannot destructure property … from null or undefined value".' +
			'\nFix: în fișierul .remote.ts sursă, mută `await import(...)` într-un import static.\n'
	);
	process.exit(1);
}

console.log('✓ niciun import dinamic stricat în output-ul de server');
