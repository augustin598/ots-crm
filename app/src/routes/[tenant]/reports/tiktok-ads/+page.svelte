<script lang="ts">
	import { Card } from '$lib/components/ui/card';
	import BarChart3Icon from '@lucide/svelte/icons/bar-chart-3';
</script>

<div class="space-y-6">
	<div>
		<h1 class="text-3xl font-bold">TikTok Ads</h1>
		<p class="text-muted-foreground">Rapoarte performanță campanii TikTok Ads</p>
	</div>

	<Card class="p-12 text-center">
		<div class="flex flex-col items-center gap-4">
			<div class="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
				<BarChart3Icon class="h-8 w-8 text-muted-foreground" />
			</div>
			<div>
				<h3 class="text-lg font-semibold">În curând</h3>
				<p class="text-muted-foreground">Rapoartele TikTok Ads vor fi disponibile în curând.</p>
			</div>
		</div>
	</Card>
</div>
