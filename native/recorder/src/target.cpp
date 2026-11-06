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

// Minimized, hidden or on another virtual desktop, a window keeps bounds on the screen but shows nothing there.
bool isShowing(HWND window) {
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

    RECT onMonitor = monitorRect_;
    if (window_) {
        const RECT bounds = windowBounds();
        onMonitor = clampTo(bounds, monitorRect_);
        if (!isShowing(*window_) || IsRectEmpty(&onMonitor))
            throw Failure(FailureCode::targetGone, "The window to record is minimized or off screen");
        offMonitorAtStart_ = overhang(bounds, monitorRect_);
    }
    lastCrop_ = onMonitor;
    width_ = evenDown(onMonitor.right - onMonitor.left);
    height_ = evenDown(onMonitor.bottom - onMonitor.top);
}

Mapping RecordingTarget::current() {
    if (!window_) return mappingFor(monitorRect_, width_, height_);

    RECT crop = insetBy(windowBounds(), offMonitorAtStart_);
    const bool shown = isShowing(*window_) && !IsRectEmpty(&crop);
    {
        std::scoped_lock lock(mutex_);
        if (shown)
            lastCrop_ = crop;
        else
            crop = lastCrop_;
    }
    Mapping mapping = mappingFor(crop, width_, height_);
    mapping.shown = shown;
    return mapping;
}

RECT RecordingTarget::windowBounds() const {
    RECT bounds{};
    if (FAILED(DwmGetWindowAttribute(*window_, DWMWA_EXTENDED_FRAME_BOUNDS, &bounds, sizeof(bounds)))) return {};
    return bounds;
}
