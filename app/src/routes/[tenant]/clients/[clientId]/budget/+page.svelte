<script lang="ts">
	import { getClientBudget, updateClientBudget } from '$lib/remotes/clients.remote';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { toast } from 'svelte-sonner';
	import { page } from '$app/state';
	import WalletIcon from '@lucide/svelte/icons/wallet';

	const clientId = $derived(page.params.clientId as string);
	const budgetQuery = $derived(getClientBudget({ clientId }));
	const budgetData = $derived(budgetQuery.current);

	let formBudget = $state<number | null>(null);
	let saving = $state(false);

	$effect(() => {
		if (budgetData) {
			formBudget = budgetData.monthlyBudget;
		}
	});

	async function handleSave() {
		saving = true;
		try {
			await updateClientBudget({
				clientId,
				monthlyBudget: formBudget && formBudget > 0 ? formBudget : null
			}).updates(budgetQuery);
			toast.success('Bugetul a fost salvat.');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la salvare.');
		} finally {
			saving = false;
		}
	}

	async function handleClear() {
		saving = true;
		try {
			await updateClientBudget({ clientId, monthlyBudget: null }).updates(budgetQuery);
			formBudget = null;
			toast.success('Bugetul a fost șters.');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la ștergere.');
		} finally {
			saving = false;
		}
	}
</script>

<Card>
	<CardHeader>
		<CardTitle class="flex items-center gap-2">
			<WalletIcon class="h-5 w-5" />
			Buget lunar publicitate
		</CardTitle>
		<CardDescription>
			Setează bugetul lunar alocat pentru campaniile de advertising. Acest buget e folosit în rapoartele Facebook Ads pentru proiecția lunară și alerte de overspend/underspend.
		</CardDescription>
	</CardHeader>
	<CardContent>
		{#if budgetQuery.loading}
			<div class="animate-pulse space-y-4">
				<div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
				<div class="h-10 bg-gray-200 dark:bg-gray-700 rounded w-1/3"></div>
			</div>
		{:else}
			<form
				onsubmit={(e) => { e.preventDefault(); handleSave(); }}
				class="space-y-4"
			>
				<div class="max-w-xs space-y-2">
					<Label for="monthlyBudget">Buget lunar (RON)</Label>
					<Input
						id="monthlyBudget"
						type="number"
						min="0"
						step="100"
						placeholder="ex: 5000"
						bind:value={formBudget}
					/>
					<p class="text-xs text-muted-foreground">
						Lasă gol sau 0 pentru a dezactiva tracking-ul de buget.
					</p>
				</div>

				<div class="flex gap-2">
					<Button type="submit" disabled={saving}>
						{saving ? 'Se salvează...' : 'Salvează buget'}
					</Button>
					{#if formBudget && formBudget > 0}
						<Button type="button" variant="outline" onclick={handleClear} disabled={saving}>
							Șterge buget
						</Button>
					{/if}
				</div>
			</form>
		{/if}
	</CardContent>
</Card>
