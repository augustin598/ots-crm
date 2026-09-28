/** Etichete Sentinel în română — folosite de digest-ul Telegram (server) și de pagina /wordpress/security (client). */

export type SentinelLevel = 'critical' | 'important' | 'normal';

export const EVENT_LABELS: Record<string, string> = {
	post_created: 'Articol creat',
	user_registered: 'Utilizator nou',
	role_changed: 'Rol schimbat',
	profile_update: 'Profil modificat',
	user_deleted: 'Utilizator șters',
	login_ok: 'Logare reușită',
	login_esuat: 'Logare eșuată',
	plugin_activated: 'Plugin activat',
	plugin_deactivated: 'Plugin dezactivat',
	theme_switched: 'Temă schimbată',
	upgrader: 'Update instalat',
	option_changed: 'Opțiune critică schimbată',
	php_in_uploads: 'PHP în uploads',
	scan_uploads_curat: 'Scanare uploads curată',
	scan_eroare: 'Eroare la scanare',
	// mu-plugin 1.1, neportate — doar etichete
	upload: 'Fișier urcat',
	upload_blocat: 'Upload blocat',
	fisiere_baseline: 'Baseline fișiere',
	fisiere_ok: 'Fișiere neschimbate',
	fisiere_modificate: 'Fișiere modificate pe disc',
	fisiere_eroare: 'Eroare verificare fișiere'
};

export function eventLabel(ev: string): string {
	return EVENT_LABELS[ev] ?? ev;
}

export const LEVEL_LABELS: Record<SentinelLevel, string> = {
	critical: 'Critic',
	important: 'Important',
	normal: 'Normal'
};

export const LEVEL_EMOJI: Record<SentinelLevel, string> = {
	critical: '🔴',
	important: '🟠',
	normal: '⚪'
};
