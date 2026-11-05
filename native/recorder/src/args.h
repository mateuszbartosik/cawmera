#pragma once

#include <windows.h>

#include <cstdint>
#include <optional>
#include <string>
#include <variant>

struct Args {
    std::optional<uint64_t> hwnd;
    std::optional<POINT> monitorPoint;
    int fps;
    std::wstring outDir;
};

// `--window <hwnd> | --monitor-point <x>,<y>` plus `--fps <n> --out <dir>`; anything else gives an error message.
std::variant<Args, std::string> parseArgs(int argc, wchar_t** argv);
