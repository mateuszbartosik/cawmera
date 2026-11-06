#include "target.h"

#include <dwmapi.h>
#include <shellscalingapi.h>

#include <cstdint>

#include "failure.h"

namespace {

double densityOf(HMONITOR monitor) {
    UINT dpiX = 0, dpiY = 0;
    if (FAILED(GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &dpiX, &dpiY))) return 1;
    return static_cast<double>(dpiX) / USER_DEFAULT_SCREEN_DPI;
}

// Minimized, hidden or on another virtual desktop, a window keeps bounds on the screen but none of it shows there.
bool isOnScreen(HWND window) {
    DWORD cloaked = 0;
    DwmGetWindowAttribute(window, DWMWA_CLOAKED, &cloaked, sizeof(cloaked));
    return IsWindowVisible(window) && !IsIconic(window) && !cloaked;
}

}  // namespace

RecordingTarget::RecordingTarget(const Args& args) {
    if (args.hwnd) {
        window_ = reinterpret_cast<HWND>(static_cast<uintptr_t>(*args.hwnd));
        if (!IsWindow(*window_)) throw Failure(FailureCode::targetGone, "The window to record doesn't exist");
        monitor_ = MonitorFromWindow(*window_, MONITOR_DEFAULTTONEAREST);
    } else {
        monitor_ = MonitorFromPoint(*args.monitorPoint, MONITOR_DEFAULTTONEAREST);
    }
    MONITORINFO info{.cbSize = sizeof(MONITORINFO)};
    if (!GetMonitorInfoW(monitor_, &info)) throwLastError(FailureCode::internal, "Reading the monitor's bounds");
    monitorRect_ = info.rcMonitor;
    density_ = densityOf(monitor_);

    RECT shown = monitorRect_;
    if (window_) {
        const RECT bounds = windowBounds();
        shown = clampTo(bounds, monitorRect_);
        if (!isOnScreen(*window_) || IsRectEmpty(&shown))
            throw Failure(FailureCode::targetGone, "The window to record is minimized or off screen");
        offMonitorAtStart_ = overhang(bounds, monitorRect_);
    }
    lastCrop_ = shown;
    width_ = evenUp(shown.right - shown.left);
    height_ = evenUp(shown.bottom - shown.top);
}

Mapping RecordingTarget::current() {
    RECT crop = monitorRect_;
    bool shown = true;
    if (window_) {
        crop = insetBy(windowBounds(), offMonitorAtStart_);
        const RECT onMonitor = clampTo(crop, monitorRect_);
        shown = isOnScreen(*window_) && !IsRectEmpty(&onMonitor);
        std::scoped_lock lock(mutex_);
        if (shown)
            lastCrop_ = crop;
        else
            crop = lastCrop_;
    }
    return {crop, fitInside(crop.right - crop.left, crop.bottom - crop.top, width_, height_), shown};
}

RECT RecordingTarget::windowBounds() const {
    RECT bounds{};
    if (FAILED(DwmGetWindowAttribute(*window_, DWMWA_EXTENDED_FRAME_BOUNDS, &bounds, sizeof(bounds)))) return {};
    return bounds;
}
