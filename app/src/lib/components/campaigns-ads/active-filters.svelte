<script lang="ts">
	import IconX from '@lucide/svelte/icons/x';
	import {
		insightRuleById,
		objectiveLabel,
		statusMeta,
		type CampaignFilters
	} from '$lib/utils/meta-campaigns';

	interface Props {
		filters: CampaignFilters;
		accountLabel: string | null;
		resultCount: number;
		total: number;
		onRemove: (key: keyof CampaignFilters) => void;
		onClearAll: () => void;
	}

	let { filters, accountLabel, resultCount, total, onRemove, onClearAll }: Props = $props();

	const labelFor = (key: keyof CampaignFilters, v: string): string => {
		switch (key) {
			case 'q':
				return `«${v}»`;
			case 'status':
				return `Status: ${statusMeta(v).label}`;
			case 'objective':
				return `Obiectiv: ${objectiveLabel(v)}`;
			case 'insight':
				return insightRuleById[v]?.label ?? v;
		}
	};

	const FILTER_KEYS: Array<keyof CampaignFilters> = ['q', 'status', 'objective', 'insight'];
	const items = $derived(FILTER_KEYS.filter((k) => filters[k]));
</script>

{#if items.length > 0}
	<div class="active-filters">
		<span class="af-lead">
			{resultCount} din {total} campanii{accountLabel ? ` · ${accountLabel}` : ''}
		</span>
		{#each items as k (k)}
			<span class="af-pill">
				{labelFor(k, filters[k])}
				<button type="button" title="Elimină filtrul" onclick={() => onRemove(k)}>
					<IconX size={11} />
				</button>
			</span>
		{/each}
		<button type="button" class="af-clear" onclick={onClearAll}>Șterge toate</button>
	</div>
{/if}
