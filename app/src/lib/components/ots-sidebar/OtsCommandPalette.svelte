<script lang="ts">
	import { goto } from '$app/navigation';
	import SearchIcon from '@lucide/svelte/icons/search';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import NavIcon from './NavIcon.svelte';
	import { buildHref, type FlatNavItem } from '$lib/config/sidebar-nav';

	let {
		open = $bindable(false),
		items,
		tenantSlug
	}: { open: boolean; items: FlatNavItem[]; tenantSlug: string } = $props();

	let query = $state('');
	let selected = $state(0);
	let inputEl: HTMLInputElement | null = $state(null);

	const results = $derived.by(() => {
		const q = query.toLowerCase().trim();
		if (!q) return items.slice(0, 8);
		return items
			.filter(
				(it) =>
					it.label.toLowerCase().includes(q) ||
					(it.parentLabel ?? '').toLowerCase().includes(q) ||
					it.groupLabel.toLowerCase().includes(q)
			)
			.slice(0, 12);
	});

	$effect(() => {
		if (open) {
			query = '';
			selected = 0;
			// Focus after render
			queueMicrotask(() => inputEl?.focus());
		}
	});

	$effect(() => {
		// Clamp selection to results length
		if (selected >= results.length) selected = Math.max(0, results.length - 1);
	});

	function navigate(item: FlatNavItem) {
		const href = buildHref(tenantSlug, item.href);
		open = false;
		if (href) goto(href);
	}

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			open = false;
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			selected = Math.min(selected + 1, results.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selected = Math.max(selected - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const r = results[selected];
			if (r) navigate(r);
		}
	}
</script>

{#if open}
	<div
		class="ots-cmd-backdrop"
		role="presentation"
		onclick={() => (open = false)}
		onkeydown={() => {}}
	>
		<div
			class="ots-cmd"
			role="dialog"
			aria-modal="true"
			aria-label="Command palette"
			onclick={(e) => e.stopPropagation()}
			onkeydown={handleKey}
		>
			<div class="ots-cmd-input">
				<SearchIcon class="size-4 text-(--ots-sb-muted)" />
				<input
					bind:this={inputEl}
					bind:value={query}
					type="text"
					placeholder="Caută pagini, grupuri..."
					autocomplete="off"
					spellcheck="false"
				/>
				<kbd class="ots-cmd-kbd">esc</kbd>
			</div>
			<div class="ots-cmd-results" role="listbox">
				{#if results.length === 0}
					<div class="ots-cmd-empty">Niciun rezultat pentru "{query}"</div>
				{:else}
					<div class="ots-cmd-section">{query ? 'Rezultate' : 'Sugestii'}</div>
					{#each results as r, i (r.id)}
						<button
							type="button"
							class="ots-cmd-item"
							class:sel={i === selected}
							role="option"
							aria-selected={i === selected}
							onmouseenter={() => (selected = i)}
							onclick={() => navigate(r)}
						>
							<NavIcon icon={r.icon} class="size-4 shrink-0" />
							<div class="ots-cmd-item-text">
								<div class="ots-cmd-item-label">{r.label}</div>
								<div class="ots-cmd-item-path">
									{r.groupLabel}{r.parentLabel ? ` › ${r.parentLabel}` : ''}
								</div>
							</div>
							{#if i === selected}
								<ChevronRightIcon class="size-3.5 shrink-0" />
							{/if}
						</button>
					{/each}
				{/if}
			</div>
			<div class="ots-cmd-foot">
				<span><kbd>↑↓</kbd> navighează</span>
				<span><kbd>↵</kbd> deschide</span>
				<span><kbd>esc</kbd> închide</span>
			</div>
		</div>
	</div>
{/if}

<style>
	.ots-cmd-backdrop {
		position: fixed;
		inset: 0;
		background: color-mix(in oklch, var(--background) 70%, transparent);
		backdrop-filter: blur(6px);
		z-index: 1000;
		display: grid;
		place-items: start center;
		padding-top: 12vh;
		animation: ots-cmd-fade 0.15s ease-out;
	}
	@keyframes ots-cmd-fade {
		from {
			opacity: 0;
		}
	}
	.ots-cmd {
		background: var(--popover);
		color: var(--popover-foreground);
		border: 1px solid var(--ots-sb-border);
		border-radius: 14px;
		box-shadow: 0 24px 64px color-mix(in oklch, var(--foreground) 22%, transparent);
		width: 580px;
		max-width: calc(100vw - 32px);
		overflow: hidden;
		animation: ots-cmd-pop 0.18s cubic-bezier(0.2, 0.9, 0.3, 1.2);
	}
	@keyframes ots-cmd-pop {
		from {
			opacity: 0;
			transform: translateY(-8px) scale(0.98);
		}
	}
	.ots-cmd-input {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 14px 16px;
		border-bottom: 1px solid var(--ots-sb-border);
	}
	.ots-cmd-input input {
		flex: 1;
		border: none;
		outline: none;
		font-size: 15px;
		background: transparent;
		color: var(--popover-foreground);
		font-family: inherit;
	}
	.ots-cmd-kbd,
	.ots-cmd-foot kbd {
		font-family: ui-monospace, monospace;
		font-size: 10px;
		padding: 2px 6px;
		border-radius: 4px;
		background: var(--ots-sb-surface);
		color: var(--ots-sb-muted);
		border: 1px solid var(--ots-sb-border);
	}
	.ots-cmd-results {
		max-height: 380px;
		overflow-y: auto;
		padding: 6px;
	}
	.ots-cmd-section {
		padding: 8px 10px 4px;
		font-size: 10px;
		font-weight: 700;
		color: var(--ots-sb-muted);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.ots-cmd-item {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 9px 10px;
		border-radius: 7px;
		cursor: pointer;
		color: var(--ots-sb-text);
		font-family: inherit;
		text-align: left;
		width: 100%;
		background: transparent;
		border: none;
	}
	.ots-cmd-item.sel {
		background: var(--ots-sb-accent-soft);
		color: var(--ots-sb-accent);
	}
	.ots-cmd-item-text {
		flex: 1;
		min-width: 0;
	}
	.ots-cmd-item-label {
		font-weight: 600;
		font-size: 13px;
		color: var(--ots-sb-text-strong);
	}
	.ots-cmd-item.sel .ots-cmd-item-label {
		color: var(--ots-sb-accent);
	}
	.ots-cmd-item-path {
		font-size: 11px;
		color: var(--ots-sb-muted);
		margin-top: 1px;
	}
	.ots-cmd-empty {
		padding: 24px;
		text-align: center;
		color: var(--ots-sb-muted);
		font-size: 13px;
	}
	.ots-cmd-foot {
		display: flex;
		gap: 16px;
		padding: 10px 16px;
		border-top: 1px solid var(--ots-sb-border);
		background: var(--ots-sb-surface);
		font-size: 11px;
		color: var(--ots-sb-muted);
	}
</style>
