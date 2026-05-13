<script lang="ts">
	import { getAvailableHostingPackages } from '$lib/remotes/portal-hosting.remote';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { page } from '$app/state';
	import PackageIcon from '@lucide/svelte/icons/package';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import CheckIcon from '@lucide/svelte/icons/check';
	import HardDriveIcon from '@lucide/svelte/icons/hard-drive';
	import ActivityIcon from '@lucide/svelte/icons/activity';
	import MailIcon from '@lucide/svelte/icons/mail';
	import DatabaseIcon from '@lucide/svelte/icons/database';
	import GlobeIcon from '@lucide/svelte/icons/globe';

	const packagesQuery = getAvailableHostingPackages();
	const packages = $derived(packagesQuery.current?.packages ?? []);
	const vatRate = $derived(packagesQuery.current?.vatRate ?? 21);
	const loading = $derived(packagesQuery.loading && !packagesQuery.current);
	const tenantSlug = $derived(page.params.tenant);

	function priceWithVat(netCents: number): number {
		// vatRate stocat ca procent integer (21 = 21%)
		return Math.round(netCents * (1 + vatRate / 100));
	}

	function billingCycleLabel(cycle: string): string {
		switch (cycle) {
			case 'monthly':
				return 'lunar';
			case 'quarterly':
				return 'trimestrial';
			case 'semiannually':
			case 'biannually':
				return 'semestrial';
			case 'annually':
				return 'anual';
			case 'triennially':
				return 'la 3 ani';
			case 'one_time':
				return 'plată unică';
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

	function fmtLimit(value: number | null | undefined, unit?: string): string {
		if (value === null || value === undefined) return 'Nelimitat';
		const formatted = value.toLocaleString('ro-RO');
		return unit ? `${formatted} ${unit}` : formatted;
	}

	function hasLimits(p: {
		quota: number | null;
		bandwidth: number | null;
		maxEmailAccounts: number | null;
		maxDatabases: number | null;
		maxDomains: number | null;
		maxSubdomains: number | null;
	}): boolean {
		return (
			p.quota !== null ||
			p.bandwidth !== null ||
			p.maxEmailAccounts !== null ||
			p.maxDatabases !== null ||
			p.maxDomains !== null ||
			p.maxSubdomains !== null
		);
	}

	// Track which package cards have "Vezi mai mult" expanded
	let expandedIds = $state(new Set<string>());
	function toggleExpand(id: string) {
		if (expandedIds.has(id)) expandedIds.delete(id);
		else expandedIds.add(id);
		expandedIds = new Set(expandedIds);
	}
</script>

<div class="space-y-6">
	<Button variant="ghost" size="sm" href="/client/{tenantSlug}/hosting">
		<ArrowLeftIcon class="h-4 w-4" />
		Înapoi
	</Button>

	<div>
		<h1 class="text-2xl font-bold flex items-center gap-2">
			<PackageIcon class="h-6 w-6" />
			Pachete hosting disponibile
		</h1>
		<p class="text-muted-foreground">
			Lista pachetelor active. Toate prețurile sunt afișate <strong>fără TVA</strong>; TVA {vatRate}% se adaugă la checkout.
		</p>
	</div>

	{#if loading}
		<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{#each Array(3) as _}
				<Card class="animate-pulse">
					<CardHeader><div class="h-6 w-32 bg-muted rounded"></div></CardHeader>
					<CardContent><div class="h-40 bg-muted rounded"></div></CardContent>
				</Card>
			{/each}
		</div>
	{:else if packages.length === 0}
		<Card>
			<CardContent class="py-10 text-center text-muted-foreground">
				Nu există pachete configurate momentan.
			</CardContent>
		</Card>
	{:else}
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each packages as pkg (pkg.id)}
				<Card class="relative {pkg.highlightBadge ? 'border-primary/40 shadow-md' : ''}">
					{#if pkg.highlightBadge}
						<div
							class="absolute -top-2 right-4 rounded-full bg-primary px-3 py-0.5 text-xs font-medium text-primary-foreground"
						>
							{pkg.highlightBadge}
						</div>
					{/if}
					<CardHeader>
						<CardTitle>{pkg.name}</CardTitle>
						{#if pkg.description}
							<p class="text-sm text-muted-foreground">{pkg.description}</p>
						{/if}
					</CardHeader>
					<CardContent class="space-y-4">
						<div>
							<p class="text-2xl font-bold">{fmtPrice(pkg.price, pkg.currency)}</p>
							<p class="text-xs text-muted-foreground">
								{billingCycleLabel(pkg.billingCycle)}
								{#if pkg.setupFee && pkg.setupFee > 0}
									· instalare {fmtPrice(pkg.setupFee, pkg.currency)}
								{/if}
							</p>
							<p class="text-xs text-muted-foreground/80 mt-0.5">
								Preț fără TVA · cu TVA {vatRate}%: <strong>{fmtPrice(priceWithVat(pkg.price), pkg.currency)}</strong>
							</p>
						</div>

						{#if hasLimits(pkg)}
							<div class="space-y-1.5 rounded-md bg-muted/40 p-3 text-sm">
								{#if pkg.quota !== null}
									<div class="flex items-center gap-2">
										<HardDriveIcon class="h-4 w-4 text-muted-foreground shrink-0" />
										<span>Spațiu: <strong>{fmtLimit(pkg.quota, 'MB')}</strong></span>
									</div>
								{/if}
								{#if pkg.bandwidth !== null}
									<div class="flex items-center gap-2">
										<ActivityIcon class="h-4 w-4 text-muted-foreground shrink-0" />
										<span>Trafic: <strong>{fmtLimit(pkg.bandwidth, 'MB')}/lună</strong></span>
									</div>
								{/if}
								{#if pkg.maxEmailAccounts !== null}
									<div class="flex items-center gap-2">
										<MailIcon class="h-4 w-4 text-muted-foreground shrink-0" />
										<span>Conturi email: <strong>{fmtLimit(pkg.maxEmailAccounts)}</strong></span>
									</div>
								{/if}
								{#if pkg.maxDatabases !== null}
									<div class="flex items-center gap-2">
										<DatabaseIcon class="h-4 w-4 text-muted-foreground shrink-0" />
										<span>Baze de date: <strong>{fmtLimit(pkg.maxDatabases)}</strong></span>
									</div>
								{/if}
								{#if pkg.maxDomains !== null}
									<div class="flex items-center gap-2">
										<GlobeIcon class="h-4 w-4 text-muted-foreground shrink-0" />
										<span>Domenii: <strong>{fmtLimit(pkg.maxDomains)}</strong></span>
									</div>
								{/if}
							</div>
						{/if}

						{#if pkg.features && pkg.features.length > 0}
							<ul class="space-y-1.5 text-sm">
								{#each pkg.features as feat}
									<li class="flex items-start gap-2">
										<CheckIcon class="h-4 w-4 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
										<span>{feat}</span>
									</li>
								{/each}
							</ul>
						{/if}

						<!-- Toggle "Vezi mai mult" — afișează limits extra + flag-uri tehnice -->
						{#if hasLimits(pkg)}
							<button
								type="button"
								onclick={() => toggleExpand(pkg.id)}
								class="w-full text-sm text-primary hover:underline text-left"
							>
								{expandedIds.has(pkg.id) ? '↑ Mai puțin' : '↓ Vezi mai mult'}
							</button>

							{#if expandedIds.has(pkg.id)}
								<div class="space-y-3 rounded-md border bg-background p-3 text-sm">
									<!-- Limits suplimentare -->
									<div class="grid grid-cols-2 gap-2 text-xs">
										{#if pkg.maxSubdomains !== null}
											<div class="text-muted-foreground">
												Subdomenii: <strong class="text-foreground">{fmtLimit(pkg.maxSubdomains)}</strong>
											</div>
										{/if}
										{#if pkg.maxFtpAccounts !== null}
											<div class="text-muted-foreground">
												Conturi FTP: <strong class="text-foreground">{fmtLimit(pkg.maxFtpAccounts)}</strong>
											</div>
										{/if}
										{#if pkg.maxEmailForwarders !== null}
											<div class="text-muted-foreground">
												Redirecționări email: <strong class="text-foreground">{fmtLimit(pkg.maxEmailForwarders)}</strong>
											</div>
										{/if}
										{#if pkg.maxMailingLists !== null}
											<div class="text-muted-foreground">
												Liste mailing: <strong class="text-foreground">{fmtLimit(pkg.maxMailingLists)}</strong>
											</div>
										{/if}
										{#if pkg.maxAutoresponders !== null}
											<div class="text-muted-foreground">
												Autoresponders: <strong class="text-foreground">{fmtLimit(pkg.maxAutoresponders)}</strong>
											</div>
										{/if}
										{#if pkg.maxInodes !== null}
											<div class="text-muted-foreground">
												Inode: <strong class="text-foreground">{fmtLimit(pkg.maxInodes)}</strong>
											</div>
										{/if}
									</div>

									<!-- Flag-uri tehnice -->
									<div class="flex flex-wrap gap-1 text-xs">
										{#each [['SSL', pkg.ssl], ['SSH', pkg.ssh], ['Cron', pkg.cron], ['PHP', pkg.php], ['WordPress', pkg.wordpress], ['Git', pkg.git], ['ClamAV', pkg.clamav], ['SpamAssassin', pkg.spam], ['Redis', pkg.redis], ['DNS Control', pkg.dnsControl]] as [label, enabled]}
											{#if enabled}
												<span class="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-green-700 dark:bg-green-900/20 dark:text-green-300">
													<CheckIcon class="h-3 w-3" />
													{label}
												</span>
											{/if}
										{/each}
									</div>
								</div>
							{/if}
						{/if}
					</CardContent>
				</Card>
			{/each}
		</div>
	{/if}

	<Card class="border-muted bg-muted/30">
		<CardContent class="py-4 text-sm text-muted-foreground">
			Pentru detalii suplimentare sau achiziție, contactează-ne la
			<a href="mailto:office@onetopsolution.ro" class="underline">office@onetopsolution.ro</a>.
		</CardContent>
	</Card>
</div>
