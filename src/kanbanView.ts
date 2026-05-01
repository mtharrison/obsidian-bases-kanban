import { BasesView, parsePropertyId } from 'obsidian';
import type { QueryController, BasesEntry, BasesPropertyId, ViewOption, App } from 'obsidian';
import Sortable from 'sortablejs';
import {
	UNCATEGORIZED_LABEL,
	SORTABLE_GROUP,
	DATA_ATTRIBUTES,
	CSS_CLASSES,
	SORTABLE_CONFIG,
	EMPTY_STATE_MESSAGES,
} from './constants.ts';
import { ensureGroupExists, normalizePropertyValue } from './utils/grouping.ts';
import {
	parseMilestones,
	getMilestoneValue,
	setMilestoneValue,
	normalizeMilestoneFrontmatter,
	type MilestoneDefinition,
} from './utils/milestones.ts';
import {
	findHeadingSection,
	parseMarkdownTasks,
	updateTaskCompletion,
	type NoteTask,
} from './utils/tasks.ts';

function hasTaskVault(app: App | undefined): app is App {
	return app !== undefined
		&& 'vault' in app
		&& typeof app.vault?.cachedRead === 'function'
		&& typeof app.vault?.modify === 'function';
}

function hasMetadataCache(app: App | undefined): app is App & {
	metadataCache: { getFileCache(file: BasesEntry['file']): { frontmatter?: Record<string, unknown> } | null };
} {
	return app !== undefined
		&& 'metadataCache' in app
		&& typeof (app as App & { metadataCache?: { getFileCache?: unknown } }).metadataCache?.getFileCache === 'function';
}

function hasLocalName(value: unknown, localName: string): value is { localName: string } {
	return typeof value === 'object'
		&& value !== null
		&& 'localName' in value
		&& (value as { localName?: string }).localName === localName;
}

interface CardInstance {
	entry: BasesEntry;
	title: string;
	milestoneIndex: number | null;
	milestoneData: Record<string, unknown> | null;
}

interface ScrollSnapshot {
	mainScrollTop: number;
	swimlanesScrollTop: number | null;
	boardScrollLefts: Record<string, number>;
	ancestorScrolls: Array<{ element: HTMLElement; top: number; left: number }>;
}

export class KanbanView extends BasesView {
	type = 'kanban-view';
	
	scrollEl: HTMLElement;
	containerEl: HTMLElement;
	private groupByPropertyId: BasesPropertyId | null = null;
	private swimlanePropertyId: BasesPropertyId | null = null;
	private milestonePropertyId: BasesPropertyId | null = null;
	private expandedCompletedTaskCards = new Set<string>();
	private sortableInstances: Sortable[] = [];
	private columnSortable: Sortable | null = null;
	private columnSortables: Sortable[] = [];
	private laneSortable: Sortable | null = null;

	constructor(controller: QueryController, scrollEl: HTMLElement) {
		super(controller);
		this.scrollEl = scrollEl;
		this.containerEl = scrollEl.createDiv({ cls: CSS_CLASSES.VIEW_CONTAINER });
	}

	onDataUpdated(): void {
		try {
			this.loadConfig();
			const scrollSnapshot = this.captureScrollSnapshot();
			this.render();
			this.restoreScrollSnapshot(scrollSnapshot);
		} catch (error) {
			console.error('KanbanView error:', error);
		}
	}

	private loadConfig(): void {
		// Load group by property from config
		this.groupByPropertyId = this.config.getAsPropertyId('groupByProperty');
		this.swimlanePropertyId = this.config.getAsPropertyId('swimlaneProperty');
		this.milestonePropertyId = this.config.getAsPropertyId('milestoneProperty');
	}

	private shouldShowSwimlanes(): boolean {
		return this.config?.get?.('showSwimlanes') !== false;
	}

	private captureScrollSnapshot(): ScrollSnapshot {
		const snapshot: ScrollSnapshot = {
			mainScrollTop: this.scrollEl.scrollTop,
			swimlanesScrollTop: null,
			boardScrollLefts: {},
			ancestorScrolls: this.getScrollableAncestors(this.scrollEl).map((element) => ({
				element,
				top: element.scrollTop,
				left: element.scrollLeft,
			})),
		};

		const swimlanesEl = this.containerEl.querySelector(`.${CSS_CLASSES.SWIMLANES}`);
		if (swimlanesEl instanceof HTMLElement) {
			snapshot.swimlanesScrollTop = swimlanesEl.scrollTop;
		}

		const boardScrollers = this.containerEl.querySelectorAll(`.${CSS_CLASSES.BOARD_SCROLLER}`);
		boardScrollers.forEach((scroller, index) => {
			if (!(scroller instanceof HTMLElement)) {
				return;
			}

			snapshot.boardScrollLefts[this.getBoardScrollerKey(scroller, index)] = scroller.scrollLeft;
		});

		return snapshot;
	}

	private restoreScrollSnapshot(snapshot: ScrollSnapshot): void {
		this.scrollEl.scrollTop = snapshot.mainScrollTop;

		const applyScrollState = () => {
			this.scrollEl.scrollTop = snapshot.mainScrollTop;
			const swimlanesEl = this.containerEl.querySelector(`.${CSS_CLASSES.SWIMLANES}`);
			if (swimlanesEl instanceof HTMLElement && snapshot.swimlanesScrollTop !== null) {
				swimlanesEl.scrollTop = snapshot.swimlanesScrollTop;
			}
			const boardScrollers = this.containerEl.querySelectorAll(`.${CSS_CLASSES.BOARD_SCROLLER}`);
			boardScrollers.forEach((scroller, index) => {
				if (!(scroller instanceof HTMLElement)) {
					return;
				}

				const savedLeft = snapshot.boardScrollLefts[this.getBoardScrollerKey(scroller, index)];
				if (savedLeft !== undefined) {
					scroller.scrollLeft = savedLeft;
				}
			});

			snapshot.ancestorScrolls.forEach(({ element, top, left }) => {
				element.scrollTop = top;
				element.scrollLeft = left;
			});
		};

		applyScrollState();
		window.requestAnimationFrame(() => applyScrollState());
	}

	private getBoardScrollerKey(scroller: HTMLElement, index: number): string {
		const laneEl = scroller.closest(`.${CSS_CLASSES.LANE}`);
		if (laneEl instanceof HTMLElement) {
			return `lane:${laneEl.getAttribute(DATA_ATTRIBUTES.LANE_VALUE) ?? index}`;
		}

		return `board:${index}`;
	}

