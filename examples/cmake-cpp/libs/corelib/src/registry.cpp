#include "corelib/core_all.hpp"
#include "corelib/generated_tables.hpp"
namespace core {
namespace {
std::unordered_map<std::string, Id>& registry() {
    static std::unordered_map<std::string, Id> r;
    return r;
}
}  // namespace
Id register_name(const std::string& n) { return registry()[n] = hash_name(n) ^ kTableSalt; }
}  // namespace core
