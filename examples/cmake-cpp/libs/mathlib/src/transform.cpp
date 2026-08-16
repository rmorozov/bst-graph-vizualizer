#include "mathlib/linalg.hpp"
#include "mathlib/stats.hpp"
namespace math {
std::vector<double> normalize(std::vector<double> v) {
    double m = mean(v), sd = stddev(v);
    if (sd > 0) for (double& x : v) x = (x - m) / sd;
    return v;
}
}
