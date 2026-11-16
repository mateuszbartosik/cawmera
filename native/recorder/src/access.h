#pragma once

#include <optional>

#include <winrt/Windows.Security.Authorization.AppCapabilityAccess.h>

using CaptureAccessStatus = winrt::Windows::Security::Authorization::AppCapabilityAccess::AppCapabilityAccessStatus;

// Only a clear no from Windows stops a recording. Any other answer, or none from a Windows that can't say, carries on.
void requireCaptureAllowed(std::optional<CaptureAccessStatus> status);
