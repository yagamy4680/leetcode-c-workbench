#include "wb_nary.h"
#include "solution.h"
int main(int argc, char **argv) {
    if (argc != 3) wb_fail("expected input and result paths");
    WbJson json = wb_load(argv[1]);
    WbNary tree = wb_nary(&json, wb_field(&json, "root"));
    int resultSize = -1;
    int *result = preorder(tree.root, &resultSize);
    wb_result_array(argv[2], result, resultSize);
    free(result); wb_nary_free(&tree); wb_json_free(&json);
    return 0;
}
