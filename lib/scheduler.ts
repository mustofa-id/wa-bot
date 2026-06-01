type SendMessageFn = (chatId: string, result: BotPluginResult) => MaybePromise<void>;

interface ScheduledTask {
	name: string;
	intervalMs: number;
	tick: (sm: SendMessageFn) => MaybePromise<void>;
}

const tasks: ScheduledTask[] = [];
let started = false;

export function registerTask(task: ScheduledTask) {
	tasks.push(task);
}

export function startScheduler(sm: SendMessageFn): () => void {
	if (started) throw new Error("Scheduler already started");
	started = true;

	const snapshot = [...tasks];
	const intervals: ReturnType<typeof setInterval>[] = [];

	for (const task of snapshot) {
		const run = () => Promise.resolve(task.tick(sm)).catch((e) => console.error(`Scheduler[${task.name}]:`, e));
		run();
		intervals.push(setInterval(run, task.intervalMs));
	}

	return () => {
		for (const id of intervals) clearInterval(id);
		started = false;
	};
}
