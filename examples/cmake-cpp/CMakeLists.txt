cmake_minimum_required(VERSION 3.16)
project(bst_demo_app CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Codegen delay is tunable so the example stays usable on slow machines.
set(DEMO_CODEGEN_DELAY "2.0" CACHE STRING "seconds the codegen step sleeps")

find_package(Python3 COMPONENTS Interpreter REQUIRED)

set(GENERATED_DIR "${CMAKE_BINARY_DIR}/generated")
set(GENERATED_HEADER "${GENERATED_DIR}/corelib/generated_tables.hpp")

add_custom_command(
    OUTPUT "${GENERATED_HEADER}"
    COMMAND ${Python3_EXECUTABLE} "${CMAKE_SOURCE_DIR}/tools/gen_tables.py"
            "${GENERATED_HEADER}" "${DEMO_CODEGEN_DELAY}"
    DEPENDS "${CMAKE_SOURCE_DIR}/tools/gen_tables.py"
    COMMENT "Generating corelib tables"
    VERBATIM)
add_custom_target(gen_tables DEPENDS "${GENERATED_HEADER}")

add_library(corelib STATIC
    libs/corelib/src/core.cpp
    libs/corelib/src/hash.cpp
    libs/corelib/src/registry.cpp)
add_dependencies(corelib gen_tables)
target_include_directories(corelib PUBLIC libs/corelib/include "${GENERATED_DIR}")

add_library(mathlib STATIC
    libs/mathlib/src/linalg.cpp
    libs/mathlib/src/stats.cpp
    libs/mathlib/src/transform.cpp)
target_include_directories(mathlib PUBLIC libs/mathlib/include)
target_link_libraries(mathlib PUBLIC corelib)

add_library(netlib STATIC
    libs/netlib/src/protocol.cpp
    libs/netlib/src/session.cpp)
target_include_directories(netlib PUBLIC libs/netlib/include)
# PATHOLOGY: netlib does not use a single mathlib symbol. This PUBLIC link is
# the false edge that serialises netlib behind mathlib.
target_link_libraries(netlib PUBLIC corelib mathlib)

add_library(utillib STATIC
    libs/utillib/src/strings.cpp
    libs/utillib/src/timeutil.cpp)
target_include_directories(utillib PUBLIC libs/utillib/include)
target_link_libraries(utillib PUBLIC corelib)

add_executable(demo_app app/src/main.cpp app/src/cli.cpp)
target_link_libraries(demo_app PRIVATE netlib mathlib utillib)