	private getScrollableAncestors(startEl: HTMLElement): HTMLElement[] {
		const ancestors: HTMLElement[] = [];
		let current: HTMLElement | null = startEl.parentElement;

		while (current) {
			if (this.isScrollable(current)) {
				ancestors.push(current);
			}
			current = current.parentElement;
		}

		return ancestors;
	}

	private isScrollable(element: HTMLElement): boolean {
		const style = window.getComputedStyle(element);
		const overflowY = style.overflowY;
		const overflowX = style.overflowX;
		const canScrollY = (overflowY === 'auto' || overflowY === 'scroll') && element.scrollHeight > element.clientHeight;
		const canScrollX = (overflowX === 'auto' || overflowX === 'scroll') && element.scrollWidth > element.clientWidth;
		return canScrollY || canScrollX;
	}

	private render(): void {
		// Clear existing content
		this.containerEl.empty();

		try {
			// Get all entries from the data
			const entries = this.data?.data || [];
			// Get available properties from entries
			const availablePropertyIds = this.allProperties || [];
			
			this.groupByPropertyId = this.resolveGroupByProperty(availablePropertyIds);
			if (!this.groupByPropertyId) {
				this.containerEl.createDiv({
					text: EMPTY_STATE_MESSAGES.NO_PROPERTIES,
					cls: CSS_CLASSES.EMPTY_STATE
				});
				return;
			}

			this.swimlanePropertyId = this.resolveSwimlaneProperty(availablePropertyIds);
			this.milestonePropertyId = this.resolveMilestoneProperty(availablePropertyIds);

			const cards = this.buildCardInstances(entries);
			const columnValues = this.getOrderedColumnValues(this.getCardPropertyValues(cards, this.groupByPropertyId));
			if (cards.length === 0 && columnValues.length === 0) {
				this.containerEl.createDiv({
					text: EMPTY_STATE_MESSAGES.NO_ENTRIES,
					cls: CSS_CLASSES.EMPTY_STATE
				});
				return;
			}

			if (this.swimlanePropertyId && this.shouldShowSwimlanes()) {
				this.renderSwimlanes(cards, columnValues, this.swimlanePropertyId);
			} else {
				const groupedEntries = this.groupCardsByProperty(cards, this.groupByPropertyId);
				const boardScrollerEl = this.containerEl.createDiv({ cls: CSS_CLASSES.BOARD_SCROLLER });
				const boardEl = boardScrollerEl.createDiv({ cls: CSS_CLASSES.BOARD });

				columnValues.forEach((value) => {
					const columnEl = this.createColumn(value, groupedEntries.get(value) || []);
					boardEl.appendChild(columnEl);
				});
			}

			// Initialize drag and drop
			this.initializeSortable();
			this.initializeColumnSortable();
			this.initializeLaneSortable();
		} catch (error) {
			console.error('KanbanView error:', error);
		}
	}

	private groupEntriesByProperty(entries: BasesEntry[], propertyId: BasesPropertyId): Map<string, BasesEntry[]> {
		const grouped = new Map<string, BasesEntry[]>();

		entries.forEach((entry) => {
			try {
				const propValue = entry.getValue(propertyId);
				const value = normalizePropertyValue(propValue);
				const group = ensureGroupExists(grouped, value);
				group.push(entry);
			} catch (error) {
				console.warn('Error processing entry:', entry.file.path, error);
				// Add to Uncategorized on error
				const uncategorizedGroup = ensureGroupExists(grouped, UNCATEGORIZED_LABEL);
				uncategorizedGroup.push(entry);
			}
		});

		return grouped;
	}

	private getPropertyValues(entries: BasesEntry[], propertyId: BasesPropertyId): string[] {
		return Array.from(this.groupEntriesByProperty(entries, propertyId).keys());
	}

	private resolveGroupByProperty(availablePropertyIds: BasesPropertyId[]): BasesPropertyId | null {
		if (this.groupByPropertyId && availablePropertyIds.length === 0) {
			return this.groupByPropertyId;
		}

		if (this.groupByPropertyId && availablePropertyIds.includes(this.groupByPropertyId)) {
			return this.groupByPropertyId;
		}

		return availablePropertyIds[0] || null;
	}

	private resolveSwimlaneProperty(availablePropertyIds: BasesPropertyId[]): BasesPropertyId | null {
		if (!this.swimlanePropertyId || !availablePropertyIds.includes(this.swimlanePropertyId)) {
			return null;
		}

		if (this.swimlanePropertyId === this.groupByPropertyId) {
			return null;
		}

		return this.swimlanePropertyId;
	}

	private resolveMilestoneProperty(availablePropertyIds: BasesPropertyId[]): BasesPropertyId | null {
		if (!this.milestonePropertyId || !availablePropertyIds.includes(this.milestonePropertyId)) {
			return null;
		}

		if (this.milestonePropertyId === this.groupByPropertyId || this.milestonePropertyId === this.swimlanePropertyId) {
			return null;
		}

		return this.milestonePropertyId;
	}

	private buildCardInstances(entries: BasesEntry[]): CardInstance[] {
		return entries.flatMap((entry) => {
			const milestones = this.getEntryMilestones(entry);
			if (milestones.length === 0) {
				return [{
					entry,
					title: entry.file.basename,
					milestoneIndex: null,
					milestoneData: null,
				} satisfies CardInstance];
			}

			return milestones.map((milestone) => ({
				entry,
				title: milestone.title,
				milestoneIndex: milestone.index,
				milestoneData: milestone.data,
			} satisfies CardInstance));
		});
	}

	private getEntryMilestones(entry: BasesEntry): MilestoneDefinition[] {
		if (!this.milestonePropertyId) {
			return [];
		}

		const rawMilestones = this.getEntryPropertyValue(entry, this.milestonePropertyId);
		const frontmatterMilestones = this.getMilestonesFromMetadataCache(entry);
		if (frontmatterMilestones.length > 0 && !this.isStructuredMilestoneValue(rawMilestones)) {
			return frontmatterMilestones;
		}

		const directMilestones = parseMilestones(rawMilestones);
		if (directMilestones.length > 0) {
			return directMilestones;
		}

		return frontmatterMilestones;
	}

	private getMilestonesFromMetadataCache(entry: BasesEntry): MilestoneDefinition[] {
		if (!this.milestonePropertyId || !hasMetadataCache(this.app)) {
			return [];
		}

		const propertyName = parsePropertyId(this.milestonePropertyId).name;
		const frontmatter = this.app.metadataCache.getFileCache(entry.file)?.frontmatter;
		if (!frontmatter || typeof frontmatter !== 'object') {
			return [];
		}

		return parseMilestones(frontmatter[propertyName]);
	}

