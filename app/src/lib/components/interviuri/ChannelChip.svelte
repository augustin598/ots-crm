<script lang="ts">
	import ChannelIcon from './ChannelIcon.svelte';
	let {
		name,
		color,
		icon,
		size = 13
	}: { name: string; color?: string | null; icon?: string | null; size?: number } = $props();
	const c = $derived(color || '#94a3b8');
</script>

<span class="iv-ch" style="background:{c}14; color:{c}">
	<ChannelIcon {icon} {size} />
	{name}
</span>
