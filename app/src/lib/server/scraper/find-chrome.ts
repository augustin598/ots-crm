import { existsSync } from 'fs';

const CHROME_PATHS: Record<string, string[]> = {
	darwin: [
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
		'/Applications/Chromium.app/Contents/MacOS/Chromium'
	],
	linux: [
		'/usr/bin/google-chrome-stable',
		'/usr/bin/google-chrome',
		'/usr/bin/chromium-browser',
		'/usr/bin/chromium',
		'/snap/bin/chromium'
	]
};

export function findChromePath(): string {
	console.log(`[SCRAPER-DEBUG] findChromePath: platform=${process.platform}, CHROME_PATH env=${process.env.CHROME_PATH || '(not set)'}`);

	// Check CHROME_PATH env var first
	if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
		console.log(`[SCRAPER-DEBUG] Using CHROME_PATH env: ${process.env.CHROME_PATH}`);
		return process.env.CHROME_PATH;
	}

	const platform = process.platform;
	const paths = CHROME_PATHS[platform] || CHROME_PATHS.linux;

	for (const p of paths) {
		const exists = existsSync(p);
		console.log(`[SCRAPER-DEBUG] Checking ${p}: ${exists ? 'FOUND' : 'not found'}`);
		if (exists) return p;
	}

	throw new Error(
		`Chrome/Chromium not found on ${platform}. Checked: ${paths.join(', ')}. Set CHROME_PATH environment variable.`
	);
}
