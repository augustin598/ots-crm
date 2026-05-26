import { describe, test, expect } from 'bun:test';
import { displayOrderId } from '../hosting-order-id';

describe('displayOrderId', () => {
	test('formats a sequential order number with zero-padding to 5 digits', () => {
		expect(displayOrderId(1, 'abc123')).toBe('OTS-00001');
		expect(displayOrderId(48217, 'abc123')).toBe('OTS-48217');
		expect(displayOrderId(99999, 'abc123')).toBe('OTS-99999');
	});

	test('does not truncate numbers larger than 5 digits', () => {
		expect(displayOrderId(123456, 'abc')).toBe('OTS-123456');
	});

	test('falls back to first 5 chars of uuid uppercased when orderNumber is null', () => {
		expect(displayOrderId(null, 'abcdefghij')).toBe('OTS-ABCDE');
	});

	test('falls back to first 5 chars even when uuid is shorter than 5', () => {
		expect(displayOrderId(null, 'abc')).toBe('OTS-ABC');
	});

	test('handles a zero order number as a real number, not null', () => {
		// 0 is a legal pre-increment value; should pad like any other.
		expect(displayOrderId(0, 'abc')).toBe('OTS-00000');
	});
});
