<script lang="ts">
	import XIcon from '@lucide/svelte/icons/x';
	import Link2Icon from '@lucide/svelte/icons/link-2';
	import CheckIcon from '@lucide/svelte/icons/check';

	let {
		clients,
		unassignedCount,
		onClose,
		onAssign
	}: {
		clients: { id: string; name: string }[];
		unassignedCount: number;
		onClose: () => void;
		onAssign: (clientId: string) => Promise<void>;
	} = $props();

	let clientId = $state('');
	let saving = $state(false);

	async function confirm() {
		if (!clientId || saving) return;
		saving = true;
		try {
			await onAssign(clientId);
		} finally {
			saving = false;
		}
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={onKey} />

<div
	class="iv-modal-backdrop"
	role="presentation"
	onclick={(e) => {
		if (e.target === e.currentTarget) onClose();
	}}
>
	<div class="iv-modal" role="dialog" aria-modal="true">
		<div class="iv-modal-head">
			<div class="iv-modal-head-ic"><Link2Icon size={18} /></div>
			<div>
				<h3>Asociază cu client</h3>
				<p>Leagă interviurile fără client de un client din CRM</p>
			</div>
			<button class="cl-icon-btn iv-modal-close" onclick={onClose} aria-label="Închide">
				<XIcon size={16} />
			</button>
		</div>

		<div class="iv-modal-body">
			<div class="cl-field">
				<label for="iv-assign-client">Client <span class="cl-req">*</span></label>
				<select id="iv-assign-client" class="cl-select" style="width:100%" bind:value={clientId}>
					<option value="">Alege clientul…</option>
					{#each clients as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
				</select>
			</div>
			<p class="cl-hint">
				Vor fi asociate <strong>{unassignedCount}</strong> interviuri care nu au încă un client.
				Interviurile deja asociate cu un client nu sunt atinse.
			</p>
		</div>

		<div class="iv-modal-foot">
			<button class="cl-btn-secondary" onclick={onClose}>Anulează</button>
			<button
				class="cl-btn-primary"
				disabled={!clientId || saving || unassignedCount === 0}
				onclick={confirm}
			>
				<CheckIcon size={13} />
				{saving ? 'Se asociază…' : 'Asociază interviurile'}
			</button>
		</div>
	</div>
</div>
