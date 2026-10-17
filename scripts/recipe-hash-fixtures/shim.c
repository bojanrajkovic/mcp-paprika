#include "shim.h"
typedef void *(*swift_self_getter)(void *selfObj __attribute__((swift_context)))
    __attribute__((swiftcall));
void *call_swift_self_getter(void *fn, void *selfObj) {
    swift_self_getter g = (swift_self_getter)fn;
    return g(selfObj);
}
