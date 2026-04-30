<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { toast } from 'svelte-sonner';

	interface Props { tenantSlug: string; target: any; onSaved: () => void }
	let { tenantSlug, target, onSaved }: Props = $props();

	let cpl = $state(target.targetCplCents !== null ? (target.targetCplCents / 100).toString() : '');
	let cpa = $state(target.targetCpaCents !== null ? (target.targetCpaCents / 100).toString() : '');
	let roas = $state(target.targetRoas !== null ? String(target.targetRoas) : '');
	let ctr = $state(target.targetCtr !== null ? String(target.targetCtr) : '');
	let dailyBudget = $state(
		target.targetDailyBudgetCents !== null ? (target.targetDailyBudgetCents / 100).toString() : ''
	);
	let threshold = $state(String(target.deviationThresholdPct ?? 20));
	let notes = $state(target.notes ?? '');
	let auditNote = $state('');
	let saving = $state(false);

	const ronToCents = (v: string): number | null => {
		const t = v.trim(); if (!t) return null;
		const n = parseFloat(t); return isFinite(n) ? Math.round(n * 100) : null;
	};
	const numOrNull = (v: string): number | null => {
		const t = v.trim(); if (!t) return null;
		const n = parseFloat(t); return isFinite(n) ? n : null;
	};

	async function save() {
		saving = true;
		try {
			const res = await fetch(`/${tenantSlug}/api/ads-monitor/targets/${target.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					expectedVersion: target.version,
					targetCplCents: ronToCents(cpl),
					targetCpaCents: ronToCents(cpa),
					targetRoas: numOrNull(roas),
					targetCtr: numOrNull(ctr),
					targetDailyBudgetCents: ronToCents(dailyBudget),
					deviationThresholdPct: parseInt(threshold, 10) || 20,
					notes: notes.trim().slice(0, 500) || null,
					auditNote: auditNote.trim().slice(0, 200) || undefined
				})
			});
			const body = await res.json();
			if (res.status === 409) {
				toast.error('Targetul a fost modificat între timp — am reîncărcat datele.');
				onSaved();
				return;
			}
			if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
			if (body.changed === false) {
				toast.info('Nicio modificare detectată.');
			} else {
				toast.success('Salvat.');
			}
			onSaved();
		} catch (e) {
			toast.error(`Eroare: ${(e as Error).message}`);
		} finally {
			saving = false;
		}
	}
</script>

<div class="grid grid-cols-2 gap-3">
	<label class="flex flex-col gap-1 text-sm">
		CPL țintă (RON)
		<input bind:value={cpl} type="number" step="0.01" class="h-9 rounded-md border px-3 bg-background" />
	</label>
	<label class="flex flex-col gap-1 text-sm">
		CPA țintă (RON)
		<input bind:value={cpa} type="number" step="0.01" class="h-9 rounded-md border px-3 bg-background" />
	</label>
	<label class="flex flex-col gap-1 text-sm">
		ROAS țintă
		<input bind:value={roas} type="number" step="0.1" class="h-9 rounded-md border px-3 bg-background" />
	</label>
	<label class="flex flex-col gap-1 text-sm">
		CTR țintă (zecimal)
		<input bind:value={ctr} type="number" step="0.001" class="h-9 rounded-md border px-3 bg-background" />
	</label>
	<label class="flex flex-col gap-1 text-sm">
		Buget zilnic (RON)
		<input bind:value={dailyBudget} type="number" step="0.01" class="h-9 rounded-md border px-3 bg-background" />
	</label>
	<label class="flex flex-col gap-1 text-sm">
		Prag deviație (%)
		<input bind:value={threshold} type="number" min="5" max="100" class="h-9 rounded-md border px-3 bg-background" />
	</label>
</div>
<label class="flex flex-col gap-1 text-sm mt-3">
	Notițe interne (max 500 char)
	<textarea bind:value={notes} maxlength="500" rows="2" class="rounded-md border px-3 py-2 bg-background"></textarea>
</label>
<label class="flex flex-col gap-1 text-sm mt-3">
	Motiv modificare (opțional, max 200 char)
	<input bind:value={auditNote} maxlength="200" placeholder="ex: Client a redus targetul după A/B test" class="h-9 rounded-md border px-3 bg-background" />
</label>
<div class="flex justify-end mt-4">
	<Button onclick={save} disabled={saving}>{saving ? 'Se salvează…' : 'Salvează'}</Button>
</div>
