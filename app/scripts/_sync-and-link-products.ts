#!/usr/bin/env bun
/**
 * One-shot: re-sync packages from DA, then upsert/link CRM hosting products.
 *
 * Replicates syncDAPackages logic (calls DA, parses, upserts daPackage rows)
 * + creates/updates hostingProduct rows linked to the new daPackage IDs.
 *
 * Run after _seed-da-packages.ts (which seeds the package limits on DA).
 */
import { createClient } from '@libsql/client';
import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import { encodeBase32LowerCase } from '@oslojs/encoding';

function deriveKey(t: string, s: string) {
	const salt = pbkdf2Sync(s, t, 1000, 32, 'sha256');
	return pbkdf2Sync(s, salt.toString('hex'), 100000, 32, 'sha256');
}
function decryptCred(t: string, d: string, s: string) {
	const k = deriveKey(t, s);
	const [iv, tag, ct] = d.split(':');
	const dp = createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'hex'));
	dp.setAuthTag(Buffer.from(tag, 'hex'));
	return dp.update(ct, 'hex', 'utf8') + dp.final('utf8');
}
function genId() {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

const SERVER_ID = 'o6sp6yl3um3cv3ugsmjbr55n';
const db = createClient({
	url: process.env.SQLITE_URI!,
	authToken: process.env.SQLITE_AUTH_TOKEN
});
const r = await db.execute({
	sql: 'SELECT tenant_id, hostname, port, use_https, username_encrypted, password_encrypted FROM da_server WHERE id = ?',
	args: [SERVER_ID]
});
const srv = r.rows[0] as {
	tenant_id: string;
	hostname: string;
	port: number;
	use_https: number;
	username_encrypted: string;
	password_encrypted: string;
};
const tenantId = srv.tenant_id;
const username = decryptCred(srv.tenant_id, srv.username_encrypted, process.env.ENCRYPTION_SECRET!);
const password = decryptCred(srv.tenant_id, srv.password_encrypted, process.env.ENCRYPTION_SECRET!);
const protocol = srv.use_https === 0 ? 'http' : 'https';
const base = `${protocol}://${srv.hostname}:${srv.port}`;
const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');

async function daFetch(path: string) {
	const res = await fetch(`${base}${path}`, {
		method: 'GET',
		headers: { Authorization: authHeader, Accept: '*/*' },
		signal: AbortSignal.timeout(15000),
		// @ts-expect-error Bun TLS
		tls: { rejectUnauthorized: false }
	});
	const text = await res.text();
	if (!res.ok) throw new Error(`DA ${res.status} ${path}: ${text.slice(0, 200)}`);
	return text;
}

// =============== STEP 1: re-sync packages from DA ===============
console.log('=== Step 1: Sync packages from DA ===');

const listText = await daFetch('/CMD_API_PACKAGES_USER');
const listParams = new URLSearchParams(listText);
const packageNames: string[] = [];
for (const key of new Set(listParams.keys())) {
	if (key === 'list[]' || key === 'list') {
		const vals = listParams.getAll(key);
		for (const v of vals) {
			if (v) packageNames.push(...v.split(',').filter(Boolean));
		}
	}
}
console.log(`Found packages on DA: ${packageNames.join(', ')}`);

function parseDetail(text: string) {
	const p = new URLSearchParams(text);
	const num = (k: string): number | null => {
		const v = p.get(k);
		if (v === null || v === '' || v.toLowerCase() === 'unlimited') return null;
		const n = parseInt(v, 10);
		return Number.isFinite(n) ? n : null;
	};
	const bool = (k: string): number => {
		const v = p.get(k)?.toLowerCase();
		return v === 'on' || v === 'yes' || v === '1' || v === 'true' ? 1 : 0;
	};
	const str = (k: string): string | null => {
		const v = p.get(k);
		return v && v.length > 0 ? v : null;
	};
	const raw: Record<string, string> = {};
	for (const k of new Set(p.keys())) {
		raw[k] = p.getAll(k).join(',');
	}
	return {
		bandwidth: num('bandwidth'),
		quota: num('quota'),
		maxEmailAccounts: num('nemails'),
		maxEmailForwarders: num('nemailf'),
		maxMailingLists: num('nemailml'),
		maxAutoresponders: num('nemailr'),
		maxDatabases: num('mysql'),
		maxFtpAccounts: num('ftp'),
		maxDomains: num('vdomains'),
		maxSubdomains: num('nsubdomains'),
		maxDomainPointers: num('domainptr'),
		maxInodes: num('inode'),
		emailDailyLimit: num('email_daily_limit'),
		anonymousFtp: bool('aftp'),
		cgi: bool('cgi'),
		php: bool('php'),
		ssl: bool('ssl'),
		ssh: bool('ssh'),
		dnsControl: bool('dnscontrol'),
		cron: bool('cron'),
		spam: bool('spam'),
		clamav: bool('clamav'),
		wordpress: bool('wordpress'),
		git: bool('git'),
		redis: bool('redis'),
		suspendAtLimit: bool('suspend_at_limit'),
		oversold: bool('oversold'),
		skin: str('skin'),
		language: str('language'),
		raw
	};
}

const now = new Date().toISOString();
const pkgIdByName = new Map<string, string>();

for (const pkgName of packageNames) {
	const detailText = await daFetch(
		`/CMD_API_PACKAGES_USER?package=${encodeURIComponent(pkgName)}`
	);
	const d = parseDetail(detailText);
	const existing = await db.execute({
		sql: 'SELECT id FROM da_package WHERE da_server_id = ? AND da_name = ? AND tenant_id = ? LIMIT 1',
		args: [SERVER_ID, pkgName, tenantId]
	});

	const fields = {
		bandwidth: d.bandwidth,
		quota: d.quota,
		max_email_accounts: d.maxEmailAccounts,
		max_email_forwarders: d.maxEmailForwarders,
		max_mailing_lists: d.maxMailingLists,
		max_autoresponders: d.maxAutoresponders,
		max_databases: d.maxDatabases,
		max_ftp_accounts: d.maxFtpAccounts,
		max_domains: d.maxDomains,
		max_subdomains: d.maxSubdomains,
		max_domain_pointers: d.maxDomainPointers,
		max_inodes: d.maxInodes,
		email_daily_limit: d.emailDailyLimit,
		anonymous_ftp: d.anonymousFtp,
		cgi: d.cgi,
		php: d.php,
		ssl: d.ssl,
		ssh: d.ssh,
		dns_control: d.dnsControl,
		cron: d.cron,
		spam: d.spam,
		clamav: d.clamav,
		wordpress: d.wordpress,
		git: d.git,
		redis: d.redis,
		suspend_at_limit: d.suspendAtLimit,
		oversold: d.oversold,
		skin: d.skin,
		language: d.language,
		raw_data: JSON.stringify(d.raw),
		is_active: 1,
		last_synced_at: now
	};

	if (existing.rows.length === 0) {
		const id = genId();
		const cols = ['id', 'tenant_id', 'da_server_id', 'da_name', 'type', ...Object.keys(fields)];
		const vals = [id, tenantId, SERVER_ID, pkgName, 'user', ...Object.values(fields)];
		await db.execute({
			sql: `INSERT INTO da_package (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
			args: vals as any
		});
		pkgIdByName.set(pkgName, id);
		console.log(`  + inserted ${pkgName}`);
	} else {
		const id = existing.rows[0].id as string;
		const setClauses = Object.keys(fields)
			.map((k) => `${k} = ?`)
			.join(', ');
		await db.execute({
			sql: `UPDATE da_package SET ${setClauses}, updated_at = current_timestamp WHERE id = ?`,
			args: [...(Object.values(fields) as any), id]
		});
		pkgIdByName.set(pkgName, id);
		console.log(`  ~ updated ${pkgName}`);
	}
}

console.log(`\nSynced ${pkgIdByName.size} packages`);

// =============== STEP 2: link CRM products + create Wordpress Premium ===============
console.log('\n=== Step 2: Update CRM hosting products ===');

const featuresCommon = [
	'Backup zilnic',
	'WordPress Toolkit',
	'Transfer Hosting Gratuit',
	'Litespeed + LS Cache',
	'Securitate prin Imunify360',
	'Softaculous',
	'Panou control DirectAdmin',
	'Certificat SSL Gratuit',
	'Support în română'
];

type ProductDef = {
	name: string;
	description: string;
	features: string[];
	highlight: string | null;
	sortOrder: number;
	priceCents: number;
	billingCycle: string;
	daPackageId: string;
};

const STANDARD_ID = pkgIdByName.get('Wordpress_Standard')!;
const SILVER_ID = pkgIdByName.get('Wordpress_Silver')!;
const GOLD_ID = pkgIdByName.get('Wordpress_Gold')!;
const EXTREME_ID = pkgIdByName.get('Wordpress_Extreme')!;

const products: ProductDef[] = [
	{
		name: 'Wordpress Standard',
		description: 'Hosting WordPress optimizat pentru un site cu trafic mic spre mediu',
		features: ['1 site găzduit', '10 GB SSD NVMe', '4 GB RAM', ...featuresCommon],
		highlight: null,
		sortOrder: 0,
		priceCents: 69200,
		billingCycle: 'annually',
		daPackageId: STANDARD_ID
	},
	{
		name: 'Wordpress Pro',
		description: 'Hosting WordPress pentru afaceri în creștere — până la magazine WooCommerce mici',
		features: [
			'1 site + 10 subdomenii',
			'15 GB SSD NVMe',
			'5 GB RAM',
			'5 baze de date MySQL',
			...featuresCommon
		],
		highlight: null,
		sortOrder: 1,
		priceCents: 116900,
		billingCycle: 'annually',
		daPackageId: SILVER_ID
	},
	{
		name: 'Wordpress Premium',
		description: 'Recomandat pentru magazine WooCommerce active — RAM și CPU dublu față de Pro',
		features: [
			'3 site-uri găzduite',
			'30 GB SSD NVMe',
			'8 GB RAM',
			'10 baze de date MySQL',
			'Email & subdomenii nelimitate',
			'JetBackup zilnic',
			...featuresCommon
		],
		highlight: 'Cel mai vândut',
		sortOrder: 2,
		priceCents: 134900,
		billingCycle: 'annually',
		daPackageId: GOLD_ID
	},
	{
		name: 'Wordpress Extreme',
		description: 'Pentru agency / magazine WooCommerce mari, multi-site',
		features: [
			'10 site-uri găzduite',
			'50 GB SSD NVMe',
			'8 GB RAM',
			'20 baze de date MySQL',
			'Resurse nelimitate (email, trafic, inode)',
			'JetBackup Premium',
			...featuresCommon
		],
		highlight: null,
		sortOrder: 3,
		priceCents: 148900,
		billingCycle: 'annually',
		daPackageId: EXTREME_ID
	}
];

for (const p of products) {
	const existing = await db.execute({
		sql: 'SELECT id FROM hosting_product WHERE tenant_id = ? AND name = ? LIMIT 1',
		args: [tenantId, p.name]
	});

	const payload = {
		da_server_id: SERVER_ID,
		da_package_id: p.daPackageId,
		description: p.description,
		features: JSON.stringify(p.features),
		highlight_badge: p.highlight,
		sort_order: p.sortOrder,
		price: p.priceCents,
		currency: 'RON',
		billing_cycle: p.billingCycle,
		setup_fee: 0,
		is_active: 1
	};

	if (existing.rows.length === 0) {
		const id = genId();
		const cols = ['id', 'tenant_id', 'name', ...Object.keys(payload)];
		const vals = [id, tenantId, p.name, ...Object.values(payload)];
		await db.execute({
			sql: `INSERT INTO hosting_product (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
			args: vals as any
		});
		console.log(`  + created ${p.name}  →  ${p.priceCents / 100} RON/${p.billingCycle}`);
	} else {
		const id = existing.rows[0].id as string;
		const setClauses = Object.keys(payload)
			.map((k) => `${k} = ?`)
			.join(', ');
		await db.execute({
			sql: `UPDATE hosting_product SET ${setClauses}, updated_at = current_timestamp WHERE id = ?`,
			args: [...(Object.values(payload) as any), id]
		});
		console.log(`  ~ updated ${p.name}  →  ${p.priceCents / 100} RON/${p.billingCycle}`);
	}
}

// Clear "Cel mai vândut" badge from old Pro (if it was set before)
await db.execute({
	sql: `UPDATE hosting_product SET highlight_badge = NULL WHERE tenant_id = ? AND name = 'Wordpress Pro'`,
	args: [tenantId]
});

console.log('\n=== Final state ===');
const final = await db.execute({
	sql: `SELECT name, price, billing_cycle, is_active, highlight_badge, sort_order, da_package_id IS NOT NULL AS has_pkg FROM hosting_product WHERE tenant_id = ? ORDER BY sort_order, name`,
	args: [tenantId]
});
for (const r of final.rows) console.log(' ', JSON.stringify(r));

console.log('\n✓ Done. Refresh /ots/hosting/products to see the new lineup.');
process.exit(0);
