#include "corelib/core_all.hpp"
namespace core {
std::string describe(const Record& r) {
    std::ostringstream os;
    os << r.name << "#" << r.id << " n=" << r.samples.size();
    if (r.tag) os << " tag=" << *r.tag;
    return os.str();
}
}  // namespace core
