<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { SvelteSet } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import { Card } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import {
		Table,
		TableBody,
		TableCell,
		TableHead,
		TableHeader,
		TableRow
	} from '$lib/components/ui/table';
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogFooter,
		DialogHeader,
		DialogTitle
	} from '$lib/components/ui/dialog';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import LibraryBigIcon from '@lucide/svelte/icons/library-big';
	import CloudUploadIcon from '@lucide/svelte/icons/cloud-upload';
	import GitCompareIcon from '@lucide/svelte/icons/git-compare';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import FileArchiveIcon from '@lucide/svelte/icons/file-archive';
	import LoaderIcon from '@lucide/svelte/icons/loader';
	import CheckCircleIcon from '@lucide/svelte/icons/check-circle';
	import XCircleIcon from '@lucide/svelte/icons/x-circle';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ArrowUpCircleIcon from '@lucide/svelte/icons/arrow-up-circle';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import PackageCheckIcon from '@lucide/svelte/icons/package-check';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import PauseIcon from '@lucide/svelte/icons/pause';
	import {
		buildSitePlan,
		libraryStepKey,
		wporgStepKey,
		type PlanCompareItem,
		type PlanStep
	} from '$lib/logic/wordpress-plugin-plan';
	import { runPlanSteps, runPluginStep, type StepResult } from '$lib/logic/wordpress-plugin-run';
	import { backupProgressPercent, describeBackupProgress, runSiteBackup } from '$lib/logic/wordpress-backup-run';

	/* ───────────────────────── types (mirror the API) ───────────────────────── */

	type LibraryItem = {
		id: string;
		slug: string;
		pluginFile: string;
		name: string;
		version: string;
		description: string;
		author: string;
		textDomain: string;
		pluginUri: string;
		requiresWp: string;
		requiresPhp: string;
		filename: string;
		sizeBytes: number;
		sha256: string;
		uploadedBy: string | null;
		createdAt: string;
		updatedAt: string;
	};

	type CompareStatus = PlanCompareItem['status'];

	/** Mirrors LibraryCompareItem from the API (plan fields + display-only fields). */
	type CompareItem = PlanCompareItem & {
		installedName: string | null;
		matchScore: number | null;
		matchReasons: string[];
		candidates?: {
			plugin: string;
			installedName: string;
			installedVersion: string;
			score: number;
		}[];
	};

	type WpSite = {
		id: string;
		name: string;
		siteUrl: string;
		status: 'connected' | 'disconnected' | 'error' | 'pending';
		connectorVersion?: string | null;
		clientName: string | null;
		paused: number; // 1 = scheduler skips this site
	};

	type SiteCompare = {
		status: 'idle' | 'checking' | 'checked' | 'error' | 'skipped';
		items: CompareItem[];
		installedTotal?: number | null;
		checkedAt?: string;
		error?: string;
		skipReason?: string;
	};

	type InstallProgress = {
		state: 'installing' | 'done' | 'failed';
		message?: string;
		toVersion?: string;
	};

	/** One inner plugin of an "unzip first" package (PRO + free edition ship together). */
	type PackageEntryView = {
		filename: string;
		outcome: 'added' | 'replaced' | 'rejected_older' | 'error';
		relation?: 'none' | 'newer' | 'same' | 'older';
		previousVersion?: string | null;
		item?: LibraryItem;
		existingVersion?: string;
		info?: { slug: string; name: string; version: string };
		error?: string;
		code?: string;
	};

	type UploadQueueItem = {
		id: string;
		file: File;
		status: 'queued' | 'uploading' | 'success' | 'older' | 'error';
		/** Set when the archive was a package: per inner plugin outcomes. */
		entries?: PackageEntryView[];
		message?: string;
		outcome?: 'added' | 'replaced';
		relation?: 'none' | 'newer' | 'same' | 'older';
		previousVersion?: string | null;
		existingVersion?: string;
		info?: { slug: string; name: string; version: string };
		item?: LibraryItem;
		/** Operator opted to replace the newer library version with this older ZIP. */
		force?: boolean;
	};

	/* ───────────────────────────────── state ───────────────────────────────── */

	const tenantSlug = $derived(page.params.tenant);
	const apiBase = $derived(`/${tenantSlug}/api/wordpress`);

	let library = $state<LibraryItem[]>([]);
	let libraryLoading = $state(true);
	let libraryError = $state<string | null>(null);

	let sites = $state<WpSite[]>([]);
	let sitesLoading = $state(true);
	let sitesError = $state<string | null>(null);

	let compare = $state<Record<string, SiteCompare>>({});
	let checkingAll = $state(false);
	/** Library changed (upload/delete) after the last site check: results may be stale. */
	let libraryDirty = $state(false);

	const expanded = new SvelteSet<string>();
	/** `${siteId}::${libraryId}` pairs the operator unticked. Default: everything selected. */
	const excluded = new SvelteSet<string>();

	let installs = $state<Record<string, InstallProgress>>({});
	let running = $state(false);
	let runConfirmOpen = $state(false);
	let runSiteIds = $state<string[]>([]);
	/** Same safety net as the updates dialog: full backup on the site before the first install. */
	let backupFirst = $state(true);
	/** `${siteId}` → backup progress shown in the site row while a run is in flight. */
	let backups = $state<
		Record<string, { state: 'running' | 'ok' | 'failed'; message?: string; percent?: number | null }>
	>(
		{}
	);

	let uploadOpen = $state(false);
	let uploadQueue = $state<UploadQueueItem[]>([]);
	let uploading = $state(false);
	/** Makes queue ids unique when the same file is picked twice (retry). Not reactive. */
	let queueSeq = 0;

	/* ─────────────────────────────── derived ──────────────────────────────── */

	function keyOf(siteId: string, libraryId: string) {
		return `${siteId}::${libraryId}`;
	}

	function isEligible(site: WpSite) {
		return site.paused !== 1 && site.status !== 'disconnected';
	}

	function pendingFor(siteId: string): CompareItem[] {
		const c = compare[siteId];
		if (!c || c.status !== 'checked') return [];
		return c.items.filter(
			(i) =>
				i.status === 'update_available' &&
				!i.folderMismatch &&
				!excluded.has(keyOf(siteId, i.libraryId))
		);
	}

	const pendingBySite = $derived.by(() => {
		const out: Record<string, CompareItem[]> = {};
		for (const s of sites) out[s.id] = pendingFor(s.id);
		return out;
	});
	const totalPending = $derived(Object.values(pendingBySite).reduce((n, arr) => n + arr.length, 0));
	const sitesWithPending = $derived(
		Object.values(pendingBySite).filter((arr) => arr.length > 0).length
	);
	const checkedCount = $derived(sites.filter((s) => compare[s.id]?.status === 'checked').length);
	/** Ordered steps per site: base plugins before their PRO, wordpress.org where it is newer. */
	function planFor(siteId: string): PlanStep[] {
		const c = compare[siteId];
		if (!c || c.status !== 'checked') return [];
		return buildSitePlan(c.items, (libraryId) => excluded.has(keyOf(siteId, libraryId)));
	}

	const runTargets = $derived(
		runSiteIds
			.map((id) => ({ site: sites.find((s) => s.id === id), steps: planFor(id) }))
			.filter((t): t is { site: WpSite; steps: PlanStep[] } => !!t.site && t.steps.length > 0)
	);
	const runTotal = $derived(runTargets.reduce((n, t) => n + t.steps.length, 0));

	/* ─────────────────────────────── helpers ──────────────────────────────── */

	function fileToBase64(file: File): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => {
				const dataUrl = String(reader.result);
				const comma = dataUrl.indexOf(',');
				resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
			};
			reader.onerror = () => reject(reader.error);
			reader.readAsDataURL(file);
		});
	}

	/** Minimal concurrency limiter (same shape as the per-site plugins page). */
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

	function formatBytes(n: number): string {
		// Non-breaking space keeps "4.8 MB" on one line in narrow cells.
		if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}\u00a0MB`;
		if (n >= 1024) return `${Math.round(n / 1024)}\u00a0KB`;
		return `${n}\u00a0B`;
	}

	function formatDateTime(iso: string | null | undefined): string {
		if (!iso) return '';
		return new Date(iso).toLocaleString('ro-RO', {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function formatTime(iso: string | undefined): string {
		if (!iso) return '';
		return new Date(iso).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
	}

	function shorten(s: string | undefined, max = 90): string {
		if (!s) return '';
		return s.length > max ? s.slice(0, max) + '…' : s;
	}

	function statusLabel(status: CompareStatus): string {
		return (
			{
				update_available: 'Update disponibil',
				up_to_date: 'La zi',
				downgrade: 'Site-ul are versiune mai nouă',
				not_installed: 'Neinstalat',
				ambiguous: 'Potrivire ambiguă'
			} as const
		)[status];
	}

	/* ─────────────────────────────── loading ──────────────────────────────── */

	async function loadLibrary() {
		libraryLoading = true;
		libraryError = null;
		try {
			const res = await fetch(`${apiBase}/plugin-library`);
			const body = (await res.json().catch(() => ({}))) as {
				items?: LibraryItem[];
				error?: string;
			};
			if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
			library = Array.isArray(body.items) ? body.items : [];
		} catch (err) {
			libraryError = err instanceof Error ? err.message : 'Nu s-a putut încărca biblioteca';
		} finally {
			libraryLoading = false;
		}
	}

	async function loadSites() {
		sitesLoading = true;
		sitesError = null;
		try {
			const res = await fetch(`${apiBase}/sites`);
			const body = (await res.json().catch(() => ({}))) as { sites?: WpSite[]; error?: string };
			if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
			sites = Array.isArray(body.sites) ? body.sites : [];
		} catch (err) {
			sitesError = err instanceof Error ? err.message : 'Nu s-au putut încărca site-urile';
		} finally {
			sitesLoading = false;
		}
	}

	onMount(() => {
		void loadLibrary();
		void loadSites();
	});

	/* ─────────────────────────────── compare ──────────────────────────────── */

	async function checkSite(siteId: string) {
		compare[siteId] = { status: 'checking', items: [] };
		try {
			const res = await fetch(`${apiBase}/sites/${siteId}/plugins/library-compare`);
			const body = (await res.json().catch(() => ({}))) as {
				items?: CompareItem[];
				installedTotal?: number;
				checkedAt?: string;
				error?: string;
			};
			if (!res.ok || !Array.isArray(body.items))
				throw new Error(body.error || `HTTP ${res.status}`);
			compare[siteId] = {
				status: 'checked',
				items: body.items,
				installedTotal: body.installedTotal ?? 0,
				checkedAt: body.checkedAt ?? new Date().toISOString()
			};
		} catch (err) {
			compare[siteId] = {
				status: 'error',
				items: [],
				error: err instanceof Error ? err.message : 'Verificare eșuată'
			};
		}
	}

	async function checkAllSites() {
		if (checkingAll || running) return;
		checkingAll = true;
		libraryDirty = false;
		try {
			const limit = createLimiter(3);
			await Promise.all(
				sites.map((s) => {
					if (!isEligible(s)) {
						compare[s.id] = {
							status: 'skipped',
							items: [],
							skipReason: s.paused === 1 ? 'monitorizare în pauză' : 'deconectat'
						};
						return Promise.resolve();
					}
					return limit(() => checkSite(s.id));
				})
			);
		} finally {
			checkingAll = false;
		}
		if (totalPending > 0) {
			toast.info(`${totalPending} update-uri disponibile pe ${sitesWithPending} site-uri`);
		} else {
			toast.success('Toate site-urile verificate sunt la zi cu biblioteca');
		}
	}

	function toggleExpanded(siteId: string) {
		if (expanded.has(siteId)) expanded.delete(siteId);
		else expanded.add(siteId);
	}

	function setIncluded(siteId: string, libraryId: string, included: boolean) {
		const k = keyOf(siteId, libraryId);
		if (included) excluded.delete(k);
		else excluded.add(k);
	}

	/* ──────────────────────────────── update ──────────────────────────────── */

	function openRunConfirm(siteIds: string[]) {
		runSiteIds = siteIds.filter((id) => (pendingBySite[id]?.length ?? 0) > 0);
		if (runSiteIds.length === 0) return;
		runConfirmOpen = true;
	}

	/** One plan step (library ZIP or wordpress.org updater), progress kept per site+step. */
	async function runStepOnSite(site: WpSite, step: PlanStep): Promise<StepResult> {
		const k = keyOf(site.id, step.key);
		installs[k] = { state: 'installing' };
		const result = await runPluginStep(`${apiBase}/sites/${site.id}`, step);
		installs[k] = result;
		return result;
	}

	/** Full backup (SQL + wp-content) before updating; chunked on connector 0.8.0+. */
	async function backupSite(site: WpSite): Promise<boolean> {
		backups[site.id] = { state: 'running' };
		const result = await runSiteBackup(`${apiBase}/sites/${site.id}`, {
			trigger: 'pre_update',
			onProgress: (p) =>
				(backups[site.id] = {
					state: 'running',
					message: describeBackupProgress(p),
					percent: backupProgressPercent(p) ?? backups[site.id]?.percent
				})
		});
		backups[site.id] = result.ok ? { state: 'ok' } : { state: 'failed', message: result.error };
		return result.ok;
	}

	async function runUpdates() {
		runConfirmOpen = false;
		if (running) return;
		const targets = runTargets; // snapshot: compare[] changes during the run
		if (targets.length === 0) return;
		running = true;
		let ok = 0;
		let failed = 0;
		let blocked = 0;
		try {
			for (const t of targets) {
				expanded.add(t.site.id);
				delete backups[t.site.id];
				for (const step of t.steps) delete installs[keyOf(t.site.id, step.key)];
			}

			// One step at a time per site (WordPress installs are not reentrant),
			// at most two sites in parallel so a slow host doesn't block the rest.
			const limit = createLimiter(2);
			await Promise.all(
				targets.map((t) =>
					limit(async () => {
						if (backupFirst) {
							const backupOk = await backupSite(t.site);
							if (!backupOk) {
								// No backup, no updates on this site.
								for (const step of t.steps) {
									installs[keyOf(t.site.id, step.key)] = {
										state: 'failed',
										message: `backup eșuat: ${backups[t.site.id]?.message ?? 'necunoscut'}; update-urile nu au rulat`
									};
									failed++;
								}
								return;
							}
						}
						const summary = await runPlanSteps(
							t.steps,
							(step) => runStepOnSite(t.site, step),
							(key, result) => {
								// Blocked steps never went through runStepOnSite.
								if (result.state === 'failed' && result.blocked) {
									installs[keyOf(t.site.id, key)] = result;
								}
							}
						);
						ok += summary.ok;
						failed += summary.failed;
						blocked += summary.blocked;
						// Re-verify so the table shows the versions WP actually reports now.
						await checkSite(t.site.id);
					})
				)
			);
		} finally {
			running = false;
		}
		if (failed === 0 && blocked === 0) {
			toast.success(`${ok} actualizări reușite pe ${targets.length} site-uri`);
		} else {
			toast.warning(
				`${ok} reușite, ${failed} eșuate${blocked ? `, ${blocked} blocate de o bază neactualizată` : ''}. Detaliile sunt în tabel, per site.`,
				{ duration: 10000 }
			);
		}
	}

	/* ─────────────────────────────── library ──────────────────────────────── */

	async function deleteFromLibrary(item: LibraryItem) {
		if (
			!confirm(
				`Ștergi „${item.name}" v${item.version} din bibliotecă? Site-urile nu sunt afectate.`
			)
		) {
			return;
		}
		try {
			const res = await fetch(`${apiBase}/plugin-library/${item.id}`, { method: 'DELETE' });
			const body = (await res.json().catch(() => ({}))) as { error?: string };
			if (!res.ok) {
				toast.error(body.error || 'Ștergerea a eșuat');
				return;
			}
			toast.success(`${item.name} a fost șters din bibliotecă`);
			libraryDirty = checkedCount > 0;
			await loadLibrary();
		} catch (err) {
			toast.error('Eroare de rețea');
			console.error(err);
		}
	}

	/* ─────────────────────────────── upload ───────────────────────────────── */

	function pickUploadFiles(event: Event) {
		const input = event.target as HTMLInputElement;
		if (!input.files) return;
		const next: UploadQueueItem[] = [];
		for (const f of Array.from(input.files)) {
			if (!/\.zip$/i.test(f.name)) {
				toast.error(`${f.name} nu e ZIP, omis`);
				continue;
			}
			if (f.size > 50 * 1024 * 1024) {
				toast.error(`${f.name} depășește 50 MB, omis`);
				continue;
			}
			next.push({
				id: `${f.name}-${f.size}-${f.lastModified}-${++queueSeq}`,
				file: f,
				status: 'queued'
			});
		}
		uploadQueue = [...uploadQueue, ...next];
		input.value = '';
	}

	function toggleForce(id: string) {
		const idx = uploadQueue.findIndex((i) => i.id === id);
		if (idx < 0 || uploadQueue[idx].status !== 'older') return;
		uploadQueue[idx].force = !uploadQueue[idx].force;
	}

	function removeFromQueue(id: string) {
		uploadQueue = uploadQueue.filter((i) => i.id !== id);
	}

	function resetQueue() {
		uploadQueue = [];
	}

	const uploadReadyCount = $derived(
		uploadQueue.filter(
			(i) => i.status === 'queued' || i.status === 'error' || (i.status === 'older' && i.force)
		).length
	);

	async function runUpload() {
		if (uploading || uploadReadyCount === 0) return;
		uploading = true;
		let added = 0;
		let replaced = 0;
		let failed = 0;
		let older = 0;
		try {
			for (let i = 0; i < uploadQueue.length; i++) {
				const cur = uploadQueue[i];
				if (cur.status === 'success' || cur.status === 'uploading') continue;
				if (cur.status === 'older' && !cur.force) {
					older++;
					continue;
				}
				uploadQueue[i] = { ...cur, status: 'uploading', message: undefined };
				try {
					const dataBase64 = await fileToBase64(cur.file);
					const res = await fetch(`${apiBase}/plugin-library`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ filename: cur.file.name, dataBase64, force: cur.force === true })
					});
					const body = (await res.json().catch(() => ({}))) as {
						error?: string;
						code?: string;
						outcome?: 'added' | 'replaced' | 'package';
						relation?: 'none' | 'newer' | 'same' | 'older';
						previousVersion?: string | null;
						item?: LibraryItem;
						existingVersion?: string;
						info?: { slug: string; name: string; version: string };
						entries?: PackageEntryView[];
					};
					if (res.ok && body.outcome === 'package' && Array.isArray(body.entries)) {
						// "Unzip first" package: one outcome per inner plugin.
						const entries = body.entries;
						const stored = entries.filter((e) => e.outcome === 'added' || e.outcome === 'replaced');
						const errors = entries.filter((e) => e.outcome === 'error');
						const anyOlder = entries.some((e) => e.outcome === 'rejected_older');
						added += entries.filter((e) => e.outcome === 'added').length;
						replaced += entries.filter((e) => e.outcome === 'replaced').length;
						failed += errors.length;
						if (anyOlder) older++;
						uploadQueue[i] = {
							...uploadQueue[i],
							status: anyOlder ? 'older' : stored.length === 0 ? 'error' : 'success',
							entries,
							message:
								stored.length === 0 && errors.length > 0
									? 'niciun plugin valid în pachet'
									: undefined
						};
					} else if (res.status === 409 && body.code === 'older_version') {
						uploadQueue[i] = {
							...uploadQueue[i],
							status: 'older',
							existingVersion: body.existingVersion,
							info: body.info,
							message: body.error
						};
						older++;
					} else if (!res.ok) {
						uploadQueue[i] = {
							...uploadQueue[i],
							status: 'error',
							message: body.error || `HTTP ${res.status}`
						};
						failed++;
					} else {
						uploadQueue[i] = {
							...uploadQueue[i],
							status: 'success',
							outcome: body.outcome === 'replaced' ? 'replaced' : 'added',
							relation: body.relation,
							previousVersion: body.previousVersion,
							item: body.item
						};
						if (body.outcome === 'added') added++;
						else replaced++;
					}
				} catch (err) {
					uploadQueue[i] = {
						...uploadQueue[i],
						status: 'error',
						message: err instanceof Error ? err.message : 'Eroare necunoscută'
					};
					failed++;
				}
			}
		} finally {
			uploading = false;
		}
		if (added + replaced > 0) {
			libraryDirty = checkedCount > 0;
			await loadLibrary();
		}
		const parts: string[] = [];
		if (added) parts.push(`${added} adăugate`);
		if (replaced) parts.push(`${replaced} înlocuite`);
		if (older)
			parts.push(`${older} mai vechi decât biblioteca (bifează „Forțează" ca să le înlocuiești)`);
		if (failed) parts.push(`${failed} eșuate`);
		if (failed === 0 && older === 0) toast.success(parts.join(', ') || 'Nimic de urcat');
		else toast.warning(parts.join(', '), { duration: 8000 });
	}
