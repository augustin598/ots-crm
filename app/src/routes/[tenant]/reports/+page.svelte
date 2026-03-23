<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';

	const tenantSlug = $derived(page.params.tenant as string);

	$effect(() => {
		if (browser) {
			goto(`/${tenantSlug}/reports/facebook-ads`, { replaceState: true });
		}
	});
</script>

<div class="flex items-center justify-center h-48">
	<p class="text-muted-foreground">Se redirecționează...</p>
</div>
