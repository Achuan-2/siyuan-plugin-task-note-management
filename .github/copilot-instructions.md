# GitHub Copilot Instructions for SiYuan Task Note Management Plugin

## Project Overview

This is a task management plugin for SiYuan Notes, developed to practice the Bullet Journal method. The plugin supports document and block reminders, calendar view for scheduling, Pomodoro timer for focus, project kanban boards, Eisenhower Matrix view, and more.

**Key Philosophy**: This plugin is built around the "Bullet Journal Method" (防弹笔记法), focusing on task-centered note-taking rather than just material organization. Each note should revolve around a specific task with clear action purposes and steps.

## Technology Stack

- **Language**: TypeScript
- **UI Framework**: Svelte
- **Build Tool**: Vite
- **Plugin API**: SiYuan Plugin API
- **Date/Time Parsing**: chrono-node
- **Charts**: ECharts
- **Internationalization**: Custom YAML-based i18n system

## Project Structure

```
src/
├── index.ts              # Main plugin entry point
├── api.ts                # API functions for SiYuan integration
├── components/           # UI components (dialogs, panels, views)
├── libs/                 # Utility libraries
├── types/                # TypeScript type definitions
├── utils/                # Helper utilities
├── SettingPanel.svelte   # Settings UI component
└── index.scss            # Main styles

public/i18n/              # Internationalization files
├── en_US.json
├── zh_CN.json
└── README.md

scripts/                  # Development and build scripts
├── make_dev_copy.js      # Copy plugin to SiYuan for development
├── make_dev_link.js      # Create symbolic links for development
├── make_install.js       # Install plugin to SiYuan
└── utils.js              # Script utilities
```

## Coding Conventions

### TypeScript/JavaScript

1. **File Headers**: Include copyright headers with author, date, and description:
   ```typescript
   /*
    * Copyright (c) 2024 by [author]. All Rights Reserved.
    * @Author       : [author]
    * @Date         : [date]
    * @FilePath     : /path/to/file
    * @LastEditTime : [date]
    * @Description  : [description]
    */
   ```

2. **Naming Conventions**:
   - Classes: PascalCase (e.g., `ReminderDialog`, `ProjectPanel`)
   - Functions/Methods: camelCase (e.g., `loadSettings`, `createDocWithMd`)
   - Constants: UPPER_SNAKE_CASE (e.g., `STORAGE_NAME`, `TAB_TYPE`)
   - Private class members: prefix with underscore or use TypeScript private modifier

3. **Code Style**:
   - Use async/await for asynchronous operations
   - Prefer const over let when variables won't be reassigned
   - Use descriptive variable names, especially for Chinese contexts (可以使用中文注释)

4. **Error Handling**:
   - Always use try-catch for async operations
   - Show user-friendly error messages using `showMessage()`
   - Log detailed errors to console for debugging

### Svelte Components

1. Use TypeScript in Svelte files with `<script lang="ts">`
2. Follow reactive declarations pattern with `$:` for computed values
3. Use proper component lifecycle hooks (onMount, onDestroy)
4. Keep components focused and single-responsibility

### Internationalization

1. **Always support both English and Chinese**:
   - Use the `t()` function from `src/utils/i18n.ts` for all user-facing strings
   - Add translations to both `public/i18n/en_US.json` and `public/i18n/zh_CN.json`
   - Translation keys should be descriptive camelCase

2. **Example usage**:
   ```typescript
   import { t } from "./utils/i18n";
   showMessage(t("taskCreatedSuccessfully"));
   ```

### API Integration

1. **SiYuan API Usage**:
   - Import API functions from `src/api.ts`
   - Common operations: `createDocWithMd`, `getBlock`, `updateBlock`, `setBlockAttrs`
   - Always handle API errors gracefully

2. **Block and Document Operations**:
   - Use block IDs (22-character strings) to reference blocks
   - Use notebook IDs and paths for document operations
   - Support block references in format: `((blockId "title"))`
   - Support SiYuan links in format: `siyuan://blocks/blockId`

### Data Management

1. **Storage**:
   - Use `plugin.loadData(STORAGE_NAME)` for persistent storage
   - Settings stored in `reminder-settings.json`
   - Reminder data in `.siyuan/storage/reminder-data.json`
   - Project data in `.siyuan/storage/project-data.json`

2. **Date/Time Handling**:
   - Use local date/time strings in format: "YYYY-MM-DD HH:mm"
   - Leverage chrono-node for natural language date parsing
   - Helper functions in `src/utils/dateUtils.ts`

## Development Workflow

### Setup

```bash
# Install dependencies
npm install
# or
pnpm install

# Development mode (with hot reload)
npm run dev

# Build for production
npm run build

# Create symbolic link to SiYuan plugins directory
npm run make-link
# or for Windows with admin rights
npm run make-link-win
```

### Development Mode

1. **Auto-copy to SiYuan**: The vite config includes auto-copy functionality in dev mode
2. **Scripts**: Use `scripts/make_dev_copy.js` to manually copy to SiYuan plugins directory
3. **Testing**: Test changes directly in SiYuan Notes application