	private isStructuredMilestoneValue(value: unknown): boolean {
		if (Array.isArray(value)) {
			return true;
		}

		return typeof value === 'object' && value !== null;
	}

	private groupCardsByProperty(cards: CardInstance[], propertyId: BasesPropertyId): Map<string, CardInstance[]> {
		const grouped = new Map<string, CardInstance[]>();
		cards.forEach((card) => {
			const value = normalizePropertyValue(this.getCardPropertyValue(card, propertyId));
			const group = ensureGroupExists(grouped, value);
			group.push(card);
		});
		return grouped;
	}

	private getCardPropertyValues(cards: CardInstance[], propertyId: BasesPropertyId): string[] {
		return Array.from(this.groupCardsByProperty(cards, propertyId).keys());
	}

	private renderSwimlanes(
		cards: CardInstance[],
		columnValues: string[],
		swimlanePropertyId: BasesPropertyId
	): void {
		const swimlanesEl = this.containerEl.createDiv({ cls: CSS_CLASSES.SWIMLANES });
		const groupedByLane = this.groupCardsByProperty(cards, swimlanePropertyId);
		const laneValues = this.getOrderedLaneValues(Array.from(groupedByLane.keys()), swimlanePropertyId);

		laneValues.forEach((laneValue) => {
			const laneEntries = groupedByLane.get(laneValue) || [];
			const laneEl = swimlanesEl.createDiv({ cls: CSS_CLASSES.LANE });
			laneEl.setAttribute(DATA_ATTRIBUTES.LANE_VALUE, laneValue);

			const laneHeaderEl = laneEl.createDiv({ cls: CSS_CLASSES.LANE_HEADER });
			const laneDragHandle = laneHeaderEl.createDiv({ cls: CSS_CLASSES.LANE_DRAG_HANDLE });
			laneDragHandle.textContent = '⋮⋮';
			laneHeaderEl.createSpan({ text: laneValue, cls: CSS_CLASSES.LANE_TITLE });
			laneHeaderEl.createSpan({ text: `(${laneEntries.length})`, cls: CSS_CLASSES.LANE_COUNT });

			const boardScrollerEl = laneEl.createDiv({ cls: CSS_CLASSES.BOARD_SCROLLER });
			const boardEl = boardScrollerEl.createDiv({ cls: CSS_CLASSES.BOARD });
			const groupedByColumn = this.groupCardsByProperty(laneEntries, this.groupByPropertyId);

			columnValues.forEach((columnValue) => {
				const columnEl = this.createColumn(columnValue, groupedByColumn.get(columnValue) || []);
				boardEl.appendChild(columnEl);
			});
		});
	}

	private createColumn(value: string, cards: CardInstance[]): HTMLElement {
		const columnEl = document.createElement('div');
		columnEl.className = CSS_CLASSES.COLUMN;
		columnEl.setAttribute(DATA_ATTRIBUTES.COLUMN_VALUE, value);
		columnEl.setAttribute(DATA_ATTRIBUTES.COLUMN_TONE, this.getColumnTone(value));
		this.applyCustomColumnColor(columnEl, value);
		if (cards.length === 0) {
			columnEl.classList.add(`${CSS_CLASSES.COLUMN}-empty`);
		}

		// Column header
		const headerEl = columnEl.createDiv({ cls: CSS_CLASSES.COLUMN_HEADER });
		
		// Add drag handle
		const dragHandle = headerEl.createDiv({ cls: CSS_CLASSES.COLUMN_DRAG_HANDLE });
		dragHandle.textContent = '⋮⋮';
		
		headerEl.createSpan({ text: value, cls: CSS_CLASSES.COLUMN_TITLE });
		headerEl.createSpan({ text: `(${cards.length})`, cls: CSS_CLASSES.COLUMN_COUNT });

		// Column body (cards container)
		const bodyEl = columnEl.createDiv({ cls: CSS_CLASSES.COLUMN_BODY });
		bodyEl.setAttribute(DATA_ATTRIBUTES.SORTABLE_CONTAINER, 'true');

		// Create cards for each entry
		cards.forEach((card) => {
			const cardEl = this.createCard(card);
			bodyEl.appendChild(cardEl);
		});

		return columnEl;
	}

	private createCard(card: CardInstance): HTMLElement {
		const cardEl = document.createElement('div');
		cardEl.className = CSS_CLASSES.CARD;
		const filePath = card.entry.file.path;
		cardEl.setAttribute(DATA_ATTRIBUTES.ENTRY_PATH, filePath);
		if (card.milestoneIndex !== null) {
			cardEl.setAttribute(DATA_ATTRIBUTES.MILESTONE_INDEX, String(card.milestoneIndex));
		}

		const headerEl = cardEl.createDiv({ cls: CSS_CLASSES.CARD_HEADER });

		const titleGroupEl = headerEl.createDiv({ cls: CSS_CLASSES.CARD_TITLE_GROUP });
		const titleEl = titleGroupEl.createDiv({ cls: CSS_CLASSES.CARD_TITLE });
		titleEl.textContent = card.title;
		if (card.milestoneIndex !== null) {
			const sourceEl = titleGroupEl.createDiv({ cls: CSS_CLASSES.CARD_SOURCE });
			sourceEl.createSpan({
				cls: CSS_CLASSES.CARD_SOURCE_LABEL,
				text: '◈ Milestone',
			});
			sourceEl.createSpan({
				cls: CSS_CLASSES.CARD_SOURCE_NAME,
				text: card.entry.file.basename,
			});
		}

		const swimlaneHeaderValue = this.getCardSwimlaneHeaderValue(card);
		const tagValues = this.getCardTagValues(card);
		if (swimlaneHeaderValue || tagValues.length > 0) {
			const badgesEl = headerEl.createDiv({ cls: CSS_CLASSES.CARD_BADGES });
			if (swimlaneHeaderValue) {
				badgesEl.createSpan({
					text: swimlaneHeaderValue,
					cls: CSS_CLASSES.CARD_SWIMLANE_PILL,
				});
			}

			const tagsEl = badgesEl.createDiv({ cls: CSS_CLASSES.CARD_TAGS });
			tagValues.forEach((tagValue) => {
				tagsEl.createSpan({ text: tagValue, cls: CSS_CLASSES.CARD_TAG_PILL });
			});
		}

		const metaProperties = this.getVisibleCardProperties();
		if (metaProperties.length > 0) {
			const metaEl = cardEl.createDiv({ cls: CSS_CLASSES.CARD_META });
			metaProperties.forEach((propertyId) => {
				const value = this.formatCardPropertyValue(this.getCardPropertyValue(card, propertyId));
				if (!value) {
					return;
				}

				const rowEl = metaEl.createDiv({ cls: CSS_CLASSES.CARD_META_ROW });
				const label = this.config?.getDisplayName?.(propertyId) ?? parsePropertyId(propertyId).name;
				rowEl.createSpan({ text: `${label}:`, cls: CSS_CLASSES.CARD_META_LABEL });
				rowEl.createSpan({ text: value, cls: CSS_CLASSES.CARD_META_VALUE });
			});

			if (!metaEl.hasChildNodes()) {
				metaEl.remove();
			}
		}

		const tasksEl = cardEl.createDiv({ cls: CSS_CLASSES.CARD_TASKS });
		void this.loadCardTasks(card, tasksEl);

		// Make card clickable to open the note
		const clickHandler = () => {
			if (this.app?.workspace) {
				void this.app.workspace.openLinkText(filePath, '', false);
			}
		};
		cardEl.addEventListener('click', clickHandler);

		return cardEl;
	}

