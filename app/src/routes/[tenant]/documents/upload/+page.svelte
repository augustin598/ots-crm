<script lang="ts">
	import { uploadDocument } from '$lib/remotes/documents.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { getProjects } from '$lib/remotes/projects.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import Combobox from '$lib/components/ui/combobox/combobox.svelte';
	import { Upload, X, FileText, Loader2 } from '@lucide/svelte';
	import { cn } from '$lib/utils';

	const tenantSlug = $derived(page.params.tenant);
	const clientsQuery = getClients();
	const clients = $derived(clientsQuery.current || []);
	const projectsQuery = getProjects(undefined);
	const projects = $derived(projectsQuery.current || []);

	const clientOptions = $derived(clients.map((c) => ({ value: c.id, label: c.name })));
	const projectOptions = $derived([
		{ value: '', label: 'None' },
		...projects.map((p) => ({ value: p.id, label: p.name }))
	]);

	let name = $state('');
	let clientId = $state('');
	let projectId = $state('');
	let type = $state('other');
	let file = $state<File | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let isDragging = $state(false);
	let fileInput: HTMLInputElement | null = $state(null);

	function formatFileSize(bytes: number): string {
		if (bytes === 0) return '0 Bytes';
		const k = 1024;
		const sizes = ['Bytes', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		isDragging = true;
	}

	function handleDragLeave(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		isDragging = false;
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		isDragging = false;

		const files = e.dataTransfer?.files;
		if (files && files.length > 0) {
			file = files[0];
			if (!name) {
				name = files[0].name.replace(/\.[^/.]+$/, '');
			}
		}
	}

	function handleFileSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		const files = target.files;
		if (files && files.length > 0) {
			file = files[0];
			if (!name) {
				name = files[0].name.replace(/\.[^/.]+$/, '');
			}
		}
	}

	function handleRemove() {
		file = null;
		if (fileInput) {
			fileInput.value = '';
		}
	}

	async function handleSubmit() {
		if (!file || !clientId || !name) {
			error = 'Please fill in all required fields and select a file';
			return;
		}

		loading = true;
		error = null;

		try {
			const result = await uploadDocument({
				clientId,
				projectId: projectId || undefined,
				name,
				type: type || undefined,
				file
			});

			if (result.success) {
				goto(`/${tenantSlug}/documents`);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to upload document';
		} finally {
			loading = false;
		}
	}
</script>

<div class="space-y-6">
	<h1 class="text-3xl font-bold">Upload Document</h1>

	<Card>
		<CardHeader>
			<CardTitle>Document Information</CardTitle>
			<CardDescription>Upload a new document</CardDescription>
		</CardHeader>
		<CardContent>
			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleSubmit();
				}}
				class="space-y-4"
			>
				<div class="space-y-2">
					<Label for="clientId">Client *</Label>
					<Combobox
						bind:value={clientId}
						options={clientOptions}
						placeholder="Select a client"
						searchPlaceholder="Search clients..."
					/>
				</div>
				<div class="space-y-2">
					<Label for="projectId">Project</Label>
					<Combobox
						bind:value={projectId}
						options={projectOptions}
						placeholder="Select a project (optional)"
						searchPlaceholder="Search projects..."
					/>
				</div>
				<div class="space-y-2">
					<Label for="name">Document Name *</Label>
					<Input id="name" bind:value={name} type="text" required />
				</div>
				<div class="space-y-2">
					<Label for="type">Document Type</Label>
					<Select type="single" bind:value={type}>
						<SelectTrigger>
							{#if type === 'contract'}
								Contract
							{:else if type === 'proposal'}
								Proposal
							{:else if type === 'invoice'}
								Invoice
							{:else if type === 'other'}
								Other
							{:else}
								Select type
							{/if}
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="contract">Contract</SelectItem>
							<SelectItem value="proposal">Proposal</SelectItem>
							<SelectItem value="invoice">Invoice</SelectItem>
							<SelectItem value="other">Other</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<div class="space-y-2">
					<Label for="file">File *</Label>
					{#if file}
						<!-- File preview -->
						<div class="relative group">
							<div
								class="relative flex items-center gap-4 w-full rounded-lg border bg-muted p-4 transition-colors"
							>
								<div class="flex items-center justify-center w-12 h-12 rounded-md bg-background border">
									<FileText class="h-6 w-6 text-muted-foreground" />
								</div>
								<div class="flex-1 min-w-0">
									<p class="text-sm font-medium truncate">{file.name}</p>
									<p class="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
								</div>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									class="opacity-0 group-hover:opacity-100 transition-opacity"
									onclick={handleRemove}
									disabled={loading}
								>
									<X class="h-4 w-4" />
								</Button>
							</div>
						</div>
					{:else}
						<!-- Upload area -->
						<div
							class={cn(
								'relative flex flex-col h-[120px] w-full items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors gap-2',
								isDragging
									? 'border-primary bg-primary/5'
									: 'border-muted-foreground/25 bg-muted/50',
								loading && 'opacity-50 cursor-not-allowed',
								!loading && 'cursor-pointer hover:border-primary/50'
							)}
							role="button"
							tabindex={loading ? -1 : 0}
							ondragover={handleDragOver}
							ondragleave={handleDragLeave}
							ondrop={handleDrop}
							onclick={() => !loading && fileInput?.click()}
							onkeydown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !loading) { e.preventDefault(); fileInput?.click(); } }}
						>
							<input
								bind:this={fileInput}
								id="file"
								type="file"
								class="hidden"
								disabled={loading}
								onchange={handleFileSelect}
							/>

							{#if loading}
								<Loader2 class="h-8 w-8 animate-spin text-muted-foreground" />
								<p class="text-sm font-medium text-muted-foreground">Uploading...</p>
							{:else}
								<Upload class="h-8 w-8 text-muted-foreground" />
								<div class="text-center">
									<p class="text-sm font-medium">
										<span class="text-primary underline">Click to upload</span> or drag and drop
									</p>
									<p class="text-xs text-muted-foreground mt-1">
										Any file type up to 50MB
									</p>
								</div>
							{/if}
						</div>
					{/if}
				</div>

				{#if error}
					<div class="rounded-md bg-red-50 p-3">
						<p class="text-sm text-red-800">{error}</p>
					</div>
				{/if}

				<div class="flex items-center justify-end gap-4">
					<Button type="button" variant="outline" onclick={() => goto(`/${tenantSlug}/documents`)}>
						Cancel
					</Button>
					<Button type="submit" disabled={loading}>
						{loading ? 'Uploading...' : 'Upload Document'}
					</Button>
				</div>
			</form>
		</CardContent>
	</Card>
</div>
