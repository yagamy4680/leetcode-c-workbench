#ifndef WB_TREE_H
#define WB_TREE_H
#include "wb.h"
#include "wb_tree_types.h"
/* Input nodes belong to the driver; this registry survives link mutation. */
typedef struct { struct TreeNode *root; struct TreeNode **nodes; int count; } WbTree;
static inline WbTree wb_tree(const WbJson *json, int token) {
    WbTree tree = {0};
    if (wb_null(json, token)) return tree;
    int count = wb_array_count(json, token);
    if (!count) return tree;
    tree.nodes = wb_alloc((size_t)count, sizeof(*tree.nodes));
    int child = token + 1;
    if (wb_null(json, child)) {
        for (int i = 1; i < count; ++i) if (!wb_null(json, ++child)) wb_fail("nodes after null root");
        return tree;
    }
    tree.root = wb_alloc(1, sizeof(*tree.root)); tree.root->val = wb_int(json, child++);
    tree.nodes[tree.count++] = tree.root;
    int parent = 0, used = 1;
    while (used < count && parent < tree.count) {
        struct TreeNode *node = tree.nodes[parent++];
        for (int side = 0; side < 2 && used < count; ++side, ++used, ++child) {
            if (wb_null(json, child)) continue;
            struct TreeNode *next = wb_alloc(1, sizeof(*next)); next->val = wb_int(json, child);
            if (side) node->right = next; else node->left = next;
            tree.nodes[tree.count++] = next;
        }
    }
    while (used++ < count) if (!wb_null(json, child++)) wb_fail("unreachable tree node");
    return tree;
}
static inline void wb_tree_free(WbTree *tree) {
    for (int i = 0; i < tree->count; ++i) free(tree->nodes[i]);
    free(tree->nodes);
}
#endif
