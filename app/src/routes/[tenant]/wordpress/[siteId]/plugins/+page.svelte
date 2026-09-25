<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { SvelteSet } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import { Card } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import { Label } from '$lib/components/ui/label';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogFooter,
		DialogHeader,
		DialogTitle
	} from '$lib/components/ui/dialog';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import CheckCircleIcon from '@lucide/svelte/icons/check-circle';
	import XCircleIcon from '@lucide/svelte/icons/x-circle';
	import LoaderIcon from '@lucide/svelte/icons/loader';
	import FileArchiveIcon from '@lucide/svelte/icons/file-archive';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import SearchIcon from '@lucide/svelte/icons/search';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import PlugIcon from '@lucide/svelte/icons/plug';
	import PowerIcon from '@lucide/svelte/icons/power';
	import PowerOffIcon from '@lucide/svelte/icons/power-off';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import ArrowUpCircleIcon from '@lucide/svelte/icons/arrow-up-circle';
	import LibraryBigIcon from '@lucide/svelte/icons/library-big';
	import CheckIcon from '@lucide/svelte/icons/check';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import {
		buildBulkSitePlan,
		type PlanCompareItem,
		type PlanStep
	} from '$lib/logic/wordpress-plugin-plan';
	import { runPlanSteps, runPluginStep, type StepResult } from '$lib/logic/wordpress-plugin-run';
	import { nextJobView, runSiteBackup, type JobView } from '$lib/logic/wordpress-backup-run';
	import WpJobProgress from '$lib/components/wordpress/WpJobProgress.svelte';

	type WpPlugin = {
		plugin: string;
		name: string;
		version: string;
		description: string;
		author: string;
		authorUri: string;
		pluginUri: string;
		requiresWp: string;
		requiresPhp: string;
		textDomain?: string;
		updateUri?: string;
		network: boolean;
		active: boolean;
		autoUpdate: boolean;
		updateAvailable: boolean;
		newVersion: string | null;
		updateSource?: 'get_plugin_updates' | 'transient' | 'none';
		/** Null when a license is required to actually download the upgrade. */
		updatePackage?: string | null;
		updateUrl?: string | null;
		/** Vendor's "activate license" notice when we can't auto-update. */
		updateMessage?: string | null;
		/** Raw `Requires Plugins` header (connector ≥ 0.7.1); used for base→PRO ordering. */
		requiresPlugins?: string;
	};

	const tenantSlug = $derived(page.params.tenant);
	const siteId = $derived(page.params.siteId);
	const apiBase = $derived(`/${tenantSlug}/api/wordpress/sites/${siteId}/plugins`);

	let plugins = $state<WpPlugin[]>([]);
	let loading = $state(true);
	let statusFilter = $state<'all' | 'active' | 'inactive' | 'updates'>('all');
	let searchQuery = $state('');
	const busyPlugins = new SvelteSet<string>();

	type PluginZipInfo = {
		slug: string;
		pluginFile: string;
		name: string;
		version: string;
		description: string;
		author: string;
		requiresWp: string;
		requiresPhp: string;
		textDomain: string;
		pluginUri: string;
		updateUri: string;
		sizeBytes: number;
	};

	type MatchCandidate = {
		plugin: string;
		installedVersion: string;
		installedName: string;
		score: number;
		reasons: string[];
	};

	/**
	 * Verdict returned by /plugins/inspect. Mirrors the server-side type.
	 *
	 *   - `new`          → safe to install
	 *   - `upgrade`      → ZIP version > installed — green-light
	 *   - `same_version` → identical; default skip
	 *   - `downgrade`    → ZIP version < installed; default skip
	 *   - `ambiguous`    → multiple plausible matches; operator must pick
	 */
	type InspectVerdict =
		| { kind: 'new' }
		| {
				kind: 'upgrade' | 'same_version' | 'downgrade';
				match: MatchCandidate;
				installedVersion: string;
		  }
		| { kind: 'ambiguous'; candidates: MatchCandidate[] };

	type UploadQueueItem = {
		id: string;
		file: File;
		status:
			| 'queued' // waiting to be inspected
			| 'inspecting' // POST /plugins/inspect in flight
			| 'inspected' // inspection ok; verdict computed (will install)
			| 'skipped' // verdict says skip (same/downgrade/ambiguous unresolved)
			| 'uploading' // base64 -> /plugins/install
			| 'installing' // WP is extracting/activating
			| 'success'
			| 'error';
		info?: PluginZipInfo;
		verdict?: InspectVerdict;
		/** When verdict is same_version/downgrade, operator can force-install. */
		forceInstall?: boolean;
		/** For ambiguous verdict: which candidate plugin slug did the operator pick. */
		disambiguatedMatch?: string;
		installedAs?: string;
		activated?: boolean;
		message?: string;
	};

	let uploadOpen = $state(false);
	let uploadQueue = $state<UploadQueueItem[]>([]);
	let uploadAutoActivate = $state(true);
	let uploading = $state(false);

	const filtered = $derived.by(() => {
		const query = searchQuery.trim().toLowerCase();
		return plugins.filter((p) => {
			if (statusFilter === 'active' && !p.active) return false;
			if (statusFilter === 'inactive' && p.active) return false;
			if (statusFilter === 'updates' && !p.updateAvailable && !libraryUpdateFor(p)) return false;
			if (query) {
				const hay = `${p.name} ${p.description} ${p.author} ${p.plugin}`.toLowerCase();
				if (!hay.includes(query)) return false;
			}
			return true;
		});
	});

	const activeCount = $derived(plugins.filter((p) => p.active).length);
	const updatesCount = $derived(
		plugins.filter((p) => p.updateAvailable || libraryUpdateFor(p)).length
	);

	/* ── Plugin library: ZIPs uploaded once in /wordpress/plugin-library ── */

	const libraryCount = $derived(plugins.filter((p) => libraryUpdateFor(p)).length);

	let libraryItems = $state<PlanCompareItem[]>([]);

	// Update plan panel (library and/or WordPress updates, one or many plugins).
	type StepProgress = { state: 'installing' } | StepResult;
	let planOpen = $state(false);
	let planSteps = $state<PlanStep[]>([]);
	let planProgress = $state<Record<string, StepProgress>>({});
	let planRunning = $state(false);
	let planFinished = $state(false);
	let backupFirst = $state(true);
	let backupState = $state<{ state: 'running' | 'ok' | 'failed'; message?: string } | null>(null);
	let backupView = $state<JobView | null>(null);
	const selected = new SvelteSet<string>();

	/**
	 * Library rows that can update an installed plugin from here, keyed by
	 * the WP identifier. `wporg`-preferred rows are left to the normal Update
	 * button (wordpress.org already has something newer than the ZIP), and
	 * folder mismatches are refused by the install endpoint anyway.
	 */
	const libraryByPlugin = $derived(
		new Map(
			libraryItems
				.filter(
					(i) =>
						i.status === 'update_available' &&
						!i.folderMismatch &&
						i.preferredSource === 'library' &&
						i.installedPlugin !== null
				)
				.map((i) => [i.installedPlugin as string, i])
		)
	);

	/** Only while the compare still describes what is installed (a WP-side update or upload moves the version). */
	function libraryUpdateFor(p: WpPlugin): PlanCompareItem | null {
		const item = libraryByPlugin.get(p.plugin);
		return item && item.installedVersion === p.version ? item : null;
	}

	async function loadPlugins() {
		loading = true;
		try {
			const res = await fetch(apiBase);
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { error?: string };
				throw new Error(body.error || `HTTP ${res.status}`);
			}
			// Defensive: a misbehaving connector could return `null` (e.g. if its
			// handler fatal-ed after `rest_ensure_response`) or an object missing
			// `items`. Treat anything that isn't a plain array as an empty list
			// rather than crashing the page with "Cannot read properties of null".
			const data = (await res.json().catch(() => null)) as { items?: WpPlugin[] } | null;
			plugins = Array.isArray(data?.items) ? data.items : [];
			if (!Array.isArray(data?.items)) {
				console.warn('loadPlugins: unexpected response shape', data);
			}
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Nu s-au putut încărca plugin-urile');
			console.error(err);
		} finally {
			loading = false;
		}
	}

	async function loadLibraryCompare() {
		try {
			const res = await fetch(`${apiBase}/library-compare`);
			const body = (await res.json().catch(() => ({}))) as {
				items?: PlanCompareItem[];
				error?: string;
			};
			if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
			libraryItems = Array.isArray(body.items) ? body.items : [];
		} catch (err) {
			// The list itself still works; only the library buttons are missing.
			libraryItems = [];
			console.warn('library-compare failed', err);
		}
	}

	function reloadAll() {
		return Promise.all([loadPlugins(), loadLibraryCompare()]);
	}

	onMount(reloadAll);

	/** Anything this page can update without a licence: a newer library ZIP or a WP package. */
	function canUpdate(p: WpPlugin): boolean {
		return libraryUpdateFor(p) !== null || (p.updateAvailable && Boolean(p.updatePackage));
	}

	const updatablePlugins = $derived(plugins.filter(canUpdate));
	const selectedCount = $derived(updatablePlugins.filter((p) => selected.has(p.plugin)).length);
	const allSelected = $derived(
		updatablePlugins.length > 0 && selectedCount === updatablePlugins.length
	);

	function toggleSelectAll(on: boolean) {
		selected.clear();
		if (on) for (const p of updatablePlugins) selected.add(p.plugin);
	}

	/**
	 * Build the plan for the given plugins and show it. Same planner rules as
	 * the library page: base before PRO (the base is pulled in when needed),
	 * a PRO never runs when its base failed. Nothing runs until the operator
	 * confirms in the panel.
	 */
	function openPlan(pluginIds: Iterable<string>) {
		const fresh = libraryItems.filter((i) => {
			const p = plugins.find((x) => x.plugin === i.installedPlugin);
			return !p || i.installedVersion === p.version;
		});
		const steps = buildBulkSitePlan(fresh, plugins, new Set(pluginIds));
		if (steps.length === 0) {
			toast.info('Nimic de actualizat fără licență în selecție');
			return;
		}
		planSteps = steps;
		planProgress = {};
		planFinished = false;
		backupState = null;
		planOpen = true;
	}

	async function runPlan() {
		const steps = planSteps;
		if (planRunning || steps.length === 0) return;
		planRunning = true;
		planProgress = {};
		for (const step of steps) busyPlugins.add(step.plugin);
		const siteApi = `/${tenantSlug}/api/wordpress/sites/${siteId}`;
		try {
			if (backupFirst) {
				backupState = { state: 'running' };
				backupView = nextJobView(null, {}, 'Backup complet: ');
				const backup = await runSiteBackup(siteApi, {
					trigger: 'pre_update',
					onProgress: (p) => (backupView = nextJobView(backupView, p, 'Backup complet: '))
				});
				backupView = null;
				if (!backup.ok) {
					backupState = { state: 'failed', message: backup.error };
					toast.error(`Backup eșuat: ${backup.error}. Update-urile nu au rulat.`);
					return;
				}
				backupState = { state: 'ok' };
			}

			const summary = await runPlanSteps(
				steps,
				async (step) => {
					planProgress[step.key] = { state: 'installing' };
					return runPluginStep(siteApi, step);
				},
				(key, result) => {
					planProgress[key] = result;
				}
			);
			const notes = Object.values(planProgress).some((r) => r.state === 'done' && r.message);
			if (summary.failed === 0 && summary.blocked === 0) {
				const msg =
					steps.length === 1
						? `${steps[0].name} actualizat la ${steps[0].toVersion}`
						: `${summary.ok} plugin-uri actualizate`;
				if (notes) toast.warning(`${msg}, cu observații — vezi detaliile`);
				else toast.success(msg);
			} else {
				toast.error(
					`${summary.ok} reușite, ${summary.failed} eșuate${summary.blocked ? `, ${summary.blocked} blocate de o bază neactualizată` : ''} — vezi detaliile`,
					{ duration: 10000 }
				);
			}
			selected.clear();
		} finally {
			for (const step of steps) busyPlugins.delete(step.plugin);
			planRunning = false;
			planFinished = true;
			await reloadAll();
		}
	}

	function fileToBase64(file: File): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => {
				const dataUrl = String(reader.result);
				// strip the "data:<mime>;base64," prefix, keep only the base64 body
				const comma = dataUrl.indexOf(',');
				resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
			};
			reader.onerror = () => reject(reader.error);
			reader.readAsDataURL(file);
		});
	}

	function pickUploadFiles(event: Event) {
		const input = event.target as HTMLInputElement;
		if (!input.files) return;
		const next: UploadQueueItem[] = [];
		for (const f of Array.from(input.files)) {
			if (!/\.zip$/i.test(f.name)) {
				toast.error(`${f.name} nu e ZIP — omis`);
				continue;
			}
			if (f.size > 50 * 1024 * 1024) {
				toast.error(`${f.name} depășește 50 MB — omis`);
				continue;
			}
			next.push({ id: `${f.name}-${f.size}-${f.lastModified}`, file: f, status: 'queued' });
		}
		uploadQueue = [...uploadQueue, ...next];
		input.value = ''; // allow re-selecting the same file

		// Kick off inspection for every new item. This runs sequentially to
		// avoid hammering the CRM with 5 × 20 MB base64 payloads at once,
		// which is mean to both the browser and the server.
		void inspectQueue();
	}

	/**
	 * Minimal concurrency limiter — like p-limit but inline to avoid a
	 * dependency for ~15 lines. Ensures no more than `max` async tasks
	 * run at once; useful for bounding simultaneous base64→server round
	 * trips when the user queues 10+ ZIPs.
	 */
	function createLimiter(max: number) {
		let active = 0;
		const queue: Array<() => void> = [];
		const next = () => {
			if (active >= max || queue.length === 0) return;
			active++;
			const run = queue.shift()!;
			run();
		};
		return async function <T>(fn: () => Promise<T>): Promise<T> {
			return new Promise<T>((resolve, reject) => {
				queue.push(() => {
					fn()
						.then(resolve, reject)
						.finally(() => {
							active--;
							next();
						});
				});
				next();
			});
		};
	}

	/**
	 * Inspect every queued item that hasn't been looked at yet.
	 *
	 * Uses a concurrency limit of 3 so the server never sees more than
	 * 3 × 50 MB base64 payloads in flight at once. Sequential flow per
	 * item: File → base64 → POST /inspect → classify.
	 *
	 * Items with ambiguous / same-version / downgrade verdicts start in
	 * `skipped` status; the operator can opt back in via force-install
	 * (for same/downgrade) or by picking a candidate (ambiguous).
	 */
	async function inspectQueue() {
		const limit = createLimiter(3);
		const indices = uploadQueue
			.map((item, i) => (item.status === 'queued' ? i : -1))
			.filter((i) => i >= 0);

		await Promise.all(
			indices.map((i) =>
				limit(async () => {
					uploadQueue[i] = { ...uploadQueue[i], status: 'inspecting' };
					uploadQueue = [...uploadQueue];
					try {
						const dataBase64 = await fileToBase64(uploadQueue[i].file);
						const res = await fetch(`${apiBase}/inspect`, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ filename: uploadQueue[i].file.name, dataBase64 })
						});
						const body = (await res.json().catch(() => ({}))) as {
							info?: PluginZipInfo;
							verdict?: InspectVerdict;
							error?: string;
						};
						if (!res.ok || !body.info || !body.verdict) {
							uploadQueue[i] = {
								...uploadQueue[i],
								status: 'error',
								message: body.error || `HTTP ${res.status}`
							};
							uploadQueue = [...uploadQueue];
							return;
						}
						// Auto-skip verdicts that don't warrant install.
						const shouldSkip =
							body.verdict.kind === 'same_version' ||
							body.verdict.kind === 'downgrade' ||
							body.verdict.kind === 'ambiguous';
						uploadQueue[i] = {
							...uploadQueue[i],
							status: shouldSkip ? 'skipped' : 'inspected',
							info: body.info,
							verdict: body.verdict,
							forceInstall: false,
							disambiguatedMatch: undefined
						};
					} catch (err) {
						uploadQueue[i] = {
							...uploadQueue[i],
							status: 'error',
							message: err instanceof Error ? err.message : 'Inspect failed'
						};
					}
					uploadQueue = [...uploadQueue];
				})
			)
		);

		// The inspect endpoint probes /plugins fresh on the site. That data
		// is usually newer than what the page rendered on mount (WordPress's
		// own auto-update cron may have bumped a plugin between the two
		// calls). Re-sync the page's plugin list so the badge shown on the
		// card matches the installed version the verdict used — otherwise
		// operators see "list says 4.12.2 → 4.13.1" and "inspect says same
		// version 4.13.1" at the same time, which looks like a bug.
		await loadPlugins();
	}

	/**
	 * Operator toggles force-install for same-version / downgrade items.
	 * Flipping on moves status back to 'inspected' so it participates in
	 * the bulk upload; flipping off sends it to 'skipped' again.
	 */
	function toggleForce(id: string) {
		const idx = uploadQueue.findIndex((i) => i.id === id);
		if (idx < 0) return;
		const item = uploadQueue[idx];
		if (!item.verdict) return;
		if (item.verdict.kind !== 'same_version' && item.verdict.kind !== 'downgrade') return;
		const next = !item.forceInstall;
		uploadQueue[idx] = {
			...item,
			forceInstall: next,
			status: next ? 'inspected' : 'skipped'
		};
		uploadQueue = [...uploadQueue];
	}

	/**
	 * For ambiguous verdicts, the operator picks which installed plugin
	 * the ZIP corresponds to. Selecting "install as new" (empty value)
	 * moves the item to `inspected` with no disambiguation.
	 * Selecting an installed plugin slug also moves to `inspected`.
	 * Selecting "skip" puts it back into `skipped`.
	 */
	function disambiguate(id: string, choice: string) {
		const idx = uploadQueue.findIndex((i) => i.id === id);
		if (idx < 0) return;
		const item = uploadQueue[idx];
		if (item.verdict?.kind !== 'ambiguous') return;
		if (choice === '__skip__') {
			uploadQueue[idx] = { ...item, status: 'skipped', disambiguatedMatch: undefined };
		} else {
			uploadQueue[idx] = { ...item, status: 'inspected', disambiguatedMatch: choice };
		}
		uploadQueue = [...uploadQueue];
	}

	function removeFromQueue(id: string) {
		uploadQueue = uploadQueue.filter((i) => i.id !== id);
	}

	function resetQueue() {
		uploadQueue = [];
	}

	async function runBulkUpload() {
		if (uploadQueue.length === 0) return;
		uploading = true;
		const failures: string[] = [];
		let skippedCount = 0;
		for (let i = 0; i < uploadQueue.length; i++) {
			const current = uploadQueue[i];
			// Skip items already resolved (allows retry of failures only) and
			// items we've explicitly marked as skipped (same version etc.).
			if (current.status === 'success' || current.status === 'skipped') {
				if (current.status === 'skipped') skippedCount++;
				continue;
			}
			// Don't start an upload on an item that hasn't been inspected yet
			// — means the inspect pass is still running. Leave it and keep going.
			if (current.status === 'inspecting' || current.status === 'queued') {
				continue;
			}
			uploadQueue[i] = { ...current, status: 'uploading' };
			uploadQueue = [...uploadQueue];
			try {
				const dataBase64 = await fileToBase64(uploadQueue[i].file);
				uploadQueue[i] = { ...uploadQueue[i], status: 'installing' };
				uploadQueue = [...uploadQueue];

				const res = await fetch(`${apiBase}/install`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						filename: uploadQueue[i].file.name,
						mimeType: uploadQueue[i].file.type || 'application/zip',
						dataBase64,
						activate: uploadAutoActivate
					})
				});
				const body = (await res.json().catch(() => ({}))) as {
					error?: string;
					plugin?: string;
					activated?: boolean;
					activationError?: string | null;
				};
				if (!res.ok) {
					uploadQueue[i] = {
						...uploadQueue[i],
						status: 'error',
						message: body.error || `HTTP ${res.status}`
					};
					failures.push(uploadQueue[i].file.name);
				} else {
					uploadQueue[i] = {
						...uploadQueue[i],
						status: 'success',
						installedAs: body.plugin,
						activated: body.activated,
						message: body.activationError ?? undefined
					};
				}
			} catch (err) {
				uploadQueue[i] = {
					...uploadQueue[i],
					status: 'error',
					message: err instanceof Error ? err.message : 'Eroare necunoscută'
				};
				failures.push(uploadQueue[i].file.name);
			}
			uploadQueue = [...uploadQueue];
		}
		uploading = false;
		const processed = uploadQueue.length - skippedCount;
		if (failures.length === 0 && skippedCount === 0) {
			toast.success(`${processed} plugin-uri procesate`);
		} else if (failures.length === 0) {
			toast.success(
				`${processed} procesate, ${skippedCount} sărite (aceeași versiune sau downgrade)`
			);
		} else {
			toast.warning(
				`${processed - failures.length} ok, ${failures.length} eșuate${skippedCount > 0 ? `, ${skippedCount} sărite` : ''}`
			);
		}
		await loadPlugins();
	}

	/**
	 * Shape of the reactivation outcome. `status` drives the toast; the
	 * optional fields feed the "manual intervention" affordance.
	 */
	type ReactivationOutcome = {
		status: 'not_needed' | 'ok' | 'permanent_failure' | 'transient_failure';
		error?: string;
		subcode?: string;
		output?: string;
	};

	/**
	 * Try to bring a plugin back to active after an upgrade.
	 *
	 * Distinguishes three buckets via the connector's subcode (v0.6.2+)
	 * and the CRM-side classifier of the 5xx body:
	 *   - `maintenance_mode` / `generic_5xx`      → transient, retry a few times
	 *   - `activation_hook_fatal` / `php_fatal`   → permanent, fail fast
	 *   - `activation_fatal` / `activation_redirect` from connector → permanent
	 *
	 * Never retries permanent errors: re-running the activation hook risks
	 * side effects (extra DB writes, duplicate default data).
	 */
	async function tryReactivate(plugin: string): Promise<ReactivationOutcome> {
		const transientBackoffs = [2000, 5000, 10000]; // ~17s total
		let lastError: ReactivationOutcome = {
			status: 'transient_failure',
			error: 'Nicio încercare nu a fost făcută'
		};

		for (let attempt = 0; attempt <= transientBackoffs.length; attempt++) {
			if (attempt > 0) {
				await new Promise((r) => setTimeout(r, transientBackoffs[attempt - 1]));
			}
			try {
				const actRes = await fetch(`${apiBase}/action`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ action: 'activate', plugin })
				});
				const actBody = (await actRes.json().catch(() => ({}))) as {
					success?: boolean;
					active?: boolean;
					error?: string;
					code?: string;
					subcode?: string;
					output_captured?: string;
					bodySnippet?: string;
				};

				// Transport OK (200) and activation reported success.
				if (actRes.ok && actBody.success !== false) {
					return { status: 'ok' };
				}

				// Connector v0.6.2+ reports structured failure at 200. Any of
				// the activation_* subcodes mean "the plugin is broken in a way
				// that retrying won't fix". Bail immediately.
				if (
					actRes.ok &&
					actBody.success === false &&
					actBody.subcode &&
					actBody.subcode.startsWith('activation_')
				) {
					return {
						status: 'permanent_failure',
						error: actBody.error || 'Hook-ul de activare a eșuat',
						subcode: actBody.subcode,
						output: actBody.output_captured
					};
				}

				// Permanent classifier from the CRM side (body looked like a PHP fatal).
				if (actBody.subcode === 'php_fatal' || actBody.subcode === 'activation_hook_fatal') {
					return {
						status: 'permanent_failure',
						error: actBody.error || 'PHP fatal după activare',
						subcode: actBody.subcode,
						output: actBody.bodySnippet
					};
				}

				// Transient — record and keep trying.
				lastError = {
					status: 'transient_failure',
					error: actBody.error || `HTTP ${actRes.status}`,
					subcode: actBody.subcode || 'generic_5xx',
					output: actBody.bodySnippet
				};
			} catch (err) {
				lastError = {
					status: 'transient_failure',
					error: err instanceof Error ? err.message : 'eroare rețea'
				};
			}
		}

		return lastError;
	}

	/**
	 * Update a single plugin by calling the batch apply-updates endpoint
	 * with a one-item list, then explicitly reactivate if it was active
	 * before. The connector plugin (v0.6.2+) already attempts a silent
	 * reactivation server-side; this second pass handles older connectors
	 * and real transient failures.
	 */
	async function updateSingle(p: WpPlugin) {
		if (!p.updateAvailable) return;
		const wasActive = p.active;
		busyPlugins.add(p.plugin);
		try {
			const res = await fetch(
				`/${tenantSlug}/api/wordpress/sites/${siteId}/apply-updates`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ items: [{ type: 'plugin', slug: p.plugin }] })
				}
			);
			const body = (await res.json().catch(() => ({}))) as {
				error?: string;
				status?: 'success' | 'partial' | 'failed';
				items?: Array<{
					success: boolean;
					message?: string | null;
					error?: string | null;
					was_active?: boolean;
					reactivated?: boolean | null;
					reactivation_error?: string | null;
					reactivation_subcode?: string | null;
					reactivation_output?: string | null;
				}>;
			};
			if (!res.ok || body.status === 'failed') {
				const first = body.items?.[0];
				const detail = first?.message || first?.error || body.error || 'Update eșuat';
				toast.error(`${p.name}: ${detail}`);
				return;
			}

			// Refresh list first — WP may have reactivated the plugin on its own,
			// or the connector's own safe-activate ran successfully.
			await loadPlugins();

			let outcome: ReactivationOutcome = { status: 'not_needed' };
			if (wasActive) {
				const fresh = plugins.find((x) => x.plugin === p.plugin);
				const connectorAlreadyReactivated = body.items?.[0]?.reactivated === true;
				if (fresh && !fresh.active && !connectorAlreadyReactivated) {
					outcome = await tryReactivate(p.plugin);
					if (outcome.status === 'ok') {
						await loadPlugins();
					}
				} else {
					outcome = { status: 'ok' };
				}
			}

			if (body.status === 'partial') {
				toast.warning(`${p.name}: update parțial`);
			} else if (outcome.status === 'permanent_failure') {
				// Plugin's activation hook itself is broken (redirect, fatal,
				// self-deactivate). Retrying won't help — operator must inspect
				// in wp-admin/plugins.php directly.
				const reason = outcome.error ?? 'hook de activare eșuat';
				toast.error(
					`${p.name}: activare imposibilă (${outcome.subcode ?? 'activation_hook_fatal'}). ${reason}. Activează manual din wp-admin.`,
					{ duration: 12000 }
				);
			} else if (outcome.status === 'transient_failure') {
				toast.warning(
					`${p.name} actualizat la ${p.newVersion}, dar reactivarea a eșuat după 3 încercări: ${outcome.error ?? 'unknown'}. Încearcă manual butonul Activează.`,
					{ duration: 10000 }
				);
			} else {
				toast.success(`${p.name} actualizat la ${p.newVersion}`);
			}
		} catch (err) {
			toast.error('Eroare de rețea la update');
			console.error(err);
		} finally {
			busyPlugins.delete(p.plugin);
		}
	}

	async function runAction(p: WpPlugin, action: 'activate' | 'deactivate' | 'delete') {
		if (action === 'delete') {
			if (
				!confirm(
					`Ștergi plugin-ul „${p.name}" complet de pe site? Fișierele se elimină definitiv.`
				)
			)
				return;
		}
		busyPlugins.add(p.plugin);
		try {
			const res = await fetch(`${apiBase}/action`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action, plugin: p.plugin })
			});
			const body = (await res.json().catch(() => ({}))) as { error?: string };
			if (!res.ok) {
				toast.error(body.error || `${action} eșuat`);
				return;
			}
			const label =
				action === 'activate' ? 'activat' : action === 'deactivate' ? 'dezactivat' : 'șters';
			toast.success(`${p.name} ${label}`);
			await loadPlugins();
		} catch (err) {
			toast.error('Eroare de rețea');
			console.error(err);
		} finally {
			busyPlugins.delete(p.plugin);
		}
	}
