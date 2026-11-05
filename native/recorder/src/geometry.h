#pragma once

#include <windows.h>

#include <utility>

struct Fit {
    double scale, x, y;
};

Fit fitInside(int srcW, int srcH, int dstW, int dstH);
std::pair<double, double> screenToVideo(double sx, double sy, RECT crop, Fit fit);
RECT clampTo(RECT r, RECT bounds);
int evenUp(int v);
