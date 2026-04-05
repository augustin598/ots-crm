<script lang="ts">
	import { getClientAccountBudgets, updateAccountBudget } from '$lib/remotes/budget.remote';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import WalletIcon from '@lucide/svelte/icons/wallet';
	import CalendarIcon from '@lucide/svelte/icons/calendar-days';
	import TargetIcon from '@lucide/svelte/icons/target';
	import PiggyBankIcon from '@lucide/svelte/icons/piggy-bank';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import AlertTriangleIcon from '@lucide/svelte/icons/triangle-alert';
	import CheckCircleIcon from '@lucide/svelte/icons/circle-check';
	import IconFacebook from '$lib/components/marketing/icon-facebook.svelte';
	import IconTiktok from '$lib/components/marketing/icon-tiktok.svelte';
	import IconGoogleAds from '$lib/components/marketing/icon-google-ads.svelte';

	const clientId = $derived((page.data as any)?.client?.id as string);

	// Lazy query — only fetches when clientId is available
	let budgetQuery = $state<ReturnType<typeof getClientAccountBudgets> | null>(null);
	$effect(() => {
		if (clientId) {
			budgetQuery = getClientAccountBudgets({ clientId });
		}
	});
	const data = $derived(budgetQuery?.current);
	const loading = $derived(budgetQuery?.loading && !data);

	// Track editing state per account
	let editingId = $state<string | null>(null);
	let editValue = $state<number | null>(null);
	let saving = $state(false);

	function startEdit(accountId: string, currentBudget: number | null) {
		editingId = accountId;
		editValue = currentBudget;
	}

	function cancelEdit() {
		editingId = null;
		editValue = null;
	}

	async function saveBudget(accountId: string, platform: 'meta' | 'tiktok' | 'google', accountName: string) {
		saving = true;
		try {
			await updateAccountBudget({
				clientId,
				platform,
				adsAccountId: accountId,
				monthlyBudget: editValue && editValue > 0 ? editValue : null
			});
			toast.success(`Bugetul pentru ${accountName} a fost salvat.`);
			editingId = null;
			editValue = null;
			// Re-fetch only budget data, not the entire page
			budgetQuery = getClientAccountBudgets({ clientId });
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la salvare.');
		} finally {
			saving = false;
		}
	}

	function budgetColor(pct: number) {
		if (pct >= 100) return { bar: 'budget-bar-red', text: 'text-destructive font-bold' };
		if (pct >= 75) return { bar: 'budget-bar-yellow', text: 'text-yellow-600 dark:text-yellow-400 font-semibold' };
		return { bar: '', text: '' };
	}

	// Totals — computed once, not as a function called multiple times
	const allAccounts = $derived.by(() => {
		if (!data) return [];
		return [
			...data.meta.map(a => ({ ...a, platform: 'meta' as const })),
			...data.tiktok.map(a => ({ ...a, platform: 'tiktok' as const })),
			...data.google.map(a => ({ ...a, platform: 'google' as const }))
		];
	});
	const totalBudget = $derived(allAccounts.reduce((s, a) => s + (a.monthlyBudget || 0), 0));
	const totalSpend = $derived(allAccounts.reduce((s, a) => s + a.spendAmount, 0));

	// Daily pacing — constants computed once
	const now = new Date();
	const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
	const dayOfMonth = now.getDate();
	const daysRemaining = daysInMonth - dayOfMonth;

	// Pre-computed daily info for total (avoid recalculating in template)
	const totalDaily = $derived.by(() => dailyInfo(totalBudget, totalSpend));

	function dailyInfo(budget: number | null, spend: number) {
		if (!budget || budget <= 0) return null;
		const dailyBudget = budget / daysInMonth;
		const expectedSpend = dailyBudget * dayOfMonth;
		const remainingBudget = Math.max(budget - spend, 0);
		const dailyRemaining = daysRemaining > 0 ? remainingBudget / daysRemaining : 0;
		const currentDailyAvg = dayOfMonth > 0 ? spend / dayOfMonth : 0;
		const projectedSpend = spend + (currentDailyAvg * daysRemaining);
		const projectedPct = budget > 0 ? Math.round((projectedSpend / budget) * 100) : 0;
		const overBudget = projectedSpend > budget;
		const reduction = overBudget && daysRemaining > 0 ? currentDailyAvg - dailyRemaining : 0;
		const pacing = expectedSpend > 0 ? Math.round((spend / expectedSpend) * 100) : 0;
		return { dailyBudget, expectedSpend, remainingBudget, dailyRemaining, pacing, currentDailyAvg, projectedSpend, projectedPct, overBudget, reduction };
	}
