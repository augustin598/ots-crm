/** Ce trimite conectorul ≥ 0.9.0 pe `POST /sentinel` și ce ține CRM-ul minte între citiri. */
import type { SentinelLevel } from '$lib/logic/wordpress-sentinel-labels';
export type { SentinelLevel };

export type SentinelSev = 'INFO' | 'WARN' | 'ALERT';

export interface SentinelEvent {
	id: string;
	t: string; // ISO 8601, UTC
	sev: SentinelSev;
	ev: string;
	user: string; // '-' când nu e logat
	uid: number;
	ip: string;
	/** REMOTE_ADDR brut (conector ≥ 0.9.0); lipsește pe liniile mu-plugin-ului */
	ip_remote?: string;
	uri: string;
	ua: string;
	date: Record<string, unknown>;
}

export interface SentinelScanFile {
	path: string;
	size: number;
	mtime: string;
	sha1: string;
}

export interface SentinelScan {
	files: SentinelScanFile[];
	scannedFiles: number;
	truncated: boolean;
	durationMs: number;
}

export interface WpSentinelResponse {
	sentinel: { version: string; legacyMuPlugin: boolean; logBytes: number };
	events: SentinelEvent[];
	hasMore: boolean;
	scan: SentinelScan | null; // doar pe prima pagină
	errors: string[];
}

/** Memoria lungă a unui site (wordpress_site.sentinel_state). */
export interface SentinelState {
	baselineDone: boolean;
	/** path → sha1 al fișierelor PHP din uploads cunoscute */
	uploadsBaseline: Record<string, string>;
	/** user → ip → ultima logare de admin (ISO); intrările > 90 zile se curăță */
	adminIps: Record<string, Record<string, string>>;
	lastError: string | null;
}

export function emptyState(): SentinelState {
	return { baselineDone: false, uploadsBaseline: {}, adminIps: {}, lastError: null };
}

export function parseState(raw: string | null | undefined): SentinelState {
	if (!raw) return emptyState();
	try {
		const p = JSON.parse(raw) as Partial<SentinelState>;
		return {
			baselineDone: p.baselineDone === true,
			uploadsBaseline: p.uploadsBaseline ?? {},
			adminIps: p.adminIps ?? {},
			lastError: p.lastError ?? null
		};
	} catch {
		return emptyState();
	}
}

export type FindingKind =
	| 'admin_role'
	| 'admin_registered'
	| 'option_changed'
	| 'mass_insert'
	| 'php_in_uploads'
	| 'connector_deactivated'
	| 'legacy_alert'
	| 'admin_new_ip'
	| 'plugin_change'
	| 'theme_switched'
	| 'user_registered'
	| 'admin_profile'
	| 'brute_force'
	| 'pull_failed';

export interface Finding {
	level: Exclude<SentinelLevel, 'normal'>;
	kind: FindingKind;
	/** o linie, fără prefixul site-ului — digest-ul îl pune */
	text: string;
}
