<script lang="ts">
	import { getMyHostingAccount } from '$lib/remotes/portal-hosting.remote';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { page } from '$app/state';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import HardDriveIcon from '@lucide/svelte/icons/hard-drive';
	import WifiIcon from '@lucide/svelte/icons/wifi';
	import MailIcon from '@lucide/svelte/icons/mail';
	import DatabaseIcon from '@lucide/svelte/icons/database';

	const accountId = $derived(page.params.accountId);
	const tenantSlug = $derived(page.params.tenant);

	let accountQuery = $state<ReturnType<typeof getMyHostingAccount> | null>(null);
	$effect(() => {
		if (accountId) {
			accountQuery = getMyHostingAccount(accountId);
		}
	});
	const account = $derived(accountQuery?.current);
	const loading = $derived(accountQuery?.loading && !account);
	const error = $derived(accountQuery?.error);

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

	function fmtBytes(value: number | null, unit = 'MB'): string {
		if (value === null || value === undefined) return '—';
		return `${value.toLocaleString('ro-RO')} ${unit}`;
	}
</script>

<div class="space-y-6">
	<Button variant="ghost" size="sm" href="/client/{tenantSlug}/hosting">
		<ArrowLeftIcon class="h-4 w-4" />
		Înapoi la conturi
	</Button>

	{#if loading}
		<Card class="animate-pulse">
			<CardHeader><div class="h-7 w-64 bg-muted rounded"></div></CardHeader>
			<CardContent><div class="h-40 bg-muted rounded"></div></CardContent>
		</Card>
	{:else if error || !account}
		<Card>
			<CardContent class="py-10 text-center text-muted-foreground">
				Contul nu a putut fi încărcat sau nu îți aparține.
			</CardContent>
		</Card>
	{:else}
		<div class="flex items-start justify-between gap-4">
			<div>
				<h1 class="text-2xl font-bold flex items-center gap-2">
					<GlobeIcon class="h-6 w-6" />
					{account.domain}
				</h1>
				{#if account.daPackageName}
					<p class="text-muted-foreground">Pachet: {account.daPackageName}</p>
				{/if}
			</div>
			<Badge variant={statusVariant(account.status)} class="text-sm">{statusLabel(account.status)}</Badge>
		</div>

		{#if account.status === 'suspended' && account.suspendReason}
			<Card class="border-destructive/30 bg-destructive/5">
				<CardContent class="py-3 text-sm">
					<p class="font-medium text-destructive">Cont suspendat</p>
					<p class="text-muted-foreground mt-1">
						{#if account.suspendReason.startsWith('Overdue invoice')}
							Factură restantă. Achită factura din lista de facturi pentru reactivare automată.
						{:else}
							Motiv: {account.suspendReason}
						{/if}
					</p>
				</CardContent>
			</Card>
		{/if}

		<Card>
			<CardHeader><CardTitle>Detalii facturare</CardTitle></CardHeader>
			<CardContent class="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
				<div>
					<p class="text-xs text-muted-foreground">Preț</p>
					<p class="font-medium">
						{fmtPrice(account.recurringAmount, account.currency)}
						<span class="text-xs text-muted-foreground">/ {billingCycleLabel(account.billingCycle)}</span>
					</p>
				</div>
				<div>
					<p class="text-xs text-muted-foreground">Următoarea scadență</p>
					<p class="font-medium">{fmtDate(account.nextDueDate)}</p>
				</div>
				<div>
					<p class="text-xs text-muted-foreground">Activ din</p>
					<p class="font-medium">{fmtDate(account.startDate)}</p>
				</div>
			</CardContent>
		</Card>

		<Card>
			<CardHeader><CardTitle>Utilizare resurse</CardTitle></CardHeader>
			<CardContent class="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
				<div class="flex items-center gap-2">
					<HardDriveIcon class="h-4 w-4 text-muted-foreground" />
					<div>
						<p class="text-xs text-muted-foreground">Spațiu</p>
						<p class="font-medium">{fmtBytes(account.diskUsage)}</p>
					</div>
				</div>
				<div class="flex items-center gap-2">
					<WifiIcon class="h-4 w-4 text-muted-foreground" />
					<div>
						<p class="text-xs text-muted-foreground">Trafic</p>
						<p class="font-medium">{fmtBytes(account.bandwidthUsage)}</p>
					</div>
				</div>
				<div class="flex items-center gap-2">
					<MailIcon class="h-4 w-4 text-muted-foreground" />
					<div>
						<p class="text-xs text-muted-foreground">Email</p>
						<p class="font-medium">{account.emailCount ?? '—'}</p>
					</div>
				</div>
				<div class="flex items-center gap-2">
					<DatabaseIcon class="h-4 w-4 text-muted-foreground" />
					<div>
						<p class="text-xs text-muted-foreground">Baze de date</p>
						<p class="font-medium">{account.dbCount ?? '—'}</p>
					</div>
				</div>
			</CardContent>
			{#if account.lastSyncedAt}
				<CardContent class="text-xs text-muted-foreground pt-0">
					Ultima sincronizare: {fmtDate(account.lastSyncedAt)}
				</CardContent>
			{/if}
		</Card>

		{#if account.additionalDomains && account.additionalDomains.length > 0}
			<Card>
				<CardHeader><CardTitle>Domenii adiționale</CardTitle></CardHeader>
				<CardContent>
					<ul class="list-disc pl-5 text-sm space-y-1">
						{#each account.additionalDomains as domain}
							<li>{domain}</li>
						{/each}
					</ul>
				</CardContent>
			</Card>
		{/if}

		<Card class="border-muted bg-muted/30">
			<CardContent class="py-4 text-sm text-muted-foreground">
				Pentru upgrade-uri de pachet, schimbări de domeniu sau alte modificări, contactează echipa
				One Top Solution la <a href="mailto:office@onetopsolution.ro" class="underline"
					>office@onetopsolution.ro</a
				>.
			</CardContent>
		</Card>
	{/if}
</div>
