<script lang="ts">
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Tabs, TabsContent, TabsList, TabsTrigger } from '$lib/components/ui/tabs';
	import { Plus, X, Sparkles } from '@lucide/svelte';
	import MarkdownEditor from './markdown-editor.svelte';

	interface Variable {
		key: string;
		label: string;
		defaultValue?: string;
	}

	interface Styling {
		primaryColor?: string;
		secondaryColor?: string;
		fontFamily?: string;
		fontSize?: string;
		header?: { content: string; height?: number };
		footer?: { content: string; height?: number };
	}

	interface Props {
		name: string;
		description: string;
		type: 'offer' | 'generic';
		content: string;
		variables: Variable[];
		styling: Styling | null;
		onNameChange: (value: string) => void;
		onDescriptionChange: (value: string) => void;
		onTypeChange: (value: 'offer' | 'contract' | 'generic') => void;
		onContentChange: (value: string) => void;
		onVariablesChange: (value: Variable[]) => void;
		onStylingChange: (value: Styling | null) => void;
	}

	let {
		name,
		description,
		type,
		content,
		variables = $bindable([]),
		styling = $bindable(null),
		onNameChange,
		onDescriptionChange,
		onTypeChange,
		onContentChange,
		onVariablesChange,
		onStylingChange
	}: Props = $props();

	const standardVariables = [
		{ key: 'tenant.name', label: 'Tenant Name' },
		{ key: 'tenant.cui', label: 'Tenant CUI' },
		{ key: 'tenant.address', label: 'Tenant Address' },
		{ key: 'tenant.city', label: 'Tenant City' },
		{ key: 'tenant.iban', label: 'Tenant IBAN' },
		{ key: 'tenant.legalRepresentative', label: 'Tenant Legal Representative' },
		{ key: 'client.name', label: 'Client Name' },
		{ key: 'client.email', label: 'Client Email' },
		{ key: 'client.phone', label: 'Client Phone' },
		{ key: 'client.cui', label: 'Client CUI' },
		{ key: 'client.address', label: 'Client Address' },
		{ key: 'client.city', label: 'Client City' },
		{ key: 'client.iban', label: 'Client IBAN' },
		{ key: 'client.legalRepresentative', label: 'Client Legal Representative' },
		{ key: 'project.name', label: 'Project Name' },
		{ key: 'project.description', label: 'Project Description' },
		{ key: 'project.budget', label: 'Project Budget' },
		{ key: 'date', label: 'Current Date' },
		{ key: 'year', label: 'Current Year' }
	];

	function addVariable() {
		variables = [...variables, { key: '', label: '' }];
		onVariablesChange(variables);
	}

	function removeVariable(index: number) {
		variables = variables.filter((_, i) => i !== index);
		onVariablesChange(variables);
	}

	function updateVariable(index: number, field: 'key' | 'label' | 'defaultValue', value: string) {
		variables = variables.map((v, i) => (i === index ? { ...v, [field]: value } : v));
		onVariablesChange(variables);
	}

	let markdownEditorRef: { insertText: (text: string) => void } | null = $state(null);

	function insertVariable(variableKey: string) {
		if (markdownEditorRef) {
			markdownEditorRef.insertText(`{{${variableKey}}}`);
		} else {
			// Fallback: insert at end of content
			onContentChange(`${content}\n{{${variableKey}}}`);
		}
	}

	function updateStyling(field: keyof Styling, value: any) {
		styling = { ...(styling || {}), [field]: value };
		onStylingChange(styling);
	}

	function updateHeaderContent(value: string) {
		const header = { ...(styling?.header || { content: '', height: 60 }), content: value };
		updateStyling('header', header);
	}

	function updateHeaderHeight(value: number) {
		const header = { ...(styling?.header || { content: '', height: 60 }), height: value };
		updateStyling('header', header);
	}

	function updateFooterContent(value: string) {
		const footer = { ...(styling?.footer || { content: '', height: 60 }), content: value };
		updateStyling('footer', footer);
	}

	function updateFooterHeight(value: number) {
		const footer = { ...(styling?.footer || { content: '', height: 60 }), height: value };
		updateStyling('footer', footer);
	}
</script>

<div class="space-y-6">
	<Tabs value="content" class="w-full">
		<TabsList class="grid w-full grid-cols-3 bg-muted/50">
			<TabsTrigger value="content" class="data-[state=active]:bg-background">Content</TabsTrigger>
			<TabsTrigger value="variables" class="data-[state=active]:bg-background">Variables</TabsTrigger>
			<TabsTrigger value="styling" class="data-[state=active]:bg-background">Styling</TabsTrigger>
		</TabsList>

		<TabsContent value="content" class="space-y-4">
			<Card class="border-2">
				<CardHeader class="pb-3">
					<div class="flex items-center gap-2">
						<Sparkles class="h-5 w-5 text-primary" />
						<CardTitle>Template Content</CardTitle>
					</div>
					<CardDescription>
						Write your template using Markdown. Use variables like {'{{client.name}}'} - they'll be replaced when generating documents.
					</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					<MarkdownEditor
						bind:this={markdownEditorRef}
						bind:value={content}
						onChange={onContentChange}
						placeholder="# Document Title

