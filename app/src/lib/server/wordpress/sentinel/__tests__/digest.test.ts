import { describe, test, expect } from 'bun:test';
import { buildDigest, TELEGRAM_MAX, dayLabel } from '../digest';

const date = new Date('2026-09-29T06:00:00Z');
const base = { date, url: 'https://clients.onetopsolution.ro/ots/wordpress/security' };
const H = `🛡 Sentinel · ${dayLabel(date)}`;

describe('buildDigest', () => {
	test('eticheta zilei e în română, ora României', () => {
		expect(dayLabel(date)).toMatch(/^29 sept\.?$/);
		expect(dayLabel(new Date('2026-09-28T22:30:00Z'))).toMatch(/^29 sept/); // 01:30 în București
	});

	test('zi liniștită = o singură linie', () => {
		expect(buildDigest({ ...base, sites: [], quietSites: 16 })).toEqual([`${H} — ✅ 16 site-uri liniștite`]);
	});

	test('critice înainte de importante; site-urile cu critice primele; apoi liniștite și link', () => {
		const [msg, ...rest] = buildDigest({
			...base,
			quietSites: 14,
			sites: [
				{ name: 'areni', findings: [{ level: 'important', kind: 'admin_new_ip', text: 'logare admin de pe IP nou 5.6.7.8' }] },
				{
					name: 'nevada',
					findings: [
						{ level: 'important', kind: 'brute_force', text: '3 logări eșuate pe adm în 7 zile (3 IP-uri)' },
						{ level: 'critical', kind: 'php_in_uploads', text: 'PHP nou în uploads /2026/09/x.php' }
					]
				}
			]
		});
		expect(rest).toHaveLength(0);
		expect(msg.split('\n')).toEqual([
			H,
			'🔴 nevada: PHP nou în uploads /2026/09/x.php',
			'🟠 nevada: 3 logări eșuate pe adm în 7 zile (3 IP-uri)',
			'🟠 areni: logare admin de pe IP nou 5.6.7.8',
			'✅ 14 site-uri liniștite',
			'→ https://clients.onetopsolution.ro/ots/wordpress/security'
		]);
	});

	test('site-urile fără findings din listă sunt ignorate', () => {
		const [msg] = buildDigest({ ...base, quietSites: 3, sites: [{ name: 'gol', findings: [] }] });
		expect(msg).toBe(`${H} — ✅ 3 site-uri liniștite`);
	});

	test('peste 4096: împarte pe site-uri întregi, antet numerotat, footer doar la final', () => {
		const sites = Array.from({ length: 60 }, (_, i) => ({
			name: `site${String(i).padStart(2, '0')}`,
			findings: Array.from({ length: 3 }, (_, j) => ({ level: 'important' as const, kind: 'plugin_change' as const, text: `plugin activat: ${'x'.repeat(40)}-${j}` }))
		}));
		const msgs = buildDigest({ ...base, sites, quietSites: 0 });
		expect(msgs.length).toBeGreaterThan(1);
		msgs.forEach((m, i) => {
			expect(m.length).toBeLessThanOrEqual(TELEGRAM_MAX);
			expect(m.startsWith(`${H} (${i + 1}/${msgs.length})\n`)).toBe(true);
		});
		for (const s of sites) expect(msgs.filter((m) => m.includes(`🟠 ${s.name}:`))).toHaveLength(1);
		expect(msgs.filter((m) => m.includes('site-uri liniștite'))).toHaveLength(1);
		expect(msgs[msgs.length - 1]).toContain('→ https://');
	});

	test('un singur site cu un bloc imens: nu se pierde nimic, fiecare mesaj ≤ 4096', () => {
		const findings = Array.from({ length: 200 }, (_, j) => ({ level: 'critical' as const, kind: 'php_in_uploads' as const, text: `PHP nou în uploads /2026/09/f${j}-${'y'.repeat(30)}.php` }));
		const msgs = buildDigest({ ...base, sites: [{ name: 'mare', findings }], quietSites: 1 });
		for (const m of msgs) expect(m.length).toBeLessThanOrEqual(TELEGRAM_MAX);
		expect(msgs.join('\n').match(/🔴 mare:/g)).toHaveLength(200);
	});
});
