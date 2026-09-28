import { describe, test, expect } from 'bun:test';
import { detectFindings, classify, isOtsIp, isCloudflareIp, MASS_INSERT_THRESHOLD, CUSTOMER_BRUTE_FORCE_MIN } from '../rules';
import { emptyState, type SentinelState } from '../types';
import { loadFixture, ev } from './fixtures/load';

const NOW = new Date('2026-09-28T12:00:00Z');
const run = (events: ReturnType<typeof loadFixture>, state: SentinelState = emptyState(), scan: Parameters<typeof detectFindings>[0]['scan'] = null, now = NOW) =>
	detectFindings({ events, scan, state, now });
const known = (over: Partial<SentinelState> = {}): SentinelState => ({ ...emptyState(), baselineDone: true, ...over });
const admin = (ip: string, t: string, ip_remote?: string, u = 'adm') =>
	ev({ ev: 'login_ok', t, ip, ip_remote, date: { login: u, roluri: ['administrator'] } });
// exista undefined → linie veche mu-plugin (fără `admin`, cade pe fallback-ul „admin cunoscut").
// exista dat explicit → simulează conector nou; toate apelurile din fișier țintesc conturi de
// admin (`adm`/`constructor`) sau conturi inexistente (`ghost`), deci `admin` urmează `exista`.
const fail = (login: string, ip: string, t: string, exista?: boolean) =>
	ev({ ev: 'login_esuat', t, ip, date: exista === undefined ? { login } : { login, exista, admin: exista === true } });

describe('fixture nevada (date reale)', () => {
	test('prima citire: exact un finding — 🟠 brute-force lent, 3 eșecuri, 3 IP-uri', () => {
		const { findings } = run(loadFixture('nevada'));
		expect(findings).toHaveLength(1);
		expect(findings[0]).toEqual(expect.objectContaining({ level: 'important', kind: 'brute_force' }));
		expect(findings[0].text).toMatch(/^3 logări eșuate pe user_\d+ în 7 zile \(3 IP-uri\)$/);
	});
	test('a doua citire cu aceleași evenimente (suprapunere): nimic nou', () => {
		const events = loadFixture('nevada');
		const first = run(events);
		expect(first.nextState.baselineDone).toBe(true);
		expect(run(events, first.nextState).findings).toHaveLength(0);
	});
	test('php_in_uploads de la mu-plugin și plugin-urile activate de pe IP OTS sunt ⚪', () => {
		const events = loadFixture('nevada');
		const { levels } = run(events);
		for (const e of events.filter((e) => ['php_in_uploads', 'plugin_activated', 'plugin_deactivated', 'upgrader', 'post_created'].includes(e.ev))) {
			expect(levels.get(e.id)).toBe('normal');
		}
	});
});

describe('fixture areni (date reale)', () => {
	test('prima citire: fără findings; logările de admin istorice sunt ⚪ (baseline)', () => {
		const events = loadFixture('areni');
		const { findings, levels, nextState } = run(events);
		expect(findings).toHaveLength(0);
		for (const e of events.filter((e) => e.ev === 'login_ok')) expect(levels.get(e.id)).toBe('normal');
		expect(Object.keys(nextState.adminIps).length).toBeGreaterThan(0);
	});
});

