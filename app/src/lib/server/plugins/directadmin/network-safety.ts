import * as net from 'node:net';
import { promises as dns } from 'node:dns';

export class HostnameNotAllowedError extends Error {
	constructor(
		message: string,
		public reason: 'private_ip' | 'loopback' | 'link_local' | 'multicast' | 'unspecified' | 'invalid' | 'dns_failed'
	) {
		super(message);
		this.name = 'HostnameNotAllowedError';
	}
}

function ipv4ToInt(ip: string): number | null {
	const parts = ip.split('.');
	if (parts.length !== 4) return null;
	let result = 0;
	for (const p of parts) {
		const n = Number(p);
		if (!Number.isInteger(n) || n < 0 || n > 255) return null;
		result = (result << 8) + n;
	}
	return result >>> 0;
}

function inIpv4Range(ip: string, cidr: string): boolean {
	const ipInt = ipv4ToInt(ip);
	if (ipInt === null) return false;
	const [base, prefix] = cidr.split('/');
	const baseInt = ipv4ToInt(base);
	const prefixLen = Number(prefix);
	if (baseInt === null || !Number.isInteger(prefixLen)) return false;
	const mask = prefixLen === 0 ? 0 : (0xffffffff << (32 - prefixLen)) >>> 0;
	return (ipInt & mask) === (baseInt & mask);
}

const BLOCKED_IPV4_RANGES = [
	{ cidr: '10.0.0.0/8', reason: 'private_ip' as const },
	{ cidr: '172.16.0.0/12', reason: 'private_ip' as const },
	{ cidr: '192.168.0.0/16', reason: 'private_ip' as const },
	{ cidr: '127.0.0.0/8', reason: 'loopback' as const },
	{ cidr: '169.254.0.0/16', reason: 'link_local' as const },
	{ cidr: '224.0.0.0/4', reason: 'multicast' as const },
	{ cidr: '0.0.0.0/8', reason: 'unspecified' as const },
	{ cidr: '100.64.0.0/10', reason: 'private_ip' as const },
	{ cidr: '198.18.0.0/15', reason: 'private_ip' as const }
];

const BLOCKED_IPV6_PREFIXES: { prefix: string; reason: HostnameNotAllowedError['reason'] }[] = [
	{ prefix: '::1', reason: 'loopback' },
	{ prefix: '::', reason: 'unspecified' },
	{ prefix: 'fe80:', reason: 'link_local' },
	{ prefix: 'fc', reason: 'private_ip' },
	{ prefix: 'fd', reason: 'private_ip' },
	{ prefix: 'ff', reason: 'multicast' }
];

function checkIpv4(ip: string): HostnameNotAllowedError['reason'] | null {
	for (const range of BLOCKED_IPV4_RANGES) {
		if (inIpv4Range(ip, range.cidr)) return range.reason;
	}
	return null;
}

function checkIpv6(ip: string): HostnameNotAllowedError['reason'] | null {
	const lower = ip.toLowerCase();
	if (lower === '::1') return 'loopback';
	if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return 'unspecified';
	for (const { prefix, reason } of BLOCKED_IPV6_PREFIXES) {
		if (prefix === '::1' || prefix === '::') continue;
		if (lower.startsWith(prefix)) return reason;
	}
	return null;
}

function checkIp(ip: string): HostnameNotAllowedError['reason'] | null {
	const family = net.isIP(ip);
	if (family === 4) return checkIpv4(ip);
	if (family === 6) return checkIpv6(ip);
	return null;
}

/**
 * Validate a hostname before connecting outbound to it. Rejects:
 *  - Literal IPs in private (RFC1918, RFC6598), loopback, link-local, multicast, unspecified ranges.
 *  - Hostnames that resolve (via DNS) to any blocked IP.
 *
 * Throws `HostnameNotAllowedError` on rejection. Returns the resolved IP on success.
 *
 * Note: this does NOT protect against DNS rebinding (attacker resolves clean now, then to
 * 127.0.0.1 between validate and connect). For full protection, the caller should pin the
 * resolved IP and connect to that, not to the hostname. Sprint 5 hardening.
 */
export async function assertHostnameSafe(hostname: string): Promise<string> {
	const trimmed = hostname.trim();
	if (!trimmed) {
		throw new HostnameNotAllowedError('Hostname is empty', 'invalid');
	}

	const literalCheck = checkIp(trimmed);
	if (literalCheck) {
		throw new HostnameNotAllowedError(
			`Hostname resolves to a blocked range (${literalCheck})`,
			literalCheck
		);
	}

	if (net.isIP(trimmed)) {
		return trimmed;
	}

	let resolved: { address: string; family: number }[];
	try {
		resolved = await dns.lookup(trimmed, { all: true });
	} catch {
		throw new HostnameNotAllowedError(`DNS lookup failed for ${trimmed}`, 'dns_failed');
	}

	if (resolved.length === 0) {
		throw new HostnameNotAllowedError(`DNS returned no addresses for ${trimmed}`, 'dns_failed');
	}

	for (const { address } of resolved) {
		const result = checkIp(address);
		if (result) {
			throw new HostnameNotAllowedError(
				`${trimmed} resolves to a blocked address (${address}, ${result})`,
				result
			);
		}
	}

	return resolved[0].address;
}
