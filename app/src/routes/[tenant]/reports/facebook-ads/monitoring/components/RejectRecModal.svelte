<script lang="ts">
	import * as Sheet from '$lib/components/ui/sheet';
	import { Button } from '$lib/components/ui/button';
	import { toast } from 'svelte-sonner';

	const REASONS = [
		{ value: 'false_positive', label: 'Recomandare greșită (fals pozitiv)' },
		{ value: 'wrong_action', label: 'Acțiune greșită (alta ar fi mai potrivită)' },
		{ value: 'bad_timing', label: 'Timing prost (ex: înainte de campanie sezonieră)' },
		{ value: 'manually_handled', label: 'Am rezolvat manual' },
		{ value: 'other', label: 'Altul' }
	];

	interface Props {
		open: boolean;
		recId: string | null;
		tenantSlug: string;
		onClose: () => void;
		onRejected: () => void;
	}
	let { open = $bindable(), recId, tenantSlug, onClose, onRejected }: Props = $props();

	let reason = $state('false_positive');
	let note = $state('');
	let saving = $state(false);

	async function submit() {
		if (!recId) return;
		saving = true;
		try {
			const res = await fetch(`/${tenantSlug}/api/ads-monitor/recommendations/${recId}/reject`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ reason, note: note.trim().slice(0, 200) || undefined })
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			toast.success('Recomandare respinsă cu feedback.');
			onRejected();
			onClose();
		} catch (e) {
			toast.error(`Eroare: ${(e as Error).message}`);
		} finally { saving = false; }
	}
</script>

<Sheet.Root bind:open onOpenChange={(o) => { if (!o) onClose(); }}>
	<Sheet.Content side="right" class="w-[400px]">
		<Sheet.Header>
			<Sheet.Title>Respinge recomandare</Sheet.Title>
		</Sheet.Header>
		<div class="space-y-3 py-4">
			<fieldset class="space-y-2">
				<legend class="text-sm font-medium">Motiv</legend>
				{#each REASONS as r}
					<label class="flex items-start gap-2 text-sm">
						<input type="radio" bind:group={reason} value={r.value} />
						<span>{r.label}</span>
					</label>
				{/each}
			</fieldset>
			<label class="flex flex-col gap-1 text-sm">
				Notă opțională (max 200)
				<textarea bind:value={note} maxlength="200" rows="2" class="rounded-md border px-3 py-2 bg-background"></textarea>
			</label>
		</div>
		<Sheet.Footer>
			<Button variant="outline" onclick={onClose}>Anulează</Button>
			<Button onclick={submit} disabled={saving}>{saving ? 'Salvez…' : 'Respinge'}</Button>
		</Sheet.Footer>
	</Sheet.Content>
</Sheet.Root>
