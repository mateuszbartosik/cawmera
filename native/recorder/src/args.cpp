#include "args.h"

#include <charconv>
#include <string_view>

#include "failure.h"

namespace {

template <typename Integer>
std::optional<Integer> parseInteger(std::wstring_view text) {
    std::string ascii;
    for (const wchar_t c : text) {
        if (c > 0x7F) return std::nullopt;
        ascii.push_back(static_cast<char>(c));
    }
    Integer value{};
    const char* last = ascii.data() + ascii.size();
    const auto [end, error] = std::from_chars(ascii.data(), last, value);
    if (error != std::errc{} || end != last) return std::nullopt;
    return value;
}

std::optional<POINT> parsePoint(std::wstring_view text) {
    const size_t comma = text.find(L',');
    if (comma == std::wstring_view::npos) return std::nullopt;
    const auto x = parseInteger<LONG>(text.substr(0, comma));
    const auto y = parseInteger<LONG>(text.substr(comma + 1));
    if (!x || !y) return std::nullopt;
    return POINT{*x, *y};
}

}  // namespace

std::variant<Args, std::string> parseArgs(int argc, wchar_t** argv) {
    std::optional<uint64_t> hwnd;
    std::optional<POINT> monitorPoint;
    std::optional<int> fps;
    std::wstring outDir;

    for (int i = 1; i < argc; i += 2) {
        const std::wstring_view flag = argv[i];
        const std::wstring_view value = i + 1 < argc ? argv[i + 1] : L"";
        if (flag == L"--window") {
            hwnd = parseInteger<uint64_t>(value);
            if (!hwnd) return "--window needs a window handle";
        } else if (flag == L"--monitor-point") {
            monitorPoint = parsePoint(value);
            if (!monitorPoint) return "--monitor-point needs x,y";
        } else if (flag == L"--fps") {
            fps = parseInteger<int>(value);
            if (!fps || *fps <= 0) return "--fps needs a positive whole number";
        } else if (flag == L"--out") {
            if (value.empty()) return "--out needs a folder";
            outDir = value;
        } else {
            return "unknown argument: " + utf8FromWide(flag);
        }
    }

    if (hwnd && monitorPoint) return "pass --window or --monitor-point, not both";
    if (!hwnd && !monitorPoint) return "needs --window or --monitor-point";
    if (!fps) return "needs --fps";
    if (outDir.empty()) return "needs --out";
    return Args{hwnd, monitorPoint, *fps, outDir};
}
