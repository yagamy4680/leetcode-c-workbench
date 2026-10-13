#ifndef WB_LIST_H
#define WB_LIST_H
#include "wb.h"
#include "wb_list_types.h"
typedef struct { struct ListNode *head; struct ListNode **nodes; int count; } WbList;
static inline WbList wb_list(const WbJson *json, int token) {
    WbList list = {0};
    int *values = wb_int_array(json, token, &list.count);
    list.nodes = wb_alloc((size_t)list.count, sizeof(*list.nodes));
    for (int i = 0; i < list.count; ++i) {
        list.nodes[i] = wb_alloc(1, sizeof(*list.nodes[i])); list.nodes[i]->val = values[i];
        if (i) list.nodes[i - 1]->next = list.nodes[i]; else list.head = list.nodes[i];
    }
    free(values); return list;
}
static inline void wb_list_free(WbList *list) {
    for (int i = 0; i < list->count; ++i) free(list->nodes[i]);
    free(list->nodes);
}
#endif
