<script lang="ts">
	import { statusMeta } from '$lib/utils/meta-campaigns';

	interface Props {
		status: string;
	}

	let { status }: Props = $props();

	const meta = $derived(statusMeta(status));
</script>

<span class={['badge', meta.tone]}>
	{#if meta.pulse}<span class="pulse"></span>{/if}
	{meta.label}
</span>