describe('reguli sintetice', () => {
	test('role_changed → administrator = 🔴', () => {
		const { findings } = run([ev({ ev: 'role_changed', t: '2026-09-28T08:00:00Z', date: { id: 7, rol_nou: 'administrator', roluri_vechi: ['editor'] } })], known());
		expect(findings).toEqual([expect.objectContaining({ level: 'critical', kind: 'admin_role' })]);
	});

	test('user_registered admin + role_changed pe același user = un singur finding', () => {
		const { findings } = run(
			[
				ev({ ev: 'user_registered', t: '2026-09-28T08:00:00Z', date: { id: 7, login: 'x', email: 'x@y.ro', roluri: ['administrator'] } }),
				ev({ ev: 'role_changed', t: '2026-09-28T08:00:01Z', date: { id: 7, rol_nou: 'administrator', roluri_vechi: [] } })
			],
			known()
		);
		expect(findings.filter((f) => f.level === 'critical')).toHaveLength(1);
	});

	test('logare admin de pe IP nou = 🟠 o dată per (user, IP); IP OTS verificat = ⚪; IP-ul devine cunoscut', () => {
		const { findings, nextState, levels } = run(
			[
				admin('5.6.7.8', '2026-09-28T08:00:00Z', '5.6.7.8'),
				admin('5.6.7.8', '2026-09-28T08:30:00Z', '5.6.7.8'),
				admin('82.77.19.195', '2026-09-28T08:40:00Z', '82.77.19.195'),
				admin('82.77.19.195', '2026-09-28T08:41:00Z') // linie veche, fără ip_remote
			],
			known()
		);
		expect(findings.filter((f) => f.kind === 'admin_new_ip')).toHaveLength(1);
		expect(nextState.adminIps.adm['5.6.7.8']).toBe('2026-09-28T08:30:00Z');
		expect(nextState.adminIps.adm['82.77.19.195']).toBeUndefined();
		expect([...levels.values()].filter((l) => l === 'important')).toHaveLength(2);
	});

	test('X-Forwarded-For falsificat cu IP OTS de pe un remote public străin = 🟠, cu remote-ul în text', () => {
		const spoof = admin('82.77.19.195', '2026-09-28T08:00:00Z', '203.0.113.9');
		expect(isOtsIp(spoof)).toBe(false);
		const { findings } = run([spoof], known());
		expect(findings).toEqual([expect.objectContaining({ kind: 'admin_new_ip', text: expect.stringContaining('remote 203.0.113.9') })]);
	});

	test('IP-urile de admin mai vechi de 90 de zile se uită', () => {
		const state = known({ adminIps: { adm: { '1.1.1.1': '2026-05-01T00:00:00Z', '2.2.2.2': '2026-09-01T00:00:00Z' } } });
		expect(run([], state).nextState.adminIps).toEqual({ adm: { '2.2.2.2': '2026-09-01T00:00:00Z' } });
	});

	test('brute-force: ≥3 eșecuri cu exista:true în 7 zile; useri inexistenți și eșecuri mai vechi nu contează', () => {
		const { findings } = run(
			[
				fail('adm', '1.1.1.1', '2026-09-27T20:00:00Z', true),
				fail('adm', '2.2.2.2', '2026-09-27T21:00:00Z', true),
				fail('adm', '2.2.2.2', '2026-09-27T22:00:00Z', true),
				fail('ghost', '3.3.3.3', '2026-09-27T22:00:00Z', false),
				fail('ghost', '3.3.3.3', '2026-09-27T22:01:00Z', false),
				fail('ghost', '3.3.3.3', '2026-09-27T22:02:00Z', false),
				fail('adm', '4.4.4.4', '2026-09-20T22:02:00Z', true) // peste 7 zile
			],
			known()
		);
		expect(findings).toEqual([expect.objectContaining({ kind: 'brute_force', level: 'important', text: '3 logări eșuate pe adm în 7 zile (2 IP-uri)' })]);
	});

	test('brute-force lent între citiri: 2 eșecuri din zilele trecute + 1 nou = finding; fără eșec nou = nimic', () => {
		const state = known({ failedLogins: { adm: [{ t: '2026-09-24T10:00:00Z', ip: '1.1.1.1' }, { t: '2026-09-26T10:00:00Z', ip: '2.2.2.2' }] } });
		const withNew = run([fail('adm', '3.3.3.3', '2026-09-28T05:00:00Z', true)], state);
		expect(withNew.findings).toEqual([expect.objectContaining({ kind: 'brute_force', text: '3 logări eșuate pe adm în 7 zile (3 IP-uri)' })]);
		expect(withNew.nextState.failedLogins.adm).toHaveLength(3);
		expect(run([], withNew.nextState).findings).toHaveLength(0);
	});

	test('linie veche fără exista: contează doar dacă username-ul e admin cunoscut', () => {
		const three = (u: string) => [fail(u, '1.1.1.1', '2026-09-27T01:00:00Z'), fail(u, '2.2.2.2', '2026-09-27T02:00:00Z'), fail(u, '3.3.3.3', '2026-09-27T03:00:00Z')];
		expect(run(three('adm'), known({ adminIps: { adm: { '9.9.9.9': '2026-09-20T00:00:00Z' } } })).findings).toHaveLength(1);
		expect(run(three('admin'), known()).findings).toHaveLength(0);
	});

	test('eșecurile mai vechi de 7 zile ies din stare', () => {
		const state = known({ failedLogins: { adm: [{ t: '2026-09-10T10:00:00Z', ip: '1.1.1.1' }] } });
		expect(run([], state).nextState.failedLogins).toEqual({});
	});

	test('scanare: prima citire = baseline fără finding; fișier nou sau sha1 schimbat = 🔴', () => {
		const scan = (files: Array<[string, string]>, truncated = false) => ({
			files: files.map(([path, sha1]) => ({ path, sha1, size: 1, mtime: '2026-09-28T00:00:00Z' })),
			scannedFiles: 10,
			truncated,
			durationMs: 1
		});
		const first = run([], emptyState(), scan([['/sucuri/x.php', 'a']]));
		expect(first.findings).toHaveLength(0);
		expect(first.nextState.uploadsBaseline).toEqual({ '/sucuri/x.php': 'a' });
		const second = run([], first.nextState, scan([['/sucuri/x.php', 'b'], ['/2026/09/shell.php', 'c']]));
		expect(second.findings.map((f) => f.kind)).toEqual(['php_in_uploads', 'php_in_uploads']);
		expect(second.findings.every((f) => f.level === 'critical')).toBe(true);
		// scanare trunchiată: ce nu s-a văzut rămâne în baseline
		const third = run([], second.nextState, scan([['/2026/09/shell.php', 'c']], true));
		expect(Object.keys(third.nextState.uploadsBaseline).sort()).toEqual(['/2026/09/shell.php', '/sucuri/x.php']);
	});

	test('post_created peste prag = 🔴 (un singur finding per citire), sub prag = ⚪', () => {
		const post = (n: number) => ev({ ev: 'post_created', t: '2026-09-28T08:00:00Z', date: { nr_in_request: n, sursa: { context: 'rest' } } });
		expect(classify(post(MASS_INSERT_THRESHOLD), known())).toBe('normal');
		expect(classify(post(MASS_INSERT_THRESHOLD + 1), known())).toBe('critical');
		const { findings } = run([post(21), post(22), post(23)], known());
		expect(findings).toEqual([expect.objectContaining({ kind: 'mass_insert', text: expect.stringContaining('23 articole') })]);
	});

	test('plugin-uri: dezactivarea conectorului = 🔴; alt plugin de pe IP străin = 🟠; de pe IP OTS = ⚪; activarea conectorului = ⚪', () => {
		const p = (evName: string, plugin: string, ip: string, ip_remote?: string) => ev({ ev: evName, t: '2026-09-28T08:00:00Z', ip, ip_remote, date: { plugin } });
		expect(classify(p('plugin_deactivated', 'ots-wp-connector/ots-connector.php', '82.77.19.195'), known())).toBe('critical');
		expect(classify(p('plugin_deactivated', 'akismet/akismet.php', '5.5.5.5', '5.5.5.5'), known())).toBe('important');
		expect(classify(p('plugin_activated', 'akismet/akismet.php', '213.157.186.85'), known())).toBe('normal');
		expect(classify(p('plugin_activated', 'ots-wp-connector/ots-connector.php', '5.5.5.5', '5.5.5.5'), known())).toBe('normal');
		expect(classify(ev({ ev: 'theme_switched', t: '2026-09-28T08:00:00Z', ip: '5.5.5.5', ip_remote: '5.5.5.5', date: { theme: 'x' } }), known())).toBe('important');
	});

	test('eveniment necunoscut și php_in_uploads vechi = ⚪; fisiere_modificate (mu-plugin 1.1) = 🔴', () => {
		expect(classify(ev({ ev: 'ceva_nou', t: '2026-09-28T08:00:00Z' }), known())).toBe('normal');
		expect(classify(ev({ ev: 'php_in_uploads', t: '2026-09-28T08:00:00Z' }), known())).toBe('normal');
		expect(classify(ev({ ev: 'fisiere_modificate', t: '2026-09-28T08:00:00Z' }), known())).toBe('critical');
	});

	test('pendingFindings trec neatinse', () => {
		const pending = [{ level: 'critical' as const, kind: 'php_in_uploads' as const, text: 'x' }];
		expect(run([], known({ pendingFindings: pending })).nextState.pendingFindings).toEqual(pending);
	});

	test('option_changed → 🔴 finding; valoare obiect devine JSON, tăiată la 80 caractere (M5)', () => {
		const nou = { a: 'x'.repeat(100) };
		const { findings } = run([ev({ ev: 'option_changed', t: '2026-09-28T08:00:00Z', date: { option: 'siteurl', nou } })], known());
		expect(findings).toHaveLength(1);
		expect(findings[0].level).toBe('critical');
		expect(findings[0].kind).toBe('option_changed');
		expect(findings[0].text).toContain('opțiunea siteurl schimbată în');
		expect(findings[0].text).toContain('{"a":"x');
		expect(findings[0].text).toContain('…'); // tăiat, nu cele 100+ caractere brute
		expect(findings[0].text.length).toBeLessThan(120);
	});

	test('profile_update pe cont cu rol administrator = 🟠', () => {
		const { findings } = run(
			[ev({ ev: 'profile_update', t: '2026-09-28T08:00:00Z', user: 'adm', date: { roluri: ['administrator'], modificari: { email: 'x' } } })],
			known()
		);
		expect(findings).toEqual([expect.objectContaining({ level: 'important', kind: 'admin_profile' })]);
	});

	test('user_registered cu rol editor → 🟠 user_registered', () => {
		const { findings } = run(
			[ev({ ev: 'user_registered', t: '2026-09-28T08:00:00Z', date: { id: 9, login: 'ed', email: 'ed@x.ro', roluri: ['editor'] } })],
			known()
		);
		expect(findings).toEqual([expect.objectContaining({ level: 'important', kind: 'user_registered' })]);
	});

	test('dezactivarea conectorului OTS → text fix', () => {
		const { findings } = run(
			[ev({ ev: 'plugin_deactivated', t: '2026-09-28T08:00:00Z', ip: '82.77.19.195', date: { plugin: 'ots-wp-connector/ots-connector.php' } })],
			known()
		);
		expect(findings).toEqual([{ level: 'critical', kind: 'connector_deactivated', text: 'conectorul OTS a fost dezactivat' }]);
	});

	test('fisiere_modificate (mu-plugin 1.1) → finding legacy_alert', () => {
		const { findings } = run([ev({ ev: 'fisiere_modificate', t: '2026-09-28T08:00:00Z' })], known());
		expect(findings).toEqual([expect.objectContaining({ level: 'critical', kind: 'legacy_alert', text: expect.stringContaining('fișiere modificate') })]);
	});

	// Date reale Liepsnele, 28.09: update de plugin (428 fișiere, dupa_update) și testele OTS de pe IP-ul biroului.
	test('mu-plugin 1.1: fisiere_modificate după un update de plugin = ⚪', () => {
		const e = ev({ ev: 'fisiere_modificate', t: '2026-09-28T11:34:06Z', ip: '46.4.159.108', date: { noi: 3, modificate: 428, dupa_update: true } });
		expect(classify(e, known())).toBe('normal');
		expect(run([e], known()).findings).toHaveLength(0);
	});

	test('mu-plugin 1.1: fisiere_modificate / upload_blocat de pe IP-ul biroului = ⚪', () => {
		const files = ev({ ev: 'fisiere_modificate', t: '2026-09-28T08:34:32Z', ip: '82.77.19.195', date: { noi: 2, dupa_update: false } });
		const blocked = ev({ ev: 'upload_blocat', t: '2026-09-28T08:34:28Z', ip: '82.77.19.195', date: { fisier: 'shell.php' } });
		expect(classify(files, known())).toBe('normal');
		expect(classify(blocked, known())).toBe('normal');
	});

	test('mu-plugin 1.1: modificare reală = 🔴 cu fișierul în text', () => {
		const files = ev({
			ev: 'fisiere_modificate',
			t: '2026-09-28T09:38:49Z',
			ip: '46.4.159.108',
			date: { noi: 1, modificate: 2, sterse: 0, dupa_update: false, lista_noi: [{ f: 'wp-content/uploads/2026/09/x.php' }], lista_modificate: [{ f: '.htaccess' }] }
		});
		const blocked = ev({ ev: 'upload_blocat', t: '2026-09-28T09:40:00Z', ip: '5.5.5.5', ip_remote: '5.5.5.5', date: { fisier: 'shell.php' } });
		const { findings } = run([files, blocked], known());
		expect(findings.map((f) => f.text)).toEqual([
			'fișiere modificate pe disc: 1 noi, 2 modificate, 0 șterse (wp-content/uploads/2026/09/x.php)',
			'upload PHP blocat: shell.php (5.5.5.5)'
		]);
		expect(findings.every((f) => f.level === 'critical' && f.kind === 'legacy_alert')).toBe(true);
	});

	test('M4: mass_insert raportează maximul din citire, nu ultimul eveniment', () => {
		const post = (n: number) => ev({ ev: 'post_created', t: '2026-09-28T08:00:00Z', date: { nr_in_request: n, sursa: { context: 'rest' } } });
		const { findings } = run([post(23), post(21)], known());
		expect(findings).toEqual([expect.objectContaining({ kind: 'mass_insert', text: expect.stringContaining('23 articole') })]);
	});

	test('M1: eșecuri cu același t+ip dar id diferit nu se elimină reciproc (dedup pe id, nu pe t+ip)', () => {
		const mk = (id: string) => ev({ id, ev: 'login_esuat', t: '2026-09-27T20:00:00Z', ip: '1.1.1.1', date: { login: 'adm', exista: true, admin: true } });
		const { findings } = run([mk('a'), mk('b'), mk('c')], known());
		expect(findings).toEqual([expect.objectContaining({ kind: 'brute_force', text: '3 logări eșuate pe adm în 7 zile (1 IP-uri)' })]);
	});

	test('starea de intrare nu e mutată (M6 + clonare pe adminIps/failedLogins)', () => {
		const state = known({
			adminIps: { adm: { '9.9.9.9': '2026-06-01T00:00:00Z' } }, // uitat: > 90 zile din NOW
			failedLogins: { adm: [{ t: '2026-09-20T00:00:00Z', ip: '1.1.1.1' }] },
			pendingFindings: [{ level: 'important', kind: 'plugin_change', text: 'x' }]
		});
		const snapshot = JSON.stringify(state);
		run([admin('5.6.7.8', '2026-09-28T08:00:00Z', '5.6.7.8'), fail('adm', '2.2.2.2', '2026-09-28T01:00:00Z', true)], state);
		expect(JSON.stringify(state)).toBe(snapshot);
	});
});

