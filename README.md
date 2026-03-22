# Kanban Bases View for Obsidian

Kanban Bases View adds an interactive kanban layout to Obsidian Bases so you can organize notes, projects, and milestone lists with drag-and-drop updates directly from a Base.

This repository is maintained by Matt Harrison and builds on the original plugin created by I. Welch Canavan.

## Demo

<video src="https://github.com/user-attachments/assets/933e075a-041d-40ea-b65a-13944173c95f" controls width="100%" title="Kanban Bases View Demo - Drag and drop tasks between columns"></video>

## Features

- **Group by any Base property**: Build columns from status, priority, category, or any other non-file property.
- **Optional swimlanes**: Add a second property to split the board into horizontal lanes.
- **Show or collapse swimlanes**: Keep a swimlane property configured but hide lane rows when you want a simpler board; cards retain a swimlane badge.
- **Milestone cards from list properties**: Point the view at a list property and each milestone renders as its own card instead of forcing one card per note.
- **Milestone field overrides**: Milestones can override the board column or swimlane value while still inheriting note-level values when omitted.
- **Frontmatter fallback for milestones**: If Bases exposes a list property as summary text, the view falls back to the note's frontmatter via metadata cache so milestone cards still render.
- **Task-aware cards**: Cards show markdown task progress, open/done counts, nested tasks, and inline checkbox toggles.
- **Milestone-scoped task sections**: When milestone titles match note headings, each milestone card shows only the tasks inside that heading section.
- **Tags and property badges**: Cards display tag pills, swimlane badges, and other visible Base properties as metadata rows.
- **Drag and drop updates note data**: Moving a card updates the grouped property in frontmatter; moving a milestone card updates only the matching milestone object.
- **Column and lane reordering**: Reorder columns and swimlanes with drag handles.
- **Per-property order persistence**: Column order is remembered separately for each grouped property, and lane order is remembered per swimlane property.
- **Custom column colors**: Define color mappings per column value to override the default tone styling and keep important empty columns visible.
- **Scroll position preservation**: Refreshes and Base updates keep your current vertical and horizontal scroll positions instead of jumping back to the top.
- **Open notes directly**: Click any card to open the source note.

## Installation

### Manual Installation

1. Download the latest release from the [Releases](../../releases) page
2. Extract the plugin folder to your vault's `.obsidian/plugins/` directory
3. Reload Obsidian
4. Enable the plugin in Settings → Community plugins

### Development Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/mtharrison/obsidian-bases-kanban.git
   cd obsidian-bases-kanban
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the plugin:
   ```bash
   npm run build
   ```

4. Link or copy the plugin folder to your vault's `.obsidian/plugins/` directory

## Usage

1. Create or open a Base in Obsidian
2. Add a view and select "Kanban" as the view type
3. Configure the board using the available view options:
   - **Group by**: the property that defines columns
   - **Swimlanes**: an optional second property for horizontal lanes
   - **Milestones**: an optional list property that turns each milestone into its own card
   - **Show swimlanes**: hide or show lane rows when a swimlane property is configured
   - **Column colors**: optional `Column Value: color` mappings
4. Your notes or milestones will be organized automatically based on those property values
5. Drag cards between columns or lanes to update the underlying frontmatter
6. Click any card to open the corresponding note
7. Drag columns or swimlanes by their handles (⋮⋮) to reorder them; your preferred order is saved per property

### Example

If your base has a "Status" property with values "To Do", "Doing", and "Done":
- Select "Status" in the "Group by" dropdown
- Three columns will appear: "To Do", "Doing", and "Done" (plus an "Uncategorized" column for notes without a status)
- Drag cards between columns to change their status
- Click any card to open the note
- Drag columns by their handle to reorder them - your order preference will be remembered

### Milestone list format

If you configure **Milestones**, the property should be a list in frontmatter. Simple string lists and object lists are both supported:

```yaml
milestones:
  - Discovery
  - title: Build beta
    status: Doing
    priority: Workstream A
  - name: Launch
    status: Ready
```

Supported milestone title keys are `title`, `name`, and `label`.

If a milestone does not define the board fields you selected for columns or swimlanes, the card falls back to the note-level property value.

### Milestone task sections

When a milestone title matches a heading in the note, that milestone card only shows tasks from that heading section. For example:

```markdown
## Discovery
- [ ] Interview users
- [x] Draft brief

## Build beta
- [ ] Ship auth flow
```

With milestone titles `Discovery` and `Build beta`, each card shows only its own section's tasks.

### Column color mappings

Use the **Column colors** option to define one mapping per line:

```text
Backlog: #6699ff
Doing: oklch(72% 0.16 75)
Done: var(--color-green)
```

Invalid lines are ignored.

## Development

### Prerequisites

- Node.js (v24)
- npm

### Building

```bash
npm run build
```

### Development Mode

```bash
npm run dev
```

This will watch for changes and rebuild automatically.

### Testing

```bash
npm test
```

### Type Checking

```bash
npm run typecheck
```

### Technical notes

- The plugin uses the **`.obk-`** CSS class prefix (Obsidian Bases Kanban) for all view UI classes to avoid collisions with other plugins and themes.
- Milestone cards are derived from list-property frontmatter and can update nested milestone data without changing the parent note's board fields.
- Task rendering reads markdown task lists directly from the note file so inline completion state stays in sync with the source note.

## Releasing

### Creating a Release

1. Use Semantic Release to prepare the release commit and tag.
2. Ensure the release commit updates `manifest.json`, `package.json`, and `versions.json` to the same plugin version.
3. When Semantic Release pushes the version tag, GitHub Actions will:
   - Run linting, type checks, tests, and the production build
   - Verify that `manifest.json` and `package.json` versions match
   - Verify that the version exists in `versions.json`
   - Rebuild the plugin from the tagged commit
   - Verify the pushed tag matches `dist/manifest.json`
   - Create or update the GitHub release for that tag and upload `main.js`, `manifest.json`, and `styles.css` as assets
4. Submit or update the plugin in the Obsidian community catalog as needed:
   - Follow the [Obsidian plugin submission guidelines](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)
   - Update the entry in the [obsidian-releases](https://github.com/obsidianmd/obsidian-releases) repository when required

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Attribution

- Maintained in its current form by Matt Harrison.
- Originally created by I. Welch Canavan.
- Built with [SortableJS](https://sortablejs.github.io/Sortable/) for drag-and-drop functionality.
