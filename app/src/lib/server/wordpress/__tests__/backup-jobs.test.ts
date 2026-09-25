import { describe, test, expect, mock } from 'bun:test';

// connector-release trage după el db + MinIO; aici ne trebuie doar comparația de versiuni.
mock.module('../connector-release', () => ({
	compareConnectorVersions: (a: string, b: string) => {
		const pa = a.split('.').map(Number);
		const pb = b.split('.').map(Number);
		for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
			const d = (pa[i] ?? 0) - (pb[i] ?? 0);
			if (d !== 0) return d < 0 ? -1 : 1;
		}
		return 0;
	}
}));

const { supportsChunkedBackup, isChunkedBackupName, driveSteps, isRetryableWpError } = await import(
	'../backup-jobs'
);
const { WpConnectionError, WpSiteDownError, WpAuthError, WpPluginMissingError, WpProtocolError } =
	await import('../errors');

describe('supportsChunkedBackup', () => {
	test('doar conectorul ≥ 0.8.0 are backup pe pași', () => {
		expect(supportsChunkedBackup('0.8.0')).toBe(true);
		expect(supportsChunkedBackup('0.10.1')).toBe(true);
		expect(supportsChunkedBackup('0.7.1')).toBe(false);
		expect(supportsChunkedBackup(null)).toBe(false);
	});
});

describe('isChunkedBackupName', () => {
	test('acceptă doar numele de director generat de conector', () => {
		expect(isChunkedBackupName('ots-backup-20260925-181229-zq8sdywc')).toBe(true);
		expect(isChunkedBackupName('ots-backup-20260925-181229.zip')).toBe(false);
		expect(isChunkedBackupName('../ots-backup-20260925-181229-zq8sdywc')).toBe(false);
	});
});

describe('isRetryableWpError', () => {
	test('rețea, 5xx și 401 (cerere retrimisă de proxy) se reîncearcă; plugin lipsă și protocol nu', () => {
		expect(isRetryableWpError(new WpConnectionError('t', {}))).toBe(true);
		expect(isRetryableWpError(new WpSiteDownError('503', {}))).toBe(true);
		expect(isRetryableWpError(new WpAuthError('401', {}))).toBe(true);
		expect(isRetryableWpError(new WpPluginMissingError('404', {}))).toBe(false);
		expect(isRetryableWpError(new WpProtocolError('json', {}))).toBe(false);
		expect(isRetryableWpError(new Error('x'))).toBe(false);
	});
});

describe('driveSteps', () => {
	function clock() {
		let t = 0;
		return {
			now: () => t,
			sleep: async (ms: number) => {
				t += ms;
			},
			advance: (ms: number) => {
				t += ms;
			}
		};
	}

	test('se oprește la done', async () => {
		const c = clock();
		let n = 0;
		const r = await driveSteps(
			async () => {
				c.advance(3000);
				n++;
				return { done: n === 3 };
			},
			{ maxMs: 60_000, stepEstimateMs: 12_000, now: c.now, sleep: c.sleep }
		);
		expect(n).toBe(3);
		expect(r.done).toBe(true);
	});

	test('nu mai pornește un pas care ar depăși fereastra cererii CRM', async () => {
		const c = clock();
		let n = 0;
		const r = await driveSteps(
			async () => {
				c.advance(10_000);
				n++;
				return { done: false };
			},
			{ maxMs: 20_000, stepEstimateMs: 12_000, now: c.now, sleep: c.sleep }
		);
		// după primul pas (10 s) încă mai încape unul (10 + 12 > 20 → nu)
		expect(n).toBe(1);
		expect(r.done).toBe(false);
	});

	test('busy → așteaptă și reîncearcă, fără să numere ca progres', async () => {
		const c = clock();
		const seq = [{ busy: true, done: false }, { done: true }];
		let n = 0;
		const r = await driveSteps(
			async () => seq[n++],
			{ maxMs: 20_000, stepEstimateMs: 12_000, now: c.now, sleep: c.sleep }
		);
		expect(n).toBe(2);
		expect(r.done).toBe(true);
		expect(c.now()).toBe(2000);
	});
});
