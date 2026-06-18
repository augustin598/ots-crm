<script lang="ts">
	import Popover from './Popover.svelte';
	import Columns from '@lucide/svelte/icons/columns-3';
	import GripVertical from '@lucide/svelte/icons/grip-vertical';
	import Check from '@lucide/svelte/icons/check';
	import { ALL_COLUMNS } from '$lib/utils/column-presets';

	let { visible = $bindable(), onchange }: { visible: string[]; onchange?: () => void } = $props();

	let dragKey: string | null = null;

	const ordered = $derived([...visible, ...ALL_COLUMNS.map((c) => c.key).filter((k) => !visible.includes(k))]);
	const isOn = (k: string) => visible.includes(k);

	function toggle(k: string) {
		visible = isOn(k) ? visible.filter((x) => x !== k) : [...visible, k];
		onchange?.();
	}
	function onDrop(k: string) {
		const from = dragKey;
		if (!from || from === k) return;
		const v = [...visible];
		const fi = v.indexOf(from);
		const ti = v.indexOf(k);
		if (fi === -1) return;
		v.splice(fi, 1);
		v.splice(ti === -1 ? v.length : ti, 0, from);
		visible = v;
		dragKey = null;
		onchange?.();
	}
</script>

<Popover width={260} align="right">
	{#snippet trigger({ open, toggle: t })}
		<button class="rk-tbtn {open ? 'active' : ''}" onclick={t} title="Gestionează coloane" aria-label="Gestionează coloane"><Columns size={15} /></button>
	{/snippet}
	{#snippet children()}
		<div class="rk-pop-pad" style="padding-bottom:6px">
			<div class="rk-pop-title">Coloane vizibile <span class="rk-muted2">· trage pentru reordonare</span></div>
		</div>
		<div class="rk-colmgr">
			{#each ordered as k (k)}
				{@const col = ALL_COLUMNS.find((c) => c.key === k)}
				{#if col}
					{@const on = isOn(k)}
					<div
						class="rk-colrow {on ? '' : 'off'}"
						draggable={on}
						ondragstart={() => (dragKey = k)}
						ondragover={(e) => on && e.preventDefault()}
						ondrop={() => onDrop(k)}
						role="listitem">
						{#if on}<span class="rk-colgrip"><GripVertical size={13} /></span>{:else}<span class="rk-colgrip"></span>{/if}
						<button class="rk-colcheck-wrap" onclick={() => toggle(k)}>
							<span class="rk-check {on ? 'on' : ''}">{#if on}<Check size={11} />{/if}</span>
							<span class="rk-collabel">{col.label}</span>
						</button>
					</div>
				{/if}
			{/each}
		</div>
	{/snippet}
</Popover>
