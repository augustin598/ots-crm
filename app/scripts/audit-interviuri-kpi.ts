// Rulare: cd app && bun --env-file=.env run scripts/audit-interviuri-kpi.ts
//
// Audit INDEPENDENT al cifrelor din pagina KPI Performanță: recalculează din DB,
// fără codul aplicației, și verifică invariantele (spend/lună/platformă cu conversie
// BNR, interviuri, cheltuieli fixe, dubluri). Read-only — sigur de rulat oricând.
import { createClient } from '@libsql/client';

const c = createClient({ url: process.env.SQLITE_URI!, authToken: process.env.SQLITE_AUTH_TOKEN });
const CLIENT = 'lu44x3vi4e5yom6jb2bq6mbi'; // singurul client cu interviuri (verificat mai jos)
const TENANT = 'k2yzj5bxxppatc57vxpoxfvn';
const q = async (sql: string, args: unknown[] = []) => (await c.execute({ sql, args })).rows as any[];
const today = new Date().toISOString().slice(0, 10);

// 0) clienții interviurilor — trebuie să fie DOAR clientul de mai sus
const cl = await q(`select client_id, count(*) n from interview where tenant_id=? group by 1`, [TENANT]);
console.log('== clienți interviuri ==', JSON.stringify(cl));

// 1) BNR: acoperire + cursuri
const bnr = await q(`select min(rate_date) mn, max(rate_date) mx, count(*) n from bnr_exchange_rate where currency='USD'`);
console.log('== BNR USD acoperire ==', JSON.stringify(bnr));
const rates = await q(`select rate_date, rate, multiplier from bnr_exchange_rate where currency='USD' order by rate_date`);
const rateMap = new Map(rates.map((r) => [r.rate_date as string, (r.rate as number) / ((r.multiplier as number) || 1)]));
const latestRate = rates.length ? (rates[rates.length - 1].rate as number) / ((rates[rates.length - 1].multiplier as number) || 1) : null;
function rateFor(periodEnd: string): { rate: number | null; kind: string } {
	let d = periodEnd > today ? today : periodEnd;
	// lookback 15 zile (weekend/sărbători), ca resolveFxRates
	for (let i = 0; i <= 15; i++) {
		const key = new Date(new Date(d + 'T00:00:00Z').getTime() - i * 86400000).toISOString().slice(0, 10);
		if (rateMap.has(key)) return { rate: rateMap.get(key)!, kind: i === 0 ? 'exact' : `lookback-${i}` };
	}
	return { rate: latestRate, kind: 'FALLBACK-latest' };
}

// 2) spend pe platformă/lună, recalculat independent
const tables = [
	['tiktok', 'tiktok_ads_spending'],
	['google', 'google_ads_spending'],
	['meta', 'meta_ads_spending']
] as const;
const perMonth: Record<string, Record<string, number>> = {};
const fxNotes: string[] = [];
for (const [plat, tbl] of tables) {
	const rows = await q(
		`select period_start ps, period_end pe, spend_cents sc, currency_code cur, synced_at from ${tbl} where tenant_id=? and client_id=? order by ps`,
		[TENANT, CLIENT]
	);
	for (const r of rows) {
		const month = (r.ps as string).slice(0, 7);
		let ron = (r.sc as number) / 100;
		if ((r.cur as string).toUpperCase() !== 'RON') {
			const { rate, kind } = rateFor(r.pe as string);
			if (rate == null) { fxNotes.push(`${plat} ${month}: FĂRĂ curs`); continue; }
			if (kind.startsWith('FALLBACK')) fxNotes.push(`${plat} ${month}: curs aproximat (latest ${rate})`);
			ron = ron * rate;
		}
		(perMonth[month] ??= {})[plat] = ((perMonth[month] ?? {})[plat] ?? 0) + ron;
	}
	// dubluri: același cont + aceeași perioadă de mai multe ori?
	const dup = await q(
		`select ${tbl === 'google_ads_spending' ? 'google_ads_customer_id' : tbl === 'meta_ads_spending' ? 'meta_ad_account_id' : 'tiktok_advertiser_id'} acc, period_start ps, count(*) n
		 from ${tbl} where tenant_id=? and client_id=? group by 1,2 having n>1`,
		[TENANT, CLIENT]
	);
	if (dup.length) console.log(`!! DUBLURI în ${tbl}:`, JSON.stringify(dup));
	const sync = await q(`select max(synced_at) s from ${tbl} where tenant_id=? and client_id=?`, [TENANT, CLIENT]);
	console.log(`sync ${plat}:`, sync[0]?.s);
}

// 3) interviuri pe an: total/admise/plătite + pe lună
const PAID = new Set(['TikTok', 'Google / SEO', 'Facebook', 'Instagram']);
for (const year of [2024, 2025, 2026]) {
	const iv = await q(
		`select substr(i.data_interviu,6,2) m, ch.name channel, i.status, count(*) n
		 from interview i left join interview_channel ch on ch.id=i.channel_id and ch.tenant_id=i.tenant_id
		 where i.tenant_id=? and i.data_interviu between ? and ? group by 1,2,3`,
		[TENANT, `${year}-01-01`, `${year}-12-31`]
	);
	let total = 0, admise = 0, paid = 0;
	const byMonth: Record<string, number> = {};
	for (const r of iv) {
		total += r.n; if (r.status === 'admisa') admise += r.n;
		if (PAID.has(r.channel ?? '')) paid += r.n;
		byMonth[r.m] = (byMonth[r.m] ?? 0) + r.n;
	}
	// totaluri an: ads + fixe (24.000×luni în scop) — fixe le validăm mai jos separat
	const months = new Set<string>(Object.keys(byMonth).map((m) => `${year}-${m}`));
	let ads = 0;
	for (const [mk, sp] of Object.entries(perMonth)) {
		if (!mk.startsWith(`${year}-`)) continue;
		const s = Object.values(sp).reduce((a, b) => a + b, 0);
		if (s > 0) months.add(mk);
		ads += s;
	}
	console.log(`== ${year} ==`, JSON.stringify({ total, admise, paid, luniInScop: months.size, adsTotal: Math.round(ads) }));
	if (year >= 2025) {
		const monthly = Object.entries(perMonth).filter(([mk]) => mk.startsWith(`${year}-`)).sort();
		console.log(`  spend lunar ${year}:`, monthly.map(([mk, sp]) => `${mk.slice(5)}: tt=${Math.round(sp.tiktok ?? 0)} gg=${Math.round(sp.google ?? 0)} mt=${Math.round(sp.meta ?? 0)}`).join(' | '));
		console.log(`  interviuri lunar ${year}:`, JSON.stringify(byMonth));
	}
}

// 4) cheltuieli fixe
const fc = await q(`select name, qty, unit_amount_cents, frequency, active, valid_from, valid_to from marketing_fixed_cost where tenant_id=?`, [TENANT]);
console.log('== cheltuieli fixe ==', JSON.stringify(fc));

// 5) note conversii
console.log('== note FX ==', fxNotes.length, 'luni cu aproximare/lipsă');
console.log(fxNotes.slice(0, 30).join('\n'));
