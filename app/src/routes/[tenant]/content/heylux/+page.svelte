<script lang="ts">
	import {
		getContentArticles,
		getContentImportJob,
		importHeyluxSources,
		startContentExtraction,
		retryFailedExtractions
	} from '$lib/remotes/content-articles.remote';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import {
		Table,
		TableBody,
		TableCell,
		TableHead,
		TableHeader,
		TableRow
	} from '$lib/components/ui/table';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import PlayIcon from '@lucide/svelte/icons/play';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';

	const BRANDS = [
		{ value: 'heylux', label: 'Heylux' },
		{ value: 'luckystudio', label: 'Lucky Studio' },
		{ value: 'preziosa', label: 'Preziosa' },
		{ value: 'forumvideochat', label: 'ForumVideochat' },
		{ value: 'vivadiva', label: 'VivaDiva' },
		{ value: 'unknown', label: 'Necunoscut' }
	] as const;

	const STATUSES = [
		{ value: 'pending', label: 'Pending' },
		{ value: 'ok', label: 'OK' },
		{ value: 'thin', label: 'Thin' },
		{ value: 'failed', label: 'Failed' }
	] as const;

	let brandFilter = $state('');
	let statusFilter = $state('');
	let busy = $state(false);
	let refreshing = $state(false);

	// Args derivate: când filtrele se schimbă, filterParams devine un nou obiect
	// și getContentArticles(filterParams) re-fetch-uiește automat.
	const filterParams = $derived({
		brand: brandFilter || undefined,
		status: statusFilter || undefined
	});

	// === Reads — declarative, no imperative load* ===
	// Boundary-urile per-secțiune controlează skeleton-ul pe primul load.
	const articles = $derived(await getContentArticles(filterParams));
	const job = $derived(await getContentImportJob(undefined));

	function statusVariant(status: string): 'success' | 'warning' | 'destructive' | 'secondary' | 'outline' {
		switch (status) {
			case 'ok':
				return 'success';
			case 'thin':
				return 'warning';
			case 'failed':
				return 'destructive';
			case 'pending':
				return 'secondary';
			default:
				return 'outline';
		}
	}

	function statusLabel(status: string): string {
		const labels: Record<string, string> = {
			pending: 'Pending',
			ok: 'OK',
			thin: 'Thin',
			failed: 'Failed'
		};
		return labels[status] ?? status;
	}

	function jobStatusVariant(status: string): 'success' | 'destructive' | 'secondary' | 'default' {
		switch (status) {
			case 'completed':
				return 'success';
			case 'failed':
				return 'destructive';
			case 'running':
				return 'default';
			default:
				return 'secondary';
		}
	}

	function formatDate(value: Date | string | null | undefined): string {
		if (!value) return '—';
		const d = value instanceof Date ? value : new Date(value);
		if (isNaN(d.getTime())) return '—';
		return d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' });
	}

	async function doImport() {
		busy = true;
		try {
			const r = await importHeyluxSources().updates(getContentArticles(filterParams));
			toast.success(`Importate ${r.inserted} surse (din ${r.total})`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare import');
		} finally {
			busy = false;
		}
	}

	async function doStart() {
		busy = true;
		try {
			await startContentExtraction().updates(
				getContentImportJob(undefined),
				getContentArticles(filterParams)
			);
			toast.success('Extracție pornită');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare pornire');
		} finally {
			busy = false;
		}
	}

	async function doRetry() {
		busy = true;
		try {
			await retryFailedExtractions().updates(
				getContentImportJob(undefined),
				getContentArticles(filterParams)
			);
			toast.success('Reîncercare pornită');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare retry');
		} finally {
			busy = false;
		}
	}

	// Refresh manual (buton) — re-fetch job + listă. Nu există auto-polling;
	// job-ul rulează în fundal, deci utilizatorul apasă Refresh ca să vadă progresul.
	async function refreshAll() {
		if (refreshing) return;
		refreshing = true;
		try {
			await Promise.all([getContentImportJob(undefined).refresh(), getContentArticles(filterParams).refresh()]);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Refresh eșuat');
		} finally {
			refreshing = false;
		}
	}
</script>

<svelte:head>
	<title>Content Heylux - CRM</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-3xl font-bold tracking-tight">Content Heylux</h1>
			<p class="text-muted-foreground mt-1">Parsare advertoriale importate din sursele Heylux</p>
		</div>
		<div class="flex items-center gap-2">
			<Button variant="outline" onclick={refreshAll} disabled={refreshing}>
				<RefreshCwIcon class="mr-2 h-4 w-4 {refreshing ? 'animate-spin' : ''}" />
				Refresh
			</Button>
			<Button variant="outline" onclick={doImport} disabled={busy}>
				<UploadIcon class="mr-2 h-4 w-4" />
				Importă surse
			</Button>
			<Button onclick={doStart} disabled={busy}>
				<PlayIcon class="mr-2 h-4 w-4" />
				Pornește extracția
			</Button>
			<Button variant="outline" onclick={doRetry} disabled={busy}>
				<RotateCcwIcon class="mr-2 h-4 w-4" />
				Reîncearcă eșecuri
			</Button>
		</div>
	</div>

	<svelte:boundary>
		{#snippet pending()}
			<div class="h-16 animate-pulse rounded-xl border border-border/40 bg-muted/40"></div>
		{/snippet}
		{#snippet failed(error, reset)}
			<div class="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
				Eroare la încărcarea job-ului: {error instanceof Error ? error.message : String(error)}
				<button class="ml-2 underline" type="button" onclick={reset}>Reîncearcă</button>
			</div>
		{/snippet}
		{#if job}
			<div
				class="flex flex-wrap items-center gap-3 rounded-xl border border-border/40 bg-card/50 p-4 text-sm"
			>
				<Badge variant={jobStatusVariant(job.status)}>{job.status}</Badge>
				<span>{job.processedArticles}/{job.totalArticles} procesate</span>
				<span class="text-muted-foreground">·</span>
				<span class="text-emerald-600 dark:text-emerald-400">ok {job.okCount}</span>
				<span class="text-amber-600 dark:text-amber-400">thin {job.thinCount}</span>
				<span class="text-destructive">fail {job.failedCount}</span>
			</div>
		{:else}
			<p class="text-sm text-muted-foreground">
				Niciun job de extracție pornit încă. Apasă „Importă surse" apoi „Pornește extracția".
			</p>
		{/if}
	</svelte:boundary>

	<div class="flex flex-wrap gap-3">
		<div class="w-48 space-y-1.5">
			<p class="text-xs font-medium text-muted-foreground">Brand</p>
			<Select
				value={brandFilter || 'all'}
				type="single"
				onValueChange={(v) => (brandFilter = v === 'all' ? '' : (v ?? ''))}
			>
				<SelectTrigger class="h-9">
					{brandFilter ? (BRANDS.find((b) => b.value === brandFilter)?.label ?? brandFilter) : 'Toate brandurile'}
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="all">Toate brandurile</SelectItem>
					{#each BRANDS as b (b.value)}
						<SelectItem value={b.value}>{b.label}</SelectItem>
					{/each}
				</SelectContent>
			</Select>
		</div>
		<div class="w-48 space-y-1.5">
			<p class="text-xs font-medium text-muted-foreground">Status</p>
			<Select
				value={statusFilter || 'all'}
				type="single"
				onValueChange={(v) => (statusFilter = v === 'all' ? '' : (v ?? ''))}
			>
				<SelectTrigger class="h-9">
					{statusFilter ? statusLabel(statusFilter) : 'Toate statusurile'}
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="all">Toate statusurile</SelectItem>
					{#each STATUSES as s (s.value)}
						<SelectItem value={s.value}>{s.label}</SelectItem>
					{/each}
				</SelectContent>
			</Select>
		</div>
	</div>

	<div
		class="overflow-hidden rounded-2xl border border-border/40 bg-card/50 shadow-sm backdrop-blur-[2px]"
	>
		<div class="overflow-x-auto">
			<svelte:boundary>
				{#snippet pending()}
					<div class="flex flex-col gap-2 p-4">
						{#each Array(6) as _, i (i)}
							<div class="h-10 animate-pulse rounded-md bg-muted/50"></div>
						{/each}
					</div>
				{/snippet}
				{#snippet failed(error, reset)}
					<div class="p-6 text-sm text-destructive">
						Nu pot încărca articolele: {error instanceof Error ? error.message : String(error)}
						<button class="ml-2 underline" type="button" onclick={reset}>Reîncearcă</button>
					</div>
				{/snippet}
				<Table class="text-sm">
					<TableHeader>
						<TableRow class="border-b border-border/50 hover:bg-transparent">
							<TableHead>Brand</TableHead>
							<TableHead>Titlu</TableHead>
							<TableHead class="text-right">Cuvinte</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>Data</TableHead>
							<TableHead>Sursă</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{#each articles as a (a.id)}
							<TableRow>
								<TableCell class="capitalize">{a.brand}</TableCell>
								<TableCell class="max-w-md truncate" title={a.title ?? ''}>{a.title ?? '—'}</TableCell>
								<TableCell class="text-right tabular-nums">{a.wordCount}</TableCell>
								<TableCell>
									<div class="flex items-center gap-1.5">
										<Badge variant={statusVariant(a.extractStatus)}>{statusLabel(a.extractStatus)}</Badge>
										{#if a.extractError}
											<AlertTriangleIcon class="h-3.5 w-3.5 shrink-0 text-destructive" aria-label={a.extractError} />
										{/if}
									</div>
								</TableCell>
								<TableCell>{formatDate(a.publishedAt)}</TableCell>
								<TableCell class="max-w-xs truncate">
									<a
										href={a.sourceUrl}
										target="_blank"
										rel="noopener noreferrer"
										class="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
									>
										link <ExternalLinkIcon class="h-3 w-3" />
									</a>
								</TableCell>
							</TableRow>
						{:else}
							<TableRow>
								<TableCell colspan={6} class="py-8 text-center text-muted-foreground">
									Niciun articol găsit
								</TableCell>
							</TableRow>
						{/each}
					</TableBody>
				</Table>
			</svelte:boundary>
		</div>
	</div>
</div>
