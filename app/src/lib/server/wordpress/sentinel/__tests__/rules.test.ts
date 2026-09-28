import { describe, test, expect } from 'bun:test';
import { detectFindings, classify, isOtsIp, MASS_INSERT_THRESHOLD } from '../rules';
import { emptyState, type SentinelState } from '../types';
import { loadFixture, ev } from './fixtures/load';

const NOW = new Date('2026-09-28T12:00:00Z');
const run = (events: ReturnType<typeof loadFixture>, state: SentinelState = emptyState(), scan: Parameters<typeof detectFindings>[0]['scan'] = null, now = NOW) =>
	detectFindings({ events, scan, state, now });
const known = (over: Partial<SentinelState> = {}): SentinelState => ({ ...emptyState(), baselineDone: true, ...over });
const admin = (ip: string, t: string, ip_remote?: string, u = 'adm') =>
	ev({ ev: 'login_ok', t, ip, ip_remote, date: { login: u, roluri: ['administrator'] } });
const fail = (login: string, ip: string, t: string, exista?: boolean) =>
	ev({ ev: 'login_esuat', t, ip, date: exista === undefined ? { login } : { login, exista } });

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
});
