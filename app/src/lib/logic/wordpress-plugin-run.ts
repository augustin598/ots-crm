/**
 * Runs the steps produced by `buildSitePlan` against one site, from the
 * browser. Shared by the plugin library page (many sites) and a site's own
 * plugins page (one plugin + its base), so both apply the same rule: steps
 * run one at a time, base first, and a PRO never runs when its base failed.
 */
import type { PlanStep } from './wordpress-plugin-plan';

export type StepResult =
	| { state: 'done'; toVersion: string; message?: string }
	| { state: 'failed'; message: string; blocked?: boolean };

/** WordPress' "already at the latest version" text, EN + RO (connector < 0.8.2). */
const ALREADY_CURRENT = /is at the latest version|are o versiune recent/i;

/**
 * A plain-language cause for the failures seen in practice, or null.
 * Shown under the raw WordPress message.
 */
export function stepErrorHint(message: string): string | null {
	if (/forbidden|unauthori[sz]ed|licen[cs]e/i.test(message)) {
		return 'Producătorul refuză descărcarea: licența nu e activă pe acest site. Activează licența în wp-admin sau urcă ZIP-ul în Biblioteca de plugin-uri.';
	}
	if (/no valid plugins were found|incompatible archive/i.test(message)) {
		return 'ZIP-ul nu are forma cerută de WordPress (folderul plugin-ului la rădăcină).';
	}
	if (/could not create directory|could not copy file|disk|quota/i.test(message)) {
		return 'Hostingul nu permite scrierea fișierelor (spațiu sau permisiuni).';
	}
	if (/HMAC|HTTP 40[13]/i.test(message)) {
		return 'Conexiunea cu site-ul a fost refuzată (secret HMAC sau firewall).';
	}
	return null;
}

/**
 * One step on one site. `siteApi` is `/<tenant>/api/wordpress/sites/<siteId>`.
 * Library steps push the ZIP through `library-install` (re-activating only
 * what was active); wporg steps go through WordPress' own updater via
 * `apply-updates`, which keeps the active state by itself.
 */
export async function runPluginStep(
	siteApi: string,
	step: PlanStep,
	fetchFn: typeof fetch = fetch
): Promise<StepResult> {
	try {
		if (step.kind === 'wporg') {
			const res = await fetchFn(`${siteApi}/apply-updates`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ items: [{ type: 'plugin', slug: step.plugin }] })
			});
			const body = (await res.json().catch(() => ({}))) as {
				status?: 'success' | 'partial' | 'failed';
				error?: string;
				items?: Array<{
					success: boolean;
					already_current?: boolean;
					message?: string | null;
					reactivated?: boolean | null;
					reactivation_error?: string | null;
				}>;
			};
			const first = body.items?.[0];
			// WordPress' update cache listed a version that is already installed.
			// Connector ≥ 0.8.2 says so; older ones pass WordPress' own text.
			if (first && (first.already_current || ALREADY_CURRENT.test(first.message ?? ''))) {
				return { state: 'done', toVersion: step.toVersion, message: 'era deja la zi' };
			}
			if (!res.ok || body.status === 'failed' || !first?.success) {
				return { state: 'failed', message: first?.message || body.error || `HTTP ${res.status}` };
			}
			return first.reactivated === false
				? {
						state: 'done',
						toVersion: step.toVersion,
						message: `reactivarea a eșuat${first.reactivation_error ? `: ${first.reactivation_error}` : ''}`
					}
				: { state: 'done', toVersion: step.toVersion };
		}

		const res = await fetchFn(`${siteApi}/plugins/library-install`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				libraryPluginId: step.libraryId,
				installedPlugin: step.plugin,
				// Keep the site's state: only re-activate what was active before.
				activate: step.activate,
				fromVersion: step.fromVersion
			})
		});
		const body = (await res.json().catch(() => ({}))) as {
			error?: string;
			warning?: string;
			activated?: boolean;
			activationError?: string | null;
			toVersion?: string;
		};
		if (!res.ok) return { state: 'failed', message: body.error || `HTTP ${res.status}` };
		const notes = [
			step.activate && body.activated === false
				? `reactivarea a eșuat${body.activationError ? `: ${body.activationError}` : ''}`
				: '',
			body.warning ?? ''
		].filter(Boolean);
		const toVersion = body.toVersion ?? step.toVersion;
		return notes.length > 0
			? { state: 'done', toVersion, message: notes.join(' · ') }
			: { state: 'done', toVersion };
	} catch (err) {
		return { state: 'failed', message: err instanceof Error ? err.message : 'Eroare de rețea' };
	}
}

/**
 * Sequential run of one site's plan. A step whose base (`waitsFor`) did not
 * succeed is not attempted and is reported as blocked.
 */
export async function runPlanSteps(
	steps: PlanStep[],
	runStep: (step: PlanStep) => Promise<StepResult>,
	onResult: (key: string, result: StepResult) => void
): Promise<{ ok: number; failed: number; blocked: number }> {
	const succeeded = new Map<string, boolean>();
	let ok = 0;
	let failed = 0;
	let blocked = 0;
	for (const step of steps) {
		const failedDep = step.waitsFor.find((key) => succeeded.get(key) === false);
		if (failedDep) {
			const depName = steps.find((x) => x.key === failedDep)?.name ?? 'baza';
			onResult(step.key, {
				state: 'failed',
				blocked: true,
				message: `nu a rulat: ${depName} nu s-a actualizat, iar PRO-ul are nevoie de bază nouă`
			});
			succeeded.set(step.key, false);
			blocked++;
			continue;
		}
		const result = await runStep(step);
		onResult(step.key, result);
		succeeded.set(step.key, result.state === 'done');
		if (result.state === 'done') ok++;
		else failed++;
	}
	return { ok, failed, blocked };
}
