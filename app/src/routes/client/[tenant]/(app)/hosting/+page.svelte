<script lang="ts">
	import { getMyHostingAccounts } from '$lib/remotes/portal-hosting.remote';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { page } from '$app/state';
	import ServerIcon from '@lucide/svelte/icons/server';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import CalendarIcon from '@lucide/svelte/icons/calendar-days';

	const accountsQuery = getMyHostingAccounts();
	const accounts = $derived(accountsQuery.current ?? []);
	const loading = $derived(accountsQuery.loading && !accountsQuery.current);
	const tenantSlug = $derived(page.params.tenant);

	function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
		if (status === 'active') return 'default';
		if (status === 'suspended') return 'destructive';
		if (status === 'terminated' || status === 'cancelled') return 'outline';
		return 'secondary';
	}

	function statusLabel(status: string): string {
		switch (status) {
			case 'active':
				return 'Activ';
			case 'suspended':
				return 'Suspendat';
			case 'terminated':
				return 'Terminat';
			case 'cancelled':
				return 'Anulat';
			case 'pending':
				return 'În așteptare';
			default:
				return status;
		}
	}

	function billingCycleLabel(cycle: string): string {
		switch (cycle) {
			case 'monthly':
				return 'lunar';
			case 'quarterly':
				return 'trimestrial';
			case 'semiannually':
				return 'semestrial';
			case 'annually':
				return 'anual';
			case 'biennially':
				return 'la 2 ani';
			case 'triennially':
				return 'la 3 ani';
			case 'one_time':
				return 'unic';
			default:
				return cycle;
		}
	}

	function fmtPrice(cents: number, currency: string): string {
		const value = (cents / 100).toLocaleString('ro-RO', {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2
		});
		return `${value} ${currency}`;
	}

	function fmtDate(iso: string | null): string {
		if (!iso) return '—';
		try {
			return new Date(iso).toLocaleDateString('ro-RO');
		} catch {
			return iso;
		}
	}
</script>

<div class="space-y-6">
	<div class="flex items-start justify-between gap-4">
		<div>
			<h1 class="text-2xl font-bold flex items-center gap-2">
				<ServerIcon class="h-6 w-6" />
				Hosting
			</h1>
			<p class="text-muted-foreground">Conturile tale de găzduire web și pachetele disponibile.</p>
		</div>
		<Button variant="outline" href="/client/{tenantSlug}/hosting/packages">Vezi pachete</Button>
	</div>

	{#if loading}
		<div class="space-y-3">
			{#each Array(2) as _}
				<Card class="animate-pulse">
					<CardHeader><div class="h-6 w-48 bg-muted rounded"></div></CardHeader>
					<CardContent><div class="h-16 bg-muted rounded"></div></CardContent>
				</Card>
			{/each}
		</div>
	{:else if accounts.length === 0}
		<Card>
			<CardContent class="py-10 text-center text-muted-foreground">
				Nu există niciun cont de hosting asociat companiei tale. Contactează-ne dacă vrei să
				achiziționezi unul.
			</CardContent>
		</Card>
	{:else}
		<div class="grid gap-3">
			{#each accounts as account (account.id)}
				<Card>
					<CardHeader class="flex flex-row items-start justify-between gap-3">
						<div class="min-w-0">
							<CardTitle class="flex items-center gap-2 truncate">
								<GlobeIcon class="h-4 w-4 shrink-0" />
								<span class="truncate">{account.domain}</span>
							</CardTitle>
							{#if account.daPackageName}
								<p class="text-xs text-muted-foreground mt-1">Pachet: {account.daPackageName}</p>
							{/if}
						</div>
						<Badge variant={statusVariant(account.status)}>{statusLabel(account.status)}</Badge>
					</CardHeader>
					<CardContent class="space-y-2 text-sm">
						<div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
							<div>
								<p class="text-xs text-muted-foreground">Preț</p>
								<p class="font-medium">
									{fmtPrice(account.recurringAmount, account.currency)}
									<span class="text-xs text-muted-foreground"
										>/ {billingCycleLabel(account.billingCycle)}</span
									>
								</p>
							</div>
							<div>
								<p class="text-xs text-muted-foreground">Următoarea scadență</p>
								<p class="font-medium flex items-center gap-1">
									<CalendarIcon class="h-3 w-3" />
									{fmtDate(account.nextDueDate)}
								</p>
							</div>
							<div>
								<p class="text-xs text-muted-foreground">Pornit</p>
								<p class="font-medium">{fmtDate(account.startDate)}</p>
							</div>
						</div>
						<div class="pt-2">
							<Button
								variant="link"
								size="sm"
								class="p-0 h-auto"
								href="/client/{tenantSlug}/hosting/accounts/{account.id}"
							>
								Vezi detalii →
							</Button>
						</div>
					</CardContent>
				</Card>
			{/each}
		</div>
	{/if}
</div>
