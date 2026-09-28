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
 * fără o listă de IP-uri de încredere).
 *
 * Cloudflare: pe un site din spatele CF (azi doar wow-agency.ro), `ip_remote`
 * (REMOTE_ADDR) e IP-ul edge-ului CF, nu al clientului — `isOtsIp` îl tratează ca
 * proxy de încredere (ca un IP privat). `adminIpKey` NU trece pe `ip_remote` pentru
 * CF: cum acel edge se rotește la fiecare cerere, ar însemna „cunoscut” la infinit
 * de puțin timp. Rămâne cheiat pe `ip` (CF-Connecting-IP, stabil per client) — exact
 * comportamentul de bază, fără cod suplimentar (`adminIpKey` trece pe `ip_remote`
 * DOAR când `ip`-ul e unul OTS falsificat, nu și pentru clienți obișnuiți din spatele CF).
 *
 * Limită cunoscută (scanare uploads): `mtime` poate fi trucat de un atacator care
 * scrie fișierul — nu ne bazăm pe el pentru „nou vs. vechi”, doar pe sha1 vs. baseline.
 */
import { dict, getOwn, type Finding, type SentinelEvent, type SentinelLevel, type SentinelScan, type SentinelState } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
/** IP-urile biroului OTS. */
export const OTS_IPS = new Set(['82.77.19.195', '213.157.186.85']);
/** Site-ul marchează ALERT de la 6; un import CSV WooCommerce sau un meniu salvat trec de 5. */
export const MASS_INSERT_THRESHOLD = 20;
export const BRUTE_FORCE_MIN = 3;
/** Eșecuri pe cont de client (nu admin): agregat, fără username, în digest — vezi mai jos. */
export const CUSTOMER_BRUTE_FORCE_MIN = 10;
/** 7 zile: pe nevada, trei eșecuri pe username-ul real de admin au venit la câte două zile distanță. */
export const BRUTE_FORCE_WINDOW_MS = 7 * DAY_MS;
export const ADMIN_IP_MEMORY_MS = 90 * DAY_MS;
/** Prefixul cheii din `failedLogins` pentru eșecuri pe conturi de client (nu admin) — vezi `CUSTOMER_BRUTE_FORCE_MIN`. */
const CUSTOMER_FAIL_PREFIX = 'cust:';
/** Text tăiat la atât caractere într-un finding (ex. valoarea unei opțiuni WP). */
const TEXT_VALUE_MAX = 80;
const CONNECTOR_PLUGIN_PREFIX = 'ots-wp-connector/';
const HARMLESS_ROLES = new Set(['customer', 'subscriber']);
/** Evenimente ale mu-plugin-ului 1.1 (neportate) care merită 🔴. php_in_uploads nu: scanarea conectorului îl acoperă. */
const LEGACY_CRITICAL = new Set(['fisiere_modificate', 'upload_blocat']);
const PRIVATE_IP = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|f[cd])/i;

/** Intervale IPv4 publicate de Cloudflare (https://www.cloudflare.com/ips/). */
const CF_IPV4_RANGES: Array<[base: string, bits: number]> = [
	['173.245.48.0', 20],
	['103.21.244.0', 22],
	['103.22.200.0', 22],
	['103.31.4.0', 22],
	['141.101.64.0', 18],
	['108.162.192.0', 18],
	['190.93.240.0', 20],
	['188.114.96.0', 20],
	['197.234.240.0', 22],
	['198.41.128.0', 17],
	['162.158.0.0', 15],
	['104.16.0.0', 13],
	['104.24.0.0', 14],
	['172.64.0.0', 13],
	['131.0.72.0', 22]
];
/** Prefixe IPv6 Cloudflare (lowercase); unele sunt trunchiate intenționat (bloc mai mare decât /32). */
const CF_IPV6_PREFIXES = ['2400:cb00:', '2606:4700:', '2803:f800:', '2405:b500:', '2405:8100:', '2a06:98c', '2c0f:f248:'];

