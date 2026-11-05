cmake_minimum_required(VERSION 3.20)
project(cawmera_recorder LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
# The helper ships on its own inside Cawmera, so it carries the C++ runtime instead of needing the VC++ redistributable.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

add_compile_options(/W4 /EHsc /utf-8)
add_compile_definitions(UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)

add_library(recorder_core STATIC
    src/args.cpp
    src/geometry.cpp
    src/json.cpp
    src/track.cpp)
target_include_directories(recorder_core PUBLIC src)

add_executable(cawmera-recorder src/main.cpp app.manifest)
target_link_libraries(cawmera-recorder PRIVATE recorder_core)

add_executable(recorder-tests tests/recorder_tests.cpp)
target_link_libraries(recorder-tests PRIVATE recorder_core)
target_compile_definitions(recorder-tests PRIVATE
    "TRACK_TS_PATH=u8\"${PROJECT_SOURCE_DIR}/../../src/renderer/src/recording/track.ts\"")

enable_testing()
add_test(NAME recorder-tests COMMAND recorder-tests)
