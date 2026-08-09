<script lang="ts">
	import IconCalendar from '@lucide/svelte/icons/calendar';
	import IconChevronDown from '@lucide/svelte/icons/chevron-down';
	import IconWallet from '@lucide/svelte/icons/wallet';

	interface Option {
		id: string;
		label: string;
	}

	interface Props {
		label: string;
		value: string | null;
		options: Option[];
		onSelect: (o: Option) => void;
		icon?: 'calendar' | 'wallet';
	}

	let { label, value, options, onSelect, icon }: Props = $props();

	let open = $state(false);

	const IconCmp = $derived(icon === 'calendar' ? IconCalendar : icon === 'wallet' ? IconWallet : null);
</script>

<div class="wrap">
	<button type="button" class={['chip', { active: value }]} onclick={() => (open = !open)}>
		{#if IconCmp}<IconCmp />{/if}
		{#if value}
			<span class="chip-label">{label}:</span><strong>{value}</strong>
		{:else}
			{label}
		{/if}
		<IconChevronDown size={12} />
	</button>
	{#if open}
		<button
			type="button"
			class="overlay"
			tabindex={-1}
			aria-label="Închide meniul"
			onclick={() => (open = false)}
		></button>
		<div class="dropdown menu">
			{#each options as o (o.id)}
				<button
					type="button"
					class="dropdown-item"
					onclick={() => {
						onSelect(o);
						open = false;
					}}
				>
					{o.label}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.wrap {
		position: relative;
	}
	.chip-label {
		color: var(--ca-text-3);
	}
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 4;
		background: transparent;
		border: none;
		padding: 0;
		cursor: default;
	}
	.wrap .dropdown.menu {
		min-width: 180px;
		z-index: 5;
	}
	.wrap .dropdown-item {
		width: 100%;
		border: none;
		background: transparent;
		text-align: left;
		color: inherit;
	}
</style>
