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
const HEADING_REGEX = /^(#{1,6})\s+(.*)$/;

interface TaskParseBounds {
	startLine?: number;
	endLine?: number;
}

export function parseMarkdownTasks(content: string, bounds: TaskParseBounds = {}): NoteTask[] {
	const lines = content.split(/\r?\n/);
	const startLine = bounds.startLine ?? 0;
	const endLine = bounds.endLine ?? lines.length;
	const tasks = lines
		.slice(startLine, endLine)
		.map((line, localIndex) => {
			const match = line.match(TASK_LINE_REGEX);
			if (!match) {
				return null;
			}

			return {
				line: startLine + localIndex,
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

export function findHeadingSection(
	content: string,
	headingTitle: string
): { startLine: number; endLine: number } | null {
	const normalizedTarget = normalizeHeadingText(headingTitle);
	if (!normalizedTarget) {
		return null;
	}

	const lines = content.split(/\r?\n/);
	let matchedHeadingLevel: number | null = null;
	let matchedHeadingLine = -1;

	for (let index = 0; index < lines.length; index += 1) {
		const match = lines[index]?.match(HEADING_REGEX);
		if (!match) {
			continue;
		}

		const headingLevel = match[1].length;
		const headingText = normalizeHeadingText(match[2]);
		if (headingText !== normalizedTarget) {
			continue;
		}

		matchedHeadingLevel = headingLevel;
		matchedHeadingLine = index;
		break;
	}

	if (matchedHeadingLevel === null || matchedHeadingLine === -1) {
		return null;
	}

	let endLine = lines.length;
	for (let index = matchedHeadingLine + 1; index < lines.length; index += 1) {
		const match = lines[index]?.match(HEADING_REGEX);
		if (!match) {
			continue;
		}

		const headingLevel = match[1].length;
		if (headingLevel <= matchedHeadingLevel) {
			endLine = index;
			break;
		}
	}

	return {
		startLine: matchedHeadingLine + 1,
		endLine,
	};
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

function normalizeHeadingText(value: string): string {
	return value
		.trim()
		.replace(/\s+/g, ' ')
		.toLowerCase();
}