function ipv4ToInt(ip: string): number | null {
	const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
	if (!m) return null;
	const parts = [m[1], m[2], m[3], m[4]].map(Number);
	if (parts.some((p) => p > 255)) return null;
	return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/** IP de edge Cloudflare (IPv4 sau IPv6) — azi doar wow-agency.ro e din spatele CF. */
export function isCloudflareIp(ip: string): boolean {
	if (ip.includes(':')) {
		const lower = ip.toLowerCase();
		return CF_IPV6_PREFIXES.some((p) => lower.startsWith(p));
	}
	const n = ipv4ToInt(ip);
	if (n === null) return false;
	return CF_IPV4_RANGES.some(([base, bits]) => {
		const baseInt = ipv4ToInt(base);
		const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
		return baseInt !== null && (n & mask) === (baseInt & mask);
	});
}

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
	return r === undefined || r === '' || OTS_IPS.has(r) || PRIVATE_IP.test(r) || isCloudflareIp(r);
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
		case 'fisiere_modificate':
			// mu-plugin 1.1: un update de plugin atinge sute de fișiere, iar testele OTS vin de pe IP-ul biroului.
			return e.date.dupa_update === true || isOtsIp(e) ? 'normal' : 'critical';
		case 'upload_blocat':
			return isOtsIp(e) ? 'normal' : 'critical';
		default:
			return LEGACY_CRITICAL.has(e.ev) ? 'critical' : 'normal';
	}
}

