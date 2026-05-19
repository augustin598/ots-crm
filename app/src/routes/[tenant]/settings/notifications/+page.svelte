<script lang="ts">
	import {
		getTenantUserPreferences,
		updateTenantUserPreferences
	} from '$lib/remotes/tenant-user-preferences.remote';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { Bell } from '@lucide/svelte';

	const prefsQuery = getTenantUserPreferences();
	const prefs = $derived(prefsQuery.current);
	const loading = $derived(prefsQuery.loading);
	const queryError = $derived(prefsQuery.error);

	let notifyTaskAssigned = $state(true);
	let notifyNewComment = $state(true);
	let notifyTaskStatusChange = $state(true);
	let notifyTaskApprovedRejected = $state(true);
	let notifyTaskReopened = $state(true);
	let notifyMention = $state(true);

	let saving = $state(false);
	let saveError = $state<string | null>(null);
	let saveSuccess = $state(false);

	$effect(() => {
		if (prefs) {
			notifyTaskAssigned = prefs.notifyTaskAssigned;
			notifyNewComment = prefs.notifyNewComment;
			notifyTaskStatusChange = prefs.notifyTaskStatusChange;
			notifyTaskApprovedRejected = prefs.notifyTaskApprovedRejected;
			notifyTaskReopened = prefs.notifyTaskReopened;
			notifyMention = prefs.notifyMention;
		}
	});

	async function handleSubmit() {
		saving = true;
		saveError = null;
		saveSuccess = false;
		try {
			await updateTenantUserPreferences({
				notifyTaskAssigned,
				notifyNewComment,
				notifyTaskStatusChange,
				notifyTaskApprovedRejected,
				notifyTaskReopened,
				notifyMention
			}).updates(prefsQuery);
			saveSuccess = true;
			setTimeout(() => {
				saveSuccess = false;
			}, 3000);
		} catch (e) {
			saveError = e instanceof Error ? e.message : 'Salvarea a eșuat';
		} finally {
			saving = false;
		}
	}
</script>

<div class="space-y-6">
	<div class="flex items-center gap-2">
		<Bell class="h-6 w-6" />
		<h2 class="text-2xl font-bold">Notificări</h2>
	</div>

	<Card>
		<CardHeader>
			<CardTitle>Notificări email</CardTitle>
			<CardDescription>
				Alege ce notificări email vrei să primești pentru task-uri. Setările se aplică doar
				pentru contul tău în acest tenant.
			</CardDescription>
		</CardHeader>
		<CardContent class="space-y-6">
			{#if loading}
				<p class="text-sm text-muted-foreground">Se încarcă...</p>
			{:else if queryError}
				<p class="text-sm text-destructive">
					Nu s-au putut încărca setările: {queryError instanceof Error
						? queryError.message
						: 'Eroare necunoscută'}
				</p>
			{:else}
				<div class="flex items-center justify-between gap-4">
					<div class="space-y-1">
						<Label for="notify-task-assigned">Notificare la asignare task</Label>
						<p class="text-sm text-muted-foreground">
							Primește email când ți se asignează un task nou.
						</p>
					</div>
					<Switch id="notify-task-assigned" bind:checked={notifyTaskAssigned} />
				</div>

				<div class="flex items-center justify-between gap-4">
					<div class="space-y-1">
						<Label for="notify-new-comment">Notificare la comentariu nou</Label>
						<p class="text-sm text-muted-foreground">
							Primește email când cineva comentează la un task pe care îl urmărești.
						</p>
					</div>
					<Switch id="notify-new-comment" bind:checked={notifyNewComment} />
				</div>

				<div class="flex items-center justify-between gap-4">
					<div class="space-y-1">
						<Label for="notify-task-status-change">Notificare la schimbare status</Label>
						<p class="text-sm text-muted-foreground">
							Primește email când statusul unui task pe care îl urmărești se schimbă.
						</p>
					</div>
					<Switch id="notify-task-status-change" bind:checked={notifyTaskStatusChange} />
				</div>

				<div class="flex items-center justify-between gap-4">
					<div class="space-y-1">
						<Label for="notify-task-approved-rejected">
							Notificare la aprobare/respingere
						</Label>
						<p class="text-sm text-muted-foreground">
							Primește email când un task de-al tău este aprobat sau respins.
						</p>
					</div>
					<Switch
						id="notify-task-approved-rejected"
						bind:checked={notifyTaskApprovedRejected}
					/>
				</div>

				<div class="flex items-center justify-between gap-4">
					<div class="space-y-1">
						<Label for="notify-task-reopened">Notificare la redeschidere task</Label>
						<p class="text-sm text-muted-foreground">
							Primește email când un task este redeschis pentru re-aprobare.
						</p>
					</div>
					<Switch id="notify-task-reopened" bind:checked={notifyTaskReopened} />
				</div>

				<div class="flex items-center justify-between gap-4">
					<div class="space-y-1">
						<Label for="notify-mention">Notificare la menționare</Label>
						<p class="text-sm text-muted-foreground">
							Primește email când cineva te menționează într-un comentariu (@nume).
						</p>
					</div>
					<Switch id="notify-mention" bind:checked={notifyMention} />
				</div>

				<div class="flex flex-col gap-3 pt-2">
					<div class="flex items-center gap-3">
						<Button onclick={handleSubmit} disabled={saving}>
							{saving ? 'Se salvează...' : 'Salvează setări'}
						</Button>
						{#if saveSuccess}
							<span class="text-sm text-green-600">Setările au fost salvate.</span>
						{/if}
					</div>
					{#if saveError}
						<p class="text-sm text-destructive">{saveError}</p>
					{/if}
				</div>
			{/if}
		</CardContent>
	</Card>
</div>
