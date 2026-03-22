export interface NoteTask {
	line: number;
	text: string;
	completed: boolean;
	indent: string;
	depth: number;
	bullet: string;
	originalLine: string;
}

const TASK_LINE_REGEX = /^(\s*)([-*+]) \[( |x|X)\] (.*)$/;

export function parseMarkdownTasks(content: string): NoteTask[] {
	const tasks = content
		.split(/\r?\n/)
		.map((line, index) => {
			const match = line.match(TASK_LINE_REGEX);
			if (!match) {
				return null;
			}

			return {
				line: index,
				indent: match[1],
				depth: 0,
				bullet: match[2],
				completed: match[3].toLowerCase() === 'x',
				text: match[4],
				originalLine: line,
			} satisfies NoteTask;
			})
		.filter((task): task is NoteTask => task !== null);

	const indentLevels: number[] = [];
	tasks.forEach((task) => {
		const indentWidth = getIndentWidth(task.indent);
		while (indentLevels.length > 0 && indentLevels[indentLevels.length - 1] > indentWidth) {
			indentLevels.pop();
		}

		if (indentWidth > 0 && (indentLevels.length === 0 || indentLevels[indentLevels.length - 1] < indentWidth)) {
			indentLevels.push(indentWidth);
		}

		task.depth = indentWidth === 0 ? 0 : indentLevels.findIndex((level) => level === indentWidth) + 1;
	});

	return tasks;
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

function getIndentWidth(indent: string): number {
	let width = 0;
	for (const char of indent) {
		width += char === '\t' ? 4 : 1;
	}
	return width;
}
