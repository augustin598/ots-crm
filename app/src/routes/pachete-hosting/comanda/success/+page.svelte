<script lang="ts">
	import '../../../layout.css';
	import { page } from '$app/state';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import CheckCircleIcon from '@lucide/svelte/icons/check-circle';

	const sessionId = $derived(page.url.searchParams.get('session_id'));
</script>

<svelte:head>
	<title>Plată reușită — One Top Solution</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="min-h-screen bg-slate-50 dark:bg-slate-950">
	<main class="mx-auto max-w-2xl px-4 py-16">
		<Card>
			<CardContent class="py-12 text-center">
				<div class="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900/30">
					<CheckCircleIcon class="size-10" />
				</div>
				<h1 class="text-2xl font-bold">Plata confirmată!</h1>
				<p class="mt-3 text-muted-foreground">
					Mulțumim! Plata a fost procesată cu succes. În câteva minute vei primi pe email:
				</p>
				<ul class="mt-4 inline-block space-y-1 text-left text-sm text-muted-foreground">
					<li>✓ Factura fiscală</li>
					<li>✓ Link de acces în portalul client</li>
					<li>✓ Detalii de activare cont hosting</li>
				</ul>
				<p class="mt-6 text-sm text-muted-foreground">
					Echipa noastră va activa contul tău de hosting în maxim 24h și te va contacta pentru
					configurări specifice.
				</p>
				{#if sessionId}
					<p class="mt-4 font-mono text-xs text-slate-400">
						Referință plată: {sessionId.slice(0, 20)}...
					</p>
				{/if}
				<div class="mt-8 flex justify-center gap-2">
					<Button href="/login" variant="outline">Conectează-te</Button>
					<Button href="/pachete-hosting">Înapoi la site</Button>
				</div>
			</CardContent>
		</Card>
	</main>
</div>
