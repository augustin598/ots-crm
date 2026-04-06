<script lang="ts">
	import { updateAccountBudget } from '$lib/remotes/budget.remote';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { toast } from 'svelte-sonner';
	import CalendarIcon from '@lucide/svelte/icons/calendar-days';
	import TargetIcon from '@lucide/svelte/icons/target';
	import PiggyBankIcon from '@lucide/svelte/icons/piggy-bank';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import AlertTriangleIcon from '@lucide/svelte/icons/triangle-alert';
	import CheckCircleIcon from '@lucide/svelte/icons/circle-check';

	interface Props {
		account: any;
		platform: 'google' | 'meta' | 'tiktok';
		clientId: string;
		onUpdated: () => void;
	}

	let { account, platform, clientId, onUpdated }: Props = $props();

	let formBudget = $state<number | null>(null);
	let saving = $state(false);

	$effect(() => {
		formBudget = account.monthlyBudget;
	});

	const pct = $derived(
		account.monthlyBudget && account.monthlyBudget > 0
			? Math.round((account.spendAmount / account.monthlyBudget) * 100)
			: 0
	);

	function budgetColor(p: number) {
		if (p >= 100) return { bar: 'budget-bar-red', text: 'text-destructive font-bold' };
		if (p >= 75) return { bar: 'budget-bar-yellow', text: 'text-yellow-600 dark:text-yellow-400 font-semibold' };
		return { bar: '', text: '' };
	}

	const colors = $derived(budgetColor(pct));

	// Daily pacing
	const now = new Date();
	const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
	const dayOfMonth = now.getDate();
	const daysRemaining = daysInMonth - dayOfMonth;

	const daily = $derived.by(() => {
		const b = account.monthlyBudget;
		if (!b || b <= 0) return null;
		const dailyBudget = b / daysInMonth;
		const expectedSpend = dailyBudget * dayOfMonth;
		const remainingBudget = Math.max(b - account.spendAmount, 0);
		const dailyRemaining = daysRemaining > 0 ? remainingBudget / daysRemaining : 0;
		const currentDailyAvg = dayOfMonth > 0 ? account.spendAmount / dayOfMonth : 0;
		const projectedSpend = account.spendAmount + (currentDailyAvg * daysRemaining);
		const projectedPct = b > 0 ? Math.round((projectedSpend / b) * 100) : 0;
		const overBudget = projectedSpend > b;
		const reduction = overBudget && daysRemaining > 0 ? currentDailyAvg - dailyRemaining : 0;
		return { dailyBudget, expectedSpend, remainingBudget, dailyRemaining, currentDailyAvg, projectedSpend, projectedPct, overBudget, reduction };
	});

	async function handleSave() {
		saving = true;
		try {
			await updateAccountBudget({
				clientId,
				platform,
				adsAccountId: account.id,
				monthlyBudget: formBudget && formBudget > 0 ? formBudget : null
			});
			toast.success(`Bugetul pentru ${account.accountName} a fost salvat.`);
			onUpdated();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la salvare.');
		} finally {
			saving = false;
		}
	}
</script>

