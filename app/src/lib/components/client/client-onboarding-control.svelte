<script lang="ts">
	import {
		getClientUsersOnboardingStatus,
		toggleClientOnboardingTour,
		resetClientOnboardingTour
	} from '$lib/remotes/client-user-preferences.remote';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Switch } from '$lib/components/ui/switch';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { toast } from 'svelte-sonner';
	import CompassIcon from '@lucide/svelte/icons/compass';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';

	let { clientId }: { clientId: string } = $props();

	const statusQuery = $derived(getClientUsersOnboardingStatus(clientId));
	const users = $derived(statusQuery.current || []);
	const loading = $derived(statusQuery.loading);
	const error = $derived(statusQuery.error);

	let toggling = $state<string | null>(null);
	let resetting = $state<string | null>(null);

	async function handleToggle(clientUserId: string, enabled: boolean) {
		toggling = clientUserId;
		try {
			await toggleClientOnboardingTour({ clientUserId, enabled }).updates(statusQuery);
			toast.success(enabled ? 'Tour activat' : 'Tour dezactivat');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		} finally {
			toggling = null;
		}
	}

	async function handleReset(clientUserId: string) {
		resetting = clientUserId;
		try {
			await resetClientOnboardingTour({ clientUserId }).updates(statusQuery);
			toast.success('Tour resetat cu succes');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		} finally {
			resetting = null;
		}
	}

	function getStatusBadge(user: (typeof users)[number]) {
		if (!user.onboardingTourEnabled) return { label: 'Dezactivat', variant: 'secondary' as const };
		if (user.onboardingTourCompleted) return { label: 'Completat', variant: 'success' as const };
		const checklist = user.onboardingChecklist ? JSON.parse(user.onboardingChecklist) : {};
		const visited = Object.values(checklist).filter(Boolean).length;
		if (visited > 0) return { label: `${visited} vizitate`, variant: 'default' as const };
		return { label: 'Nepornit', variant: 'outline' as const };
	}
</script>

<Card class="md:col-span-2">
	<CardHeader>
		<CardTitle class="flex items-center gap-2">
			<CompassIcon class="h-5 w-5" />
			Onboarding Wizard
		</CardTitle>
		<CardDescription>Controlează turul ghidat pentru fiecare utilizator al clientului.</CardDescription>
	</CardHeader>
	<CardContent>
		{#if loading}
			<div class="animate-pulse space-y-3">
				<div class="h-10 bg-muted rounded"></div>
			</div>
		{:else if error}
			<p class="text-sm text-destructive">
				Eroare la încărcarea utilizatorilor. Verificați dacă migrațiile DB au fost aplicate.
			</p>
		{:else if users.length === 0}
			<p class="text-sm text-muted-foreground">Niciun utilizator client înregistrat.</p>
		{:else}
			<div class="space-y-3">
				{#each users as user (user.clientUserId)}
					{@const status = getStatusBadge(user)}
					<div class="flex items-center justify-between p-3 rounded-lg border">
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2">
								<p class="text-sm font-medium truncate">
									{user.firstName || ''} {user.lastName || ''}
									{#if user.isPrimary}
										<Badge variant="outline" class="ml-1 text-xs">Primary</Badge>
									{/if}
								</p>
							</div>
							<p class="text-xs text-muted-foreground truncate">{user.email}</p>
						</div>
						<div class="flex items-center gap-3 shrink-0">
							<Badge variant={status.variant}>{status.label}</Badge>
							<Switch
								checked={user.onboardingTourEnabled}
								disabled={toggling === user.clientUserId}
								onCheckedChange={(checked) => handleToggle(user.clientUserId, checked)}
							/>
							<Button
								variant="ghost"
								size="sm"
								title="Resetează tour"
								disabled={resetting === user.clientUserId}
								onclick={() => handleReset(user.clientUserId)}
							>
								<RotateCcwIcon class="h-3.5 w-3.5" />
							</Button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</CardContent>
</Card>
