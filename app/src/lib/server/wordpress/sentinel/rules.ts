/**
 * Regulile Sentinel — funcții pure, fără db. Trăiesc în CRM ca să se schimbe
 * fără release de plugin. `classify` dă nivelul unui eveniment izolat;
 * `detectFindings` primește evenimentele NOI ale unei citiri (pullSite scoate ce
 * e deja în tabel) + starea site-ului și întoarce findings-urile și starea următoare.
 */
import type { Finding, SentinelEvent, SentinelLevel, SentinelScan, SentinelState } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
/** IP-urile biroului OTS. */
export const OTS_IPS = new Set(['82.77.19.195', '213.157.186.85']);
/** Site-ul marchează ALERT de la 6; un import CSV WooCommerce sau un meniu salvat trec de 5. */
export const MASS_INSERT_THRESHOLD = 20;
export const BRUTE_FORCE_MIN = 3;
/** 7 zile: pe nevada, trei eșecuri pe username-ul real de admin au venit la câte două zile distanță. */
export const BRUTE_FORCE_WINDOW_MS = 7 * DAY_MS;
export const ADMIN_IP_MEMORY_MS = 90 * DAY_MS;
const CONNECTOR_PLUGIN_PREFIX = 'ots-wp-connector/';
const HARMLESS_ROLES = new Set(['customer', 'subscriber']);
/** Evenimente ale mu-plugin-ului 1.1 (neportate) care merită 🔴. php_in_uploads nu: scanarea conectorului îl acoperă. */
const LEGACY_CRITICAL = new Set(['fisiere_modificate', 'upload_blocat']);
const PRIVATE_IP = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|f[cd])/i;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0);
const roles = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const isAdminRoles = (v: unknown) => roles(v).includes('administrator');
const login = (e: SentinelEvent) => str(e.date.login) || (e.user !== '-' ? e.user : '');
const isConnectorPlugin = (e: SentinelEvent) => str(e.date.plugin).startsWith(CONNECTOR_PLUGIN_PREFIX);

/**
 * `ip` vine din CF-Connecting-IP / X-Forwarded-For, pe care oricine le poate
 * falsifica pe un site fără proxy. IP-ul OTS contează doar dacă și `ip_remote`
 * (REMOTE_ADDR) e OTS, privat (proxy local) sau lipsește (linie veche).
 */
export function isOtsIp(e: SentinelEvent): boolean {
	if (!OTS_IPS.has(e.ip)) return false;
	const r = e.ip_remote;
	return r === undefined || r === '' || OTS_IPS.has(r) || PRIVATE_IP.test(r);
}

function isAdminProfile(e: SentinelEvent, state: SentinelState): boolean {
	if (Array.isArray(e.date.roluri)) return isAdminRoles(e.date.roluri);
	return login(e) in state.adminIps; // linie veche fără roluri
}

export function classify(e: SentinelEvent, state: SentinelState): SentinelLevel {
	switch (e.ev) {
		case 'role_changed':
			return str(e.date.rol_nou) === 'administrator' ? 'critical' : 'normal';
		case 'user_registered':
			if (isAdminRoles(e.date.roluri)) return 'critical';
			return roles(e.date.roluri).every((r) => HARMLESS_ROLES.has(r)) ? 'normal' : 'important';
		case 'option_changed':
			return 'critical';
		case 'post_created':
			return num(e.date.nr_in_request) > MASS_INSERT_THRESHOLD ? 'critical' : 'normal';
		case 'plugin_deactivated':
			if (isConnectorPlugin(e)) return 'critical';
			return isOtsIp(e) ? 'normal' : 'important';
		case 'plugin_activated':
			return isConnectorPlugin(e) || isOtsIp(e) ? 'normal' : 'important';
		case 'theme_switched':
			return isOtsIp(e) ? 'normal' : 'important';
		case 'profile_update':
			return isAdminProfile(e, state) ? 'important' : 'normal';
		case 'login_ok':
			if (!isAdminRoles(e.date.roluri) || isOtsIp(e)) return 'normal';
			return state.adminIps[login(e)]?.[e.ip] ? 'normal' : 'important';
		default:
			return LEGACY_CRITICAL.has(e.ev) ? 'critical' : 'normal';
	}
}

