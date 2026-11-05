#include "geometry.h"

#include <algorithm>

Fit fitInside(int srcW, int srcH, int dstW, int dstH) {
    if (srcW <= 0 || srcH <= 0) return {0, dstW / 2.0, dstH / 2.0};
    const double scale = std::min(static_cast<double>(dstW) / srcW, static_cast<double>(dstH) / srcH);
    return {scale, (dstW - srcW * scale) / 2, (dstH - srcH * scale) / 2};
}

std::pair<double, double> screenToVideo(double sx, double sy, RECT crop, Fit fit) {
    return {fit.x + (sx - crop.left) * fit.scale, fit.y + (sy - crop.top) * fit.scale};
}

RECT clampTo(RECT r, RECT bounds) {
    const LONG left = std::clamp(r.left, bounds.left, bounds.right);
    const LONG top = std::clamp(r.top, bounds.top, bounds.bottom);
    return {left, top, std::clamp(r.right, left, bounds.right), std::clamp(r.bottom, top, bounds.bottom)};
}

int evenUp(int v) {
    return v + (v & 1);
}