</script>

<svelte:head>
	<title>Bibliotecă plugin-uri WordPress — OTS CRM</title>
</svelte:head>

<div class="flex h-full flex-col gap-4">
	<div class="flex items-center gap-2">
		<a href="/{tenantSlug}/wordpress">
			<Button variant="ghost" size="sm">
				<ArrowLeftIcon class="mr-2 size-4" />
				Înapoi la site-uri
			</Button>
		</a>
	</div>

	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Bibliotecă plugin-uri</h1>
			<p class="text-sm text-pretty text-muted-foreground">
				Încarcă ZIP-urile plugin-urilor premium o singură dată. CRM-ul compară versiunile cu fiecare
				site și le actualizează prin OTS Connector, păstrând starea activ/inactiv.
			</p>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<Button
				variant="outline"
				onclick={checkAllSites}
				disabled={checkingAll || running || library.length === 0 || sites.length === 0}
				title={library.length === 0
					? 'Încarcă mai întâi ZIP-uri în bibliotecă'
					: 'Compară biblioteca cu fiecare site'}
			>
				<GitCompareIcon class="mr-2 size-4 {checkingAll ? 'animate-spin' : ''}" />
				{checkingAll ? 'Se verifică…' : 'Verifică site-urile'}
			</Button>
			<Button onclick={() => (uploadOpen = true)} disabled={running}>
				<CloudUploadIcon class="mr-2 size-4" />
				Upload ZIP-uri
			</Button>
		</div>
	</div>

	<!-- ───────────────────────────── Library ───────────────────────────── -->
	<Card class="overflow-hidden p-0">
		<div class="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
			<div class="flex items-center gap-2">
				<LibraryBigIcon class="size-4 text-muted-foreground" />
				<h2 class="text-sm font-semibold">Plugin-uri în bibliotecă</h2>
				<Badge variant="secondary" class="text-xs">{library.length}</Badge>
			</div>
			<Button
				variant="ghost"
				size="sm"
				onclick={loadLibrary}
				disabled={libraryLoading}
				title="Reîncarcă lista"
			>
				<RefreshCwIcon class="mr-2 size-3.5 {libraryLoading ? 'animate-spin' : ''}" />
				Refresh
			</Button>
		</div>

		{#if libraryLoading && library.length === 0}
			<div class="p-6 text-sm text-muted-foreground">Se încarcă biblioteca…</div>
		{:else if libraryError}
			<div class="flex items-center gap-2 p-6 text-sm text-destructive">
				<XCircleIcon class="size-4 shrink-0" />
				<span>{libraryError}</span>
				<Button variant="outline" size="sm" onclick={loadLibrary}>Reîncearcă</Button>
			</div>
		{:else if library.length === 0}
			<div class="flex flex-col items-center justify-center gap-3 p-10 text-center">
				<FileArchiveIcon class="size-10 text-muted-foreground" />
				<div>
					<h3 class="text-base font-medium">Biblioteca e goală</h3>
					<p class="text-sm text-muted-foreground">
						Încarcă ZIP-urile plugin-urilor premium (Elementor Pro, Astra Pro, WP Mail SMTP Pro…).
						Versiunea și identitatea se citesc din header-ul plugin-ului.
					</p>
				</div>
				<Button onclick={() => (uploadOpen = true)}>
					<CloudUploadIcon class="mr-2 size-4" />
					Upload ZIP-uri
				</Button>
			</div>
		{:else}
			<div class="overflow-x-auto">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Plugin</TableHead>
							<TableHead class="w-28">Versiune</TableHead>
							<TableHead class="hidden md:table-cell">Autor</TableHead>
							<TableHead class="w-24 text-right">Mărime</TableHead>
							<TableHead class="hidden w-44 lg:table-cell">Încărcat</TableHead>
							<TableHead class="w-12"><span class="sr-only">Acțiuni</span></TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{#each library as item (item.id)}
							<TableRow>
								<TableCell>
									<div class="font-medium">{item.name}</div>
									<div class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
										<code class="rounded bg-muted px-1 py-0.5 text-[11px]">{item.pluginFile}</code>
										{#if item.requiresPhp}<span>PHP ≥ {item.requiresPhp}</span>{/if}
									</div>
								</TableCell>
								<TableCell
									><span class="font-mono text-sm tabular-nums">v{item.version}</span></TableCell
								>
								<TableCell class="hidden text-sm text-muted-foreground md:table-cell"
									>{item.author || '–'}</TableCell
								>
								<TableCell class="text-right text-sm text-muted-foreground tabular-nums"
									>{formatBytes(item.sizeBytes)}</TableCell
								>
								<TableCell
									class="hidden text-sm text-muted-foreground lg:table-cell"
									title={item.filename}
								>
									{formatDateTime(item.updatedAt)}
								</TableCell>
								<TableCell>
									<Button
										variant="ghost"
										size="icon"
										class="h-8 w-8"
										disabled={running}
										onclick={() => deleteFromLibrary(item)}
										title="Șterge din bibliotecă (site-urile nu sunt afectate)"
										aria-label="Șterge {item.name} din bibliotecă"
									>
										<Trash2Icon class="size-3.5 text-destructive" />
									</Button>
								</TableCell>
							</TableRow>
						{/each}
					</TableBody>
				</Table>
			</div>
		{/if}
	</Card>

	<!-- ────────────────────────────── Sites ────────────────────────────── -->
	<Card class="overflow-hidden p-0">
		<div class="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
			<div class="flex flex-wrap items-center gap-2">
				<GlobeIcon class="size-4 text-muted-foreground" />
				<h2 class="text-sm font-semibold">Site-uri</h2>
				<Badge variant="secondary" class="text-xs">{sites.length}</Badge>
				<span aria-live="polite" class="contents">
					{#if checkedCount > 0}
						{#if totalPending > 0}
							<Badge
								variant="outline"
								class="border-amber-500 text-xs text-amber-700 dark:text-amber-400"
							>
								{totalPending} update-uri pe {sitesWithPending} site-uri
							</Badge>
						{:else}
							<Badge
								variant="outline"
								class="border-green-600 text-xs text-green-700 dark:text-green-400"
							>
								la zi
							</Badge>
						{/if}
					{/if}
				</span>
				{#if libraryDirty}
					<span class="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
						<TriangleAlertIcon class="size-3.5" />
						Biblioteca s-a schimbat, verifică site-urile din nou.
					</span>
				{/if}
			</div>
			<Button
				size="sm"
				variant={totalPending > 0 ? 'default' : 'outline'}
				class={totalPending > 0 ? 'bg-amber-500 text-white hover:bg-amber-600' : ''}
				disabled={running || checkingAll || totalPending === 0}
				onclick={() => openRunConfirm(sites.map((s) => s.id))}
				title={totalPending === 0
					? 'Verifică site-urile mai întâi'
					: 'Actualizează toate plugin-urile bifate'}
			>
				{#if running}
					<LoaderIcon class="mr-2 size-3.5 animate-spin" />
					Se actualizează…
				{:else}
					<ArrowUpCircleIcon class="mr-2 size-3.5" />
					Actualizează toate ({totalPending})
				{/if}
			</Button>
		</div>

		{#if sitesLoading && sites.length === 0}
			<div class="p-6 text-sm text-muted-foreground">Se încarcă site-urile…</div>
		{:else if sitesError}
			<div class="flex items-center gap-2 p-6 text-sm text-destructive">
				<XCircleIcon class="size-4 shrink-0" />
				<span>{sitesError}</span>
				<Button variant="outline" size="sm" onclick={loadSites}>Reîncearcă</Button>
			</div>
		{:else if sites.length === 0}
			<div class="flex flex-col items-center justify-center gap-2 p-10 text-center">
				<GlobeIcon class="size-10 text-muted-foreground" />
				<h3 class="text-base font-medium">Niciun site WordPress</h3>
				<p class="text-sm text-muted-foreground">
					Adaugă site-uri din pagina WordPress ca să le poți compara cu biblioteca.
				</p>
			</div>
		{:else}
			<div class="overflow-x-auto">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead class="w-10"><span class="sr-only">Detalii</span></TableHead>
							<TableHead>Site</TableHead>
							<TableHead class="w-56">Verificare</TableHead>
							<TableHead>De actualizat</TableHead>
							<TableHead class="w-56 text-right">Acțiuni</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{#each sites as site (site.id)}
							{@const c = compare[site.id]}
							{@const pending = pendingBySite[site.id] ?? []}
							{@const updatable =
								c?.status === 'checked'
									? c.items.filter((i) => i.status === 'update_available')
									: []}
							{@const blocked = updatable.filter((i) => i.folderMismatch)}
							{@const isOpen = expanded.has(site.id)}
							<TableRow class={!isEligible(site) ? 'opacity-70' : ''}>
								<TableCell>
									<Button
										variant="ghost"
										size="icon"
										class="h-7 w-7"
										onclick={() => toggleExpanded(site.id)}
										disabled={!c || c.status === 'idle' || c.status === 'checking'}
										aria-expanded={isOpen}
										aria-label={isOpen
											? `Ascunde detaliile pentru ${site.name}`
											: `Arată detaliile pentru ${site.name}`}
									>
										{#if isOpen}
											<ChevronDownIcon class="size-4" />
										{:else}
											<ChevronRightIcon class="size-4" />
										{/if}
									</Button>
								</TableCell>
								<TableCell>
									<div class="font-medium">{site.name}</div>
									<div class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
										<a
											href={site.siteUrl}
											target="_blank"
											rel="noopener noreferrer"
											class="hover:underline"
										>
											{site.siteUrl.replace(/^https?:\/\//, '')}
										</a>
										{#if site.clientName}<span>· {site.clientName}</span>{/if}
										{#if site.paused === 1}
											<Badge variant="outline" class="text-[10px]"
												><PauseIcon class="mr-1 size-3" />pauză</Badge
											>
										{/if}
										{#if site.status === 'disconnected'}
											<Badge variant="destructive" class="text-[10px]">deconectat</Badge>
										{/if}
									</div>
								</TableCell>
								<TableCell class="text-sm">
									{#if backups[site.id]?.state === 'running'}
										<span class="inline-flex items-center gap-1.5 text-muted-foreground">
											<LoaderIcon class="size-3.5 animate-spin" />
											backup{backups[site.id]?.percent != null ? ` ${backups[site.id]?.percent}%` : ''}:
											{backups[site.id]?.message ?? 'pornesc…'}
										</span>
									{:else if backups[site.id]?.state === 'failed'}
										<span
											class="inline-flex items-center gap-1.5 text-destructive"
											title={backups[site.id]?.message}
										>
											<XCircleIcon class="size-3.5 shrink-0" /> backup eșuat
										</span>
									{:else if c?.status === 'checking'}
										<span class="inline-flex items-center gap-1.5 text-muted-foreground">
											<LoaderIcon class="size-3.5 animate-spin" /> se verifică…
										</span>
									{:else if c?.status === 'checked'}
										<span
											class="inline-flex items-center gap-1.5 text-green-700 dark:text-green-400"
										>
											<CheckCircleIcon class="size-3.5" />
											{formatTime(c.checkedAt)}{c.installedTotal != null
												? ` · ${c.installedTotal} plugin-uri`
												: ''}
										</span>
									{:else if c?.status === 'error'}
										<span class="inline-flex items-center gap-1.5 text-destructive" title={c.error}>
											<XCircleIcon class="size-3.5 shrink-0" />
											<span class="line-clamp-2 break-all">{shorten(c.error, 120)}</span>
										</span>
									{:else if c?.status === 'skipped'}
										<span class="inline-flex items-center gap-1.5 text-muted-foreground">
											<PauseIcon class="size-3.5" /> sărit ({c.skipReason})
										</span>
									{:else}
										<span class="text-muted-foreground">neverificat</span>
									{/if}
								</TableCell>
								<TableCell class="text-sm">
									{#if c?.status === 'checked'}
										{#if updatable.length === 0}
											<span class="inline-flex items-center gap-1.5 text-muted-foreground">
												<PackageCheckIcon class="size-3.5" /> nimic de actualizat
											</span>
										{:else}
											<div class="flex flex-wrap items-center gap-1">
												{#each updatable.slice(0, 3) as u (u.libraryId)}
													<Badge
														variant="outline"
														class="border-amber-500 text-[11px] text-amber-700 dark:text-amber-400 {u.folderMismatch ||
														excluded.has(keyOf(site.id, u.libraryId))
															? 'line-through opacity-60'
															: ''}"
														title={u.folderMismatch
															? 'Folder diferit pe site: nu se actualizează automat'
															: ''}
													>
														{u.name}
														{u.installedVersion} → {u.preferredSource === 'wporg' && u.wpUpdate
															? u.wpUpdate.newVersion
															: u.libraryVersion}
													</Badge>
												{/each}
												{#if updatable.length > 3}
													<span class="text-xs text-muted-foreground">+{updatable.length - 3}</span>
												{/if}
												{#if blocked.length > 0}
													<span
														class="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400"
														title="Folderul din ZIP diferă de cel instalat; vezi detaliile"
													>
														<TriangleAlertIcon class="size-3.5" />
														{blocked.length} blocate
													</span>
												{/if}
											</div>
										{/if}
									{:else}
										<span class="text-muted-foreground">–</span>
									{/if}
								</TableCell>
								<TableCell>
									<div class="flex items-center justify-end gap-1.5">
										<Button
											variant="outline"
											size="sm"
											disabled={running ||
												checkingAll ||
												c?.status === 'checking' ||
												library.length === 0}
											onclick={() => checkSite(site.id)}
											title="Verifică acest site"
										>
											<RefreshCwIcon
												class="mr-1.5 size-3.5 {c?.status === 'checking' ? 'animate-spin' : ''}"
											/>
											Verifică
										</Button>
										<Button
											size="sm"
											variant={pending.length > 0 ? 'default' : 'outline'}
											class={pending.length > 0 ? 'bg-amber-500 text-white hover:bg-amber-600' : ''}
											disabled={running || checkingAll || pending.length === 0}
											onclick={() => openRunConfirm([site.id])}
											title={pending.length === 0
												? 'Nimic bifat de actualizat'
												: `Actualizează ${pending.length} plugin-uri pe ${site.name}`}
										>
											<ArrowUpCircleIcon class="mr-1.5 size-3.5" />
											Actualizează{pending.length > 0 ? ` (${pending.length})` : ''}
										</Button>
									</div>
								</TableCell>
							</TableRow>

							{#if isOpen && c && c.status === 'checked'}
								<TableRow class="bg-muted/30 hover:bg-muted/30">
									<TableCell colspan={5} class="p-0">
										<div class="px-4 py-3">
											{#if c.items.length === 0}
												<p class="text-sm text-muted-foreground">Biblioteca e goală.</p>
											{:else}
												<Table>
													<TableHeader>
														<TableRow>
															<TableHead class="w-10"
																><span class="sr-only">Include</span></TableHead
															>
															<TableHead>Plugin</TableHead>
															<TableHead class="w-28">Bibliotecă</TableHead>
															<TableHead class="w-36">Pe site</TableHead>
															<TableHead class="w-52">Stare</TableHead>
															<TableHead>Rezultat</TableHead>
														</TableRow>
													</TableHeader>
													<TableBody>
														{#each c.items as item (item.libraryId)}
															{@const k = keyOf(site.id, item.libraryId)}
															{@const progress =
																installs[keyOf(site.id, libraryStepKey(item.libraryId))]}
															{@const depProgress =
																item.dependsOn && !item.dependsOn.libraryId
																	? installs[keyOf(site.id, wporgStepKey(item.dependsOn.plugin))]
																	: undefined}
															{@const selectable =
																item.status === 'update_available' && !item.folderMismatch}
															<TableRow>
																<TableCell>
																	{#if selectable}
																		<Checkbox
																			checked={!excluded.has(k)}
																			onCheckedChange={(v) =>
																				setIncluded(site.id, item.libraryId, v === true)}
																			disabled={running}
																			aria-label="Include {item.name} la actualizare"
																		/>
																	{/if}
																</TableCell>
																<TableCell>
																	<div class="text-sm font-medium">{item.name}</div>
																	<div class="text-xs text-muted-foreground">
																		<code class="rounded bg-muted px-1 py-0.5 text-[11px]"
																			>{item.installedPlugin ?? item.slug}</code
																		>
																	</div>
																	{#if item.dependsOn}
																		{@const dep = item.dependsOn}
																		<div class="mt-0.5 text-xs text-muted-foreground">
																			<span aria-hidden="true">↳</span> bază: {dep.name} v{dep.installedVersion}
																			{#if dep.libraryId}
																				(din bibliotecă, se actualizează întâi)
																			{:else if dep.wpUpdate?.installable}
																				<span class="text-amber-700 dark:text-amber-400"
																					>→ v{dep.wpUpdate.newVersion} de pe wordpress.org, se actualizează
																					întâi</span
																				>
																			{:else if dep.wpUpdate}
																				<span class="text-amber-700 dark:text-amber-400"
																					>(update v{dep.wpUpdate.newVersion} fără pachet: licență)</span
																				>
																			{/if}
																			{#if depProgress?.state === 'installing'}
																				· <LoaderIcon class="inline size-3 animate-spin" /> se actualizează…
																			{:else if depProgress?.state === 'done'}
																				· <span class="text-green-700 dark:text-green-400"
																					>actualizată la v{depProgress.toVersion}</span
																				>
																			{:else if depProgress?.state === 'failed'}
																				· <span class="text-destructive" title={depProgress.message}
																					>eșuată</span
																				>
																			{/if}
																		</div>
																	{/if}
																	{#if item.preferredSource === 'wporg' && item.wpUpdate}
																		<div class="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
																			wordpress.org are v{item.wpUpdate.newVersion}, mai nouă decât
																			biblioteca: se folosește wordpress.org
																		</div>
																	{:else if item.wpUpdate && item.status !== 'update_available'}
																		<div class="mt-0.5 text-xs text-muted-foreground">
																			WordPress oferă v{item.wpUpdate.newVersion}{item.wpUpdate
																				.installable
																				? ''
																				: ' (licență)'}
																		</div>
																	{/if}
																</TableCell>
																<TableCell class="font-mono text-sm tabular-nums"
																	>v{item.libraryVersion}</TableCell
																>
																<TableCell class="text-sm">
																	{#if item.installedVersion}
																		<span class="font-mono">v{item.installedVersion}</span>
																		<span class="ml-1 text-xs text-muted-foreground"
																			>{item.active ? 'activ' : 'inactiv'}</span
																		>
																	{:else}
																		<span class="text-muted-foreground">–</span>
																	{/if}
																</TableCell>
																<TableCell>
																	{#if item.status === 'update_available'}
																		{#if item.folderMismatch}
																			<Badge
																				variant="outline"
																				class="border-amber-500 text-[11px] text-amber-700 dark:text-amber-400"
																				title={`ZIP-ul are folderul „${item.slug}”, pe site plugin-ul e în „${item.installedPlugin?.split('/')[0] ?? '?'}”. Instalarea ar crea o copie paralelă: șterge plugin-ul vechi din wp-admin sau încarcă un ZIP cu același folder.`}
																			>
																				<TriangleAlertIcon class="mr-1 size-3" /> folder diferit
																			</Badge>
																		{:else}
																			<Badge
																				variant="outline"
																				class="border-amber-500 text-[11px] text-amber-700 dark:text-amber-400"
																			>
																				<ArrowUpCircleIcon class="mr-1 size-3" />
																				{statusLabel(item.status)}
																			</Badge>
																		{/if}
																	{:else if item.status === 'up_to_date'}
																		<Badge
																			variant="outline"
																			class="border-green-600 text-[11px] text-green-700 dark:text-green-400"
																		>
																			<CheckCircleIcon class="mr-1 size-3" />
																			{statusLabel(item.status)}
																		</Badge>
																	{:else if item.status === 'downgrade'}
																		<Badge
																			variant="outline"
																			class="border-red-500 text-[11px] text-red-700 dark:text-red-400"
																			title="Biblioteca e în urmă; încarcă un ZIP mai nou"
																		>
																			{statusLabel(item.status)}
																		</Badge>
																	{:else if item.status === 'ambiguous'}
																		<Badge
																			variant="outline"
																			class="border-purple-500 text-[11px] text-purple-700 dark:text-purple-400"
																			title={(item.candidates ?? [])
																				.map(
																					(cand) =>
																						`${cand.installedName} v${cand.installedVersion} (scor ${cand.score})`
																				)
																				.join('; ')}
																		>
																			{statusLabel(item.status)}
																		</Badge>
																	{:else}
																		<span class="text-xs text-muted-foreground"
																			>{statusLabel(item.status)}</span
																		>
																	{/if}
																</TableCell>
																<TableCell class="text-sm">
																	{#if progress?.state === 'installing'}
																		<span
																			class="inline-flex items-center gap-1.5 text-muted-foreground"
																		>
																			<LoaderIcon class="size-3.5 animate-spin" /> se instalează…
																		</span>
																	{:else if progress?.state === 'done'}
																		<span
																			class="inline-flex items-center gap-1.5 {progress.message
																				? 'text-amber-700 dark:text-amber-400'
																				: 'text-green-700 dark:text-green-400'}"
																		>
																			<CheckCircleIcon class="size-3.5 shrink-0" />
																			<span
																				>actualizat la v{progress.toVersion ??
																					item.libraryVersion}{progress.message
																					? `: ${progress.message}`
																					: ''}</span
																			>
																		</span>
																	{:else if progress?.state === 'failed'}
																		<span
																			class="inline-flex items-center gap-1.5 text-destructive"
																			title={progress.message}
																		>
																			<XCircleIcon class="size-3.5 shrink-0" />
																			<span class="break-all">{shorten(progress.message, 160)}</span
																			>
																		</span>
																	{:else}
																		<span class="text-muted-foreground">–</span>
																	{/if}
																</TableCell>
															</TableRow>
														{/each}
													</TableBody>
												</Table>
											{/if}
										</div>
									</TableCell>
								</TableRow>
							{/if}
						{/each}
					</TableBody>
				</Table>
			</div>
		{/if}
	</Card>
</div>

<!-- ─────────────────────────── Upload dialog ─────────────────────────── -->
<Dialog bind:open={uploadOpen}>
	<DialogContent class="max-h-[80vh] max-w-2xl overflow-y-auto">
		<DialogHeader>
			<DialogTitle>Upload ZIP-uri în bibliotecă</DialogTitle>
			<DialogDescription>
				Selectează unul sau mai multe fișiere ZIP (max. 50 MB fiecare). Versiunea și identitatea se
				citesc din header-ul plugin-ului; o versiune mai nouă o înlocuiește pe cea din bibliotecă.
				Pachetele „unzip first" (PRO + versiunea standard în același ZIP) sunt desfăcute automat,
				fiecare plugin din interior devine o intrare separată. Site-urile nu sunt atinse la upload.
			</DialogDescription>
		</DialogHeader>

		<div class="flex flex-col gap-3">
			<label
				class="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-6 text-sm text-muted-foreground transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 hover:border-primary/50 hover:bg-muted/40"
			>
				<FileArchiveIcon class="size-8" />
				<span class="font-medium text-foreground">Alege fișiere ZIP</span>
				<span class="text-xs">poți selecta mai multe deodată</span>
				<input
					type="file"
					accept=".zip,application/zip"
					multiple
					class="sr-only"
					onchange={pickUploadFiles}
					disabled={uploading}
				/>
			</label>

			{#if uploadQueue.length > 0}
				<div class="flex flex-col divide-y divide-border rounded-md border border-border">
					{#each uploadQueue as item (item.id)}
						<div class="flex flex-col gap-1 p-2.5 text-sm">
							<div class="flex items-center gap-2">
								<div class="shrink-0">
									{#if item.status === 'queued'}
										<FileArchiveIcon class="size-4 text-muted-foreground" />
									{:else if item.status === 'uploading'}
										<LoaderIcon class="size-4 animate-spin text-muted-foreground" />
									{:else if item.status === 'success'}
										<CheckCircleIcon class="size-4 text-green-700 dark:text-green-400" />
									{:else if item.status === 'older'}
										<TriangleAlertIcon class="size-4 text-amber-500" />
									{:else}
										<XCircleIcon class="size-4 text-destructive" />
									{/if}
								</div>
								<div class="min-w-0 flex-1">
									<div class="truncate font-medium">
										{item.item?.name ?? item.info?.name ?? item.file.name}
									</div>
									<div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
										<span>{formatBytes(item.file.size)}</span>
										{#if item.status === 'queued'}
											<span>· în așteptare</span>
										{:else if item.status === 'uploading'}
											<span>· se urcă…</span>
										{:else if item.entries}
											<span
												class={item.status === 'error'
													? 'text-destructive'
													: item.status === 'older'
														? 'text-amber-700 dark:text-amber-400'
														: 'text-green-700 dark:text-green-400'}
											>
												· pachet cu {item.entries.length} plugin-uri
												{#if item.message}({item.message}){/if}
											</span>
										{:else if item.status === 'success'}
											{#if item.outcome === 'added'}
												<span class="text-green-700 dark:text-green-400"
													>· adăugat v{item.item?.version}</span
												>
											{:else if item.relation === 'same'}
												<span class="text-green-700 dark:text-green-400"
													>· reîncărcat v{item.item?.version}</span
												>
											{:else}
												<span class="text-green-700 dark:text-green-400"
													>· înlocuit v{item.previousVersion} → v{item.item?.version}</span
												>
											{/if}
										{:else if item.status === 'older'}
											<span class="text-amber-700 dark:text-amber-400">
												· v{item.info?.version} e mai veche decât v{item.existingVersion} din bibliotecă
											</span>
										{:else if item.status === 'error'}
											<span class="break-all text-destructive">· {item.message}</span>
										{/if}
									</div>
								</div>

								{#if item.status === 'older' && !uploading}
									<label
										class="flex shrink-0 cursor-pointer items-center gap-1 text-xs text-muted-foreground select-none"
									>
										<input
											type="checkbox"
											class="size-3.5"
											checked={item.force ?? false}
											onchange={() => toggleForce(item.id)}
										/>
										Forțează
									</label>
								{/if}

								{#if !uploading && item.status !== 'uploading'}
									<Button
										variant="ghost"
										size="icon"
										class="h-7 w-7"
										onclick={() => removeFromQueue(item.id)}
										title="Scoate din listă"
										aria-label="Scoate {item.file.name} din listă"
									>
										<XCircleIcon class="size-3.5" />
									</Button>
								{/if}
							</div>

							{#if item.entries && item.entries.length > 0}
								<ul class="ml-6 space-y-0.5 text-xs">
									{#each item.entries as e, idx (idx)}
										<li class="flex flex-wrap items-center gap-1.5">
											<span class="text-muted-foreground" aria-hidden="true">↳</span>
											<span class="font-medium">{e.item?.name ?? e.info?.name ?? e.filename}</span>
											{#if e.outcome === 'added'}
												<span class="text-green-700 dark:text-green-400"
													>adăugat v{e.item?.version}</span
												>
											{:else if e.outcome === 'replaced'}
												<span class="text-green-700 dark:text-green-400">
													{e.relation === 'same' ? 'reîncărcat' : 'înlocuit'} v{e.previousVersion} → v{e
														.item?.version}
												</span>
											{:else if e.outcome === 'rejected_older'}
												<span class="text-amber-700 dark:text-amber-400"
													>v{e.info?.version} e mai veche decât v{e.existingVersion} din bibliotecă</span
												>
											{:else}
												<span class="break-all text-destructive">{e.error}</span>
											{/if}
										</li>
									{/each}
								</ul>
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
			<Button variant="outline" onclick={() => (uploadOpen = false)} disabled={uploading}
				>Închide</Button
			>
			<Button onclick={runUpload} disabled={uploading || uploadReadyCount === 0}>
				{#if uploading}
					<LoaderIcon class="mr-2 size-4 animate-spin" />
					Se urcă…
				{:else}
					<CloudUploadIcon class="mr-2 size-4" />
					Urcă {uploadReadyCount} fișier(e)
				{/if}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>

<!-- ────────────────────────── Run confirm dialog ─────────────────────── -->
<Dialog bind:open={runConfirmOpen}>
	<DialogContent class="sm:max-w-md">
		<DialogHeader>
			<DialogTitle>Actualizează plugin-uri din bibliotecă</DialogTitle>
			<DialogDescription>
				{runTotal} pași pe {runTargets.length} site-uri, în ordinea de mai jos: plugin-ul de bază înaintea
				celui PRO, iar un PRO nu rulează dacă baza lui a eșuat. Plugin-urile active rămân active, cele
				inactive rămân inactive. Câte un pas pe rând per site, maxim două site-uri în paralel.
			</DialogDescription>
		</DialogHeader>
		<label
			class="flex cursor-pointer items-center gap-2 rounded-md bg-muted/40 p-2.5 text-xs select-none"
		>
			<input type="checkbox" class="size-4" bind:checked={backupFirst} />
			Backup complet (SQL + wp-content) pe fiecare site înainte de primul update. Recomandat; durează
			câteva minute pe site-urile mari.
		</label>
		<div class="max-h-72 space-y-2 overflow-y-auto text-sm">
			{#each runTargets as t (t.site.id)}
				<div>
					<div class="font-medium">{t.site.name}</div>
					<ol class="ml-4 list-decimal space-y-0.5 text-xs text-muted-foreground">
						{#each t.steps as step (step.key)}
							<li>
								<span class="text-foreground">{step.name}</span>
								{step.fromVersion ?? '?'} → {step.toVersion}
								({step.kind === 'wporg' ? 'wordpress.org' : 'bibliotecă'}{step.autoIncluded &&
								step.requiredBy
									? `, bază necesară pentru ${step.requiredBy}`
									: ''})
							</li>
						{/each}
					</ol>
				</div>
			{/each}
		</div>
		<DialogFooter>
			<Button variant="outline" onclick={() => (runConfirmOpen = false)}>Anulează</Button>
			<Button class="bg-amber-500 text-white hover:bg-amber-600" onclick={runUpdates}>
				<ArrowUpCircleIcon class="mr-2 size-4" />
				Actualizează ({runTotal})
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
