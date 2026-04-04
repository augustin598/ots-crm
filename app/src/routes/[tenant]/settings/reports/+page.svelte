<script lang="ts">
	import {
		getReportSchedules,
		upsertReportSchedule,
		deleteReportSchedule
	} from '$lib/remotes/report-schedule.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import { Switch } from '$lib/components/ui/switch';
	import * as Select from '$lib/components/ui/select';
	import { toast } from 'svelte-sonner';
	import CalendarClockIcon from '@lucide/svelte/icons/calendar-clock';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import XIcon from '@lucide/svelte/icons/x';

	const schedulesQuery = getReportSchedules();
	const schedules = $derived(schedulesQuery.current ?? []);
	const loading = $derived(schedulesQuery.loading);

	const clientsQuery = getClients();
	const clients = $derived(clientsQuery.current ?? []);

	// Edit/create form state
	let editing = $state(false);
	let editingId = $state<string | null>(null);
	let saving = $state(false);

	let formClientId = $state('');
	let formFrequency = $state<'weekly' | 'monthly' | 'disabled'>('weekly');
	let formDayOfWeek = $state(1);
	let formDayOfMonth = $state(1);
	let formPlatforms = $state<string[]>(['meta', 'google', 'tiktok']);
	let formEmails = $state('');
	let formIsEnabled = $state(true);

	const dayNames: Record<number, string> = {
		1: 'Luni',
		2: 'Marți',
		3: 'Miercuri',
		4: 'Joi',
		5: 'Vineri',
		6: 'Sâmbătă',
		7: 'Duminică'
	};

	const platformLabels: Record<string, string> = {
		meta: 'Meta Ads',
		google: 'Google Ads',
		tiktok: 'TikTok Ads'
	};

	const frequencyLabels: Record<string, string> = {
		weekly: 'Săptămânal',
		monthly: 'Lunar',
		disabled: 'Dezactivat'
	};

	// Clients that don't already have a schedule (for "add new")
	const availableClients = $derived(
		editingId
			? clients // When editing, show all clients
			: clients.filter((c) => !schedules.some((s) => s.clientId === c.id))
	);

	function resetForm() {
		formClientId = '';
		formFrequency = 'weekly';
		formDayOfWeek = 1;
		formDayOfMonth = 1;
		formPlatforms = ['meta', 'google', 'tiktok'];
		formEmails = '';
		formIsEnabled = true;
		editing = false;
		editingId = null;
	}

	function startCreate() {
		resetForm();
		editing = true;
	}

	function startEdit(schedule: (typeof schedules)[0]) {
		editingId = schedule.id;
		formClientId = schedule.clientId;
		formFrequency = schedule.frequency as 'weekly' | 'monthly' | 'disabled';
		formDayOfWeek = schedule.dayOfWeek ?? 1;
		formDayOfMonth = schedule.dayOfMonth ?? 1;
		formPlatforms = [...schedule.platforms];
		formEmails = schedule.recipientEmails.join(', ');
		formIsEnabled = schedule.isEnabled;
		editing = true;
	}

	function togglePlatform(p: string) {
		if (formPlatforms.includes(p)) {
			if (formPlatforms.length > 1) {
				formPlatforms = formPlatforms.filter((x) => x !== p);
			}
		} else {
			formPlatforms = [...formPlatforms, p];
		}
	}

	function parseEmails(raw: string): string[] {
		return raw
			.split(/[,;\n]/)
			.map((e) => e.trim())
			.filter((e) => e.length > 0);
	}

	async function handleSave() {
		if (!formClientId) {
			toast.error('Selectează un client');
			return;
		}
		saving = true;
		try {
			await upsertReportSchedule({
				clientId: formClientId,
				frequency: formFrequency,
				dayOfWeek: formDayOfWeek,
				dayOfMonth: formDayOfMonth,
				platforms: formPlatforms as ('meta' | 'google' | 'tiktok')[],
				recipientEmails: parseEmails(formEmails),
				isEnabled: formIsEnabled
			}).updates(schedulesQuery);
			toast.success(editingId ? 'Programul a fost actualizat.' : 'Programul a fost creat.');
			resetForm();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la salvare.');
		} finally {
			saving = false;
		}
	}

	async function handleDelete(id: string, clientName: string | null) {
		if (!confirm(`Ștergi programul de raportare pentru ${clientName || 'client'}?`)) return;
		try {
			await deleteReportSchedule({ id }).updates(schedulesQuery);
			toast.success('Programul a fost șters.');
			if (editingId === id) resetForm();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la ștergere.');
		}
	}

	function formatLastSent(date: Date | null): string {
		if (!date) return 'Niciodată';
		return new Date(date).toLocaleDateString('ro-RO', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function getScheduleDescription(s: (typeof schedules)[0]): string {
		if (s.frequency === 'disabled') return 'Dezactivat';
		if (s.frequency === 'weekly') return `Săptămânal — ${dayNames[s.dayOfWeek ?? 1]}`;
		return `Lunar — ziua ${s.dayOfMonth}`;
	}
</script>

<p class="text-muted-foreground mb-6">
	Configurează trimiterea automată a rapoartelor PDF pe email pentru fiecare client.
</p>

<!-- Existing schedules -->
<div class="space-y-4">
	{#if loading}
		<Card>
			<CardContent class="py-8">
				<div class="animate-pulse space-y-4">
					<div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3"></div>
					<div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
				</div>
			</CardContent>
		</Card>
	{:else}
		{#if schedules.length === 0 && !editing}
			<Card>
				<CardContent class="py-12 text-center">
					<CalendarClockIcon class="h-12 w-12 mx-auto text-muted-foreground mb-4" />
					<p class="text-muted-foreground">Nu ai niciun program de raportare configurat.</p>
					<Button class="mt-4" onclick={startCreate}>
						<PlusIcon class="h-4 w-4 mr-2" />
						Adaugă primul program
					</Button>
				</CardContent>
			</Card>
		{:else}
			{#each schedules as schedule (schedule.id)}
				{#if editingId !== schedule.id}
					<Card>
						<CardContent class="py-4">
							<div class="flex items-center justify-between">
								<div class="space-y-1">
									<div class="flex items-center gap-2">
										<p class="font-medium">{schedule.clientName || 'Client necunoscut'}</p>
										{#if !schedule.isEnabled}
											<span class="text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 px-2 py-0.5 rounded">Pauzat</span>
										{/if}
									</div>
									<p class="text-sm text-muted-foreground">
										{getScheduleDescription(schedule)}
										&middot;
										{schedule.platforms.map((p) => platformLabels[p] || p).join(', ')}
									</p>
									<p class="text-xs text-muted-foreground">
										Destinatari: {schedule.recipientEmails.length > 0 ? schedule.recipientEmails.join(', ') : schedule.clientEmail || 'email client'}
										&middot;
										Ultimul: {formatLastSent(schedule.lastSentAt)}
									</p>
								</div>
								<div class="flex items-center gap-2">
									<Button variant="ghost" size="icon" onclick={() => startEdit(schedule)}>
										<PencilIcon class="h-4 w-4" />
									</Button>
									<Button variant="ghost" size="icon" onclick={() => handleDelete(schedule.id, schedule.clientName)}>
										<TrashIcon class="h-4 w-4 text-destructive" />
									</Button>
								</div>
							</div>
						</CardContent>
					</Card>
				{/if}
			{/each}

			{#if !editing}
				<Button variant="outline" onclick={startCreate}>
					<PlusIcon class="h-4 w-4 mr-2" />
					Adaugă program
				</Button>
			{/if}
		{/if}

		<!-- Create/Edit form -->
		{#if editing}
			<Card>
				<CardHeader>
					<div class="flex items-center justify-between">
						<div>
							<CardTitle>{editingId ? 'Editează program' : 'Program nou de raportare'}</CardTitle>
							<CardDescription>Configurează frecvența și destinatarii raportului PDF.</CardDescription>
						</div>
						<Button variant="ghost" size="icon" onclick={resetForm}>
							<XIcon class="h-4 w-4" />
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					<form
						onsubmit={(e) => {
							e.preventDefault();
							handleSave();
						}}
						class="space-y-6"
					>
						<!-- Client selection -->
						{#if !editingId}
							<div class="space-y-2">
								<Label>Client *</Label>
								<Select.Root type="single" value={formClientId} onValueChange={(v) => { if (v) formClientId = v; }}>
									<Select.Trigger class="w-full">
										{clients.find((c) => c.id === formClientId)?.name || 'Selectează client...'}
									</Select.Trigger>
									<Select.Content>
										{#each availableClients as client (client.id)}
											<Select.Item value={client.id}>{client.name}{client.email ? ` (${client.email})` : ''}</Select.Item>
										{/each}
										{#if availableClients.length === 0}
											<p class="text-sm text-muted-foreground p-2">Toți clienții au deja un program.</p>
										{/if}
									</Select.Content>
								</Select.Root>
							</div>
						{:else}
							<div class="space-y-2">
								<Label>Client</Label>
								<p class="text-sm font-medium">{schedules.find((s) => s.id === editingId)?.clientName}</p>
							</div>
						{/if}

						<!-- Frequency -->
						<div class="space-y-2">
							<Label>Frecvență</Label>
							<Select.Root type="single" value={formFrequency} onValueChange={(v) => { if (v) formFrequency = v as typeof formFrequency; }}>
								<Select.Trigger class="w-full max-w-xs">
									{frequencyLabels[formFrequency]}
								</Select.Trigger>
								<Select.Content>
									<Select.Item value="weekly">Săptămânal</Select.Item>
									<Select.Item value="monthly">Lunar</Select.Item>
									<Select.Item value="disabled">Dezactivat</Select.Item>
								</Select.Content>
							</Select.Root>
						</div>

						<!-- Day selection -->
						{#if formFrequency === 'weekly'}
							<div class="space-y-2">
								<Label>Ziua săptămânii</Label>
								<Select.Root type="single" value={String(formDayOfWeek)} onValueChange={(v) => { if (v) formDayOfWeek = Number(v); }}>
									<Select.Trigger class="w-full max-w-xs">
										{dayNames[formDayOfWeek]}
									</Select.Trigger>
									<Select.Content>
										{#each Object.entries(dayNames) as [val, label]}
											<Select.Item value={val}>{label}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							</div>
						{:else if formFrequency === 'monthly'}
							<div class="space-y-2">
								<Label>Ziua lunii (1-28)</Label>
								<Input
									type="number"
									min="1"
									max="28"
									bind:value={formDayOfMonth}
									class="max-w-xs"
								/>
							</div>
						{/if}

						<Separator />

						<!-- Platforms -->
						<div class="space-y-2">
							<Label>Platforme incluse</Label>
							<div class="flex gap-3">
								{#each ['meta', 'google', 'tiktok'] as p}
									<button
										type="button"
										class="px-3 py-1.5 rounded-md border text-sm transition-colors {formPlatforms.includes(p)
											? 'bg-primary text-primary-foreground border-primary'
											: 'bg-background text-muted-foreground border-border hover:bg-accent'}"
										onclick={() => togglePlatform(p)}
									>
										{platformLabels[p]}
									</button>
								{/each}
							</div>
							<p class="text-xs text-muted-foreground">Cel puțin o platformă trebuie selectată.</p>
						</div>

						<!-- Recipient emails -->
						<div class="space-y-2">
							<Label for="recipientEmails">Destinatari email</Label>
							<Input
								id="recipientEmails"
								bind:value={formEmails}
								placeholder="email@exemplu.com, alt-email@exemplu.com"
							/>
							<p class="text-xs text-muted-foreground">
								Separă adresele cu virgulă. Lasă gol pentru a folosi emailul clientului.
							</p>
						</div>

						<!-- Enabled -->
						<div class="flex items-center justify-between">
							<div class="space-y-0.5">
								<Label for="scheduleEnabled">Activ</Label>
								<p class="text-xs text-muted-foreground">Activează sau dezactivează trimiterea automată.</p>
							</div>
							<Switch id="scheduleEnabled" bind:checked={formIsEnabled} />
						</div>

						<Separator />

						<div class="flex gap-2">
							<Button type="submit" disabled={saving || !formClientId}>
								{saving ? 'Se salvează...' : editingId ? 'Actualizează' : 'Creează program'}
							</Button>
							<Button type="button" variant="outline" onclick={resetForm} disabled={saving}>
								Anulează
							</Button>
						</div>
					</form>
				</CardContent>
			</Card>
		{/if}
	{/if}
</div>
