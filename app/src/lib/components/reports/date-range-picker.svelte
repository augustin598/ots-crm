<script lang="ts">
	import { Popover, PopoverContent, PopoverTrigger } from '$lib/components/ui/popover';
	import { Button } from '$lib/components/ui/button';
	import { RangeCalendar } from '$lib/components/ui/range-calendar';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import { CalendarDate, type DateValue } from '@internationalized/date';
	import { getDatePresets } from '$lib/utils/report-helpers';

	let {
		since = $bindable(''),
		until = $bindable(''),
		onchange
	}: {
		since: string;
		until: string;
		onchange?: () => void;
	} = $props();

	let open = $state(false);
	let showCustom = $state(false);
	const presets = getDatePresets();

	function parseDateStr(str: string): CalendarDate | undefined {
		if (!str) return undefined;
		const [y, m, d] = str.split('-').map(Number);
		if (!y || !m || !d) return undefined;
		return new CalendarDate(y, m, d);
	}

	function dateValueToStr(dv: DateValue): string {
		const y = dv.year;
		const m = String(dv.month).padStart(2, '0');
		const d = String(dv.day).padStart(2, '0');
		return `${y}-${m}-${d}`;
	}

	let calendarValue = $state<{ start: DateValue; end: DateValue } | undefined>(undefined);
	// Track whether the change came from a preset (to avoid calendar feedback loop)
	let fromPreset = $state(false);

	$effect(() => {
		const start = parseDateStr(since);
		const end = parseDateStr(until);
		if (start && end) {
			calendarValue = { start, end };
		}
	});

	function handleCalendarChange(val: any) {
		if (fromPreset) {
			fromPreset = false;
			return;
		}
		if (val?.start && val?.end) {
			since = dateValueToStr(val.start);
			until = dateValueToStr(val.end);
			onchange?.();
		}
	}

	function isPresetActive(preset: { since: string; until: string }): boolean {
		return preset.since === since && preset.until === until;
	}

	const isCustomRange = $derived(!presets.some((p) => p.since === since && p.until === until));

	function applyPreset(preset: { since: string; until: string }) {
		fromPreset = true;
		since = preset.since;
		until = preset.until;
		showCustom = false;
		open = false;
		onchange?.();
	}

	function formatDisplay(s: string, u: string): string {
		if (!s || !u) return 'Selectează perioada';
		for (const p of presets) {
			if (p.since === s && p.until === u) return p.label;
		}
		const fmtDate = (d: string) => {
			const date = new Date(d + 'T00:00:00');
			return date.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' });
		};
		return `${fmtDate(s)} — ${fmtDate(u)}`;
	}
</script>

<Popover bind:open>
	<PopoverTrigger>
		{#snippet child({ props })}
			<Button {...props} variant="outline" size="sm" class="gap-2">
				<CalendarIcon class="h-4 w-4" />
				<span>{formatDisplay(since, until)}</span>
			</Button>
		{/snippet}
	</PopoverTrigger>
	<PopoverContent class="w-auto p-0" align="start">
		<div class="flex">
			<!-- Presets list -->
			<div class="flex flex-col border-r py-2 min-w-[180px] max-h-[420px] overflow-y-auto">
				{#each presets as preset}
					<button
						class="flex items-center gap-3 px-4 py-1.5 text-sm text-left hover:bg-muted transition-colors {isPresetActive(preset) ? 'font-medium text-primary' : 'text-foreground'}"
						onclick={() => applyPreset(preset)}
					>
						<span class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border {isPresetActive(preset) && !showCustom ? 'border-primary' : 'border-muted-foreground/40'}">
							{#if isPresetActive(preset) && !showCustom}
								<span class="h-2 w-2 rounded-full bg-primary"></span>
							{/if}
						</span>
						{preset.label}
					</button>
				{/each}
				<!-- Custom option -->
				<button
					class="flex items-center gap-3 px-4 py-1.5 text-sm text-left hover:bg-muted transition-colors {showCustom || isCustomRange ? 'font-medium text-primary' : 'text-foreground'}"
					onclick={() => { showCustom = !showCustom; }}
				>
					<span class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border {showCustom || isCustomRange ? 'border-primary' : 'border-muted-foreground/40'}">
						{#if showCustom || isCustomRange}
							<span class="h-2 w-2 rounded-full bg-primary"></span>
						{/if}
					</span>
					Personalizat
				</button>
			</div>
			<!-- Calendar (always visible) -->
			<div class="p-3">
				<RangeCalendar
					bind:value={calendarValue}
					onValueChange={handleCalendarChange}
					numberOfMonths={2}
					locale="ro-RO"
				/>
			</div>
		</div>
	</PopoverContent>
</Popover>
