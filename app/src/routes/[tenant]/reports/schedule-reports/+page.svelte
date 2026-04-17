<script lang="ts">
	import {
		getReportSchedules,
		upsertReportSchedule,
		deleteReportSchedule
	} from '$lib/remotes/report-schedule.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import { Switch } from '$lib/components/ui/switch';
	import { Badge } from '$lib/components/ui/badge';
	import * as Select from '$lib/components/ui/select';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogHeader,
		DialogTitle,
		DialogFooter
	} from '$lib/components/ui/dialog';
	import { Combobox } from '$lib/components/ui/combobox';
	import { toast } from 'svelte-sonner';
	import { page } from '$app/state';
	import CalendarClockIcon from '@lucide/svelte/icons/calendar-clock';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import XIcon from '@lucide/svelte/icons/x';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import MailIcon from '@lucide/svelte/icons/mail';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import SendIcon from '@lucide/svelte/icons/send';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import RepeatIcon from '@lucide/svelte/icons/repeat';
	import UsersIcon from '@lucide/svelte/icons/users';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import IconFacebook from '$lib/components/marketing/icon-facebook.svelte';
	import IconGoogleAds from '$lib/components/marketing/icon-google-ads.svelte';
	import IconTiktok from '$lib/components/marketing/icon-tiktok.svelte';

	const platformIcons: Record<string, any> = {
		meta: IconFacebook,
		google: IconGoogleAds,
		tiktok: IconTiktok
	};

	const tenantSlug = $derived(page.params.tenant);

	const schedulesQuery = getReportSchedules();
	const schedules = $derived(schedulesQuery.current ?? []);
	const loading = $derived(schedulesQuery.loading);

	const clientsQuery = getClients();
	const clients = $derived(clientsQuery.current ?? []);

	// Stats
	const activeCount = $derived(schedules.filter((s) => s.isEnabled && s.frequency !== 'disabled').length);
	const pausedCount = $derived(schedules.filter((s) => !s.isEnabled || s.frequency === 'disabled').length);

	// Dialog form state
	let dialogOpen = $state(false);
	let editingId = $state<string | null>(null);
	let saving = $state(false);

	let formClientId = $state<string | undefined>('');
	let formFrequency = $state<'weekly' | 'monthly' | 'disabled'>('weekly');
	let formDayOfWeek = $state(1);
	let formDayOfMonth = $state(1);
	let formPlatforms = $state<string[]>(['meta', 'google', 'tiktok']);
	let formEmails = $state('');
	let formIsEnabled = $state(true);

	// Delete confirmation
	let deleteDialogOpen = $state(false);
	let deleteTarget = $state<{ id: string; name: string | null } | null>(null);

	const dayNames: Record<number, string> = {
		1: 'Luni',
		2: 'Marți',
		3: 'Miercuri',
		4: 'Joi',
		5: 'Vineri',
		6: 'Sâmbătă',
		7: 'Duminică'
	};

	const dayNamesShort: Record<number, string> = {
		1: 'Lun',
		2: 'Mar',
		3: 'Mie',
		4: 'Joi',
		5: 'Vin',
		6: 'Sâm',
		7: 'Dum'
	};

	const platformLabels: Record<string, string> = {
		meta: 'Meta',
		google: 'Google',
		tiktok: 'TikTok'
	};

	const platformColors: Record<string, { pill: string; btn: string; btnOff: string }> = {
		meta: {
			pill: 'bg-[#1877F2]/10 text-[#1877F2] border-[#1877F2]/20',
			btn: 'bg-[#1877F2]/10 border-[#1877F2]/40 text-[#1877F2] shadow-sm',
			btnOff: 'bg-background text-muted-foreground border-border hover:border-[#1877F2]/30 hover:bg-[#1877F2]/5'
		},
		google: {
			pill: 'bg-[#3C8BD9]/10 text-[#3C8BD9] border-[#3C8BD9]/20',
			btn: 'bg-[#FABC04]/10 border-[#FABC04]/40 text-foreground shadow-sm',
			btnOff: 'bg-background text-muted-foreground border-border hover:border-[#FABC04]/30 hover:bg-[#FABC04]/5'
		},
		tiktok: {
			pill: 'bg-foreground/5 text-foreground border-foreground/10',
			btn: 'bg-foreground/5 border-foreground/20 text-foreground shadow-sm',
			btnOff: 'bg-background text-muted-foreground border-border hover:border-foreground/20 hover:bg-foreground/5'
		}
	};

	const frequencyLabels: Record<string, string> = {
		weekly: 'Săptămânal',
		monthly: 'Lunar',
		disabled: 'Dezactivat'
	};

	const availableClients = $derived(
		editingId
			? clients
			: clients.filter((c) => !schedules.some((s) => s.clientId === c.id))
	);

	const clientOptions = $derived(
		availableClients.map((c) => ({
			value: c.id,
			label: c.name + (c.email ? ` (${c.email})` : '')
		}))
	);

	function resetForm() {
		formClientId = '';
		formFrequency = 'weekly';
		formDayOfWeek = 1;
		formDayOfMonth = 1;
		formPlatforms = ['meta', 'google', 'tiktok'];
		formEmails = '';
		formIsEnabled = true;
		editingId = null;
	}

	function openCreate() {
		resetForm();
		dialogOpen = true;
	}

	function openEdit(schedule: (typeof schedules)[0]) {
		editingId = schedule.id;
		formClientId = schedule.clientId;
		formFrequency = schedule.frequency as 'weekly' | 'monthly' | 'disabled';
		formDayOfWeek = schedule.dayOfWeek ?? 1;
		formDayOfMonth = schedule.dayOfMonth ?? 1;
		formPlatforms = [...schedule.platforms];
		formEmails = schedule.recipientEmails.join(', ');
		formIsEnabled = schedule.isEnabled;
		dialogOpen = true;
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
			dialogOpen = false;
			resetForm();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la salvare.');
		} finally {
			saving = false;
		}
	}

	function confirmDelete(id: string, clientName: string | null) {
		deleteTarget = { id, name: clientName };
		deleteDialogOpen = true;
	}

	async function handleDelete() {
		if (!deleteTarget) return;
		try {
			await deleteReportSchedule({ id: deleteTarget.id }).updates(schedulesQuery);
			toast.success('Programul a fost șters.');
			deleteDialogOpen = false;
			deleteTarget = null;
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

	function getScheduleLabel(s: (typeof schedules)[0]): string {
		if (s.frequency === 'disabled') return 'Dezactivat';
		if (s.frequency === 'weekly') return dayNames[s.dayOfWeek ?? 1];
		return `Ziua ${s.dayOfMonth}`;
	}

	function getRecipientCount(s: (typeof schedules)[0]): number {
		return s.recipientEmails.length > 0 ? s.recipientEmails.length : (s.clientEmail ? 1 : 0);
	}

	function getRecipientLabel(s: (typeof schedules)[0]): string {
		if (s.recipientEmails.length > 0) return s.recipientEmails.join(', ');
		return s.clientEmail || 'Nicio adresă';
	}

	function previewPdf(schedule: (typeof schedules)[0]) {
		const params = new URLSearchParams({
			clientId: schedule.clientId,
			platforms: schedule.platforms.join(','),
			frequency: schedule.frequency
		});
		window.open(`/${tenantSlug}/reports/schedule-reports/preview-pdf?${params}`, '_blank');
	}

	function downloadPdf(schedule: (typeof schedules)[0]) {
		const params = new URLSearchParams({
			clientId: schedule.clientId,
			platforms: schedule.platforms.join(','),
			frequency: schedule.frequency,
			download: 'true'
		});
		window.open(`/${tenantSlug}/reports/schedule-reports/preview-pdf?${params}`, '_blank');
	}
</script>

<!-- Page Header -->
<div class="space-y-8">
	<div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
		<div class="space-y-1">
			<h1 class="text-2xl font-semibold tracking-tight">Programare Rapoarte</h1>
			<p class="text-sm text-muted-foreground">
				Rapoarte PDF trimise automat pe email
			</p>
		</div>
		<Button onclick={openCreate} class="gap-2 self-start">
			<PlusIcon class="h-4 w-4" />
			Adaugă program
		</Button>
	</div>

	<!-- Stats Row -->
	{#if schedules.length > 0}
		<div class="grid grid-cols-3 gap-4">
			<div class="rounded-xl border bg-card p-4 space-y-1">
				<div class="flex items-center gap-2 text-muted-foreground">
					<FileTextIcon class="h-4 w-4" />
					<span class="text-xs font-medium uppercase tracking-wider">Total</span>
				</div>
				<p class="text-2xl font-semibold tabular-nums">{schedules.length}</p>
			</div>
			<div class="rounded-xl border bg-card p-4 space-y-1">
				<div class="flex items-center gap-2 text-success">
					<SendIcon class="h-4 w-4" />
					<span class="text-xs font-medium uppercase tracking-wider">Active</span>
				</div>
				<p class="text-2xl font-semibold tabular-nums">{activeCount}</p>
			</div>
			<div class="rounded-xl border bg-card p-4 space-y-1">
				<div class="flex items-center gap-2 text-warning">
					<ClockIcon class="h-4 w-4" />
					<span class="text-xs font-medium uppercase tracking-wider">Pauzate</span>
				</div>
				<p class="text-2xl font-semibold tabular-nums">{pausedCount}</p>
			</div>
		</div>
	{/if}

	<!-- Schedule List -->
	{#if loading}
		<div class="space-y-3">
			{#each [1, 2, 3] as _}
				<div class="rounded-xl border bg-card p-5 animate-pulse">
					<div class="flex items-center gap-4">
						<div class="h-10 w-10 rounded-lg bg-muted"></div>
						<div class="flex-1 space-y-2">
							<div class="h-4 w-1/3 rounded bg-muted"></div>
							<div class="h-3 w-1/4 rounded bg-muted"></div>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{:else if schedules.length === 0}
		<!-- Empty State -->
		<div class="rounded-xl border-2 border-dashed bg-card/50 py-16 text-center">
			<div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
				<CalendarClockIcon class="h-7 w-7 text-primary" />
			</div>
			<h3 class="text-lg font-medium mb-1">Niciun program configurat</h3>
			<p class="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
				Configurează trimiterea automată a rapoartelor de marketing către clienții tăi.
			</p>
			<Button onclick={openCreate} class="gap-2">
				<PlusIcon class="h-4 w-4" />
				Primul program de raportare
			</Button>
		</div>
	{:else}
		<div class="space-y-3">
			{#each schedules as schedule, i (schedule.id)}
				<div
					class="group rounded-xl border bg-card transition-all duration-200 hover:shadow-md hover:border-primary/20"
					style="animation: fadeSlideIn 0.3s ease-out {i * 50}ms both"
				>
					<div class="p-5">
						<div class="flex items-start gap-4">
							<!-- Client Avatar -->
							<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg font-semibold text-sm
								{schedule.isEnabled && schedule.frequency !== 'disabled'
									? 'bg-primary/10 text-primary'
									: 'bg-muted text-muted-foreground'}"
							>
								{(schedule.clientName || '?').slice(0, 2).toUpperCase()}
							</div>

							<!-- Main Info -->
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2 mb-1.5">
									<h3 class="font-medium text-sm truncate">{schedule.clientName || 'Client necunoscut'}</h3>

									{#if schedule.isEnabled && schedule.frequency !== 'disabled'}
										<Badge variant="success" class="text-[10px] px-1.5 py-0">Activ</Badge>
									{:else if schedule.frequency === 'disabled'}
										<Badge variant="outline" class="text-[10px] px-1.5 py-0">Dezactivat</Badge>
									{:else}
										<Badge variant="warning" class="text-[10px] px-1.5 py-0">Pauzat</Badge>
									{/if}
								</div>

								<!-- Details Row -->
								<div class="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
									<!-- Frequency -->
									<span class="inline-flex items-center gap-1">
										<RepeatIcon class="h-3 w-3" />
										{frequencyLabels[schedule.frequency]}
										{#if schedule.frequency !== 'disabled'}
											&middot; {getScheduleLabel(schedule)}
										{/if}
									</span>

									<!-- Recipients -->
									<Tooltip.Root>
										<Tooltip.Trigger>
											<span class="inline-flex items-center gap-1 cursor-default">
												<MailIcon class="h-3 w-3" />
												{getRecipientCount(schedule)} destinatar{getRecipientCount(schedule) !== 1 ? 'i' : ''}
											</span>
										</Tooltip.Trigger>
										<Tooltip.Content>
											<p class="text-xs">{getRecipientLabel(schedule)}</p>
										</Tooltip.Content>
									</Tooltip.Root>

									<!-- Last Sent -->
									{#if schedule.lastSentAt}
										<span class="inline-flex items-center gap-1">
											<ClockIcon class="h-3 w-3" />
											{formatLastSent(schedule.lastSentAt)}
										</span>
									{/if}
								</div>

								<!-- Platform Pills -->
								<div class="flex gap-1.5 mt-2.5">
									{#each schedule.platforms as p}
										{@const Icon = platformIcons[p]}
										<span class="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium {platformColors[p].pill}">
											{#if Icon}
												<Icon class="h-3.5 w-3.5" />
											{/if}
											{platformLabels[p]}
										</span>
									{/each}
								</div>
							</div>

							<!-- Actions -->
							<div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
								<Tooltip.Root>
									<Tooltip.Trigger>
										<Button variant="ghost" size="icon-sm" onclick={() => previewPdf(schedule)}>
											<EyeIcon class="h-3.5 w-3.5" />
										</Button>
									</Tooltip.Trigger>
									<Tooltip.Content>Preview PDF</Tooltip.Content>
								</Tooltip.Root>

								<Tooltip.Root>
									<Tooltip.Trigger>
										<Button variant="ghost" size="icon-sm" onclick={() => downloadPdf(schedule)}>
											<DownloadIcon class="h-3.5 w-3.5" />
										</Button>
									</Tooltip.Trigger>
									<Tooltip.Content>Descarcă PDF</Tooltip.Content>
								</Tooltip.Root>

								<Tooltip.Root>
									<Tooltip.Trigger>
										<Button variant="ghost" size="icon-sm" onclick={() => openEdit(schedule)}>
											<PencilIcon class="h-3.5 w-3.5" />
										</Button>
									</Tooltip.Trigger>
									<Tooltip.Content>Editează</Tooltip.Content>
								</Tooltip.Root>

								<Tooltip.Root>
									<Tooltip.Trigger>
										<Button variant="ghost" size="icon-sm" onclick={() => confirmDelete(schedule.id, schedule.clientName)}>
											<TrashIcon class="h-3.5 w-3.5 text-destructive" />
										</Button>
									</Tooltip.Trigger>
									<Tooltip.Content>Șterge</Tooltip.Content>
								</Tooltip.Root>
							</div>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- Create/Edit Dialog -->
<Dialog bind:open={dialogOpen} onOpenChange={(open) => { if (!open) resetForm(); }}>
	<DialogContent class="sm:max-w-lg max-h-[85vh] overflow-y-auto">
		<DialogHeader>
			<DialogTitle>{editingId ? 'Editează program' : 'Program nou'}</DialogTitle>
			<DialogDescription>Configurează frecvența și destinatarii raportului PDF.</DialogDescription>
		</DialogHeader>

		<form
			onsubmit={(e) => {
				e.preventDefault();
				handleSave();
			}}
			class="space-y-5 pt-2"
		>
			<!-- Client -->
			{#if !editingId}
				<div class="space-y-2">
					<Label>Client</Label>
					<Combobox
						bind:value={formClientId}
						options={clientOptions}
						placeholder="Caută și selectează..."
						searchPlaceholder="Caută clienți..."
					/>
				</div>
			{:else}
				<div class="space-y-1.5">
					<Label class="text-muted-foreground text-xs">Client</Label>
					<p class="text-sm font-medium">{schedules.find((s) => s.id === editingId)?.clientName}</p>
				</div>
			{/if}

			<!-- Frequency + Day (side by side) -->
			<div class="grid grid-cols-2 gap-4">
				<div class="space-y-2">
					<Label>Frecvență</Label>
					<Select.Root type="single" value={formFrequency} onValueChange={(v) => { if (v) formFrequency = v as typeof formFrequency; }}>
						<Select.Trigger class="w-full">
							{frequencyLabels[formFrequency]}
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="weekly">Săptămânal</Select.Item>
							<Select.Item value="monthly">Lunar</Select.Item>
							<Select.Item value="disabled">Dezactivat</Select.Item>
						</Select.Content>
					</Select.Root>
				</div>

				{#if formFrequency === 'weekly'}
					<div class="space-y-2">
						<Label>Ziua trimiterii</Label>
						<Select.Root type="single" value={String(formDayOfWeek)} onValueChange={(v) => { if (v) formDayOfWeek = Number(v); }}>
							<Select.Trigger class="w-full">
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
						<Label>Ziua lunii</Label>
						<Input
							type="number"
							min="1"
							max="28"
							bind:value={formDayOfMonth}
						/>
					</div>
				{:else}
					<div></div>
				{/if}
			</div>

			<Separator />

			<!-- Platforms -->
			<div class="space-y-2.5">
				<Label>Platforme incluse</Label>
				<div class="flex gap-2">
					{#each ['meta', 'google', 'tiktok'] as p}
						{@const Icon = platformIcons[p]}
						<button
							type="button"
							class="flex-1 flex items-center justify-center gap-2 rounded-lg border-2 px-3 py-2.5 text-sm font-medium transition-all duration-150
								{formPlatforms.includes(p) ? platformColors[p].btn : platformColors[p].btnOff}"
							onclick={() => togglePlatform(p)}
						>
							{#if Icon}
								<Icon class="h-4 w-4" />
							{/if}
							{platformLabels[p]}
						</button>
					{/each}
				</div>
				<p class="text-[11px] text-muted-foreground">Cel puțin o platformă trebuie selectată.</p>
			</div>

			<!-- Recipient emails -->
			<div class="space-y-2">
				<Label for="recipientEmails">Destinatari email</Label>
				<Input
					id="recipientEmails"
					bind:value={formEmails}
					placeholder="email@exemplu.com, alt@exemplu.com"
				/>
				<p class="text-[11px] text-muted-foreground">
					Separă cu virgulă. Lasă gol = emailul clientului.
				</p>
			</div>

			<!-- Enabled -->
			<div class="flex items-center justify-between rounded-lg border p-3">
				<div class="space-y-0.5">
					<Label for="scheduleEnabled" class="text-sm">Trimitere activă</Label>
					<p class="text-[11px] text-muted-foreground">Pornește sau oprește trimiterea automată</p>
				</div>
				<Switch id="scheduleEnabled" bind:checked={formIsEnabled} />
			</div>

			<DialogFooter class="pt-2">
				<Button type="button" variant="outline" onclick={() => { dialogOpen = false; resetForm(); }} disabled={saving}>
					Anulează
				</Button>
				<Button type="submit" disabled={saving || !formClientId}>
					{saving ? 'Se salvează...' : editingId ? 'Salvează' : 'Creează'}
				</Button>
			</DialogFooter>
		</form>
	</DialogContent>
</Dialog>

<!-- Delete Confirmation Dialog -->
<Dialog bind:open={deleteDialogOpen}>
	<DialogContent class="sm:max-w-md">
		<DialogHeader>
			<DialogTitle>Confirmare ștergere</DialogTitle>
			<DialogDescription>
				Ești sigur că vrei să ștergi programul de raportare pentru <strong>{deleteTarget?.name || 'acest client'}</strong>?
			</DialogDescription>
		</DialogHeader>
		<DialogFooter>
			<Button variant="outline" onclick={() => { deleteDialogOpen = false; deleteTarget = null; }}>
				Anulează
			</Button>
			<Button variant="destructive" onclick={handleDelete}>
				Șterge
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>

<style>
	@keyframes fadeSlideIn {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
