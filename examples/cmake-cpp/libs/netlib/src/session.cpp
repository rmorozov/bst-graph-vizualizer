#include "netlib/protocol.hpp"
namespace net {
struct Session { core::Id id; std::string peer; };
std::string greet(const Session& s) { return "hello " + s.peer; }
}
