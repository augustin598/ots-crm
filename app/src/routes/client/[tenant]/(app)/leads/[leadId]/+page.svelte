<script lang="ts">
	import { page } from '$app/state';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as Select from '$lib/components/ui/select';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import ContactIcon from '@lucide/svelte/icons/contact';
	import MailIcon from '@lucide/svelte/icons/mail';
	import PhoneIcon from '@lucide/svelte/icons/phone';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import { Textarea } from '$lib/components/ui/textarea';
	import { getLeadDetail, updateLeadStatus, addLeadNote } from '$lib/remotes/leads.remote';
	import { toast } from 'svelte-sonner';

	const tenantSlug = $derived(page.params.tenant as string);
	const leadId = $derived(page.params.leadId as string);

	let lead = $state<any>(null);
	let loading = $state(true);
	let notes = $state('');
	let savingNotes = $state(false);

	const statusOptions = [
		{ value: 'new', label: 'Nou' },
		{ value: 'contacted', label: 'Contactat' },
		{ value: 'qualified', label: 'Calificat' },
		{ value: 'converted', label: 'Convertit' },
		{ value: 'disqualified', label: 'Descalificat' }
	];

	const statusDotColors: Record<string, string> = {
		new: 'bg-blue-500',
		contacted: 'bg-violet-500',
		qualified: 'bg-amber-500',
		converted: 'bg-green-500',
		disqualified: 'bg-red-500'
	};

	const statusColors: Record<string, string> = {
		new: 'bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-200',
		contacted: 'bg-violet-100 text-violet-900 dark:bg-violet-900 dark:text-violet-200',
		qualified: 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-200',
		converted: 'bg-green-100 text-green-900 dark:bg-green-900 dark:text-green-200',
		disqualified: 'bg-red-100 text-red-900 dark:bg-red-900 dark:text-red-200'
	};

	const statusLabels: Record<string, string> = {
		new: 'Nou',
		contacted: 'Contactat',
		qualified: 'Calificat',
		converted: 'Convertit',
		disqualified: 'Descalificat'
	};

	const platformLabels: Record<string, string> = {
		facebook: 'Facebook Ads',
		google: 'Google Ads',
		tiktok: 'TikTok Ads'
	};

	$effect(() => {
		loadLead();
	});

	async function loadLead() {
		loading = true;
		try {
			lead = await getLeadDetail(leadId);
			notes = lead.notes || '';
		} catch (e) {
			console.error('Failed to load lead:', e);
		} finally {
			loading = false;
		}
	}

	async function handleSaveNotes() {
		savingNotes = true;
		try {
			await addLeadNote({ leadId, notes });
			toast.success('Notițe salvate');
		} catch (e) {
			toast.error('Eroare la salvare');
		} finally {
			savingNotes = false;
		}
	}

	async function handleStatusChange(newStatus: string) {
		try {
			await updateLeadStatus({ leadId, status: newStatus as any });
			lead.status = newStatus;
			toast.success('Status actualizat');
		} catch (e) {
			toast.error('Eroare la actualizarea statusului');
		}
	}

	function formatDate(date: Date | string | null): string {
		if (!date) return '-';
		const d = date instanceof Date ? date : new Date(date);
		return d.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
	}
</script>

