<script lang="ts">
	import { getClientAiAccess, setClientContentAiAccess } from '$lib/remotes/client-ai-access.remote';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Switch } from '$lib/components/ui/switch';
	import { Badge } from '$lib/components/ui/badge';
	import { CLAUDE_USE_CASES } from '$lib/claude-usecases';
	import { toast } from 'svelte-sonner';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';

	let { clientId }: { clientId: string } = $props();

	// Deocamdată doar 'copywriting' (modulul Content) e conectat la portal; restul
	// use-case-urilor apar ca placeholdere dezactivate.
	const LIVE_USE_CASE = 'copywriting';

	const accessQuery = $derived(getClientAiAccess(clientId));
	const access = $derived(accessQuery.current);
	const loading = $derived(accessQuery.loading);
	const error = $derived(accessQuery.error);

	let saving = $state(false);

	async function toggleCopywriting(allow: boolean) {
		saving = true;
		try {
			await setClientContentAiAccess({ clientId, allow }).updates(accessQuery);
			toast.success(allow ? 'Content AI activat pentru client' : 'Content AI dezactivat');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la salvare');
		} finally {
			saving = false;
		}
	}
</script>

<Card>
	<CardHeader>
		<CardTitle class="flex items-center gap-2">
			<SparklesIcon class="h-5 w-5 text-primary" />
			Acces AI
		</CardTitle>
		<CardDescription>Alege ce utilizări AI poate folosi clientul în portal.</CardDescription>
	</CardHeader>
	<CardContent class="space-y-2">
		{#if loading && !access}
			<p class="text-sm text-muted-foreground">Se încarcă…</p>
		{:else if error}
			<p class="text-sm text-destructive">Nu am putut încărca accesul AI.</p>
		{:else}
			{#each CLAUDE_USE_CASES as uc (uc.id)}
				{@const isLive = uc.id === LIVE_USE_CASE}
				<div
					class="flex items-center justify-between gap-3 rounded-lg border p-3 {isLive
						? ''
						: 'opacity-60'}"
				>
					<div class="min-w-0">
						<div class="flex items-center gap-2">
							<p class="font-medium truncate">{uc.label}</p>
							{#if !isLive}
								<Badge variant="secondary" class="shrink-0">în curând</Badge>
							{:else if access && access.websiteCount > 0}
								<Badge variant="outline" class="shrink-0">
									{access.websiteCount}
									{access.websiteCount === 1 ? 'site' : 'site-uri'}
								</Badge>
							{/if}
						</div>
						<p class="text-xs text-muted-foreground truncate">{uc.hint}</p>
					</div>
					{#if isLive}
						<Switch
							checked={access?.copywriting ?? false}
							disabled={saving || !access || access.websiteCount === 0}
							onCheckedChange={(checked) => toggleCopywriting(checked)}
						/>
					{:else}
						<Switch checked={false} disabled />
					{/if}
				</div>
			{/each}
			{#if access && access.websiteCount === 0}
				<p class="text-xs text-muted-foreground">
					Clientul nu are website-uri configurate — adaugă unul în „Date client" înainte de a activa
					Content AI.
				</p>
			{/if}
		{/if}
	</CardContent>
</Card>
