import { db } from '../db/database';
import type { KnowledgeNode } from '../domain/types';
import { USER_Q3_MARKDOWN, USER_Q3_NOTE_ID, USER_Q3_NOTE_TITLE } from '../examples/q3Note';

const STARTER_NOTES_KEY = 'starter-notes-v2';
export const ARCHITECTURE_NOTE_ID = 'node-computer-architecture-study-notes';
export const ARCHITECTURE_NOTE_TITLE = 'Q1 · Computer Architecture & Number Representation';

export const ARCHITECTURE_MARKDOWN = [
  '<!-- nodal-panel:sec-system-architecture:visible -->',
  '## System Architecture',
  '### Von Neumann',
  '- One address space for instructions and data.',
  '- One shared path creates the **Von Neumann bottleneck**.',
  '- Components: Memory, Control Unit, ALU, Input, Output.',
  '- Fetch → Decode → Execute → Advance → Repeat.',
  '',
  '### Harvard',
  '- Two address spaces: one for instructions and one for data.',
  '- Separate paths allow instruction fetch and data access at the same time.',
  '- **Modified Harvard:** L1 instruction and data caches are separate; L2, L3, and DRAM are shared.',
  '',
  '<!-- nodal-panel:sec-performance:visible -->',
  '## Performance',
  '- **Latency** = time per operation.',
  '- **Throughput** = completed operations per unit of time.',
  '- **Bandwidth** = bytes transferred per unit of time.',
  '- Register < L1 cache < main memory in access time; a cache miss can increase CPI.',
  '',
  '$$\\text{Total Cycles}=\\text{Instruction Count}\\times\\text{CPI}$$',
  '$$\\text{CPU Time}=\\frac{\\text{Total Cycles}}{\\text{Clock Rate}}=\\text{Instruction Count}\\times\\text{CPI}\\times\\text{Clock Period}$$',
  '$$\\text{Clock Period}=\\frac{1}{\\text{Clock Rate}}$$',
  '',
  '- 1 GHz = 10⁹ cycles/second.',
  '- Instruction Count depends on the algorithm and compiler.',
  '- CPI depends on the microarchitecture.',
  '- Clock Period depends on the fabrication process and physics.',
  '- A higher clock rate does not always mean a faster program.',
  '',
  '<!-- nodal-panel:sec-binary-hex:visible -->',
  '## Binary & Hex',
  '- 1 hexadecimal digit = 4 bits = 1 nibble.',
  '- 2 hexadecimal digits = 8 bits = 1 byte.',
  '- Convert binary and hexadecimal by grouping bits in fours.',
  '- Powers of two: 2⁰=1, 2¹=2, 2²=4, 2³=8, 2⁴=16, 2⁵=32, 2⁶=64, 2⁷=128, 2⁸=256, 2⁹=512, 2¹⁰=1024, 2¹¹=2048, 2¹²=4096.',
  '- Hexadecimal digits: 10=A, 11=B, 12=C, 13=D, 14=E, 15=F.',
  '',
  '<!-- nodal-panel:sec-integer-representation:visible -->',
  '## Integer Representation',
  'N bits provide $2^N$ patterns.',
  '',
  '### Unsigned',
  '$$0 \\leq x \\leq 2^N-1$$',
  '',
  "### Signed / Two's Complement",
  '$$-2^{N-1} \\leq x \\leq 2^{N-1}-1$$',
  '- The most significant bit has weight $-2^{N-1}$.',
  '- Example: 1101 = −8 + 4 + 1 = −3.',
  '- Negation: flip all bits, then add 1.',
  '- To reverse from a negative representation: subtract 1, then flip all bits.',
  '',
  '### Overflow',
  '- Unsigned overflow is indicated by a carry out.',
  '- Signed overflow occurs when the carry into the sign bit differs from the carry out.',
  '- Adding two positive numbers and getting a negative, or two negative numbers and getting a positive, indicates signed overflow.',
  '',
  '<!-- nodal-panel:sec-ieee-754:visible -->',
  '## IEEE 754 Floating Point',
  '### Half Precision',
  '- 16 bits = 1 sign bit + 5 exponent bits + 10 fraction bits.',
  '- Sign: 0 means positive; 1 means negative.',
  '- Exponent bias = 15.',
  '- For normalized values, the significand is the stored fraction after an implicit leading 1.',
  '',
  '$$\\text{Value}=(-1)^S\\times 1.F\\times 2^{E-15}$$',
  '',
  '- Normalization example: $1100.11_2 = 1.10011_2 \\times 2^3$.',
  '- Move the binary point left: exponent increases; move it right: exponent decreases.',
  '- Stored exponent = real exponent + bias; for half precision, $E=e+15$.',
  '- Binary fractional places have weights $2^{-1}, 2^{-2}, 2^{-3}, \\ldots$.',
  '$$.11_2=\\frac{1}{2}+\\frac{1}{4}=\\frac{3}{4}=0.75$$',
].join('\n');

/**
 * Add the two user-approved study examples to a new workspace. The previously
 * seeded Q3 also receives the Architecture example. Existing content and tags
 * are preserved; older example titles are updated without changing their body.
 */
export async function ensureStarterNotes(): Promise<void> {
  await db.transaction('rw', [db.nodes, db.meta], async () => {
    if (await db.meta.get(STARTER_NOTES_KEY)) return;
    const existing = await db.nodes.toArray();
    const existingQ3 = existing.find(note => note.id === USER_Q3_NOTE_ID);
    const existingArchitecture = existing.find(note => note.id === ARCHITECTURE_NOTE_ID);
    const timestamp = Date.now();
    if (existingQ3?.title === 'Trees & Heaps — Q3') {
      await db.nodes.update(existingQ3.id, { title: USER_Q3_NOTE_TITLE, updatedAt: timestamp });
    }
    if (existingArchitecture?.title === 'Computer Architecture') {
      await db.nodes.update(existingArchitecture.id, { title: ARCHITECTURE_NOTE_TITLE, updatedAt: timestamp });
    }
    const notes: KnowledgeNode[] = [];
    if (existing.length === 0) {
      notes.push({
        id: USER_Q3_NOTE_ID,
        title: USER_Q3_NOTE_TITLE,
        contentMarkdown: USER_Q3_MARKDOWN,
        tagIds: ['tag-cs-algorithms'],
        sectionTagIds: {
          'sec-java-impl': ['tag-cs-java'],
          'sec-mistakes': ['tag-cs-java'],
        },
        assetIds: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
    if (existing.length === 0 || (existingQ3 && !existingArchitecture)) {
      notes.push({
        id: ARCHITECTURE_NOTE_ID,
        title: ARCHITECTURE_NOTE_TITLE,
        contentMarkdown: ARCHITECTURE_MARKDOWN,
        tagIds: ['tag-cs-arch'],
        assetIds: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
    if (notes.length > 0) await db.nodes.bulkAdd(notes);
    await db.meta.put({ key: STARTER_NOTES_KEY, value: true });
  });
}
