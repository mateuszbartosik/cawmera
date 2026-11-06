#pragma once

#include <windows.h>

#include <stdexcept>
#include <string>
#include <string_view>

enum class FailureCode { unsupported, accessDenied, targetGone, encoder, internal };

class Failure : public std::runtime_error {
public:
    Failure(FailureCode code, const std::string& utf8Message) : std::runtime_error(utf8Message), code_(code) {}
    FailureCode code() const { return code_; }

private:
    FailureCode code_;
};

std::string_view codeName(FailureCode code);

std::string utf8FromWide(std::wstring_view text);
std::string utf8FromAnsi(std::string_view text);

std::string hresultText(HRESULT hr);
Failure failureFor(HRESULT hr, FailureCode code, std::string_view step);
void throwIfFailed(HRESULT hr, FailureCode code, std::string_view step);
[[noreturn]] void throwLastError(FailureCode code, std::string_view step);
