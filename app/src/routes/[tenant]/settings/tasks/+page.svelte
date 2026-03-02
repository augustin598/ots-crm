<script lang="ts">
	import { getTaskSettings, updateTaskSettings } from '$lib/remotes/task-settings.remote';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import { Switch } from '$lib/components/ui/switch';
	import { CheckSquare, Mail, Bell, Users } from '@lucide/svelte';

	const settingsQuery = getTaskSettings();
	const settings = $derived(settingsQuery.current);
	const loading = $derived(settingsQuery.loading);
	const error = $derived(settingsQuery.error);

	// Internal notifications
	let taskRemindersEnabled = $state(true);
	let internalEmailOnComment = $state(true);

	// Client notifications
	let clientEmailsEnabled = $state(false);
	let clientEmailOnTaskCreated = $state(true);
	let clientEmailOnStatusChange = $state(true);
	let clientEmailOnComment = $state(true);
	let clientEmailOnTaskModified = $state(true);

	let saving = $state(false);
	let saveError = $state<string | null>(null);
	let saveSuccess = $state(false);

	// Update local state when settings load
	$effect(() => {
		if (settings) {
			taskRemindersEnabled = settings.taskRemindersEnabled ?? true;
			internalEmailOnComment = settings.internalEmailOnComment ?? true;
			clientEmailsEnabled = settings.clientEmailsEnabled ?? false;
			clientEmailOnTaskCreated = settings.clientEmailOnTaskCreated ?? true;
			clientEmailOnStatusChange = settings.clientEmailOnStatusChange ?? true;
			clientEmailOnComment = settings.clientEmailOnComment ?? true;
			clientEmailOnTaskModified = settings.clientEmailOnTaskModified ?? true;
		}
	});

	async function handleSubmit() {
		saving = true;
		saveError = null;
		saveSuccess = false;

		try {
			await updateTaskSettings({
				taskRemindersEnabled,
				internalEmailOnComment,
				clientEmailsEnabled,
				clientEmailOnTaskCreated,
				clientEmailOnStatusChange,
				clientEmailOnComment,
				clientEmailOnTaskModified
			}).updates(settingsQuery);
			saveSuccess = true;
			setTimeout(() => {
				saveSuccess = false;
			}, 3000);
		} catch (e) {
			saveError = e instanceof Error ? e.message : 'Failed to update task settings';
		} finally {
			saving = false;
		}
	}
</script>

<p class="text-muted-foreground mb-6">
	Configurează setările pentru taskuri, inclusiv notificările email către clienți și echipă.
</p>

<form
	onsubmit={(e) => {
		e.preventDefault();
		handleSubmit();
	}}
	class="space-y-6"
>
	<!-- Client Email Notifications -->
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<Mail class="h-5 w-5" />
				Notificări Email Către Client
			</CardTitle>
			<CardDescription>
				Trimite emailuri automate clientului asociat taskului pentru a-l ține la curent cu progresul.
			</CardDescription>
		</CardHeader>
		<CardContent>
			{#if loading}
				<div class="animate-pulse space-y-4">
					<div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
					<div class="h-10 bg-gray-200 dark:bg-gray-700 rounded"></div>
				</div>
			{:else}
				<div class="space-y-6">
					<div class="flex items-center justify-between">
						<div class="space-y-0.5">
							<Label for="clientEmailsEnabled" class="text-base font-semibold">
								Emailuri către Client (Master)
							</Label>
							<p class="text-xs text-muted-foreground">
								Activează/dezactivează toate emailurile către clienți. Când este oprit, niciun email nu va fi trimis.
							</p>
						</div>
						<Switch id="clientEmailsEnabled" bind:checked={clientEmailsEnabled} />
					</div>

					{#if clientEmailsEnabled}
						<Separator />

						<div class="space-y-4 pl-4 border-l-2 border-blue-200 dark:border-blue-800">
							<div class="flex items-center justify-between">
								<div class="space-y-0.5">
									<Label for="clientEmailOnTaskCreated">Task Creat</Label>
									<p class="text-xs text-muted-foreground">
										Notifică clientul când se creează un task nou pentru el
									</p>
								</div>
								<Switch id="clientEmailOnTaskCreated" bind:checked={clientEmailOnTaskCreated} />
							</div>

							<div class="flex items-center justify-between">
								<div class="space-y-0.5">
									<Label for="clientEmailOnStatusChange">Status Schimbat</Label>
									<p class="text-xs text-muted-foreground">
										Notifică la schimbarea statusului (început, finalizat, anulat, etc.)
									</p>
								</div>
								<Switch id="clientEmailOnStatusChange" bind:checked={clientEmailOnStatusChange} />
							</div>

							<div class="flex items-center justify-between">
								<div class="space-y-0.5">
									<Label for="clientEmailOnComment">Comentariu Adăugat</Label>
									<p class="text-xs text-muted-foreground">
										Notifică clientul când cineva lasă un comentariu pe task
									</p>
								</div>
								<Switch id="clientEmailOnComment" bind:checked={clientEmailOnComment} />
							</div>

							<div class="flex items-center justify-between">
								<div class="space-y-0.5">
									<Label for="clientEmailOnTaskModified">Task Modificat</Label>
									<p class="text-xs text-muted-foreground">
										Notifică la modificarea detaliilor (prioritate, termen, descriere)
									</p>
								</div>
								<Switch id="clientEmailOnTaskModified" bind:checked={clientEmailOnTaskModified} />
							</div>
						</div>
					{/if}
				</div>
			{/if}
		</CardContent>
	</Card>

	<!-- Internal Notifications -->
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<Users class="h-5 w-5" />
				Notificări Interne
			</CardTitle>
			<CardDescription>
				Setări pentru notificările trimise echipei interne (watchers, persoane asignate).
			</CardDescription>
		</CardHeader>
		<CardContent>
			{#if loading}
				<div class="animate-pulse space-y-4">
					<div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
					<div class="h-10 bg-gray-200 dark:bg-gray-700 rounded"></div>
				</div>
			{:else}
				<div class="space-y-4">
					<div class="flex items-center justify-between">
						<div class="space-y-0.5">
							<Label for="taskRemindersEnabled">Task Reminders</Label>
							<p class="text-xs text-muted-foreground">
								Trimite remindere automate pentru taskuri cu termen în următoarele 24 ore
							</p>
						</div>
						<Switch id="taskRemindersEnabled" bind:checked={taskRemindersEnabled} />
					</div>

					<div class="flex items-center justify-between">
						<div class="space-y-0.5">
							<Label for="internalEmailOnComment">Notificare Watchers la Comentarii</Label>
							<p class="text-xs text-muted-foreground">
								Trimite email watcherilor când cineva adaugă un comentariu pe task
							</p>
						</div>
						<Switch id="internalEmailOnComment" bind:checked={internalEmailOnComment} />
					</div>
				</div>
			{/if}
		</CardContent>
	</Card>

	<!-- Save Section -->
	{#if saveError}
		<div class="rounded-md bg-red-50 dark:bg-red-900/20 p-3">
			<p class="text-sm text-red-800 dark:text-red-200">{saveError}</p>
		</div>
	{/if}

	{#if saveSuccess}
		<div class="rounded-md bg-green-50 dark:bg-green-900/20 p-3">
			<p class="text-sm text-green-800 dark:text-green-200">Setările au fost salvate cu succes!</p>
		</div>
	{/if}

	<div class="flex gap-2">
		<Button type="submit" disabled={saving}>
			{saving ? 'Se salvează...' : 'Salvează Setări'}
		</Button>
	</div>
</form>
