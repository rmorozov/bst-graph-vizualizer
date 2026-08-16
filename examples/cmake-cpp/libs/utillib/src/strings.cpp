#include "utillib/strings.hpp"
namespace util {
std::string join(const std::vector<std::string>& parts, const std::string& sep) {
    std::string out; for (std::size_t i = 0; i < parts.size(); ++i) { if (i) out += sep; out += parts[i]; } return out;
}
}
