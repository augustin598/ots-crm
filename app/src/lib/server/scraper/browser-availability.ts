/**
 * "Scan cu Browser" opens a visible Chrome window the user logs into by hand.
 * That only works on a machine with a display (the developer's Mac). On the
 * production pod (linux, no DISPLAY) puppeteer falls back to headless-shell and
 * the user waits forever for a login screen nobody can see.
 */
export interface BrowserEnv {
	platform: string;
	display?: string;
}

export function isInteractiveBrowserAvailable(env: BrowserEnv): boolean {
	if (env.platform === 'darwin') return true;
	return !!env.display;
}

export function interactiveBrowserAvailable(): boolean {
	return isInteractiveBrowserAvailable({ platform: process.platform, display: process.env.DISPLAY });
}

export const BROWSER_SCAN_UNAVAILABLE_MESSAGE =
	'Scanarea cu browser rulează doar pe un calculator cu ecran (dev local). Pe server folosește scriptul Tampermonkey v3 „Google Ads Invoice Extractor" și butonul „Trimite în CRM" de pe pagina Google Ads → Facturare → Documente.';
