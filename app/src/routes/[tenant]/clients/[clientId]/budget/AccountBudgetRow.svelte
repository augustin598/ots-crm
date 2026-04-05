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
		return { dailyBudget, expectedSpend, remainingBudget, dailyRemaining };
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
			<div class="w-32">
				<Input
					type="number"
					placeholder="Buget (RON)"
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
					Consumat: {account.spendAmount.toLocaleString()} / {account.monthlyBudget.toLocaleString()} RON
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
						<Tooltip.Trigger><span class="inline-flex items-center gap-1 cursor-pointer"><CalendarIcon class="h-3 w-3" />{d.dailyBudget.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON/zi</span></Tooltip.Trigger>
						<Tooltip.Content>Bugetul lunar împărțit la {daysInMonth} zile</Tooltip.Content>
					</Tooltip.Root>
					<Tooltip.Root>
						<Tooltip.Trigger><span class="inline-flex items-center gap-1 cursor-pointer"><TargetIcon class="h-3 w-3" />Așteptat: {d.expectedSpend.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON</span></Tooltip.Trigger>
						<Tooltip.Content>Consumul așteptat până în ziua {dayOfMonth} la ritm constant</Tooltip.Content>
					</Tooltip.Root>
					<Tooltip.Root>
						<Tooltip.Trigger><span class="inline-flex items-center gap-1 cursor-pointer"><PiggyBankIcon class="h-3 w-3" />Rămas: {d.remainingBudget.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON</span></Tooltip.Trigger>
						<Tooltip.Content>Diferența dintre buget și suma consumată</Tooltip.Content>
					</Tooltip.Root>
					<Tooltip.Root>
						<Tooltip.Trigger><span class="inline-flex items-center gap-1 cursor-pointer"><TrendingUpIcon class="h-3 w-3" />{d.dailyRemaining.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON/zi</span></Tooltip.Trigger>
						<Tooltip.Content>Necesar pe zi în cele {daysRemaining} zile rămase</Tooltip.Content>
					</Tooltip.Root>
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
