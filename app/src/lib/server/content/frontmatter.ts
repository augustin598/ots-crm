/**
 * Parser minimal de frontmatter YAML-like pentru fișierele content/heylux/*.md.
 * Format: `---\n key: "value" \n---\n body`. Valorile sunt string-uri (cu sau fără ghilimele).
 * Fără dependență externă (nu avem gray-matter/js-yaml).
 */
export function parseFrontmatter(md: string): { data: Record<string, string>; body: string } {
	const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(md);
	if (!m) return { data: {}, body: md };
	const data: Record<string, string> = {};
	for (const line of m[1].split(/\r?\n/)) {
		const kv = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line.trim());
		if (!kv) continue;
		let val = kv[2].trim();
		if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
			val = val.slice(1, -1);
		}
		data[kv[1]] = val;
	}
	return { data, body: m[2].replace(/^\r?\n/, '') };
}
