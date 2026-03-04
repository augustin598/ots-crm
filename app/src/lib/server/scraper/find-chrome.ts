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
	// Check CHROME_PATH env var first
	if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
		return process.env.CHROME_PATH;
	}

	const platform = process.platform;
	const paths = CHROME_PATHS[platform] || CHROME_PATHS.linux;

	for (const p of paths) {
		if (existsSync(p)) return p;
	}

	throw new Error(
		'Chrome/Chromium not found. Install Chrome or set CHROME_PATH environment variable.'
	);
}
