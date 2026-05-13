#!/usr/bin/env bun
/**
 * One-shot: push 4 hosting tiers to DirectAdmin via legacy API.
 *
 * Tier progression (Bronze → Extreme), tuned for WordPress + WooCommerce:
 *   - Bronze:   WP blog / vitrină
 *   - Silver:   WC mic (<200 produse)
 *   - Gold:     WC mediu (recomandat pentru magazine active)
 *   - Extreme:  WC mare / agency multi-site
 *
 * Endpoint: POST /CMD_API_PACKAGES_USER?action=create&add=Submit&package=NAME&...
 * DA accepts the SAME endpoint for create + modify — same payload, same call.
 */
import { createClient } from '@libsql/client';
import { createDecipheriv, pbkdf2Sync } from 'node:crypto';

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

const SERVER_ID = 'o6sp6yl3um3cv3ugsmjbr55n';
const db = createClient({
	url: process.env.SQLITE_URI!,
	authToken: process.env.SQLITE_AUTH_TOKEN
});
const r = await db.execute({
	sql: 'SELECT tenant_id, hostname, port, use_https, username_encrypted, password_encrypted FROM da_server WHERE id = ?',
	args: [SERVER_ID]
});
const row = r.rows[0] as {
	tenant_id: string;
	hostname: string;
	port: number;
	use_https: number;
	username_encrypted: string;
	password_encrypted: string;
};
const username = decryptCred(row.tenant_id, row.username_encrypted, process.env.ENCRYPTION_SECRET!);
const password = decryptCred(row.tenant_id, row.password_encrypted, process.env.ENCRYPTION_SECRET!);
const protocol = row.use_https === 0 ? 'http' : 'https';
const base = `${protocol}://${row.hostname}:${row.port}`;
const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');

// Common flags ON for all WordPress hosting tiers (defaults)
const FLAGS_COMMON_ON: Record<string, 'ON' | 'OFF'> = {
	clamav: 'ON',
	php: 'ON',
	spam: 'ON',
	ssl: 'ON',
	dnscontrol: 'ON',
	cron: 'ON',
	wordpress: 'ON',
	catchall: 'ON',
	jail: 'ON',
	login_keys: 'ON',
	sysinfo: 'ON',
	suspend_at_limit: 'ON',
	auto_security_txt: 'OFF',
	cgi: 'OFF',
	aftp: 'OFF',
	ssh: 'OFF',
	git: 'OFF',
	redis: 'OFF'
};

type Tier = {
	package: string;
	CPUQuota: string;
	IOReadBandwidthMax: string;
	IOReadIOPSMax: string;
	IOWriteBandwidthMax: string;
	IOWriteIOPSMax: string;
	MemoryHigh: string;
	MemoryMax: string;
	TasksMax: string;
	bandwidth: string;
	quota: string;
	inode: string;
	vdomains: string;
	nsubdomains: string;
	domainptr: string;
	nemails: string;
	nemailf: string;
	nemailml: string;
	nemailr: string;
	mysql: string;
	ftp: string;
	email_daily_limit: string;
	flags: Partial<Record<keyof typeof FLAGS_COMMON_ON, 'ON' | 'OFF'>>;
	skin: string;
	language: string;
};

