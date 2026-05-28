import type { WASocket } from "baileys";

interface ScheduledTask {
	name: string;
	intervalMs: number;
	tick: (ws: WASocket) => Promise<void>;
}

const tasks: ScheduledTask[] = [];
let started = false;

export function registerTask(task: ScheduledTask) {
	tasks.push(task);
}

export function startScheduler(ws: WASocket): () => void {
	if (started) throw new Error("Scheduler already started");
	started = true;

	const intervals: ReturnType<typeof setInterval>[] = [];

	for (const task of tasks) {
		const run = () => task.tick(ws).catch((e) => console.error(`Scheduler[${task.name}]:`, e));
		run();
		intervals.push(setInterval(run, task.intervalMs));
	}

	return () => {
		for (const id of intervals) clearInterval(id);
		started = false;
	};
}
