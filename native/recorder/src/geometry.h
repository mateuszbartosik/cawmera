#pragma once

#include <windows.h>

#include <utility>

struct Fit {
    double scale, x, y;
};

// `shown` is false while the window is minimized, hidden or cloaked; `crop` is then its last one.
struct Mapping {
    RECT crop;
    Fit fit;
    bool shown = true;
};

struct Blit {
    RECT source, destination;
};

Fit fitInside(int srcW, int srcH, int dstW, int dstH);
std::pair<double, double> screenToVideo(double sx, double sy, RECT crop, Fit fit);
RECT clampTo(RECT r, RECT bounds);
int evenDown(int v);

RECT overhang(RECT r, RECT bounds);
RECT insetBy(RECT r, RECT amounts);
RECT placeInVideo(RECT part, RECT crop, Fit fit);
// Within a pixel of the video size, a crop is drawn 1:1 from the top-left instead of being resampled.
Mapping mappingFor(RECT crop, int videoW, int videoH);
Blit blitOf(const Mapping& mapping, RECT monitor, int videoW, int videoH);