	private getCardTagValues(card: CardInstance): string[] {
		const tagPropertyId = this.findTagPropertyId();
		if (!tagPropertyId) {
			return [];
		}

		try {
			const rawValue = this.getCardPropertyValue(card, tagPropertyId);
			return this.normalizeTagValues(rawValue);
		} catch (error) {
			console.warn('Error reading tag property for entry:', card.entry.file.path, error);
			return [];
		}
	}

	private getCardSwimlaneHeaderValue(card: CardInstance): string | null {
		if (!this.swimlanePropertyId || this.shouldShowSwimlanes()) {
			return null;
		}

		return this.formatCardPropertyValue(this.getCardPropertyValue(card, this.swimlanePropertyId));
	}

	private getCardPropertyValue(card: CardInstance, propertyId: BasesPropertyId): unknown {
		if (card.milestoneData) {
			const propertyName = parsePropertyId(propertyId).name;
			const milestoneValue = getMilestoneValue(card.milestoneData, propertyName);
			if (milestoneValue !== null && milestoneValue !== undefined && milestoneValue !== '') {
				return milestoneValue;
			}
		}

		return this.getEntryPropertyValue(card.entry, propertyId);
	}

	private getEntryPropertyValue(entry: BasesEntry, propertyId: BasesPropertyId): unknown {
		type Reader = (id: BasesPropertyId) => unknown;
		const e = entry as unknown as Record<string, unknown>;
		const propertyReader: Reader | null = typeof e.getProperty === 'function'
			? ((id: BasesPropertyId) => (e.getProperty as Reader)(id))
			: null;
		const valueReader: Reader | null = typeof e.getValue === 'function'
			? ((id: BasesPropertyId) => (e.getValue as Reader)(id))
			: null;

		return propertyReader?.(propertyId) ?? valueReader?.(propertyId) ?? null;
	}

	private findTagPropertyId(): BasesPropertyId | null {
		const availableProperties = this.allProperties || [];
		const preferredTagProperties = ['note.tags', 'tags', 'file.tags'] as const;

		for (const propertyId of preferredTagProperties) {
			if (availableProperties.includes(propertyId as BasesPropertyId)) {
				return propertyId as BasesPropertyId;
			}
		}

		return availableProperties.find((propertyId) => /(^|\.)(tags?)$/i.test(String(propertyId))) || null;
	}

	private normalizeTagValues(value: unknown): string[] {
		if (value === null || value === undefined) {
			return [];
		}

		if (Array.isArray(value)) {
			return value.flatMap((item) => this.normalizeTagValues(item));
		}

		return this.splitTagString(String(value as string));
	}

