import { describe, expect, it } from 'bun:test';
import { nameMatchScore } from './groups';

// Cazurile vin din două grupuri reale (Lucky Group, Beauty One) — unde propunerea
// automată trebuie să fie sigură și unde trebuie să rămână doar o sugestie.
describe('nameMatchScore', () => {
	it('nume + prenume identice → potrivire tare (1)', () => {
		expect(nameMatchScore('Mihai Mocanu', 'Mihai Mocanu')).toBe(1);
		expect(nameMatchScore('Iulia Mitu', 'Iulia Mitu')).toBe(1);
	});

	it('ignoră diacriticele și ordinea cuvintelor', () => {
		expect(nameMatchScore('Mădălina Apetre', 'madalina apetre2')).toBe(0.5); // „apetre2" ≠ „apetre"
		expect(nameMatchScore('Mocanu Mihai', 'Mihai Mocanu')).toBe(1);
	});

	it('un singur cuvânt comun → doar sugestie (0.5)', () => {
		expect(nameMatchScore('George D', 'George')).toBe(0.5);
		expect(nameMatchScore('Sergiu Barzu', 'Birzu Sergiu')).toBe(0.5); // Barzu ≠ Birzu
		expect(nameMatchScore('Daniela PR & Marketing', 'Daniela HR Marketing')).toBe(1); // daniela + marketing
	});

	it('cuvinte scurte (inițiale, „&", „de") nu contează', () => {
		expect(nameMatchScore('George D', 'Dan Popescu')).toBe(0);
		expect(nameMatchScore('A & B', 'A B')).toBe(0);
	});

	it('fără nume → 0', () => {
		expect(nameMatchScore(null, 'Mihai Mocanu')).toBe(0);
		expect(nameMatchScore('Mihai Mocanu', null)).toBe(0);
		expect(nameMatchScore('', '')).toBe(0);
	});

	it('numele brandului nu se potrivește cu o persoană', () => {
		expect(nameMatchScore('George Lucky Studio', 'Claudia Darie')).toBe(0);
		expect(nameMatchScore('Alice Beauty One', 'Alice')).toBe(0.5);
	});
});
