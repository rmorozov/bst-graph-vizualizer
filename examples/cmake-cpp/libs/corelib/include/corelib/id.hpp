// The lean header that most TUs actually need.
// It exists, but nothing includes it — every TU takes core_all.hpp instead.
#pragma once
namespace core { using Id = unsigned long long; }
