/**
 * Helperi de CLIENT partajați de cele două moduri ale tabului „Căutare Gmail”
 * (`MissingDocsMode.svelte` și `FreeSearchMode.svelte`).
 *
 * Aici stă tot ce ține de erori, descărcare și formatare — logica pură și testabilă
 * (plafoane, plural, date, etichete) e în `$lib/utils/gmail-search.ts`.
 */
import { goto } from '$app/navigation';
import { toast } from 'svelte-sonner';
import { clientLogger } from '$lib/client-logger';
import { remoteErrorMessage } from '$lib/utils/remote-error';
import { MAX_ZIP_ITEMS, batchArchiveName, chunk, pluralRo } from '$lib/utils/gmail-search';
import { formatAmount, CURRENCIES, type Currency } from '$lib/utils/currency';

// ---- Erori: mesajul REAL, nu „a apărut o eroare neașteptată” ----

/** Statusul HTTP al unei erori remote/fetch, când există. */
export function errorStatus(err: unknown): number | undefined {
	const status = (err as { status?: unknown } | null)?.status;
	return typeof status === 'number' ? status : undefined;
}

/** 409 e statusul pe care `mapGmailError` îl dă autorizării expirate. */
export function isGmailAuthError(err: unknown, message: string): boolean {
	return errorStatus(err) === 409 || /reconect|nu este conectat|not connected/i.test(message);
}

/**
 * Loghează eroarea și o arată utilizatorului CU MESAJUL EI.
 *
 * `clientLogger.apiError` forțează `errorCode: 'SYSTEM_UNEXPECTED'`, iar toastul
 * preferă mesajul generic al codului — așa arătau identic Gmail deconectat, XLSX
 * greșit și buget de timp depășit. Logăm cu mesajul real și toastăm noi; la 409
 * adăugăm și scurtătura către reconectare, fiindcă e singura acțiune care repară.
 */
export function reportError(
	action: string,
	err: unknown,
	fallback: string,
	tenantSlug: string
): void {
	const message = remoteErrorMessage(err, fallback);
	clientLogger.error({
		action,
		message,
		stackTrace: err instanceof Error ? err.stack : undefined,
		metadata: { status: errorStatus(err) },
		showToast: false
	});
	if (isGmailAuthError(err, message)) {
		toast.error(message, {
			duration: 10_000,
			action: {
				label: 'Reconectează Gmail',
				onClick: () => goto(`/${tenantSlug}/settings/gmail`)
			}
		});
	} else {
		toast.error(message);
	}
}

// ---- Descărcare ----

export interface ZipItem {
	messageId: string;
	/** Prefixul numelui în arhivă: referință Keez + comerciant + sumă. */
	label?: string;
	bankReference?: string;
}

function saveBlob(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);
}

/**
 * Mesajul serverului, nu statusul sec: `error()` din SvelteKit răspunde cu JSON
 * `{ message }` la cereri care nu sunt navigări, iar acolo stau exact indicațiile
 * utile („Reconectează Gmail din Setări → Integrări”, „Niciun PDF descărcabil”).
 */
async function zipErrorFrom(res: Response): Promise<Error & { status?: number }> {
	const text = await res.text().catch(() => '');
	let message = '';
	if (text) {
		try {
			const body = JSON.parse(text) as { message?: unknown };
			if (typeof body?.message === 'string') message = body.message;
		} catch {
			// Corp non-JSON (pagină HTML de la un proxy) — nu-l arătăm brut utilizatorului
		}
	}
	return Object.assign(new Error(message || `Descărcarea a eșuat (HTTP ${res.status})`), {
		status: res.status
	});
}

/**
 * Descarcă selecția ca arhive ZIP, cu toasturi și tratare de eroare.
 *
 * Endpointul refuză peste `MAX_ZIP_ITEMS` emailuri într-o cerere, iar în fluxul
 * lunar o selecție de 100+ plăți e normală — spargem automat în tranșe, câte o
 * arhivă pe tranșă.
 *
 * @returns `true` dacă toate arhivele au fost livrate.
 */
export async function runZipDownload(options: {
	tenantSlug: string;
	items: ZipItem[];
	/** Progresul pe tranșe, pentru textul butonului. `null` = gata. */
	onBatch?: (progress: { current: number; total: number } | null) => void;
}): Promise<boolean> {
	const { tenantSlug, items, onBatch } = options;
	if (items.length === 0) return false;
	const batches = chunk(items, MAX_ZIP_ITEMS);
	let skippedTotal = 0;
	try {
		for (let index = 0; index < batches.length; index++) {
			onBatch?.({ current: index + 1, total: batches.length });
			const res = await fetch(`/${tenantSlug}/banking/supplier-invoices/download-gmail-zip`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ items: batches[index] })
			});
			if (!res.ok) throw await zipErrorFrom(res);
			skippedTotal += Number.parseInt(res.headers.get('X-Skipped-Count') || '0', 10) || 0;
			const blob = await res.blob();
			const serverName =
				res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ||
				'facturi-gmail.zip';
			saveBlob(blob, batchArchiveName(serverName, index, batches.length));
		}
		if (skippedTotal > 0) {
			toast.warning(
				`${pluralRo(skippedTotal, 'email sărit', 'emailuri sărite')} (fără PDF sau eroare Gmail) — verifică arhiva înainte de a considera plățile rezolvate`
			);
		} else if (batches.length > 1) {
			toast.success(pluralRo(batches.length, 'arhivă descărcată', 'arhive descărcate'));
		} else {
			toast.success('Arhiva a fost descărcată');
		}
		return true;
	} catch (err) {
		reportError('gmail_download_zip', err, 'Descărcarea arhivei a eșuat', tenantSlug);
		return false;
	} finally {
		onBatch?.(null);
	}
}

/** URL-ul de descărcare a unui singur atașament (se deschide în filă nouă). */
export function singleDownloadUrl(
	tenantSlug: string,
	messageId: string,
	index: number,
	bankReference?: string
): string {
	const params = new URLSearchParams({ messageId, index: String(index) });
	if (bankReference) params.set('ref', bankReference);
	return `/${tenantSlug}/banking/supplier-invoices/gmail-attachment?${params}`;
}

// ---- Formatare ----

/** btoa pe felii — String.fromCharCode(...) pe tot bufferul poate depăși stiva. */
export function toBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	const CHUNK = 8192;
	let binary = '';
	for (let i = 0; i < bytes.length; i += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return btoa(binary);
}

export function formatDate(value: Date | string | null | undefined): string {
	if (!value) return '—';
	const date = new Date(value);
	if (isNaN(date.getTime())) return 'dată invalidă';
	return date.toLocaleDateString('ro-RO');
}

const knownCurrencies = new Set<string>(CURRENCIES);

/** Nicio sumă fără valută: fără valută cunoscută afișăm codul brut lângă valoare. */
export function formatMoney(
	cents: number | null | undefined,
	currency: string | null | undefined
): string {
	if (cents == null || !currency) return '—';
	if (knownCurrencies.has(currency)) return formatAmount(cents, currency as Currency);
	return `${(cents / 100).toFixed(2)} ${currency}`;
}

export const confidenceBadge = (confidence: string) =>
	confidence === 'sure'
		? ('success' as const)
		: confidence === 'probable'
			? ('warning' as const)
			: ('secondary' as const);

export const confidenceLabel = (confidence: string) =>
	confidence === 'sure' ? 'Potrivire sigură' : confidence === 'probable' ? 'Probabilă' : 'Negăsită';
