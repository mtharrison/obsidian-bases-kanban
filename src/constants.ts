/**
 * Constants used throughout the Kanban view
 */

/** Label used for entries without a property value */
export const UNCATEGORIZED_LABEL = 'Uncategorized';

/** Sortable.js group name for kanban columns */
export const SORTABLE_GROUP = 'obk-columns';

/** Data attribute names */
export const DATA_ATTRIBUTES = {
	COLUMN_VALUE: 'data-column-value',
	COLUMN_TONE: 'data-column-tone',
	LANE_VALUE: 'data-lane-value',
	ENTRY_PATH: 'data-entry-path',
	MILESTONE_INDEX: 'data-milestone-index',
	SORTABLE_CONTAINER: 'data-sortable-container',
	COLUMN_POSITION: 'data-column-position',
	TASK_LINE: 'data-task-line',
} as const;

/** CSS class names */
export const CSS_CLASSES = {
	// Container
	VIEW_CONTAINER: 'obk-view-container',
	BOARD_SCROLLER: 'obk-board-scroller',
	BOARD: 'obk-board',
	
	// Property selector (for future or framework-driven UI)
	PROPERTY_SELECTOR: 'obk-property-selector',
	PROPERTY_LABEL: 'obk-property-label',
	PROPERTY_SELECT: 'obk-property-select',
	
	// Column
	SWIMLANES: 'obk-swimlanes',
	LANE: 'obk-lane',
	LANE_HEADER: 'obk-lane-header',
	LANE_TITLE: 'obk-lane-title',
	LANE_COUNT: 'obk-lane-count',
	LANE_DRAG_HANDLE: 'obk-lane-drag-handle',
	LANE_DRAGGING: 'obk-lane-dragging',
	LANE_GHOST: 'obk-lane-ghost',
	COLUMN: 'obk-column',
	COLUMN_HEADER: 'obk-column-header',
	COLUMN_TITLE: 'obk-column-title',
	COLUMN_COUNT: 'obk-column-count',
	COLUMN_BODY: 'obk-column-body',
	COLUMN_DRAG_HANDLE: 'obk-column-drag-handle',
	COLUMN_DRAGGING: 'obk-column-dragging',
	COLUMN_GHOST: 'obk-column-ghost',
	
	// Card
	CARD: 'obk-card',
	CARD_HEADER: 'obk-card-header',
	CARD_TITLE_GROUP: 'obk-card-title-group',
	CARD_TITLE: 'obk-card-title',
	CARD_SOURCE: 'obk-card-source',
	CARD_SOURCE_LABEL: 'obk-card-source-label',
	CARD_SOURCE_NAME: 'obk-card-source-name',
	CARD_BADGES: 'obk-card-badges',
	CARD_TAGS: 'obk-card-tags',
	CARD_SWIMLANE_PILL: 'obk-card-swimlane-pill',
	CARD_TAG_PILL: 'obk-card-tag-pill',
	CARD_META: 'obk-card-meta',
	CARD_META_ROW: 'obk-card-meta-row',
	CARD_META_LABEL: 'obk-card-meta-label',
	CARD_META_VALUE: 'obk-card-meta-value',
	CARD_PREVIEW: 'obk-card-preview',
	CARD_TASKS: 'obk-card-tasks',
	CARD_TASK_SUMMARY: 'obk-card-task-summary',
	CARD_TASK_PROGRESS: 'obk-card-task-progress',
	CARD_TASK_PROGRESS_TEXT: 'obk-card-task-progress-text',
	CARD_TASK_COUNTS: 'obk-card-task-counts',
	CARD_TASK_TOGGLE: 'obk-card-task-toggle',
	CARD_TASK_EMPTY_LINK: 'obk-card-task-empty-link',
	CARD_TASK_LIST: 'obk-card-task-list',
	TASK_ITEM: 'obk-task-item',
	TASK_ITEM_COMPLETED: 'obk-task-item-completed',
	TASK_CHECKBOX: 'obk-task-checkbox',
	TASK_TEXT: 'obk-task-text',
	CARD_DRAGGING: 'obk-card-dragging',
	CARD_GHOST: 'obk-card-ghost',
	CARD_CHOSEN: 'obk-card-chosen',
	
	// Empty state
	EMPTY_STATE: 'obk-empty-state',
	
	// Sortable placeholder (fallback / shared ghost style)
	SORTABLE_GHOST: 'obk-sortable-ghost',
} as const;

/** Sortable.js configuration constants */
export const SORTABLE_CONFIG = {
	ANIMATION_DURATION: 150,
} as const;

/** Empty state messages */
export const EMPTY_STATE_MESSAGES = {
	NO_ENTRIES: 'No entries found. Add some notes to your base.',
	NO_PROPERTIES: 'No properties found in entries.',
} as const;
