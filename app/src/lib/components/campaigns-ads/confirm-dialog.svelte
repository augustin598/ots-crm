<script lang="ts">
	import IconTriangleAlert from '@lucide/svelte/icons/triangle-alert';

	interface Props {
		title: string;
		body: string;
		confirmLabel?: string;
		tone?: 'danger' | 'primary';
		onConfirm: () => void;
		onCancel: () => void;
	}

	let { title, body, confirmLabel = 'Confirmă', tone = 'danger', onConfirm, onCancel }: Props = $props();

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onCancel();
		if (e.key === 'Enter') onConfirm();
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div class="modal-backdrop" role="presentation" onclick={onCancel}>
	<!-- Click-ul doar oprește propagarea spre backdrop; tastatura e tratată pe window (Enter/Esc). -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="modal confirm"
		role="dialog"
		aria-modal="true"
		aria-labelledby="ca-confirm-title"
		tabindex="-1"
		onclick={(e) => e.stopPropagation()}
	>
		<div class={['confirm-ico', tone]}><IconTriangleAlert /></div>
		<h3 class="modal-title" id="ca-confirm-title">{title}</h3>
		<p class="confirm-body">{body}</p>
		<div class="confirm-actions">
			<button class="btn" onclick={onCancel}>Anulează</button>
			<button
				class={['btn', tone === 'danger' ? 'danger solid' : 'primary']}
				onclick={onConfirm}
				{@attach (node) => node.focus()}
			>
				{confirmLabel}
			</button>
		</div>
		<div class="confirm-kbd">Enter pentru confirmare · Esc pentru anulare</div>
	</div>
</div>

<style>
	/* Tonul „primary” nu există în paleta .confirm-ico din CSS-ul partajat */
	.confirm-ico.primary {
		background: var(--ca-accent-50);
		color: var(--ca-accent);
	}
</style>
