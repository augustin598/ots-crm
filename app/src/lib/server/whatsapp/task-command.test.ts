import { describe, expect, it } from 'bun:test';
import { parseTaskCommand } from './task-command-parser';

describe('parsarea comenzii /task', () => {
	it('ia titlul dintr-o comandă simplă', () => {
		expect(parseTaskCommand('/task Fă bannerele pentru campanie')).toEqual({
			title: 'Fă bannerele pentru campanie',
			description: null
		});
	});

	it('acceptă spații și majuscule în comandă', () => {
		expect(parseTaskCommand('   /TASK   Ceva de făcut  ')?.title).toBe('Ceva de făcut');
	});

	it('primul rând e titlul, restul devine descriere', () => {
		expect(parseTaskCommand('/task Refacem bannerele\nDouă variante\nDeadline vineri')).toEqual({
			title: 'Refacem bannerele',
			description: 'Două variante\nDeadline vineri'
		});
	});

	it('titlul prea lung se taie, iar restul intră în descriere ca să nu se piardă', () => {
		const long = 'a'.repeat(200);
		const parsed = parseTaskCommand(`/task ${long}`);
		expect(parsed?.title).toHaveLength(120);
		expect(parsed?.description).toContain('a'.repeat(80));
	});

	it('fără text după comandă nu e task', () => {
		expect(parseTaskCommand('/task')).toBeNull();
		expect(parseTaskCommand('/task    ')).toBeNull();
		expect(parseTaskCommand('/task \n\n')).toBeNull();
	});

	it('un text care doar conține „/task" în mijloc nu e comandă', () => {
		expect(parseTaskCommand('scrie /task ca să adaugi ceva')).toBeNull();
		expect(parseTaskCommand('/taskuri de mâine')).toBeNull();
	});

	it('alte comenzi sau text obișnuit sunt ignorate', () => {
		expect(parseTaskCommand('bună ziua')).toBeNull();
		expect(parseTaskCommand('/help')).toBeNull();
		expect(parseTaskCommand(null)).toBeNull();
		expect(parseTaskCommand('')).toBeNull();
	});

	it('mențiunile din comandă rămân în text ca cifre, nu strică parsarea', () => {
		expect(parseTaskCommand('/task @40722123456 verifică bugetul')?.title).toBe(
			'@40722123456 verifică bugetul'
		);
	});

	it('spațiul neîntrerupt de pe tastaturile mobile e tratat ca spațiu', () => {
		expect(parseTaskCommand('/task Ceva')?.title).toBe('Ceva');
	});
});
