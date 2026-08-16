#pragma once
#include "corelib/core_all.hpp"
namespace net { std::string encode(const core::Record& r); core::Record decode(const std::string& s); }
