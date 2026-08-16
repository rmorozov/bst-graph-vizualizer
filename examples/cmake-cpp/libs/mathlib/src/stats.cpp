#include "mathlib/stats.hpp"
#include <cmath>
namespace math {
double mean(const std::vector<double>& v) { double s = 0; for (double x : v) s += x; return v.empty() ? 0.0 : s / v.size(); }
double stddev(const std::vector<double>& v) {
    double m = mean(v), s = 0; for (double x : v) s += (x - m) * (x - m);
    return v.empty() ? 0.0 : std::sqrt(s / v.size());
}
}