describe('fixe din code review (0cd95e1e)', () => {
	test('I1: XFF falsificat cu IP OTS din remote-uri diferite — fiecare pull alertează; cheia e remote-ul, nu IP-ul OTS falsificat', () => {
		const spoof1 = admin('82.77.19.195', '2026-09-28T08:00:00Z', '203.0.113.9');
		const r1 = run([spoof1], known());
		expect(r1.findings).toEqual([expect.objectContaining({ kind: 'admin_new_ip', text: expect.stringContaining('remote 203.0.113.9') })]);
		expect(r1.nextState.adminIps.adm).toEqual({ '203.0.113.9': '2026-09-28T08:00:00Z' });

		const spoof2 = admin('82.77.19.195', '2026-09-28T09:00:00Z', '198.51.100.7');
		const r2 = run([spoof2], r1.nextState);
		expect(r2.findings).toEqual([expect.objectContaining({ kind: 'admin_new_ip', text: expect.stringContaining('remote 198.51.100.7') })]);
		expect(r2.nextState.adminIps.adm).toEqual({
			'203.0.113.9': '2026-09-28T08:00:00Z',
			'198.51.100.7': '2026-09-28T09:00:00Z'
		});
		expect(r2.nextState.adminIps.adm['82.77.19.195']).toBeUndefined();
	});

	test('I2: username-uri periculoase (constructor/toString/__proto__) nu ating Object.prototype', () => {
		const mkFail = (login: string, id: string, t: string) => ev({ id, ev: 'login_esuat', t, ip: '9.9.9.9', date: { login, exista: true, admin: true } });
		const { findings: f1 } = run(
			[mkFail('constructor', 'c1', '2026-09-27T01:00:00Z'), mkFail('constructor', 'c2', '2026-09-27T02:00:00Z'), mkFail('constructor', 'c3', '2026-09-27T03:00:00Z')],
			known()
		);
		expect(f1).toEqual([expect.objectContaining({ kind: 'brute_force', text: '3 logări eșuate pe constructor în 7 zile (1 IP-uri)' })]);

		// profile_update pe linie veche (fără roluri), user 'toString', cu adminIps gol (literal, nu null-proto) → normal
		const profileEvent = ev({ ev: 'profile_update', t: '2026-09-28T08:00:00Z', user: 'toString', date: {} });
		expect(classify(profileEvent, known({ adminIps: {} }))).toBe('normal');

		// logare admin pentru username '__proto__' → devine cheie proprie, nu prototip
		const adminLogin = admin('5.5.5.5', '2026-09-28T08:00:00Z', '5.5.5.5', '__proto__');
		const r = run([adminLogin], known());
		expect(Object.hasOwn(r.nextState.adminIps, '__proto__')).toBe(true);
		expect(() => JSON.stringify(r.nextState)).not.toThrow();
		expect(JSON.stringify(r.nextState)).toContain('__proto__');
		expect(({} as Record<string, unknown>).polluted).toBeUndefined(); // nimic scurs pe Object.prototype
	});

	test('I3: baseline de scanare separată de baselineDone — scan null la prima citire nu creează findings false la a doua', () => {
		const scanOf = (files: Array<[string, string]>) => ({
			files: files.map(([path, sha1]) => ({ path, sha1, size: 1, mtime: '2026-09-28T00:00:00Z' })),
			scannedFiles: 10,
			truncated: false,
			durationMs: 1
		});
		const first = run([], emptyState(), null); // prima citire fără scan deloc (conector vechi/eroare)
		expect(first.nextState.baselineDone).toBe(true);
		expect(first.nextState.scanBaselineDone).toBe(false);

		const second = run([], first.nextState, scanOf([['/sucuri/x.php', 'a']]));
		expect(second.findings).toHaveLength(0); // primul scan văzut efectiv = baseline, nu 🔴 fals
		expect(second.nextState.scanBaselineDone).toBe(true);

		const third = run([], second.nextState, scanOf([['/sucuri/x.php', 'a'], ['/2026/09/shell.php', 'c']]));
		expect(third.findings).toEqual([expect.objectContaining({ level: 'critical', kind: 'php_in_uploads' })]);
	});
});

