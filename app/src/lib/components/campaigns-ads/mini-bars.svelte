<script lang="ts">
	interface Props {
		data: number[];
		color?: string;
	}

	let { data, color = '#1877F2' }: Props = $props();

	const max = $derived(Math.max(...data, 1));
</script>

<div class="mini-bars">
	{#each data as v, i (i)}
		<div
			class={['bar', i === data.length - 1 && 'last']}
			style:height="{Math.max((v / max) * 22, 2)}px"
			style:background={color}
		></div>
	{/each}
</div>
