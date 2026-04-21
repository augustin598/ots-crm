<script lang="ts">
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogHeader,
		DialogTitle
	} from '$lib/components/ui/dialog';
	import { Badge } from '$lib/components/ui/badge';
	import PercentIcon from '@lucide/svelte/icons/percent';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import ShoppingCartIcon from '@lucide/svelte/icons/shopping-cart';
	import TargetIcon from '@lucide/svelte/icons/target';
	import MapPinIcon from '@lucide/svelte/icons/map-pin';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import StarIcon from '@lucide/svelte/icons/star';
	import CategoryIcon from './CategoryIcon.svelte';
	import {
		BUNDLES,
		BUNDLE_TIERS_RULE,
		USE_CASES,
		getCategory,
		type UseCase,
		type Bundle
	} from '$lib/constants/ots-catalog';

	type Props = {
		open: boolean;
	};

	let { open = $bindable() }: Props = $props();

	function bundlesForUseCase(useCase: UseCase): Bundle[] {
		return BUNDLES.filter((b) => b.useCase === useCase);
	}

	function silverTotal(services: string[]): number {
		return services.reduce((sum, slug) => {
			const cat = getCategory(slug);
			return sum + (cat?.prices.silver ?? 0);
		}, 0);
	}

	function estimateSavings(services: string[], discountPct: number): number {
		return Math.round((silverTotal(services) * discountPct) / 100);
	}

	function formatEur(value: number): string {
		return `${value.toLocaleString('ro-RO')} €`;
	}

	function categoryName(slug: string): string {
		return getCategory(slug)?.name || slug;
	}

	function useCaseIcon(icon: string) {
		switch (icon) {
			case 'sparkles':
				return SparklesIcon;
			case 'shopping-cart':
				return ShoppingCartIcon;
			case 'target':
				return TargetIcon;
			case 'map-pin':
				return MapPinIcon;
			case 'refresh-cw':
				return RefreshCwIcon;
			case 'layers':
				return LayersIcon;
			default:
				return SparklesIcon;
		}
	}

	function badgeLabel(badge?: string): string {
		switch (badge) {
			case 'popular':
				return 'Popular';
			case 'best-value':
				return 'Best Value';
			case 'new':
				return 'Nou';
			default:
				return '';
		}
	}

	function badgeClass(badge?: string): string {
		switch (badge) {
			case 'popular':
				return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300';
			case 'best-value':
				return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300';
			case 'new':
				return 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300';
			default:
				return '';
		}
	}
</script>

<Dialog bind:open>
	<DialogContent class="sm:max-w-5xl max-h-[92vh] overflow-y-auto">
		<DialogHeader>
			<div class="flex items-center gap-3">
				<div class="rounded-lg bg-primary/10 p-2.5 shrink-0">
					<PercentIcon class="h-5 w-5 text-primary" />
				</div>
				<div class="min-w-0">
					<DialogTitle class="text-xl">Discount multi-servicii</DialogTitle>
					<DialogDescription>
						Contractezi 2+ servicii simultan → prețul scade automat. Alege combinația după obiectiv.
					</DialogDescription>
				</div>
			</div>
		</DialogHeader>

		<section class="mt-5 mb-8">
			<h3 class="text-xs font-semibold mb-3 text-muted-foreground uppercase tracking-wider">
				Regula generală
			</h3>
			<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
				{#each BUNDLE_TIERS_RULE as rule (rule.minServices)}
					<div class="rounded-lg border p-4 bg-card">
						<div class="text-3xl font-bold text-primary leading-none">−{rule.discountPct}%</div>
						<p class="text-sm text-muted-foreground mt-1.5">{rule.label}</p>
					</div>
				{/each}
			</div>
			<p class="text-xs text-muted-foreground mt-3">
				Discountul se aplică pe totalul lunar al serviciilor (nu pe bugetul media Ads sau costul
				platformelor externe).
			</p>
		</section>

		{#each USE_CASES as useCase (useCase.id)}
			{@const bundles = bundlesForUseCase(useCase.id)}
			{#if bundles.length > 0}
				{@const Icon = useCaseIcon(useCase.icon)}
				<section class="mb-8">
					<div class="flex items-center gap-3 mb-4">
						<div class="rounded-lg p-2 {useCase.accent}">
							<Icon class="h-4 w-4" />
						</div>
						<div class="min-w-0">
							<h3 class="text-base font-semibold leading-tight">{useCase.label}</h3>
							<p class="text-xs text-muted-foreground mt-0.5">{useCase.description}</p>
						</div>
					</div>

					<div class="grid gap-4 sm:grid-cols-2">
						{#each bundles as bundle (bundle.id)}
							{@const total = silverTotal(bundle.services)}
							{@const savings = estimateSavings(bundle.services, bundle.discountPct)}
							<div
								class="rounded-lg border p-5 hover:border-primary/50 hover:shadow-sm transition-all bg-card"
							>
								<div class="flex items-start justify-between gap-3 mb-3">
									<div class="min-w-0 flex-1">
										<div class="flex items-center gap-2 flex-wrap mb-0.5">
											<h4 class="font-semibold text-base">{bundle.name}</h4>
											{#if bundle.badge}
												<Badge class={badgeClass(bundle.badge)}>
													{#if bundle.badge === 'best-value'}
														<StarIcon class="h-3 w-3 mr-0.5" />
													{/if}
													{badgeLabel(bundle.badge)}
												</Badge>
											{/if}
										</div>
										<p class="text-xs text-muted-foreground">{bundle.tagline}</p>
									</div>
									<div class="text-right shrink-0">
										<div class="text-2xl font-bold text-primary leading-none">
											−{bundle.discountPct}%
										</div>
									</div>
								</div>

								<div class="flex flex-wrap gap-1.5 mb-3">
									{#each bundle.services as slug (slug)}
										<span
											class="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md bg-muted"
										>
											<CategoryIcon {slug} class="h-3.5 w-3.5" />
											{categoryName(slug)}
										</span>
									{/each}
								</div>

								<p class="text-xs text-muted-foreground leading-relaxed mb-3">
									{bundle.rationale}
								</p>

								<div
									class="pt-3 border-t flex items-baseline justify-between gap-2 text-xs flex-wrap"
								>
									<span class="text-muted-foreground">
										Ex. Silver:
										<span class="text-foreground font-medium">{formatEur(total)}/lună</span>
									</span>
									<span class="text-primary font-semibold">
										Economisești ~{formatEur(savings)}/lună
									</span>
								</div>
							</div>
						{/each}
					</div>
				</section>
			{/if}
		{/each}

		<section class="rounded-lg bg-muted/40 p-4">
			<p class="text-sm font-medium mb-2">Nu găsești combinația ideală?</p>
			<p class="text-xs text-muted-foreground leading-relaxed">
				Bundle-urile de mai sus sunt recomandări pre-curatate. Orice combinație de 2+ servicii
				primește discount automat — trimite cereri din catalog și menționează în notă că vrei
				bundle. Echipa OTS confirmă discountul final în ofertă (poate fi peste procentul de bază
				pentru bugete mari).
			</p>
		</section>
	</DialogContent>
</Dialog>
