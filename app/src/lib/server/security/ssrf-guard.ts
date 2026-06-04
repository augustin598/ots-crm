/**
 * SSRF guard for server-side fetches that take a user-influenced URL
 * (e.g. sitemap/SEO discovery against a client-supplied website URL).
 *
 * Blocks: non-http(s) schemes, embedded credentials, localhost names, and any
 * hostname that resolves to a private / loopback / link-local / unique-local /
 * cloud-metadata address. `safeFetch` additionally follows redirects manually
 * and re-validates every hop so a public URL can't 30x-redirect to an internal
 * one.
 *
 * Residual: DNS rebinding (TOCTOU between lookup and the kernel's own resolve)
 * is not fully closed — would require pinning the resolved IP into the socket.
 */
import { lookup } from 'node:dns/promises';
import net from 'node:net';

function isPrivateIp(ip: string): boolean {
	if (net.isIPv4(ip)) {
		const p = ip.split('.').map(Number);
		if (p[0] === 0) return true; // 0.0.0.0/8
		if (p[0] === 10) return true; // private
		if (p[0] === 127) return true; // loopback
		if (p[0] === 169 && p[1] === 254) return true; // link-local + cloud metadata 169.254.169.254
		if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true; // private
		if (p[0] === 192 && p[1] === 168) return true; // private
		if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT 100.64/10
		if (p[0] >= 224) return true; // multicast / reserved
		return false;
	}
	if (net.isIPv6(ip)) {
		const lower = ip.toLowerCase();
		if (lower === '::' || lower === '::1') return true; // unspecified / loopback
		if (lower.startsWith('fe80')) return true; // link-local
		if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique-local
		if (lower.startsWith('::ffff:')) return isPrivateIp(lower.slice('::ffff:'.length)); // IPv4-mapped
		if (lower.startsWith('fec0')) return true; // deprecated site-local
		return false;
	}
	return true; // unparseable → unsafe
}

/**
 * Throws if `rawUrl` is not a safe, public http(s) URL.
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
	let u: URL;
	try {
		u = new URL(rawUrl);
	} catch {
		throw new Error('URL invalid');
	}
	if (u.protocol !== 'http:' && u.protocol !== 'https:') {
		throw new Error(`Protocol nepermis: ${u.protocol}`);
	}
	if (u.username || u.password) {
		throw new Error('URL cu credențiale nepermis');
	}
	const host = u.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
	if (
		host === 'localhost' ||
		host.endsWith('.localhost') ||
		host === '0.0.0.0' ||
		host === '::1'
	) {
		throw new Error('Host intern nepermis');
	}

	// If the host is already a literal IP, check it directly; otherwise resolve.
	if (net.isIP(host)) {
		if (isPrivateIp(host)) throw new Error('Adresă internă nepermisă (SSRF)');
		return u;
	}

	let addrs: Array<{ address: string }>;
	try {
		addrs = await lookup(host, { all: true });
	} catch {
		throw new Error('Nu s-a putut rezolva hostname-ul');
	}
	if (addrs.length === 0) throw new Error('Hostname fără adrese');
	for (const a of addrs) {
		if (isPrivateIp(a.address)) throw new Error('Adresă internă nepermisă (SSRF)');
	}
	return u;
}

/**
 * fetch() wrapper that validates the URL (and every redirect hop) is public.
 */
export async function safeFetch(
	rawUrl: string,
	init: RequestInit & { maxRedirects?: number } = {}
): Promise<Response> {
	const { maxRedirects = 5, ...rest } = init;
	let url = rawUrl;
	for (let i = 0; i <= maxRedirects; i++) {
		await assertPublicHttpUrl(url);
		const res = await fetch(url, { ...rest, redirect: 'manual' });
		// 3xx with Location → validate next hop and continue
		if (res.status >= 300 && res.status < 400) {
			const loc = res.headers.get('location');
			if (!loc) return res;
			url = new URL(loc, url).toString();
			continue;
		}
		return res;
	}
	throw new Error('Prea multe redirecturi');
}
