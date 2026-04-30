<script lang="ts">
	import { Card } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { toast } from 'svelte-sonner';

	interface Client { id: string; name: string }
	interface Props {
		tenantSlug: string;
		clients: Client[];
		onClose: () => void;
		onSaved: () => void;
	}
	let { tenantSlug, clients, onClose, onSaved }: Props = $props();

	let clientId = $state('');
	let campaignOptions = $state<Array<{ id: string; externalCampaignId: string; name: string }>>([]);
	let campaignId = $state('');
	let useFreeText = $state(false);
	let objective = $state('OUTCOME_LEADS');
	let cpl = $state(''); let cpa = $state(''); let roas = $state(''); let ctr = $state('');
	let dailyBudget = $state(''); let threshold = $state('20');
	let notifyTelegram = $state(true); let notifyEmail = $state(true);
	let saving = $state(false);

	$effect(() => {
		if (clientId) {
			fetch(`/${tenantSlug}/api/campaigns?clientId=${clientId}&platform=meta&status=active,pending_approval`)
				.then((r) => r.json())
				.then((d) => { campaignOptions = d.items ?? []; })
				.catch(() => { campaignOptions = []; });
		} else {
			campaignOptions = [];
		}
	});

	const ronToCents = (v: string): number | null => {
		const t = v.trim(); if (!t) return null;
		const n = parseFloat(t); return isFinite(n) ? Math.round(n * 100) : null;
	};
	const numOrNull = (v: string): number | null => {
		const t = v.trim(); if (!t) return null;
		const n = parseFloat(t); return isFinite(n) ? n : null;
	};

	async function save() {
		const finalCampaignId = useFreeText ? campaignId.trim() : campaignId;
		if (!clientId || !finalCampaignId || !objective) {
			toast.error('Completează clientul, ID-ul campaniei și obiectivul');
			return;
		}
		saving = true;
		try {
			const res = await fetch(`/${tenantSlug}/api/ads-monitor/targets`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					clientId, externalCampaignId: finalCampaignId, objective,
					targetCplCents: ronToCents(cpl), targetCpaCents: ronToCents(cpa),
					targetRoas: numOrNull(roas), targetCtr: numOrNull(ctr),
					targetDailyBudgetCents: ronToCents(dailyBudget),
					deviationThresholdPct: parseInt(threshold, 10) || 20,
					notifyTelegram, notifyEmail, notifyInApp: true
				})
			});
			if (!res.ok) throw new Error(await res.text());
			toast.success('Target salvat.');
			onSaved();
			onClose();
		} catch (e) {
			toast.error(`Eroare: ${(e as Error).message}`);
		} finally { saving = false; }
	}
</script>

<Card class="p-6 border-primary/40">
	<h2 class="text-lg font-semibold mb-4">Target nou</h2>
	<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
		<label class="flex flex-col gap-1 text-sm">
			Client *
			<select bind:value={clientId} class="h-9 rounded-md border px-3 bg-background">
				<option value="">Alege…</option>
				{#each clients as c}<option value={c.id}>{c.name}</option>{/each}
			</select>
		</label>
		<label class="flex flex-col gap-1 text-sm sm:col-span-2">
			Campanie *
			{#if campaignOptions.length > 0 && !useFreeText}
				<select bind:value={campaignId} class="h-9 rounded-md border px-3 bg-background">
					<option value="">Alege campanie…</option>
					{#each campaignOptions as c}
						<option value={c.externalCampaignId}>{c.name} ({c.externalCampaignId})</option>
					{/each}
				</select>
				<button type="button" class="text-xs text-primary text-left" onclick={() => (useFreeText = true)}>
					sau introdu ID manual
				</button>
			{:else}
				<input bind:value={campaignId} placeholder="ex: 23854761234567890" class="h-9 rounded-md border px-3 font-mono text-xs bg-background" />
				{#if campaignOptions.length > 0}
					<button type="button" class="text-xs text-primary text-left" onclick={() => (useFreeText = false)}>
						revino la dropdown
					</button>
				{/if}
			{/if}
		</label>
		<label class="flex flex-col gap-1 text-sm">
			Obiectiv *
			<select bind:value={objective} class="h-9 rounded-md border px-3 bg-background">
				<option value="OUTCOME_LEADS">OUTCOME_LEADS</option>
				<option value="OUTCOME_SALES">OUTCOME_SALES</option>
				<option value="OUTCOME_TRAFFIC">OUTCOME_TRAFFIC</option>
				<option value="OUTCOME_AWARENESS">OUTCOME_AWARENESS</option>
				<option value="OUTCOME_ENGAGEMENT">OUTCOME_ENGAGEMENT</option>
				<option value="OUTCOME_APP_PROMOTION">OUTCOME_APP_PROMOTION</option>
			</select>
		</label>
		<label class="flex flex-col gap-1 text-sm">CPL țintă (RON)
			<input bind:value={cpl} type="number" step="0.01" class="h-9 rounded-md border px-3 bg-background" />
		</label>
		<label class="flex flex-col gap-1 text-sm">CPA țintă (RON)
			<input bind:value={cpa} type="number" step="0.01" class="h-9 rounded-md border px-3 bg-background" />
		</label>
		<label class="flex flex-col gap-1 text-sm">ROAS țintă
			<input bind:value={roas} type="number" step="0.1" class="h-9 rounded-md border px-3 bg-background" />
		</label>
		<label class="flex flex-col gap-1 text-sm">CTR țintă (zecimal)
			<input bind:value={ctr} type="number" step="0.001" class="h-9 rounded-md border px-3 bg-background" />
		</label>
		<label class="flex flex-col gap-1 text-sm">Buget zilnic (RON)
			<input bind:value={dailyBudget} type="number" step="0.01" class="h-9 rounded-md border px-3 bg-background" />
		</label>
		<label class="flex flex-col gap-1 text-sm">Prag deviație (%)
			<input bind:value={threshold} type="number" min="5" max="100" class="h-9 rounded-md border px-3 bg-background" />
		</label>
	</div>
	<div class="flex flex-wrap gap-4 mt-4">
		<label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={notifyTelegram} /> Telegram</label>
		<label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={notifyEmail} /> Email</label>
	</div>
	<div class="flex justify-end gap-2 mt-4">
		<Button variant="outline" size="sm" onclick={onClose}>Anulează</Button>
		<Button onclick={save} disabled={saving} size="sm">{saving ? 'Se salvează…' : 'Salvează'}</Button>
	</div>
</Card>
