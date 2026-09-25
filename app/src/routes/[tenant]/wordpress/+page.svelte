<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import { Card } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogFooter,
		DialogHeader,
		DialogTitle
	} from '$lib/components/ui/dialog';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import CircleXIcon from '@lucide/svelte/icons/circle-x';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import CircleIcon from '@lucide/svelte/icons/circle';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import KeyIcon from '@lucide/svelte/icons/key';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import ShieldAlertIcon from '@lucide/svelte/icons/shield-alert';
	import ArrowUpCircleIcon from '@lucide/svelte/icons/arrow-up-circle';
	import DatabaseBackupIcon from '@lucide/svelte/icons/database-backup';
	import PauseIcon from '@lucide/svelte/icons/pause';
	import PlayIcon from '@lucide/svelte/icons/play';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import HistoryIcon from '@lucide/svelte/icons/history';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import ServerIcon from '@lucide/svelte/icons/server';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import NewspaperIcon from '@lucide/svelte/icons/newspaper';
	import PlugIcon from '@lucide/svelte/icons/plug';
	import LibraryBigIcon from '@lucide/svelte/icons/library-big';
	import {
		continueSiteBackup,
		nextJobView,
		runSiteBackup,
		runSiteRestore,
		type JobView
	} from '$lib/logic/wordpress-backup-run';
	import WpJobProgress from '$lib/components/wordpress/WpJobProgress.svelte';
	import WpCachePurgeLine from '$lib/components/wordpress/WpCachePurgeLine.svelte';
	import {
		describeCachePurge,
		requestCachePurge,
		type CachePurgeOutcome
	} from '$lib/logic/wordpress-cache-purge';

	type UpdateCounts = {
		core: number;
		plugins: number;
		themes: number;
		security: number;
		total: number;
	};

	type WpSite = {
		id: string;
		name: string;
		siteUrl: string;
		status: 'connected' | 'disconnected' | 'error' | 'pending';
		uptimeStatus: 'up' | 'down' | 'unknown';
		wpVersion: string | null;
		phpVersion: string | null;
		connectorVersion?: string | null;
		lastHealthCheckAt: string | null;
		lastUptimePingAt: string | null;
		lastUpdatesCheckAt: string | null;
		lastError: string | null;
		consecutiveFailures: number;
		clientId: string | null;
		clientName: string | null;
		paused: number; // 1 = scheduler skips this site
		createdAt: string;
		updates: UpdateCounts;
	};

	type PendingUpdate = {
		id: string;
		type: 'core' | 'plugin' | 'theme';
		slug: string;
		name: string;
		currentVersion: string;
		newVersion: string;
		securityUpdate: number;
		autoUpdate: number;
	};

	type BackupRow = {
		id: string;
		trigger: string;
		status: string;
		archiveUrl: string | null;
		sizeBytes: number | null;
		error: string | null;
		startedAt: string | null;
		finishedAt: string | null;
		createdAt: string;
	};

	type ApplyResultItem = { type: string; slug: string; success: boolean; message: string };

	const tenantSlug = $derived(page.params.tenant);
	const apiBase = $derived(`/${tenantSlug}/api/wordpress/sites`);

	let sites = $state<WpSite[]>([]);
	let loading = $state(true);
	const refreshingIds = new SvelteSet<string>();

	let addOpen = $state(false);
	let addForm = $state({ name: '', siteUrl: '', secretKey: '' });
	let adding = $state(false);

	let generatedSecret = $state<string | null>(null);
	let generatedSecretOpen = $state(false);

	let rotateOpen = $state(false);
	let rotateForm = $state({ siteId: '', siteName: '', secret: '' });
	let rotating = $state(false);

	// Updates dialog state
	let updatesOpen = $state(false);
	let updatesSite = $state<WpSite | null>(null);
	let updatesList = $state<PendingUpdate[]>([]);
	let updatesLoading = $state(false);
	let updatesApplying = $state(false);
	const selectedUpdateIds = new SvelteSet<string>();
	let applyResults = $state<ApplyResultItem[] | null>(null);
	/** Cache purge after applying updates; `outcome` null = running. */
	let applyCache = $state<{ outcome: CachePurgeOutcome | null } | null>(null);
	let backupFirst = $state(true);

	// Backups dialog state
	let backupsOpen = $state(false);
	let backupsSite = $state<WpSite | null>(null);
	let backupsList = $state<BackupRow[]>([]);
	let backupsLoading = $state(false);
	let triggeringBackup = $state(false);
	// One line of live progress for the backup / restore that is running.
	let backupProgress = $state<JobView | null>(null);
	let restoreProgress = $state<JobView | null>(null);
	const deletingBackupIds = new SvelteSet<string>();

	// Restore confirm dialog state
	let restoreOpen = $state(false);
	let restoreTarget = $state<{ siteId: string; siteName: string; backupId: string; createdAt: string } | null>(null);
	let restoreConfirmText = $state('');
	let restoring = $state(false);

	// Pausing state — used to disable the toggle while the PATCH is in-flight
	const pausingIds = new SvelteSet<string>();

	// Live /health sweep that runs once when the page opens, so the badges
	// show the connection as it is now, not the last cron/refresh result.
	let checkingHealth = $state(false);

	// Plugins with a newer ZIP in the plugin library, per site. WordPress'
	// own pending updates (site.updates) never include these, so without
	// this count a site could read "La zi" while its plugins page lists
	// library updates.
	let libraryUpdates = $state<Record<string, number>>({});

	// Delete-site confirm dialog state
	let deleteOpen = $state(false);
	let deleteTarget = $state<WpSite | null>(null);
	let deleting = $state(false);

	// Connector-update state — tracks which sites are mid-push so the icon
	// shows a spinner. `connectorLatest` is fetched once on mount; UI
	// compares each site's own `connectorVersion` against this to decide
	// whether to badge the button.
	const connectorUpdatingIds = new SvelteSet<string>();
	let connectorLatest = $state<{
		version: string;
		uploadedAt: string;
		size: number;
		sha256: string;
		notes: string | null;
	} | null>(null);

	/**
	 * Per-site result flash — green dot for ~2s after success, red dot
	 * after failure until the operator retries. Distinct from the amber
	 * "update available" indicator which reflects persistent state.
	 */
	let connectorUpdateResult = $state<Record<string, 'success' | 'error'>>({});

	// Confirmation modal state for connector updates. Modern Dialog
	// replaces native `confirm()` so the UX matches the rest of the
	// app (styled buttons, backdrop blur, consistent spacing).
	let connectorConfirmOpen = $state(false);
	let connectorConfirmSite = $state<WpSite | null>(null);

	// Bulk update flow state.
	type BulkResult = {
		siteId: string;
		name: string;
		url: string;
		status: 'updated' | 'already_current' | 'failed' | 'skipped_paused' | 'skipped_disconnected';
		fromVersion?: string | null;
		toVersion?: string | null;
		error?: string;
	};
	let bulkConfirmOpen = $state(false);
	let bulkRunning = $state(false);
	let bulkResultsOpen = $state(false);
	let bulkResults = $state<BulkResult[]>([]);
	let bulkSummary = $state<{
		total: number;
		updated: number;
		alreadyCurrent: number;
		failed: number;
		skipped: number;
	} | null>(null);
	let bulkTargetVersion = $state<string | null>(null);

	// Compare semver-ish — mirrors compareConnectorVersions() on server.
	function cmpVer(a: string, b: string): number {
		if (a === b) return 0;
		const norm = (v: string) =>
			v
				.toLowerCase()
				.replace(/[-_+]/g, '.')
				.replace(/([0-9])([a-z])/g, '$1.$2')
				.replace(/([a-z])([0-9])/g, '$1.$2');
		const pa = norm(a).split('.').filter(Boolean);
		const pb = norm(b).split('.').filter(Boolean);
		const len = Math.max(pa.length, pb.length);
		for (let i = 0; i < len; i++) {
			const x = pa[i] ?? '0';
			const y = pb[i] ?? '0';
			if (x === y) continue;
			const nx = /^\d+$/.test(x) ? Number(x) : null;
			const ny = /^\d+$/.test(y) ? Number(y) : null;
			if (nx !== null && ny !== null) {
				if (nx !== ny) return nx < ny ? -1 : 1;
				continue;
			}
			return x < y ? -1 : 1;
		}
		return 0;
	}

	function connectorUpdateAvailable(site: WpSite): boolean {
		if (!connectorLatest) return false;
		if (!site.connectorVersion) return true; // unknown = show indicator
		return cmpVer(site.connectorVersion, connectorLatest.version) < 0;
	}

	/**
	 * Build the URL to Google's favicon CDN for a site. Google picks the
	 * best available icon (Apple touch, PNG, ICO) at the requested size
	 * and falls back to a generic globe if the site has none — so we
	 * always get *something* to display.
	 *
	 * Matches the pattern used in backlinks + client-edit pages so the
	 * same logo shows up across the app for the same domain.
	 */
	function getFaviconUrl(siteUrl: string): string {
		try {
			const host = new URL(siteUrl).hostname.replace(/^www\./, '');
			return `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
		} catch {
			return '';
		}
	}

	const totalSecurityUpdates = $derived(
		sites.reduce((sum, s) => sum + (s.updates?.security ?? 0), 0)
	);

	// `loading` starts true and only gates the first render; later reloads
	// (after a refresh, the live health sweep, a delete) swap the data in place
	// instead of blanking the list.
	async function loadSites() {
		try {
			const res = await fetch(apiBase);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = (await res.json()) as { sites: WpSite[] };
			sites = data.sites;
		} catch (err) {
			toast.error('Nu s-au putut încărca site-urile WordPress');
			console.error(err);
		} finally {
			loading = false;
		}
	}

	async function loadConnectorLatest() {
		try {
			const res = await fetch(`/${tenantSlug}/api/wordpress/connector-release`);
			if (!res.ok) return;
			const data = (await res.json()) as { latest: typeof connectorLatest };
			connectorLatest = data.latest;
		} catch {
			// Silent — no release published yet is a valid state.
		}
	}

	/**
	 * Opens the styled confirmation modal. The actual push happens in
	 * `confirmConnectorUpdate()` after the operator clicks "Actualizează".
	 */
	function updateConnectorOnSite(site: WpSite) {
		if (connectorUpdatingIds.has(site.id)) return;
		if (!connectorLatest) {
			toast.error('Nicio versiune publicată. Rulează scripts/publish-connector.ts.');
			return;
		}
		connectorConfirmSite = site;
		connectorConfirmOpen = true;
	}

	/**
	 * Fire the update for the site currently staged in the confirm
	 * dialog. Closes the modal immediately; progress shows on the
	 * site card (spinner icon) while the push is in flight.
	 */
	async function confirmConnectorUpdate() {
		const site = connectorConfirmSite;
		if (!site || !connectorLatest) return;
		connectorConfirmOpen = false;
		connectorConfirmSite = null;

		connectorUpdatingIds.add(site.id);
		// Clear any prior flash for this site before starting.
		if (connectorUpdateResult[site.id]) {
			const { [site.id]: _, ...rest } = connectorUpdateResult;
			connectorUpdateResult = rest;
		}
		try {
			const res = await fetch(`${apiBase}/${site.id}/connector-update`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({})
			});
			const body = (await res.json().catch(() => ({}))) as {
				success?: boolean;
				skipped?: boolean;
				reason?: string;
				fromVersion?: string | null;
				toVersion?: string;
				error?: string;
			};
			if (!res.ok) {
				toast.error(body.error || `Update eșuat (HTTP ${res.status})`);
				connectorUpdateResult = { ...connectorUpdateResult, [site.id]: 'error' };
				return;
			}
			if (body.skipped) {
				toast.info(`${site.name}: deja la zi (v${body.toVersion})`);
			} else {
				toast.success(
					`${site.name}: connector v${body.fromVersion ?? '?'} → v${body.toVersion}`
				);
			}
			connectorUpdateResult = { ...connectorUpdateResult, [site.id]: 'success' };
			// Auto-clear the green flash after 3s — the persistent state
			// (no amber dot) will reflect that the site is now up-to-date.
			// Errors stick around until a new attempt; they're louder on
			// purpose so operators don't miss them.
			setTimeout(() => {
				if (connectorUpdateResult[site.id] === 'success') {
					const { [site.id]: _, ...rest } = connectorUpdateResult;
					connectorUpdateResult = rest;
				}
			}, 3000);
			await loadSites();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Eroare de rețea');
			connectorUpdateResult = { ...connectorUpdateResult, [site.id]: 'error' };
		} finally {
			connectorUpdatingIds.delete(site.id);
		}
	}

	/**
	 * Trigger the bulk connector update sweep. Hits the server endpoint
	 * that mirrors the daily cron's logic: for every unpaused, connected
	 * site scoped to this tenant, probe /health, compare versions, push
	 * the ZIP from MinIO if outdated.
	 *
	 * Results dialog opens once the sweep completes — single round-trip,
	 * no streaming. For a fleet of ~20 sites the total wait is under
	 * ~60s (4 concurrent, each health + install ≤ ~8s on average).
	 */
	async function runBulkConnectorUpdate() {
		bulkConfirmOpen = false;
		bulkRunning = true;
		bulkResults = [];
		bulkSummary = null;
		try {
			const res = await fetch(`/${tenantSlug}/api/wordpress/connector-bulk-update`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({})
			});
			const body = (await res.json().catch(() => ({}))) as {
				success?: boolean;
				targetVersion?: string;
				summary?: typeof bulkSummary;
				results?: BulkResult[];
				error?: string;
			};
			if (!res.ok || !body.success) {
				toast.error(body.error || `Bulk update eșuat (HTTP ${res.status})`);
				return;
			}
			bulkResults = body.results ?? [];
			bulkSummary = body.summary ?? null;
			bulkTargetVersion = body.targetVersion ?? null;
			bulkResultsOpen = true;

			// Quick toast summary — operator usually just wants the headline.
			if (bulkSummary) {
				const { updated, failed, alreadyCurrent, skipped } = bulkSummary;
				if (failed > 0) {
					toast.warning(
						`${updated} actualizate, ${failed} eșuate, ${alreadyCurrent} deja la zi${skipped ? `, ${skipped} sărite` : ''}`
					);
				} else if (updated > 0) {
					toast.success(
						`${updated} site-uri actualizate la v${body.targetVersion}${alreadyCurrent > 0 ? `, ${alreadyCurrent} deja la zi` : ''}`
					);
				} else {
					toast.info(
						`Toate site-urile sunt deja la v${body.targetVersion}${skipped ? ` (${skipped} sărite)` : ''}`
					);
				}
			}
			await loadSites();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Eroare de rețea la bulk update');
		} finally {
			bulkRunning = false;
		}
	}

	/**
	 * Signed /health on every unpaused site (server persists the outcome),
	 * then reload the list. The DB state is rendered first so the page is
	 * usable immediately; badges switch to the live result when this ends.
	 */
	async function checkAllHealth() {
		checkingHealth = true;
		try {
			const res = await fetch(`${apiBase}/health-check`, { method: 'POST' });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			await loadSites();
		} catch (err) {
			toast.error('Verificarea conexiunilor a eșuat');
			console.error(err);
		} finally {
			checkingHealth = false;
		}
		await loadLibraryUpdates();
	}

	/**
	 * Same comparison the plugins page runs, for every connected site (3 at a
	 * time). Counts what that page offers as "Update (bibliotecă)" (newer
	 * library version, same folder, not already covered by wordpress.org)
	 * and WordPress itself does not report yet.
	 */
	async function loadLibraryUpdates() {
		const targets = sites.filter((s) => s.status === 'connected' && !s.paused);
		const next: Record<string, number> = {};
		const queue = [...targets];
		const worker = async () => {
			for (let site = queue.shift(); site; site = queue.shift()) {
				try {
					const res = await fetch(`${apiBase}/${site.id}/plugins/library-compare`);
					if (!res.ok) continue;
					const body = (await res.json()) as {
						items?: Array<{
							status: string;
							folderMismatch: boolean;
							preferredSource: string;
							wpUpdate: unknown;
						}>;
					};
					// Plugins WordPress already reports (wpUpdate set) are in site.updates;
					// count only the ones the library adds on top.
					next[site.id] = (body.items ?? []).filter(
						(i) =>
							i.status === 'update_available' &&
							!i.folderMismatch &&
							i.preferredSource === 'library' &&
							!i.wpUpdate
					).length;
				} catch {
					// A site that can't be listed keeps its WordPress-side count only.
				}
			}
		};
		await Promise.all([worker(), worker(), worker()]);
		libraryUpdates = next;
	}

	onMount(() => {
		void loadSites().then(() => {
			if (sites.length > 0) void checkAllHealth();
		});
		void loadConnectorLatest();
	});

	function openDelete(site: WpSite) {
		deleteTarget = site;
		deleteOpen = true;
	}

	async function confirmDelete() {
		const site = deleteTarget;
		if (!site) return;
		deleting = true;
		try {
			const res = await fetch(`${apiBase}/${site.id}`, { method: 'DELETE' });
			const body = (await res.json().catch(() => ({}))) as { error?: string };
			if (!res.ok) {
				toast.error(body.error || `Ștergerea a eșuat (HTTP ${res.status})`);
				return;
			}
			toast.success(`${site.name} a fost șters din CRM`);
			deleteOpen = false;
			deleteTarget = null;
			await loadSites();
		} catch (err) {
			toast.error('Eroare de rețea');
			console.error(err);
		} finally {
			deleting = false;
		}
	}

	async function addSite() {
		if (!addForm.name.trim() || !addForm.siteUrl.trim()) {
			toast.error('Completează numele și URL-ul');
			return;
		}
		adding = true;
		try {
			const res = await fetch(apiBase, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: addForm.name.trim(),
					siteUrl: addForm.siteUrl.trim(),
					secretKey: addForm.secretKey.trim() || undefined
				})
			});
			const body = (await res.json().catch(() => ({}))) as {
				error?: string;
				secret?: string;
			};
			if (!res.ok) {
				toast.error(body.error || 'Eroare la adăugare');
				return;
			}
			toast.success('Site adăugat');
			addOpen = false;
			if (body.secret) {
				generatedSecret = body.secret;
				generatedSecretOpen = true;
			}
			addForm = { name: '', siteUrl: '', secretKey: '' };
			await loadSites();
		} catch (err) {
			toast.error('Eroare de rețea');
			console.error(err);
		} finally {
			adding = false;
		}
	}

	async function refreshSite(id: string) {
		refreshingIds.add(id);
		try {
			const res = await fetch(`${apiBase}/${id}/refresh`, { method: 'POST' });
			const body = (await res.json().catch(() => ({}))) as { error?: string };
			if (!res.ok) {
				toast.error(body.error || 'Eroare la refresh');
			} else if (body.error) {
				toast.error(`Refresh cu eroare: ${body.error}`);
			} else {
				toast.success('Actualizat');
			}
			await loadSites();
		} catch (err) {
			toast.error('Eroare de rețea');
			console.error(err);
		} finally {
			refreshingIds.delete(id);
		}
	}

	function openRotate(site: WpSite) {
		rotateForm = { siteId: site.id, siteName: site.name, secret: '' };
		rotateOpen = true;
	}

	async function openUpdates(site: WpSite) {
		updatesSite = site;
		updatesOpen = true;
		updatesList = [];
		applyResults = null;
		applyCache = null;
		selectedUpdateIds.clear();
		updatesLoading = true;
		try {
			const res = await fetch(`${apiBase}/${site.id}/updates`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = (await res.json()) as { updates: PendingUpdate[] };
			updatesList = data.updates;
			// Pre-select security updates to nudge the user toward safe defaults.
			for (const u of data.updates) {
				if (u.securityUpdate) selectedUpdateIds.add(u.id);
			}
		} catch (err) {
			toast.error('Nu s-au putut încărca update-urile');
			console.error(err);
		} finally {
			updatesLoading = false;
		}
	}

	async function refreshUpdates() {
		if (!updatesSite) return;
		updatesLoading = true;
		applyResults = null;
		applyCache = null;
		try {
			const res = await fetch(`${apiBase}/${updatesSite.id}/updates`, { method: 'POST' });
			const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
			if (!res.ok || !body.ok) {
				toast.error(body.error || 'Refresh eșuat');
			} else {
				toast.success('Update-uri actualizate');
			}
			// Reload list after refresh
			const listRes = await fetch(`${apiBase}/${updatesSite.id}/updates`);
			const listBody = (await listRes.json()) as { updates: PendingUpdate[] };
			updatesList = listBody.updates;
			selectedUpdateIds.clear();
			for (const u of listBody.updates) {
				if (u.securityUpdate) selectedUpdateIds.add(u.id);
			}
			await loadSites();
		} catch (err) {
			toast.error('Eroare de rețea');
			console.error(err);
		} finally {
			updatesLoading = false;
		}
	}

	function toggleUpdateSelection(id: string) {
		if (selectedUpdateIds.has(id)) selectedUpdateIds.delete(id);
		else selectedUpdateIds.add(id);
	}

	function selectAllUpdates(filter?: 'security' | 'all' | 'none') {
		if (filter === 'none') {
			selectedUpdateIds.clear();
			return;
		}
		for (const u of updatesList) {
			if (filter === 'security') {
				if (u.securityUpdate) selectedUpdateIds.add(u.id);
				else selectedUpdateIds.delete(u.id);
			} else {
				selectedUpdateIds.add(u.id);
			}
		}
	}

	async function applySelectedUpdates() {
		if (!updatesSite || selectedUpdateIds.size === 0) return;
		const items = updatesList
			.filter((u) => selectedUpdateIds.has(u.id))
			.map((u) => ({ type: u.type, slug: u.slug }));
		if (items.length === 0) return;
		const siteApi = `${apiBase}/${updatesSite.id}`;

		updatesApplying = true;
		applyResults = null;
		applyCache = null;
		try {
			if (backupFirst) {
				backupProgress = nextJobView(null, {}, 'Backup înainte de update-uri: ');
				const backup = await runSiteBackup(`${apiBase}/${updatesSite.id}`, {
					trigger: 'pre_update',
					onProgress: (p) => (backupProgress = nextJobView(backupProgress, p, 'Backup: '))
				});
				backupProgress = null;
				if (!backup.ok) {
					toast.error(`Backup eșuat: ${backup.error}. Update-urile nu au rulat.`);
					return;
				}
				toast.success('Backup OK. Rulez update-uri…');
			}

			const res = await fetch(`${apiBase}/${updatesSite.id}/apply-updates`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ items })
			});
			const body = (await res.json().catch(() => ({}))) as {
				status?: string;
				error?: string;
				items?: ApplyResultItem[];
			};
			if (!res.ok) {
				toast.error(body.error || 'Update-urile au eșuat');
				applyResults = body.items ?? null;
				return;
			}
			applyResults = body.items ?? [];
			if (body.status === 'success') toast.success('Toate update-urile au reușit');
			else if (body.status === 'partial') toast.warning('Unele update-uri au eșuat');
			else toast.error('Update-urile au eșuat');
			// Pages cached before the update keep the old CSS/JS until emptied.
			if (applyResults.some((r) => r.success)) {
				applyCache = { outcome: null };
				applyCache = { outcome: await requestCachePurge(siteApi) };
			}
			// Refresh the counts on the main list.
			await loadSites();
		} catch (err) {
			toast.error('Eroare de rețea');
			console.error(err);
		} finally {
			updatesApplying = false;
		}
	}

	async function openBackups(site: WpSite) {
		backupsSite = site;
		backupsOpen = true;
		backupsList = [];
		backupsLoading = true;
		try {
			const res = await fetch(`${apiBase}/${site.id}/backups`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = (await res.json()) as { backups: BackupRow[] };
			backupsList = data.backups;
		} catch (err) {
			toast.error('Nu s-au putut încărca backup-urile');
			console.error(err);
		} finally {
			backupsLoading = false;
		}
	}

	async function reloadBackupsList(siteId: string) {
		const listRes = await fetch(`${apiBase}/${siteId}/backups`);
		const listBody = (await listRes.json()) as { backups: BackupRow[] };
		backupsList = listBody.backups;
	}

	/**
	 * New backup, or `resumeId` to continue one left running. Chunked on
	 * connector 0.8.0+ (short steps, live progress); older connectors answer
	 * in one call.
	 */
	async function runBackup(resumeId?: string) {
		if (!backupsSite) return;
		const siteId = backupsSite.id;
		triggeringBackup = true;
		backupProgress = nextJobView(null, {});
		let listed = false;
		const onProgress = (p: Parameters<typeof nextJobView>[1]) => {
			backupProgress = nextJobView(backupProgress, p);
			// Show the new "running" row as soon as the job exists.
			if (!listed) {
				listed = true;
				void reloadBackupsList(siteId).catch(() => undefined);
			}
		};
		try {
			const result = resumeId
				? await continueSiteBackup(`${apiBase}/${siteId}`, resumeId, { onProgress })
				: await runSiteBackup(`${apiBase}/${siteId}`, { trigger: 'manual', onProgress });
			if (result.ok) toast.success(`Backup creat (${formatBytes(result.sizeBytes ?? null)})`);
			else toast.error(`Backup eșuat: ${result.error}`);
			await reloadBackupsList(siteId);
		} catch (err) {
			toast.error('Eroare de rețea');
			console.error(err);
		} finally {
			triggeringBackup = false;
			backupProgress = null;
		}
	}

	async function togglePause(site: WpSite) {
		const nextPaused = site.paused ? false : true;
		pausingIds.add(site.id);
		try {
			const res = await fetch(`${apiBase}/${site.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ paused: nextPaused })
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { error?: string };
				toast.error(body.error || 'Eroare la schimbare');
				return;
			}
			toast.success(nextPaused ? 'Monitorizare pauzată' : 'Monitorizare reactivată');
			await loadSites();
		} catch (err) {
			toast.error('Eroare de rețea');
			console.error(err);
		} finally {
			pausingIds.delete(site.id);
		}
	}

	async function deleteBackup(backup: BackupRow) {
		if (!backupsSite) return;
		if (!confirm('Ștergi backup-ul? Fișierul va fi eliminat de pe serverul WordPress.')) return;
		deletingBackupIds.add(backup.id);
		try {
			const res = await fetch(`${apiBase}/${backupsSite.id}/backups/${backup.id}`, {
				method: 'DELETE'
			});
			const body = (await res.json().catch(() => ({}))) as { error?: string; warning?: string };
			if (!res.ok) {
				toast.error(body.error || 'Ștergerea a eșuat');
				return;
			}
			if (body.warning) toast.warning(body.warning);
			else toast.success('Backup șters');
			backupsList = backupsList.filter((b) => b.id !== backup.id);
		} catch (err) {
			toast.error('Eroare de rețea');
			console.error(err);
		} finally {
			deletingBackupIds.delete(backup.id);
		}
	}

	function openRestore(backup: BackupRow) {
		if (!backupsSite) return;
		restoreTarget = {
			siteId: backupsSite.id,
			siteName: backupsSite.name,
			backupId: backup.id,
			createdAt: backup.createdAt
		};
		restoreConfirmText = '';
		restoreOpen = true;
	}

	async function confirmRestore() {
		if (!restoreTarget) return;
		if (restoreConfirmText !== restoreTarget.siteName) {
			toast.error('Numele site-ului nu corespunde');
			return;
		}
		restoring = true;
		restoreProgress = nextJobView(null, {});
		try {
			const result = await runSiteRestore(
				`${apiBase}/${restoreTarget.siteId}`,
				restoreTarget.backupId,
				{ onProgress: (p) => (restoreProgress = nextJobView(restoreProgress, p)) }
			);
			if (!result.ok) {
				toast.error(`Restore eșuat: ${result.error}`, { duration: 15000 });
				return;
			}
			toast.success(`Restore complet pentru ${restoreTarget.siteName}`);
			if (result.cache) {
				const view = describeCachePurge(result.cache);
				if (view.tone === 'warning') toast.warning(view.text, { duration: 10000 });
				else toast.info(view.text);
			}
			restoreOpen = false;
			restoreTarget = null;
			restoreConfirmText = '';
			// Health might be temporarily wonky right after a restore; refresh.
			await loadSites();
		} catch (err) {
			toast.error('Eroare de rețea');
			console.error(err);
		} finally {
			restoring = false;
			restoreProgress = null;
		}
	}

	function formatBytes(bytes: number | null): string {
		if (!bytes) return '—';
		const mb = bytes / 1024 / 1024;
		if (mb < 1) return `${(bytes / 1024).toFixed(0)} KB`;
		if (mb < 1024) return `${mb.toFixed(1)} MB`;
		return `${(mb / 1024).toFixed(2)} GB`;
	}

	async function saveRotatedSecret() {
		const secret = rotateForm.secret.trim();
		if (secret.length !== 64 || !/^[0-9a-f]+$/i.test(secret)) {
			toast.error('Secretul trebuie să aibă exact 64 caractere hex');
			return;
		}
		rotating = true;
		try {
			const res = await fetch(`${apiBase}/${rotateForm.siteId}/secret`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ secret })
			});
			const body = (await res.json().catch(() => ({}))) as { error?: string; success?: boolean };
			if (!res.ok) {
				toast.error(body.error || 'Eroare la salvare');
				return;
			}
			if (body.success) {
				toast.success('Secret actualizat. Site conectat.');
			} else {
				toast.error(`Secret salvat, dar health check a eșuat: ${body.error ?? 'necunoscut'}`);
			}
			rotateOpen = false;
			rotateForm = { siteId: '', siteName: '', secret: '' };
			await loadSites();
		} catch (err) {
			toast.error('Eroare de rețea');
			console.error(err);
		} finally {
			rotating = false;
		}
	}

	function copySecret() {
		if (!generatedSecret) return;
		navigator.clipboard
			.writeText(generatedSecret)
			.then(() => toast.success('Copiat în clipboard'))
			.catch(() => toast.error('Nu s-a putut copia'));
	}

	function formatDate(iso: string | null): string {
		if (!iso) return 'Niciodată';
		try {
			const d = new Date(iso);
			return d.toLocaleString('ro-RO', { dateStyle: 'short', timeStyle: 'short' });
		} catch {
			return iso;
		}
	}

	/**
	 * `connected` survives up to 2 network failures in a row (the 3-strike
	 * rule absorbs blips for the cron), but the operator should still see
	 * that the last check did not get through.
	 */
	function isFailing(site: WpSite): boolean {
		return site.status === 'connected' && site.consecutiveFailures > 0;
	}

	function statusBadgeVariant(site: WpSite): 'default' | 'secondary' | 'destructive' | 'outline' {
		if (isFailing(site)) return 'outline';
		if (site.status === 'connected') return 'default';
		if (site.status === 'error' || site.status === 'disconnected') return 'destructive';
		return 'secondary';
	}

	function statusLabel(site: WpSite): string {
		if (isFailing(site)) return 'Nu răspunde';
		return (
			{
				connected: 'Conectat',
				disconnected: 'Deconectat',
				error: 'Eroare',
				pending: 'În așteptare'
			} as const
		)[site.status];
	}

	/** Plain-language cause + what to do, for the known connector errors. */
	function errorHint(lastError: string | null): string | null {
		if (!lastError) return null;
		if (lastError.startsWith('wp_auth_error'))
			return 'Secretul HMAC nu mai corespunde cu cel din plugin — resincronizează-l din butonul cu cheie.';
		if (lastError.startsWith('wp_plugin_missing'))
			return 'OTS Connector nu mai răspunde pe site — verifică dacă plugin-ul e instalat și activ.';
		return null;
	}
