// User-approved study example: Trees & Heaps — Q3
export const USER_Q3_NOTE_TITLE = 'Q3 · Trees & Heaps';
export const USER_Q3_NOTE_ID = 'node-trees-heaps-q3';

export const USER_Q3_MARKDOWN = `<!-- nodal-panel:sec-q3-vocab:visible -->
### Q3 词汇
- slot：槽位、位置、格子。
- arbitrary：任意指定的、普通的某一个。

<!-- nodal-panel:sec-tree-subtree:visible -->
### Tree 与 subtree
- Tree：hierarchical structure。
- Node：parent-child relationship。
- Root；Internal node：至少有一个 child；Leaf / External node：没有 child。
- ancestors；Depth：一个 node 到 root 之间的 edge 数，root depth = 0；最大 depth 对应树的 Height。
- depth 为 i 的一层最多有 2^i 个 nodes。
- descendants：从某节点向下寻找其后代。
- subset：只要求选出一些 elements。
- subtree：选定一个 root，连同它下面原有的所有 descendants 一起取出。
- 单独一个 node 可以是一棵 tree，也可以构成 subtree；整棵 tree 也可以视为自己的 subtree。
- Heap（complete + heap-order）是 Binary Tree 的一种；Binary Tree 是 Tree 的一种。

<!-- nodal-panel:sec-heap-props:visible -->
### Heap 性质与数组表示
- Complete Binary Tree property：按层从左到右填充，不能有空位。
- Heap-order property：Min-Heap / Max-Heap 的顺序要求，root 是极值。
- Heap 不要求整个数组排好序；检查 complete 的形状条件时，不看父子数值大小。
- Heap → Array：按层、从左到右排列。

<!-- nodal-panel:sec-height-index:visible -->
### 高度与索引
- Complete Binary Tree 的 height 为 O(log n)。
- 若高度 h 按 edge 数计算，n ≥ 2^h，因此 h ≤ log₂n。
- 对 0-based 数组索引 i：parent = ⌊(i−1)/2⌋，left = 2i+1，right = 2i+2。
- value = array[index]；⌊ ⌋ 表示向下取整。
- index < n 才存在；index ≥ n 不存在。
- size = n；最后一个节点索引是 n−1；下一个空槽索引是 n。

<!-- nodal-panel:sec-heap-ops:visible -->
### Heap 基本操作
- ADD：在 \`size\` 指向的 next free slot 放入新 key，\`size++\`，再 upheap 修复顺序。
- REMOVE：用末尾元素补 root，删除末尾槽位，\`size--\`，再 downheap 修复顺序。
- add/remove 的 worst case 为 O(log n)，best case 为 O(1)；search 为 O(n)。

<!-- nodal-panel:sec-java-impl:visible -->
### Java 实现

\`\`\`java
public void add(int key) {
    int i = count;
    keys[i] = key;
    count++;

    while (i > 0 && keys[(i - 1) / 2] > keys[i]) {
        int parent = (i - 1) / 2;
        int temp = keys[parent];
        keys[parent] = keys[i];
        keys[i] = temp;
        i = parent;
    }
}

public int removeMin() {
    int result = keys[0];
    keys[0] = keys[count - 1];
    count--;
    int i = 0;

    while (2 * i + 1 < count) {
        int left = 2 * i + 1;
        int right = 2 * i + 2;
        int child = left;
        if (right < count && keys[right] < keys[left]) {
            child = right;
        }
        if (keys[i] <= keys[child]) break;

        int temp = keys[i];
        keys[i] = keys[child];
        keys[child] = temp;
        i = child;
    }
    return result;
}
\`\`\`

保留代码注释所表达的要点：ADD 的新元素先放 \`count\`，交换后 \`i\` 必须更新为 parent；REMOVE 用末尾元素补 root，比较左右孩子，向下交换直到 heap-order 恢复。不要改动算法行为。

<!-- nodal-panel:sec-mistakes:visible -->
### 错题点
- \`L=2i+1\`、\`R=2i+2\` 只得到候选索引，仍须用 heap size \`n\` 检查；\`index < n\` 才存在，\`index ≥ n\` 不存在，等于 n 也越界。
- 判断 Min-Heap 不能比较数组里相邻的元素。例：\`A = [2, 5, 3, 8, 7, 4]\` 中虽然 7 后面是 4，但二者不是父子，因此不能据此判错。
- 对应树形结构：

\`\`\`text
        2
      /   \
     5     3
    / \\   /
   8   7 4
\`\`\`

- 检查父子关系：2≤5、2≤3、5≤8、5≤7、3≤4，均成立，所以 A 是有效的 Min-Heap。`;
