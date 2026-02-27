<script lang="ts">
	import {
		getContractTemplate,
		updateContractTemplate,
		deleteContractTemplate
	} from '$lib/remotes/contract-templates.remote';
	import { getDefaultContractClauses } from '$lib/contract-templates';
	import type { ContractClause } from '$lib/contract-templates';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Separator } from '$lib/components/ui/separator';
	import ContractClausesEditor from '$lib/components/app/contract-clauses-editor.svelte';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import SaveIcon from '@lucide/svelte/icons/save';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import { untrack } from 'svelte';

	const tenantSlug = $derived(page.params.tenant);
	const templateId = $derived(page.params.templateId);

	const templateQuery = getContractTemplate(templateId);
	const template = $derived(templateQuery.current);
	const loadingTemplate = $derived(templateQuery.loading);

	const defaultClauses = getDefaultContractClauses();

	// Form state
	let name = $state('');
	let description = $state('');
	let clauses = $state<ContractClause[]>([]);
	let isActive = $state(true);
	let saving = $state(false);
	let initialized = $state(false);

	// Initialize form when template loads
	$effect(() => {
		if (template && !initialized) {
			untrack(() => {
				name = template.name || '';
				description = template.description || '';
				isActive = template.isActive ?? true;

				// Parse clausesJson
				if (template.clausesJson) {
					try {
						clauses = JSON.parse(template.clausesJson);
					} catch {
						clauses = defaultClauses.map((c) => ({ ...c, paragraphs: [...c.paragraphs] }));
					}
				} else {
					clauses = defaultClauses.map((c) => ({ ...c, paragraphs: [...c.paragraphs] }));
				}

				initialized = true;
			});
		}
	});

	async function handleSave() {
		if (!name.trim()) {
			toast.error('Numele este obligatoriu');
			return;
		}

		saving = true;
		try {
			await updateContractTemplate({
				templateId,
				name: name.trim(),
				description: description.trim() || undefined,
				clausesJson: JSON.stringify(clauses),
				isActive
			}).updates(templateQuery);

			toast.success('Template salvat cu succes');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la salvarea template-ului');
		} finally {
			saving = false;
		}
	}

	async function handleDelete() {
		if (!confirm(`Esti sigur ca vrei sa stergi template-ul "${name}"?`)) {
			return;
		}

		try {
			await deleteContractTemplate(templateId);
			toast.success('Template sters');
			goto(`/${tenantSlug}/contract-templates`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la stergerea template-ului');
		}
	}
</script>

<svelte:head>
	<title>{name || 'Editeaza Template'} - CRM</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-6">
		<Button
			variant="ghost"
			size="sm"
			class="mb-4"
			onclick={() => goto(`/${tenantSlug}/contract-templates`)}
		>
			<ArrowLeftIcon class="mr-2 h-4 w-4" />
			Inapoi la Template-uri
		</Button>
		<div class="flex items-center justify-between">
			<h1 class="text-3xl font-bold tracking-tight">
				{loadingTemplate ? 'Se incarca...' : `Editeaza: ${name}`}
			</h1>
			<div class="flex items-center gap-2">
				<Button
					variant="ghost"
					size="sm"
					class="text-destructive"
					onclick={handleDelete}
				>
					<TrashIcon class="mr-2 h-4 w-4" />
					Sterge
				</Button>
				<Button onclick={handleSave} disabled={saving}>
					<SaveIcon class="mr-2 h-4 w-4" />
					{saving ? 'Se salveaza...' : 'Salveaza'}
				</Button>
			</div>
		</div>
	</div>

	{#if loadingTemplate}
		<p class="text-muted-foreground">Se incarca template-ul...</p>
	{:else if initialized}
		<!-- Template info -->
		<Card>
			<CardContent class="pt-6 space-y-4">
				<div class="grid gap-4 md:grid-cols-2">
					<div class="space-y-1.5">
						<Label>Nume template</Label>
						<Input bind:value={name} placeholder="ex: Prestari Servicii Informatice" />
					</div>
					<div class="space-y-1.5">
						<Label>Status</Label>
						<div class="flex items-center gap-3 h-9">
							<label class="flex items-center gap-2 cursor-pointer">
								<input type="checkbox" bind:checked={isActive} class="rounded" />
								<span class="text-sm">{isActive ? 'Activ' : 'Inactiv'}</span>
							</label>
						</div>
					</div>
				</div>
				<div class="space-y-1.5">
					<Label>Descriere</Label>
					<Textarea
						bind:value={description}
						placeholder="Descriere optionala a template-ului..."
						rows={2}
					/>
				</div>
			</CardContent>
		</Card>

		<Separator />

		<!-- Clauses editor -->
		<Card>
			<CardContent class="pt-6">
				<ContractClausesEditor
					bind:clauses
					{defaultClauses}
				/>
			</CardContent>
		</Card>

		<!-- Save button at bottom too -->
		<div class="flex justify-end gap-3 pb-8">
			<Button
				variant="outline"
				onclick={() => goto(`/${tenantSlug}/contract-templates`)}
			>
				Anuleaza
			</Button>
			<Button onclick={handleSave} disabled={saving} size="lg">
				<SaveIcon class="mr-2 h-4 w-4" />
				{saving ? 'Se salveaza...' : 'Salveaza Template'}
			</Button>
		</div>
	{/if}
</div>
