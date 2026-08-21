import { describe, it, expect } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Pagina publică `/servicii` e protejată cu parolă, dar JS-ul ei e servit
 * oricui cere URL-ul chunk-ului — gate sau nu. Un singur `import { CATEGORIES }`
 * din `ots-catalog` într-un fișier de client ar împacheta tot catalogul, cu
 * prețuri cu tot, și ar face parola decorativă.
 *
 * Datele au voie să ajungă în browser DOAR prin `load`, după deblocare. Tipurile
 * sunt în regulă: `import type` se șterge la compilare.
 *
 * Testul ăsta există fiindcă regresia e invizibilă — pagina arată identic, iar
 * scurgerea se vede doar dacă cineva deschide bundle-ul.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_ROUTE = join(HERE, '..');
const WIZARD_ENGINE = join(HERE, '../../../lib/logic/wizard-engine.ts');
const WIZARD_COMPONENT = join(HERE, '../../../lib/components/services/PackageWizard.svelte');

/** Fișierele `.server.ts` rulează doar pe server — au voie să importe orice. */
function clientFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		if (entry === '__tests__' || entry === 'node_modules') continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			out.push(...clientFiles(full));
			continue;
		}
		if (!/\.(svelte|ts)$/.test(entry)) continue;
		if (entry.endsWith('.server.ts')) continue;
		if (entry === '+page.server.ts' || entry === '+layout.server.ts') continue;
		out.push(full);
	}
	return out;
}

/** Prinde `import {...} from '...ots-catalog'`, dar nu `import type {...}`. */
const VALUE_IMPORT = /import\s+(?!type\b)[^;]*?from\s+['"][^'"]*constants\/ots-catalog['"]/g;

function valueImports(file: string): string[] {
	const src = readFileSync(file, 'utf8');
	const hits = src.match(VALUE_IMPORT) ?? [];
	// `import { type X }` e tot doar tip — scoate-l din rezultate.
	return hits.filter((h) => !/\{\s*(type\s+\w+\s*,?\s*)+\}/.test(h));
}

describe('pagina publică /servicii nu scurge prețurile în bundle', () => {
	it('niciun fișier de client nu importă valori din ots-catalog', () => {
		const offenders = clientFiles(PUBLIC_ROUTE)
			.map((f) => ({ file: f, hits: valueImports(f) }))
			.filter((x) => x.hits.length > 0);

		expect(offenders.map((o) => `${o.file}: ${o.hits.join(' | ')}`)).toEqual([]);
	});

	it('wizard-engine primește catalogul ca argument, nu prin import', () => {
		expect(valueImports(WIZARD_ENGINE)).toEqual([]);
		const src = readFileSync(WIZARD_ENGINE, 'utf8');
		// Semnătura publică trebuie să ceară explicit catalogul.
		expect(src).toContain('export function recommend(answers: WizardAnswers, catalog: WizardCatalog)');
	});

	it('componenta partajată a wizardului nu importă valori din catalog', () => {
		expect(valueImports(WIZARD_COMPONENT)).toEqual([]);
	});

	it('detectează o scurgere reală (test negativ)', () => {
		// Sanity check: regexul chiar prinde un import de valori.
		const leak = `import { CATEGORIES } from '$lib/constants/ots-catalog';`;
		expect(leak.match(VALUE_IMPORT)).not.toBeNull();
		const typeOnly = `import type { Category } from '$lib/constants/ots-catalog';`;
		expect(typeOnly.match(VALUE_IMPORT)).toBeNull();
	});
});