export interface DetectInput {
	events: SentinelEvent[]; // doar evenimentele noi ale citirii
	scan: SentinelScan | null;
	state: SentinelState; // de DINAINTE de citire
	now: Date;
}

export interface DetectOutput {
	findings: Finding[];
	nextState: SentinelState;
	/** nivelul fiecărui eveniment (id → level), pentru insert */
	levels: Map<string, SentinelLevel>;
}

function cloneIps(src: SentinelState['adminIps']): SentinelState['adminIps'] {
	return Object.fromEntries(Object.entries(src).map(([u, ips]) => [u, { ...ips }]));
}

export function detectFindings({ events, scan, state, now }: DetectInput): DetectOutput {
	const firstPull = !state.baselineDone;
	// Prima citire: IP-urile de admin din lot devin cunoscute înainte de clasificare (baseline).
	const ctx: SentinelState = firstPull ? { ...state, adminIps: cloneIps(state.adminIps) } : state;
	if (firstPull) {
		for (const e of events) {
			if (e.ev === 'login_ok' && isAdminRoles(e.date.roluri) && e.ip && !isOtsIp(e)) {
				const u = login(e);
				ctx.adminIps[u] = { ...(ctx.adminIps[u] ?? {}), [e.ip]: e.t };
			}
		}
	}
	const next: SentinelState = {
		baselineDone: true,
		uploadsBaseline: { ...state.uploadsBaseline },
		adminIps: cloneIps(ctx.adminIps),
		failedLogins: Object.fromEntries(Object.entries(state.failedLogins).map(([u, l]) => [u, [...l]])),
		pendingFindings: state.pendingFindings,
		lastError: null
	};
	const findings: Finding[] = [];
	const levels = new Map<string, SentinelLevel>();
	const seenNewIp = new Set<string>(); // `${user}|${ip}`
	const adminUsersFlagged = new Set<string>(); // id-ul userului: user_registered + role_changed = un finding
	const newFailUsers = new Set<string>();
	let massInsert: Finding | null = null;

	// admini cunoscuți: pentru liniile vechi de login_esuat, fără `exista`
	const knownAdmins = new Set(Object.keys(ctx.adminIps));
	for (const e of events) if (e.ev === 'login_ok' && isAdminRoles(e.date.roluri)) knownAdmins.add(login(e));

	for (const e of events) {
		const level = classify(e, ctx);
		levels.set(e.id, level);

		if (e.ev === 'login_ok') {
			if (isAdminRoles(e.date.roluri) && e.ip && !isOtsIp(e)) {
				const u = login(e);
				const key = `${u}|${e.ip}`;
				if (level === 'important' && !seenNewIp.has(key)) {
					seenNewIp.add(key);
					const remote = e.ip_remote && e.ip_remote !== e.ip && !PRIVATE_IP.test(e.ip_remote) ? ` (remote ${e.ip_remote})` : '';
					findings.push({ level: 'important', kind: 'admin_new_ip', text: `logare admin ${u} de pe IP nou ${e.ip}${remote}` });
				}
				next.adminIps[u] = { ...(next.adminIps[u] ?? {}), [e.ip]: e.t };
			}
			continue;
		}

		if (e.ev === 'login_esuat') {
			const u = login(e);
			const exists = e.date.exista === true || (e.date.exista === undefined && knownAdmins.has(u));
			if (u && exists && now.getTime() - Date.parse(e.t) <= BRUTE_FORCE_WINDOW_MS) {
				const list = (next.failedLogins[u] ??= []);
				if (!list.some((f) => f.t === e.t && f.ip === e.ip)) {
					list.push({ t: e.t, ip: e.ip });
					newFailUsers.add(u);
				}
			}
			continue;
		}

		if (level === 'normal') continue;

		const uid = String(e.date.id ?? '');
		switch (e.ev) {
			case 'role_changed':
				if (uid && adminUsersFlagged.has(uid)) break;
				adminUsersFlagged.add(uid);
				findings.push({ level: 'critical', kind: 'admin_role', text: `userul #${uid} a devenit administrator` });
				break;
			case 'user_registered':
				if (level === 'critical') {
					if (uid && adminUsersFlagged.has(uid)) break;
					adminUsersFlagged.add(uid);
					findings.push({ level: 'critical', kind: 'admin_registered', text: `administrator nou ${login(e)} (${str(e.date.email)})` });
				} else {
					findings.push({ level: 'important', kind: 'user_registered', text: `utilizator nou ${login(e)} cu rol ${roles(e.date.roluri).join(', ') || '?'}` });
				}
				break;
			case 'option_changed':
				findings.push({ level: 'critical', kind: 'option_changed', text: `opțiunea ${str(e.date.option)} schimbată în „${String(e.date.nou ?? '')}”` });
				break;
			case 'post_created':
				massInsert = {
					level: 'critical',
					kind: 'mass_insert',
					text: `${num(e.date.nr_in_request)} articole într-o singură cerere (${str((e.date.sursa as Record<string, unknown> | undefined)?.context) || '?'})`
				};
				break;
			case 'plugin_deactivated':
				findings.push(
					level === 'critical'
						? { level: 'critical', kind: 'connector_deactivated', text: 'conectorul OTS a fost dezactivat' }
						: { level: 'important', kind: 'plugin_change', text: `plugin dezactivat: ${str(e.date.plugin)} (${e.user}, ${e.ip})` }
				);
				break;
			case 'plugin_activated':
				findings.push({ level: 'important', kind: 'plugin_change', text: `plugin activat: ${str(e.date.plugin)} (${e.user}, ${e.ip})` });
				break;
			case 'theme_switched':
				findings.push({ level: 'important', kind: 'theme_switched', text: `temă schimbată: ${str(e.date.theme)} (${e.user}, ${e.ip})` });
				break;
			case 'profile_update':
				findings.push({ level: 'important', kind: 'admin_profile', text: `profil admin ${login(e)} modificat: ${Object.keys((e.date.modificari as object) ?? {}).join(', ')}` });
				break;
			default:
				if (level === 'critical') findings.push({ level: 'critical', kind: 'legacy_alert', text: `${e.ev} raportat de mu-plugin` });
		}
	}
	if (massInsert) findings.push(massInsert);

	// eșecuri: fereastra de 7 zile; finding doar dacă citirea a adus eșecuri noi
	for (const [u, list] of Object.entries(next.failedLogins)) {
		const kept = list.filter((f) => now.getTime() - Date.parse(f.t) <= BRUTE_FORCE_WINDOW_MS);
		if (kept.length === 0) delete next.failedLogins[u];
		else next.failedLogins[u] = kept;
	}
	for (const u of newFailUsers) {
		const list = next.failedLogins[u] ?? [];
		if (list.length < BRUTE_FORCE_MIN) continue;
		const ips = new Set(list.map((f) => f.ip).filter(Boolean)).size;
		findings.push({ level: 'important', kind: 'brute_force', text: `${list.length} logări eșuate pe ${u} în 7 zile (${ips} IP-uri)` });
	}

	// uită IP-urile de admin mai vechi de 90 de zile
	for (const [u, ips] of Object.entries(next.adminIps)) {
		for (const [ip, last] of Object.entries(ips)) {
			if (now.getTime() - Date.parse(last) > ADMIN_IP_MEMORY_MS) delete ips[ip];
		}
		if (Object.keys(ips).length === 0) delete next.adminIps[u];
	}

	if (scan) {
		if (!firstPull) {
			for (const f of scan.files) {
				const knownSha = state.uploadsBaseline[f.path];
				if (knownSha === f.sha1) continue;
				findings.push({ level: 'critical', kind: 'php_in_uploads', text: knownSha ? `PHP modificat în uploads ${f.path}` : `PHP nou în uploads ${f.path}` });
			}
		}
		// scanare trunchiată: păstrăm ce știam, adăugăm ce am văzut
		const seen = Object.fromEntries(scan.files.map((f) => [f.path, f.sha1]));
		next.uploadsBaseline = scan.truncated ? { ...state.uploadsBaseline, ...seen } : seen;
	}

	return { findings, nextState: next, levels };
}
