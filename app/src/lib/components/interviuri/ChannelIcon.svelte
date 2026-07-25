<script lang="ts">
	import MusicIcon from '@lucide/svelte/icons/music';
	import SearchIcon from '@lucide/svelte/icons/search';
	import UserPlusIcon from '@lucide/svelte/icons/user-plus';
	import InstagramIcon from '@lucide/svelte/icons/instagram';
	import FacebookIcon from '@lucide/svelte/icons/facebook';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import YoutubeIcon from '@lucide/svelte/icons/youtube';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import MegaphoneIcon from '@lucide/svelte/icons/megaphone';
	import CircleHelpIcon from '@lucide/svelte/icons/circle-help';

	let { icon, size = 14 }: { icon: string | null | undefined; size?: number } = $props();
</script>

{#if icon === 'music'}
	<MusicIcon size={size} />
{:else if icon === 'search'}
	<SearchIcon size={size} />
{:else if icon === 'user-plus'}
	<UserPlusIcon size={size} />
{:else if icon === 'instagram'}
	<InstagramIcon size={size} />
{:else if icon === 'facebook'}
	<FacebookIcon size={size} />
{:else if icon === 'sparkles'}
	<SparklesIcon size={size} />
{:else if icon === 'youtube'}
	<YoutubeIcon size={size} />
{:else if icon === 'globe'}
	<GlobeIcon size={size} />
{:else if icon === 'megaphone'}
	<MegaphoneIcon size={size} />
{:else}
	<CircleHelpIcon size={size} />
{/if}