/** Textul unui finding 🔴 venit de la mu-plugin-ul 1.1 — cu fișierul, nu doar numele evenimentului. */
function legacyAlertText(e: SentinelEvent): string {
	if (e.ev === 'fisiere_modificate') {
		const first = (key: string) => {
			const list = e.date[key];
			return Array.isArray(list) && list[0] && typeof list[0] === 'object' ? str((list[0] as Record<string, unknown>).f) : '';
		};
		const example = first('lista_noi') || first('lista_modificate');
		return `fișiere modificate pe disc: ${num(e.date.noi)} noi, ${num(e.date.modificate)} modificate, ${num(e.date.sterse)} șterse${example ? ` (${example})` : ''}`;
	}
	if (e.ev === 'upload_blocat') return `upload PHP blocat: ${str(e.date.fisier) || '?'} (${e.ip})`;
	return `${e.ev} raportat de mu-plugin`;
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
		recentFindings: [...state.recentFindings], // pull.ts adaugă findings-urile astei citiri cu `at`
		lastScan: scan ? { at: now.toISOString(), files: scan.files.length, scannedFiles: scan.scannedFiles, truncated: scan.truncated } : state.lastScan,
		lastFailureDay: state.lastFailureDay,
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
			// Conector nou: `date.admin` spune direct dacă username-ul e administrator. Linie veche
			// (`admin` absent): cădem pe comportamentul dinainte — `exista !== false` + admin cunoscut.
			const isAdminTarget = e.date.admin === true || (e.date.admin === undefined && e.date.exista !== false && knownAdmins.has(u));
			// Cont de client, confirmat existent — nu un „admin”/„test” încercat la întâmplare.
			const isCustomerTarget = e.date.admin === false && e.date.exista === true;
			if (u && (isAdminTarget || isCustomerTarget) && now.getTime() - Date.parse(e.t) <= BRUTE_FORCE_WINDOW_MS) {
				// Clienții au propria cheie (prefix), ca să nu apară cu username în digest și ca
				// pragul lor (10) să nu se amestece cu cel de admin (3) — vezi `CUSTOMER_BRUTE_FORCE_MIN`.
				const key = isCustomerTarget ? `${CUSTOMER_FAIL_PREFIX}${u}` : u;
				const list = Object.hasOwn(next.failedLogins, key) ? next.failedLogins[key] : (next.failedLogins[key] = []);
				// dedup pe id (evenimente reale distincte pot avea același t+ip, ex. cereri simultane);
				// intrările vechi fără `id` (stare dinainte de migrare) cad pe fallback-ul t+ip.
				const dup = list.some((f) => (f.id && e.id ? f.id === e.id : f.t === e.t && f.ip === e.ip));
				if (!dup) {
					list.push({ t: e.t, ip: e.ip, id: e.id });
					newFailUsers.add(key);
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
				if (level === 'critical') findings.push({ level: 'critical', kind: 'legacy_alert', text: legacyAlertText(e) });
		}
	}
	if (massInsert) findings.push(massInsert);

	// eșecuri: fereastra de 7 zile; finding doar dacă citirea a adus eșecuri noi
	for (const u of Object.keys(next.failedLogins)) {
		const kept = next.failedLogins[u].filter((f) => now.getTime() - Date.parse(f.t) <= BRUTE_FORCE_WINDOW_MS);
		if (kept.length === 0) delete next.failedLogins[u];
		else next.failedLogins[u] = kept;
	}
	for (const key of newFailUsers) {
		if (key.startsWith(CUSTOMER_FAIL_PREFIX)) continue; // clienții se agregă mai jos, fără username
		const list = getOwn(next.failedLogins, key) ?? [];
		if (list.length < BRUTE_FORCE_MIN) continue;
		const ips = new Set(list.map((f) => f.ip).filter(Boolean)).size;
		findings.push({ level: 'important', kind: 'brute_force', text: `${list.length} logări eșuate pe ${key} în 7 zile (${ips} IP-uri)` });
	}
	// clienți: UN singur finding agregat pe citire, fără username/email (PII pe Telegram) — doar
	// dacă citirea asta a adus un eșec nou pentru cel puțin un cont de client peste prag.
	if ([...newFailUsers].some((k) => k.startsWith(CUSTOMER_FAIL_PREFIX))) {
		const overThreshold = Object.keys(next.failedLogins).filter(
			(k) => k.startsWith(CUSTOMER_FAIL_PREFIX) && next.failedLogins[k].length >= CUSTOMER_BRUTE_FORCE_MIN
		).length;
		if (overThreshold > 0) {
			findings.push({
				level: 'important',
				kind: 'brute_force',
				text: `${overThreshold} conturi de client cu ≥${CUSTOMER_BRUTE_FORCE_MIN} logări eșuate în 7 zile`
			});
		}
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
		const seen = dict<string>();
		for (const f of scan.files) seen[f.path] = f.sha1;

		if (!state.scanBaselineDone) {
			// Baseline încă în construcție (eventual pe mai multe citiri, dacă tot trunchiază):
			// unim ce am văzut, FĂRĂ findings — nu știm încă ce e „nou” cât nu am văzut totul.
			// Devine gata abia la un scan care NU a trunchiat (a văzut tot uploads/).
			next.uploadsBaseline = Object.assign(dict(state.uploadsBaseline), seen);
			next.scanBaselineDone = !scan.truncated;
		} else if (scan.truncated) {
			// Baseline gata, dar citirea asta a trunchiat: comparăm DOAR ce am primit; restul
			// baseline-ului rămâne neatins (uniune, nu se scot niciodată intrări pe o trunchiere).
			for (const f of scan.files) {
				const knownSha = getOwn(state.uploadsBaseline, f.path);
				if (knownSha === f.sha1) continue;
				findings.push({ level: 'critical', kind: 'php_in_uploads', text: knownSha ? `PHP modificat în uploads ${f.path}` : `PHP nou în uploads ${f.path}` });
			}
			next.uploadsBaseline = Object.assign(dict(state.uploadsBaseline), seen);
		} else {
			// Baseline gata, scanare completă: comparăm tot, apoi înlocuim autoritar.
			for (const f of scan.files) {
				const knownSha = getOwn(state.uploadsBaseline, f.path);
				if (knownSha === f.sha1) continue;
				findings.push({ level: 'critical', kind: 'php_in_uploads', text: knownSha ? `PHP modificat în uploads ${f.path}` : `PHP nou în uploads ${f.path}` });
			}
			next.uploadsBaseline = seen;
		}
	}

	return { findings, nextState: next, levels };
}
