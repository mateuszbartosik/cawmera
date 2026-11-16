cmake_minimum_required(VERSION 3.20)
project(cawmera_recorder LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
# The helper ships on its own inside Cawmera, so it carries the C++ runtime instead of needing the VC++ redistributable.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

add_compile_options(/W4 /EHsc /utf-8)
add_compile_definitions(UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)

add_library(recorder_core STATIC
    src/access.cpp
    src/args.cpp
    src/failure.cpp
    src/geometry.cpp
    src/json.cpp
    src/track.cpp)
target_include_directories(recorder_core PUBLIC src)

add_executable(cawmera-recorder
    src/capture.cpp
    src/clock.cpp
    src/compositor.cpp
    src/encoder.cpp
    src/input.cpp
    src/main.cpp
    src/target.cpp
    app.manifest)
# kernel32 and user32 go first, or windowsapp hides their imports behind API-set DLLs the import check can't see.
target_link_libraries(cawmera-recorder PRIVATE
    recorder_core kernel32 user32 d3d11 dxgi mfplat mfreadwrite mfuuid dwmapi shcore windowsapp)

add_executable(recorder-tests tests/recorder_tests.cpp)
target_link_libraries(recorder-tests PRIVATE recorder_core)
target_compile_definitions(recorder-tests PRIVATE
    "TRACK_TS_PATH=u8\"${PROJECT_SOURCE_DIR}/../../src/renderer/src/recording/track.ts\""
    "TRACK_FIXTURE_PATH=u8\"${PROJECT_SOURCE_DIR}/../../test/fixtures/track-from-helper.json\"")

enable_testing()
add_test(NAME recorder-tests COMMAND recorder-tests)
