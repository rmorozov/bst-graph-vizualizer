#include "corelib/core_all.hpp"
namespace core {
Id hash_name(const std::string& name) {
    Id h = 1469598103934665603ull;
    for (unsigned char c : name) { h ^= c; h *= 1099511628211ull; }
    return h;
}
}  // namespace core
