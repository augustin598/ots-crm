<script lang="ts">
	import GateShell from '$lib/components/brand/GateShell.svelte';
</script>

<svelte:head>
	<title>Verifying Magic Link - OTS CRM</title>
</svelte:head>

<GateShell>
	<div class="ots-gate-card text-center">
		<div class="flex items-center justify-center pb-6 pt-2">
			<div class="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
		</div>
		<h1 class="text-2xl font-bold tracking-tight">Verifying your magic link</h1>
		<p class="mt-2 text-sm text-muted-foreground">Please wait while we verify your login link...</p>
	</div>
</GateShell>
