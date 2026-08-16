#include "utillib/strings.hpp"
namespace app {
std::string usage() { return util::join({"usage:", "demo-app", "[--verbose]"}, " "); }
}
