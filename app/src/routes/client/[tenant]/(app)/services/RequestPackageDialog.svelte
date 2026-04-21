<script lang="ts">
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogFooter,
		DialogHeader,
		DialogTitle
	} from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Label } from '$lib/components/ui/label';
	import { createPackageRequest } from '$lib/remotes/packages.remote';
	import { toast } from 'svelte-sonner';
	import HelpCircleIcon from '@lucide/svelte/icons/help-circle';
	import {
		Tooltip,
		TooltipContent,
		TooltipProvider,
		TooltipTrigger
	} from '$lib/components/ui/tooltip';
	import {
		TIER_LABELS,
		TIER_COLORS,
		SETUP_DEFAULT_DESCRIPTION,
		type Category,
		type Tier
	} from '$lib/constants/ots-catalog';
	import CategoryIcon from '$lib/components/services/CategoryIcon.svelte';

	type Props = {
		open: boolean;
		category: Category | null;
		tier: Tier | null;
	};

	let { open = $bindable(), category, tier }: Props = $props();

	let note = $state('');
	let submitting = $state(false);

	function close() {
		open = false;
		note = '';
		submitting = false;
	}

	function formatEur(value: number | null): string {
		if (value === null) return '—';
		return `${value.toLocaleString('ro-RO')} €`;
	}

	async function handleSubmit() {
		if (!category || !tier) return;
		submitting = true;
		try {
			await createPackageRequest({
				categorySlug: category.slug,
				tier,
				note: note.trim() || undefined
			});
			toast.success('Cerere trimisă cu succes', {
				description: 'Echipa OTS te va contacta în cel mai scurt timp.'
			});
			close();
		} catch (e) {
			toast.error('Nu am putut trimite cererea', {
				description: e instanceof Error ? e.message : 'Încearcă din nou peste câteva minute.'
			});
		} finally {
			submitting = false;
		}
	}
</script>

<Dialog bind:open>
	<DialogContent class="sm:max-w-[500px]">
		{#if category && tier}
			{@const price = category.prices[tier]}
			{@const setup = category.setupFees?.[tier]}
			{@const colors = TIER_COLORS[tier]}
			<DialogHeader>
				<div class="flex items-center gap-3">
					<div class="rounded-lg bg-muted/60 p-2.5 shrink-0">
						<CategoryIcon slug={category.slug} class="h-5 w-5" />
					</div>
					<div class="min-w-0">
						<DialogTitle>Vreau pachetul {TIER_LABELS[tier]}</DialogTitle>
						<DialogDescription>
							{category.name} — {category.tagline}
						</DialogDescription>
					</div>
				</div>
			</DialogHeader>

			<div
				class="relative rounded-xl border {colors.border} {colors.metallic} p-5 my-5 shadow-md overflow-hidden"
			>
				<div
					class="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/50 to-transparent dark:from-white/10"
				></div>
				<div class="relative">
				<div class="flex items-baseline justify-between gap-3">
					<div>
						<div class="flex items-center gap-2 mb-1.5">
							<span class="h-2.5 w-2.5 rounded-full {colors.dot}"></span>
							<span class="font-semibold {colors.text}">{TIER_LABELS[tier]}</span>
						</div>
						<div class="text-2xl font-bold {colors.text}">
							{#if price !== null}
								{formatEur(price)}
								<span class="text-sm font-normal opacity-70">/lună</span>
							{:else if setup}
								{formatEur(setup)}
								<span class="text-sm font-normal opacity-70">one-time</span>
							{/if}
						</div>
					</div>
					{#if setup && price !== null}
						<TooltipProvider delayDuration={150}>
							<Tooltip>
								<TooltipTrigger
									tabindex={-1}
									class="text-xs text-muted-foreground text-right cursor-help"
								>
									<span class="inline-flex items-center gap-1">
										Setup one-time
										<HelpCircleIcon class="h-3 w-3 opacity-70" />
									</span>
									<br /><strong>{formatEur(setup)}</strong>
								</TooltipTrigger>
								<TooltipContent
									class="max-w-[320px] !bg-popover !text-popover-foreground border border-border shadow-lg p-3 rounded-lg"
									arrowClasses="!bg-popover"
								>
									<p class="font-semibold text-sm mb-1.5 text-foreground">Ce include setup-ul?</p>
									<p class="text-[13px] text-foreground/90 leading-relaxed">
										{category.setupDescription || SETUP_DEFAULT_DESCRIPTION}
									</p>
								</TooltipContent>
							</Tooltip>
						</TooltipProvider>
					{/if}
				</div>
				<p class="text-xs text-muted-foreground mt-3">
					EUR fără TVA. Bugetul media Ads se plătește separat.
				</p>
				</div>
			</div>

			<div class="grid gap-2">
				<Label for="note">Detalii (opțional)</Label>
				<Textarea
					id="note"
					bind:value={note}
					placeholder="Spune-ne mai multe despre proiect: industrie, obiective, buget media estimat, dată start..."
					rows={4}
				/>
			</div>

			<p class="text-xs text-muted-foreground mt-2">
				Trimițând cererea, echipa OTS te va contacta pentru detalii finale și contract.
			</p>

			<DialogFooter class="mt-4">
				<Button variant="outline" onclick={close} disabled={submitting}>
					Anulează
				</Button>
				<Button onclick={handleSubmit} disabled={submitting}>
					{submitting ? 'Se trimite...' : 'Trimite cererea'}
				</Button>
			</DialogFooter>
		{/if}
	</DialogContent>
</Dialog>
