#include "netlib/protocol.hpp"
#include "mathlib/stats.hpp"
#include "utillib/strings.hpp"
int main() {
    core::Record r{core::hash_name("demo"), "demo", {1.0, 2.0, 3.0}, std::nullopt};
    std::cout << net::encode(r) << " mean=" << math::mean(r.samples)
              << " " << util::join({"a", "b"}, "-") << "\n";
    return 0;
}
