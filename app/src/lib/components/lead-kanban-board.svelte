<script lang="ts">
	import { Card } from '$lib/components/ui/card';
	import { toast } from 'svelte-sonner';
	import {
		LEAD_STATUSES,
		LEAD_STATUS_LABELS,
		LEAD_STATUS_COLORS,
		getStatusBorderColor,
		getColumnHeaderColor,
		formatLeadDate
	} from './lead-kanban-utils';

	type Props = {
		leads: any[];
		readonly: boolean;
		tenantSlug: string;
		onLeadClick: (lead: any) => void;
		onStatusChange?: (leadId: string, newStatus: string) => Promise<void>;
	};

	let { leads, readonly, tenantSlug, onLeadClick, onStatusChange }: Props = $props();

	// Optimistic updates
	let optimisticLeads = $state<any[]>(leads);

	$effect(() => {
		optimisticLeads = leads;
	});

	// Group leads by status, sorted by externalCreatedAt DESC
	const groupedLeads = $derived.by(() => {
		const groups: Record<string, any[]> = {
			new: [],
			contacted: [],
			qualified: [],
			converted: [],
			disqualified: []
		};

		const source = optimisticLeads.length > 0 ? optimisticLeads : leads;

		for (const lead of source) {
			const status = lead.status || 'new';
			if (status in groups) {
				groups[status].push(lead);
			}
		}

		// Sort each group by externalCreatedAt DESC
		for (const status in groups) {
			groups[status].sort((a: any, b: any) => {
				const dateA = a.externalCreatedAt ? new Date(a.externalCreatedAt).getTime() : 0;
				const dateB = b.externalCreatedAt ? new Date(b.externalCreatedAt).getTime() : 0;
				return dateB - dateA;
			});
		}

		return groups;
	});

	// Drag state
	let draggedLead = $state<any | null>(null);
	let draggedFromStatus = $state<string | null>(null);
	let dragOverStatus = $state<string | null>(null);
	let isDragging = $state(false);

	function handleDragStart(e: DragEvent, lead: any, status: string) {
		if (readonly) return;
		if (!(e.target instanceof HTMLElement)) return;
		draggedLead = lead;
		draggedFromStatus = status;
		isDragging = true;
		e.dataTransfer!.effectAllowed = 'move';
		e.dataTransfer!.dropEffect = 'move';
		if (e.target) {
			e.target.style.opacity = '0.5';
		}
	}

	function handleDragEnd(e: DragEvent) {
		isDragging = false;
		draggedLead = null;
		draggedFromStatus = null;
		dragOverStatus = null;
		if (e.target instanceof HTMLElement) {
			e.target.style.opacity = '1';
		}
	}

	function handleDragOver(e: DragEvent, status: string) {
		e.preventDefault();
		e.dataTransfer!.dropEffect = 'move';
		dragOverStatus = status;
	}

	function handleDragLeave() {
		dragOverStatus = null;
	}

	async function handleDrop(e: DragEvent, targetStatus: string) {
		e.preventDefault();
		if (!draggedLead || !draggedFromStatus || !onStatusChange) return;
		if (draggedFromStatus === targetStatus) {
			draggedLead = null;
			draggedFromStatus = null;
			dragOverStatus = null;
			isDragging = false;
			return;
		}

		const leadId = draggedLead.id;
		const oldStatus = draggedFromStatus;

		// Optimistic update
		optimisticLeads = optimisticLeads.map((l) =>
			l.id === leadId ? { ...l, status: targetStatus } : l
		);

		// Reset drag state
		draggedLead = null;
		draggedFromStatus = null;
		dragOverStatus = null;
		isDragging = false;

		try {
			await onStatusChange(leadId, targetStatus);
		} catch {
			// Rollback on error
			optimisticLeads = leads;
			toast.error('Eroare la actualizare status');
		}
	}
</script>

<div class="grid gap-4 lg:grid-cols-5 overflow-x-auto pb-4">
	{#each LEAD_STATUSES as status}
		{@const statusLeads = groupedLeads[status] || []}
		<div class="flex flex-col min-w-[240px]">
			<!-- Column header -->
			<div class="flex items-center justify-between mb-3 px-1">
				<h3 class="font-semibold text-sm {getColumnHeaderColor(status)}">
					{LEAD_STATUS_LABELS[status]}
				</h3>
				<span class="inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full text-xs font-medium {LEAD_STATUS_COLORS[status]}">
					{statusLeads.length}
				</span>
			</div>

			<!-- Column body -->
			<div
				class="flex-1 space-y-2 min-h-[200px] rounded-lg p-2 transition-colors {dragOverStatus === status ? 'bg-muted/60 ring-2 ring-primary/30' : 'bg-muted/20'}"
				ondragover={(e) => handleDragOver(e, status)}
				ondragleave={handleDragLeave}
				ondrop={(e) => handleDrop(e, status)}
			>
				{#each statusLeads as lead (lead.id)}
					{@const isDragged = draggedLead?.id === lead.id}
					<Card
						class="p-0 {readonly ? 'cursor-pointer' : 'cursor-move'} hover:shadow-md transition-all overflow-hidden {getStatusBorderColor(status)} {isDragged ? 'opacity-50' : ''}"
						draggable={!readonly}
						ondragstart={(e) => handleDragStart(e, lead, status)}
						ondragend={handleDragEnd}
						onclick={() => onLeadClick(lead)}
					>
						<div class="p-3">
							<!-- Name -->
							<h4 class="font-medium text-sm leading-snug line-clamp-1 mb-1">
								{lead.fullName || 'Fără nume'}
							</h4>

							<!-- Email & Phone -->
							{#if lead.email}
								<p class="text-xs text-muted-foreground truncate">{lead.email}</p>
							{/if}
							{#if lead.phoneNumber}
								<p class="text-xs text-muted-foreground truncate">{lead.phoneNumber}</p>
							{/if}

							<!-- Form name badge + date -->
							<div class="flex items-center justify-between gap-2 mt-2">
								{#if lead.formName}
									<span class="inline-flex items-center text-[10px] font-medium bg-muted px-1.5 py-0.5 rounded truncate max-w-[140px]">
										{lead.formName}
									</span>
								{:else}
									<span></span>
								{/if}
								<span class="text-[10px] text-muted-foreground whitespace-nowrap">
									{formatLeadDate(lead.externalCreatedAt)}
								</span>
							</div>
						</div>
					</Card>
				{/each}

				{#if statusLeads.length === 0}
					<div class="flex items-center justify-center py-8 text-xs text-muted-foreground">
						Niciun lead
					</div>
				{/if}
			</div>
		</div>
	{/each}
</div>
