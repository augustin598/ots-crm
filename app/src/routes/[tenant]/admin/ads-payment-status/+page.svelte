<script lang="ts">
	import {
		getAdsPaymentStatusDashboard,
		triggerAdsStatusMonitor,
		muteAccountAlerts,
		unmuteAccountAlerts,
	} from '$lib/remotes/ads-status.remote';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Switch } from '$lib/components/ui/switch';
	import { Label } from '$lib/components/ui/label';
	import {
		Select,
		SelectContent,
		SelectItem,
		SelectTrigger,
	} from '$lib/components/ui/select';
	import { toast } from 'svelte-sonner';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import PlayIcon from '@lucide/svelte/icons/play';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import CheckCircleIcon from '@lucide/svelte/icons/check-circle';
	import SearchIcon from '@lucide/svelte/icons/search';
	import { page } from '$app/state';

	let showOnlyActive = $state(true);
	let providerFilter = $state<string>('all');
	let statusFilter = $state<string>('all');
	let searchText = $state('');
	let isTriggering = $state(false);

	let dashboardQuery = $state(
		getAdsPaymentStatusDashboard({ showOnlyActiveClients: true }),
	);

	$effect(() => {
		dashboardQuery = getAdsPaymentStatusDashboard({ showOnlyActiveClients: showOnlyActive });
	});

	const dashboard = $derived(dashboardQuery.current);

	const tenantSlug = $derived(page.params.tenant ?? '');

	const filteredRows = $derived.by(() => {
		const rows = dashboard?.flagged ?? [];
		const search = searchText.trim().toLowerCase();
		return rows.filter((row) => {
			if (providerFilter !== 'all' && row.provider !== providerFilter) return false;
			if (statusFilter !== 'all' && row.paymentStatus !== statusFilter) return false;
			if (search) {
				const haystack = [
					row.accountName,
					row.externalAccountId,
					row.clientName ?? '',
					row.clientEmail ?? '',
				]
					.join(' ')
					.toLowerCase();
				if (!haystack.includes(search)) return false;
			}
			return true;
		});
	});

	const statusStyles: Record<string, string> = {
		suspended: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
		closed: 'bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300',
		payment_failed: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
		risk_review: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
		grace_period: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
		ok: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
	};

	const providerStyles: Record<string, string> = {
		meta: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
		google: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
		tiktok: 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-400',
	};

	function formatCheckedAt(iso: string | null): string {
		if (!iso) return '—';
		const date = new Date(iso);
		return date.toLocaleString('ro-RO', {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		});
	}

	async function handleRefresh() {
		try {
			await dashboardQuery.refresh();
			toast.success('Listă actualizată');
		} catch (err) {
			toast.error('Nu s-a putut reîncărca lista');
		}
	}

	async function handleTriggerMonitor() {
		if (isTriggering) return;
		isTriggering = true;
		try {
			await triggerAdsStatusMonitor({});
			toast.success('Verificare status declanșată — rezultatele apar în ~1 minut');
			setTimeout(() => {
				dashboardQuery.refresh();
			}, 5000);
		} catch (err) {
			toast.error('Nu s-a putut declanșa verificarea');
		} finally {
			isTriggering = false;
		}
	}

	async function handleToggleMute(row: { provider: 'meta' | 'google' | 'tiktok'; accountTableId: string; accountName: string; isMuted: boolean }) {
		try {
			if (row.isMuted) {
				await unmuteAccountAlerts({ provider: row.provider, accountTableId: row.accountTableId });
				toast.success(`Alertele pentru ${row.accountName} au fost reactivate`);
			} else {
				await muteAccountAlerts({ provider: row.provider, accountTableId: row.accountTableId });
				toast.success(`Alertele pentru ${row.accountName} au fost ignorate`);
			}
			await dashboardQuery.refresh();
		} catch (err) {
			toast.error('Nu s-a putut modifica starea de mut');
		}
	}

	const statusOptions = [
		{ value: 'all', label: 'Toate statusurile' },
		{ value: 'suspended', label: 'Suspendat' },
		{ value: 'closed', label: 'Închis' },
		{ value: 'payment_failed', label: 'Plată eșuată' },
		{ value: 'risk_review', label: 'Revizuire' },
		{ value: 'grace_period', label: 'Grație' },
	];

	const providerOptions = [
		{ value: 'all', label: 'Toate platformele' },
		{ value: 'meta', label: 'Meta (Facebook)' },
		{ value: 'google', label: 'Google Ads' },
		{ value: 'tiktok', label: 'TikTok Ads' },
	];

	const statusSummary = $derived.by(() => {
		const counts = dashboard?.totals.byStatus ?? {
			ok: 0, grace_period: 0, risk_review: 0, payment_failed: 0, suspended: 0, closed: 0,
		};
		return [
			{ key: 'suspended', label: 'Suspendat', count: counts.suspended },
			{ key: 'payment_failed', label: 'Plată eșuată', count: counts.payment_failed },
			{ key: 'grace_period', label: 'Grație', count: counts.grace_period },
			{ key: 'risk_review', label: 'Revizuire', count: counts.risk_review },
			{ key: 'closed', label: 'Închis', count: counts.closed },
		];
	});
