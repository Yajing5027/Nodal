function e(e){let t=e.trim(),n=t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i),r=n?n[1].trim():t;return JSON.parse(r)}function t(t,n){let r=[],i;if(typeof t==`string`)try{i=e(t)}catch(e){return{valid:!1,errors:[`Invalid JSON: ${e instanceof Error?e.message:String(e)}`]}}else i=t;if(!i||typeof i!=`object`||Array.isArray(i))return{valid:!1,errors:[`Expected root JSON object.`]};if(i.schemaVersion!==`nodal.practice.v1`&&r.push(`Invalid schemaVersion: expected "nodal.practice.v1", got "${i.schemaVersion}"`),!i.noteId||typeof i.noteId!=`string`?r.push(`Missing or invalid "noteId" field (must be non-empty string).`):n&&i.noteId!==n&&r.push(`Target noteId mismatch: package has "${i.noteId}", expected "${n}".`),typeof i.sourceRevision!=`string`&&r.push(`Missing "sourceRevision" field (must be string).`),!Array.isArray(i.cards)||i.cards.length===0)return r.push(`Missing or empty "cards" array.`),{valid:!1,errors:r};let a=new Set;return i.cards.forEach((e,t)=>{let n=`Card #${t+1} (${e.id??`unnamed`})`;if(!e||typeof e!=`object`){r.push(`${n}: must be an object.`);return}if(!e.id||typeof e.id!=`string`?r.push(`${n}: missing or invalid "id".`):(a.has(e.id)&&r.push(`${n}: duplicate card id "${e.id}".`),a.add(e.id)),e.sectionId!==null&&typeof e.sectionId!=`string`&&r.push(`${n}: "sectionId" must be null or string.`),![`flashcard`,`choice`,`cloze`].includes(e.type)){r.push(`${n}: invalid type "${e.type}". Must be "flashcard", "choice", or "cloze".`);return}if(e.type===`flashcard`)(!e.frontMarkdown||typeof e.frontMarkdown!=`string`||!e.frontMarkdown.trim())&&r.push(`${n}: flashcard missing "frontMarkdown".`),(!e.backMarkdown||typeof e.backMarkdown!=`string`||!e.backMarkdown.trim())&&r.push(`${n}: flashcard missing "backMarkdown".`);else if(e.type===`choice`){if((!e.frontMarkdown||typeof e.frontMarkdown!=`string`||!e.frontMarkdown.trim())&&r.push(`${n}: choice question missing "frontMarkdown".`),!Array.isArray(e.options)||e.options.length<2)r.push(`${n}: choice question must have at least 2 options in "options" array.`);else{let t=new Set;e.options.forEach((e,i)=>{if(!e||typeof e!=`object`){r.push(`${n} option #${i+1}: must be an object.`);return}!e.id||typeof e.id!=`string`?r.push(`${n} option #${i+1}: missing option "id".`):t.add(e.id),(!e.textMarkdown||typeof e.textMarkdown!=`string`||!e.textMarkdown.trim())&&r.push(`${n} option #${i+1}: missing "textMarkdown".`)}),(!e.correctOptionId||!t.has(e.correctOptionId))&&r.push(`${n}: "correctOptionId" ("${e.correctOptionId}") must match an existing option id.`)}}else e.type===`cloze`&&(!e.promptMarkdown||typeof e.promptMarkdown!=`string`||!e.promptMarkdown.trim()?r.push(`${n}: cloze missing "promptMarkdown".`):e.promptMarkdown.includes(`{{blank:`)||r.push(`${n}: cloze "promptMarkdown" must contain at least one "{{blank:ID}}" placeholder.`),!Array.isArray(e.blanks)||e.blanks.length===0?r.push(`${n}: cloze must have at least one blank in "blanks" array.`):e.blanks.forEach((t,i)=>{if(!t||typeof t!=`object`){r.push(`${n} blank #${i+1}: must be an object.`);return}!t.id||typeof t.id!=`string`?r.push(`${n} blank #${i+1}: missing "id".`):e.promptMarkdown&&!e.promptMarkdown.includes(`{{blank:${t.id}}}`)&&r.push(`${n}: blank id "${t.id}" not found in promptMarkdown as "{{blank:${t.id}}}".`),(!t.answerMarkdown||typeof t.answerMarkdown!=`string`||!t.answerMarkdown.trim())&&r.push(`${n} blank #${i+1}: missing "answerMarkdown".`)}))}),{valid:r.length===0,package:r.length===0?i:void 0,errors:r}}function n(e,t,n){let r=e.aiGuidance?.note?`\n[Note-Level Guidance]:\n${e.aiGuidance.note}`:``,i=t,a=``;if(n?.targetSectionId&&n.targetSectionId!==`all`){if(n.targetSectionId===`global`)a=`
Scope constraint: Generate questions covering the overall concepts across the whole note ("sectionId": null).
`;else{let e=t.find(e=>e.id===n.targetSectionId);e&&(i=[e],a=`\nScope constraint: Focus specifically on section "${e.id}". Set "sectionId": "${e.id}" on generated cards.\n`)}}let o=i.map((t,n)=>{let r=e.aiGuidance?.sections?.[t.id]?`\n  Guidance: ${e.aiGuidance.sections[t.id]}`:``;return`### Section ID: "${t.id}" (Section ${n+1})\n${t.markdown}${r}`}).join(`

`),s=n?.questionCount&&n.questionCount>0?`Produce exactly ${n.questionCount} practice items in total.`:`Produce a balanced set of practice items:`;return`You are generating retrieval practice questions for the note titled "${e.title||`Untitled Note`}".
Target noteId: "${e.id}"
Source revision: "${e.updatedAt||Date.now()}"
${a}
${r}

Source Content:
${o}

Instructions:
1. Output ONLY a single JSON object conforming to the "nodal.practice.v1" schema.
2. ${s}
   - "flashcard": conceptual recall questions (frontMarkdown & backMarkdown).
   - "choice": multiple choice questions with at least 2 options, correctOptionId (or correctOptionIds array for multi-select), and explanationMarkdown.
   - "cloze": fill-in-the-blank statements with {{blank:ID}} markers and matching blanks array.
3. Every card must have a unique "id".
4. If a card covers the whole note, set "sectionId": null.
   If a card tests a specific section, set "sectionId" to the exact section ID quoted above.
5. All markdown must be valid UTF-8 strings. Do not invent timestamps, review intervals, or FSRS states.

Output JSON schema structure:
{
  "schemaVersion": "nodal.practice.v1",
  "noteId": "${e.id}",
  "sourceRevision": "${e.updatedAt||Date.now()}",
  "cards": [
    {
      "id": "q1",
      "sectionId": null,
      "type": "flashcard",
      "frontMarkdown": "...",
      "backMarkdown": "..."
    },
    {
      "id": "q2",
      "sectionId": "${t[0]?.id??`sec-1`}",
      "type": "choice",
      "frontMarkdown": "...",
      "options": [
        { "id": "a", "textMarkdown": "..." },
        { "id": "b", "textMarkdown": "..." }
      ],
      "correctOptionId": "a",
      "explanationMarkdown": "..."
    },
    {
      "id": "q3",
      "sectionId": "${t[0]?.id??`sec-1`}",
      "type": "cloze",
      "promptMarkdown": "In a 0-indexed heap, the left child is at {{blank:b1}}.",
      "blanks": [
        { "id": "b1", "answerMarkdown": "2i + 1" }
      ],
      "explanationMarkdown": "..."
    }
  ]
}`}export{t as n,n as t};