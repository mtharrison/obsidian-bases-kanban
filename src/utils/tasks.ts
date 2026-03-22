export interface NoteTask {
	line: number;
	text: string;
	completed: boolean;
	indent: string;
	bullet: string;
	originalLine: string;
}

const TASK_LINE_REGEX = /^(\s*)([-*+]) \[( |x|X)\] (.*)$/;

export function parseMarkdownTasks(content: string): NoteTask[] {
	return content
		.split(/\r?\n/)
		.map((line, index) => {
			const match = line.match(TASK_LINE_REGEX);
			if (!match) {
				return null;
			}

			return {
				line: index,
				indent: match[1],
				bullet: match[2],
				completed: match[3].toLowerCase() === 'x',
				text: match[4],
				originalLine: line,
			} satisfies NoteTask;
		})
		.filter((task): task is NoteTask => task !== null);
}

export function updateTaskCompletion(
	content: string,
	task: NoteTask,
	completed: boolean
): string | null {
	const newline = content.includes('\r\n') ? '\r\n' : '\n';
	const lines = content.split(/\r?\n/);
	const targetLine = findTaskLine(lines, task);

	if (targetLine === -1) {
		return null;
	}

	lines[targetLine] = buildTaskLine(task, completed);
	return lines.join(newline);
}

function findTaskLine(lines: string[], task: NoteTask): number {
	if (lines[task.line] === task.originalLine) {
		return task.line;
	}

	const exactMatchIndex = lines.findIndex((line) => line === task.originalLine);
	if (exactMatchIndex !== -1) {
		return exactMatchIndex;
	}

	return lines.findIndex((line) => {
		const match = line.match(TASK_LINE_REGEX);
		return match !== null && match[4] === task.text;
	});
}

function buildTaskLine(task: NoteTask, completed: boolean): string {
	return `${task.indent}${task.bullet} [${completed ? 'x' : ' '}] ${task.text}`;
}
