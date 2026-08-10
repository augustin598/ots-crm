import { describe, expect, test } from 'bun:test';
import { TaskLiveQueryRegistry } from '../task-live-queries-context';

describe('TaskLiveQueryRegistry', () => {
	test('collect() gol când nu e nimic înregistrat', () => {
		const r = new TaskLiveQueryRegistry();
		expect(r.collect()).toEqual([]);
	});

	test('collect() adună instanțele din toate getter-ele, în ordinea înregistrării', () => {
		const r = new TaskLiveQueryRegistry();
		const a = { id: 'tasksQuery' };
		const b = { id: 'statsQuery' };
		const c = { id: 'completedP1' };
		r.register(() => [a, b]);
		r.register(() => [c]);
		expect(r.collect()).toEqual([a, b, c]);
	});

	test('getter-ele se citesc la momentul apelului (instanțe noi după re-derive)', () => {
		const r = new TaskLiveQueryRegistry();
		let current = [{ id: 'v1' }];
		r.register(() => current);
		current = [{ id: 'v2' }];
		expect(r.collect()).toEqual([{ id: 'v2' }]);
	});

	test('unregister scoate getter-ul; getter care întoarce null/undefined e tolerat', () => {
		const r = new TaskLiveQueryRegistry();
		const un = r.register(() => [{ id: 'x' }]);
		r.register(() => null as any);
		un();
		expect(r.collect()).toEqual([]);
	});
});
