#include "wb_tree.h"
#include "solution.h"
int main(int argc, char **argv) {
    if (argc != 3) wb_fail("expected input and result paths");
    WbJson json = wb_load(argv[1]);
    WbTree tree = wb_tree(&json, wb_field(&json, "root"));
    int result = minDiffInBST(tree.root);
    wb_result_int(argv[2], result);
    wb_tree_free(&tree); wb_json_free(&json);
    return 0;
}
