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
import { parseMarkdownTasks, updateTaskCompletion, type NoteTask } from './utils/tasks.ts';

function hasTaskVault(app: App | undefined): app is App {
	return app !== undefined
		&& 'vault' in app
		&& typeof app.vault?.cachedRead === 'function'
		&& typeof app.vault?.modify === 'function';
}

export class KanbanView extends BasesView {
	type = 'kanban-view';
	
	scrollEl: HTMLElement;
	containerEl: HTMLElement;
	private groupByPropertyId: BasesPropertyId | null = null;
	private swimlanePropertyId: BasesPropertyId | null = null;
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
			this.render();
		} catch (error) {
			console.error('KanbanView error:', error);
		}
	}

	private loadConfig(): void {
		// Load group by property from config
		this.groupByPropertyId = this.config.getAsPropertyId('groupByProperty');
		this.swimlanePropertyId = this.config.getAsPropertyId('swimlaneProperty');
	}

	private shouldShowSwimlanes(): boolean {
		return this.config?.get?.('showSwimlanes') !== false;
	}

	private render(): void {
		// Clear existing content
		this.containerEl.empty();

		try {
			// Get all entries from the data
			const entries = this.data?.data || [];
			if (!entries || entries.length === 0) {
				this.containerEl.createDiv({
					text: EMPTY_STATE_MESSAGES.NO_ENTRIES,
					cls: CSS_CLASSES.EMPTY_STATE
				});
				return;
			}

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

			const columnValues = this.getOrderedColumnValues(this.getPropertyValues(entries, this.groupByPropertyId));
			if (this.swimlanePropertyId && this.shouldShowSwimlanes()) {
				this.renderSwimlanes(entries, columnValues, this.swimlanePropertyId);
			} else {
				const groupedEntries = this.groupEntriesByProperty(entries, this.groupByPropertyId);
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

	private renderSwimlanes(
		entries: BasesEntry[],
		columnValues: string[],
		swimlanePropertyId: BasesPropertyId
	): void {
		const swimlanesEl = this.containerEl.createDiv({ cls: CSS_CLASSES.SWIMLANES });
		const groupedByLane = this.groupEntriesByProperty(entries, swimlanePropertyId);
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
			const groupedByColumn = this.groupEntriesByProperty(laneEntries, this.groupByPropertyId as BasesPropertyId);

			columnValues.forEach((columnValue) => {
				const columnEl = this.createColumn(columnValue, groupedByColumn.get(columnValue) || []);
				boardEl.appendChild(columnEl);
			});
		});
	}

	private createColumn(value: string, entries: BasesEntry[]): HTMLElement {
		const columnEl = document.createElement('div');
		columnEl.className = CSS_CLASSES.COLUMN;
		columnEl.setAttribute(DATA_ATTRIBUTES.COLUMN_VALUE, value);
		columnEl.setAttribute(DATA_ATTRIBUTES.COLUMN_TONE, this.getColumnTone(value));
		if (entries.length === 0) {
			columnEl.classList.add(`${CSS_CLASSES.COLUMN}-empty`);
		}

		// Column header
		const headerEl = columnEl.createDiv({ cls: CSS_CLASSES.COLUMN_HEADER });
		
		// Add drag handle
		const dragHandle = headerEl.createDiv({ cls: CSS_CLASSES.COLUMN_DRAG_HANDLE });
		dragHandle.textContent = '⋮⋮';
		
		headerEl.createSpan({ text: value, cls: CSS_CLASSES.COLUMN_TITLE });
		headerEl.createSpan({ text: `(${entries.length})`, cls: CSS_CLASSES.COLUMN_COUNT });

		// Column body (cards container)
		const bodyEl = columnEl.createDiv({ cls: CSS_CLASSES.COLUMN_BODY });
		bodyEl.setAttribute(DATA_ATTRIBUTES.SORTABLE_CONTAINER, 'true');

		// Create cards for each entry
		entries.forEach((entry) => {
			const cardEl = this.createCard(entry);
			bodyEl.appendChild(cardEl);
		});

		return columnEl;
	}

	private createCard(entry: BasesEntry): HTMLElement {
		const cardEl = document.createElement('div');
		cardEl.className = CSS_CLASSES.CARD;
		const filePath = entry.file.path;
		cardEl.setAttribute(DATA_ATTRIBUTES.ENTRY_PATH, filePath);

		const headerEl = cardEl.createDiv({ cls: CSS_CLASSES.CARD_HEADER });

		// Card title - use file basename
		const titleEl = headerEl.createDiv({ cls: CSS_CLASSES.CARD_TITLE });
		titleEl.textContent = entry.file.basename;

		const swimlaneHeaderValue = this.getCardSwimlaneHeaderValue(entry);
		const tagValues = this.getCardTagValues(entry);
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
				const value = this.formatCardPropertyValue(this.getEntryPropertyValue(entry, propertyId));
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
		void this.loadCardTasks(entry, tasksEl);

		// Make card clickable to open the note
		const clickHandler = () => {
			if (this.app?.workspace) {
				void this.app.workspace.openLinkText(filePath, '', false);
			}
		};
		cardEl.addEventListener('click', clickHandler);

		return cardEl;
	}

	private getCardTagValues(entry: BasesEntry): string[] {
		const tagPropertyId = this.findTagPropertyId();
		if (!tagPropertyId) {
			return [];
		}

		try {
			const rawValue = this.getEntryPropertyValue(entry, tagPropertyId);
			return this.normalizeTagValues(rawValue);
		} catch (error) {
			console.warn('Error reading tag property for entry:', entry.file.path, error);
			return [];
		}
	}

	private getCardSwimlaneHeaderValue(entry: BasesEntry): string | null {
		if (!this.swimlanePropertyId || this.shouldShowSwimlanes()) {
			return null;
		}

		return this.formatCardPropertyValue(this.getEntryPropertyValue(entry, this.swimlanePropertyId));
	}

	private getEntryPropertyValue(entry: BasesEntry, propertyId: BasesPropertyId): unknown {
		const propertyReader = 'getProperty' in entry && typeof entry.getProperty === 'function'
			? entry.getProperty.bind(entry)
			: null;
		const valueReader = 'getValue' in entry && typeof entry.getValue === 'function'
			? entry.getValue.bind(entry)
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

		if (typeof value === 'object' && 'toString' in (value as Record<string, unknown>)) {
			return this.splitTagString(String(value));
		}

		return this.splitTagString(String(value));
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

		const normalized = String(value).trim();
		if (!normalized || /^(null|undefined)$/i.test(normalized)) {
			return null;
		}

		return normalized;
	}

	private async loadCardTasks(entry: BasesEntry, tasksEl: HTMLElement): Promise<void> {
		if (!hasTaskVault(this.app)) {
			tasksEl.remove();
			return;
		}

		try {
			const content = await this.app.vault.cachedRead(entry.file);
			const tasks = parseMarkdownTasks(content);

			if (tasks.length === 0) {
				tasksEl.remove();
				return;
			}

			tasksEl.empty();
			tasksEl.addEventListener('click', (event) => event.stopPropagation());
			tasksEl.addEventListener('mousedown', (event) => event.stopPropagation());
			this.renderCardTasks(entry, tasks, tasksEl);
		} catch (error) {
			console.error('Error loading tasks for card:', entry.file.path, error);
			tasksEl.remove();
		}
	}

	private renderCardTasks(entry: BasesEntry, tasks: NoteTask[], tasksEl: HTMLElement): void {
		tasksEl.empty();

		const openTasks = tasks.filter((task) => !task.completed);
		const completedTasks = tasks.filter((task) => task.completed);
		const isExpanded = this.expandedCompletedTaskCards.has(entry.file.path);

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
					this.expandedCompletedTaskCards.delete(entry.file.path);
				} else {
					this.expandedCompletedTaskCards.add(entry.file.path);
				}
				this.renderCardTasks(entry, tasks, tasksEl);
			});
		}

		const listEl = tasksEl.createDiv({ cls: CSS_CLASSES.CARD_TASK_LIST });
		const visibleTasks = isExpanded
			? tasks
			: tasks.filter((task) => !task.completed);

		visibleTasks.forEach((task) => {
			listEl.appendChild(this.createTaskItem(entry, task, async () => {
				this.renderCardTasks(entry, tasks, tasksEl);
			}));
		});
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
		checkboxEl.addEventListener('change', async () => {
			const updated = await this.handleTaskCheckboxChange(entry, task, checkboxEl, taskEl);
			if (updated) {
				await onToggle();
			}
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
				this.setFrontmatterProperty(frontmatter, this.groupByPropertyId as BasesPropertyId, columnValueToSet);
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
		if (!this.groupByPropertyId) return values.sort();
		
		const savedOrder = this.getColumnOrderFromStorage(this.groupByPropertyId);
		if (!savedOrder) return values.sort();
		
		// Saved order is already normalized strings, use directly
		const newValues = values.filter(v => !savedOrder.includes(v));
		return [...savedOrder.filter(v => values.includes(v)), ...newValues];
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
				displayName: 'Show swimlanes',
				type: 'toggle',
				key: 'showSwimlanes',
				default: true,
				shouldHide: (config) => !config.get('swimlaneProperty'),
			},
		];
	}
}
