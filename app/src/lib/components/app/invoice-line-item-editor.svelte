<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import Combobox from '$lib/components/ui/combobox/combobox.svelte';
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogFooter,
		DialogHeader,
		DialogTitle
	} from '$lib/components/ui/dialog';
	import { X, Plus } from '@lucide/svelte';
	import type { KeezItem } from '$lib/server/plugins/keez/client';
	import { createKeezItem } from '$lib/remotes/keez.remote';

	interface LineItem {
		id: string;
		description: string;
		quantity: number;
		rate: number;
		taxRate?: number;
		keezItem?: KeezItem;
	}

	interface Props {
		lineItems: LineItem[];
		keezItems?: KeezItem[];
		isKeezActive?: boolean;
		onUpdate: (items: LineItem[]) => void;
		onRemove: (id: string) => void;
		onKeezItemCreated?: (item: KeezItem) => void;
		currency?: string;
		defaultTaxRate?: number;
	}

	let {
		lineItems,
		keezItems = [],
		isKeezActive = false,
		onUpdate,
		onRemove,
		onKeezItemCreated,
		currency = 'RON',
		defaultTaxRate = 19
	}: Props = $props();

	// Dialog state for creating new Keez item
	let createItemDialogOpen = $state(false);
	let creatingItem = $state(false);
	let newItemName = $state('');
	let newItemCode = $state('');
	let newItemDescription = $state('');
	let newItemVatRate = $state(String(defaultTaxRate));
	let createItemError = $state<string | null>(null);

	function updateItem(id: string, field: keyof LineItem, value: any) {
		const updated = lineItems.map((item) => {
			if (item.id === id) {
				const updatedItem = { ...item, [field]: value };
				// Auto-calculate amount if quantity or rate changes
				if (field === 'quantity' || field === 'rate') {
					// Amount is calculated on the server, but we can show preview
				}
				return updatedItem;
			}
			return item;
		});
		onUpdate(updated);
	}

	function selectKeezItem(itemId: string, keezItem: KeezItem) {
		const updated = lineItems.map((item) => {
			if (item.id === itemId) {
				return {
					...item,
					description: keezItem.name,
					keezItem,
					rate: keezItem.lastPrice || 0, // Auto-set price from Keez item
					taxRate: defaultTaxRate // Use default VAT rate from settings
				};
			}
			return item;
		});
		onUpdate(updated);
	}

	function addLineItem() {
		const newItem: LineItem = {
			id: crypto.randomUUID(),
			description: '',
			quantity: 1,
			rate: 0,
			taxRate: defaultTaxRate
		};
		onUpdate([...lineItems, newItem]);
	}

	async function handleCreateKeezItem() {
		if (!newItemName.trim()) {
			createItemError = 'Item name is required';
			return;
		}

		creatingItem = true;
		createItemError = null;

		try {
			const result = await createKeezItem({
				name: newItemName.trim(),
				code: newItemCode.trim() || undefined,
				description: newItemDescription.trim() || undefined,
				vatRate: parseFloat(newItemVatRate) || undefined
			});

			if (result.success) {
				// Fetch the created item (we'll need to reload keezItems)
				const newItem: KeezItem = {
					externalId: result.externalId,
					lastPrice: 0,
					name: newItemName.trim(),
					code: newItemCode.trim() || '',
					currencyCode: 'RON',
					measureUnitId: 1,
					categoryExternalId: 'MISCSRV',
					categoryName: 'Servicii diverse',
					isActive: true,
					isStockable: false
				};

				if (onKeezItemCreated) {
					onKeezItemCreated(newItem);
				}

				// Reset form and close dialog
				newItemName = '';
				newItemCode = '';
				newItemDescription = '';
				newItemVatRate = String(defaultTaxRate);
				createItemDialogOpen = false;
			}
		} catch (e) {
			createItemError = e instanceof Error ? e.message : 'Failed to create item';
		} finally {
			creatingItem = false;
		}
	}

	const keezItemOptions = $derived(
		keezItems.map((item) => ({
			value: item.externalId || '',
			label: `${item.name}${item.code ? ` (${item.code})` : ''}`
		}))
	);

	// Track selected Keez item IDs for each line item
	const keezSelections = $state<Record<string, string>>({});

	// Initialize selections from line items
	$effect(() => {
		for (const item of lineItems) {
			const currentId = item.keezItem?.externalId || '';
			if (currentId && keezSelections[item.id] !== currentId) {
				keezSelections[item.id] = currentId;
			} else if (!currentId && keezSelections[item.id] && keezSelections[item.id] !== '') {
				// Clear selection if item no longer has keezItem
				delete keezSelections[item.id];
			}
		}
	});

	// Handle Keez selection change
	function handleKeezSelectionChange(itemId: string, selectedId: string | number | undefined) {
		const selectedIdStr = selectedId ? String(selectedId) : undefined;
		if (selectedIdStr) {
			keezSelections[itemId] = selectedIdStr;
			const keezItem = keezItems.find((ki) => ki.externalId === selectedIdStr);
			if (keezItem) {
				selectKeezItem(itemId, keezItem);
			}
		} else {
			delete keezSelections[itemId];
			const item = lineItems.find((i) => i.id === itemId);
			if (item?.keezItem) {
				updateItem(itemId, 'description', '');
				updateItem(itemId, 'keezItem', undefined);
			}
		}
	}
