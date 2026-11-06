#pragma once

#include <cstdint>
#include <string>
#include <string_view>

std::string jsonEscape(std::string_view text);

// Times in ms get 1 decimal and positions in px get 2. A value that isn't finite is written as null, so the
// output stays valid JSON.
std::string jsonTime(double ms);
std::string jsonPosition(double px);
std::string jsonNumber(double value);

std::string readyLine(int width, int height);
std::string doneLine(double durationMs, int64_t frames);
std::string errorLine(std::string_view code, std::string_view message);

enum class Command { none, start, stop };
Command parseCommand(std::string_view line);
