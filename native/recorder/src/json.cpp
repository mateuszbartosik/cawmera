#include "json.h"

#include <cmath>
#include <format>

namespace {

std::string fixed(double value, int decimals) {
    return std::isfinite(value) ? std::format("{:.{}f}", value, decimals) : "null";
}

}  // namespace

std::string jsonEscape(std::string_view text) {
    std::string escaped;
    escaped.reserve(text.size());
    for (const char c : text) {
        switch (c) {
        case '"': escaped += "\\\""; break;
        case '\\': escaped += "\\\\"; break;
        case '\n': escaped += "\\n"; break;
        case '\r': escaped += "\\r"; break;
        case '\t': escaped += "\\t"; break;
        default:
            if (static_cast<unsigned char>(c) < 0x20)
                escaped += std::format("\\u{:04x}", static_cast<unsigned char>(c));
            else
                escaped += c;
        }
    }
    return escaped;
}

std::string jsonTime(double ms) {
    return fixed(ms, 1);
}

std::string jsonPosition(double px) {
    return fixed(px, 2);
}

std::string jsonNumber(double value) {
    return std::isfinite(value) ? std::format("{}", value) : "null";
}

std::string readyLine(int width, int height) {
    return std::format(R"({{"type":"ready","width":{},"height":{}}})", width, height);
}

std::string doneLine(double durationMs, int64_t frames) {
    return std::format(R"({{"type":"done","durationMs":{},"frames":{}}})", jsonTime(durationMs), frames);
}

std::string errorLine(std::string_view code, std::string_view message) {
    return std::format(R"({{"type":"error","code":"{}","message":"{}"}})", jsonEscape(code), jsonEscape(message));
}

bool isStopLine(std::string_view line) {
    std::string compact;
    for (const char c : line)
        if (c != ' ' && c != '\t' && c != '\r' && c != '\n') compact += c;
    return compact == R"({"type":"stop"})";
}
