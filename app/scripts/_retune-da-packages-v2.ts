#!/usr/bin/env bun
/**
 * V2 retune: align packages with Gemini's 2026 WP/WC recommendations,
 * adjusted for the actual VM capacity (64GB RAM / 16 cores / NVMe).
 *
 * Changes vs v1:
 *  - Memory: ramp scaled for 64GB VM (Extreme capped at 16G Max, not 24G)
 *  - Tasks Max: more aggressive (200/500/800/1500)
 *  - IO Bandwidth: bigger (NVMe can handle it)
 *  - IOPS: bigger (NVMe ceiling, not artificial limit)
 *  - MySQL: 3/10/unlimited/unlimited (dev+staging on entry)
 *  - SSH: enabled from Silver tier
 *  - Email daily limit: 500/1000/2000/5000
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
const srv = r.rows[0] as {
	tenant_id: string;
	hostname: string;
	port: number;
	use_https: number;
	username_encrypted: string;
	password_encrypted: string;
};
const username = decryptCred(srv.tenant_id, srv.username_encrypted, process.env.ENCRYPTION_SECRET!);
const password = decryptCred(srv.tenant_id, srv.password_encrypted, process.env.ENCRYPTION_SECRET!);
const protocol = srv.use_https === 0 ? 'http' : 'https';
const base = `${protocol}://${srv.hostname}:${srv.port}`;
const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');

const COMMON_FLAGS: Record<string, 'ON' | 'OFF'> = {
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
	resources: Record<string, string>;
	limits: Record<string, string>;
	flagsOverride?: Partial<typeof COMMON_FLAGS>;
};

const TIERS: Tier[] = [
	{
		package: 'Wordpress_Standard',
		resources: {
			CPUQuota: '100%',
			IOReadBandwidthMax: '30M',
			IOReadIOPSMax: '3K',
			IOWriteBandwidthMax: '30M',
			IOWriteIOPSMax: '3K',
			MemoryHigh: '1G',
			MemoryMax: '2G',
			TasksMax: '200'
		},
		limits: {
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
			mysql: '3',
			ftp: '1',
			email_daily_limit: '500'
		}
	},
	{
		package: 'Wordpress_Silver',
		resources: {
			CPUQuota: '200%',
			IOReadBandwidthMax: '50M',
			IOReadIOPSMax: '5K',
			IOWriteBandwidthMax: '50M',
			IOWriteIOPSMax: '5K',
			MemoryHigh: '3G',
			MemoryMax: '6G',
			TasksMax: '500'
		},
		limits: {
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
			mysql: '10',
			ftp: '2',
			email_daily_limit: '1000'
		},
		flagsOverride: { redis: 'ON', ssh: 'ON' } // SSH enabled from Silver+
	},
	{
		package: 'Wordpress_Gold',
		resources: {
			CPUQuota: '300%',
			IOReadBandwidthMax: '80M',
			IOReadIOPSMax: '10K',
			IOWriteBandwidthMax: '80M',
			IOWriteIOPSMax: '10K',
			MemoryHigh: '6G',
			MemoryMax: '12G',
			TasksMax: '800'
		},
		limits: {
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
			mysql: 'unlimited',
			ftp: '5',
			email_daily_limit: '2000'
		},
		flagsOverride: { redis: 'ON', ssh: 'ON', git: 'ON', auto_security_txt: 'ON' }
	},
	{
		package: 'Wordpress_Extreme',
		resources: {
			CPUQuota: '400%',
			IOReadBandwidthMax: '150M',
			IOReadIOPSMax: '20K',
			IOWriteBandwidthMax: '150M',
			IOWriteIOPSMax: '20K',
			MemoryHigh: '8G',
			MemoryMax: '16G', // capped at 16G for 64GB VM density
			TasksMax: '1500'
		},
		limits: {
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
			mysql: 'unlimited',
			ftp: '10',
			email_daily_limit: '5000'
		},
		flagsOverride: { redis: 'ON', ssh: 'ON', git: 'ON', auto_security_txt: 'ON' }
	}
];

async function pushTier(t: Tier) {
	const flags = { ...COMMON_FLAGS, ...(t.flagsOverride ?? {}) };
	const params = new URLSearchParams({
		action: 'create',
		add: 'Submit',
		package: t.package,
		...t.resources,
		...t.limits,
		skin: 'evolution',
		language: 'en',
		...flags
	}).toString();

	const res = await fetch(`${base}/CMD_API_PACKAGES_USER`, {
		method: 'POST',
		headers: {
			Authorization: authHeader,
			'Content-Type': 'application/x-www-form-urlencoded',
			Accept: '*/*'
		},
		body: params,
		signal: AbortSignal.timeout(15000),
		// @ts-expect-error Bun TLS
		tls: { rejectUnauthorized: false }
	});
	const text = await res.text();
	const parsed = new URLSearchParams(text);
	const errFlag = parsed.get('error');
	const ok = res.ok && errFlag !== '1';
	return { ok, status: res.status, errFlag, body: text.slice(0, 300) };
}

console.log(`Retuning ${TIERS.length} tiers (v2 — WP/WC modern 2026, 64GB VM)\n`);
for (const t of TIERS) {
	const r = await pushTier(t);
	const icon = r.ok ? '✓' : '✗';
	console.log(
		`${icon} ${t.package.padEnd(22)} → CPU ${t.resources.CPUQuota}, RAM ${t.resources.MemoryHigh}/${t.resources.MemoryMax}, Tasks ${t.resources.TasksMax}, MySQL ${t.limits.mysql}`
	);
	if (!r.ok) console.log(`   ${r.body}`);
}
console.log('\nDone on DA. Now click "Sync pachete" in CRM to refresh DB.');
process.exit(0);
