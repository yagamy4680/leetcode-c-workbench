#ifndef WB_DEBUG_PREAMBLE
#define WB_DEBUG_PREAMBLE
#include <stdio.h>

#ifdef DEBUG
#define DBG(fmt, ...) \
    do { \
        fprintf(stderr, "%s:%d:%s() " fmt, __FILE__, __LINE__, __func__, ##__VA_ARGS__); \
    } while (0)
#else
#define DBG(fmt, ...) do { } while (0)
#endif
#endif

