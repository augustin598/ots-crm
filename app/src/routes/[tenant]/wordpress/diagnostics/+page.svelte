<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import { Card } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import CircleXIcon from '@lucide/svelte/icons/circle-x';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import InfoIcon from '@lucide/svelte/icons/info';
	import ServerIcon from '@lucide/svelte/icons/server';

	type LogEntry = {
		id: string;
		level: 'info' | 'warning' | 'error';
		message: string;
		createdAt: string;
		errorCode: string | null;
	};

	type SiteDiagnostic = {
		id: string;
		name: string;
		url: string;
		clientName: string | null;
		status: 'connected' | 'disconnected' | 'error' | 'pending';
		paused: number;
		uptimeStatus: 'up' | 'down' | 'unknown';
		consecutiveFailures: number;
		wpVersion: string | null;
		phpVersion: string | null;
		sslExpiresAt: string | null;
		lastHealthCheckAt: string | null;
		lastUptimePingAt: string | null;
		lastUpdatesCheckAt: string | null;
		lastError: string | null;
		connectorVersionDb: string | null;
		connectorVersionLive: string | null;
		connectorVersionAgree: boolean | null;
		liveHealthError: string | null;
		liveHealthSubcode: string | null;
		onLatestConnector: boolean | null;
		recentLogs: LogEntry[];
	};

	type DiagnosticsPayload = {
		tenantId: string;
		fetchedAt: string;
		latestConnector: { version: string; uploadedAt: string; notes: string | null } | null;
		sites: SiteDiagnostic[];
	};

	const tenantSlug = $derived(page.params.tenant);

	let payload = $state<DiagnosticsPayload | null>(null);
	let loading = $state(true);

	async function load() {
		loading = true;
		try {
			const res = await fetch(`/${tenantSlug}/api/wordpress/diagnostics`);
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { error?: string };
				throw new Error(body.error || `HTTP ${res.status}`);
			}
			payload = (await res.json()) as DiagnosticsPayload;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Nu s-au putut încărca diagnosticele');
		} finally {
			loading = false;
		}
	}

	onMount(load);

	function fmtDate(iso: string | null): string {
		if (!iso) return '—';
		return new Date(iso).toLocaleString('ro-RO', {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function ageStr(iso: string | null): string {
		if (!iso) return 'never';
		const diff = Date.now() - new Date(iso).getTime();
		const minutes = Math.floor(diff / 60_000);
		if (minutes < 1) return 'just now';
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}

	function sslStatus(iso: string | null): {
		kind: 'ok' | 'warning' | 'expired' | 'unknown';
		days: number | null;
	} {
		if (!iso) return { kind: 'unknown', days: null };
		const diff = new Date(iso).getTime() - Date.now();
		const days = Math.floor(diff / 86_400_000);
		if (days < 0) return { kind: 'expired', days };
		if (days < 14) return { kind: 'warning', days };
		return { kind: 'ok', days };
	}

	/** A compact traffic-light style health label for each site. */
	function overallHealth(site: SiteDiagnostic): 'green' | 'amber' | 'red' | 'gray' {
		if (site.paused === 1) return 'gray';
		if (site.status === 'disconnected') return 'gray';
		if (site.status === 'error' || site.uptimeStatus === 'down') return 'red';
		if (
			site.connectorVersionAgree === false ||
			site.onLatestConnector === false ||
			site.consecutiveFailures > 0 ||
			sslStatus(site.sslExpiresAt).kind === 'warning' ||
			sslStatus(site.sslExpiresAt).kind === 'expired'
		) {
			return 'amber';
		}
		return 'green';
	}

	const healthCounts = $derived({
		green: payload?.sites.filter((s) => overallHealth(s) === 'green').length ?? 0,
		amber: payload?.sites.filter((s) => overallHealth(s) === 'amber').length ?? 0,
		red: payload?.sites.filter((s) => overallHealth(s) === 'red').length ?? 0,
		gray: payload?.sites.filter((s) => overallHealth(s) === 'gray').length ?? 0
	});
</script>

<svelte:head>
	<title>Diagnostics WordPress — OTS CRM</title>
</svelte:head>

<div class="flex flex-col gap-4 p-6">
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
			<h1 class="text-2xl font-semibold tracking-tight">Diagnostics WordPress</h1>
			<p class="text-sm text-muted-foreground">
				Snapshot live al tuturor site-urilor — versiune connector, uptime, SSL, ultimele log-uri.
				{#if payload?.fetchedAt}
					· Încărcat {ageStr(payload.fetchedAt)}
				{/if}
			</p>
		</div>
		<div class="flex items-center gap-2">
			<Button variant="outline" disabled={loading} onclick={load}>
				<RefreshCwIcon class="mr-2 size-4 {loading ? 'animate-spin' : ''}" />
				Refresh
			</Button>
		</div>
	</div>

	{#if payload?.latestConnector}
		<Card class="p-4 flex items-center gap-3 bg-muted/20">
			<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
				<ServerIcon class="size-5 text-primary" />
			</div>
			<div class="flex-1">
				<div class="text-sm font-medium">
					Connector v{payload.latestConnector.version}
					<span class="text-muted-foreground font-normal">(ultima versiune publicat\u0103)</span>
				</div>
				<div class="text-xs text-muted-foreground">
					Publicat\u0103 {fmtDate(payload.latestConnector.uploadedAt)}
					{#if payload.latestConnector.notes}
						· {payload.latestConnector.notes}
					{/if}
				</div>
			</div>
		</Card>
	{/if}

	<!-- Summary row: traffic light counts -->
	<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
		<Card class="p-3 flex items-center gap-3">
			<div class="flex h-9 w-9 items-center justify-center rounded-lg bg-green-100 dark:bg-green-950/40">
				<CircleCheckIcon class="size-5 text-green-600" />
			</div>
			<div>
				<div class="text-2xl font-bold tabular-nums">{healthCounts.green}</div>
				<div class="text-xs text-muted-foreground">OK</div>
			</div>
		</Card>
		<Card class="p-3 flex items-center gap-3">
			<div class="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-950/40">
				<TriangleAlertIcon class="size-5 text-amber-600" />
			</div>
			<div>
				<div class="text-2xl font-bold tabular-nums">{healthCounts.amber}</div>
				<div class="text-xs text-muted-foreground">Warning</div>
			</div>
		</Card>
		<Card class="p-3 flex items-center gap-3">
			<div class="flex h-9 w-9 items-center justify-center rounded-lg bg-red-100 dark:bg-red-950/40">
				<CircleXIcon class="size-5 text-red-600" />
			</div>
			<div>
				<div class="text-2xl font-bold tabular-nums">{healthCounts.red}</div>
				<div class="text-xs text-muted-foreground">Down / error</div>
			</div>
		</Card>
		<Card class="p-3 flex items-center gap-3">
			<div class="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
				<InfoIcon class="size-5 text-muted-foreground" />
			</div>
			<div>
				<div class="text-2xl font-bold tabular-nums">{healthCounts.gray}</div>
				<div class="text-xs text-muted-foreground">Pauzate/deconectate</div>
			</div>
		</Card>
	</div>

	{#if loading && !payload}
		<div class="py-8 text-center text-sm text-muted-foreground">Se încarcă…</div>
	{:else if payload && payload.sites.length === 0}
		<Card class="p-12 text-center">
			<p class="text-sm text-muted-foreground">Nu există site-uri înregistrate.</p>
		</Card>
	{:else if payload}
		<div class="space-y-3">
			{#each payload.sites as site (site.id)}
				{@const health = overallHealth(site)}
				{@const ssl = sslStatus(site.sslExpiresAt)}
				<Card class="p-4 border-2 {health === 'red' ? 'border-red-300 dark:border-red-900' : health === 'amber' ? 'border-amber-300 dark:border-amber-900' : health === 'gray' ? 'border-muted' : 'border-border'}">
					<div class="flex items-start gap-3 mb-3">
						<div class="shrink-0 pt-0.5">
							{#if health === 'green'}
								<CircleCheckIcon class="size-5 text-green-600" />
							{:else if health === 'amber'}
								<TriangleAlertIcon class="size-5 text-amber-600" />
							{:else if health === 'red'}
								<CircleXIcon class="size-5 text-red-600" />
							{:else}
								<InfoIcon class="size-5 text-muted-foreground" />
							{/if}
						</div>
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2 flex-wrap">
								<h3 class="font-semibold text-base truncate">{site.name}</h3>
								{#if site.clientName}
									<Badge variant="outline" class="text-[10px]">{site.clientName}</Badge>
								{/if}
								{#if site.paused === 1}
									<Badge variant="secondary">Pauzat</Badge>
								{/if}
								{#if site.status === 'disconnected'}
									<Badge variant="destructive">Deconectat</Badge>
								{:else if site.status === 'error'}
									<Badge variant="destructive">Error</Badge>
								{/if}
							</div>
							<a
								href={site.url}
								target="_blank"
								rel="noopener noreferrer"
								class="text-xs text-muted-foreground hover:underline"
							>
								{site.url}
							</a>
						</div>
					</div>

					<div class="grid gap-3 md:grid-cols-3 text-xs">
						<!-- Connector version -->
						<div class="rounded-lg bg-muted/30 p-3">
							<div class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
								Connector
							</div>
							<div class="font-mono text-sm">
								DB: v{site.connectorVersionDb ?? '?'}
							</div>
							{#if site.connectorVersionLive}
								<div class="font-mono text-sm">
									Live: v{site.connectorVersionLive}
								</div>
								{#if site.connectorVersionAgree === false}
									<div class="mt-1 text-amber-600">
										<TriangleAlertIcon class="inline size-3" />
										mismatch DB vs live
									</div>
								{/if}
								{#if site.onLatestConnector === false}
									<div class="mt-1 text-amber-600">
										update disponibil
										{#if payload.latestConnector}→ v{payload.latestConnector.version}{/if}
									</div>
								{/if}
							{:else if site.liveHealthError}
								<div class="mt-1 text-red-600 break-words">
									Live probe e\u0219uat: {site.liveHealthSubcode ?? 'error'}
								</div>
							{/if}
						</div>

						<!-- Uptime + failures -->
						<div class="rounded-lg bg-muted/30 p-3">
							<div class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
								Uptime
							</div>
							<div class="flex items-center gap-1.5">
								{#if site.uptimeStatus === 'up'}
									<CircleCheckIcon class="size-3.5 text-green-600" />
									<span>Up</span>
								{:else if site.uptimeStatus === 'down'}
									<CircleXIcon class="size-3.5 text-red-600" />
									<span>Down</span>
								{:else}
									<CircleAlertIcon class="size-3.5 text-muted-foreground" />
									<span class="text-muted-foreground">Unknown</span>
								{/if}
							</div>
							<div class="text-muted-foreground mt-1">
								Ultima verificare: {ageStr(site.lastUptimePingAt)}
							</div>
							{#if site.consecutiveFailures > 0}
								<div class="text-red-600 mt-1">
									{site.consecutiveFailures} e\u0219ec(uri) consecutive
								</div>
							{/if}
						</div>

						<!-- SSL + versions -->
						<div class="rounded-lg bg-muted/30 p-3">
							<div class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
								SSL / Stack
							</div>
							{#if ssl.kind === 'ok' && ssl.days !== null}
								<div class="text-green-700 dark:text-green-400">SSL OK ({ssl.days}d)</div>
							{:else if ssl.kind === 'warning' && ssl.days !== null}
								<div class="text-amber-600">SSL expiră în {ssl.days}d</div>
							{:else if ssl.kind === 'expired'}
								<div class="text-red-600">SSL expirat</div>
							{:else}
								<div class="text-muted-foreground">SSL necunoscut</div>
							{/if}
							<div class="text-muted-foreground mt-1">
								WP {site.wpVersion ?? '?'} · PHP {site.phpVersion ?? '?'}
							</div>
						</div>
					</div>

					{#if site.lastError}
						<div class="mt-3 rounded-lg bg-red-50 dark:bg-red-950/40 p-3 text-xs text-red-900 dark:text-red-200 break-words">
							<span class="font-semibold">Ultima eroare:</span> {site.lastError}
						</div>
					{/if}

					{#if site.recentLogs.length > 0}
						<details class="mt-3">
							<summary class="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
								Ultimele {site.recentLogs.length} log-uri
							</summary>
							<div class="mt-2 flex flex-col divide-y divide-border rounded-md border">
								{#each site.recentLogs as l (l.id)}
									<div class="p-2 text-xs">
										<div class="flex items-center gap-2 mb-0.5">
											{#if l.level === 'error'}
												<Badge variant="destructive" class="text-[10px]">error</Badge>
											{:else if l.level === 'warning'}
												<Badge variant="outline" class="text-[10px] border-amber-500 text-amber-600">warn</Badge>
											{:else}
												<Badge variant="outline" class="text-[10px]">info</Badge>
											{/if}
											<span class="text-muted-foreground text-[10px]">{fmtDate(l.createdAt)}</span>
											{#if l.errorCode}
												<span class="text-muted-foreground text-[10px] font-mono">{l.errorCode}</span>
											{/if}
										</div>
										<div class="break-words">{l.message}</div>
									</div>
								{/each}
							</div>
						</details>
					{/if}
				</Card>
			{/each}
		</div>
	{/if}
</div>
