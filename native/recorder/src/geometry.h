#pragma once

#include <windows.h>

#include <utility>

struct Fit {
    double scale, x, y;
};

// Which screen pixels the video shows, and where they sit in it. `shown` is false while a recorded window is off
// screen: minimized, hidden, or off its monitor. The crop is then the last one it had.
struct Mapping {
    RECT crop;
    Fit fit;
    bool shown;
};

Fit fitInside(int srcW, int srcH, int dstW, int dstH);
std::pair<double, double> screenToVideo(double sx, double sy, RECT crop, Fit fit);
RECT clampTo(RECT r, RECT bounds);
int evenUp(int v);

// How far each edge of `r` reaches past `bounds`, or 0 where it doesn't.
RECT overhang(RECT r, RECT bounds);
// `r` with each edge moved in by the matching side of `amounts`. Edges that would cross meet instead.
RECT insetBy(RECT r, RECT amounts);
// Where `part` of `crop` lands in the video, in whole pixels. At scale 1 it keeps its exact size.
RECT placeInVideo(RECT part, RECT crop, Fit fit);