### Build Process

1. Vite builds TypeScript and Svelte to `dist/` or `dev/` directory
2. Static assets (README, plugin.json, icons, audios) copied to output
3. i18n YAML files converted to JSON
4. Production builds create `package.zip` for distribution

## Plugin Architecture

### Core Components

1. **ReminderPlugin (index.ts)**: Main plugin class
   - Manages plugin lifecycle (onload, onunload)
   - Registers UI elements (top bar, dock panels, tabs)
   - Handles settings and data persistence

2. **Panels and Views**:
   - `ReminderPanel`: Main dock panel for reminders list
   - `CalendarView`: Full calendar view for scheduling
   - `EisenhowerMatrixView`: Four quadrants for task prioritization
   - `ProjectKanbanView`: Kanban board for project management
   - `ProjectPanel`: Project list and management

3. **Dialogs**:
   - `ReminderDialog`: Create/edit individual reminders
   - `BatchReminderDialog`: Batch process multiple reminders
   - `DocumentReminderDialog`: Document-level reminders
   - `ProjectDialog`: Create/edit projects
   - `NotificationDialog`: Display reminder notifications

4. **Managers**:
   - `CategoryManager`: Manage task categories
   - `PomodoroManager`: Pomodoro timer functionality
   - `PomodoroRecordManager`: Track Pomodoro sessions

### Key Features

1. **Reminders**: Support for one-time and repeating reminders at block and document level
2. **Natural Language**: Chrono-node integration for parsing dates like "tomorrow at 3pm"
3. **Calendar View**: FullCalendar integration for visual scheduling
4. **Pomodoro Timer**: Focus timer with work/break cycles and statistics
5. **Project Management**: Kanban boards with task hierarchies
6. **Eisenhower Matrix**: Task prioritization by importance and urgency

## Best Practices

### When Adding Features

1. **Maintain Bilingual Support**: Always add translations to both language files
2. **Preserve Existing Functionality**: This is a personal-use plugin with existing workflows
3. **Test in SiYuan**: Always test changes in actual SiYuan Notes environment
4. **Consider Mobile**: Plugin supports mobile platforms (iOS, Android)

### Code Quality

1. **Type Safety**: Use TypeScript types, avoid `any` when possible
2. **Error Handling**: Catch and display user-friendly errors
3. **Performance**: Be mindful of frequent API calls or heavy computations
4. **Clean Code**: Comment complex logic, especially date/time manipulations

### UI/UX

1. **Consistent Icons**: Use SiYuan's icon system
2. **Responsive Design**: Support different screen sizes
3. **Localization**: UI elements should adapt to current language setting
4. **Accessibility**: Use semantic HTML and ARIA attributes where appropriate

## Common Patterns

### Creating a New Tab View

```typescript
// In index.ts
this.addTab({
    type: TAB_TYPE,
    init() {
        this.element.innerHTML = '<div id="tab-content"></div>';
    },
    beforeDestroy() {
        // Cleanup
    },
    destroy() {
        // Final cleanup
    }
});
```

### Showing a Message

```typescript
import { showMessage } from "siyuan";
import { t } from "./utils/i18n";

showMessage(t("operationSuccessful"));
showMessage(t("operationFailed"), 5000, "error");
```

### Working with Blocks

```typescript
import { getBlock, updateBlock, setBlockAttrs } from "./api";

// Get block content
const block = await getBlock(blockId);

// Update block attributes
await setBlockAttrs(blockId, {
    "custom-reminder-time": "2024-12-25 10:00",
    "custom-reminder-repeat": "daily"
});
```

## Testing Considerations

- **Manual Testing**: Test all changes in SiYuan Notes application
- **Cross-Platform**: Verify on Windows, macOS, Linux if possible
- **Language Switching**: Test with both English and Chinese UI
- **Data Integrity**: Ensure reminders and projects persist correctly
- **Edge Cases**: Test with empty states, invalid dates, missing data

## Important Notes

1. **Personal Use Plugin**: This plugin is primarily for personal use; be cautious with changes
2. **Data Loss Warning**: Users are warned about potential data loss; maintain data integrity
3. **Bullet Journal Philosophy**: Keep the task-centered approach in mind when adding features
4. **No Breaking Changes**: Preserve existing user data and workflows
5. **SiYuan Updates**: Stay compatible with minimum SiYuan version (3.0.12+)

## Resources

- [SiYuan Plugin API Documentation](https://github.com/siyuan-note/siyuan)
- [Plugin Development Sample](https://github.com/siyuan-note/plugin-sample-vite-svelte)
- [Bullet Journal Method](https://bulletjournal.com/)
- [Project README](./README.md)
- [Chinese README](./README_zh_CN.md)

## When in Doubt

1. Check existing code for similar patterns
2. Maintain consistency with current architecture
3. Preserve bilingual support (English/Chinese)
4. Test thoroughly in SiYuan Notes
5. Ask for clarification if requirements are unclear
