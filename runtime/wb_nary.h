#ifndef WB_NARY_H
#define WB_NARY_H
#include "wb.h"
#include "wb_nary_types.h"
typedef struct { struct Node *root; struct Node **nodes; int count; } WbNary;
static inline WbNary wb_nary(const WbJson *json, int token) {
    WbNary tree = {0};
    if (wb_null(json, token)) return tree;
    int count = wb_array_count(json, token);
    if (!count) return tree;
    tree.nodes = wb_alloc((size_t)count, sizeof(*tree.nodes));
    int child = token + 1;
    if (wb_null(json, child)) { if (count != 1) wb_fail("nodes after null N-ary root"); return tree; }
    tree.root = wb_alloc(1, sizeof(*tree.root)); tree.root->val = wb_int(json, child++);
    tree.nodes[tree.count++] = tree.root;
    if (count == 1) return tree;
    if (!wb_null(json, child++)) wb_fail("N-ary root must be followed by null separator");
    int used = 2, parent = 0;
    while (used < count && parent < tree.count) {
        struct Node *node = tree.nodes[parent++];
        int begin = child, n = 0;
        while (used < count && !wb_null(json, child)) { ++n; ++child; ++used; }
        node->numChildren = n;
        if (n) node->children = wb_alloc((size_t)n, sizeof(*node->children));
        for (int i = 0; i < n; ++i) {
            struct Node *next = wb_alloc(1, sizeof(*next)); next->val = wb_int(json, begin + i);
            node->children[i] = next; tree.nodes[tree.count++] = next;
        }
        if (used < count) { ++child; ++used; }
    }
    if (used != count) wb_fail("unreachable N-ary child group");
    return tree;
}
static inline void wb_nary_free(WbNary *tree) {
    for (int i = 0; i < tree->count; ++i) { free(tree->nodes[i]->children); free(tree->nodes[i]); }
    free(tree->nodes);
}
#endif
