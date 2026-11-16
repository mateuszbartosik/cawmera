#include "access.h"

#include "failure.h"

void requireCaptureAllowed(std::optional<CaptureAccessStatus> status) {
    if (status == CaptureAccessStatus::DeniedByUser || status == CaptureAccessStatus::DeniedBySystem)
        throw Failure(FailureCode::accessDenied, "Windows doesn't let desktop apps record the screen");
}
