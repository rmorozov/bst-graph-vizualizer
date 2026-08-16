#include "netlib/protocol.hpp"
// PATHOLOGY (macro level): netlib links and includes mathlib, but nothing in
// netlib actually calls a mathlib symbol. This false dependency serialises
// netlib behind mathlib in the build graph for no reason.
#include "mathlib/linalg.hpp"
namespace net {
std::string encode(const core::Record& r) { return core::describe(r); }
core::Record decode(const std::string& s) { core::Record r; r.name = s; r.id = core::hash_name(s); return r; }
}