{#if loading}
	<div class="flex items-center justify-center py-12">
		<RefreshCwIcon class="h-6 w-6 animate-spin text-muted-foreground" />
	</div>
{:else if !lead}
	<div class="text-center py-12">
		<p class="text-muted-foreground">Lead-ul nu a fost găsit.</p>
		<Button href="/client/{tenantSlug}/leads" variant="outline" class="mt-4">
			<ArrowLeftIcon class="h-4 w-4" />
			Înapoi la leads
		</Button>
	</div>
{:else}
	<div class="space-y-6">
		<!-- Header -->
		<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
			<div class="flex items-center gap-3">
				<Button href="/client/{tenantSlug}/leads/{lead.platform === 'facebook' ? 'facebook-ads' : lead.platform === 'google' ? 'google-ads' : 'tiktok-ads'}" variant="ghost" size="icon">
					<ArrowLeftIcon class="h-4 w-4" />
				</Button>
				<div>
					<h1 class="text-2xl font-bold">{lead.fullName || 'Lead fără nume'}</h1>
					<div class="flex items-center gap-2 mt-1">
						<Badge variant="outline">{platformLabels[lead.platform] || lead.platform}</Badge>
						<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium {statusColors[lead.status] || ''}">
							{statusLabels[lead.status] || lead.status}
						</span>
					</div>
				</div>
			</div>
			<div class="flex items-center gap-2">
				<Select.Root type="single" onValueChange={handleStatusChange}>
					<Select.Trigger class="w-[160px]">
						Schimbă status
					</Select.Trigger>
					<Select.Content>
						{#each statusOptions as opt (opt.value)}
							<Select.Item value={opt.value}>
								<span class="flex items-center gap-2">
									<span class="h-2 w-2 rounded-full {statusDotColors[opt.value] || ''}"></span>
									{opt.label}
								</span>
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
		</div>

		<div class="grid gap-6 lg:grid-cols-2">
			<!-- Contact info -->
			<Card.Root>
				<Card.Header>
					<Card.Title class="flex items-center gap-2">
						<ContactIcon class="h-5 w-5" />
						Informații contact
					</Card.Title>
				</Card.Header>
				<Card.Content class="space-y-4">
					<div class="flex items-center gap-3">
						<ContactIcon class="h-4 w-4 text-muted-foreground" />
						<div>
							<p class="text-sm text-muted-foreground">Nume</p>
							<p class="font-medium">{lead.fullName || '-'}</p>
						</div>
					</div>
					<div class="flex items-center gap-3">
						<MailIcon class="h-4 w-4 text-muted-foreground" />
						<div>
							<p class="text-sm text-muted-foreground">Email</p>
							{#if lead.email}
								<a href="mailto:{lead.email}" class="font-medium text-primary hover:underline">{lead.email}</a>
							{:else}
								<p class="font-medium">-</p>
							{/if}
						</div>
					</div>
					<div class="flex items-center gap-3">
						<PhoneIcon class="h-4 w-4 text-muted-foreground" />
						<div>
							<p class="text-sm text-muted-foreground">Telefon</p>
							{#if lead.phoneNumber}
								<a href="tel:{lead.phoneNumber}" class="font-medium text-primary hover:underline">{lead.phoneNumber}</a>
							{:else}
								<p class="font-medium">-</p>
							{/if}
						</div>
					</div>
					<div class="flex items-center gap-3">
						<CalendarIcon class="h-4 w-4 text-muted-foreground" />
						<div>
							<p class="text-sm text-muted-foreground">Data lead</p>
							<p class="font-medium">{formatDate(lead.externalCreatedAt)}</p>
						</div>
					</div>
					<div class="flex items-center gap-3">
						<FileTextIcon class="h-4 w-4 text-muted-foreground" />
						<div>
							<p class="text-sm text-muted-foreground">Formular</p>
							<p class="font-medium">{lead.formName || '-'}</p>
						</div>
					</div>
				</Card.Content>
			</Card.Root>

			<!-- Additional fields -->
			<div class="space-y-6">
				{#if lead.fieldData && lead.fieldData.length > 0}
					<Card.Root>
						<Card.Header>
							<Card.Title class="flex items-center gap-2">
								<FileTextIcon class="h-5 w-5" />
								Câmpuri formular
							</Card.Title>
						</Card.Header>
						<Card.Content>
							<div class="divide-y">
								{#each lead.fieldData as field (field.name)}
									<div class="flex justify-between items-start py-2.5 first:pt-0 last:pb-0">
										<span class="text-sm text-muted-foreground capitalize min-w-0 shrink-0">{field.name.replace(/_/g, ' ')}</span>
										<span class="text-sm font-medium text-right ml-4 break-words min-w-0">{field.values?.map((v: string) => v.replace(/_/g, ' ')).join(', ') || '-'}</span>
									</div>
								{/each}
							</div>
						</Card.Content>
					</Card.Root>
				{/if}

				<!-- Meta info -->
				<Card.Root class="bg-muted/50">
					<Card.Content class="pt-5">
						<div class="grid grid-cols-2 gap-3">
							<div>
								<p class="text-xs text-muted-foreground">Lead ID</p>
								<p class="text-xs font-mono mt-0.5">{lead.externalLeadId}</p>
							</div>
							{#if lead.externalFormId}
								<div>
									<p class="text-xs text-muted-foreground">Form ID</p>
									<p class="text-xs font-mono mt-0.5">{lead.externalFormId}</p>
								</div>
							{/if}
							{#if lead.externalAdId}
								<div>
									<p class="text-xs text-muted-foreground">Ad</p>
									<p class="text-xs font-mono mt-0.5">{lead.adName || lead.externalAdId}</p>
								</div>
							{/if}
							<div>
								<p class="text-xs text-muted-foreground">Importat</p>
								<p class="text-xs font-mono mt-0.5">{formatDate(lead.importedAt)}</p>
							</div>
						</div>
					</Card.Content>
				</Card.Root>
			</div>
		</div>

		<!-- Notes -->
		<Card.Root>
			<Card.Header>
				<Card.Title>Notițe</Card.Title>
			</Card.Header>
			<Card.Content>
				<Textarea
					bind:value={notes}
					placeholder="Adaugă notițe despre acest lead..."
					rows={4}
				/>
				<div class="flex justify-end mt-3">
					<Button onclick={handleSaveNotes} disabled={savingNotes} size="sm">
						{savingNotes ? 'Se salvează...' : 'Salvează notițele'}
					</Button>
				</div>
			</Card.Content>
		</Card.Root>
	</div>
{/if}
