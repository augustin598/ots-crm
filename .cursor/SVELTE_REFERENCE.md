# Svelte 5 – Referință rapidă

> Documentație extrasă din [svelte.dev/docs](https://svelte.dev/docs) pentru verificare și învățare.

---

## Runes (reactivitate)

### `$state`

```svelte
<script>
	let count = $state(0);
</script>
<button onclick={() => count++}>clicks: {count}</button>
```

- Nu există `.value` – `count` este direct valoarea
- Obiecte/array-uri devin **deeply reactive** (proxy)
- Pentru obiecte nemutabile: `$state.raw()`
- Snapshot fără proxy: `$state.snapshot(obj)`

### `$derived`

```svelte
<script>
	let count = $state(0);
	let doubled = $derived(count * 2);
</script>
```

- Pentru expresii complexe: `$derived.by(() => { ... })`
- **Fără side effects** în expresie
- Destructurarea: `let { a, b } = $derived(obj)` – a, b rămân reactive

### `$effect`

```svelte
<script>
	$effect(() => {
		// rulează când state-ul citit se schimbă
		console.log(count);
		return () => { /* teardown */ };
	});
</script>
```

- Rulează doar în browser, nu la SSR
- Dependențe = doar ce e citit **sincron** în effect
- Evită modificarea state-ului în effect (risc de cicluri)

### `$props`

```svelte
<script>
	let { optional = 'default', required } = $props();
	// sau toate: let props = $props();
	// sau rest: let { foo, ...rest } = $props();
	// redenumire: let { class: klass } = $props();
</script>
```

---

## Event handlers

| Svelte 4 | Svelte 5 |
|----------|----------|
| `on:click={handler}` | `onclick={handler}` |
| `on:click\|preventDefault` | `event.preventDefault()` în handler |

- Sunt props normale, nu directive
- Capture: `onclickcapture={...}`
- Mai mulți handleri: combină într-un singur handler care apelează ambele

---

## Componente – evenimente

**Svelte 4:** `createEventDispatcher()`  
**Svelte 5:** callback props

```svelte
<!-- Parent -->
<Child oninflate={(power) => size += power} />

<!-- Child -->
<script>
	let { oninflate } = $props();
</script>
<button onclick={() => oninflate?.(power)}>inflate</button>
```

---

## Snippets (în loc de slots)

| Svelte 4 | Svelte 5 |
|----------|----------|
| `<slot />` | `{@render children?.()}` |
| `<slot name="header" />` | `{@render header()}` cu prop `header` |
| `let:item` | `{#snippet item(entry)}` cu parametru |

```svelte
<!-- Parent -->
<List items={items}>
	{#snippet item(entry)}
		<span>{entry}</span>
	{/snippet}
	{#snippet empty()}
		<span>No items</span>
	{/snippet}
</List>

<!-- Child -->
<script>
	let { items, item, empty } = $props();
</script>
{#each items as entry}
	{@render item(entry)}
{/each}
{:else}
	{@render empty?.()}
{/if}
```

---

## Erori frecvente de evitat

1. **Destructurare state reactiv** – referințele nu sunt reactive:
   ```js
   let { done } = todos[0]; // ❌ done nu se actualizează
   ```

2. **`this` în metode** – la `onclick={obj.method}` contextul e greșit:
   ```svelte
   <button onclick={() => obj.reset()}>reset</button>
   <!-- sau metodă arrow în clasă -->
   ```

3. **Export state din `.svelte.js`** – nu exporta variabile reassignate direct; folosește obiecte sau getter-e.

4. **Dependențe în `$effect`** – doar ce e citit sincron e urmărit; după `await`/`setTimeout` nu.

5. **`bind:this` pe componente** – nu mai are `$set`, `$on`, `$destroy`; doar exports.

---

## Structură fișier `.svelte`

```svelte
<script module>
	/* rulează o dată la load modul */
</script>

<script>
	/* logică per instanță, runes */
</script>

<!-- markup -->

<style>
	/* CSS scoped */
</style>
```

---

## Fișiere `.svelte.js` / `.svelte.ts`

- Pot folosi runes
- Nu exporta state reassignat direct
- Folosit pentru logică reactivă reutilizabilă

---

## Resurse

- [Svelte Docs](https://svelte.dev/docs)
- [Svelte 5 Migration Guide](https://svelte.dev/docs/svelte/v5-migration-guide)
- [llms-full.txt](https://svelte.dev/llms-full.txt) – documentație completă
