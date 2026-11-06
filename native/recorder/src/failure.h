#pragma once

#include <windows.h>

#include <stdexcept>
#include <string>
#include <string_view>

enum class FailureCode { unsupported, accessDenied, targetGone, encoder, internal };

// Something that stops a recording, as the helper reports it: a protocol code and a UTF-8 message.
class Failure : public std::runtime_error {
public:
    Failure(FailureCode code, const std::string& message) : std::runtime_error(message), code_(code) {}
    FailureCode code() const { return code_; }

private:
    FailureCode code_;
};

std::string_view codeName(FailureCode code);

std::string utf8FromWide(std::wstring_view text);
std::string utf8FromAnsi(std::string_view text);

// Windows' description of `hr` in UTF-8, ending with the code in hex.
std::string hresultText(HRESULT hr);
Failure failureFor(HRESULT hr, FailureCode code, std::string_view step);
void throwIfFailed(HRESULT hr, FailureCode code, std::string_view step);
// For the Win32 calls that report failure through GetLastError.
[[noreturn]] void throwLastError(FailureCode code, std::string_view step);
