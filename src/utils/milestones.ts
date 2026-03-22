export interface MilestoneDefinition {
	index: number;
	title: string;
	data: Record<string, unknown>;
}

const TITLE_KEYS = ['title', 'name', 'label'] as const;

export function parseMilestones(value: unknown): MilestoneDefinition[] {
	const items = Array.isArray(value)
		? value
		: value === null || value === undefined
			? []
			: [value];

	return items.flatMap((item, index) => {
		const milestone = normalizeMilestone(item, index);
		return milestone ? [milestone] : [];
	});
}

export function getMilestoneValue(
	milestone: Record<string, unknown>,
	propertyName: string
): unknown {
	const candidateKeys = getCandidateKeys(propertyName);
	for (const key of candidateKeys) {
		if (key in milestone) {
			return milestone[key];
		}
	}

	return null;
}

export function setMilestoneValue(
	milestone: Record<string, unknown>,
	propertyName: string,
	value: string
): void {
	const candidateKeys = getCandidateKeys(propertyName);
	const existingKey = candidateKeys.find((key) => key in milestone) ?? propertyName;

	if (value === '') {
		delete milestone[existingKey];
		return;
	}

	milestone[existingKey] = value;
}

export function normalizeMilestoneFrontmatter(value: unknown): unknown[] {
	if (Array.isArray(value)) {
		return value.map((item) => cloneMilestoneItem(item));
	}

	return [];
}

function normalizeMilestone(item: unknown, index: number): MilestoneDefinition | null {
	if (typeof item === 'string') {
		const title = item.trim();
		if (!title) {
			return null;
		}

		return {
			index,
			title,
			data: { title },
		};
	}

	if (typeof item !== 'object' || item === null || Array.isArray(item)) {
		return null;
	}

	const data = { ...(item as Record<string, unknown>) };
	const title = getMilestoneTitle(data);
	if (!title) {
		return null;
	}

	return {
		index,
		title,
		data,
	};
}

function getMilestoneTitle(data: Record<string, unknown>): string | null {
	for (const key of TITLE_KEYS) {
		const value = data[key];
		if (typeof value === 'string' && value.trim()) {
			return value.trim();
		}
	}

	return null;
}

function getCandidateKeys(propertyName: string): string[] {
	const trimmed = propertyName.trim();
	if (!trimmed) {
		return [];
	}

	const camelCase = trimmed.replace(/[-_\s]+([a-zA-Z0-9])/g, (_match, char: string) => char.toUpperCase());
	const kebabCase = trimmed
		.replace(/([a-z0-9])([A-Z])/g, '$1-$2')
		.replace(/[\s_]+/g, '-')
		.toLowerCase();
	const snakeCase = trimmed
		.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
		.replace(/[\s-]+/g, '_')
		.toLowerCase();
	const lowerCase = trimmed.toLowerCase();

	return Array.from(new Set([trimmed, camelCase, kebabCase, snakeCase, lowerCase]));
}

function cloneMilestoneItem(item: unknown): unknown {
	if (Array.isArray(item)) {
		return item.map((child) => cloneMilestoneItem(child));
	}

	if (typeof item === 'object' && item !== null) {
		return Object.fromEntries(
			Object.entries(item as Record<string, unknown>).map(([key, value]) => [key, cloneMilestoneItem(value)])
		);
	}

	return item;
}
