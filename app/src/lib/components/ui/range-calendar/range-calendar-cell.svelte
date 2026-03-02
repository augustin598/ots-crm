<script lang="ts">
	import { RangeCalendar as RangeCalendarPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: RangeCalendarPrimitive.CellProps = $props();
</script>

<RangeCalendarPrimitive.Cell
	bind:ref
	class={cn(
		"relative size-(--cell-size) p-0 text-center text-sm focus-within:z-20",
		"[&[data-selected]:has([data-selection-end])]:rounded-e-md [&[data-selected]:has([data-selection-start])]:rounded-s-md",
		"[&[data-selected]:not(:has([data-selection-start])):not(:has([data-selection-end]))]:rounded-none",
		"data-[selected]:bg-accent",
		className
	)}
	{...restProps}
/>