describe('fixe din review-ul final de branch', () => {
	test('I1: o scanare trunchiată nu marchează baseline-ul gata — se termină abia la un scan complet', () => {
		const scanOf = (files: Array<[string, string]>, truncated: boolean) => ({
			files: files.map(([path, sha1]) => ({ path, sha1, size: 1, mtime: '2026-09-28T00:00:00Z' })),
			scannedFiles: files.length,
			truncated,
			durationMs: 1
		});
		// 1) primul scan, trunchiat: fără findings, baseline încă nu e gata
		const first = run([], emptyState(), scanOf([['/a.php', '1']], true));
		expect(first.findings).toHaveLength(0);
		expect(first.nextState.scanBaselineDone).toBe(false);
		expect(first.nextState.uploadsBaseline).toEqual({ '/a.php': '1' });

		// 2) al doilea scan, complet, cu fișierul vechi + unul „nou pentru noi" (dar existent dintotdeauna):
		//    tot fără findings — asta completează baseline-ul, nu raportează
		const second = run([], first.nextState, scanOf([['/a.php', '1'], ['/b.php', '2']], false));
		expect(second.findings).toHaveLength(0);
		expect(second.nextState.scanBaselineDone).toBe(true);
		expect(second.nextState.uploadsBaseline).toEqual({ '/a.php': '1', '/b.php': '2' });

		// 3) al treilea scan, trunchiat, doar un subset neschimbat: nimic (fișierele neîntoarse nu se ating)
		const third = run([], second.nextState, scanOf([['/a.php', '1']], true));
		expect(third.findings).toHaveLength(0);
		expect(third.nextState.uploadsBaseline).toEqual({ '/a.php': '1', '/b.php': '2' });

		// 4) un fișier chiar nou, într-un scan trunchiat → 🔴; baseline rămâne uniune (nu scoate /b.php)
		const fourth = run([], third.nextState, scanOf([['/a.php', '1'], ['/shell.php', 'x']], true));
		expect(fourth.findings).toEqual([expect.objectContaining({ level: 'critical', kind: 'php_in_uploads' })]);
		expect(fourth.nextState.uploadsBaseline).toEqual({ '/a.php': '1', '/b.php': '2', '/shell.php': 'x' });
	});

	test('I4: eșec cu date.admin=true → finding pe user (ca înainte)', () => {
		const failNew = (login: string, ip: string, t: string, admin: boolean) => ev({ ev: 'login_esuat', t, ip, date: { login, admin, exista: true } });
		const { findings } = run(
			[
				failNew('adm', '1.1.1.1', '2026-09-27T01:00:00Z', true),
				failNew('adm', '2.2.2.2', '2026-09-27T02:00:00Z', true),
				failNew('adm', '3.3.3.3', '2026-09-27T03:00:00Z', true)
			],
			known()
		);
		expect(findings).toEqual([expect.objectContaining({ kind: 'brute_force', text: '3 logări eșuate pe adm în 7 zile (3 IP-uri)' })]);
	});

	test('I4: eșec cu date.admin=false (client) ×3 → nimic (sub pragul de 10, fără finding individual)', () => {
		const failNew = (login: string, ip: string, t: string) => ev({ ev: 'login_esuat', t, ip, date: { login, admin: false, exista: true } });
		const { findings } = run(
			[
				failNew('client1', '1.1.1.1', '2026-09-27T01:00:00Z'),
				failNew('client1', '2.2.2.2', '2026-09-27T02:00:00Z'),
				failNew('client1', '3.3.3.3', '2026-09-27T03:00:00Z')
			],
			known()
		);
		expect(findings).toHaveLength(0);
	});

	test('I4: doi clienți cu ≥10 eșecuri fiecare → UN finding agregat, fără username/email (PII)', () => {
		const t0 = Date.parse('2026-09-27T00:00:00Z');
		const failNew = (login: string, i: number) =>
			ev({ ev: 'login_esuat', t: new Date(t0 + i * 60_000).toISOString(), ip: `1.1.1.${i % 250}`, date: { login, admin: false, exista: true } });
		const events = [
			...Array.from({ length: CUSTOMER_BRUTE_FORCE_MIN }, (_, i) => failNew('client1', i)),
			...Array.from({ length: CUSTOMER_BRUTE_FORCE_MIN }, (_, i) => failNew('client2', i + 100))
		];
		const { findings } = run(events, known());
		expect(findings).toEqual([{ level: 'important', kind: 'brute_force', text: '2 conturi de client cu ≥10 logări eșuate în 7 zile' }]);
		expect(findings[0].text).not.toContain('client1');
		expect(findings[0].text).not.toContain('client2');
		expect(findings[0].text).not.toContain('@');
	});

	test('I4: fixture nevada — tot exact un finding (linii vechi, fără date.admin)', () => {
		const { findings } = run(loadFixture('nevada'));
		expect(findings).toHaveLength(1);
		expect(findings[0]).toEqual(expect.objectContaining({ level: 'important', kind: 'brute_force' }));
	});

	test('I5: isCloudflareIp acoperă intervalele IPv4 și prefixele IPv6', () => {
		expect(isCloudflareIp('104.16.1.1')).toBe(true);
		expect(isCloudflareIp('162.158.255.255')).toBe(true);
		expect(isCloudflareIp('8.8.8.8')).toBe(false);
		expect(isCloudflareIp('2606:4700:1234::1')).toBe(true);
		expect(isCloudflareIp('2001:4860:4860::8888')).toBe(false);
	});

	test('I5: IP OTS cu ip_remote Cloudflare = verificat (proxy de încredere, ca unul privat)', () => {
		const otsViaCf = admin('82.77.19.195', '2026-09-28T08:00:00Z', '104.16.1.1');
		expect(isOtsIp(otsViaCf)).toBe(true);
		expect(
			classify(
				ev({ ev: 'plugin_activated', t: '2026-09-28T08:00:00Z', ip: '82.77.19.195', ip_remote: '104.16.1.1', date: { plugin: 'akismet/akismet.php' } }),
				known()
			)
		).toBe('normal');
	});

	test('I5: client din spatele CF cu edge rotativ — cheia rămâne IP-ul clientului, nu edge-ul', () => {
		const r1 = run([admin('5.6.7.8', '2026-09-28T08:00:00Z', '162.158.1.1', 'clientadmin')], known());
		expect(r1.findings).toEqual([expect.objectContaining({ kind: 'admin_new_ip' })]);
		expect(Object.keys(r1.nextState.adminIps.clientadmin)).toEqual(['5.6.7.8']);

		const r2 = run([admin('5.6.7.8', '2026-09-28T09:00:00Z', '104.16.5.5', 'clientadmin')], r1.nextState);
		expect(r2.findings).toHaveLength(0); // IP-ul clientului neschimbat, doar edge-ul CF s-a rotit
		expect(Object.keys(r2.nextState.adminIps.clientadmin)).toEqual(['5.6.7.8']);
	});
});
