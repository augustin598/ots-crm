<script lang="ts">
	import type { PageData } from './$types';
	import { Tabs, TabsList, TabsTrigger, TabsContent } from '$lib/components/ui/tabs';
	import { Breadcrumb } from '$lib/components/app/breadcrumb';
	import { Button } from '$lib/components/ui/button';
	import { getClient } from '$lib/remotes/clients.remote';
	import { getProjects } from '$lib/remotes/projects.remote';
	import { getInvoices } from '$lib/remotes/invoices.remote';
	import { getContracts } from '$lib/remotes/contracts.remote';
	import { Badge } from '$lib/components/ui/badge';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { Pencil as Edit, ArrowLeft } from '@lucide/svelte';
	import ClientLogo from '$lib/components/client-logo.svelte';
	import { generateClientMagicLink, sendClientMagicLinkEmail } from '$lib/remotes/client-auth.remote';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { toast } from 'svelte-sonner';
	import MailIcon from '@lucide/svelte/icons/mail';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import CheckIcon from '@lucide/svelte/icons/check';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';

	let { data, children }: { data: PageData; children: any } = $props();

	const tenantSlug = $derived(page.params.tenant as string);
	const clientId = $derived(page.params.clientId as string);
	const currentPath = $derived(page.url.pathname);

	const clientQuery = getClient(clientId);
	const client = $derived(clientQuery.current);

	// Counts for tabs
	const projectsQuery = getProjects(clientId);
	const projects = $derived(projectsQuery.current || []);
	const invoicesQuery = getInvoices({ clientId });
	const invoices = $derived(invoicesQuery.current || []);
	const contractsQuery = getContracts({ clientId });
	const contracts = $derived(contractsQuery.current || []);

	const breadcrumbItems = $derived([
		{ label: data.tenant?.name || 'Organization', href: `/${tenantSlug}` },
		{ label: 'Clients', href: `/${tenantSlug}/clients` },
		{ label: client?.name || 'Client', href: `/${tenantSlug}/clients/${clientId}` }
	]);

	const tabs = $derived([
		{ id: 'overview', label: 'Overview', href: `/${tenantSlug}/clients/${clientId}` },
		{ id: 'projects', label: `Projects (${projects.length})`, href: `/${tenantSlug}/clients/${clientId}/projects` },
		{ id: 'contracts', label: `Contracts (${contracts.length})`, href: `/${tenantSlug}/clients/${clientId}/contracts` },
		{ id: 'invoices', label: `Invoices (${invoices.length})`, href: `/${tenantSlug}/clients/${clientId}/invoices` },
		{ id: 'seo', label: 'SEO', href: `/${tenantSlug}/clients/${clientId}/seo` }
	]);

	let magicLinkDialogOpen = $state(false);
	let magicLinkUrl = $state('');
	let magicLinkEmail = $state('');
	let magicLinkLoading = $state(false);
	let copied = $state(false);
	let emailSending = $state(false);
	let emailSent = $state(false);

	async function handleOpenMagicLink() {
		magicLinkLoading = true;
		magicLinkUrl = '';
		copied = false;
		emailSent = false;
		try {
			const result = await generateClientMagicLink({ clientId });
			magicLinkUrl = result.url;
			magicLinkEmail = result.email;
			magicLinkDialogOpen = true;
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la generare');
		} finally {
			magicLinkLoading = false;
		}
	}

	async function handleCopy() {
		await navigator.clipboard.writeText(magicLinkUrl);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	async function handleSendEmail() {
		emailSending = true;
		try {
			await sendClientMagicLinkEmail({ clientId });
			emailSent = true;
			toast.success(`Magic link trimis pe ${magicLinkEmail}`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la trimitere email');
		} finally {
			emailSending = false;
		}
	}

	const activeTab = $derived(() => {
		if (currentPath === `/${tenantSlug}/clients/${clientId}`) return 'overview';
		if (currentPath.startsWith(`/${tenantSlug}/clients/${clientId}/projects`)) return 'projects';
		if (currentPath.startsWith(`/${tenantSlug}/clients/${clientId}/contracts`)) return 'contracts';
		if (currentPath.startsWith(`/${tenantSlug}/clients/${clientId}/invoices`)) return 'invoices';
		if (currentPath.startsWith(`/${tenantSlug}/clients/${clientId}/seo`)) return 'seo';
		return 'overview';
	});
</script>

<div class="space-y-6">
	<Breadcrumb items={breadcrumbItems} />

	<!-- Consistent header across all tabs -->
	<div class="mb-2">
		<Button variant="ghost" size="sm" class="mb-4" onclick={() => goto(`/${tenantSlug}/clients`)}>
			<ArrowLeft class="mr-2 h-4 w-4" />
			Back to Clients
		</Button>

		<div class="flex items-start justify-between">
			<div class="flex items-center gap-4">
				<ClientLogo website={client?.defaultWebsiteUrl ?? client?.website} name={client?.name ?? 'Client'} size="lg" />
				<div>
					<h1 class="text-3xl font-bold tracking-tight">{client?.name || 'Client'}</h1>
					{#if client?.companyType}
						<p class="text-lg text-muted-foreground mt-1">{client.companyType}</p>
					{/if}
					<div class="flex items-center gap-2 mt-2">
						<Badge variant="secondary">Client</Badge>
						{#if client?.createdAt}
							<span class="text-sm text-muted-foreground">
								Client since {new Date(client.createdAt).toLocaleDateString()}
							</span>
						{/if}
					</div>
				</div>
			</div>
			<div class="flex items-center gap-2">
				<Button variant="outline" onclick={handleOpenMagicLink} disabled={magicLinkLoading}>
					<SparklesIcon class="mr-2 h-4 w-4" />
					{magicLinkLoading ? 'Se generează...' : 'Magic Link'}
				</Button>
				<Button onclick={() => goto(`/${tenantSlug}/clients/${clientId}/edit`)}>
					<Edit class="mr-2 h-4 w-4" />
					Edit Client
				</Button>
			</div>
		</div>
	</div>

		<Dialog.Root bind:open={magicLinkDialogOpen}>
		<Dialog.Content class="sm:max-w-md">
			<Dialog.Header>
				<Dialog.Title class="flex items-center gap-2">
					<SparklesIcon class="h-5 w-5 text-primary" />
					Magic Link acces client
				</Dialog.Title>
				<Dialog.Description>
					Link valabil 24 de ore, utilizabil o singură dată. Trimite-l clientului prin orice canal.
				</Dialog.Description>
			</Dialog.Header>
			<div class="space-y-4 pt-2">
				<div class="flex gap-2">
					<Input value={magicLinkUrl} readonly class="text-xs font-mono" />
					<Button variant="outline" size="icon" onclick={handleCopy} class="shrink-0">
						{#if copied}
							<CheckIcon class="h-4 w-4 text-green-500" />
						{:else}
							<CopyIcon class="h-4 w-4" />
						{/if}
					</Button>
				</div>
				{#if magicLinkEmail}
					<Button variant="secondary" class="w-full gap-2" onclick={handleSendEmail} disabled={emailSending || emailSent}>
						{#if emailSent}
							<CheckIcon class="h-4 w-4 text-green-500" />
							Trimis pe {magicLinkEmail}
						{:else if emailSending}
							Se trimite...
						{:else}
							<MailIcon class="h-4 w-4" />
							Trimite pe email ({magicLinkEmail})
						{/if}
					</Button>
				{/if}
			</div>
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (magicLinkDialogOpen = false)}>Închide</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>

	<Tabs value={activeTab()} class="w-full">
			<TabsList class="grid w-full grid-cols-5">
				{#each tabs as tab}
					<TabsTrigger value={tab.id} onclick={() => goto(tab.href)}>
						{tab.label}
					</TabsTrigger>
				{/each}
			</TabsList>
			<TabsContent value={activeTab()} class="mt-6">
				{@render children()}
			</TabsContent>
		</Tabs>
</div>
