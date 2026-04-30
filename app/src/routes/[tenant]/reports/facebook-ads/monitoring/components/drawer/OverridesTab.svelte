<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { toast } from 'svelte-sonner';

	const ALL_ACTIONS = [
		'pause_ad','resume_ad','increase_budget','decrease_budget','refresh_creative','change_audience'
	] as const;

	interface Props { tenantSlug: string; target: any; onSaved: () => void }
	let { tenantSlug, target, onSaved }: Props = $props();

	let cooldown = $state(target.customCooldownHours !== null ? String(target.customCooldownHours) : '');
	let minConv = $state(target.minConversionsThreshold !== null ? String(target.minConversionsThreshold) : '');
	let severity = $state(target.severityOverride ?? '');
	let suppressed = $state<string[]>(Array.isArray(target.suppressedActions) ? [...target.suppressedActions] : []);
	let saving = $state(false);

	function toggle(action: string) {
		suppressed = suppressed.includes(action)
			? suppressed.filter((a) => a !== action)
			: [...suppressed, action];
	}

	async function save() {
		if (suppressed.length === ALL_ACTIONS.length) {
			if (!confirm('Toate cele 6 acțiuni sunt suprimate. Workerul nu va mai propune nimic. Continui?')) return;
		}
		saving = true;
		try {
			const res = await fetch(`/${tenantSlug}/api/ads-monitor/targets/${target.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					expectedVersion: target.version,
					customCooldownHours: cooldown.trim() === '' ? null : parseInt(cooldown, 10),
					minConversionsThreshold: minConv.trim() === '' ? null : parseInt(minConv, 10),
					severityOverride: severity || null,
					suppressedActions: suppressed
				})
			});
			const body = await res.json();
			if (res.status === 409) { toast.error('Targetul a fost modificat — reîncarc.'); onSaved(); return; }
			if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
			toast.success('Override-uri salvate.');
			onSaved();
		} catch (e) {
			toast.error(`Eroare: ${(e as Error).message}`);
		} finally { saving = false; }
	}
</script>

<div class="space-y-4 text-sm">
	<label class="flex flex-col gap-1">
		Cooldown personalizat (ore, default 72)
		<input bind:value={cooldown} type="number" min="1" max="720" placeholder="default 72" class="h-9 rounded-md border px-3 bg-background" />
	</label>
	<label class="flex flex-col gap-1">
		Min conversii pentru evaluare (default 5)
		<input bind:value={minConv} type="number" min="0" max="100" placeholder="default 5" class="h-9 rounded-md border px-3 bg-background" />
	</label>
	<label class="flex flex-col gap-1">
		Severity override
		<select bind:value={severity} class="h-9 rounded-md border px-3 bg-background">
			<option value="">auto</option>
			<option value="urgent">urgent</option>
			<option value="high">high</option>
			<option value="warning">warning</option>
			<option value="opportunity">opportunity</option>
		</select>
	</label>
	<fieldset class="space-y-2">
		<legend class="font-medium">Suprimă acțiuni propuse</legend>
		{#each ALL_ACTIONS as action}
			<label class="flex items-center gap-2">
				<input type="checkbox" checked={suppressed.includes(action)} onchange={() => toggle(action)} />
				<code class="text-xs">{action}</code>
			</label>
		{/each}
	</fieldset>
	{#if suppressed.length === ALL_ACTIONS.length}
		<p class="text-amber-600 text-xs">⚠ Workerul nu va mai propune nimic pentru acest target.</p>
	{/if}
	<div class="flex justify-end pt-2">
		<Button onclick={save} disabled={saving}>{saving ? 'Salvez…' : 'Salvează override-uri'}</Button>
	</div>
</div>
