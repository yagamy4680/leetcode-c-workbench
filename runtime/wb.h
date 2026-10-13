#ifndef WB_H
#define WB_H
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#ifndef WB_JSON_IMPLEMENTATION
#define JSMN_HEADER
#endif
#include "vendor/jsmn.h"
#undef JSMN_HEADER
typedef struct { char *text; jsmntok_t *tokens; int count; } WbJson;
void wb_fail(const char *message);
void *wb_alloc(size_t count, size_t size);
WbJson wb_load(const char *filename);
void wb_json_free(WbJson *json);
int wb_skip(const WbJson *json, int token);
int wb_field(const WbJson *json, const char *name);
bool wb_null(const WbJson *json, int token);
int wb_int(const WbJson *json, int token);
int *wb_int_array(const WbJson *json, int token, int *length);
int wb_array_count(const WbJson *json, int token);
void wb_result_int(const char *filename, int value);
void wb_result_array(const char *filename, const int *values, int length);
#endif
