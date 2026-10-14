---
name: LeetCode C Workbench
description: A compact interface for native C solutions, test results, and diagnostics.
colors:
  accent: "#225cac"
  accent-hover: "#194984"
  focus: "#1c5cb4"
  ink: "#202e3a"
  muted: "#536472"
  paper: "#fff"
  surface: "#f4f6f8"
  line: "#d4dce2"
  problem-hover: "#e7ecf1"
  problem-current: "#dae7f8"
  editor-paper: "#192633"
  editor-gutter: "#131e29"
  editor-border: "#35465a"
  editor-ink: "#e1eaf3"
  editor-muted: "#93a4b5"
  editor-selection: "rgba(76, 130, 190, .35)"
  editor-scrollbar-thumb: "#71859b"
  syntax-keyword: "#c3a6ff"
  syntax-string: "#a8d5a2"
  syntax-number: "#f5c47b"
  syntax-function: "#86c6ff"
  syntax-operator: "#cfdae5"
  syntax-macro: "#ffaf9f"
  log-paper: "#192633"
  log-ink: "#e1eaf3"
  passed: "#176344"
  error: "#a2292f"
  pending: "#765016"
  notice-paper: "#e4effa"
  notice-ink: "#234769"
  error-notice-paper: "#fbeaec"
  error-notice-ink: "#84272e"
  control-border: "#dee2e6"
  secondary-control: "#6c757d"
typography:
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "23px"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "16px"
    fontWeight: 650
    lineHeight: 1.2
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "21px"
  log:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.7
rounded:
  control-small: "0.25rem"
  control: "0.375rem"
  panel: "6px"
  dialog: "12px"
spacing:
  controls: "8px"
  compact-group: "12px"
  group: "16px"
  heading: "20px"
  panes: "24px"
  main-inline: "28px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "0.375rem 0.75rem"
  button-primary-compact:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control-small}"
    padding: "0.25rem 0.5rem"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.paper}"
  button-outline-primary:
    backgroundColor: "transparent"
    textColor: "{colors.accent}"
    rounded: "{rounded.control-small}"
    padding: "0.25rem 0.5rem"
  button-outline-primary-hover:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.paper}"
  button-outline-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.secondary-control}"
    rounded: "{rounded.control-small}"
    padding: "0.25rem 0.5rem"
  button-link:
    backgroundColor: "transparent"
    rounded: "{rounded.control-small}"
    padding: "0.25rem 0.5rem"
  search-field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control-small}"
    padding: "0.25rem 0.5rem"
    width: "100%"
  problem-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "12px 10px"
    width: "100%"
  problem-item-current:
    backgroundColor: "{colors.problem-current}"
  section-navigation:
    textColor: "{colors.muted}"
    padding: "0.5rem 1rem"
  code-editor:
    backgroundColor: "{colors.editor-paper}"
    textColor: "{colors.editor-ink}"
    typography: "{typography.code}"
    rounded: "{rounded.panel}"
  runtime-log:
    backgroundColor: "{colors.log-paper}"
    textColor: "{colors.log-ink}"
    typography: "{typography.log}"
    rounded: "{rounded.panel}"
    padding: "14px"
  dialog:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.dialog}"
    padding: "26px"
    width: "calc(100% - 32px)"
---

# Design System: LeetCode C Workbench

## Overview

**Creative North Star: "A familiar source editor"**

The user-approved Bootstrap utility interface uses an editor-and-results workspace with a compact problem navigator. Operate mode applies throughout: clear action labels, visible state, and readable diagnostics guide the interface. This document describes implemented HTML, CSS, and browser JavaScript; it does not claim browser or visual verification.

The desktop workspace places source and results side by side. Secondary tabs hold test data, the problem description, and history. The surrounding utility UI retains white surfaces, thin dividers, and restrained blue actions. The user-requested dark C editor uses syntax colors, and the diagnostic log remains dark. Native dialogs contain import and submission snapshot tasks.

**Key Characteristics:**
- Compact Bootstrap controls and platform fonts.
- Dark C syntax editor and test results share the main workspace.
- Explicit labels accompany run, save, and submission states.
- Logs and long data stay in bounded, scrollable regions.
- Responsive stacking preserves the same actions on smaller screens.