</script>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold flex items-center gap-2">
			<WalletIcon class="h-6 w-6" />
			Bugete Ads
		</h1>
		<p class="text-muted-foreground">Bugetele lunare alocate pentru conturile de publicitate conectate.</p>
	</div>

	<!-- Total overview -->
	{#if totalBudget > 0}
		{@const totalPct = Math.round((totalSpend / totalBudget) * 100)}
		{@const colors = budgetColor(totalPct)}
		<Card>
			<CardContent class="pt-6 space-y-3">
				<div class="flex justify-between text-sm font-medium">
					<span>Total buget luna curentă</span>
					<span class={colors.text}>{totalSpend.toLocaleString('ro-RO')} / {totalBudget.toLocaleString('ro-RO')} RON ({totalPct}%)</span>
				</div>
				<div class="relative h-3 rounded-full overflow-hidden bg-muted {colors.bar}">
					<div
						class="absolute inset-y-0 left-0 rounded-full budget-bar-glow"
						style="width: {Math.min(totalPct, 100)}%"
					></div>
				</div>
				{#if totalDaily}
					<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
						<Tooltip.Root>
							<Tooltip.Trigger class="w-full text-left cursor-pointer">
								<div class="flex items-center gap-2 p-2 rounded-md bg-muted/50">
									<CalendarIcon class="h-4 w-4 text-primary shrink-0" />
									<div>
										<p class="text-xs text-muted-foreground">Buget/zi</p>
										<p class="text-sm font-semibold">{totalDaily.dailyBudget.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON</p>
									</div>
								</div>
							</Tooltip.Trigger>
							<Tooltip.Content>Bugetul lunar împărțit la {daysInMonth} zile ale lunii curente</Tooltip.Content>
						</Tooltip.Root>
						<Tooltip.Root>
							<Tooltip.Trigger class="w-full text-left cursor-pointer">
								<div class="flex items-center gap-2 p-2 rounded-md bg-muted/50">
									<TargetIcon class="h-4 w-4 text-blue-500 shrink-0" />
									<div>
										<p class="text-xs text-muted-foreground">Așteptat (ziua {dayOfMonth})</p>
										<p class="text-sm font-semibold">{totalDaily.expectedSpend.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON</p>
									</div>
								</div>
							</Tooltip.Trigger>
							<Tooltip.Content>Cât ar fi trebuit consumat până azi la un ritm constant de cheltuieli</Tooltip.Content>
						</Tooltip.Root>
						<Tooltip.Root>
							<Tooltip.Trigger class="w-full text-left cursor-pointer">
								<div class="flex items-center gap-2 p-2 rounded-md bg-muted/50">
									<PiggyBankIcon class="h-4 w-4 text-green-500 shrink-0" />
									<div>
										<p class="text-xs text-muted-foreground">Rămas de cheltuit</p>
										<p class="text-sm font-semibold">{totalDaily.remainingBudget.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON</p>
									</div>
								</div>
							</Tooltip.Trigger>
							<Tooltip.Content>Diferența dintre bugetul total și suma consumată până acum</Tooltip.Content>
						</Tooltip.Root>
						<Tooltip.Root>
							<Tooltip.Trigger class="w-full text-left cursor-pointer">
								<div class="flex items-center gap-2 p-2 rounded-md bg-muted/50">
									<TrendingUpIcon class="h-4 w-4 text-orange-500 shrink-0" />
									<div>
										<p class="text-xs text-muted-foreground">Necesar/zi ({daysRemaining} zile)</p>
										<p class="text-sm font-semibold">{totalDaily.dailyRemaining.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON</p>
									</div>
								</div>
							</Tooltip.Trigger>
							<Tooltip.Content>Suma necesară pe zi în cele {daysRemaining} zile rămase pentru a atinge bugetul</Tooltip.Content>
						</Tooltip.Root>
					</div>
				{/if}
				{#if totalDaily}
					{@const td = totalDaily}
					<div class="mt-1 rounded-md p-2 text-xs {td.overBudget ? 'bg-destructive/10 border border-destructive/20' : 'bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800'}">
						<div class="flex items-start gap-2">
							{#if td.overBudget}
								<AlertTriangleIcon class="h-4 w-4 text-destructive shrink-0 mt-0.5" />
								<div>
									<p class="font-medium text-destructive">
										Proiecție totală: {td.projectedSpend.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON ({td.projectedPct}% din buget)
									</p>
									<p class="text-muted-foreground mt-0.5">
										Media curentă: {td.currentDailyAvg.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON/zi.
										Reduce la {td.dailyRemaining.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON/zi
										(−{td.reduction.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON/zi) pentru a te încadra în buget.
									</p>
								</div>
							{:else}
								<CheckCircleIcon class="h-4 w-4 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
								<p class="font-medium text-green-700 dark:text-green-300">
									Proiecție totală: {td.projectedSpend.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON ({td.projectedPct}% din buget) — Pe drumul bun
								</p>
							{/if}
						</div>
					</div>
				{/if}
			</CardContent>
		</Card>
	{/if}

	{#if loading}
		<div class="space-y-4">
			{#each Array(2) as _}
				<Card class="animate-pulse">
					<CardHeader><div class="h-6 w-32 bg-muted rounded"></div></CardHeader>
					<CardContent><div class="h-20 bg-muted rounded"></div></CardContent>
				</Card>
			{/each}
		</div>
	{:else if data}
		<!-- Meta Ads -->
		{#if data.meta.length > 0}
			<Card>
				<CardHeader>
					<CardTitle class="flex items-center gap-2 text-blue-600">
						<IconFacebook class="h-5 w-5" />
						Meta Ads (Facebook)
					</CardTitle>
				</CardHeader>
				<CardContent class="space-y-3">
					{#each data.meta as account (account.id)}
						{@const pct = account.monthlyBudget && account.monthlyBudget > 0 ? Math.round((account.spendAmount / account.monthlyBudget) * 100) : 0}
						{@const colors = budgetColor(pct)}
						<div class="rounded-lg border p-4 space-y-3">
							<div class="flex items-center justify-between gap-4">
								<div class="min-w-0">
									<h4 class="font-medium truncate">{account.accountName}</h4>
									<p class="text-xs text-muted-foreground">ID: {account.metaAdAccountId}</p>
								</div>
								{#if editingId === account.id}
									<div class="flex items-center gap-2 shrink-0">
										<Input
											type="number"
											min="0"
											step="100"
											placeholder="Buget (RON)"
											bind:value={editValue}
											class="h-8 w-32"
										/>
										<Button size="sm" onclick={() => saveBudget(account.id, 'meta', account.accountName)} disabled={saving}>
											{saving ? '...' : 'Salvează'}
										</Button>
										<Button size="sm" variant="outline" class="cursor-pointer" onclick={cancelEdit}>Anulează</Button>
									</div>
								{:else}
									<Button size="sm" variant="outline" class="cursor-pointer" onclick={() => startEdit(account.id, account.monthlyBudget)}>
										{account.monthlyBudget ? 'Modifică' : 'Setează buget'}
									</Button>
								{/if}
							</div>
							{#if account.monthlyBudget && account.monthlyBudget > 0}
								<div class="space-y-1.5">
									<div class="flex justify-between text-xs">
										<span class={colors.text}>
											Consumat: {account.spendAmount.toLocaleString('ro-RO')} / {account.monthlyBudget.toLocaleString('ro-RO')} RON
										</span>
										<span class={colors.text}>{pct}%</span>
									</div>
									<div class="relative h-2 rounded-full overflow-hidden bg-muted {colors.bar}">
									<div
										class="absolute inset-y-0 left-0 rounded-full budget-bar-glow"
										style="width: {Math.min(pct, 100)}%"
									></div>
								</div>
								{#if dailyInfo(account.monthlyBudget, account.spendAmount)}
									{@const daily = dailyInfo(account.monthlyBudget, account.spendAmount)!}
									<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1">
										<Tooltip.Root>
											<Tooltip.Trigger><span class="inline-flex items-center gap-1 cursor-pointer"><CalendarIcon class="h-3 w-3" />{daily.dailyBudget.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON/zi</span></Tooltip.Trigger>
											<Tooltip.Content>Bugetul lunar împărțit la {daysInMonth} zile</Tooltip.Content>
										</Tooltip.Root>
										<Tooltip.Root>
											<Tooltip.Trigger><span class="inline-flex items-center gap-1 cursor-pointer"><TargetIcon class="h-3 w-3" />Așteptat: {daily.expectedSpend.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON</span></Tooltip.Trigger>
											<Tooltip.Content>Consumul așteptat până în ziua {dayOfMonth} la ritm constant</Tooltip.Content>
										</Tooltip.Root>
										<Tooltip.Root>
											<Tooltip.Trigger><span class="inline-flex items-center gap-1 cursor-pointer"><PiggyBankIcon class="h-3 w-3" />Rămas: {daily.remainingBudget.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON</span></Tooltip.Trigger>
											<Tooltip.Content>Diferența dintre buget și suma consumată</Tooltip.Content>
										</Tooltip.Root>
										<Tooltip.Root>
											<Tooltip.Trigger><span class="inline-flex items-center gap-1 cursor-pointer"><TrendingUpIcon class="h-3 w-3" />{daily.dailyRemaining.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON/zi</span></Tooltip.Trigger>
											<Tooltip.Content>Necesar pe zi în cele {daysRemaining} zile rămase</Tooltip.Content>
										</Tooltip.Root>
									</div>
									<!-- Proiecție & Recomandare -->
									<div class="mt-2 rounded-md p-2 text-xs {daily.overBudget ? 'bg-destructive/10 border border-destructive/20' : 'bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800'}">
										<div class="flex items-start gap-2">
											{#if daily.overBudget}
												<AlertTriangleIcon class="h-4 w-4 text-destructive shrink-0 mt-0.5" />
												<div>
													<p class="font-medium text-destructive">
														Proiecție: {daily.projectedSpend.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON ({daily.projectedPct}% din buget)
													</p>
													<p class="text-muted-foreground mt-0.5">
														Media curentă: {daily.currentDailyAvg.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON/zi.
														Reduce la {daily.dailyRemaining.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON/zi
														(−{daily.reduction.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON/zi) pentru a te încadra în buget.
													</p>
												</div>
											{:else}
												<CheckCircleIcon class="h-4 w-4 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
												<div>
													<p class="font-medium text-green-700 dark:text-green-300">
														Proiecție: {daily.projectedSpend.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON ({daily.projectedPct}% din buget) — Pe drumul bun
													</p>
												</div>
											{/if}
										</div>
									</div>
								{/if}
								</div>
							{:else}
								<p class="text-xs text-muted-foreground italic">Niciun buget setat.</p>
							{/if}
						</div>
					{/each}
				</CardContent>
			</Card>
		{/if}

		<!-- TikTok Ads -->
		{#if data.tiktok.length > 0}
			<Card>
				<CardHeader>
					<CardTitle class="flex items-center gap-2 text-pink-600">
						<IconTiktok class="h-5 w-5" />
						TikTok Ads
					</CardTitle>
				</CardHeader>
				<CardContent class="space-y-3">
					{#each data.tiktok as account (account.id)}
						{@const pct = account.monthlyBudget && account.monthlyBudget > 0 ? Math.round((account.spendAmount / account.monthlyBudget) * 100) : 0}
						{@const colors = budgetColor(pct)}
						<div class="rounded-lg border p-4 space-y-3">
							<div class="flex items-center justify-between gap-4">
								<div class="min-w-0">
									<h4 class="font-medium truncate">{account.accountName}</h4>
									<p class="text-xs text-muted-foreground">ID: {account.tiktokAdvertiserId}</p>
								</div>
								{#if editingId === account.id}
									<div class="flex items-center gap-2 shrink-0">
										<Input
											type="number"
											min="0"
											step="100"
											placeholder="Buget (RON)"
											bind:value={editValue}
											class="h-8 w-32"
										/>
										<Button size="sm" onclick={() => saveBudget(account.id, 'tiktok', account.accountName)} disabled={saving}>
											{saving ? '...' : 'Salvează'}
										</Button>
										<Button size="sm" variant="outline" class="cursor-pointer" onclick={cancelEdit}>Anulează</Button>
									</div>
								{:else}
									<Button size="sm" variant="outline" class="cursor-pointer" onclick={() => startEdit(account.id, account.monthlyBudget)}>
										{account.monthlyBudget ? 'Modifică' : 'Setează buget'}
									</Button>
								{/if}
							</div>
							{#if account.monthlyBudget && account.monthlyBudget > 0}
								<div class="space-y-1.5">
									<div class="flex justify-between text-xs">
										<span class={colors.text}>
											Consumat: {account.spendAmount.toLocaleString('ro-RO')} / {account.monthlyBudget.toLocaleString('ro-RO')} RON
										</span>
										<span class={colors.text}>{pct}%</span>
									</div>
									<div class="relative h-2 rounded-full overflow-hidden bg-muted {colors.bar}">
									<div
										class="absolute inset-y-0 left-0 rounded-full budget-bar-glow"
										style="width: {Math.min(pct, 100)}%"
									></div>
								</div>
								{#if dailyInfo(account.monthlyBudget, account.spendAmount)}
									{@const daily = dailyInfo(account.monthlyBudget, account.spendAmount)!}
									<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1">
										<Tooltip.Root>
											<Tooltip.Trigger><span class="inline-flex items-center gap-1 cursor-pointer"><CalendarIcon class="h-3 w-3" />{daily.dailyBudget.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON/zi</span></Tooltip.Trigger>
											<Tooltip.Content>Bugetul lunar împărțit la {daysInMonth} zile</Tooltip.Content>
										</Tooltip.Root>
										<Tooltip.Root>
											<Tooltip.Trigger><span class="inline-flex items-center gap-1 cursor-pointer"><TargetIcon class="h-3 w-3" />Așteptat: {daily.expectedSpend.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON</span></Tooltip.Trigger>
											<Tooltip.Content>Consumul așteptat până în ziua {dayOfMonth} la ritm constant</Tooltip.Content>
										</Tooltip.Root>
										<Tooltip.Root>
											<Tooltip.Trigger><span class="inline-flex items-center gap-1 cursor-pointer"><PiggyBankIcon class="h-3 w-3" />Rămas: {daily.remainingBudget.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON</span></Tooltip.Trigger>
											<Tooltip.Content>Diferența dintre buget și suma consumată</Tooltip.Content>
										</Tooltip.Root>
										<Tooltip.Root>
											<Tooltip.Trigger><span class="inline-flex items-center gap-1 cursor-pointer"><TrendingUpIcon class="h-3 w-3" />{daily.dailyRemaining.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON/zi</span></Tooltip.Trigger>
											<Tooltip.Content>Necesar pe zi în cele {daysRemaining} zile rămase</Tooltip.Content>
										</Tooltip.Root>
									</div>
									<!-- Proiecție & Recomandare -->
									<div class="mt-2 rounded-md p-2 text-xs {daily.overBudget ? 'bg-destructive/10 border border-destructive/20' : 'bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800'}">
										<div class="flex items-start gap-2">
											{#if daily.overBudget}
												<AlertTriangleIcon class="h-4 w-4 text-destructive shrink-0 mt-0.5" />
												<div>
													<p class="font-medium text-destructive">
														Proiecție: {daily.projectedSpend.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON ({daily.projectedPct}% din buget)
													</p>
													<p class="text-muted-foreground mt-0.5">
														Media curentă: {daily.currentDailyAvg.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON/zi.
														Reduce la {daily.dailyRemaining.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON/zi
														(−{daily.reduction.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON/zi) pentru a te încadra în buget.
													</p>
												</div>
											{:else}
												<CheckCircleIcon class="h-4 w-4 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
												<div>
													<p class="font-medium text-green-700 dark:text-green-300">
														Proiecție: {daily.projectedSpend.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON ({daily.projectedPct}% din buget) — Pe drumul bun
													</p>
												</div>
											{/if}
										</div>
									</div>
								{/if}
								</div>
							{:else}
								<p class="text-xs text-muted-foreground italic">Niciun buget setat.</p>
							{/if}
						</div>
					{/each}
				</CardContent>
			</Card>
		{/if}

		<!-- Google Ads -->
		{#if data.google.length > 0}
			<Card>
				<CardHeader>
					<CardTitle class="flex items-center gap-2">
						<IconGoogleAds class="h-5 w-5" />
						Google Ads
					</CardTitle>
				</CardHeader>
				<CardContent class="space-y-3">
					{#each data.google as account (account.id)}
						{@const pct = account.monthlyBudget && account.monthlyBudget > 0 ? Math.round((account.spendAmount / account.monthlyBudget) * 100) : 0}
						{@const colors = budgetColor(pct)}
						<div class="rounded-lg border p-4 space-y-3">
							<div class="flex items-center justify-between gap-4">
								<div class="min-w-0">
									<h4 class="font-medium truncate">{account.accountName}</h4>
									<p class="text-xs text-muted-foreground">ID: {account.googleAdsCustomerId}</p>
								</div>
								{#if editingId === account.id}
									<div class="flex items-center gap-2 shrink-0">
										<Input
											type="number"
											min="0"
											step="100"
											placeholder="Buget (RON)"
											bind:value={editValue}
											class="h-8 w-32"
										/>
										<Button size="sm" onclick={() => saveBudget(account.id, 'google', account.accountName)} disabled={saving}>
											{saving ? '...' : 'Salvează'}
										</Button>
										<Button size="sm" variant="outline" class="cursor-pointer" onclick={cancelEdit}>Anulează</Button>
									</div>
								{:else}
									<Button size="sm" variant="outline" class="cursor-pointer" onclick={() => startEdit(account.id, account.monthlyBudget)}>
										{account.monthlyBudget ? 'Modifică' : 'Setează buget'}
									</Button>
								{/if}
							</div>
							{#if account.monthlyBudget && account.monthlyBudget > 0}
								<div class="space-y-1.5">
									<div class="flex justify-between text-xs">
										<span class={colors.text}>
											Consumat: {account.spendAmount.toLocaleString('ro-RO')} / {account.monthlyBudget.toLocaleString('ro-RO')} RON
										</span>
										<span class={colors.text}>{pct}%</span>
									</div>
									<div class="relative h-2 rounded-full overflow-hidden bg-muted {colors.bar}">
									<div
										class="absolute inset-y-0 left-0 rounded-full budget-bar-glow"
										style="width: {Math.min(pct, 100)}%"
									></div>
								</div>
								{#if dailyInfo(account.monthlyBudget, account.spendAmount)}
									{@const daily = dailyInfo(account.monthlyBudget, account.spendAmount)!}
									<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1">
										<Tooltip.Root>
											<Tooltip.Trigger><span class="inline-flex items-center gap-1 cursor-pointer"><CalendarIcon class="h-3 w-3" />{daily.dailyBudget.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON/zi</span></Tooltip.Trigger>
											<Tooltip.Content>Bugetul lunar împărțit la {daysInMonth} zile</Tooltip.Content>
										</Tooltip.Root>
										<Tooltip.Root>
											<Tooltip.Trigger><span class="inline-flex items-center gap-1 cursor-pointer"><TargetIcon class="h-3 w-3" />Așteptat: {daily.expectedSpend.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON</span></Tooltip.Trigger>
											<Tooltip.Content>Consumul așteptat până în ziua {dayOfMonth} la ritm constant</Tooltip.Content>
										</Tooltip.Root>
										<Tooltip.Root>
											<Tooltip.Trigger><span class="inline-flex items-center gap-1 cursor-pointer"><PiggyBankIcon class="h-3 w-3" />Rămas: {daily.remainingBudget.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON</span></Tooltip.Trigger>
											<Tooltip.Content>Diferența dintre buget și suma consumată</Tooltip.Content>
										</Tooltip.Root>
										<Tooltip.Root>
											<Tooltip.Trigger><span class="inline-flex items-center gap-1 cursor-pointer"><TrendingUpIcon class="h-3 w-3" />{daily.dailyRemaining.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON/zi</span></Tooltip.Trigger>
											<Tooltip.Content>Necesar pe zi în cele {daysRemaining} zile rămase</Tooltip.Content>
										</Tooltip.Root>
									</div>
									<!-- Proiecție & Recomandare -->
									<div class="mt-2 rounded-md p-2 text-xs {daily.overBudget ? 'bg-destructive/10 border border-destructive/20' : 'bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800'}">
										<div class="flex items-start gap-2">
											{#if daily.overBudget}
												<AlertTriangleIcon class="h-4 w-4 text-destructive shrink-0 mt-0.5" />
												<div>
													<p class="font-medium text-destructive">
														Proiecție: {daily.projectedSpend.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON ({daily.projectedPct}% din buget)
													</p>
													<p class="text-muted-foreground mt-0.5">
														Media curentă: {daily.currentDailyAvg.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON/zi.
														Reduce la {daily.dailyRemaining.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON/zi
														(−{daily.reduction.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON/zi) pentru a te încadra în buget.
													</p>
												</div>
											{:else}
												<CheckCircleIcon class="h-4 w-4 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
												<div>
													<p class="font-medium text-green-700 dark:text-green-300">
														Proiecție: {daily.projectedSpend.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON ({daily.projectedPct}% din buget) — Pe drumul bun
													</p>
												</div>
											{/if}
										</div>
									</div>
								{/if}
								</div>
							{:else}
								<p class="text-xs text-muted-foreground italic">Niciun buget setat.</p>
							{/if}
						</div>
					{/each}
				</CardContent>
			</Card>
		{/if}

		{#if data.meta.length === 0 && data.tiktok.length === 0 && data.google.length === 0}
			<Card>
				<CardContent class="py-10 text-center">
					<p class="text-muted-foreground">Niciun cont de publicitate conectat.</p>
				</CardContent>
			</Card>
		{/if}
	{/if}
</div>

<style>
	@keyframes budget-flow {
		0% { background-position: 200% center; }
		100% { background-position: -200% center; }
	}
	:global(.budget-bar-glow) {
		background: linear-gradient(90deg, var(--primary) 0%, color-mix(in oklch, var(--primary) 60%, white) 50%, var(--primary) 100%);
		background-size: 200% 100%;
		animation: budget-flow 3s ease-in-out infinite;
	}
	:global(.budget-bar-yellow .budget-bar-glow) {
		background: linear-gradient(90deg, #eab308 0%, #fde047 50%, #eab308 100%);
		background-size: 200% 100%;
		animation: budget-flow 3s ease-in-out infinite;
	}
	:global(.budget-bar-red .budget-bar-glow) {
		background: linear-gradient(90deg, var(--destructive) 0%, color-mix(in oklch, var(--destructive) 60%, white) 50%, var(--destructive) 100%);
		background-size: 200% 100%;
		animation: budget-flow 3s ease-in-out infinite;
	}
</style>
