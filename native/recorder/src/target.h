#pragma once

#include <windows.h>

#include <mutex>
#include <optional>
#include <string_view>

#include "args.h"
#include "geometry.h"

// What a recording shows: a whole monitor, or a window minus whatever stuck out past its monitor at the start.
// The monitor and the video size stay fixed. A window that moves or resizes is followed and fitted inside, the parts
// of it that leave the monitor record as black, and while none of it is on screen the video holds its last frame.
class RecordingTarget {
public:
    // Throws Failure (target-gone) when the window doesn't exist or isn't on screen.
    explicit RecordingTarget(const Args& args);

    HMONITOR monitor() const { return monitor_; }
    RECT monitorRect() const { return monitorRect_; }
    int width() const { return width_; }
    int height() const { return height_; }
    std::string_view kind() const { return window_ ? "window" : "monitor"; }
    // The monitor's scale: 1 at 96 DPI.
    double density() const { return density_; }
    bool isGone() const { return window_ && !IsWindow(*window_); }

    // Where the video's pixels come from right now. Safe to call from any thread.
    Mapping current();

private:
    RECT windowBounds() const;

    std::optional<HWND> window_;
    HMONITOR monitor_;
    RECT monitorRect_;
    RECT offMonitorAtStart_{};
    int width_, height_;
    double density_;
    std::mutex mutex_;
    RECT lastCrop_;
};
