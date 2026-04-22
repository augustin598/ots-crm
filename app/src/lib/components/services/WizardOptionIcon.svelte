<script lang="ts">
	import ShoppingCartIcon from '@lucide/svelte/icons/shopping-cart';
	import BriefcaseIcon from '@lucide/svelte/icons/briefcase';
	import StoreIcon from '@lucide/svelte/icons/store';
	import VideoIcon from '@lucide/svelte/icons/video';
	import GraduationCapIcon from '@lucide/svelte/icons/graduation-cap';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import CreditCardIcon from '@lucide/svelte/icons/credit-card';
	import UserPlusIcon from '@lucide/svelte/icons/user-plus';
	import MegaphoneIcon from '@lucide/svelte/icons/megaphone';
	import MapPinIcon from '@lucide/svelte/icons/map-pin';
	import RepeatIcon from '@lucide/svelte/icons/repeat';
	import RocketIcon from '@lucide/svelte/icons/rocket';

	type Props = {
		icon: string;
		class?: string;
	};

	let { icon, class: className = 'h-5 w-5' }: Props = $props();
</script>

{#if icon === 'shopping-cart'}
	<ShoppingCartIcon class={className} />
{:else if icon === 'briefcase'}
	<BriefcaseIcon class={className} />
{:else if icon === 'store'}
	<StoreIcon class={className} />
{:else if icon === 'video'}
	<VideoIcon class={className} />
{:else if icon === 'graduation-cap'}
	<GraduationCapIcon class={className} />
{:else if icon === 'credit-card'}
	<CreditCardIcon class={className} />
{:else if icon === 'user-plus'}
	<UserPlusIcon class={className} />
{:else if icon === 'megaphone'}
	<MegaphoneIcon class={className} />
{:else if icon === 'map-pin'}
	<MapPinIcon class={className} />
{:else if icon === 'repeat'}
	<RepeatIcon class={className} />
{:else if icon === 'rocket'}
	<RocketIcon class={className} />
{:else}
	<SparklesIcon class={className} />
{/if}
