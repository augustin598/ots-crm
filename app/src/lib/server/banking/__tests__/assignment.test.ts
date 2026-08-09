import { describe, it, expect } from 'bun:test';
import { maxWeightMatching } from '../assignment';

/** LCG determinist (fără Math.random) — aceleași cazuri la fiecare rulare. */
function lcg(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s / 0x100000000;
	};
}

type Weights = (number | null)[][];

/** Enumerare exhaustivă: fiecare rând ia o coloană liberă eligibilă sau rămâne nematchuit. */
function bruteForceMax(weights: Weights): number {
	const rows = weights.length;
	const cols = rows > 0 ? weights[0].length : 0;
	const used = new Array<boolean>(cols).fill(false);
	let best = 0;
	const walk = (i: number, total: number) => {
		if (i === rows) {
			best = Math.max(best, total);
			return;
		}
		walk(i + 1, total); // rândul rămâne nematchuit
		for (let j = 0; j < cols; j++) {
			if (used[j]) continue;
			const w = weights[i][j];
			if (w === null) continue;
			used[j] = true;
			walk(i + 1, total + w);
			used[j] = false;
		}
	};
	walk(0, 0);
	return best;
}

function totalOf(weights: Weights, assignment: number[]): number {
	return assignment.reduce((sum, j, i) => (j < 0 ? sum : sum + (weights[i][j] as number)), 0);
}

function assertValid(weights: Weights, assignment: number[]): void {
	const seen = new Set<number>();
	assignment.forEach((j, i) => {
		if (j < 0) return;
		expect(weights[i][j]).not.toBeNull(); // nu asignează perechi neeligibile
		expect(seen.has(j)).toBe(false); // nicio coloană folosită de două ori
		seen.add(j);
	});
}

describe('maxWeightMatching', () => {
	it('alege perechea de greutate maximă pe o matrice 2x2', () => {
		const w: Weights = [
			[10, 1],
			[1, 10]
		];
		expect(maxWeightMatching(w)).toEqual([0, 1]);
	});

	it('sacrifică maximul local pentru un total mai mare', () => {
		// Greedy ar lua (0,0)=10 și ar bloca rândul 1; optimul e 9+9=18.
		const w: Weights = [
			[10, 9],
			[9, null]
		];
		expect(maxWeightMatching(w)).toEqual([1, 0]);
	});

	it('nu asignează niciodată o pereche neeligibilă', () => {
		const w: Weights = [
			[null, null],
			[null, 5]
		];
		expect(maxWeightMatching(w)).toEqual([-1, 1]);
	});

	it('acceptă matrice dreptunghiulare (mai multe coloane decât rânduri)', () => {
		const w: Weights = [[1, 7, 3]];
		expect(maxWeightMatching(w)).toEqual([1]);
	});

	it('acceptă matrice dreptunghiulare (mai multe rânduri decât coloane)', () => {
		const w: Weights = [[1], [7], [3]];
		expect(maxWeightMatching(w)).toEqual([-1, 0, -1]);
	});

	it('matrice goală', () => {
		expect(maxWeightMatching([])).toEqual([]);
		expect(maxWeightMatching([[]])).toEqual([-1]);
	});

	it('proprietate: egalează enumerarea exhaustivă pe 300 de matrice aleatoare', () => {
		const rand = lcg(20260804);
		for (let trial = 0; trial < 300; trial++) {
			const rows = 1 + Math.floor(rand() * 6);
			const cols = 1 + Math.floor(rand() * 6);
			const w: Weights = [];
			for (let i = 0; i < rows; i++) {
				const row: (number | null)[] = [];
				for (let j = 0; j < cols; j++) {
					row.push(rand() < 0.4 ? null : 1 + Math.floor(rand() * 1000));
				}
				w.push(row);
			}
			const assignment = maxWeightMatching(w);
			assertValid(w, assignment);
			expect(totalOf(w, assignment)).toBe(bruteForceMax(w));
		}
	});

	it('proprietate: matrice dense (fără perechi neeligibile) egalează exhaustivul', () => {
		const rand = lcg(777);
		for (let trial = 0; trial < 100; trial++) {
			const n = 1 + Math.floor(rand() * 5);
			const w: Weights = [];
			for (let i = 0; i < n; i++) {
				const row: (number | null)[] = [];
				for (let j = 0; j < n; j++) row.push(1 + Math.floor(rand() * 500));
				w.push(row);
			}
			expect(totalOf(w, maxWeightMatching(w))).toBe(bruteForceMax(w));
		}
	});

	it('determinist: aceeași intrare dă același rezultat', () => {
		const w: Weights = [
			[5, 5, 5],
			[5, 5, 5],
			[5, 5, null]
		];
		const first = maxWeightMatching(w);
		for (let i = 0; i < 5; i++) expect(maxWeightMatching(w)).toEqual(first);
	});

	// Regula de departajare e DOCUMENTATĂ în assignment.ts („`<` strict: la egalitate
	// câștigă coloana cu indicele mai mic"), dar nu era fixată de niciun test: schimbând
	// ambele apariții ale lui `<` în `<=` toată suita rămânea verde. Testele de proprietate
	// nu o prind, fiindcă `<=` întoarce tot o asignare OPTIMĂ — doar alta. Aici fixăm CARE
	// dintre optimele egale îl întoarcem, pe matrice fixe cu egalități.
	it('la egalitate câștigă coloana cu indicele mai mic (regula `<` strict)', () => {
		// Ambele asignări au totalul 4: [0,1] = 3+1, [1,0] = 2+2. Regula alege [0,1],
		// adică rândul 0 ia coloana cu indicele mai mic. Cu `<=` ar ieși [1,0].
		expect(
			maxWeightMatching([
				[3, 2],
				[2, 1]
			])
		).toEqual([0, 1]);

		// Cu o coloană în plus: [0,1] = 3+2 și [2,0] = 2+3, tot 5 amândouă. Cu `<=` ar ieși [2,0].
		expect(
			maxWeightMatching([
				[3, 1, 2],
				[3, 2, 1]
			])
		).toEqual([0, 1]);

		// Al treilea caz, cu o pereche neeligibilă în joc: [-1,0,1] = 3+3 vs [0,-1,1] = 3+3.
		expect(
			maxWeightMatching([
				[3, 2],
				[3, 1],
				[1, 3]
			])
		).toEqual([-1, 0, 1]);
	});
});