Write your content here using **Markdown** formatting.

- Use variables: {`{{client.name}}`}, {`{{tenant.name}}`}, {`{{date}}`}
- Format text with *italic* or **bold**
- Create lists and headings"
						label="Content *"
					/>
					<div class="rounded-lg bg-muted/50 p-3">
						<p class="text-xs font-medium mb-2">Quick Tips:</p>
						<ul class="text-xs text-muted-foreground space-y-1 list-disc list-inside">
							<li>Use <code class="bg-background px-1 rounded"># Heading</code> for titles</li>
							<li>Use <code class="bg-background px-1 rounded">**bold**</code> or <code class="bg-background px-1 rounded">*italic*</code> for emphasis</li>
							<li>Click variable buttons below to insert them into your content</li>
						</ul>
					</div>
				</CardContent>
			</Card>
		</TabsContent>

		<TabsContent value="variables" class="space-y-4">
			<Card class="border-2">
				<CardHeader class="pb-3">
					<CardTitle>Variables</CardTitle>
					<CardDescription>
						Insert variables into your content. Standard variables are auto-filled, custom ones require user input.
					</CardDescription>
				</CardHeader>
				<CardContent class="space-y-6">
					<div class="space-y-3">
						<div>
							<Label class="text-sm font-semibold">Standard Variables</Label>
							<p class="text-xs text-muted-foreground mt-1 mb-3">
								Click to insert. These are automatically filled from client/tenant data.
							</p>
						</div>
						<div class="flex flex-wrap gap-2">
							{#each standardVariables as variable}
								<Button
									type="button"
									variant="outline"
									size="sm"
									onclick={() => insertVariable(variable.key)}
									class="h-8"
								>
									{variable.label}
								</Button>
							{/each}
						</div>
					</div>

					<div class="space-y-3 border-t pt-4">
						<div class="flex items-center justify-between">
							<div>
								<Label class="text-sm font-semibold">Custom Variables</Label>
								<p class="text-xs text-muted-foreground mt-1">
									Define variables that users will fill when creating documents.
								</p>
							</div>
							<Button type="button" variant="default" size="sm" onclick={addVariable}>
								<Plus class="h-4 w-4 mr-2" />
								Add Variable
							</Button>
						</div>

						{#if variables.length === 0}
							<div class="rounded-lg border-2 border-dashed p-8 text-center">
								<p class="text-sm text-muted-foreground">No custom variables defined</p>
								<p class="text-xs text-muted-foreground mt-1">
									Click "Add Variable" to create one
								</p>
							</div>
						{:else}
							<div class="space-y-3">
								{#each variables as variable, index}
									<div class="flex gap-3 items-start border rounded-lg p-4 bg-card hover:bg-muted/50 transition-colors">
										<div class="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3">
											<div class="space-y-1.5">
												<Label for="var-key-{index}" class="text-xs font-medium">
													Key *
												</Label>
												<Input
													id="var-key-{index}"
													value={variable.key}
													placeholder="variable_key"
													oninput={(e) =>
														updateVariable(index, 'key', (e.target as HTMLInputElement).value)
													}
													class="h-9"
												/>
											</div>
											<div class="space-y-1.5">
												<Label for="var-label-{index}" class="text-xs font-medium">
													Label *
												</Label>
												<Input
													id="var-label-{index}"
													value={variable.label}
													placeholder="Variable Label"
													oninput={(e) =>
														updateVariable(index, 'label', (e.target as HTMLInputElement).value)
													}
													class="h-9"
												/>
											</div>
											<div class="space-y-1.5">
												<Label for="var-default-{index}" class="text-xs font-medium">
													Default Value
												</Label>
												<Input
													id="var-default-{index}"
													value={variable.defaultValue || ''}
													placeholder="Optional"
													oninput={(e) =>
														updateVariable(
															index,
															'defaultValue',
															(e.target as HTMLInputElement).value
														)
													}
													class="h-9"
												/>
											</div>
										</div>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											onclick={() => removeVariable(index)}
											class="mt-6 h-9 w-9 p-0 text-destructive hover:text-destructive"
										>
											<X class="h-4 w-4" />
										</Button>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				</CardContent>
			</Card>
		</TabsContent>

		<TabsContent value="styling" class="space-y-4">
			<Card class="border-2">
				<CardHeader class="pb-3">
					<CardTitle>Styling Options</CardTitle>
					<CardDescription>
						Customize colors, fonts, and layout for documents generated from this template
					</CardDescription>
				</CardHeader>
				<CardContent class="space-y-6">
					<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div class="space-y-2">
							<Label for="primaryColor" class="text-sm font-medium">Primary Color</Label>
							<p class="text-xs text-muted-foreground">Used for headings and accents</p>
							<div class="flex gap-2 items-center">
								<Input
									id="primaryColor"
									type="color"
									value={styling?.primaryColor || '#000000'}
									oninput={(e) =>
										updateStyling('primaryColor', (e.target as HTMLInputElement).value)
									}
									class="w-16 h-10 cursor-pointer"
								/>
								<Input
									type="text"
									value={styling?.primaryColor || '#000000'}
									oninput={(e) =>
										updateStyling('primaryColor', (e.target as HTMLInputElement).value)
									}
									placeholder="#000000"
									class="flex-1 font-mono text-sm"
								/>
							</div>
						</div>

						<div class="space-y-2">
							<Label for="secondaryColor" class="text-sm font-medium">Secondary Color</Label>
							<p class="text-xs text-muted-foreground">Used for backgrounds and highlights</p>
							<div class="flex gap-2 items-center">
								<Input
									id="secondaryColor"
									type="color"
									value={styling?.secondaryColor || '#666666'}
									oninput={(e) =>
										updateStyling('secondaryColor', (e.target as HTMLInputElement).value)
									}
									class="w-16 h-10 cursor-pointer"
								/>
								<Input
									type="text"
									value={styling?.secondaryColor || '#666666'}
									oninput={(e) =>
										updateStyling('secondaryColor', (e.target as HTMLInputElement).value)
									}
									placeholder="#666666"
									class="flex-1 font-mono text-sm"
								/>
							</div>
						</div>
					</div>

					<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div class="space-y-2">
							<Label for="fontFamily" class="text-sm font-medium">Font Family</Label>
							<Select
								value={styling?.fontFamily || 'Helvetica'}
								type="single"
								onValueChange={(value: string | undefined) => updateStyling('fontFamily', value)}
							>
								<SelectTrigger id="fontFamily">
									{styling?.fontFamily || 'Helvetica'}
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="Helvetica">Helvetica</SelectItem>
									<SelectItem value="Arial">Arial</SelectItem>
									<SelectItem value="Times New Roman">Times New Roman</SelectItem>
									<SelectItem value="Georgia">Georgia</SelectItem>
									<SelectItem value="Courier New">Courier New</SelectItem>
									<SelectItem value="Verdana">Verdana</SelectItem>
								</SelectContent>
							</Select>
						</div>

						<div class="space-y-2">
							<Label for="fontSize" class="text-sm font-medium">Font Size</Label>
							<Select
								value={styling?.fontSize || '12px'}
								type="single"
								onValueChange={(value: string | undefined) => updateStyling('fontSize', value)}
							>
								<SelectTrigger id="fontSize">
									{styling?.fontSize || '12px'}
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="10px">10px</SelectItem>
									<SelectItem value="12px">12px</SelectItem>
									<SelectItem value="14px">14px</SelectItem>
									<SelectItem value="16px">16px</SelectItem>
									<SelectItem value="18px">18px</SelectItem>
									<SelectItem value="20px">20px</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>

					<div class="space-y-4 border-t pt-4">
						<div class="space-y-2">
							<Label class="text-sm font-medium">Header</Label>
							<p class="text-xs text-muted-foreground">Optional header that appears on every page</p>
							<Textarea
								value={styling?.header?.content || ''}
								placeholder="Header content (supports variables)"
								rows="3"
								oninput={(e) => updateHeaderContent((e.target as HTMLTextAreaElement).value)}
							/>
							<div class="flex items-center gap-2">
								<Label for="headerHeight">Height (px)</Label>
								<Input
									id="headerHeight"
									type="number"
									value={String(styling?.header?.height || 60)}
									min="0"
									oninput={(e) =>
										updateHeaderHeight(parseInt((e.target as HTMLInputElement).value) || 60)
									}
									class="w-24"
								/>
							</div>
						</div>

						<div class="space-y-2">
							<Label class="text-sm font-medium">Footer</Label>
							<p class="text-xs text-muted-foreground">Optional footer that appears on every page</p>
							<Textarea
								value={styling?.footer?.content || ''}
								placeholder="Footer content (supports variables)"
								rows="3"
								oninput={(e) => updateFooterContent((e.target as HTMLTextAreaElement).value)}
							/>
							<div class="flex items-center gap-2">
								<Label for="footerHeight">Height (px)</Label>
								<Input
									id="footerHeight"
									type="number"
									value={String(styling?.footer?.height || 60)}
									min="0"
									oninput={(e) =>
										updateFooterHeight(parseInt((e.target as HTMLInputElement).value) || 60)
									}
									class="w-24"
								/>
							</div>
						</div>
					</div>
				</CardContent>
			</Card>
		</TabsContent>
	</Tabs>
</div>
