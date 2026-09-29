# Nodal

Nodal is a local-first workspace for learning from your own notes. Write a
note once, break it into addressable sections, connect ideas on visual maps,
and revisit them through recall cards and review plans. Notes remain yours in
the browser; there is no account, server-side notebook, or cloud sync.

## What you can do

- **Write and organize notes.** Use Markdown, math, images, sections, and
  section references. A note can appear in multiple maps without making
  duplicate copies of its content.
- **Classify at two levels.** Whole-note tags apply to every section. A
  section can also carry its own tags without assigning them to the rest of
  the note. Hierarchical tags help browse and search your knowledge.
- **Build knowledge maps.** Arrange notes in visual maps, group them in
  frames, and draw relationships. Removing a note from a map does not delete
  the underlying note.
- **Practice recall.** Turn material into questions and cloze cards, review
  them with a spaced-repetition schedule, and use plans to choose what to
  study. Section mastery and card review are separate measures.
- **Move your data.** Export a full versioned ZIP backup, restore one, and
  export readable note or map content. The app can also archive current
  workspace content locally for a fresh start.
- **Prepare an AI handoff.** Copy selected note content and guidance as a
  prompt for an AI tool you choose. Nodal itself does not send it to an AI
  service.

## Try it

Open **[Nodal on GitHub Pages](https://yajing5027.github.io/Nodal/)**, then
create a note or map. The public site starts without your private study
content. Use **Data & backup → Export full backup** regularly.

Browser storage belongs to the exact website address. Data saved at a local
development address such as `localhost:5173` does **not** automatically appear
on GitHub Pages. To move it, export a backup locally and import it on the
published site. Clearing site data or using a different browser can remove or
hide the working copy, so keep downloaded backups somewhere you control.

## Run locally

Requires a current Node.js LTS release and npm.

```bash
npm ci
npm run dev
```

Use `npm run build` to create the static site in `dist/`. The Pages deployment
workflow builds that same output on every push to `main`.

## How it works

Nodal uses React, TypeScript, Vite, Dexie/IndexedDB, and React Flow. A note's
Markdown is the canonical content. Maps hold placements and links to notes,
not copies of their text. Review history and scheduling state are stored
locally and included in the portable backup. There is no server database,
login, collaboration, or automatic synchronization.

This repository contains only the publishable app source and deployment
configuration. Personal notes and local browser data are not part of the site.