	private splitTagString(value: string): string[] {
		const normalized = value.trim();
		if (!normalized || /^(null|undefined)$/i.test(normalized)) {
			return [];
		}

		return normalized
			.split(',')
			.map((tag) => tag.trim())
			.map((tag) => tag.replace(/^#+/, ''))
			.filter((tag) => tag.length > 0 && !/^(null|undefined)$/i.test(tag));
	}

	private getVisibleCardProperties(): BasesPropertyId[] {
		const orderedProperties = this.config?.getOrder?.() || [];
		return orderedProperties.filter((propertyId) => {
			return propertyId !== this.groupByPropertyId
				&& propertyId !== this.swimlanePropertyId
				&& propertyId !== this.milestonePropertyId
				&& propertyId !== this.findTagPropertyId();
		});
	}

	private formatCardPropertyValue(value: unknown): string | null {
		if (value === null || value === undefined) {
			return null;
		}

		if (Array.isArray(value)) {
			const values = value
				.map((item) => this.formatCardPropertyValue(item))
				.filter((item): item is string => Boolean(item));
			return values.length > 0 ? values.join(', ') : null;
		}

		const normalized = String(value as string).trim();
		if (!normalized || /^(null|undefined)$/i.test(normalized)) {
			return null;
		}

		return normalized;
	}

	private async loadCardTasks(card: CardInstance, tasksEl: HTMLElement): Promise<void> {
		if (!hasTaskVault(this.app)) {
			tasksEl.remove();
			return;
		}

		try {
			const content = await this.app.vault.cachedRead(card.entry.file);
			const tasks = this.getCardTasksFromContent(card, content);
			tasksEl.empty();
			tasksEl.addEventListener('click', (event) => event.stopPropagation());
			tasksEl.addEventListener('mousedown', (event) => event.stopPropagation());

			if (tasks.length === 0) {
				this.renderEmptyTaskState(card.entry, tasksEl);
				return;
			}

			this.renderCardTasks(card, tasks, tasksEl);
		} catch (error) {
			console.error('Error loading tasks for card:', card.entry.file.path, error);
			tasksEl.remove();
		}
	}

	private getCardTasksFromContent(card: CardInstance, content: string): NoteTask[] {
		if (card.milestoneIndex === null) {
			return parseMarkdownTasks(content);
		}

		const section = findHeadingSection(content, card.title);
		if (!section) {
			return [];
		}

		return parseMarkdownTasks(content, section);
	}

	private renderEmptyTaskState(entry: BasesEntry, tasksEl: HTMLElement): void {
		tasksEl.empty();
		const cardEl = tasksEl.closest(`.${CSS_CLASSES.CARD}`);
		if (cardEl instanceof HTMLElement) {
			this.clearCardTaskProgress(cardEl);
		}

		const linkEl = tasksEl.createEl('button', {
			cls: CSS_CLASSES.CARD_TASK_EMPTY_LINK,
			text: '⚠️ Create next task', // eslint-disable-line obsidianmd/ui/sentence-case
		});
		linkEl.type = 'button';
		linkEl.addEventListener('click', (event) => {
			event.stopPropagation();
			if (this.app?.workspace) {
				void this.app.workspace.openLinkText(entry.file.path, '', false);
			}
		});
	}

	private renderCardTasks(card: CardInstance, tasks: NoteTask[], tasksEl: HTMLElement): void {
		tasksEl.empty();

		const openTasks = tasks.filter((task) => !task.completed);
		const completedTasks = tasks.filter((task) => task.completed);
		const cardId = this.getCardInstanceId(card);
		const isExpanded = this.expandedCompletedTaskCards.has(cardId);
		const cardEl = tasksEl.closest(`.${CSS_CLASSES.CARD}`);
		if (cardEl instanceof HTMLElement) {
			this.renderCardTaskProgress(cardEl, completedTasks.length, tasks.length);
		}

		const summaryEl = tasksEl.createDiv({ cls: CSS_CLASSES.CARD_TASK_SUMMARY });
		summaryEl.createSpan({
			text: `${openTasks.length} open · ${completedTasks.length} done`,
			cls: CSS_CLASSES.CARD_TASK_COUNTS,
		});

		if (completedTasks.length > 0) {
			const toggleEl = summaryEl.createEl('button', { cls: CSS_CLASSES.CARD_TASK_TOGGLE });
			toggleEl.type = 'button';
			toggleEl.textContent = isExpanded ? 'Hide done' : `Show ${completedTasks.length} done`;
			toggleEl.addEventListener('click', (event) => {
				event.stopPropagation();
				if (isExpanded) {
					this.expandedCompletedTaskCards.delete(cardId);
				} else {
					this.expandedCompletedTaskCards.add(cardId);
				}
				this.renderCardTasks(card, tasks, tasksEl);
			});
		}

		const listEl = tasksEl.createDiv({ cls: CSS_CLASSES.CARD_TASK_LIST });
		const visibleTasks = isExpanded
			? tasks
			: tasks.filter((task) => !task.completed);

		visibleTasks.forEach((task) => {
			listEl.appendChild(this.createTaskItem(card.entry, task, async () => {
				this.renderCardTasks(card, tasks, tasksEl);
			}));
		});
	}

	private renderCardTaskProgress(cardEl: HTMLElement, completedTasks: number, totalTasks: number): void {
		const svgNamespace = 'http://www.w3.org/2000/svg';
		const ringRadius = 11.5;
		const ringCircumference = 2 * Math.PI * ringRadius;
		const headerEl = cardEl.querySelector(`.${CSS_CLASSES.CARD_HEADER}`);
		if (!(headerEl instanceof HTMLElement)) {
			return;
		}

		let badgesEl = headerEl.querySelector(`.${CSS_CLASSES.CARD_BADGES}`);
		if (!(badgesEl instanceof HTMLElement)) {
			badgesEl = headerEl.createDiv({ cls: CSS_CLASSES.CARD_BADGES });
		}

		let progressEl = badgesEl.querySelector(`.${CSS_CLASSES.CARD_TASK_PROGRESS}`);
		if (!(progressEl instanceof HTMLElement)) {
			progressEl = document.createElement('div');
			progressEl.className = CSS_CLASSES.CARD_TASK_PROGRESS;
			badgesEl.prepend(progressEl);
		}
		const progressElement = progressEl as HTMLElement;
		let progressSvgEl = progressElement.querySelector('svg');
		if (!hasLocalName(progressSvgEl, 'svg')) {
			progressSvgEl = document.createElementNS(svgNamespace, 'svg');
			progressSvgEl.setAttribute('viewBox', '0 0 28 28');
			progressSvgEl.setAttribute('aria-hidden', 'true');
			progressSvgEl.classList.add('obk-card-task-progress-svg');

			const trackCircle = document.createElementNS(svgNamespace, 'circle');
			trackCircle.setAttribute('cx', '14');
			trackCircle.setAttribute('cy', '14');
			trackCircle.setAttribute('r', String(ringRadius));
			trackCircle.classList.add('obk-card-task-progress-track');

			const meterCircle = document.createElementNS(svgNamespace, 'circle');
			meterCircle.setAttribute('cx', '14');
			meterCircle.setAttribute('cy', '14');
			meterCircle.setAttribute('r', String(ringRadius));
			meterCircle.classList.add('obk-card-task-progress-meter');

			progressSvgEl.appendChild(trackCircle);
			progressSvgEl.appendChild(meterCircle);
			progressElement.prepend(progressSvgEl);
		}

		const meterCircle = progressSvgEl.querySelector('.obk-card-task-progress-meter');
		if (hasLocalName(meterCircle, 'circle')) {
			const meterCircleEl = meterCircle as unknown as HTMLElement;
			const completionRatio = totalTasks === 0 ? 0 : completedTasks / totalTasks;
			progressElement.style.setProperty('--obk-task-progress', `${completionRatio * 100}%`);
			meterCircleEl.style.strokeDasharray = `${ringCircumference}`;
			meterCircleEl.style.strokeDashoffset = `${ringCircumference * (1 - completionRatio)}`;
		}

		let progressTextEl = progressElement.querySelector(`.${CSS_CLASSES.CARD_TASK_PROGRESS_TEXT}`);
		if (!(progressTextEl instanceof HTMLElement)) {
			progressTextEl = document.createElement('span');
			progressTextEl.className = CSS_CLASSES.CARD_TASK_PROGRESS_TEXT;
			progressElement.appendChild(progressTextEl);
		}

		progressTextEl.textContent = `${completedTasks}/${totalTasks}`;
	}

	private clearCardTaskProgress(cardEl: HTMLElement): void {
		const progressEl = cardEl.querySelector(`.${CSS_CLASSES.CARD_TASK_PROGRESS}`);
		if (progressEl instanceof HTMLElement) {
			progressEl.remove();
		}
	}

	private getCardInstanceId(card: CardInstance): string {
		return card.milestoneIndex === null
			? card.entry.file.path
			: `${card.entry.file.path}::milestone:${card.milestoneIndex}`;
	}

	private createTaskItem(entry: BasesEntry, task: NoteTask, onToggle: () => void | Promise<void>): HTMLElement {
		const taskEl = document.createElement('label');
		taskEl.className = CSS_CLASSES.TASK_ITEM;
		taskEl.setAttribute(DATA_ATTRIBUTES.TASK_LINE, String(task.line));
		taskEl.style.setProperty('--obk-task-depth', String(task.depth));
		taskEl.addEventListener('click', (event) => event.stopPropagation());
		taskEl.addEventListener('mousedown', (event) => event.stopPropagation());

		const checkboxEl = document.createElement('input');
		checkboxEl.type = 'checkbox';
		checkboxEl.className = CSS_CLASSES.TASK_CHECKBOX;
		checkboxEl.checked = task.completed;

		const textEl = document.createElement('span');
		textEl.className = CSS_CLASSES.TASK_TEXT;
		textEl.textContent = task.text;

		if (task.completed) {
			taskEl.classList.add(CSS_CLASSES.TASK_ITEM_COMPLETED);
		}

		checkboxEl.addEventListener('click', (event) => event.stopPropagation());
		checkboxEl.addEventListener('change', () => {
			void (async () => {
				const updated = await this.handleTaskCheckboxChange(entry, task, checkboxEl, taskEl);
				if (updated) {
					await onToggle();
				}
			})();
		});

		taskEl.appendChild(checkboxEl);
		taskEl.appendChild(textEl);
		return taskEl;
	}

	private async handleTaskCheckboxChange(
		entry: BasesEntry,
		task: NoteTask,
		checkboxEl: HTMLInputElement,
		taskEl: HTMLElement
	): Promise<boolean> {
		if (!hasTaskVault(this.app)) {
			checkboxEl.checked = task.completed;
			return false;
		}

		const nextCompleted = checkboxEl.checked;
		checkboxEl.disabled = true;

		try {
			const currentContent = await this.app.vault.cachedRead(entry.file);
			const updatedContent = updateTaskCompletion(currentContent, task, nextCompleted);

			if (updatedContent === null) {
				throw new Error('Task line not found');
			}

			await this.app.vault.modify(entry.file, updatedContent);
			task.completed = nextCompleted;
			task.originalLine = `${task.indent}${task.bullet} [${nextCompleted ? 'x' : ' '}] ${task.text}`;
			taskEl.classList.toggle(CSS_CLASSES.TASK_ITEM_COMPLETED, nextCompleted);
			return true;
		} catch (error) {
			console.error('Error updating task checkbox:', entry.file.path, error);
			checkboxEl.checked = task.completed;
			return false;
		} finally {
			checkboxEl.disabled = false;
		}
	}

	private initializeSortable(): void {
		// Clean up existing Sortable instances
		this.sortableInstances.forEach((instance) => {
			instance.destroy();
		});
		this.sortableInstances = [];

		// Get all column bodies
		const selector = `.${CSS_CLASSES.COLUMN_BODY}[${DATA_ATTRIBUTES.SORTABLE_CONTAINER}]`;
		const columnBodies = this.containerEl.querySelectorAll(selector);

		columnBodies.forEach((columnBody) => {
			// Type guard to ensure we have an HTMLElement
			if (!(columnBody instanceof HTMLElement)) {
				console.warn('Column body is not an HTMLElement:', columnBody);
				return;
			}

			const sortable = new Sortable(columnBody, {
				group: SORTABLE_GROUP,
				animation: SORTABLE_CONFIG.ANIMATION_DURATION,
				dragClass: CSS_CLASSES.CARD_DRAGGING,
				ghostClass: CSS_CLASSES.CARD_GHOST,
				chosenClass: CSS_CLASSES.CARD_CHOSEN,
				onEnd: (evt: Sortable.SortableEvent) => {
					void this.handleCardDrop(evt);
				},
			});

			this.sortableInstances.push(sortable);
		});
	}

	private async handleCardDrop(evt: Sortable.SortableEvent): Promise<void> {
		// Type guard to ensure evt.item is an HTMLElement
		if (!(evt.item instanceof HTMLElement)) {
			console.warn('Card element is not an HTMLElement:', evt.item);
			return;
		}

		const cardEl = evt.item;
		const entryPath = cardEl.getAttribute(DATA_ATTRIBUTES.ENTRY_PATH);
		const milestoneIndex = this.parseMilestoneIndex(cardEl.getAttribute(DATA_ATTRIBUTES.MILESTONE_INDEX));
		
		if (!entryPath) {
			console.warn('No entry path found on card');
			return;
		}

		// Get the old and new column values
		const columnSelector = `.${CSS_CLASSES.COLUMN}`;
		const oldColumnEl = evt.from.closest(columnSelector);
		const newColumnEl = evt.to.closest(columnSelector);
		
		if (!newColumnEl) {
			console.warn('Could not find new column element');
			return;
		}

		if (!(newColumnEl instanceof HTMLElement)) {
			console.warn('New column element is not an HTMLElement');
			return;
		}

		const oldColumnValue = oldColumnEl instanceof HTMLElement
			? oldColumnEl.getAttribute(DATA_ATTRIBUTES.COLUMN_VALUE)
			: null;
		const newColumnValue = newColumnEl.getAttribute(DATA_ATTRIBUTES.COLUMN_VALUE);
		const laneSelector = `.${CSS_CLASSES.LANE}`;
		const oldLaneEl = evt.from.closest(laneSelector);
		const newLaneEl = evt.to.closest(laneSelector);
		const oldLaneValue = oldLaneEl instanceof HTMLElement
			? oldLaneEl.getAttribute(DATA_ATTRIBUTES.LANE_VALUE)
			: null;
		const newLaneValue = newLaneEl instanceof HTMLElement
			? newLaneEl.getAttribute(DATA_ATTRIBUTES.LANE_VALUE)
			: null;
		
		if (!newColumnValue) {
			console.warn('No column value found');
			return;
		}

		// Skip if dropped in the same column and lane
		if (oldColumnValue === newColumnValue && oldLaneValue === newLaneValue) {
			return;
		}

		// Find the entry
		const entries = this.data?.data;
		if (!entries) {
			console.warn('No entries data available');
			return;
		}

		const entry = entries.find((e: BasesEntry) => {
			return e.file.path === entryPath;
		});

		if (!entry) {
			console.warn('Entry not found for path:', entryPath);
			return;
		}

		if (!this.groupByPropertyId) {
			console.warn('No group by property ID set');
			return;
		}

		if (!this.app?.fileManager) {
			console.warn('File manager not available');
			return;
		}

		// Update the entry's property using fileManager
		// For "Uncategorized", we'll set it to empty string or null
		try {
			const columnValueToSet = newColumnValue === UNCATEGORIZED_LABEL ? '' : newColumnValue;
			const laneValueToSet = newLaneValue === UNCATEGORIZED_LABEL ? '' : newLaneValue;

			await this.app.fileManager.processFrontMatter(entry.file, (frontmatter: Record<string, unknown>) => {
				if (milestoneIndex !== null && this.milestonePropertyId) {
					this.updateMilestoneFrontmatterProperty(
						frontmatter,
						this.milestonePropertyId,
						milestoneIndex,
						this.groupByPropertyId,
						columnValueToSet
					);
					if (this.swimlanePropertyId && newLaneValue !== null) {
						this.updateMilestoneFrontmatterProperty(
							frontmatter,
							this.milestonePropertyId,
							milestoneIndex,
							this.swimlanePropertyId,
							laneValueToSet
						);
					}
					return;
				}

				this.setFrontmatterProperty(frontmatter, this.groupByPropertyId, columnValueToSet);
				if (this.swimlanePropertyId && newLaneValue !== null) {
					this.setFrontmatterProperty(frontmatter, this.swimlanePropertyId, laneValueToSet);
				}
			});
			
			// The view will automatically update via onDataUpdated when the file changes
		} catch (error) {
			console.error('Error updating entry property:', error);
			// Revert the visual change on error
			this.render();
		}
	}

	private getOrderedColumnValues(values: string[]): string[] {
		const mergedValues = Array.from(new Set([...values, ...this.getConfiguredColumnValuesList()]));
		if (!this.groupByPropertyId) return mergedValues.sort();
		
		const savedOrder = this.getColumnOrderFromStorage(this.groupByPropertyId);
		if (!savedOrder) return mergedValues.sort();
		
		// Saved order is already normalized strings, use directly
		const newValues = mergedValues.filter(v => !savedOrder.includes(v));
		return [...savedOrder.filter(v => mergedValues.includes(v)), ...newValues];
	}

	private getConfiguredColumnValuesList(): string[] {
		return Object.keys(this.getConfiguredColumnColors());
	}

	private getOrderedLaneValues(values: string[], propertyId: BasesPropertyId): string[] {
		const savedOrder = this.getLaneOrderFromStorage(propertyId);
		if (!savedOrder) return values.sort();

		const newValues = values.filter((value) => !savedOrder.includes(value));
		return [...savedOrder.filter((value) => values.includes(value)), ...newValues];
	}

	private setFrontmatterProperty(
		frontmatter: Record<string, unknown>,
		propertyId: BasesPropertyId,
		value: string
	): void {
		const parsedProperty = parsePropertyId(propertyId);
		const propertyName = parsedProperty.name;

		if (value === '') {
			delete frontmatter[propertyName];
			return;
		}

		frontmatter[propertyName] = value;
	}

	private updateMilestoneFrontmatterProperty(
		frontmatter: Record<string, unknown>,
		milestonePropertyId: BasesPropertyId,
		milestoneIndex: number,
		propertyId: BasesPropertyId,
		value: string
	): void {
		const milestonePropertyName = parsePropertyId(milestonePropertyId).name;
		const milestones = normalizeMilestoneFrontmatter(frontmatter[milestonePropertyName]);
		const currentMilestone = milestones[milestoneIndex];

		if (currentMilestone === undefined) {
			return;
		}

		const milestoneObject = typeof currentMilestone === 'object' && currentMilestone !== null && !Array.isArray(currentMilestone)
			? { ...(currentMilestone as Record<string, unknown>) }
			: { title: String((currentMilestone ?? '') as string) };
		setMilestoneValue(milestoneObject, parsePropertyId(propertyId).name, value);
		milestones[milestoneIndex] = milestoneObject;
		frontmatter[milestonePropertyName] = milestones;
	}

	private parseMilestoneIndex(value: string | null): number | null {
		if (value === null) {
			return null;
		}

		const parsed = Number.parseInt(value, 10);
		return Number.isInteger(parsed) ? parsed : null;
	}

	private initializeColumnSortable(): void {
		this.columnSortables.forEach((sortable) => sortable.destroy());
		this.columnSortables = [];
		this.columnSortable = null;

		const boardEls = this.containerEl.querySelectorAll(`.${CSS_CLASSES.BOARD}`);
		boardEls.forEach((boardEl) => {
			if (!(boardEl instanceof HTMLElement)) {
				return;
			}

			const sortable = new Sortable(boardEl, {
				animation: SORTABLE_CONFIG.ANIMATION_DURATION,
				handle: `.${CSS_CLASSES.COLUMN_DRAG_HANDLE}`,
				draggable: `.${CSS_CLASSES.COLUMN}`,
				ghostClass: CSS_CLASSES.COLUMN_GHOST,
				dragClass: CSS_CLASSES.COLUMN_DRAGGING,
				onEnd: (evt: Sortable.SortableEvent) => {
					void this.handleColumnDrop(evt);
				},
			});

			this.columnSortables.push(sortable);
			if (!this.columnSortable) {
				this.columnSortable = sortable;
			}
		});
	}

	private initializeLaneSortable(): void {
		if (this.laneSortable) {
			this.laneSortable.destroy();
			this.laneSortable = null;
		}

		if (!this.swimlanePropertyId) {
			return;
		}

		const swimlanesEl = this.containerEl.querySelector(`.${CSS_CLASSES.SWIMLANES}`);
		if (!swimlanesEl || !(swimlanesEl instanceof HTMLElement)) {
			return;
		}

		this.laneSortable = new Sortable(swimlanesEl, {
			animation: SORTABLE_CONFIG.ANIMATION_DURATION,
			handle: `.${CSS_CLASSES.LANE_DRAG_HANDLE}`,
			draggable: `.${CSS_CLASSES.LANE}`,
			ghostClass: CSS_CLASSES.LANE_GHOST,
			dragClass: CSS_CLASSES.LANE_DRAGGING,
			onEnd: () => {
				void this.handleLaneDrop();
			},
		});
	}

	private async handleColumnDrop(evt: Sortable.SortableEvent): Promise<void> {
		if (!this.groupByPropertyId) return;
		
		const boardEl = evt.to instanceof HTMLElement
			? evt.to
			: this.containerEl.querySelector(`.${CSS_CLASSES.BOARD}`);
		if (!boardEl) return;

		// Extract current column order from the board row that was reordered
		const columns = boardEl.querySelectorAll(`.${CSS_CLASSES.COLUMN}`);
		const order = Array.from(columns).map(col => 
			col.getAttribute(DATA_ATTRIBUTES.COLUMN_VALUE)
		).filter((v): v is string => v !== null);
		
		await this.saveColumnOrderToStorage(this.groupByPropertyId, order);
		if (this.swimlanePropertyId) {
			this.render();
		}
	}

	private async handleLaneDrop(): Promise<void> {
		if (!this.swimlanePropertyId) {
			return;
		}

		const lanes = this.containerEl.querySelectorAll(`.${CSS_CLASSES.LANE}`);
		const order = Array.from(lanes)
			.map((lane) => lane.getAttribute(DATA_ATTRIBUTES.LANE_VALUE))
			.filter((value): value is string => value !== null);

		await this.saveLaneOrderToStorage(this.swimlanePropertyId, order);
	}

	private getColumnOrderFromStorage(propertyId: BasesPropertyId): string[] | null {
		return this.getStoredOrder('columnOrders', propertyId);
	}

	private getLaneOrderFromStorage(propertyId: BasesPropertyId): string[] | null {
		return this.getStoredOrder('laneOrders', propertyId);
	}

	private async saveColumnOrderToStorage(propertyId: BasesPropertyId, order: string[]): Promise<void> {
		this.setStoredOrder('columnOrders', propertyId, order);
	}

	private async saveLaneOrderToStorage(propertyId: BasesPropertyId, order: string[]): Promise<void> {
		this.setStoredOrder('laneOrders', propertyId, order);
	}

	private getStoredOrder(configKey: 'columnOrders' | 'laneOrders', propertyId: BasesPropertyId): string[] | null {
		const configValue = this.config?.get?.(configKey);
		if (!configValue || typeof configValue !== 'object') {
			return null;
		}

		const orders = configValue as Record<string, unknown>;
		const order = orders[propertyId];
		if (!Array.isArray(order)) {
			return null;
		}

		return order.filter((value): value is string => typeof value === 'string');
	}

	private setStoredOrder(configKey: 'columnOrders' | 'laneOrders', propertyId: BasesPropertyId, order: string[]): void {
		const configValue = this.config?.get?.(configKey);
		const orders = configValue && typeof configValue === 'object'
			? { ...(configValue as Record<string, unknown>) }
			: {};
		orders[propertyId] = order;
		this.config?.set?.(configKey, orders);
	}

	private getColumnTone(value: string): string {
		const normalized = value.trim().toLowerCase();
		if (/^(complete|completed|done)$/.test(normalized)) {
			return 'success';
		}
		if (/^(in-progress|in progress|doing)$/.test(normalized)) {
			return 'progress';
		}
		if (/^(ready|to do|todo|not started)$/.test(normalized)) {
			return 'ready';
		}
		return 'neutral';
	}

	private applyCustomColumnColor(columnEl: HTMLElement, columnValue: string): void {
		const customColor = this.getConfiguredColumnColors()[columnValue];
		if (!customColor) {
			return;
		}

		columnEl.style.setProperty(
			'--obk-column-header-bg',
			`linear-gradient(135deg, color-mix(in srgb, ${customColor} 34%, white 6%), color-mix(in srgb, ${customColor} 18%, var(--obk-panel-bg) 82%))`
		);
		columnEl.style.setProperty(
			'--obk-column-header-border',
			`color-mix(in srgb, ${customColor} 42%, var(--obk-panel-border) 58%)`
		);
		columnEl.style.setProperty(
			'--obk-column-count-bg',
			`color-mix(in srgb, ${customColor} 24%, var(--background-primary) 76%)`
		);
		columnEl.style.setProperty(
			'--obk-column-count-border',
			`color-mix(in srgb, ${customColor} 38%, var(--background-modifier-border) 62%)`
		);
	}

	private getConfiguredColumnColors(): Record<string, string> {
		const configValue = this.config?.get?.('columnColors');
		if (!Array.isArray(configValue)) {
			return {};
		}

		const mappings: Record<string, string> = {};
		for (const item of configValue) {
			if (typeof item !== 'string') {
				continue;
			}

			const match = item.match(/^(.+?)\s*[:=]\s*(.+)$/);
			if (!match) {
				continue;
			}

			const [, rawColumnValue, rawColor] = match;
			const columnValue = rawColumnValue.trim();
			const colorValue = rawColor.trim();
			if (!columnValue || !this.isValidCssColor(colorValue)) {
				continue;
			}

			mappings[columnValue] = colorValue;
		}

		return mappings;
	}

	private isValidCssColor(value: string): boolean {
		if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
			return CSS.supports('color', value);
		}

		return /^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)
			|| /^(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\(/i.test(value)
			|| /^var\(--[\w-]+\)$/i.test(value)
			|| /^[a-z]+$/i.test(value);
	}

	onClose(): void {
		// Clean up Sortable instances
		this.sortableInstances.forEach((instance) => {
			instance.destroy();
		});
		this.sortableInstances = [];
		
		// Clean up column Sortable instance
		this.columnSortables.forEach((sortable) => sortable.destroy());
		this.columnSortables = [];
		this.columnSortable = null;
		if (this.laneSortable) {
			this.laneSortable.destroy();
			this.laneSortable = null;
		}
		
		// Note: DOM event listeners attached to elements within containerEl
		// are automatically cleaned up when containerEl is cleared (via empty()).
		// No manual cleanup needed for listeners on child elements.
	}

	static getViewOptions(this: void): ViewOption[] {
		return [
			{
				displayName: 'Group by',
				type: 'property',
				key: 'groupByProperty',
				filter: (prop: string) => !prop.startsWith('file.'),
				placeholder: 'Select property',
			},
			{
				displayName: 'Swimlanes',
				type: 'property',
				key: 'swimlaneProperty',
				filter: (prop: string) => !prop.startsWith('file.'),
				placeholder: 'Optional property',
			},
			{
				displayName: 'Milestones',
				type: 'property',
				key: 'milestoneProperty',
				filter: (prop: string) => !prop.startsWith('file.'),
				placeholder: 'Optional list property',
			},
			{
				displayName: 'Show swimlanes',
				type: 'toggle',
				key: 'showSwimlanes',
				default: true,
				shouldHide: (config) => !config.get('swimlaneProperty'),
			},
			{
				displayName: 'Column colors',
				type: 'multitext',
				key: 'columnColors',
			},
		];
	}
}