## Colors

The palette combines blue actions with cool neutral working surfaces. Frontmatter values are extracted from `web/style.css` and the installed Bootstrap stylesheet.

### Primary
- **Accent:** links, primary buttons, outlined primary actions, ordinary field carets, and control accent. The C editor caret uses editor ink.
- **Accent hover:** filled primary button hover background.
- **Focus:** custom outlines on plain controls and the editor frame. Bootstrap buttons, fields, and section navigation also retain framework focus treatments.

### Neutral
- **Ink / muted:** body text and secondary metadata.
- **Paper / surface / line:** main canvas, sidebar and utility surfaces, structural dividers.
- **Problem hover / problem current:** pointer hover and the selected problem.
- **Editor paper / gutter / border / ink / muted:** dark source area, deeper line-number gutter, frame, base code and caret, and gutter/comment text. The rest of the utility UI remains light.
- **Editor selection / scrollbar thumb:** translucent selection in the highlighted source textarea and its scrollbar thumb; the scrollbar track uses editor gutter.
- **Log paper / log ink:** compiler and runtime output.
- **Control border / secondary control:** inherited Bootstrap field borders and secondary outlined actions.

### C syntax colors
- **Syntax keyword:** C keywords.
- **Syntax string:** string and character literals.
- **Syntax number:** numbers and booleans.
- **Syntax function:** function names.
- **Syntax operator:** operators and punctuation.
- **Syntax macro:** macros, directives, and properties.
- **Editor muted:** comments, sharing the line-number text color.

### Result and notice colors
- **Passed / error / pending:** written result states and submission status.
- **Notice paper / ink:** ordinary service notices.
- **Error notice paper / ink:** error notices and recovery text.

**The Written State Rule.** State is written in text as well as shown in color; keep result labels, save messages, and memory-check availability visible.

## Typography

**Body Font:** platform sans-serif, using the frontmatter body stack.
**Code Font:** platform monospace, using the frontmatter code stack; the log stack omits Consolas as implemented.

The type hierarchy is compact and functional. Monospace identifies source, JSON, line numbers, and logs. Regular sans-serif supports controls, navigation, and descriptions. There is no separate display type role.

### Hierarchy
- **Headline:** problem and dialog headings; the mobile problem heading reduces to 21px.
- **Title:** section and sidebar headings. The sidebar inherits the body line height.
- **Body:** general text and compact controls. The brand is 18px with a bold product prefix and regular suffix; it reduces to 16px on small screens.
- **Code:** source, syntax layer, and line-number text share the same font and line height. Syntax tokens retain normal weight and style. JSON and snapshot text use the same size with a 1.7 line height.
- **Log:** diagnostic output; case tables and run summaries also use 12px text.
- **Metadata:** problem metadata and history rows use 13px text; help copy and pane metadata use 12px.

Problem descriptions have a 75ch maximum width and a 1.8 line height. Test timing columns use tabular numerals.

**The Aligned Source Rule.** Keep the source textarea, syntax layer, and line-number gutter on the same font, padding, and line height; synchronize the highlighted layer with textarea scrolling.

## Layout

The header is at least 64px tall. The main shell uses a 260px problem sidebar and a fluid workspace. Main padding is 26px vertically and the frontmatter main-inline spacing horizontally. The solution workspace uses a 1.1:1 editor/results split with the frontmatter panes gap. Toolbars wrap with the controls gap; saved state moves to the end of its toolbar on desktop.

At a maximum viewport width of 1150px, the sidebar narrows to 220px, main padding becomes 22px 20px, and results stack below the editor. The editor height becomes 390px. At a maximum width of 700px, navigation moves above the workspace; the problem list is bounded at 180px, header actions and the problem heading wrap, and main padding becomes 20px 16px.

On larger screens the editor height is `max(380px, calc(100vh - 370px))`. The log panel is between 180px and 340px tall; case details are capped at 150px. Test JSON uses 60vh. Tables scroll horizontally through Bootstrap responsive wrappers. Dialogs are at most 760px wide and 90vh tall, with their own scrolling.

## Elevation & Depth