<div class="space-y-4 rounded-lg border p-4">
	<div class="flex items-center justify-between">
		<div>
			<h4 class="font-medium">{account.accountName}</h4>
			<p class="text-xs text-muted-foreground">ID: {account.metaAdAccountId || account.tiktokAdvertiserId || account.googleAdsCustomerId}</p>
		</div>
		<div class="flex items-center gap-2">
			{#if account.monthlyBudget && account.monthlyBudget > 0}
				<div class="flex items-center gap-2 rounded-lg border px-3 py-1.5">
					<span class="text-xs text-muted-foreground">Buget</span>
					<span class="text-xl font-bold">{account.monthlyBudget.toLocaleString('ro-RO')}</span>
					<span class="text-xs text-muted-foreground">{account.currencyCode || 'RON'}/lună</span>
				</div>
			{/if}
			<div class="w-32">
				<Input
					type="number"
					placeholder="Buget ({account.currencyCode || 'RON'})"
					bind:value={formBudget}
					class="h-8"
				/>
			</div>
			<Button size="sm" onclick={handleSave} disabled={saving}>
				{saving ? '...' : 'OK'}
			</Button>
		</div>
	</div>

	{#if account.monthlyBudget && account.monthlyBudget > 0}
		<div class="space-y-1.5">
			<div class="flex justify-between text-xs">
				<span class={colors.text}>
					Consumat: {account.spendAmount.toLocaleString()} / {account.monthlyBudget.toLocaleString()} {account.currencyCode || 'RON'}
				</span>
				<span class={colors.text}>{pct}%</span>
			</div>
			<div class="relative h-2 rounded-full overflow-hidden bg-muted {colors.bar}">
				<div
					class="absolute inset-y-0 left-0 rounded-full budget-bar-glow"
					style="width: {Math.min(pct, 100)}%"
				></div>
			</div>
			{#if daily}
				{@const d = daily}
				<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1">
					<Tooltip.Root>
						<Tooltip.Trigger><span class="inline-flex items-center gap-1 cursor-pointer"><CalendarIcon class="h-3 w-3" />{(account.activeDailyBudget || 0).toLocaleString('ro-RO', { maximumFractionDigits: 0 })} {account.currencyCode || 'RON'}/zi</span></Tooltip.Trigger>
						<Tooltip.Content>Suma bugetelor zilnice ale campaniilor active din acest cont</Tooltip.Content>
					</Tooltip.Root>
					<Tooltip.Root>
						<Tooltip.Trigger><span class="inline-flex items-center gap-1 cursor-pointer"><TargetIcon class="h-3 w-3" />Așteptat: {d.expectedSpend.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} {account.currencyCode || 'RON'}</span></Tooltip.Trigger>
						<Tooltip.Content>Consumul așteptat până în ziua {dayOfMonth} la ritm constant</Tooltip.Content>
					</Tooltip.Root>
					<Tooltip.Root>
						<Tooltip.Trigger><span class="inline-flex items-center gap-1 cursor-pointer"><PiggyBankIcon class="h-3 w-3" />Rămas: {d.remainingBudget.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} {account.currencyCode || 'RON'}</span></Tooltip.Trigger>
						<Tooltip.Content>Diferența dintre buget și suma consumată</Tooltip.Content>
					</Tooltip.Root>
					<Tooltip.Root>
						<Tooltip.Trigger><span class="inline-flex items-center gap-1 cursor-pointer rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-2 py-0.5"><TrendingUpIcon class="h-3 w-3" />{d.dailyRemaining.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} {account.currencyCode || 'RON'}/zi</span></Tooltip.Trigger>
						<Tooltip.Content>Necesar pe zi în cele {daysRemaining} zile rămase</Tooltip.Content>
					</Tooltip.Root>
				</div>
				<!-- Proiecție & Recomandare -->
				<div class="mt-2 rounded-md p-2 text-xs {d.overBudget ? 'bg-destructive/10 border border-destructive/20' : 'bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800'}">
					<div class="flex items-start gap-2">
						{#if d.overBudget}
							<AlertTriangleIcon class="h-4 w-4 text-destructive shrink-0 mt-0.5" />
							<div>
								<p class="font-medium text-destructive">
									Proiecție: {d.projectedSpend.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} {account.currencyCode || 'RON'} ({d.projectedPct}% din buget)
								</p>
								<p class="text-muted-foreground mt-0.5">
									Media curentă: {Math.round(d.currentDailyAvg).toLocaleString('ro-RO')} {account.currencyCode || 'RON'}/zi →
									Țintă: {Math.round(d.dailyRemaining).toLocaleString('ro-RO')} {account.currencyCode || 'RON'}/zi
									(reduce cu {Math.round(d.currentDailyAvg - d.dailyRemaining).toLocaleString('ro-RO')} {account.currencyCode || 'RON'}/zi)
								</p>
							</div>
						{:else}
							<CheckCircleIcon class="h-4 w-4 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
							<p class="font-medium text-green-700 dark:text-green-300">
								Proiecție: {d.projectedSpend.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} {account.currencyCode || 'RON'} ({d.projectedPct}% din buget) — Pe drumul bun
							</p>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	{:else}
		<p class="text-xs text-muted-foreground italic">Niciun buget setat pentru acest cont.</p>
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