</script>

<div class="flex flex-col gap-6 p-6">
	<div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
		<div>
			<h1 class="text-2xl font-semibold">Status plată conturi publicitate</h1>
			<p class="text-sm text-muted-foreground">
				Toate conturile Meta, Google și TikTok cu probleme de plată sau suspendare. Verificare automată orară.
			</p>
		</div>
		<div class="flex flex-wrap items-center gap-3">
			<div class="flex items-center gap-2 rounded-md border px-3 py-2">
				<Switch id="show-only-active" bind:checked={showOnlyActive} />
				<Label for="show-only-active" class="cursor-pointer text-sm">Doar clienți activi</Label>
			</div>
			<Button variant="outline" onclick={handleRefresh} disabled={dashboardQuery.loading}>
				<RefreshCwIcon class="mr-2 size-4" />
				Reîncarcă
			</Button>
			<Button onclick={handleTriggerMonitor} disabled={isTriggering}>
				<PlayIcon class="mr-2 size-4" />
				{isTriggering ? 'Se declanșează...' : 'Verifică acum'}
			</Button>
		</div>
	</div>

	<div class="grid grid-cols-2 gap-3 md:grid-cols-6">
		<Card>
			<CardHeader class="pb-2">
				<CardTitle class="text-xs uppercase text-muted-foreground">Total flagged</CardTitle>
			</CardHeader>
			<CardContent>
				<div class="text-2xl font-bold">{dashboard?.totals.total ?? 0}</div>
				<div class="text-xs text-muted-foreground">
					din {dashboard?.totalAccountsMonitored ?? 0} monitorizate
				</div>
			</CardContent>
		</Card>
		{#each statusSummary as item (item.key)}
			<Card>
				<CardHeader class="pb-2">
					<CardTitle class="text-xs uppercase text-muted-foreground">{item.label}</CardTitle>
				</CardHeader>
				<CardContent>
					<div class="text-2xl font-bold">{item.count}</div>
					<Badge class={statusStyles[item.key]}>
						{item.label}
					</Badge>
				</CardContent>
			</Card>
		{/each}
	</div>

	<Card>
		<CardHeader>
			<div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
				<CardTitle class="text-base">Conturi cu probleme</CardTitle>
				<div class="flex flex-col gap-2 md:flex-row md:items-center">
					<div class="relative">
						<SearchIcon class="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
						<Input
							type="search"
							placeholder="Caută cont, ID sau client..."
							bind:value={searchText}
							class="w-full pl-8 md:w-72"
						/>
					</div>
					<Select type="single" bind:value={providerFilter}>
						<SelectTrigger class="w-full md:w-48">
							{providerOptions.find((o) => o.value === providerFilter)?.label ?? 'Platformă'}
						</SelectTrigger>
						<SelectContent>
							{#each providerOptions as opt (opt.value)}
								<SelectItem value={opt.value}>{opt.label}</SelectItem>
							{/each}
						</SelectContent>
					</Select>
					<Select type="single" bind:value={statusFilter}>
						<SelectTrigger class="w-full md:w-48">
							{statusOptions.find((o) => o.value === statusFilter)?.label ?? 'Status'}
						</SelectTrigger>
						<SelectContent>
							{#each statusOptions as opt (opt.value)}
								<SelectItem value={opt.value}>{opt.label}</SelectItem>
							{/each}
						</SelectContent>
					</Select>
				</div>
			</div>
		</CardHeader>
		<CardContent>
			{#if dashboardQuery.loading && !dashboard}
				<div class="py-12 text-center text-sm text-muted-foreground">Se încarcă...</div>
			{:else if filteredRows.length === 0}
				<div class="flex flex-col items-center gap-2 py-12 text-center">
					<CheckCircleIcon class="size-10 text-emerald-500" />
					<p class="text-sm font-medium">Niciun cont cu probleme</p>
					<p class="text-xs text-muted-foreground">
						{dashboard?.totalAccountsMonitored ?? 0} conturi monitorizate — toate OK.
					</p>
				</div>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-sm">
						<thead>
							<tr class="border-b text-left text-xs uppercase text-muted-foreground">
								<th class="py-3 pr-3">Platformă</th>
								<th class="py-3 pr-3">Cont</th>
								<th class="py-3 pr-3">Client</th>
								<th class="py-3 pr-3">Status</th>
								<th class="py-3 pr-3">Cod raw</th>
								<th class="py-3 pr-3">Verificat</th>
								<th class="py-3 pr-3">Alerte</th>
								<th class="py-3">Acțiuni</th>
							</tr>
						</thead>
						<tbody>
							{#each filteredRows as row (row.provider + ':' + row.accountTableId)}
								<tr
									class="border-b last:border-0 hover:bg-muted/30"
									class:opacity-50={row.isMuted}
								>
									<td class="py-3 pr-3">
										<Badge class={providerStyles[row.provider]}>
											{row.providerLabel}
										</Badge>
									</td>
									<td class="py-3 pr-3">
										<div class="font-medium">{row.accountName}</div>
										<div class="text-xs text-muted-foreground">{row.externalAccountId}</div>
									</td>
									<td class="py-3 pr-3">
										{#if row.clientId}
											<a
												href="/{tenantSlug}/clients/{row.clientId}"
												class="text-primary hover:underline"
											>
												{row.clientName ?? 'Client'}
											</a>
											{#if row.clientEmail}
												<div class="text-xs text-muted-foreground">{row.clientEmail}</div>
											{/if}
										{:else}
											<span class="text-xs text-muted-foreground">Neasignat</span>
										{/if}
									</td>
									<td class="py-3 pr-3">
										<Badge class={statusStyles[row.paymentStatus]}>
											<TriangleAlertIcon class="mr-1 size-3" />
											{row.statusLabel}
										</Badge>
									</td>
									<td class="py-3 pr-3">
										<code class="rounded bg-muted px-1.5 py-0.5 text-xs">
											{row.rawStatusCode || '—'}
										</code>
										{#if row.rawDisableReason}
											<div class="text-xs text-muted-foreground">
												reason: {row.rawDisableReason}
											</div>
										{/if}
										{#if row.provider === 'tiktok'}
											{#if row.rawSubStatus}
												<div class="text-xs text-muted-foreground">
													sub: <code>{row.rawSubStatus}</code>
												</div>
											{/if}
											{#if row.rawDisplayStatus && row.rawDisplayStatus !== row.rawStatusCode}
												<div class="text-xs text-muted-foreground">
													display: <code>{row.rawDisplayStatus}</code>
												</div>
											{/if}
											{#if row.rawRejectReason}
												<div class="text-xs text-muted-foreground">
													reject: <code>{row.rawRejectReason}</code>
												</div>
											{/if}
											{#if row.rawDeliveryIssue && row.rawDeliveryIssue !== 'none'}
												<div class="text-xs text-amber-700 dark:text-amber-300">
													delivery: {row.rawDeliveryIssue}
												</div>
											{/if}
										{/if}
										{#if row.provider === 'google' && row.googleSuspensionReasons && row.googleSuspensionReasons.length > 0}
											<div class="text-xs text-muted-foreground">
												suspension: <code>{row.googleSuspensionReasons.join(', ')}</code>
											</div>
										{/if}
									</td>
									<td class="py-3 pr-3 text-xs text-muted-foreground">
										{formatCheckedAt(row.checkedAt)}
									</td>
									<td class="py-3 pr-3">
										<div class="flex items-center gap-2">
											<Switch
												checked={!row.isMuted}
												onCheckedChange={() => handleToggleMute(row)}
												aria-label={row.isMuted ? 'Reactivează alertele' : 'Ignoră alertele'}
											/>
											<span class="text-xs text-muted-foreground">
												{row.isMuted ? 'Ignorat' : 'Activ'}
											</span>
										</div>
									</td>
									<td class="py-3">
										<a
											href={row.billingUrl}
											target="_blank"
											rel="noopener noreferrer"
											class="inline-flex items-center gap-1 text-xs text-primary hover:underline"
										>
											<ExternalLinkIcon class="size-3" />
											Billing
										</a>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</CardContent>
	</Card>
</div>
