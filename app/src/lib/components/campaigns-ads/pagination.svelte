<script lang="ts">
	import IconChevronLeft from '@lucide/svelte/icons/chevron-left';
	import IconChevronRight from '@lucide/svelte/icons/chevron-right';

	interface Props {
		total: number;
		page: number;
		pageSize: number;
		onPage: (n: number) => void;
		onPageSize: (n: number) => void;
	}

	let { total, page, pageSize, onPage, onPageSize }: Props = $props();

	const pages = $derived(Math.max(1, Math.ceil(total / pageSize)));
	const from = $derived(total === 0 ? 0 : (page - 1) * pageSize + 1);
	const to = $derived(Math.min(page * pageSize, total));
	const win = $derived.by(() => {
		const arr: number[] = [];
		const push = (n: number) => {
			if (!arr.includes(n) && n >= 1 && n <= pages) arr.push(n);
		};
		push(1);
		for (let n = page - 1; n <= page + 1; n++) push(n);
		push(pages);
		arr.sort((a, b) => a - b);
		return arr;
	});
</script>

<div class="pagination">
	<span>Afișează <strong>{from}–{to}</strong> din <strong>{total}</strong></span>
	<label class="page-size">
		pe pagină
		<select value={pageSize} onchange={(e) => onPageSize(Number(e.currentTarget.value))}>
			{#each [8, 15, 25, 50] as n (n)}
				<option value={n}>{n}</option>
			{/each}
		</select>
	</label>
	<div class="pg-spacer"></div>
	<button class="page-btn" disabled={page === 1} onclick={() => onPage(page - 1)} title="Pagina anterioară">
		<IconChevronLeft size={14} />
	</button>
	{#each win as n, i (n)}
		{#if i > 0 && n - win[i - 1] > 1}<span class="page-gap">…</span>{/if}
		<button class={['page-btn', page === n && 'active']} onclick={() => onPage(n)}>{n}</button>
	{/each}
	<button class="page-btn" disabled={page === pages} onclick={() => onPage(page + 1)} title="Pagina următoare">
		<IconChevronRight size={14} />
	</button>
</div>

<style>
	.page-size {
		margin-left: 14px;
	}
	.pg-spacer {
		flex: 1;
	}
</style>