</script>

<svelte:head>
	<title>WordPress — OTS CRM</title>
</svelte:head>

<div class="flex h-full flex-col gap-4 p-6">
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Site-uri WordPress</h1>
			<p class="text-sm text-muted-foreground">
				Control centralizat pentru site-urile WordPress ale clienților.
			</p>
		</div>
		<div class="flex items-center gap-2">
			{#if checkingHealth}
				<span class="flex items-center gap-1.5 text-xs text-muted-foreground">
					<RefreshCwIcon class="size-3.5 animate-spin" />
					Se verifică conexiunile…
				</span>
			{/if}
			{#if totalSecurityUpdates > 0}
				<Badge variant="destructive" class="flex items-center gap-1 text-sm">
					<ShieldAlertIcon class="size-4" />
					{totalSecurityUpdates} update-uri de securitate în total
				</Badge>
			{/if}
			<a href="/{tenantSlug}/wordpress/plugin-library">
				<Button variant="outline" title="ZIP-uri de plugin-uri premium: compară versiunile și actualizează în lot">
					<LibraryBigIcon class="mr-2 size-4" />
					Bibliotecă plugin-uri
				</Button>
			</a>
			<a href="/{tenantSlug}/wordpress/diagnostics">
				<Button variant="outline" title="Dashboard live cu status per site">
					<ServerIcon class="mr-2 size-4" />
					Diagnostics
				</Button>
			</a>
			<!-- Bulk connector update: same logic as the daily cron, on demand.
			     Disabled during a sweep and when no release is published. -->
			<Button
				variant="outline"
				disabled={bulkRunning || !connectorLatest}
				onclick={() => (bulkConfirmOpen = true)}
				title={connectorLatest
					? `Push OTS Connector v${connectorLatest.version} pe toate site-urile`
					: 'Niciun release publicat'}
			>
				{#if bulkRunning}
					<RefreshCwIcon class="mr-2 size-4 animate-spin" />
					Se actualizează…
				{:else}
					<ArrowUpCircleIcon class="mr-2 size-4" />
					Update connector
					{#if connectorLatest}
						<span class="ml-1.5 text-xs text-muted-foreground font-mono">
							v{connectorLatest.version}
						</span>
					{/if}
				{/if}
			</Button>
			<Button onclick={() => (addOpen = true)}>
				<PlusIcon class="mr-2 size-4" />
				Adaugă site
			</Button>
		</div>
	</div>

	{#if loading}
		<div class="text-sm text-muted-foreground">Se încarcă…</div>
	{:else if sites.length === 0}
		<Card class="flex flex-col items-center justify-center gap-3 p-12 text-center">
			<GlobeIcon class="size-12 text-muted-foreground" />
			<div>
				<h3 class="text-lg font-medium">Niciun site WordPress adăugat</h3>
				<p class="text-sm text-muted-foreground">
					Instalează plugin-ul <strong>OTS Connector</strong> pe site-ul WordPress al clientului,
					apoi adaugă-l aici folosind secretul generat de plugin.
				</p>
			</div>
			<Button onclick={() => (addOpen = true)}>
				<PlusIcon class="mr-2 size-4" />
				Adaugă primul site
			</Button>
		</Card>
	{:else}
		<div class="space-y-4">
			{#each sites as site (site.id)}
				{@const libCount = libraryUpdates[site.id] ?? 0}
				<Card class="group relative overflow-hidden border-2 transition-all duration-300 hover:shadow-lg hover:shadow-primary/5 hover:border-primary/20 hover:-translate-y-0.5">
					<!-- Modern gradient accent bar -->
					<div class="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary via-primary/80 to-primary/60"></div>

					<div class="p-4 pt-5">
						<div class="flex items-start justify-between gap-4">
							<div class="flex-1 min-w-0">
								<!-- Header with site name, uptime dot, status badges -->
								<div class="flex items-center gap-2 mb-2 flex-wrap">
									<div class="flex items-center gap-1.5">
										<!-- Site favicon via Google's s2 CDN. Falls back to the
										     generic globe when the image can't load (dead site,
										     CSP blocking Google, etc.).
										     Square container (rounded-md = 6px) — matches the
										     client-edit / backlinks look elsewhere in the app. -->
										<div class="p-1 rounded-md bg-primary/10 group-hover:bg-primary/20 transition-colors flex items-center justify-center h-7 w-7 shrink-0">
											<img
												src={getFaviconUrl(site.siteUrl)}
												alt=""
												class="h-5 w-5 object-contain rounded-sm"
												loading="lazy"
												onerror={(e) => {
													const img = e.currentTarget as HTMLImageElement;
													img.style.display = 'none';
													const parent = img.parentElement;
													if (parent && !parent.querySelector('svg')) {
														parent.innerHTML = '<svg xmlns=\'http://www.w3.org/2000/svg\' class=\'h-3.5 w-3.5 text-primary\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'><circle cx=\'12\' cy=\'12\' r=\'10\'/><path d=\'M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z\'/></svg>';
													}
												}}
											/>
										</div>
										<h3 class="text-lg font-bold tracking-tight text-foreground">
											{site.name}
										</h3>
										{#if site.uptimeStatus === 'up'}
											<CircleCheckIcon class="size-4 text-green-600" aria-label="Uptime: Up" />
										{:else if site.uptimeStatus === 'down'}
											<CircleXIcon class="size-4 text-red-600" aria-label="Uptime: Down" />
										{:else}
											<CircleIcon class="size-4 text-muted-foreground" aria-label="Uptime: Unknown" />
										{/if}
									</div>
									<Badge
										variant={statusBadgeVariant(site)}
										class="text-xs font-semibold px-2 py-0.5 shadow-sm {isFailing(site)
											? 'border-amber-500/50 text-amber-700 dark:text-amber-400'
											: ''}"
									>
										{statusLabel(site)}
									</Badge>
									{#if site.paused}
										<Badge variant="secondary" class="flex items-center gap-1 text-xs px-2 py-0.5">
											<PauseIcon class="size-3" />
											Pauzat
										</Badge>
									{/if}
									{#if site.updates && site.updates.security > 0}
										<Badge variant="destructive" class="flex items-center gap-1 text-xs px-2 py-0.5 shadow-sm">
											<ShieldAlertIcon class="size-3" />
											{site.updates.security} securitate
										</Badge>
									{/if}
								</div>

								<!-- URL + client -->
								<p class="text-xs font-medium text-muted-foreground mb-4 flex items-center gap-1.5 flex-wrap">
									<a
										href={site.siteUrl}
										target="_blank"
										rel="noopener noreferrer"
										class="hover:text-primary hover:underline transition-colors"
									>
										{site.siteUrl}
									</a>
									{#if site.clientName}
										<span class="w-1 h-1 rounded-full bg-muted-foreground/40"></span>
										<span>Client: <span class="font-semibold text-foreground">{site.clientName}</span></span>
									{/if}
								</p>

								<!-- Modern info grid with icons -->
								<div class="grid gap-3 md:grid-cols-4">
									<!-- WordPress version — featured -->
									<div class="relative p-3 rounded-lg bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/10 group-hover:border-primary/20 transition-all">
										<div class="flex items-center gap-1.5 mb-1.5">
											<GlobeIcon class="h-3.5 w-3.5 text-primary/60" />
											<p class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">WordPress</p>
										</div>
										<p class="text-xl font-bold text-primary leading-tight">
											{site.wpVersion ?? '—'}
										</p>
									</div>

									<!-- PHP version -->
									<div class="p-3 rounded-lg bg-muted/30 border border-border/50 group-hover:bg-muted/50 transition-all">
										<div class="flex items-center gap-1.5 mb-1.5">
											<ServerIcon class="h-3.5 w-3.5 text-muted-foreground/60" />
											<p class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">PHP</p>
										</div>
										<p class="text-sm font-semibold text-foreground">
											{site.phpVersion ?? '—'}
										</p>
									</div>

									<!-- Updates pending: WordPress-side (opens the dialog) + plugin library (links to the plugins page) -->
									{#if site.updates && site.updates.total > 0}
										<div class="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/15 hover:border-amber-500/40 transition-all">
											<button type="button" onclick={() => openUpdates(site)} class="w-full text-left">
												<div class="flex items-center gap-1.5 mb-1.5">
													<ArrowUpCircleIcon class="h-3.5 w-3.5 text-amber-600/70" />
													<p class="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide">Updates</p>
												</div>
												<p class="text-sm font-semibold text-amber-700 dark:text-amber-400">
													{site.updates.total}
													<span class="ml-1 text-xs font-normal text-amber-600/70 dark:text-amber-500/80">
														({site.updates.core}c · {site.updates.plugins}p · {site.updates.themes}t)
													</span>
												</p>
											</button>
											{#if libCount > 0}
												<a href="/{tenantSlug}/wordpress/{site.id}/plugins" class="mt-1 block text-xs font-medium text-violet-700 hover:underline dark:text-violet-400">
													+{libCount} din bibliotecă →
												</a>
											{/if}
										</div>
									{:else if libCount > 0}
										<a
											href="/{tenantSlug}/wordpress/{site.id}/plugins"
											class="p-3 rounded-lg text-left bg-violet-500/10 border border-violet-500/20 hover:bg-violet-500/15 hover:border-violet-500/40 transition-all"
										>
											<div class="flex items-center gap-1.5 mb-1.5">
												<LibraryBigIcon class="h-3.5 w-3.5 text-violet-600/70" />
												<p class="text-xs font-semibold text-violet-700 dark:text-violet-400 uppercase tracking-wide">Updates</p>
											</div>
											<p class="text-sm font-semibold text-violet-700 dark:text-violet-400">
												{libCount}
												<span class="ml-1 text-xs font-normal text-violet-600/80 dark:text-violet-400/80">din bibliotecă</span>
											</p>
										</a>
									{:else}
										<div class="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
											<div class="flex items-center gap-1.5 mb-1.5">
												<CircleCheckIcon class="h-3.5 w-3.5 text-green-600/70" />
												<p class="text-xs font-semibold text-green-700 dark:text-green-400 uppercase tracking-wide">Updates</p>
											</div>
											<p class="text-sm font-semibold text-green-700 dark:text-green-400">
												La zi
											</p>
										</div>
									{/if}

									<!-- Last check -->
									<div class="p-3 rounded-lg bg-muted/30 border border-border/50 group-hover:bg-muted/50 transition-all">
										<div class="flex items-center gap-1.5 mb-1.5">
											<CalendarIcon class="h-3.5 w-3.5 text-muted-foreground/60" />
											<p class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ultima verificare</p>
										</div>
										<p class="text-sm font-semibold text-foreground">
											{formatDate(site.lastHealthCheckAt)}
										</p>
									</div>
								</div>

								{#if site.lastError && (site.status === 'error' || site.status === 'disconnected' || isFailing(site))}
									{@const hint = errorHint(site.lastError)}
									<div class="mt-3 flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/20 p-2.5 text-xs text-destructive">
										<CircleAlertIcon class="size-4 shrink-0 mt-0.5" />
										<div class="min-w-0 space-y-0.5">
											{#if hint}
												<p class="font-semibold">{hint}</p>
											{/if}
											<p class="break-words {hint ? 'opacity-80' : ''}">{site.lastError}</p>
										</div>
									</div>
								{/if}
							</div>

							<!-- Action buttons with modern styling -->
							<div class="flex items-center gap-1.5 flex-shrink-0">
								<!-- OTS Connector self-update.
								     Dot color semantics:
								       - (none)       site up-to-date and no recent activity
								       - amber pulse  update available on MinIO
								       - green        update succeeded (auto-clears after 3s)
								       - red          update failed (sticks until next attempt)
								     Inner icon spins while the push is in flight. -->
								<Button
									variant="outline"
									size="icon"
									class="relative h-8 w-8 border-2 hover:border-primary/50 hover:bg-primary/5 transition-all"
									disabled={connectorUpdatingIds.has(site.id)}
									onclick={() => updateConnectorOnSite(site)}
									title={connectorLatest
										? connectorUpdateResult[site.id] === 'error'
											? 'Ultima încercare a eșuat — click pentru retry'
											: connectorUpdateResult[site.id] === 'success'
												? `OTS Connector actualizat la v${connectorLatest.version}`
												: connectorUpdateAvailable(site)
													? `Update OTS Connector v${site.connectorVersion ?? '?'} → v${connectorLatest.version}`
													: `OTS Connector la zi (v${site.connectorVersion ?? connectorLatest.version})`
										: 'Niciun release publicat'}
								>
									{#if connectorUpdatingIds.has(site.id)}
										<RefreshCwIcon class="h-3.5 w-3.5 animate-spin text-amber-600" />
									{:else if connectorUpdateResult[site.id] === 'success'}
										<ArrowUpCircleIcon class="h-3.5 w-3.5 text-green-600" />
										<span class="absolute -top-0.5 -right-0.5 inline-flex h-2.5 w-2.5 rounded-full bg-green-500"></span>
									{:else if connectorUpdateResult[site.id] === 'error'}
										<ArrowUpCircleIcon class="h-3.5 w-3.5 text-red-600" />
										<span class="absolute -top-0.5 -right-0.5 inline-flex h-2.5 w-2.5 rounded-full bg-red-500"></span>
									{:else if connectorUpdateAvailable(site)}
										<ArrowUpCircleIcon class="h-3.5 w-3.5 text-amber-600" />
										<span class="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
											<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
											<span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
										</span>
									{:else}
										<ArrowUpCircleIcon class="h-3.5 w-3.5" />
									{/if}
								</Button>
								<Button
									variant="outline"
									size="icon"
									class="h-8 w-8 border-2 hover:border-primary/50 hover:bg-primary/5 transition-all"
									disabled={refreshingIds.has(site.id)}
									onclick={() => refreshSite(site.id)}
									title="Refresh"
								>
									<RefreshCwIcon class="h-3.5 w-3.5 {refreshingIds.has(site.id) ? 'animate-spin' : ''}" />
								</Button>
								<a href="/{tenantSlug}/wordpress/{site.id}/posts" title="Postări blog">
									<Button
										variant="outline"
										size="icon"
										class="h-8 w-8 border-2 hover:border-primary/50 hover:bg-primary/5 transition-all"
									>
										<NewspaperIcon class="h-3.5 w-3.5" />
									</Button>
								</a>
								<a href="/{tenantSlug}/wordpress/{site.id}/plugins" title="Plugin-uri">
									<Button
										variant="outline"
										size="icon"
										class="h-8 w-8 border-2 hover:border-primary/50 hover:bg-primary/5 transition-all"
									>
										<PlugIcon class="h-3.5 w-3.5" />
									</Button>
								</a>
								<Button
									variant="outline"
									size="icon"
									class="h-8 w-8 border-2 hover:border-primary/50 hover:bg-primary/5 transition-all"
									onclick={() => openBackups(site)}
									title="Backup-uri"
								>
									<DatabaseBackupIcon class="h-3.5 w-3.5" />
								</Button>
								<Button
									variant="outline"
									size="icon"
									class="h-8 w-8 border-2 hover:border-primary/50 hover:bg-primary/5 transition-all"
									onclick={() => togglePause(site)}
									disabled={pausingIds.has(site.id)}
									title={site.paused ? 'Reia monitorizarea' : 'Pune pe pauză'}
								>
									{#if site.paused}
										<PlayIcon class="h-3.5 w-3.5" />
									{:else}
										<PauseIcon class="h-3.5 w-3.5" />
									{/if}
								</Button>
								<Button
									variant="outline"
									size="icon"
									class="h-8 w-8 border-2 hover:border-primary/50 hover:bg-primary/5 transition-all"
									onclick={() => openRotate(site)}
									title="Schimbă secret HMAC"
								>
									<KeyIcon class="h-3.5 w-3.5" />
								</Button>
								<Button
									variant="outline"
									size="icon"
									class="h-8 w-8 border-2 text-destructive hover:border-destructive/50 hover:bg-destructive/5 hover:text-destructive transition-all"
									onclick={() => openDelete(site)}
									title="Șterge site-ul din CRM"
								>
									<Trash2Icon class="h-3.5 w-3.5" />
								</Button>
							</div>
						</div>
					</div>
				</Card>
			{/each}
		</div>
	{/if}
</div>

<!-- Delete site confirm dialog -->
<Dialog bind:open={deleteOpen}>
	<DialogContent>
		<DialogHeader>
			<DialogTitle>Ștergi {deleteTarget?.name}?</DialogTitle>
			<DialogDescription>
				Site-ul dispare din CRM împreună cu update-urile, istoricul de backup și postările
				sincronizate. Website-urile și articolele din Content legate de el rămân fără țintă
				WordPress. Instalarea WordPress nu este atinsă: OTS Connector rămâne pe site până îl
				dezinstalezi manual.
			</DialogDescription>
		</DialogHeader>
		<DialogFooter>
			<Button variant="outline" onclick={() => (deleteOpen = false)} disabled={deleting}>
				Anulează
			</Button>
			<Button variant="destructive" onclick={confirmDelete} disabled={deleting}>
				{#if deleting}
					<RefreshCwIcon class="mr-2 size-4 animate-spin" />
				{:else}
					<Trash2Icon class="mr-2 size-4" />
				{/if}
				Șterge
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>

<!-- Add site dialog -->
<Dialog bind:open={addOpen}>
	<DialogContent>
		<DialogHeader>
			<DialogTitle>Adaugă site WordPress</DialogTitle>
			<DialogDescription>
				Instalează plugin-ul OTS Connector pe site-ul clientului și copiază secretul generat mai jos.
				Dacă lași secretul gol, CRM-ul generează unul pe care îl copiezi în plugin după.
			</DialogDescription>
		</DialogHeader>

		<div class="flex flex-col gap-3">
			<div class="flex flex-col gap-1">
				<Label for="wp-name">Nume (label)</Label>
				<Input
					id="wp-name"
					bind:value={addForm.name}
					placeholder="Acme — Blog"
					autocomplete="off"
				/>
			</div>
			<div class="flex flex-col gap-1">
				<Label for="wp-url">URL site</Label>
				<Input
					id="wp-url"
					bind:value={addForm.siteUrl}
					placeholder="https://exemplu.ro"
					autocomplete="off"
				/>
			</div>
			<div class="flex flex-col gap-1">
				<Label for="wp-secret">Secret HMAC (opțional)</Label>
				<Input
					id="wp-secret"
					bind:value={addForm.secretKey}
					placeholder="Lasă gol pentru generare automată"
					autocomplete="off"
				/>
				<p class="text-xs text-muted-foreground">
					64 de caractere hex. Dacă îl lași gol, îl generăm și ți-l afișăm o singură dată.
				</p>
			</div>
		</div>

		<DialogFooter class="sm:justify-between gap-2">
			<!-- Left side: download the connector ZIP so the operator can install
			     it on the new WP site before/while they fill in the form above. -->
			{#if connectorLatest}
				<a
					href="/{tenantSlug}/api/wordpress/connector-release/download"
					download={`ots-wp-connector-v${connectorLatest.version}.zip`}
					class="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted/50 transition-colors"
					title="Descarcă ZIP pentru upload manual pe site"
				>
					<DownloadIcon class="size-3.5" />
					Descarcă OTS Connector v{connectorLatest.version}
				</a>
			{:else}
				<span class="text-xs text-muted-foreground italic">
					Niciun release publicat — rulează <code class="rounded bg-muted px-1">bun run connector:release</code>
				</span>
			{/if}

			<div class="flex gap-2">
				<Button variant="outline" onclick={() => (addOpen = false)} disabled={adding}>Anulează</Button>
				<Button onclick={addSite} disabled={adding}>
					{adding ? 'Se adaugă…' : 'Adaugă'}
				</Button>
			</div>
		</DialogFooter>
	</DialogContent>
</Dialog>

<!-- Connector update confirmation -->
<Dialog bind:open={connectorConfirmOpen}>
	<DialogContent class="sm:max-w-md">
		<DialogHeader>
			<div class="flex items-center gap-3">
				<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950/60">
					<ArrowUpCircleIcon class="h-5 w-5 text-amber-600 dark:text-amber-400" />
				</div>
				<div>
					<DialogTitle>Actualizare OTS Connector</DialogTitle>
					<DialogDescription class="mt-1">
						Vei trimite cea mai nouă versiune a plugin-ului nostru către site-ul selectat.
					</DialogDescription>
				</div>
			</div>
		</DialogHeader>

		{#if connectorConfirmSite && connectorLatest}
			<div class="space-y-3 py-2">
				<div class="rounded-lg border bg-muted/30 p-3 text-sm space-y-1.5">
					<div class="flex items-center justify-between">
						<span class="text-muted-foreground">Site</span>
						<span class="font-medium truncate ml-3">{connectorConfirmSite.name}</span>
					</div>
					<div class="flex items-center justify-between">
						<span class="text-muted-foreground">URL</span>
						<span class="font-mono text-xs truncate ml-3">{connectorConfirmSite.siteUrl}</span>
					</div>
					<div class="border-t my-1.5"></div>
					<div class="flex items-center justify-between">
						<span class="text-muted-foreground">Versiune actuală</span>
						<span class="font-mono">
							{connectorConfirmSite.connectorVersion
								? `v${connectorConfirmSite.connectorVersion}`
								: 'necunoscută'}
						</span>
					</div>
					<div class="flex items-center justify-between">
						<span class="text-muted-foreground">Versiune nouă</span>
						<span class="font-mono font-semibold text-amber-700 dark:text-amber-400">
							v{connectorLatest.version}
						</span>
					</div>
				</div>

				{#if connectorLatest.notes}
					<div class="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
						<span class="font-semibold block mb-0.5">Changelog</span>
						{connectorLatest.notes}
					</div>
				{/if}

				<p class="text-xs text-muted-foreground">
					Site-ul rămâne online pe durata operației. În caz de eșec, plugin-ul
					existent rămâne activ — nu se pierde nimic.
				</p>
			</div>
		{/if}

		<DialogFooter>
			<Button
				variant="outline"
				onclick={() => {
					connectorConfirmOpen = false;
					connectorConfirmSite = null;
				}}
			>
				Anulează
			</Button>
			<Button class="bg-amber-500 hover:bg-amber-600 text-white" onclick={confirmConnectorUpdate}>
				<ArrowUpCircleIcon class="mr-2 size-4" />
				Actualizează
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>

<!-- Bulk connector update — confirmation -->
<Dialog bind:open={bulkConfirmOpen}>
	<DialogContent class="sm:max-w-md">
		<DialogHeader>
			<div class="flex items-center gap-3">
				<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950/60">
					<ArrowUpCircleIcon class="h-5 w-5 text-amber-600 dark:text-amber-400" />
				</div>
				<div>
					<DialogTitle>Update OTS Connector — toate site-urile</DialogTitle>
					<DialogDescription class="mt-1">
						Verifică fiecare site și instalează ultima versiune acolo unde e nevoie.
					</DialogDescription>
				</div>
			</div>
		</DialogHeader>

		{#if connectorLatest}
			<div class="space-y-3 py-2">
				<div class="rounded-lg border bg-muted/30 p-3 text-sm space-y-1.5">
					<div class="flex items-center justify-between">
						<span class="text-muted-foreground">Versiune țintă</span>
						<span class="font-mono font-semibold text-amber-700 dark:text-amber-400">
							v{connectorLatest.version}
						</span>
					</div>
					<div class="flex items-center justify-between">
						<span class="text-muted-foreground">Site-uri eligibile</span>
						<span class="font-mono">
							{sites.filter((s) => s.status !== 'disconnected' && s.paused === 0).length}
							din {sites.length}
						</span>
					</div>
					{#if sites.some((s) => s.paused === 1)}
						<div class="flex items-center justify-between text-xs text-muted-foreground">
							<span>· pauzate</span>
							<span>{sites.filter((s) => s.paused === 1).length}</span>
						</div>
					{/if}
					{#if sites.some((s) => s.status === 'disconnected')}
						<div class="flex items-center justify-between text-xs text-muted-foreground">
							<span>· deconectate</span>
							<span>{sites.filter((s) => s.status === 'disconnected').length}</span>
						</div>
					{/if}
				</div>

				<p class="text-xs text-muted-foreground">
					Site-urile care au deja v{connectorLatest.version} sunt sărite automat.
					Operațiunea durează tipic 30-90 secunde în funcție de numărul de site-uri.
				</p>
			</div>
		{/if}

		<DialogFooter>
			<Button variant="outline" onclick={() => (bulkConfirmOpen = false)} disabled={bulkRunning}>
				Anulează
			</Button>
			<Button
				class="bg-amber-500 hover:bg-amber-600 text-white"
				onclick={runBulkConnectorUpdate}
				disabled={bulkRunning}
			>
				<ArrowUpCircleIcon class="mr-2 size-4" />
				Pornește update
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>

<!-- Bulk connector update — per-site results -->
<Dialog bind:open={bulkResultsOpen}>
	<DialogContent class="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
		<DialogHeader>
			<DialogTitle>
				Rezultat bulk update
				{#if bulkTargetVersion}
					<span class="font-mono text-sm font-normal text-muted-foreground">
						v{bulkTargetVersion}
					</span>
				{/if}
			</DialogTitle>
			{#if bulkSummary}
				<DialogDescription>
					{bulkSummary.updated} actualizate · {bulkSummary.alreadyCurrent} deja la zi ·
					{bulkSummary.failed} eșuate · {bulkSummary.skipped} sărite
				</DialogDescription>
			{/if}
		</DialogHeader>

		<div class="flex flex-col divide-y divide-border rounded-md border border-border">
			{#each bulkResults as r (r.siteId)}
				<div class="flex items-start gap-3 p-3 text-sm">
					<div class="shrink-0 pt-0.5">
						{#if r.status === 'updated'}
							<CircleCheckIcon class="size-4 text-green-600" />
						{:else if r.status === 'already_current'}
							<CircleCheckIcon class="size-4 text-muted-foreground" />
						{:else if r.status === 'failed'}
							<CircleXIcon class="size-4 text-red-600" />
						{:else}
							<CircleAlertIcon class="size-4 text-amber-500" />
						{/if}
					</div>
					<div class="min-w-0 flex-1">
						<div class="font-medium truncate">{r.name}</div>
						<div class="text-xs text-muted-foreground truncate">{r.url}</div>
						<div class="text-xs mt-0.5">
							{#if r.status === 'updated'}
								<span class="text-green-700 dark:text-green-400">
									v{r.fromVersion ?? '?'} → v{r.toVersion}
								</span>
							{:else if r.status === 'already_current'}
								<span class="text-muted-foreground">deja la v{r.toVersion}</span>
							{:else if r.status === 'failed'}
								<span class="text-red-600 break-words">{r.error ?? 'eroare necunoscută'}</span>
							{:else if r.status === 'skipped_paused'}
								<span class="text-amber-600">sărit (pauzat)</span>
							{:else if r.status === 'skipped_disconnected'}
								<span class="text-amber-600">sărit (deconectat)</span>
							{/if}
						</div>
					</div>
				</div>
			{/each}
		</div>

		<DialogFooter>
			<Button onclick={() => (bulkResultsOpen = false)}>Închide</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>

<!-- Generated secret display -->
<Dialog bind:open={updatesOpen}>
	<DialogContent class="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
		<DialogHeader>
			<DialogTitle>Update-uri — {updatesSite?.name ?? ''}</DialogTitle>
			<DialogDescription>
				Selectează update-urile de aplicat. Rularea unui backup înainte e recomandată pentru major/theme changes.
			</DialogDescription>
		</DialogHeader>

		{#if applyResults}
			<div class="flex flex-col gap-2">
				<h3 class="text-sm font-semibold">Rezultat</h3>
				{#each applyResults as r (r.slug + r.type)}
					<div class="flex items-start gap-2 rounded-md border border-border p-2 text-xs">
						{#if r.success}
							<CircleCheckIcon class="mt-0.5 size-4 shrink-0 text-green-600" />
						{:else}
							<CircleXIcon class="mt-0.5 size-4 shrink-0 text-red-600" />
						{/if}
						<div class="min-w-0 flex-1">
							<div class="font-medium">{r.type} · {r.slug}</div>
							<div class="truncate text-muted-foreground">{r.message}</div>
						</div>
					</div>
				{/each}
				{#if applyCache}
					<WpCachePurgeLine outcome={applyCache.outcome} />
				{/if}
			</div>
			<DialogFooter>
				<Button variant="outline" onclick={() => (applyResults = null)}>Înapoi la listă</Button>
				<Button onclick={() => (updatesOpen = false)}>Închide</Button>
			</DialogFooter>
		{:else if updatesLoading}
			<div class="py-8 text-center text-sm text-muted-foreground">Se încarcă…</div>
		{:else if updatesList.length === 0}
			<div class="flex flex-col items-center gap-3 py-8 text-center">
				<CircleCheckIcon class="size-10 text-green-600" />
				<p class="text-sm font-medium">Totul e la zi!</p>
				<Button variant="outline" size="sm" onclick={refreshUpdates}>
					<RefreshCwIcon class="mr-2 size-4" />
					Verifică din nou
				</Button>
			</div>
		{:else}
			<div class="flex items-center gap-2">
				<Button variant="outline" size="sm" onclick={() => selectAllUpdates('security')}>
					<ShieldAlertIcon class="mr-2 size-4" />
					Doar securitate
				</Button>
				<Button variant="outline" size="sm" onclick={() => selectAllUpdates('all')}>
					Toate
				</Button>
				<Button variant="outline" size="sm" onclick={() => selectAllUpdates('none')}>
					Niciunul
				</Button>
				<div class="ml-auto">
					<Button variant="ghost" size="sm" onclick={refreshUpdates} disabled={updatesLoading}>
						<RefreshCwIcon class="mr-2 size-4 {updatesLoading ? 'animate-spin' : ''}" />
						Refresh
					</Button>
				</div>
			</div>

			<div class="flex flex-col divide-y divide-border rounded-md border border-border">
				{#each updatesList as u (u.id)}
					<label class="flex cursor-pointer items-start gap-3 p-3 text-sm transition-colors hover:bg-muted/40">
						<input
							type="checkbox"
							class="mt-0.5 size-4"
							checked={selectedUpdateIds.has(u.id)}
							onchange={() => toggleUpdateSelection(u.id)}
						/>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<span class="font-medium">{u.name}</span>
								<Badge variant="outline" class="text-[10px] uppercase">{u.type}</Badge>
								{#if u.securityUpdate}
									<Badge variant="destructive" class="flex items-center gap-1 text-[10px]">
										<ShieldAlertIcon class="size-3" />
										Securitate
									</Badge>
								{/if}
							</div>
							<div class="text-xs text-muted-foreground">
								<code>{u.currentVersion || '—'}</code>
								→
								<code class="font-semibold">{u.newVersion}</code>
							</div>
						</div>
					</label>
				{/each}
			</div>

			<div class="flex items-start gap-2 rounded-md bg-muted/40 p-3 text-xs">
				<input
					id="wp-backup-first"
					type="checkbox"
					class="mt-0.5 size-4"
					bind:checked={backupFirst}
				/>
				<label for="wp-backup-first" class="cursor-pointer">
					<strong>Rulează backup înainte</strong> (recomandat). Dacă backup-ul eșuează, update-urile nu rulează.
				</label>
			</div>
			{#if backupProgress && updatesApplying}
				<WpJobProgress {...backupProgress} />
			{/if}

			<DialogFooter>
				<Button variant="outline" onclick={() => (updatesOpen = false)} disabled={updatesApplying}>
					Anulează
				</Button>
				<Button
					onclick={applySelectedUpdates}
					disabled={updatesApplying || selectedUpdateIds.size === 0}
				>
					{#if updatesApplying}
						<RefreshCwIcon class="mr-2 size-4 animate-spin" />
						Se aplică…
					{:else}
						<ArrowUpCircleIcon class="mr-2 size-4" />
						Aplică {selectedUpdateIds.size} update-uri
					{/if}
				</Button>
			</DialogFooter>
		{/if}
	</DialogContent>
</Dialog>

<Dialog bind:open={backupsOpen}>
	<DialogContent class="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
		<DialogHeader>
			<DialogTitle>Backup-uri — {backupsSite?.name ?? ''}</DialogTitle>
			<DialogDescription>
				Istoric backup-uri pentru acest site: baza de date completă + wp-content. Cu OTS Connector
				0.8.0+ backup-ul rulează în pași scurți, așa că hostingul nu îl mai întrerupe.
			</DialogDescription>
		</DialogHeader>

		{#if backupProgress && !updatesApplying}
			<WpJobProgress {...backupProgress} />
		{/if}
		<div class="flex items-center justify-end gap-3">
			<Button onclick={() => runBackup()} disabled={triggeringBackup}>
				{#if triggeringBackup}
					<RefreshCwIcon class="mr-2 size-4 animate-spin" />
					Se creează…
				{:else}
					<DatabaseBackupIcon class="mr-2 size-4" />
					Backup nou
				{/if}
			</Button>
		</div>

		{#if backupsLoading}
			<div class="py-8 text-center text-sm text-muted-foreground">Se încarcă…</div>
		{:else if backupsList.length === 0}
			<div class="py-8 text-center text-sm text-muted-foreground">Niciun backup făcut încă.</div>
		{:else}
			<div class="flex flex-col divide-y divide-border rounded-md border border-border">
				{#each backupsList as b (b.id)}
					<div class="flex items-start gap-2 p-3 text-sm">
						<div class="mt-0.5 shrink-0">
							{#if b.status === 'success'}
								<CircleCheckIcon class="size-4 text-green-600" />
							{:else if b.status === 'failed'}
								<CircleXIcon class="size-4 text-red-600" />
							{:else}
								<RefreshCwIcon class="size-4 animate-spin text-muted-foreground" />
							{/if}
						</div>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2 text-xs">
								<span class="font-medium">{formatDate(b.createdAt)}</span>
								<Badge variant="outline" class="text-[10px] uppercase">{b.trigger}</Badge>
								<span class="text-muted-foreground">{formatBytes(b.sizeBytes)}</span>
							</div>
							{#if b.error}
								<div class="mt-1 text-xs text-destructive break-words">{b.error}</div>
							{/if}
						</div>
						<div class="flex shrink-0 items-center gap-1">
							{#if b.archiveUrl}
								<a href={b.archiveUrl} target="_blank" rel="noopener noreferrer" title="Descarcă">
									<Button variant="outline" size="sm">
										<DownloadIcon class="size-4" />
									</Button>
								</a>
							{/if}
							{#if b.status === 'running' && !triggeringBackup}
								<!-- Left running (tab closed, lost connection): the connector kept its cursor. -->
								<Button variant="outline" size="sm" onclick={() => runBackup(b.id)} title="Continuă backup-ul">
									<PlayIcon class="size-4" />
								</Button>
							{/if}
							{#if b.status === 'success'}
								<Button
									variant="outline"
									size="sm"
									onclick={() => openRestore(b)}
									title="Restore (destructiv)"
								>
									<HistoryIcon class="size-4" />
								</Button>
							{/if}
							<Button
								variant="outline"
								size="sm"
								onclick={() => deleteBackup(b)}
								disabled={deletingBackupIds.has(b.id)}
								title="Șterge"
							>
								<Trash2Icon class="size-4 text-destructive" />
							</Button>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		<DialogFooter>
			<Button variant="outline" onclick={() => (backupsOpen = false)}>Închide</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>

<Dialog bind:open={restoreOpen}>
	<DialogContent>
		<DialogHeader>
			<DialogTitle class="flex items-center gap-2">
				<TriangleAlertIcon class="size-5 text-destructive" />
				Restore backup — acțiune distructivă
			</DialogTitle>
			<DialogDescription>
				Restore-ul <strong>suprascrie</strong> complet baza de date WordPress și conținutul din
				<code>wp-content</code> de pe <strong>{restoreTarget?.siteName ?? ''}</strong>.
				Datele actuale vor fi înlocuite cu cele din backup-ul de la
				<strong>{restoreTarget ? formatDate(restoreTarget.createdAt) : ''}</strong>.
				<br /><br />
				Această operație <strong>nu poate fi anulată</strong>. Orice conținut adăugat după acel backup va fi pierdut.
			</DialogDescription>
		</DialogHeader>

		<div class="flex flex-col gap-1">
			<Label for="restore-confirm">
				Tastează numele site-ului pentru a confirma:
				<code class="ml-1 rounded bg-muted px-1 py-0.5 text-xs">{restoreTarget?.siteName ?? ''}</code>
			</Label>
			<Input
				id="restore-confirm"
				bind:value={restoreConfirmText}
				placeholder={restoreTarget?.siteName ?? ''}
				autocomplete="off"
			/>
		</div>

		{#if restoreProgress}
			<WpJobProgress {...restoreProgress} />
		{/if}

		<DialogFooter>
			<Button variant="outline" onclick={() => (restoreOpen = false)} disabled={restoring}>
				Anulează
			</Button>
			<Button
				onclick={confirmRestore}
				disabled={restoring || restoreConfirmText !== (restoreTarget?.siteName ?? '__none__')}
				class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
			>
				{#if restoring}
					<RefreshCwIcon class="mr-2 size-4 animate-spin" />
					Se restaurează…
				{:else}
					<HistoryIcon class="mr-2 size-4" />
					Restore (overwrite DB + files)
				{/if}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>

<Dialog bind:open={rotateOpen}>
	<DialogContent>
		<DialogHeader>
			<DialogTitle>Schimbă secret HMAC</DialogTitle>
			<DialogDescription>
				Lipește aici secretul afișat de plugin-ul OTS Connector pe <strong>{rotateForm.siteName}</strong>.
				CRM-ul îl va salva encriptat și va rula imediat un health check.
			</DialogDescription>
		</DialogHeader>

		<div class="flex flex-col gap-1">
			<Label for="wp-rotate-secret">Secret nou (64 caractere hex)</Label>
			<Input
				id="wp-rotate-secret"
				bind:value={rotateForm.secret}
				placeholder="f7d2ed84c9e1765c0d90ad2fb1a4d557a24c4452c5a6e3d4ebf1448a8b1f992e"
				autocomplete="off"
			/>
			<p class="text-xs text-muted-foreground">
				Deschide în WordPress: <strong>Settings → OTS Connector</strong> și copiază secretul de acolo.
			</p>
		</div>

		<DialogFooter>
			<Button variant="outline" onclick={() => (rotateOpen = false)} disabled={rotating}>Anulează</Button>
			<Button onclick={saveRotatedSecret} disabled={rotating}>
				{rotating ? 'Se salvează…' : 'Salvează și verifică'}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>

<Dialog bind:open={generatedSecretOpen}>
	<DialogContent>
		<DialogHeader>
			<DialogTitle>Secret generat</DialogTitle>
			<DialogDescription>
				Copiază acest secret în plugin-ul OTS Connector pe site-ul WordPress. <strong>
					Nu va mai fi afișat după ce închizi această fereastră.
				</strong>
			</DialogDescription>
		</DialogHeader>

		{#if generatedSecret}
			<div class="flex items-center gap-2 rounded-md bg-muted p-3 font-mono text-xs break-all">
				{generatedSecret}
			</div>
		{/if}

		<DialogFooter>
			<Button variant="outline" onclick={copySecret}>
				<CopyIcon class="mr-2 size-4" />
				Copiază
			</Button>
			<Button onclick={() => ((generatedSecretOpen = false), (generatedSecret = null))}>
				Am copiat, închide
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
