#pragma once

#include <windows.h>

#include <mutex>
#include <optional>
#include <string_view>

#include "args.h"
#include "geometry.h"

class RecordingTarget {
public:
    explicit RecordingTarget(const Args& args);

    HMONITOR monitor() const { return monitor_; }
    RECT monitorRect() const { return monitorRect_; }
    int width() const { return width_; }
    int height() const { return height_; }
    std::string_view kind() const { return window_ ? "window" : "monitor"; }
    double density() const { return density_; }
    bool isGone() const { return window_ && !IsWindow(*window_); }
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
