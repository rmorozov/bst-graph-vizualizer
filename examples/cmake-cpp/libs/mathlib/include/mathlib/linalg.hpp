#pragma once
// PATHOLOGY: a leaf library header that re-exports the god header, so every
// consumer of mathlib transitively pays corelib's parse cost too.
#include "corelib/core_all.hpp"
namespace math {
std::vector<double> matvec(const std::vector<double>& m, const std::vector<double>& v, std::size_t n);
double dot(const std::vector<double>& a, const std::vector<double>& b);
}
