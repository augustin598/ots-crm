<script lang="ts">
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogHeader,
		DialogTitle
	} from '$lib/components/ui/dialog';
	import CheckIcon from '@lucide/svelte/icons/check';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import { TIERS, TIER_LABELS, TIER_COLORS, type Tier } from '$lib/constants/ots-catalog';

	type Props = {
		open: boolean;
	};

	let { open = $bindable() }: Props = $props();

	type Row = { label: string; values: Record<Tier, string | boolean | number> };

	const BUDGET_RANGES: Record<Tier, string> = {
		bronze: 'Sub 500 €',
		silver: '500 – 1.500 €',
		gold: '1.500 – 5.000 €',
		platinum: 'Peste 5.000 €'
	};

	const TAGLINES: Record<Tier, string> = {
		bronze: 'Start minimal, 1-2 canale, focus pe optimizare atentă.',
		silver: 'Pragul recomandat — date statistice pentru A/B, multi-raportare.',
		gold: 'Multi-canal, consultanță dedicată, raportare premium.',
		platinum: 'Enterprise, integrări custom, suport strategic săptămânal.'
	};

	const ROWS: Row[] = [
		{
			label: 'Buget media recomandat',
			values: {
				bronze: BUDGET_RANGES.bronze,
				silver: BUDGET_RANGES.silver,
				gold: BUDGET_RANGES.gold,
				platinum: BUDGET_RANGES.platinum
			}
		},
		{
			label: 'Frecvență raportare în CRM',
			values: { bronze: 'Lunar', silver: 'Săptămânal', gold: 'Săptămânal + custom', platinum: 'Real-time + custom' }
		},
		{
			label: 'A/B testing inclus',
			values: { bronze: false, silver: true, gold: true, platinum: true }
		},
		{
			label: 'Suport clienți',
			values: {
				bronze: 'E-mail',
				silver: 'E-mail',
				gold: 'E-mail + telefon',
				platinum: 'E-mail + telefon + meeting săpt.'
			}
		},
		{
			label: 'Consultanță strategie',
			values: { bronze: false, silver: false, gold: true, platinum: 'Săptămânal' }
		},
		{
			label: 'Useri CRM echipa client',
			values: { bronze: 1, silver: 2, gold: 5, platinum: 'Nelimitat' }
		},
		{
			label: 'Integrări custom (Slack, WhatsApp, BI)',
			values: { bronze: false, silver: false, gold: false, platinum: true }
		},
		{
			label: 'Rapoarte personalizate (KPI custom)',
			values: { bronze: false, silver: false, gold: true, platinum: true }
		}
	];

	function renderCell(value: string | boolean | number): { type: 'bool' | 'text'; value: string | boolean } {
		if (typeof value === 'boolean') return { type: 'bool', value };
		return { type: 'text', value: String(value) };
	}
</script>

<Dialog bind:open>
	<DialogContent class="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
		<DialogHeader>
			<DialogTitle>Pachetele pe scurt</DialogTitle>
			<DialogDescription>
				Bronze → Silver → Gold → Platinum corespund bugetelor de media și complexității setup-ului.
				Aici vezi doar diferențele principale. Detaliile complete per serviciu sunt în catalog.
			</DialogDescription>
		</DialogHeader>

		<!-- Tier cards row -->
		<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 my-5">
			{#each TIERS as tier (tier)}
				{@const colors = TIER_COLORS[tier]}
				<div
					class="relative rounded-lg border {colors.border} {colors.metallic} p-4 overflow-hidden"
				>
					<div
						class="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/50 to-transparent dark:from-white/10"
					></div>
					<div class="relative">
						<div class="flex items-center gap-2 mb-1.5">
							<span class="h-2 w-2 rounded-full {colors.dot}"></span>
							<span class="font-semibold {colors.text}">{TIER_LABELS[tier]}</span>
						</div>
						<div class="text-xs {colors.text} opacity-80 mb-2">{BUDGET_RANGES[tier]}</div>
						<p class="text-xs {colors.text} opacity-90 leading-snug">{TAGLINES[tier]}</p>
					</div>
				</div>
			{/each}
		</div>

		<!-- Comparison table -->
		<div class="overflow-x-auto rounded-lg border">
			<table class="w-full text-sm">
				<thead class="bg-muted/40">
					<tr>
						<th class="text-left px-3 py-2 text-xs font-medium text-muted-foreground">
							Ce primești
						</th>
						{#each TIERS as tier (tier)}
							{@const colors = TIER_COLORS[tier]}
							<th class="px-3 py-2 text-xs font-semibold text-center {colors.text}">
								<div class="inline-flex items-center gap-1.5">
									<span class="h-1.5 w-1.5 rounded-full {colors.dot}"></span>
									{TIER_LABELS[tier]}
								</div>
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each ROWS as row (row.label)}
						<tr class="border-t">
							<td class="px-3 py-2">{row.label}</td>
							{#each TIERS as tier (tier)}
								{@const cell = renderCell(row.values[tier])}
								<td class="px-3 py-2 text-center">
									{#if cell.type === 'bool'}
										{#if cell.value === true}
											<CheckIcon class="mx-auto h-3.5 w-3.5 text-green-600 dark:text-green-400" />
										{:else}
											<MinusIcon class="mx-auto h-3.5 w-3.5 text-muted-foreground/30" />
										{/if}
									{:else}
										<span class="font-medium text-xs">{cell.value}</span>
									{/if}
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<p class="text-xs text-muted-foreground mt-4">
			Asta e doar diferența „mare" între pachete. Fiecare serviciu (Google Ads, SEO, etc.) are
			propria matrice de ~20-25 features per pachet — le vezi complet când apeși pe o categorie din
			catalog.
		</p>
	</DialogContent>
</Dialog>