</script>

<svelte:head>
	<title>Plugin-uri WordPress — OTS CRM</title>
</svelte:head>

<div class="flex h-full flex-col gap-4 p-6">
	<div class="flex items-center gap-2">
		<a href="/{tenantSlug}/wordpress">
			<Button variant="ghost" size="sm">
				<ArrowLeftIcon class="mr-2 size-4" />
				Înapoi la site-uri
			</Button>
		</a>
	</div>

	<div class="flex items-center justify-between gap-2">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Plugin-uri</h1>
			<p class="text-sm text-muted-foreground">
				{plugins.length} plugin-uri instalate · {activeCount} active
				{#if updatesCount > 0}
					· <span class="text-amber-600 font-medium">{updatesCount} update-uri disponibile</span>
					{#if libraryCount > 0}
						<span class="text-violet-700 dark:text-violet-400">({libraryCount} din bibliotecă)</span>
					{/if}
				{/if}
			</p>
		</div>
		<div class="flex items-center gap-2">
			<Button onclick={() => (uploadOpen = true)}>
				<UploadIcon class="mr-2 size-4" />
				Upload plugin-uri (ZIP)
			</Button>
			<Button variant="outline" onclick={reloadAll} disabled={loading} title="Refresh">
				<RefreshCwIcon class="mr-2 size-4 {loading ? 'animate-spin' : ''}" />
				Refresh
			</Button>
		</div>
	</div>

	<div class="flex items-center gap-2">
		<div class="relative flex-1 max-w-md">
			<SearchIcon class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
			<Input
				type="search"
				placeholder="Caută după nume, autor sau descriere…"
				bind:value={searchQuery}
				class="pl-9"
			/>
		</div>
		<Select type="single" bind:value={statusFilter}>
			<SelectTrigger class="w-[200px]">
				{statusFilter === 'all'
					? 'Toate'
					: statusFilter === 'active'
						? 'Active'
						: statusFilter === 'inactive'
							? 'Inactive'
							: 'Cu update disponibil'}
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="all">Toate</SelectItem>
				<SelectItem value="active">Active</SelectItem>
				<SelectItem value="inactive">Inactive</SelectItem>
				<SelectItem value="updates">Cu update disponibil</SelectItem>
			</SelectContent>
		</Select>
		{#if updatablePlugins.length > 0}
			<div class="ml-auto flex items-center gap-3">
				<label class="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
					<Checkbox
						checked={allSelected}
						onCheckedChange={(v) => toggleSelectAll(v === true)}
						disabled={planRunning}
					/>
					Selectează toate ({updatablePlugins.length})
				</label>
				<Button
					disabled={selectedCount === 0 || planRunning}
					onclick={() => openPlan(updatablePlugins.filter((p) => selected.has(p.plugin)).map((p) => p.plugin))}
				>
					<ArrowUpCircleIcon class="mr-2 size-4" />
					Actualizează selectate ({selectedCount})
				</Button>
			</div>
		{/if}
	</div>

	{#if loading && plugins.length === 0}
		<div class="py-8 text-center text-sm text-muted-foreground">Se încarcă…</div>
	{:else if filtered.length === 0}
		<Card class="flex flex-col items-center justify-center gap-3 p-12 text-center">
			<PlugIcon class="size-12 text-muted-foreground" />
			<div>
				<h3 class="text-lg font-medium">Niciun plugin găsit</h3>
				<p class="text-sm text-muted-foreground">
					{searchQuery || statusFilter !== 'all'
						? 'Schimbă filtrele sau caută altceva.'
						: 'Site-ul nu are plugin-uri instalate.'}
				</p>
			</div>
		</Card>
	{:else}
		<div class="space-y-3">
			{#each filtered as p (p.plugin)}
				{@const lib = libraryUpdateFor(p)}
				<Card
					class="group relative overflow-hidden border-2 transition-all duration-300 hover:shadow-md {p.active
						? 'hover:border-primary/20'
						: 'opacity-75 hover:opacity-100 hover:border-muted-foreground/20'}"
				>
					<div
						class="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r {p.active
							? 'from-primary via-primary/80 to-primary/60'
							: 'from-muted-foreground/30 to-muted-foreground/10'}"
					></div>
					<div class="p-4 pt-5">
						<div class="flex items-start justify-between gap-4">
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2 flex-wrap mb-2">
									{#if canUpdate(p)}
										<Checkbox
											checked={selected.has(p.plugin)}
											onCheckedChange={(v) => {
												if (v === true) selected.add(p.plugin);
												else selected.delete(p.plugin);
											}}
											disabled={planRunning}
											aria-label="Selectează {p.name} pentru update"
										/>
									{/if}
									<div class="p-1.5 rounded-lg {p.active ? 'bg-primary/10' : 'bg-muted'}">
										<PlugIcon class="h-3.5 w-3.5 {p.active ? 'text-primary' : 'text-muted-foreground'}" />
									</div>
									<h3 class="text-lg font-bold tracking-tight text-foreground">{p.name}</h3>
									{#if p.active}
										<Badge variant="default" class="text-xs">Activ</Badge>
									{:else}
										<Badge variant="secondary" class="text-xs">Inactiv</Badge>
									{/if}
									{#if p.updateAvailable}
										<Badge
											variant="outline"
											class="flex items-center gap-1 text-xs border-amber-500 text-amber-600 dark:text-amber-400"
										>
											<ArrowUpCircleIcon class="size-3" />
											{p.version} → {p.newVersion}
										</Badge>
									{:else}
										<span class="text-xs text-muted-foreground">v{p.version}</span>
									{/if}
									{#if p.network}
										<Badge variant="outline" class="text-[10px]">Network</Badge>
									{/if}
									{#if p.autoUpdate}
										<Badge variant="outline" class="text-[10px]">Auto-update</Badge>
									{/if}
								</div>
								<p class="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap mb-2">
									<span>
										de
										{#if p.authorUri}
											<a href={p.authorUri} target="_blank" rel="noopener noreferrer" class="hover:underline">
												{p.author}
											</a>
										{:else}
											{p.author || 'autor necunoscut'}
										{/if}
									</span>
									{#if p.pluginUri}
										<span class="w-1 h-1 rounded-full bg-muted-foreground/40"></span>
										<a
											href={p.pluginUri}
											target="_blank"
											rel="noopener noreferrer"
											class="flex items-center gap-0.5 hover:underline"
										>
											Website <ExternalLinkIcon class="size-3" />
										</a>
									{/if}
									<span class="w-1 h-1 rounded-full bg-muted-foreground/40"></span>
									<code class="rounded bg-muted px-1 py-0.5 text-[10px]">{p.plugin}</code>
								</p>
								{#if p.description}
									<p class="text-sm text-muted-foreground line-clamp-2">{p.description}</p>
								{/if}
							</div>

							<div class="flex shrink-0 items-center gap-1.5">
								{#if lib}
									<!-- Newer ZIP in the plugin library: install it over the current one. -->
									<Button
										size="sm"
										class="bg-violet-600 hover:bg-violet-700 text-white border-violet-600"
										disabled={busyPlugins.has(p.plugin) || planRunning}
										onclick={() => openPlan([p.plugin])}
										title="Actualizează din biblioteca de plugin-uri: {p.version} → {lib.libraryVersion}{lib.dependsOn
											? ` (după baza ${lib.dependsOn.name})`
											: ''}"
									>
										{#if busyPlugins.has(p.plugin)}
											<LoaderIcon class="mr-2 size-3.5 animate-spin" />
										{:else}
											<LibraryBigIcon class="mr-2 size-3.5" />
										{/if}
										Update {lib.libraryVersion} (bibliotecă)
									</Button>
								{/if}
								{#if p.updateAvailable && p.updatePackage}
									<!-- Update is auto-installable via Plugin_Upgrader. -->
									<Button
										size="sm"
										class="bg-amber-500 hover:bg-amber-600 text-white border-amber-500"
										disabled={busyPlugins.has(p.plugin)}
										onclick={() => updateSingle(p)}
										title="Actualizează la {p.newVersion}"
									>
										{#if busyPlugins.has(p.plugin)}
											<LoaderIcon class="mr-2 size-3.5 animate-spin" />
										{:else}
											<ArrowUpCircleIcon class="mr-2 size-3.5" />
										{/if}
										Update {p.newVersion}
									</Button>
								{:else if p.updateAvailable && !p.updatePackage && !lib}
									<!-- Update known but license-gated. Offer a clear manual path:
									     upload ZIP manually via the dialog, or click for details. -->
									<Tooltip.Root>
										<Tooltip.Trigger>
											{#snippet child({ props })}
												<a
													{...props}
													href={p.updateUrl || p.pluginUri || '#'}
													target="_blank"
													rel="noopener noreferrer"
													class="inline-flex items-center gap-1.5 rounded-md border border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100 px-3 py-1.5 text-xs font-medium transition-colors dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-700"
												>
													<ArrowUpCircleIcon class="size-3.5" />
													v{p.newVersion} (license)
												</a>
											{/snippet}
										</Tooltip.Trigger>
										<Tooltip.Content class="max-w-xs">
											<!-- Tooltip background is solid `bg-primary` (blue), so
											     the default `text-muted-foreground` subtitle turns
											     near-invisible. Force `text-primary-foreground` with
											     85 % opacity for the secondary line — matches the
											     inverted-surface treatment used elsewhere. -->
											<p class="text-xs font-semibold mb-1 text-primary-foreground">
												Update disponibil: v{p.newVersion}
											</p>
											<p class="text-xs text-primary-foreground/85 leading-relaxed">
												{p.updateMessage ||
													'Necesită licență activă. Activează licența în wp-admin sau uploadează ZIP manual.'}
											</p>
										</Tooltip.Content>
									</Tooltip.Root>
								{/if}
								{#if p.active}
									<Button
										variant="outline"
										size="sm"
										disabled={busyPlugins.has(p.plugin)}
										onclick={() => runAction(p, 'deactivate')}
										title="Dezactivează"
									>
										<PowerOffIcon class="mr-2 size-3.5" />
										Dezactivează
									</Button>
								{:else}
									<Button
										variant="outline"
										size="sm"
										disabled={busyPlugins.has(p.plugin)}
										onclick={() => runAction(p, 'activate')}
										title="Activează"
									>
										<PowerIcon class="mr-2 size-3.5" />
										Activează
									</Button>
								{/if}
								<Button
									variant="outline"
									size="icon"
									class="h-8 w-8 border-2"
									disabled={busyPlugins.has(p.plugin) || p.active}
									onclick={() => runAction(p, 'delete')}
									title={p.active ? 'Dezactivează înainte de a șterge' : 'Șterge definitiv'}
								>
									<Trash2Icon class="size-3.5 {p.active ? 'text-muted-foreground' : 'text-destructive'}" />
								</Button>
							</div>
						</div>
					</div>
				</Card>
			{/each}
		</div>
	{/if}
</div>

<!-- Update plan: order (base before PRO), optional backup, live progress per step. -->
<Dialog bind:open={planOpen}>
	<DialogContent class="max-w-xl">
		<DialogHeader>
			<DialogTitle>
				{planFinished ? 'Rezultat update' : planRunning ? 'Se actualizează…' : 'Actualizare plugin-uri'}
			</DialogTitle>
			<DialogDescription>
				Rulează pe rând, în ordinea de mai jos: baza înaintea PRO-ului, iar un PRO nu rulează dacă
				baza lui a eșuat.
			</DialogDescription>
		</DialogHeader>

		{#if backupState}
			<div class="flex items-center gap-2 text-sm">
				{#if backupState.state === 'running'}
					<div class="flex-1">
						<WpJobProgress {...backupView ?? nextJobView(null, {}, 'Backup complet: ')} />
					</div>
				{:else if backupState.state === 'ok'}
					<CheckCircleIcon class="size-4 text-green-600" />
					<span>Backup făcut</span>
				{:else}
					<XCircleIcon class="size-4 text-destructive" />
					<span class="text-destructive">Backup eșuat: {backupState.message}. Update-urile nu au rulat.</span>
				{/if}
			</div>
		{/if}

		<ol class="max-h-[50vh] space-y-2 overflow-y-auto text-sm">
			{#each planSteps as step, i (step.key)}
				{@const pr = planProgress[step.key]}
				<li class="flex items-start gap-2 rounded-md border px-3 py-2">
					<span class="mt-0.5 shrink-0">
						{#if pr?.state === 'installing'}
							<LoaderIcon class="size-4 animate-spin text-amber-600" />
						{:else if pr?.state === 'done'}
							<CheckCircleIcon class="size-4 text-green-600" />
						{:else if pr?.state === 'failed'}
							<XCircleIcon class="size-4 text-destructive" />
						{:else}
							<span class="inline-block w-4 text-center text-xs text-muted-foreground">{i + 1}</span>
						{/if}
					</span>
					<div class="min-w-0 flex-1">
						<div class="flex flex-wrap items-baseline gap-x-2">
							<span class="font-medium">{step.name}</span>
							<span class="font-mono text-xs text-muted-foreground">
								{step.fromVersion ?? '?'} → {pr?.state === 'done' ? pr.toVersion : step.toVersion}
							</span>
							<span class="text-xs text-muted-foreground">
								({step.kind === 'wporg' ? 'WordPress' : 'bibliotecă'}{step.autoIncluded && step.requiredBy
									? `, bază pentru ${step.requiredBy}`
									: ''})
							</span>
						</div>
						{#if pr && pr.state !== 'installing' && pr.message}
							<p class="mt-0.5 break-words text-xs {pr.state === 'failed' ? 'text-destructive' : 'text-amber-700 dark:text-amber-400'}">
								{pr.message}
							</p>
						{/if}
					</div>
				</li>
			{/each}
		</ol>

		{#if !planRunning && !planFinished}
			<label class="flex items-center gap-2 text-sm cursor-pointer select-none">
				<Checkbox checked={backupFirst} onCheckedChange={(v) => (backupFirst = v === true)} />
				Backup complet înainte (recomandat; durează câteva minute)
			</label>
		{/if}

		<DialogFooter>
			{#if planFinished}
				<Button onclick={() => (planOpen = false)}>
					<CheckIcon class="mr-2 size-4" />
					Închide
				</Button>
			{:else}
				<Button variant="outline" onclick={() => (planOpen = false)} disabled={planRunning}>
					Anulează
				</Button>
				<Button onclick={runPlan} disabled={planRunning}>
					{#if planRunning}
						<LoaderIcon class="mr-2 size-4 animate-spin" />
						Se actualizează…
					{:else}
						<ArrowUpCircleIcon class="mr-2 size-4" />
						Actualizează {planSteps.length === 1 ? '' : `(${planSteps.length})`}
					{/if}
				</Button>
			{/if}
		</DialogFooter>
	</DialogContent>
</Dialog>

<Dialog bind:open={uploadOpen}>
	<DialogContent class="max-w-2xl max-h-[80vh] overflow-y-auto">
		<DialogHeader>
			<DialogTitle>Upload plugin-uri</DialogTitle>
			<DialogDescription>
				Selectează unul sau mai multe fișiere ZIP (max. 50 MB fiecare). CRM-ul le trimite pe rând la
				site — plugin-uri noi sunt instalate, cele existente sunt suprascrise (update). Activarea
				automată se poate debifa pentru instalări silențioase.
			</DialogDescription>
		</DialogHeader>

		<div class="flex flex-col gap-3">
			<label
				class="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-6 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted/40"
			>
				<FileArchiveIcon class="size-8" />
				<span class="font-medium text-foreground">Alege fișiere ZIP</span>
				<span class="text-xs">sau trage-le aici</span>
				<input
					type="file"
					accept=".zip,application/zip"
					multiple
					class="hidden"
					onchange={pickUploadFiles}
					disabled={uploading}
				/>
			</label>

			<div class="flex items-center gap-2 rounded-md bg-muted/40 p-2.5 text-xs">
				<input
					id="wp-auto-activate"
					type="checkbox"
					class="size-4"
					bind:checked={uploadAutoActivate}
					disabled={uploading}
				/>
				<Label for="wp-auto-activate" class="cursor-pointer">
					Activează automat după install (recomandat)
				</Label>
			</div>

			{#if uploadQueue.length > 0}
				<div class="flex flex-col divide-y divide-border rounded-md border border-border">
					{#each uploadQueue as item (item.id)}
						<div class="flex flex-col gap-1.5 p-2.5 text-sm">
							<div class="flex items-center gap-2">
								<div class="shrink-0">
									{#if item.status === 'queued'}
										<FileArchiveIcon class="size-4 text-muted-foreground" />
									{:else if item.status === 'inspecting' || item.status === 'uploading' || item.status === 'installing'}
										<LoaderIcon class="size-4 animate-spin text-muted-foreground" />
									{:else if item.status === 'success'}
										<CheckCircleIcon class="size-4 text-green-600" />
									{:else if item.status === 'skipped'}
										<FileArchiveIcon class="size-4 text-amber-500" />
									{:else if item.status === 'inspected'}
										<FileArchiveIcon class="size-4 text-blue-500" />
									{:else}
										<XCircleIcon class="size-4 text-red-600" />
									{/if}
								</div>
								<div class="min-w-0 flex-1">
									<div class="truncate font-medium">
										{item.info?.name ?? item.file.name}
									</div>
									<div class="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
										<span>{(item.file.size / 1024 / 1024).toFixed(2)} MB</span>
										{#if item.info?.slug}
											<span>· <code class="rounded bg-muted px-1">{item.info.slug}</code></span>
										{/if}

										{#if item.status === 'queued'}
											<span>· în așteptare</span>
										{:else if item.status === 'inspecting'}
											<span>· se inspectează…</span>
										{/if}

										{#if item.verdict?.kind === 'new'}
											<span class="text-blue-600 font-medium">· NOU v{item.info?.version}</span>
										{:else if item.verdict?.kind === 'upgrade'}
											<span class="text-green-600 font-medium">
												· UPGRADE v{item.verdict.installedVersion} → v{item.info?.version}
											</span>
											<span class="text-muted-foreground/70">
												· match: {item.verdict.match.reasons.join(', ')} ({item.verdict.match.score})
											</span>
										{:else if item.verdict?.kind === 'same_version'}
											<span class="text-amber-600 font-medium">
												· ACEEAȘI VERSIUNE v{item.verdict.installedVersion} — skip
											</span>
										{:else if item.verdict?.kind === 'downgrade'}
											<span class="text-red-600 font-medium">
												· DOWNGRADE v{item.verdict.installedVersion} → v{item.info?.version} — skip
											</span>
										{:else if item.verdict?.kind === 'ambiguous'}
											<span class="text-purple-600 font-medium">
												· AMBIGUU — alege manual
											</span>
										{/if}

										{#if item.status === 'uploading'}
											<span>· se urcă…</span>
										{:else if item.status === 'installing'}
											<span>· WP instalează…</span>
										{:else if item.status === 'success'}
											<span class="text-green-600">
												· {item.installedAs}
												{#if item.activated}· activat{:else}· nu s-a activat{/if}
											</span>
										{:else if item.status === 'error'}
											<span class="text-red-600 break-all">· {item.message}</span>
										{/if}
									</div>
								</div>

								{#if (item.verdict?.kind === 'same_version' || item.verdict?.kind === 'downgrade') && !uploading && item.status !== 'success'}
									<label class="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer select-none shrink-0">
										<input
											type="checkbox"
											class="size-3.5"
											checked={item.forceInstall ?? false}
											onchange={() => toggleForce(item.id)}
										/>
										Force
									</label>
								{/if}

								{#if !uploading && item.status !== 'uploading' && item.status !== 'installing' && item.status !== 'inspecting'}
									<Button
										variant="ghost"
										size="icon"
										class="h-7 w-7"
										onclick={() => removeFromQueue(item.id)}
										title="Șterge din listă"
									>
										<XCircleIcon class="size-3.5" />
									</Button>
								{/if}
							</div>

							<!-- Ambiguous verdict: inline disambiguation control. -->
							{#if item.verdict?.kind === 'ambiguous' && !uploading && item.status !== 'success'}
								<div class="ml-6 flex items-center gap-2 text-xs">
									<span class="text-muted-foreground shrink-0">Match cu:</span>
									<select
										class="flex-1 rounded-md border bg-background px-2 py-1 text-xs"
										value={item.disambiguatedMatch ?? '__skip__'}
										onchange={(e) => disambiguate(item.id, (e.target as HTMLSelectElement).value)}
									>
										<option value="__skip__">-- Skip --</option>
										{#each item.verdict.candidates as c}
											<option value={c.plugin}>
												{c.installedName} (v{c.installedVersion}, scor {c.score})
											</option>
										{/each}
										<option value="__new__">-- Instalează ca nou --</option>
									</select>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<DialogFooter>
			{#if uploadQueue.length > 0 && !uploading}
				<Button variant="ghost" onclick={resetQueue}>Golește lista</Button>
			{/if}
			<Button variant="outline" onclick={() => (uploadOpen = false)} disabled={uploading}>
				Închide
			</Button>
			<Button
				onclick={runBulkUpload}
				disabled={uploading ||
					uploadQueue.length === 0 ||
					uploadQueue.filter((i) => i.status === 'inspected').length === 0}
			>
				{#if uploading}
					<LoaderIcon class="mr-2 size-4 animate-spin" />
					Se procesează…
				{:else}
					<UploadIcon class="mr-2 size-4" />
					{@const installCount = uploadQueue.filter((i) => i.status === 'inspected').length}
					{@const skipCount = uploadQueue.filter((i) => i.status === 'skipped').length}
					Instalează {installCount} fișier(e){skipCount > 0 ? ` (${skipCount} skip)` : ''}
				{/if}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
