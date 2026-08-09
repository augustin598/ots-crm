<script lang="ts">
	import IconChevronDown from '@lucide/svelte/icons/chevron-down';
	import IconColumns from '@lucide/svelte/icons/columns-3';
	import IconLock from '@lucide/svelte/icons/lock';
	import IconRefreshCw from '@lucide/svelte/icons/refresh-cw';

	interface Col {
		id: string;
		label: string;
		locked?: boolean;
	}

	interface Props {
		all: Col[];
		visible: Set<string>;
		onToggle: (id: string) => void;
		onReset: () => void;
	}

	let { all, visible, onToggle, onReset }: Props = $props();

	let open = $state(false);

	const hidden = $derived(all.filter((c) => !c.locked && !visible.has(c.id)).length);
</script>

<div class="wrap">
	<button
		type="button"
		class={['chip', { active: hidden > 0 }]}
		onclick={() => (open = !open)}
		title="Coloane afișate"
	>
		<IconColumns /> Coloane
		{#if hidden > 0}<strong>{all.length - hidden}/{all.length}</strong>{/if}
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
		<div class="dropdown col-manager">
			<div class="dropdown-section">Coloane în tabel</div>
			{#each all as c (c.id)}
				<label class={['col-row', { locked: c.locked }]}>
					<input
						type="checkbox"
						class="checkbox"
						checked={visible.has(c.id)}
						disabled={c.locked}
						onchange={() => onToggle(c.id)}
					/>
					<span>{c.label}</span>
					{#if c.locked}<IconLock size={11} class="lock-ico" />{/if}
				</label>
			{/each}
			<div class="col-foot">
				<button type="button" class="btn sm ghost" onclick={onReset}>
					<IconRefreshCw /> Resetează
				</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.wrap {
		position: relative;
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
	.col-row :global(.lock-ico) {
		margin-left: auto;
		color: var(--ca-text-3);
	}
</style>
