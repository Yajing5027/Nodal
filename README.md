# Nodal

**Write it down. See how it connects. Practice recalling it.**

[English](README.md) · [简体中文](README.zh-CN.md) · [Open Nodal](https://yajing5027.github.io/Nodal/)

You can recognize an idea in your notes and still struggle to explain it in an exam, use it in a new problem, or remember it a week later. Nodal brings the parts of learning that usually live in separate places into one workspace: your notes, the relationships between ideas, and the questions you use to test your memory.

Start with a note. You can organize it into sections, see it in a knowledge map, turn parts of it into recall questions, and return to those questions over time. You do not have to copy the same explanation into a separate map, flashcard collection, and study plan.

For example, after a quiz on trees and heaps, you might write one note, give the Java implementation its own section, connect heap operations to related ideas on a map, and make a question about array indexes. When that question comes due, you practice retrieving the answer rather than rereading the entire note.

## Start with the way you actually take notes

A note can be a lecture summary, a worked problem, a concept, or a longer topic you are still figuring out. Write with headings, lists, tables, code, equations, and images. Add a short overview if you want a quick way back into the subject. You can read the finished note without the editing controls in the way, then switch back when you need to change it.

Your notes live in a library where you can search, sort, and browse by tag. You do not need to make a map before you can write something down.

When a note grows, divide it into **Sections**. Each section is an independent piece of knowledge—what Nodal calls a **Node**—even if you usually create and edit it inside a note. Give sections names, reorder or move them, add subsections, or switch to a continuous view of the full note. A section can have its own questions, guidance, review plan, and tags. If another note needs that section, insert a live reference: it shows the source section's current content without making a second copy to maintain.

## Find the same idea in more than one context

A **Map** lets you arrange existing notes and sections on a canvas, group them into frames, and draw relationships. The same note can appear in more than one map. Moving or removing it from a map changes that view, not the original note; editing the note updates what you see wherever it is used.

Tags give you another route through your material. They can form a hierarchy, and they do not confine a note to one place. Set a tag on a whole note when it applies throughout, or add one only to a particular section. For example, an Algorithms note can carry **Algorithms** everywhere while only its implementation section carries **Java**. Searching for Java can still find the note without labeling every other section as Java. Link contest notes to the contest in **Events**, and use subject tags under **Math** for individual problems. A technique used once can stay in the problem explanation instead of becoming another tag.

## Check what you can recall, not just what looks familiar

Pick a point worth remembering and make a question from it. Keep the question connected to its source so you can return to the surrounding explanation. For a worked problem, see the problem first, try it, then reveal its solution. Practice can feel like turning over a card. You can also use multiple-choice questions, fill-in-the-blank clozes, and hidden passages. In **Practice**, you can see a note's questions together and choose what to work on. **Recall** gathers questions by when they are due; **Today** gives you an entry point for the day's work.

**Preparing questions does not start scheduled learning.** Read and practice at your own pace, then choose **Start learning** for the questions you want to bring into your review routine. Creating, importing, editing, or revealing a question does not by itself record a grade.

In a note’s **Practice** tab, use **Add question** or **Edit** to write rich questions and answers with the same Markdown editor as notes. Questions appear as a flat list, with source Sections as filterable, clickable labels. A question can link to several Sections across notes through Add source link; JSON import remains available. Opening a question in **Recall** previews the question and its answer. **View source** opens the original Note or Section, and closing it returns to the question. Editing preserves the question ID and review progress.

When you review, reveal the answer and mark what actually happened: **Forgot**, **Partial**, or **Recalled**. That result is saved with the question and affects when it comes back. Questions have their own histories and schedules; a single note does not have to be treated as one all-or-nothing memory. Unreviewed material is shown as unreviewed, rather than as a failure.

You can also create **Review plans** with adaptive, fixed, or custom intervals, optionally with an end date. Assign a plan to a note, a section, or an individual question, and use **Plan** to look back over completed reviews and see what is coming up. These tools help you keep a routine; they do not claim to know your exam result or guarantee that you have mastered a topic.

Before starting learning or review, confirm each question's effective plan or apply a plan to the selected questions. **Card settings** shows the inherited or individual plan, its parameters, review history, and upcoming dates. Later dates are estimates assuming successful Recalled answers; your actual answers can change them. **Manage cards** in Review plans adds or removes individual assignments. Removing one restores the inherited plan or default Adaptive (FSRS), preserving the question and its review history. Editing a plan's parameters affects every question using that plan.

Every linked note shows the same question under **All**, including questions already in review. **Pending** includes only questions whose learning has not started. Shared review history contributes to mastery in every linked Note and Section.

For the Heuer contest, linked competition questions receive **Heuer Contest Prep · Math**, using the contest date in Events. Ratings schedule the next review no earlier than the next local calendar day. Remembered questions gradually get longer intervals, with a final check before the contest; the preparation queue stops after the Event. Assigning the plan preserves history and does not start unstarted questions.

## Keep important dates in view

Create an **Event** for a contest, exam, or weekly quiz. Set a date or repeating weekday, link the relevant notes, and choose whether it appears on Today. Coming up sorts those dates and shows an optional, compact days-remaining number. An event organizes a date; it does not start reviewing its linked questions for you.

## Work with AI on your own terms

Save **Guidance** for a whole note or just one section: perhaps “ask for a contrasting example” or “test the edge cases.” Export only the sections you need, choose whether to include that guidance, and add a one-time request. You can copy the result or save it as Markdown, a ZIP with images, or a printable document.

If you want an external AI to draft practice questions, Nodal can provide a prompt and accept questions in its supported import format. You choose the tool, review what it returns, and import the questions yourself. **Nodal does not send your notes to an AI service or generate questions inside the app.**

## Keep your work in your hands

[Open Nodal](https://yajing5027.github.io/Nodal/) and begin with a note. The current website saves your workspace in the browser you use. It has no account or automatic sync, and data at the public site and a local development address do not transfer automatically. Download a **full backup** from **Data & backup** regularly, especially before clearing browser data or moving to another browser or device. Importing a backup replaces the workspace at the destination.

A new workspace includes the two course quiz notes and the Jerry Heuer contest archive, with practice questions you can try. You can edit or delete that material. What you write stays in that browser unless you choose to export it. Browser storage is how this version works today; it is not a promise that Nodal will always be limited to one device.

**Study progress** shows a dated, read-only snapshot of the owner’s notes, maps and per-question progress. Updating it is a deliberate publication step, separate from your own workspace. A full backup includes a public snapshot alongside private study data; exporting never resets progress.

Optional **Research recording** keeps a separate history of content changes, question presentations, answer reveals and completed reviews, including precise review timestamps and scheduling context. Those records are kept in full backups, including after deleting a note or restoring an older backup. Raw answers and the research journal are not part of the public study snapshot.
