<script lang="ts">
	import { Card } from '$lib/components/ui/card';

	let { count = 8 }: { count?: number } = $props();
</script>

<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
	{#each Array(count) as _, i (i)}
		<Card class="overflow-hidden border-l-4 border-l-muted">
			<!-- Thumbnail skeleton -->
			<div class="aspect-video bg-muted animate-pulse"></div>
			<!-- Info skeleton -->
			<div class="px-3 py-2 space-y-2">
				<div class="flex items-center gap-1.5">
					<div class="h-5 w-5 rounded bg-muted animate-pulse shrink-0"></div>
					<div class="h-3.5 bg-muted animate-pulse rounded flex-1"></div>
				</div>
				<div class="h-3 bg-muted animate-pulse rounded w-2/3 ml-6.5"></div>
				<div class="flex items-center justify-between pt-1 border-t border-border/50">
					<div class="flex items-center gap-1.5">
						<div class="h-1.5 w-1.5 rounded-full bg-muted animate-pulse"></div>
						<div class="h-2.5 w-10 bg-muted animate-pulse rounded"></div>
						<div class="h-2.5 w-12 bg-muted animate-pulse rounded"></div>
					</div>
					<div class="h-2.5 w-16 bg-muted animate-pulse rounded"></div>
				</div>
			</div>
		</Card>
	{/each}
</div>