</script>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<Label>Line Items</Label>
		<Button type="button" variant="outline" size="sm" onclick={addLineItem}>
			Add Line Item
		</Button>
	</div>

	{#if lineItems.length === 0}
		<div class="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
			No line items. Click "Add Line Item" to add one.
		</div>
	{:else}
		<div class="space-y-3">
			{#each lineItems as item (item.id)}
				<div class="rounded-lg border p-4 space-y-3">
					<div class="flex items-start justify-between">
						<div class="flex-1 space-y-3">
							<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
								<div class="space-y-2">
									<Label for="description-{item.id}">Description *</Label>
									{#if isKeezActive}
									{@const itemId = item.id}
										<div class="flex gap-2">
											<div class="flex-1">
												<Combobox
													options={[
														{ value: '', label: 'Manual entry' },
														...keezItemOptions
													]}
													value={keezSelections[itemId] || item.keezItem?.externalId || ''}
													onValueChange={(val) => handleKeezSelectionChange(itemId, val)}
													placeholder="Select article or enter manually"
													searchPlaceholder="Search articles..."
												/>
											</div>
											<Button
												type="button"
												variant="outline"
												size="icon"
												onclick={() => (createItemDialogOpen = true)}
												title="Create new article in Keez"
											>
												<Plus class="h-4 w-4" />
											</Button>
										</div>
									{/if}
									<Input
										id="description-{item.id}"
										value={item.description}
										oninput={(e) => updateItem(item.id, 'description', e.currentTarget.value)}
										placeholder="Enter description"
										disabled={!!item.keezItem}
									/>
								</div>

								<div class="grid grid-cols-3 gap-2">
									<div class="space-y-2">
										<Label for="quantity-{item.id}">Quantity</Label>
										<Input
											id="quantity-{item.id}"
											type="number"
											step="0.01"
											bind:value={item.quantity}
											oninput={(e) =>
												updateItem(item.id, 'quantity', parseFloat(e.currentTarget.value) || 0)}
										/>
									</div>

									<div class="space-y-2">
										<Label for="rate-{item.id}">Unit Price ({currency})</Label>
										<Input
											id="rate-{item.id}"
											type="number"
											step="0.01"
											bind:value={item.rate}
											oninput={(e) =>
												updateItem(item.id, 'rate', parseFloat(e.currentTarget.value) || 0)}
										/>
									</div>

									<div class="space-y-2">
										<Label for="taxRate-{item.id}">Tax Rate (%)</Label>
										<Input
											id="taxRate-{item.id}"
											type="number"
											step="0.01"
											bind:value={item.taxRate}
											oninput={(e) =>
												updateItem(item.id, 'taxRate', parseFloat(e.currentTarget.value) || 0)}
										/>
									</div>
								</div>
							</div>

							<div class="text-sm text-muted-foreground">
								Amount: {(item.quantity * item.rate).toFixed(2)} {currency}
								{#if item.taxRate}
									| Tax: {((item.quantity * item.rate * item.taxRate) / 100).toFixed(2)} {currency}
									| Total: {((item.quantity * item.rate * (1 + item.taxRate / 100))).toFixed(2)} {currency}
								{/if}
							</div>
						</div>

						<Button
							type="button"
							variant="ghost"
							size="icon"
							onclick={() => onRemove(item.id)}
							class="text-destructive hover:text-destructive"
						>
							<X class="h-4 w-4" />
						</Button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- Create Keez Item Dialog -->
<Dialog bind:open={createItemDialogOpen}>
	<DialogContent>
		<DialogHeader>
			<DialogTitle>Create New Article in Keez</DialogTitle>
			<DialogDescription>Add a new article that will be available for future invoices</DialogDescription>
		</DialogHeader>

		<div class="space-y-4 py-4">
			<div class="space-y-2">
				<Label for="newItemName">Name *</Label>
				<Input
					id="newItemName"
					bind:value={newItemName}
					placeholder="Article name"
					required
				/>
			</div>

			<div class="space-y-2">
				<Label for="newItemCode">Code</Label>
				<Input
					id="newItemCode"
					bind:value={newItemCode}
					placeholder="Article code (optional)"
				/>
			</div>

			<div class="space-y-2">
				<Label for="newItemDescription">Description</Label>
				<Input
					id="newItemDescription"
					bind:value={newItemDescription}
					placeholder="Article description (optional)"
				/>
			</div>

			<div class="space-y-2">
				<Label for="newItemVatRate">VAT Rate (%)</Label>
				<Input
					id="newItemVatRate"
					type="number"
					step="0.01"
					bind:value={newItemVatRate}
					placeholder="19"
				/>
			</div>

			{#if createItemError}
				<div class="rounded-md bg-red-50 dark:bg-red-900/20 p-3">
					<p class="text-sm text-red-800 dark:text-red-200">{createItemError}</p>
				</div>
			{/if}
		</div>

		<DialogFooter>
			<Button
				type="button"
				variant="outline"
				onclick={() => {
					createItemDialogOpen = false;
					createItemError = null;
				}}
			>
				Cancel
			</Button>
			<Button type="button" onclick={handleCreateKeezItem} disabled={creatingItem || !newItemName.trim()}>
				{creatingItem ? 'Creating...' : 'Create Article'}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
