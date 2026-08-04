// Potrivire bipartită de greutate maximă (Kuhn–Munkres / algoritmul maghiar), O(n^3).
// Modul pur, determinist, fără dependențe — aceeași intrare dă mereu aceeași ieșire.

/**
 * Rezolvă problema de asignare de COST MINIM pe o matrice pătratică.
 * Implementarea clasică cu potențiale (u, v) și drumuri de creștere.
 * Returnează `result[i] = coloana` asignată rândului i.
 */
function hungarianMinCost(a: number[][]): number[] {
	const n = a.length;
	const u = new Array<number>(n + 1).fill(0); // potențialul rândurilor
	const v = new Array<number>(n + 1).fill(0); // potențialul coloanelor
	const p = new Array<number>(n + 1).fill(0); // p[j] = rândul asignat coloanei j (1-indexat)
	const way = new Array<number>(n + 1).fill(0); // coloana precedentă pe drumul de creștere

	for (let i = 1; i <= n; i++) {
		p[0] = i;
		let j0 = 0;
		const minv = new Array<number>(n + 1).fill(Infinity);
		const used = new Array<boolean>(n + 1).fill(false);
		do {
			used[j0] = true;
			const i0 = p[j0];
			let delta = Infinity;
			let j1 = 0;
			for (let j = 1; j <= n; j++) {
				if (used[j]) continue;
				const cur = a[i0 - 1][j - 1] - u[i0] - v[j];
				if (cur < minv[j]) {
					minv[j] = cur;
					way[j] = j0;
				}
				// `<` strict: la egalitate câștigă coloana cu indicele mai mic (determinism)
				if (minv[j] < delta) {
					delta = minv[j];
					j1 = j;
				}
			}
			for (let j = 0; j <= n; j++) {
				if (used[j]) {
					u[p[j]] += delta;
					v[j] -= delta;
				} else {
					minv[j] -= delta;
				}
			}
			j0 = j1;
		} while (p[j0] !== 0);
		do {
			const j1 = way[j0];
			p[j0] = p[j1];
			j0 = j1;
		} while (j0 !== 0);
	}

	const result = new Array<number>(n).fill(-1);
	for (let j = 1; j <= n; j++) if (p[j] > 0) result[p[j] - 1] = j - 1;
	return result;
}

/**
 * Potrivire bipartită de greutate MAXIMĂ, cu perechi interzise.
 *
 * `weights[i][j] === null` = pereche neeligibilă, care nu poate fi asignată niciodată.
 * Greutățile eligibile trebuie să fie strict pozitive.
 *
 * Matricea e extinsă la una pătratică, iar celulele neeligibile / de umplutură primesc 0:
 * o asignare perfectă pe matricea extinsă are astfel exact greutatea potrivirii maxime
 * (perechile cu 0 nu contribuie și sunt eliminate la final).
 *
 * Returnează `assignment[i] = j` sau -1 dacă rândul i rămâne neasignat.
 */
export function maxWeightMatching(weights: ReadonlyArray<ReadonlyArray<number | null>>): number[] {
	const rows = weights.length;
	const cols = rows > 0 ? weights[0].length : 0;
	if (rows === 0) return [];
	if (cols === 0) return new Array<number>(rows).fill(-1);

	const n = Math.max(rows, cols);
	const cost: number[][] = [];
	for (let i = 0; i < n; i++) {
		const row = new Array<number>(n).fill(0);
		for (let j = 0; j < n; j++) {
			const w = i < rows && j < cols ? weights[i][j] : null;
			row[j] = w === null ? 0 : -w; // cost minim = greutate maximă
		}
		cost.push(row);
	}

	const assigned = hungarianMinCost(cost);
	const result = new Array<number>(rows).fill(-1);
	for (let i = 0; i < rows; i++) {
		const j = assigned[i];
		if (j >= 0 && j < cols && weights[i][j] !== null) result[i] = j;
	}
	return result;
}
