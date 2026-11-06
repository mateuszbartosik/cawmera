#include "failure.h"

#include <cwctype>
#include <format>

std::string_view codeName(FailureCode code) {
    switch (code) {
    case FailureCode::unsupported: return "unsupported";
    case FailureCode::accessDenied: return "access-denied";
    case FailureCode::targetGone: return "target-gone";
    case FailureCode::encoder: return "encoder";
    case FailureCode::internal: return "internal";
    }
    return "internal";
}

std::string utf8FromWide(std::wstring_view text) {
    const int wideLength = static_cast<int>(text.size());
    const int length = WideCharToMultiByte(CP_UTF8, 0, text.data(), wideLength, nullptr, 0, nullptr, nullptr);
    std::string utf8(length, '\0');
    WideCharToMultiByte(CP_UTF8, 0, text.data(), wideLength, utf8.data(), length, nullptr, nullptr);
    return utf8;
}

std::string utf8FromAnsi(std::string_view text) {
    const int ansiLength = static_cast<int>(text.size());
    const int length = MultiByteToWideChar(CP_ACP, 0, text.data(), ansiLength, nullptr, 0);
    std::wstring wide(length, L'\0');
    MultiByteToWideChar(CP_ACP, 0, text.data(), ansiLength, wide.data(), length);
    return utf8FromWide(wide);
}

std::string hresultText(HRESULT hr) {
    wchar_t* description = nullptr;
    const DWORD flags = FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS;
    const DWORD length = FormatMessageW(flags, nullptr, static_cast<DWORD>(hr), 0,
                                        reinterpret_cast<wchar_t*>(&description), 0, nullptr);
    std::wstring_view text(description, length);
    while (!text.empty() && std::iswspace(text.back())) text.remove_suffix(1);
    const std::string code = std::format("0x{:08X}", static_cast<unsigned long>(hr));
    std::string result = text.empty() ? code : std::format("{} ({})", utf8FromWide(text), code);
    LocalFree(description);
    return result;
}

Failure failureFor(HRESULT hr, FailureCode code, std::string_view step) {
    return Failure(code, std::format("{} failed: {}", step, hresultText(hr)));
}

void throwIfFailed(HRESULT hr, FailureCode code, std::string_view step) {
    if (FAILED(hr)) throw failureFor(hr, code, step);
}

void throwLastError(FailureCode code, std::string_view step) {
    throw failureFor(HRESULT_FROM_WIN32(GetLastError()), code, step);
}
