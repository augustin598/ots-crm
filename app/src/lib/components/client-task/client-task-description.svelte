<!-- src/lib/components/client-task/client-task-description.svelte -->
<script lang="ts">
	type Props = {
		description: string | null;
	};
	let { description }: Props = $props();
</script>

{#if description?.trim()}
	<div
		class="ct-desc rounded-[10px] border border-[#e5e9f0] bg-[#f7f8fa] p-4 text-[13.5px] leading-[1.65] text-[#334155]"
	>
		<pre class="whitespace-pre-wrap break-words font-sans">{description}</pre>
	</div>
{/if}