Working surfaces are flat, with borders and tonal changes providing separation. Only native dialogs have a custom elevation shadow and translucent backdrop. Focus uses outlines or Bootstrap focus shadows rather than permanent card elevation.

The sidecar records the dialog shadow, focus treatments, and the dialog's 150ms entrance animation. Reduced-motion preferences remove that entrance and Bootstrap control transitions.

**The Flat Workspace Rule.** Keep the source, results, sidebar, and history flat; reserve elevated depth for dialogs.

## Shapes

Small Bootstrap controls use the small control radius, regular fields use the control radius, editor and log frames use the panel radius, and dialogs use the dialog radius. Most frames use a one-pixel border. The editor clips its shared frame while preserving independent source scrolling. Problem navigation uses softly rounded, full-width rows.

## Components

### Buttons

Filled primary buttons run tests, save test data, import bundles, and copy or save submission data. Outlined primary buttons handle import access and solution saving. Outlined secondary buttons expose compiler tools, variants, snapshots, and external navigation. Link buttons provide compact actions such as Refresh, Reload, Log, and Inspect.

Use the implemented Bootstrap sizes. Filled primary hover uses accent-hover; outlined primary hover fills with accent. Disabled controls remain visible during a run, and the Run tests label changes to Running… . Framework active, disabled, link, and focus colors are still inherited in places; they are not a newly approved palette rule.

### Inputs / Fields

Compact search, solution, case, and mode controls use Bootstrap fields. Inputs have explicit labels, including visually hidden labels where space is limited. Native JSON and snapshot textareas retain monospace content. The snapshot source is read-only. The source textarea uses a custom focus-within frame rather than Bootstrap field styling.

### Navigation

The problem list presents an ID/title and a second metadata line. Its local passed status uses the existing passed green with bold text; a separate accent-blue Accepted label represents the manual LeetCode outcome. The problem header exposes that state as a native labeled checkbox. Sidebar status filtering and a collapsible, scrollable topic checklist combine with text search; multiple checked topics require all matches. A clear action and written result count make the filter state visible. Hover and current states use separate neutral tints, and the current problem has `aria-current="page"`. The four section buttons use Bootstrap tab borders and the same current-state attribute. Their panels are hidden when inactive.

### Source editor

A dark line-number gutter sits beside a real textarea with a Prism C-highlighted layer underneath. Prism provides the syntax markup; the textarea remains the editable source and owns the caret, selection, and scrolling. The highlighted layer is hidden from assistive technology and ignores pointer events. Matching metrics and synchronized horizontal/vertical offsets align both layers with the gutter, including a final empty source row. If Prism is unavailable, the textarea retains readable editor-ink text.

The toolbar names the variant and saved state. Tab inserts four spaces; Shift Tab or Escape leaves the editor. Visible keyboard shortcuts save source and run tests. Reload reads local edits from disk; overwrite conflicts and unsaved navigation have visible recovery paths.

### Results and diagnostics

A text run state and summary sit above the case table. Each case offers a log action, and failed cases expose expandable input/result details. Line-number diagnostic buttons target source lines; a Tested source link exposes the recorded version when the editor differs. Log selectors separate compiler and case output and stdout/stderr. The log region can receive keyboard focus.

### Dialogs and notices

Import and submission use native dialogs with labeled controls and visible Close buttons. Import and submission errors use alert regions. The global notice and run state use polite live announcements. The submission dialog names the fixed snapshot, its commit, and local test status before copy and result recording.

## Do's and Don'ts

### Do:
- **Do** preserve the compact Bootstrap control vocabulary and platform font stacks.
- **Do** keep source, JSON, line numbers, and logs readable in monospace.
- **Do** keep the solution C editor dark with syntax colors while preserving the light utility UI.
- **Do** show written states and recovery instructions alongside color.
- **Do** keep logs, long case details, and tables within scrollable working regions.
- **Do** preserve the implemented responsive stacking and reduced-motion behavior.

### Don't:
- **Don't** introduce decorative imagery into this utility workspace.
- **Don't** replace explicit action labels with unlabeled icons.
- **Don't** present snapshot code as an editable live solution.
- **Don't** hide unsupported memory checks behind a passing status.
