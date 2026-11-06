#include "geometry.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>

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

int evenDown(int v) {
    return std::max(2, v - (v & 1));
}

RECT overhang(RECT r, RECT bounds) {
    return {std::max(0L, bounds.left - r.left), std::max(0L, bounds.top - r.top), std::max(0L, r.right - bounds.right),
            std::max(0L, r.bottom - bounds.bottom)};
}

RECT insetBy(RECT r, RECT amounts) {
    const LONG left = r.left + amounts.left;
    const LONG top = r.top + amounts.top;
    return {left, top, std::max(left, r.right - amounts.right), std::max(top, r.bottom - amounts.bottom)};
}

RECT placeInVideo(RECT part, RECT crop, Fit fit) {
    const LONG left = std::lround(fit.x + (part.left - crop.left) * fit.scale);
    const LONG top = std::lround(fit.y + (part.top - crop.top) * fit.scale);
    return {left, top, left + std::lround((part.right - part.left) * fit.scale),
            top + std::lround((part.bottom - part.top) * fit.scale)};
}

Mapping mappingFor(RECT crop, int videoW, int videoH) {
    const int width = crop.right - crop.left;
    const int height = crop.bottom - crop.top;
    if (std::abs(width - videoW) > 1 || std::abs(height - videoH) > 1)
        return {crop, fitInside(width, height, videoW, videoH)};
    const RECT trimmed{crop.left, crop.top, crop.left + std::min(width, videoW), crop.top + std::min(height, videoH)};
    return {trimmed, {1, 0, 0}};
}

Blit blitOf(const Mapping& mapping, RECT monitor, int videoW, int videoH) {
    const RECT source = clampTo(mapping.crop, monitor);
    return {source, clampTo(placeInVideo(source, mapping.crop, mapping.fit), {0, 0, videoW, videoH})};
}
