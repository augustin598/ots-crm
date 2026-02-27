<script lang="ts">
	import {
		getContractTemplates,
		createContractTemplate,
		deleteContractTemplate
	} from '$lib/remotes/contract-templates.remote';
	import { getDefaultContractClauses } from '$lib/contract-templates';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import TrashIcon from '@lucide/svelte/icons/trash-2';

	const tenantSlug = $derived(page.params.tenant);

	const templatesQuery = getContractTemplates();
	const templates = $derived(templatesQuery.current || []);
	const loading = $derived(templatesQuery.loading);

	let showNewForm = $state(false);
	let newName = $state('');
	let creating = $state(false);

	async function handleCreate() {
		if (!newName.trim()) {
			toast.error('Numele este obligatoriu');
			return;
		}

		creating = true;
		try {
			const defaultClauses = getDefaultContractClauses();
			const result = await createContractTemplate({
				name: newName.trim(),
				clausesJson: JSON.stringify(defaultClauses),
				isActive: true
			}).updates(templatesQuery);

			if (result.success && result.templateId) {
				toast.success('Template creat cu succes');
				newName = '';
				showNewForm = false;
				goto(`/${tenantSlug}/contract-templates/${result.templateId}`);
			}
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la crearea template-ului');
		} finally {
			creating = false;
		}
	}

	async function handleDelete(templateId: string, name: string) {
		if (!confirm(`Esti sigur ca vrei sa stergi template-ul "${name}"?`)) {
			return;
		}

		try {
			await deleteContractTemplate(templateId).updates(templatesQuery);
			toast.success('Template sters');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la stergerea template-ului');
		}
	}

	function formatDate(date: Date | string | null | undefined): string {
		if (!date) return '-';
		try {
			const d = date instanceof Date ? date : new Date(date);
			return d.toLocaleDateString('ro-RO', { year: 'numeric', month: 'short', day: 'numeric' });
		} catch {
			return '-';
		}
	}

	function getClauseCount(clausesJson: string | null): number {
		if (!clausesJson) return 0;
		try {
			const clauses = JSON.parse(clausesJson);
			return Array.isArray(clauses) ? clauses.length : 0;
		} catch {
			return 0;
		}
	}
</script>

<svelte:head>
	<title>Template-uri Contracte - CRM</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-6">
		<Button variant="ghost" size="sm" class="mb-4" onclick={() => goto(`/${tenantSlug}/settings`)}>
			<ArrowLeftIcon class="mr-2 h-4 w-4" />
			Inapoi la Setari
		</Button>
		<div class="flex items-center justify-between">
			<div>
				<h1 class="text-3xl font-bold tracking-tight">Template-uri Contracte</h1>
				<p class="text-muted-foreground mt-1">
					Gestioneaza template-urile de contract cu clauze legale predefinite
				</p>
			</div>
			<Button onclick={() => { showNewForm = !showNewForm; }}>
				<PlusIcon class="mr-2 h-4 w-4" />
				Template Nou
			</Button>
		</div>
	</div>

	{#if showNewForm}
		<Card class="border-primary/50">
			<CardContent class="pt-6">
				<form
					onsubmit={(e) => {
						e.preventDefault();
						handleCreate();
					}}
					class="flex items-end gap-4"
				>
					<div class="flex-1 space-y-1.5">
						<Label>Nume template</Label>
						<Input
							bind:value={newName}
							placeholder="ex: Prestari Servicii Informatice"
						/>
					</div>
					<Button type="submit" disabled={creating}>
						{creating ? 'Se creeaza...' : 'Creaza'}
					</Button>
					<Button variant="outline" onclick={() => { showNewForm = false; newName = ''; }}>
						Anuleaza
					</Button>
				</form>
				<p class="text-xs text-muted-foreground mt-2">
					Se va crea cu clauzele legale default (sectiunile 4-23). Le poti edita dupa creare.
				</p>
			</CardContent>
		</Card>
	{/if}

	{#if loading}
		<p class="text-muted-foreground">Se incarca template-urile...</p>
	{:else if templates.length === 0}
		<Card>
			<CardContent class="pt-6">
				<div class="text-center py-8">
					<p class="text-muted-foreground mb-4">Nu exista template-uri de contract inca.</p>
					<Button onclick={() => { showNewForm = true; }}>
						<PlusIcon class="mr-2 h-4 w-4" />
						Creaza primul template
					</Button>
				</div>
			</CardContent>
		</Card>
	{:else}
		<div class="space-y-3">
			{#each templates as template}
				<Card class="hover:bg-muted/30 transition-colors">
					<CardContent class="pt-6">
						<div class="flex items-start justify-between">
							<div class="flex-1">
								<div class="flex items-center gap-3">
									<h3 class="text-lg font-semibold">{template.name}</h3>
									<Badge variant={template.isActive ? 'default' : 'secondary'}>
										{template.isActive ? 'Activ' : 'Inactiv'}
									</Badge>
								</div>
								{#if template.description}
									<p class="text-sm text-muted-foreground mt-1">{template.description}</p>
								{/if}
								<div class="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
									<span>{getClauseCount(template.clausesJson)} clauze</span>
									<span>Creat: {formatDate(template.createdAt)}</span>
									<span>Actualizat: {formatDate(template.updatedAt)}</span>
								</div>
							</div>
							<div class="flex items-center gap-2">
								<Button
									variant="outline"
									size="sm"
									onclick={() => goto(`/${tenantSlug}/contract-templates/${template.id}`)}
								>
									<PencilIcon class="mr-2 h-3 w-3" />
									Editeaza
								</Button>
								<Button
									variant="ghost"
									size="sm"
									class="text-destructive"
									onclick={() => handleDelete(template.id, template.name)}
								>
									<TrashIcon class="h-4 w-4" />
								</Button>
							</div>
						</div>
					</CardContent>
				</Card>
			{/each}
		</div>
	{/if}
</div>
