#include "wb.h"
#include "solution.h"
int main(int argc, char **argv) {
    if (argc != 3) wb_fail("expected input and result paths");
    WbJson json = wb_load(argv[1]);
    int length = 0, resultSize = -1;
    int *nums = wb_int_array(&json, wb_field(&json, "nums"), &length);
    int *result = runningSum(nums, length, &resultSize);
    wb_result_array(argv[2], result, resultSize);
    if (result != nums) free(result);
    free(nums); wb_json_free(&json);
    return 0;
}
