#pragma once

#include <windows.h>

#include <winrt/base.h>

#include <cstdint>
#include <exception>
#include <functional>
#include <future>
#include <string_view>
#include <thread>
#include <vector>

#include "clock.h"
#include "geometry.h"
#include "track.h"

class InputTracker {
public:
    InputTracker(TrackWriter& track, std::function<Mapping()> currentMapping, int64_t originQpc);
    ~InputTracker();

    void finish();

private:
    struct SystemCursor {
        HCURSOR handle;
        std::string_view shape;
    };

    void run(std::promise<void> started);
    void listen(Metronome& sampler);
    void sampleCursor();
    void onRawInput(HRAWINPUT input);
    double msSinceOrigin(int64_t qpc) const;
    int shapeOf(const CURSORINFO& cursor);

    TrackWriter& track_;
    std::function<Mapping()> currentMapping_;
    int64_t originQpc_;
    std::vector<SystemCursor> systemCursors_;
    HCURSOR lastCursor_ = nullptr;
    int lastShape_ = TrackWriter::HIDDEN_SHAPE;
    winrt::handle stop_;
    std::exception_ptr failure_;
    // Declared last, so it's joined before the members it uses go away.
    std::jthread thread_;
};
