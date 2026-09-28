#!/usr/bin/env bun
/**
 * Anonimizează un jurnal Sentinel (NDJSON) pentru fixture-uri de test:
 * IP-urile devin 10.0.<n>.<m> (același IP → același rezultat), username-urile
 * și emailurile devin user_<n>. IP-urile OTS rămân (regulile le tratează aparte).
 * Structura liniilor rămâne neatinsă.
 *   bun scripts/anonymize-sentinel-log.ts <in.log> <out.ndjson>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [, , input, output] = process.argv;
if (!input || !output) {
	console.error('Utilizare: bun scripts/anonymize-sentinel-log.ts <in.log> <out.ndjson>');
	process.exit(1);
}

const ips = new Map<string, string>();
const users = new Map<string, string>();
const OTS_IPS = new Set(['82.77.19.195', '213.157.186.85']);

function anonIp(ip: string): string {
	if (!ip || OTS_IPS.has(ip)) return ip;
	let v = ips.get(ip);
	if (!v) {
		const n = ips.size + 1;
		v = `10.0.${Math.floor(n / 256)}.${n % 256}`;
		ips.set(ip, v);
	}
	return v;
}

function anonUser(u: string): string {
	if (!u || u === '-' || u === '?') return u;
	let v = users.get(u);
	if (!v) {
		v = `user_${users.size + 1}`;
		users.set(u, v);
	}
	return v;
}

function walk(value: unknown, key = ''): unknown {
	if (typeof value === 'string') {
		if (key === 'ip' || key === 'ip_remote') return anonIp(value);
		if (key === 'user' || key === 'login') return anonUser(value);
		if (key === 'email' || /@/.test(value)) return `${anonUser(value)}@exemplu.ro`;
		return value;
	}
	if (Array.isArray(value)) return value.map((x) => walk(x));
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, k)]));
	}
	return value;
}

const lines = readFileSync(input, 'utf8').split('\n').filter((l) => l.trim());
const out = lines.map((l) => JSON.stringify(walk(JSON.parse(l))));
writeFileSync(output, out.join('\n') + '\n');
console.log(`${out.length} linii → ${output} (${ips.size} IP-uri, ${users.size} useri)`);
