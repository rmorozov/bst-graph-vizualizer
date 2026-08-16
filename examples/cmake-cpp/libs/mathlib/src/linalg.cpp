#include "mathlib/linalg.hpp"
namespace math {
double dot(const std::vector<double>& a, const std::vector<double>& b) {
    double s = 0; for (std::size_t i = 0; i < a.size() && i < b.size(); ++i) s += a[i] * b[i]; return s;
}
std::vector<double> matvec(const std::vector<double>& m, const std::vector<double>& v, std::size_t n) {
    std::vector<double> out(n, 0.0);
    for (std::size_t r = 0; r < n; ++r) for (std::size_t c = 0; c < n && c < v.size(); ++c) out[r] += m[r * n + c] * v[c];
    return out;
}
}
