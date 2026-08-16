// corelib/core_all.hpp — the "god header".
//
// DELIBERATE PATHOLOGY (micro level):
// every translation unit in this project includes this single header, and it
// pulls in the heaviest parts of the standard library plus a chunk of template
// metaprogramming. Touching any line of it invalidates every object file in
// the build, and each TU pays the full parse+instantiate cost.
//
// A build-optimization tool should be able to say: "corelib/core_all.hpp is
// included by every TU, costs ~0.9s of the ~1.1s spent on each of them, and
// most of those TUs use only `core::Id` out of it."
#pragma once

#include <regex>
#include <sstream>
#include <iostream>
#include <unordered_map>
#include <map>
#include <functional>
#include <algorithm>
#include <memory>
#include <optional>
#include <variant>
#include <string>
#include <vector>

namespace core {

using Id = unsigned long long;

// Template metaprogramming ballast: instantiated in every TU that includes
// this header, whether or not the TU uses any of it.
template <int N> struct Ballast {
    using type = std::map<std::string, typename Ballast<N - 1>::type>;
    static constexpr int depth = Ballast<N - 1>::depth + 1;
};
template <> struct Ballast<0> {
    using type = std::string;
    static constexpr int depth = 0;
};
using DeepMap = Ballast<24>::type;

template <typename... Ts> struct TypeList {
    static constexpr std::size_t size = sizeof...(Ts);
    using variant = std::variant<Ts...>;
};
using WideList = TypeList<int, long, float, double, std::string, std::vector<int>,
                          std::map<int, int>, std::unordered_map<int, int>,
                          std::optional<int>, std::shared_ptr<int>>;

struct Record {
    Id id{};
    std::string name;
    std::vector<double> samples;
    std::optional<std::string> tag;
};

std::string describe(const Record& r);
Id hash_name(const std::string& name);

}  // namespace core
