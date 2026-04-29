<script lang="ts">
	import { Card } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import IconFacebook from '$lib/components/marketing/icon-facebook.svelte';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import TargetIcon from '@lucide/svelte/icons/target';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import VolumeXIcon from '@lucide/svelte/icons/volume-x';
	import Volume2Icon from '@lucide/svelte/icons/volume-2';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { toast } from 'svelte-sonner';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let targets = $state([...data.targets]);
	let runningRebuild = $state(false);

	// Add-target form state
	let showAddForm = $state(false);
	let formClientId = $state('');
	let formCampaignId = $state('');
	let formObjective = $state('OUTCOME_LEADS');
	let formCpl = $state('');
	let formCpa = $state('');
	let formRoas = $state('');
	let formCtr = $state('');
	let formDailyBudget = $state('');
	let formThreshold = $state('20');
	let formNotifyTelegram = $state(true);
	let formNotifyEmail = $state(true);
	let saving = $state(false);

	function resetForm() {
		formClientId = '';
		formCampaignId = '';
		formObjective = 'OUTCOME_LEADS';
		formCpl = '';
		formCpa = '';
		formRoas = '';
		formCtr = '';
		formDailyBudget = '';
		formThreshold = '20';
		formNotifyTelegram = true;
		formNotifyEmail = true;
	}

	function ronToCents(value: string): number | null {
		const v = value.trim();
		if (!v) return null;
		const n = parseFloat(v);
		if (!isFinite(n)) return null;
		return Math.round(n * 100);
	}
	function parseFloatOrNull(value: string): number | null {
		const v = value.trim();
		if (!v) return null;
		const n = parseFloat(v);
		return isFinite(n) ? n : null;
	}

	async function saveTarget() {
		if (!formClientId || !formCampaignId.trim() || !formObjective) {
			toast.error('Completează clientul, ID-ul campaniei și obiectivul');
			return;
		}
		const payload = {
			clientId: formClientId,
			externalCampaignId: formCampaignId.trim(),
			objective: formObjective,
			targetCplCents: ronToCents(formCpl),
			targetCpaCents: ronToCents(formCpa),
			targetRoas: parseFloatOrNull(formRoas),
			targetCtr: parseFloatOrNull(formCtr),
			targetDailyBudgetCents: ronToCents(formDailyBudget),
			deviationThresholdPct: parseInt(formThreshold, 10) || 20,
			notifyTelegram: formNotifyTelegram,
			notifyEmail: formNotifyEmail,
			notifyInApp: true
		};
		saving = true;
		try {
			const res = await fetch(`/${data.tenantSlug}/api/ads-monitor/targets`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload)
			});
			if (!res.ok) {
				const txt = await res.text();
				throw new Error(txt || `HTTP ${res.status}`);
			}
			toast.success('Target salvat. Va fi evaluat la următoarea rulare zilnică.');
			showAddForm = false;
			resetForm();
			// Refresh list
			window.location.reload();
		} catch (e) {
			toast.error(`Eroare la salvare: ${(e as Error).message}`);
		} finally {
			saving = false;
		}
	}

	function fmtMoney(cents: number | null): string {
		if (cents === null) return '—';
		return `${(cents / 100).toFixed(2)} RON`;
	}
	function fmtRatio(value: number | null): string {
		return value === null ? '—' : value.toFixed(2);
	}
	function fmtPct(value: number | null): string {
		return value === null ? '—' : `${(value * 100).toFixed(2)}%`;
	}

	async function toggleMute(targetId: string, currentlyMuted: boolean) {
		try {
			const res = await fetch(`/${data.tenantSlug}/api/ads-monitor/targets/${targetId}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: currentlyMuted ? 'unmute' : 'mute', days: 7 })
			});
			if (!res.ok) throw new Error(await res.text());
			toast.success(currentlyMuted ? 'Alerte reactivate' : 'Alerte mute pentru 7 zile');
			targets = targets.map((t) =>
				t.id === targetId
					? {
							...t,
							isMuted: !currentlyMuted,
							mutedUntil: !currentlyMuted ? new Date(Date.now() + 7 * 86400_000) : null
					  }
					: t
			);
		} catch (e) {
			toast.error('Eroare la mute/unmute');
		}
	}

	async function deleteTarget(targetId: string) {
		if (!confirm('Sigur ștergi acest target? Snapshots rămân în istoric.')) return;
		try {
			const res = await fetch(`/${data.tenantSlug}/api/ads-monitor/targets/${targetId}`, {
				method: 'DELETE'
			});
			if (!res.ok) throw new Error(await res.text());
			toast.success('Target șters');
			targets = targets.filter((t) => t.id !== targetId);
		} catch (e) {
			toast.error('Eroare la ștergere');
		}
	}

	async function runMonitorNow() {
		if (runningRebuild) return;
		runningRebuild = true;
		try {
			const res = await fetch(`/${data.tenantSlug}/api/_debug-ads-monitor-run`, { method: 'POST' });
			const body = (await res.json().catch(() => null)) as
				| { ok: boolean; result?: { processed: number; alerted: number }; error?: string }
				| null;
			if (!res.ok || !body?.ok) {
				throw new Error(body?.error ?? `HTTP ${res.status}`);
			}
			const result = body.result ?? { processed: 0, alerted: 0 };
			toast.success(
				`Rulat: ${result.processed} target-uri procesate, ${result.alerted} alerte emise.`
			);
		} catch (e) {
			toast.error(`Eroare la rulare: ${(e as Error).message}`);
		} finally {
			runningRebuild = false;
		}
	}
</script>

<svelte:head>
	<title>Monitoring Meta Ads</title>
</svelte:head>

<div class="container mx-auto p-6 space-y-6">
	<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<a
				href="/{data.tenantSlug}/reports/facebook-ads"
				class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
			>
				<ArrowLeftIcon class="h-4 w-4" /> Înapoi la rapoarte
			</a>
			<h1 class="text-3xl font-bold flex items-center gap-3 mt-2">
				<TargetIcon class="h-7 w-7" />
				Monitoring Meta Ads
			</h1>
			<p class="text-muted-foreground">
				Setează target-uri (CPL/CPA/ROAS) și primești alerte la deviații &gt; prag.
			</p>
		</div>
		<div class="flex items-center gap-2">
			<Button onclick={() => (showAddForm = !showAddForm)} variant="default" size="sm">
				<TargetIcon class="h-4 w-4 mr-2" />
				{showAddForm ? 'Închide' : 'Adaugă target'}
			</Button>
			<Button onclick={runMonitorNow} disabled={runningRebuild} variant="outline" size="sm">
				<RefreshCwIcon class="h-4 w-4 mr-2 {runningRebuild ? 'animate-spin' : ''}" />
				Rulează acum
			</Button>
		</div>
	</div>

	{#if showAddForm}
		<Card class="p-6 border-primary/40">
			<h2 class="text-lg font-semibold mb-4">Target nou</h2>
			<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
				<label class="flex flex-col gap-1 text-sm">
					Client *
					<select
						bind:value={formClientId}
						class="h-9 rounded-md border border-input bg-background px-3"
					>
						<option value="">Alege client…</option>
						{#each data.clients as c}
							<option value={c.id}>{c.name}</option>
						{/each}
					</select>
				</label>
				<label class="flex flex-col gap-1 text-sm sm:col-span-2">
					ID campanie Meta *
					<input
						bind:value={formCampaignId}
						placeholder="ex: 23854761234567890"
						class="h-9 rounded-md border border-input bg-background px-3 font-mono text-xs"
					/>
				</label>
				<label class="flex flex-col gap-1 text-sm">
					Obiectiv *
					<select
						bind:value={formObjective}
						class="h-9 rounded-md border border-input bg-background px-3"
					>
						<option value="OUTCOME_LEADS">OUTCOME_LEADS</option>
						<option value="OUTCOME_SALES">OUTCOME_SALES</option>
						<option value="OUTCOME_TRAFFIC">OUTCOME_TRAFFIC</option>
						<option value="OUTCOME_AWARENESS">OUTCOME_AWARENESS</option>
						<option value="OUTCOME_ENGAGEMENT">OUTCOME_ENGAGEMENT</option>
						<option value="OUTCOME_APP_PROMOTION">OUTCOME_APP_PROMOTION</option>
					</select>
				</label>
				<label class="flex flex-col gap-1 text-sm">
					CPL țintă (RON)
					<input
						bind:value={formCpl}
						placeholder="ex: 30"
						type="number"
						step="0.01"
						class="h-9 rounded-md border border-input bg-background px-3"
					/>
				</label>
				<label class="flex flex-col gap-1 text-sm">
					CPA țintă (RON)
					<input
						bind:value={formCpa}
						placeholder="ex: 50"
						type="number"
						step="0.01"
						class="h-9 rounded-md border border-input bg-background px-3"
					/>
				</label>
				<label class="flex flex-col gap-1 text-sm">
					ROAS țintă
					<input
						bind:value={formRoas}
						placeholder="ex: 3.0"
						type="number"
						step="0.1"
						class="h-9 rounded-md border border-input bg-background px-3"
					/>
				</label>
				<label class="flex flex-col gap-1 text-sm">
					CTR țintă (zecimal)
					<input
						bind:value={formCtr}
						placeholder="ex: 0.015 pentru 1.5%"
						type="number"
						step="0.001"
						class="h-9 rounded-md border border-input bg-background px-3"
					/>
				</label>
				<label class="flex flex-col gap-1 text-sm">
					Buget zilnic țintă (RON)
					<input
						bind:value={formDailyBudget}
						placeholder="ex: 100"
						type="number"
						step="0.01"
						class="h-9 rounded-md border border-input bg-background px-3"
					/>
				</label>
				<label class="flex flex-col gap-1 text-sm">
					Prag deviație (%)
					<input
						bind:value={formThreshold}
						type="number"
						step="1"
						min="5"
						max="100"
						class="h-9 rounded-md border border-input bg-background px-3"
					/>
				</label>
			</div>
			<div class="flex flex-wrap gap-4 mt-4">
				<label class="flex items-center gap-2 text-sm">
					<input type="checkbox" bind:checked={formNotifyTelegram} />
					Telegram (high/urgent)
				</label>
				<label class="flex items-center gap-2 text-sm">
					<input type="checkbox" bind:checked={formNotifyEmail} />
					Email digest
				</label>
			</div>
			<div class="flex justify-end gap-2 mt-4">
				<Button variant="outline" size="sm" onclick={() => (showAddForm = false)}>Anulează</Button>
				<Button onclick={saveTarget} disabled={saving} size="sm">
					{saving ? 'Se salvează…' : 'Salvează target'}
				</Button>
			</div>
		</Card>
	{/if}

	<!-- Targets table -->
	<Card class="p-6">
		<div class="flex items-center justify-between mb-4">
			<h2 class="text-xl font-semibold flex items-center gap-2">
				<IconFacebook class="h-5 w-5" />
				Target-uri active ({targets.length})
			</h2>
		</div>

		{#if targets.length === 0}
			<div class="text-center py-12 text-muted-foreground">
				<TargetIcon class="h-12 w-12 mx-auto mb-3 opacity-50" />
				<p>Niciun target setat încă.</p>
				<p class="text-sm mt-2">Apasă „Adaugă target” mai sus pentru a începe.</p>
			</div>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead class="border-b bg-muted/40">
						<tr class="text-left">
							<th class="px-3 py-2">Client</th>
							<th class="px-3 py-2">Campanie</th>
							<th class="px-3 py-2">Obiectiv</th>
							<th class="px-3 py-2 text-right">CPL țintă</th>
							<th class="px-3 py-2 text-right">CPA țintă</th>
							<th class="px-3 py-2 text-right">ROAS țintă</th>
							<th class="px-3 py-2 text-right">Buget zilnic</th>
							<th class="px-3 py-2 text-right">Prag</th>
							<th class="px-3 py-2">Stare</th>
							<th class="px-3 py-2"></th>
						</tr>
					</thead>
					<tbody>
						{#each targets as target (target.id)}
							<tr class="border-b hover:bg-muted/20">
								<td class="px-3 py-2">{target.clientName}</td>
								<td class="px-3 py-2 font-mono text-xs">{target.externalCampaignId}</td>
								<td class="px-3 py-2">
									<Badge variant="outline" class="text-xs">{target.objective}</Badge>
								</td>
								<td class="px-3 py-2 text-right">{fmtMoney(target.targetCplCents)}</td>
								<td class="px-3 py-2 text-right">{fmtMoney(target.targetCpaCents)}</td>
								<td class="px-3 py-2 text-right">{fmtRatio(target.targetRoas)}</td>
								<td class="px-3 py-2 text-right">{fmtMoney(target.targetDailyBudgetCents)}</td>
								<td class="px-3 py-2 text-right">{target.deviationThresholdPct}%</td>
								<td class="px-3 py-2">
									{#if target.isMuted}
										<Badge variant="secondary" class="text-xs">
											🔇 Mute{target.mutedUntil
												? ` până ${new Date(target.mutedUntil).toLocaleDateString('ro-RO')}`
												: ''}
										</Badge>
									{:else if target.isActive}
										<Badge variant="default" class="text-xs">Activ</Badge>
									{:else}
										<Badge variant="outline" class="text-xs">Inactiv</Badge>
									{/if}
								</td>
								<td class="px-3 py-2">
									<div class="flex items-center gap-1 justify-end">
										<Button
											variant="ghost"
											size="sm"
											title={target.isMuted ? 'Reactivează' : 'Mute 7 zile'}
											onclick={() => toggleMute(target.id, target.isMuted)}
										>
											{#if target.isMuted}
												<Volume2Icon class="h-4 w-4" />
											{:else}
												<VolumeXIcon class="h-4 w-4" />
											{/if}
										</Button>
										<Button
											variant="ghost"
											size="sm"
											title="Șterge"
											onclick={() => deleteTarget(target.id)}
										>
											<Trash2Icon class="h-4 w-4" />
										</Button>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</Card>
</div>
