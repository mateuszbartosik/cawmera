#pragma once

#include <chrono>
#include <optional>

#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Security.Authorization.AppCapabilityAccess.h>

using CaptureAccessStatus = winrt::Windows::Security::Authorization::AppCapabilityAccess::AppCapabilityAccessStatus;

constexpr std::chrono::seconds CAPTURE_ACCESS_WAIT{2};

// Windows' answer to an access request, or none when it doesn't come within CAPTURE_ACCESS_WAIT, so a stalled request can't
// stop a recording.
template <typename Request>
std::optional<CaptureAccessStatus> answerInTime(const Request& request) {
    if (request.wait_for(CAPTURE_ACCESS_WAIT) != winrt::Windows::Foundation::AsyncStatus::Completed) return std::nullopt;
    return request.GetResults();
}

// Only a clear no from Windows stops a recording. Any other answer, or none from a Windows that can't say, carries on.
void requireCaptureAllowed(std::optional<CaptureAccessStatus> status);
