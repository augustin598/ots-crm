<script lang="ts">
	import { page } from '$app/state';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import ContactIcon from '@lucide/svelte/icons/contact';
	import MailIcon from '@lucide/svelte/icons/mail';
	import PhoneIcon from '@lucide/svelte/icons/phone';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import { getLeadDetail } from '$lib/remotes/leads.remote';

	const tenantSlug = $derived(page.params.tenant as string);
	const leadId = $derived(page.params.leadId as string);

	let lead = $state<any>(null);
	let loading = $state(true);

	const statusColors: Record<string, string> = {
		new: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
		contacted: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
		qualified: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
		converted: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300',
		disqualified: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
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
		} catch (e) {
			console.error('Failed to load lead:', e);
		} finally {
			loading = false;
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
			{#if lead.fieldData && lead.fieldData.length > 0}
				<Card.Root>
					<Card.Header>
						<Card.Title>Câmpuri formular</Card.Title>
					</Card.Header>
					<Card.Content>
						<div class="space-y-3">
							{#each lead.fieldData as field (field.name)}
								<div class="flex justify-between items-start border-b pb-2 last:border-0">
									<span class="text-sm text-muted-foreground capitalize">{field.name.replace(/_/g, ' ')}</span>
									<span class="text-sm font-medium text-right">{field.values?.map((v: string) => v.replace(/_/g, ' ')).join(', ') || '-'}</span>
								</div>
							{/each}
						</div>
					</Card.Content>
				</Card.Root>
			{/if}
		</div>

		{#if lead.notes}
			<Card.Root>
				<Card.Header>
					<Card.Title>Notițe</Card.Title>
				</Card.Header>
				<Card.Content>
					<p class="text-sm whitespace-pre-wrap">{lead.notes}</p>
				</Card.Content>
			</Card.Root>
		{/if}

		<!-- Meta info -->
		<div class="text-xs text-muted-foreground flex flex-wrap gap-4">
			<span>Importat: {formatDate(lead.importedAt)}</span>
		</div>
	</div>
{/if}