const TIERS: Tier[] = [
	{
		// === Wordpress_Standard (Bronze) — WP blog / vitrină ===
		package: 'Wordpress_Standard',
		CPUQuota: '100%',
		IOReadBandwidthMax: '10M',
		IOReadIOPSMax: '2K',
		IOWriteBandwidthMax: '10M',
		IOWriteIOPSMax: '2K',
		MemoryHigh: '1G',
		MemoryMax: '2G',
		TasksMax: '150',
		bandwidth: '100000', // 100 GB
		quota: '10240', // 10 GB
		inode: '250000',
		vdomains: '1',
		nsubdomains: '0',
		domainptr: '0',
		nemails: '10',
		nemailf: '0',
		nemailml: '0',
		nemailr: '1',
		mysql: '1',
		ftp: '1',
		email_daily_limit: '200',
		flags: {},
		skin: 'evolution',
		language: 'en'
	},
	{
		// === Wordpress_Silver — WC mic ===
		package: 'Wordpress_Silver',
		CPUQuota: '200%',
		IOReadBandwidthMax: '20M',
		IOReadIOPSMax: '3K',
		IOWriteBandwidthMax: '20M',
		IOWriteIOPSMax: '3K',
		MemoryHigh: '2G',
		MemoryMax: '5G',
		TasksMax: '400',
		bandwidth: 'unlimited',
		quota: '15360', // 15 GB
		inode: 'unlimited',
		vdomains: '1',
		nsubdomains: '10',
		domainptr: '1',
		nemails: '10',
		nemailf: '5',
		nemailml: '0',
		nemailr: '10',
		mysql: '5',
		ftp: '2',
		email_daily_limit: '300',
		flags: { redis: 'ON' },
		skin: 'evolution',
		language: 'en'
	},
	{
		// === Wordpress_Gold — WC mediu (RECOMANDAT) ===
		package: 'Wordpress_Gold',
		CPUQuota: '300%',
		IOReadBandwidthMax: '30M',
		IOReadIOPSMax: '4K',
		IOWriteBandwidthMax: '30M',
		IOWriteIOPSMax: '4K',
		MemoryHigh: '4G',
		MemoryMax: '8G',
		TasksMax: '700',
		bandwidth: 'unlimited',
		quota: '30720', // 30 GB
		inode: 'unlimited',
		vdomains: '3',
		nsubdomains: 'unlimited',
		domainptr: '3',
		nemails: 'unlimited',
		nemailf: 'unlimited',
		nemailml: 'unlimited',
		nemailr: 'unlimited',
		mysql: '10',
		ftp: '5',
		email_daily_limit: '500',
		flags: { redis: 'ON', git: 'ON', auto_security_txt: 'ON' },
		skin: 'evolution',
		language: 'en'
	},
	{
		// === Wordpress_Extreme — WC mare / agency ===
		package: 'Wordpress_Extreme',
		CPUQuota: '400%',
		IOReadBandwidthMax: '50M',
		IOReadIOPSMax: '5K',
		IOWriteBandwidthMax: '50M',
		IOWriteIOPSMax: '5K',
		MemoryHigh: '4G',
		MemoryMax: '8G',
		TasksMax: '1024',
		bandwidth: 'unlimited',
		quota: '51200', // 50 GB
		inode: 'unlimited',
		vdomains: '10',
		nsubdomains: 'unlimited',
		domainptr: '5',
		nemails: 'unlimited',
		nemailf: 'unlimited',
		nemailml: 'unlimited',
		nemailr: 'unlimited',
		mysql: '20',
		ftp: '10',
		email_daily_limit: '1000',
		flags: { redis: 'ON', git: 'ON', auto_security_txt: 'ON' },
		skin: 'evolution',
		language: 'en'
	}
];

async function pushTier(t: Tier) {
	const flags = { ...FLAGS_COMMON_ON, ...t.flags };
	const params: Record<string, string> = {
		action: 'create',
		add: 'Submit',
		package: t.package,
		CPUQuota: t.CPUQuota,
		IOReadBandwidthMax: t.IOReadBandwidthMax,
		IOReadIOPSMax: t.IOReadIOPSMax,
		IOWriteBandwidthMax: t.IOWriteBandwidthMax,
		IOWriteIOPSMax: t.IOWriteIOPSMax,
		MemoryHigh: t.MemoryHigh,
		MemoryMax: t.MemoryMax,
		TasksMax: t.TasksMax,
		bandwidth: t.bandwidth,
		quota: t.quota,
		inode: t.inode,
		vdomains: t.vdomains,
		nsubdomains: t.nsubdomains,
		domainptr: t.domainptr,
		nemails: t.nemails,
		nemailf: t.nemailf,
		nemailml: t.nemailml,
		nemailr: t.nemailr,
		mysql: t.mysql,
		ftp: t.ftp,
		email_daily_limit: t.email_daily_limit,
		skin: t.skin,
		language: t.language,
		...flags
	};

	const body = new URLSearchParams(params).toString();
	const res = await fetch(`${base}/CMD_API_PACKAGES_USER`, {
		method: 'POST',
		headers: {
			Authorization: authHeader,
			'Content-Type': 'application/x-www-form-urlencoded',
			Accept: '*/*'
		},
		body,
		signal: AbortSignal.timeout(15000),
		// @ts-expect-error Bun TLS
		tls: { rejectUnauthorized: false }
	});
	const text = await res.text();
	const parsed = new URLSearchParams(text);
	const errorFlag = parsed.get('error');
	const errorText = parsed.get('text') ?? parsed.get('details') ?? '';
	const ok = res.ok && errorFlag !== '1';
	return { ok, status: res.status, errorFlag, errorText, body: text.slice(0, 400) };
}

console.log(`Pushing ${TIERS.length} tiers to DA at ${base}\n`);
for (const tier of TIERS) {
	const result = await pushTier(tier);
	const status = result.ok ? '✓' : '✗';
	console.log(
		`${status} ${tier.package.padEnd(22)} status=${result.status} err=${result.errorFlag ?? '-'} ${result.ok ? '' : result.errorText}`
	);
	if (!result.ok) {
		console.log(`  body: ${result.body}`);
	}
}
console.log('\nDone. Now go to CRM /hosting/servers/<id> and click "Sync pachete".');
process.exit(0);
