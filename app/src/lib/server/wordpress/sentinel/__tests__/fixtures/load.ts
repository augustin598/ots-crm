import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { SentinelEvent } from '../../types';

/** Citește un fixture NDJSON și atribuie id-uri ca conectorul (sha1(linie)-n pentru liniile vechi). */
export function loadFixture(name: 'areni' | 'nevada'): SentinelEvent[] {
	const raw = readFileSync(new URL(`./${name}.ndjson`, import.meta.url), 'utf8');
	const seen = new Map<string, number>();
	return raw
		.split('\n')
		.filter((l) => l.trim())
		.map((line) => {
			const ev = JSON.parse(line) as SentinelEvent;
			if (!ev.id) {
				const h = createHash('sha1').update(line).digest('hex');
				const n = (seen.get(h) ?? 0) + 1;
				seen.set(h, n);
				ev.id = `${h}-${n}`;
			}
			ev.date = ev.date ?? {};
			return ev;
		})
		.sort((a, b) => a.t.localeCompare(b.t));
}

let seq = 0;
export function ev(partial: Partial<SentinelEvent> & { ev: string; t: string }): SentinelEvent {
	return {
		id: partial.id ?? `${partial.ev}-${++seq}`,
		sev: 'INFO',
		user: '-',
		uid: 0,
		ip: '10.9.9.9',
		uri: '/wp-login.php',
		ua: 'test',
		date: {},
		...partial
	};
}
