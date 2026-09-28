/**
 * Regulile Sentinel — funcții pure, fără db. Trăiesc în CRM ca să se schimbe
 * fără release de plugin. `classify` dă nivelul unui eveniment izolat;
 * `detectFindings` primește evenimentele NOI ale unei citiri (pullSite scoate ce
 * e deja în tabel) + starea site-ului și întoarce findings-urile și starea următoare.
 *
 * X-Forwarded-For falsificat: dacă `ip` e un IP OTS dar `ip_remote` nu-l confirmă
 * (vezi `isOtsIp`), tratăm asta ca falsificare țintind biroul și cheia de urmărire
 * (admin IP nou / brute-force) devine `ip_remote` — altfel un al doilea atac, cu
 * XFF falsificat identic dar de pe altă mașină, s-ar ascunde în spatele primului
 * (IP-ul falsificat „devenea cunoscut” definitiv). Limită cunoscută: un XFF
 * falsificat spre un IP NON-OTS rămâne cheiat pe `ip` (nu putem ști ce e falsificat
 * fără o listă de IP-uri de încredere); pe site-uri din spatele Cloudflare, `ip_remote`
 * e un IP de edge rotativ, deci nu-l putem folosi ca cheie generală — prima logare
 * tot alertează, doar reluările de pe alt edge nu se disting de una „cunoscută”.
 */
import { dict, getOwn, type Finding, type SentinelEvent, type SentinelLevel, type SentinelScan, type SentinelState } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
/** IP-urile biroului OTS. */
export const OTS_IPS = new Set(['82.77.19.195', '213.157.186.85']);
/** Site-ul marchează ALERT de la 6; un import CSV WooCommerce sau un meniu salvat trec de 5. */
export const MASS_INSERT_THRESHOLD = 20;
export const BRUTE_FORCE_MIN = 3;
/** 7 zile: pe nevada, trei eșecuri pe username-ul real de admin au venit la câte două zile distanță. */
export const BRUTE_FORCE_WINDOW_MS = 7 * DAY_MS;
export const ADMIN_IP_MEMORY_MS = 90 * DAY_MS;
/** Text tăiat la atât caractere într-un finding (ex. valoarea unei opțiuni WP). */
const TEXT_VALUE_MAX = 80;
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

/** Text scurt pentru finding-uri: obiectele devin JSON, totul se taie la 80 de caractere. */
function fmtValue(v: unknown): string {
	const s = typeof v === 'string' ? v : v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
	return s.length > TEXT_VALUE_MAX ? `${s.slice(0, TEXT_VALUE_MAX)}…` : s;
}

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

/** Cheia de urmărire a IP-ului de admin — vezi header-ul fișierului (XFF falsificat). */
function adminIpKey(e: SentinelEvent): string {
	return OTS_IPS.has(e.ip) && !isOtsIp(e) && e.ip_remote ? e.ip_remote : e.ip;
}

function isAdminProfile(e: SentinelEvent, state: SentinelState): boolean {
	if (Array.isArray(e.date.roluri)) return isAdminRoles(e.date.roluri);
	return Object.hasOwn(state.adminIps, login(e)); // linie veche fără roluri
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
			return getOwn(getOwn(state.adminIps, login(e)), adminIpKey(e)) ? 'normal' : 'important';
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
	const out = dict<Record<string, string>>();
	for (const u of Object.keys(src)) out[u] = dict(src[u]);
	return out;
}

/** `map[user][key] = t`, dar nu merge niciodată înapoi în timp (comparație pe string ISO). */
function bumpIp(map: SentinelState['adminIps'], user: string, key: string, t: string): void {
	const cur = getOwn(map, user);
	const prev = getOwn(cur, key);
	if (!prev || t > prev) map[user] = { ...dict(cur), [key]: t };
}

