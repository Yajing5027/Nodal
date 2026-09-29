# Nodal

**Write it down. See how it connects. Practice recalling it.**

[English](README.md) · [简体中文](README.zh-CN.md) · [Open Nodal](https://yajing5027.github.io/Nodal/)

You can recognize an idea in your notes and still struggle to explain it in an exam, use it in a new problem, or remember it a week later. Nodal brings the parts of learning that usually live in separate places into one workspace: your notes, the relationships between ideas, and the questions you use to test your memory.

Start with a note. You can organize it into sections, see it in a knowledge map, turn parts of it into recall questions, and return to those questions over time. You do not have to copy the same explanation into a separate map, flashcard collection, and study plan.

For example, after a quiz on trees and heaps, you might write one note, give the Java implementation its own section, connect heap operations to related ideas on a map, and make a question about array indexes. When that question comes due, you practice retrieving the answer rather than rereading the entire note.

## Start with the way you actually take notes

A note can be a lecture summary, a worked problem, a concept, or a longer topic you are still figuring out. Write with headings, lists, tables, code, equations, and images. Add a short overview if you want a quick way back into the subject. You can read the finished note without the editing controls in the way, then switch back when you need to change it.

Nodal treats each note as a reusable **Node**. Your notes live in a library where you can search, sort, and browse by tag. You do not need to make a map before you can write something down.

When a note grows, divide it into **Sections**. Give them names, reorder them, add subsections, or switch to a continuous view of the full note. A section can have its own questions, guidance, review plan, and tags. If another note needs that section, insert a live reference: it shows the source section's current content without making a second copy to maintain.

## Find the same idea in more than one context

A **Map** lets you arrange existing notes and sections on a canvas, group them into frames, and draw relationships. The same note can appear in more than one map. Moving or removing it from a map changes that view, not the original note; editing the note updates what you see wherever it is used.

Tags give you another route through your material. They can form a hierarchy, and they do not confine a note to one place. Set a tag on a whole note when it applies throughout, or add one only to a particular section. For example, an Algorithms note can carry **Algorithms** everywhere while only its implementation section carries **Java**. Searching for Java can still find the note without labeling every other section as Java.

## Check what you can recall, not just what looks familiar

Pick a point worth remembering and make a question from it. Keep the question connected to its source so you can return to the surrounding explanation. In **Practice**, you can see a note's questions together and choose what to work on. **Recall** gathers questions by when they are due; **Today** gives you an entry point for the day's work.

When you review, reveal the answer and mark what actually happened: **Forgot**, **Partial**, or **Recalled**. That result is saved with the question and affects when it comes back. Questions have their own histories and schedules; a single note does not have to be treated as one all-or-nothing memory. Unreviewed material is shown as unreviewed, rather than as a failure.

You can also create **Review plans** with adaptive, fixed, or custom intervals, optionally with an end date. Assign a plan to a note, a section, or an individual question, and use **Plan** to look back over completed reviews and see what is coming up. These tools help you keep a routine; they do not claim to know your exam result or guarantee that you have mastered a topic.

## Work with AI on your own terms

Save **Guidance** for a whole note or just one section: perhaps “ask for a contrasting example” or “test the edge cases.” Export only the sections you need, choose whether to include that guidance, and add a one-time request. You can copy the result or save it as Markdown, a ZIP with images, or a printable document.

If you want an external AI to draft practice questions, Nodal can provide a prompt and accept questions in its supported import format. You choose the tool, review what it returns, and import the questions yourself. **Nodal does not send your notes to an AI service or generate questions inside the app.**

## Keep your work in your hands

[Open Nodal](https://yajing5027.github.io/Nodal/) and begin with a note. The current website saves your workspace in the browser you use. It has no account or automatic sync, and data at the public site and a local development address do not transfer automatically. Download a **full backup** from **Data & backup** regularly, especially before clearing browser data or moving to another browser or device. Importing a backup replaces the workspace at the destination.

A new workspace opens with notes on mathematics, trees and heaps, and computer architecture, plus a small map and questions at different stages of review. You can edit or delete any of this material. What you write stays in that browser unless you choose to export it. Browser storage is how this version works today; it is not a promise that Nodal will always be limited to one device.

<details>
<summary>Run the website on your own computer</summary>

With a current Node.js LTS release and npm:

    npm ci
    npm run dev

</details>
