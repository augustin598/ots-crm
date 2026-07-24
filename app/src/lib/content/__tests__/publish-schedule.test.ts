import { describe, test, expect } from 'bun:test';
import { nextSlots } from '../publish-schedule';

describe('nextSlots', () => {
	const from = new Date('2026-07-01T00:00:00'); // miercuri

	test('respectă daysOfWeek + publishTime, ordinea crescătoare', () => {
		const slots = nextSlots({ from, count: 3, daysOfWeek: [1, 3], publishTime: '10:00', existing: [] });
		expect(slots.length).toBe(3);
		// toate la 10:00, doar luni(1)/miercuri(3)
		for (const s of slots) {
			expect(s.getHours()).toBe(10);
			expect([1, 3]).toContain(s.getDay());
		}
		// crescător
		expect(slots[0] < slots[1] && slots[1] < slots[2]).toBe(true);
	});

	test('sare peste sloturile deja ocupate (existing)', () => {
		const taken = new Date('2026-07-01T10:00:00'); // miercuri 10:00
		const slots = nextSlots({ from, count: 2, daysOfWeek: [3], publishTime: '10:00', existing: [taken] });
		// nu reia slotul ocupat
		expect(slots.some((s) => s.getTime() === taken.getTime())).toBe(false);
		expect(slots.length).toBe(2);
	});

	test('fallback la toate zilele când daysOfWeek e gol', () => {
		const slots = nextSlots({ from, count: 1, daysOfWeek: [], publishTime: '09:30', existing: [] });
		expect(slots.length).toBe(1);
		expect(slots[0].getHours()).toBe(9);
		expect(slots[0].getMinutes()).toBe(30);
	});
});