export function detectFindings({ events, scan, state, now }: DetectInput): DetectOutput {
	const firstPull = !state.baselineDone;
	// Prima citire: IP-urile de admin din lot devin cunoscute înainte de clasificare (baseline).
	const ctx: SentinelState = firstPull ? { ...state, adminIps: cloneIps(state.adminIps) } : state;
	if (firstPull) {
		for (const e of events) {
			if (e.ev === 'login_ok' && isAdminRoles(e.date.roluri) && e.ip && !isOtsIp(e)) {
				bumpIp(ctx.adminIps, login(e), adminIpKey(e), e.t);
			}
		}
	}
	const failedLogins = dict<Array<{ t: string; ip: string; id?: string }>>();
	for (const u of Object.keys(state.failedLogins)) failedLogins[u] = [...state.failedLogins[u]];

	const next: SentinelState = {
		baselineDone: true,
		scanBaselineDone: state.scanBaselineDone,
		uploadsBaseline: dict(state.uploadsBaseline),
		adminIps: cloneIps(ctx.adminIps),
		failedLogins,
		pendingFindings: [...state.pendingFindings], // copie: nu mutăm starea de intrare
		lastError: null
	};
	const findings: Finding[] = [];
	const levels = new Map<string, SentinelLevel>();
	const seenNewIp = new Set<string>(); // `${user}|${adminIpKey}`
	const adminUsersFlagged = new Set<string>(); // id-ul userului: user_registered + role_changed = un finding
	const newFailUsers = new Set<string>();
	let massInsert: Finding | null = null;
	let massInsertMax = -Infinity;

	// admini cunoscuți: pentru liniile vechi de login_esuat, fără `exista`
	const knownAdmins = new Set(Object.keys(ctx.adminIps));
	for (const e of events) if (e.ev === 'login_ok' && isAdminRoles(e.date.roluri)) knownAdmins.add(login(e));

	for (const e of events) {
		const level = classify(e, ctx);
		levels.set(e.id, level);

		if (e.ev === 'login_ok') {
			if (isAdminRoles(e.date.roluri) && e.ip && !isOtsIp(e)) {
				const u = login(e);
				const key = adminIpKey(e);
				const dedupKey = `${u}|${key}`;
				if (level === 'important' && !seenNewIp.has(dedupKey)) {
					seenNewIp.add(dedupKey);
					const remote = e.ip_remote && e.ip_remote !== e.ip && !PRIVATE_IP.test(e.ip_remote) ? ` (remote ${e.ip_remote})` : '';
					findings.push({ level: 'important', kind: 'admin_new_ip', text: `logare admin ${u} de pe IP nou ${e.ip}${remote}` });
				}
				bumpIp(next.adminIps, u, key, e.t);
			}
			continue;
		}

		if (e.ev === 'login_esuat') {
			const u = login(e);
			const exists = e.date.exista === true || (e.date.exista === undefined && knownAdmins.has(u));
			if (u && exists && now.getTime() - Date.parse(e.t) <= BRUTE_FORCE_WINDOW_MS) {
				const list = Object.hasOwn(next.failedLogins, u) ? next.failedLogins[u] : (next.failedLogins[u] = []);
				// dedup pe id (evenimente reale distincte pot avea același t+ip, ex. cereri simultane);
				// intrările vechi fără `id` (stare dinainte de migrare) cad pe fallback-ul t+ip.
				const dup = list.some((f) => (f.id && e.id ? f.id === e.id : f.t === e.t && f.ip === e.ip));
				if (!dup) {
					list.push({ t: e.t, ip: e.ip, id: e.id });
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
				findings.push({ level: 'critical', kind: 'option_changed', text: `opțiunea ${str(e.date.option)} schimbată în „${fmtValue(e.date.nou)}”` });
				break;
			case 'post_created': {
				const n = num(e.date.nr_in_request);
				if (n > massInsertMax) {
					massInsertMax = n;
					massInsert = {
						level: 'critical',
						kind: 'mass_insert',
						text: `${n} articole într-o singură cerere (${str((e.date.sursa as Record<string, unknown> | undefined)?.context) || '?'})`
					};
				}
				break;
			}
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
	for (const u of Object.keys(next.failedLogins)) {
		const kept = next.failedLogins[u].filter((f) => now.getTime() - Date.parse(f.t) <= BRUTE_FORCE_WINDOW_MS);
		if (kept.length === 0) delete next.failedLogins[u];
		else next.failedLogins[u] = kept;
	}
	for (const u of newFailUsers) {
		const list = getOwn(next.failedLogins, u) ?? [];
		if (list.length < BRUTE_FORCE_MIN) continue;
		const ips = new Set(list.map((f) => f.ip).filter(Boolean)).size;
		findings.push({ level: 'important', kind: 'brute_force', text: `${list.length} logări eșuate pe ${u} în 7 zile (${ips} IP-uri)` });
	}

	// uită IP-urile de admin mai vechi de 90 de zile
	for (const u of Object.keys(next.adminIps)) {
		const ips = next.adminIps[u];
		for (const ip of Object.keys(ips)) {
			if (now.getTime() - Date.parse(ips[ip]) > ADMIN_IP_MEMORY_MS) delete ips[ip];
		}
		if (Object.keys(ips).length === 0) delete next.adminIps[u];
	}

	if (scan) {
		if (state.scanBaselineDone) {
			for (const f of scan.files) {
				const knownSha = getOwn(state.uploadsBaseline, f.path);
				if (knownSha === f.sha1) continue;
				findings.push({ level: 'critical', kind: 'php_in_uploads', text: knownSha ? `PHP modificat în uploads ${f.path}` : `PHP nou în uploads ${f.path}` });
			}
		}
		// scanare trunchiată: păstrăm ce știam, adăugăm ce am văzut
		const seen = dict<string>();
		for (const f of scan.files) seen[f.path] = f.sha1;
		next.uploadsBaseline = scan.truncated ? Object.assign(dict(state.uploadsBaseline), seen) : seen;
		next.scanBaselineDone = true;
	}

	return { findings, nextState: next, levels };
}
