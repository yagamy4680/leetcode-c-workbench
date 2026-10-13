#define WB_JSON_IMPLEMENTATION
#include "wb.h"
#include <errno.h>
#include <limits.h>
#include <stdint.h>
#include <string.h>

void wb_fail(const char *message) { fprintf(stderr, "Driver error: %s\n", message); exit(70); }
void *wb_alloc(size_t count, size_t size) {
    if (size && count > SIZE_MAX / size) wb_fail("allocation size overflow");
    void *p = calloc(count ? count : 1, size ? size : 1);
    if (!p) wb_fail("allocation failed");
    return p;
}
WbJson wb_load(const char *filename) {
    setvbuf(stdout, NULL, _IONBF, 0);
    setvbuf(stderr, NULL, _IONBF, 0);
    FILE *file = fopen(filename, "rb");
    if (!file) wb_fail("cannot open input");
    if (fseek(file, 0, SEEK_END)) wb_fail("cannot seek input");
    long size = ftell(file);
    if (size < 0 || size > 8 * 1024 * 1024) wb_fail("invalid input size");
    rewind(file);
    WbJson json = {0};
    json.text = wb_alloc((size_t)size + 1, 1);
    if (fread(json.text, 1, (size_t)size, file) != (size_t)size) wb_fail("cannot read input");
    fclose(file);
    int capacity = 128;
    for (;;) {
        json.tokens = wb_alloc((size_t)capacity, sizeof(jsmntok_t));
        jsmn_parser parser; jsmn_init(&parser);
        json.count = jsmn_parse(&parser, json.text, (size_t)size, json.tokens, (unsigned int)capacity);
        if (json.count != JSMN_ERROR_NOMEM) break;
        free(json.tokens);
        if (capacity > 1048576) wb_fail("too many JSON tokens");
        capacity *= 2;
    }
    if (json.count < 1 || json.tokens[0].type != JSMN_OBJECT) wb_fail("input must be a JSON object");
    return json;
}
void wb_json_free(WbJson *json) { free(json->text); free(json->tokens); memset(json, 0, sizeof(*json)); }
int wb_skip(const WbJson *json, int token) {
    if (token < 0 || token >= json->count) wb_fail("invalid JSON token");
    int end = json->tokens[token].end;
    int next = token + 1;
    while (next < json->count && json->tokens[next].start < end) ++next;
    return next;
}
int wb_field(const WbJson *json, const char *name) {
    int token = 1;
    while (token < json->count && json->tokens[token].start < json->tokens[0].end) {
        const jsmntok_t *key = &json->tokens[token];
        if (key->type != JSMN_STRING || token + 1 >= json->count) wb_fail("invalid object field");
        if ((size_t)(key->end - key->start) == strlen(name) && !strncmp(json->text + key->start, name, strlen(name))) return token + 1;
        token = wb_skip(json, token + 1);
    }
    wb_fail("required input field missing");
    return -1;
}
bool wb_null(const WbJson *json, int token) {
    if (token < 0 || token >= json->count) wb_fail("invalid JSON token");
    jsmntok_t t = json->tokens[token];
    return t.type == JSMN_PRIMITIVE && t.end - t.start == 4 && !strncmp(json->text + t.start, "null", 4);
}
int wb_int(const WbJson *json, int token) {
    if (token < 0 || token >= json->count) wb_fail("invalid integer token");
    jsmntok_t t = json->tokens[token];
    if (t.type != JSMN_PRIMITIVE || t.end - t.start > 20 || t.end <= t.start) wb_fail("expected integer");
    char buffer[32] = {0}; memcpy(buffer, json->text + t.start, (size_t)(t.end - t.start));
    char *end; errno = 0;
    long value = strtol(buffer, &end, 10);
    if (errno || *end || value < INT_MIN || value > INT_MAX) wb_fail("integer out of range or invalid");
    return (int)value;
}
int wb_array_count(const WbJson *json, int token) {
    if (token < 0 || token >= json->count || json->tokens[token].type != JSMN_ARRAY) wb_fail("expected array");
    int count = 0;
    for (int child = token + 1; child < json->count && json->tokens[child].start < json->tokens[token].end; child = wb_skip(json, child)) ++count;
    return count;
}
int *wb_int_array(const WbJson *json, int token, int *length) {
    *length = wb_array_count(json, token);
    int *values = wb_alloc((size_t)*length, sizeof(int));
    int child = token + 1;
    for (int i = 0; i < *length; ++i) { values[i] = wb_int(json, child); child = wb_skip(json, child); }
    return values;
}
void wb_result_int(const char *filename, int value) {
    FILE *file = fopen(filename, "w"); if (!file) wb_fail("cannot open result file");
    fprintf(file, "%d\n", value); if (fclose(file)) wb_fail("cannot write result");
}
void wb_result_array(const char *filename, const int *values, int length) {
    if (length < 0 || length > 1000000 || (length && !values)) wb_fail("invalid returnSize or NULL result");
    FILE *file = fopen(filename, "w"); if (!file) wb_fail("cannot open result file");
    fputc('[', file);
    for (int i = 0; i < length; ++i) { if (i) fputc(',', file); fprintf(file, "%d", values[i]); }
    fputs("]\n", file); if (fclose(file)) wb_fail("cannot write result");
}
