<script lang="ts">
	import { createContractTemplate } from '$lib/remotes/contract-templates.remote';
	import { getDefaultContractClauses } from '$lib/contract-templates';
	import type { ContractClause } from '$lib/contract-templates';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
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

	const tenantSlug = $derived(page.params.tenant);
	const defaultClauses = getDefaultContractClauses();

	let name = $state('');
	let description = $state('');
	let clauses = $state<ContractClause[]>(
		defaultClauses.map((c) => ({ ...c, paragraphs: [...c.paragraphs] }))
	);
	let isActive = $state(true);
	let creating = $state(false);

	async function handleSubmit() {
		if (!name.trim()) {
			toast.error('Numele este obligatoriu');
			return;
		}

		creating = true;
		try {
			const result = await createContractTemplate({
				name: name.trim(),
				description: description.trim() || undefined,
				clausesJson: JSON.stringify(clauses),
				isActive
			});

			if (result.success && result.templateId) {
				toast.success('Template creat cu succes');
				goto(`/${tenantSlug}/contract-templates/${result.templateId}`);
			}
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la crearea template-ului');
		} finally {
			creating = false;
		}
	}
</script>

<svelte:head>
	<title>Template Nou - CRM</title>
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
		<h1 class="text-3xl font-bold tracking-tight">Template Nou</h1>
		<p class="text-muted-foreground mt-1">
			Creaza un template de contract cu clauze legale editabile
		</p>
	</div>

	<!-- Template info -->
	<Card>
		<CardContent class="pt-6 space-y-4">
			<div class="grid gap-4 md:grid-cols-2">
				<div class="space-y-1.5">
					<Label>Nume template *</Label>
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

	<!-- Submit -->
	<div class="flex justify-end gap-3 pb-8">
		<Button variant="outline" onclick={() => goto(`/${tenantSlug}/contract-templates`)}>
			Anuleaza
		</Button>
		<Button onclick={handleSubmit} disabled={creating} size="lg">
			<SaveIcon class="mr-2 h-4 w-4" />
			{creating ? 'Se creeaza...' : 'Creaza Template'}
		</Button>
	</div>
</div>
