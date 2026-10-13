#include "wb_tree.h"
#include "solution.h"

int main(int argc, char **argv) {
    if (argc != 3) wb_fail("expected input and result paths");
    WbJson json = wb_load(argv[1]);
    WbTree tree = wb_tree(&json, wb_field(&json, "root"));
    int resultSize = -1;
    int *result = inorderTraversal(tree.root, &resultSize);
    wb_result_array(argv[2], result, resultSize);
    free(result);
    wb_tree_free(&tree);
    wb_json_free(&json);
    return 0;
}
