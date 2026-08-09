<script lang="ts">
	import IconPlay from '@lucide/svelte/icons/play';
	import IconPause from '@lucide/svelte/icons/pause';
	import IconX from '@lucide/svelte/icons/x';

	interface Props {
		count: number;
		busy: boolean;
		onClear: () => void;
		onBulk: (k: 'activate' | 'pause') => void;
	}

	let { count, busy, onClear, onBulk }: Props = $props();
</script>

<div class="bulk-bar">
	<span><strong>{count}</strong> campanii selectate</span>
	<div class="bb-spacer"></div>
	<button class="btn sm" disabled={busy} onclick={() => onBulk('activate')}><IconPlay /> Pornește</button>
	<button class="btn sm" disabled={busy} onclick={() => onBulk('pause')}><IconPause /> Pauză</button>
	<button class="btn sm ghost" disabled={busy} onclick={onClear}><IconX /> Anulează</button>
</div>

<style>
	.bb-spacer {
		flex: 1;
	}
</style>
