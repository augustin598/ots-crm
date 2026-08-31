// Rulare: cd app && bun --env-file=.env run scripts/bnr-backfill-history.ts
// (rulat 2026-08-31: 19.613 rânduri inserate, acoperire USD 2024-01-03 → azi)
//
// Backfill istoric BNR 2024–2026 din arhivele anuale oficiale (curs.bnr.ro).
// Idempotent: INSERT ... ON CONFLICT(currency, rate_date) DO NOTHING — rândurile
// existente (sync-ul zilnic, din 2026-03-02) rămân neatinse.
import { createClient } from '@libsql/client';

const c = createClient({ url: process.env.SQLITE_URI!, authToken: process.env.SQLITE_AUTH_TOKEN });

// formatul fetched_at folosit de rândurile existente (drizzle mode:'timestamp')
const sample = (await c.execute(`select fetched_at from bnr_exchange_rate limit 1`)).rows[0] as any;
const sampleVal = Number(sample?.fetched_at ?? 0);
// secunde (~1.7e9) vs milisecunde (~1.7e12)
const nowFetched = sampleVal > 1e11 ? Date.now() : Math.floor(Date.now() / 1000);
console.log('fetched_at sample:', sample?.fetched_at, '→ scriem ca', nowFetched > 1e11 ? 'ms' : 's');

interface Row { currency: string; rate: number; multiplier: number; date: string }
const rows: Row[] = [];

for (const year of [2024, 2025, 2026]) {
	const url = `https://curs.bnr.ro/files/xml/years/nbrfxrates${year}.xml`;
	const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
	if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
	const xml = await res.text();
	const cubes = [...xml.matchAll(/<Cube date="(\d{4}-\d{2}-\d{2})"[^>]*>([\s\S]*?)<\/Cube>/g)];
	let n = 0;
	for (const [, date, body] of cubes) {
		for (const m of body.matchAll(/<Rate currency="([A-Z]{3})"(?:\s+multiplier="(\d+)")?>([\d.]+)<\/Rate>/g)) {
			const rate = Number(m[3]);
			if (!Number.isFinite(rate) || rate <= 0) continue;
			rows.push({ currency: m[1], rate, multiplier: Number(m[2] ?? '1') || 1, date });
			n++;
		}
	}
	console.log(`${year}: ${cubes.length} zile, ${n} rânduri parse`);
}

// sanity: USD prezent în fiecare an, valori plauzibile
const usd = rows.filter((r) => r.currency === 'USD');
const usdMin = Math.min(...usd.map((r) => r.rate));
const usdMax = Math.max(...usd.map((r) => r.rate));
console.log(`USD: ${usd.length} zile, interval ${usdMin}–${usdMax}`);
if (!(usd.length > 500 && usdMin > 3.5 && usdMax < 6)) throw new Error('Sanity check USD eșuat — nu inserez nimic');

const before = (await c.execute(`select count(*) n from bnr_exchange_rate`)).rows[0] as any;

// batch insert (o instrucțiune per batch; ON CONFLICT DO NOTHING pe indexul unic)
const BATCH = 200;
let inserted = 0;
for (let i = 0; i < rows.length; i += BATCH) {
	const chunk = rows.slice(i, i + BATCH);
	const values = chunk.map(() => `(?, ?, ?, ?, ?, ?)`).join(',');
	const args: unknown[] = [];
	for (const r of chunk) {
		args.push(crypto.randomUUID(), r.currency, r.rate, r.multiplier, r.date, nowFetched);
	}
	const res = await c.execute({
		sql: `insert into bnr_exchange_rate (id, currency, rate, multiplier, rate_date, fetched_at)
		      values ${values}
		      on conflict(currency, rate_date) do nothing`,
		args
	});
	inserted += res.rowsAffected ?? 0;
	if (i % 2000 === 0) console.log(`  ...${i + chunk.length}/${rows.length} (inserate până acum: ${inserted})`);
}

const after = (await c.execute(`select count(*) n from bnr_exchange_rate`)).rows[0] as any;
console.log(`TOTAL parse: ${rows.length} · inserate efectiv: ${inserted} · tabel: ${before.n} → ${after.n}`);

// verificare: acoperire nouă + spot-check
const cov = (await c.execute(`select min(rate_date) mn, max(rate_date) mx, count(*) n from bnr_exchange_rate where currency='USD'`)).rows[0] as any;
console.log('USD acoperire acum:', JSON.stringify(cov));
for (const d of ['2024-06-03', '2025-06-02', '2026-01-05']) {
	const r = (await c.execute({ sql: `select rate from bnr_exchange_rate where currency='USD' and rate_date=?`, args: [d] })).rows[0] as any;
	console.log(`  USD ${d}:`, r?.rate ?? 'LIPSĂ');
}
