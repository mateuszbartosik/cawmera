#pragma once

#include <array>
#include <string_view>

// The names and order of CURSOR_SHAPES in src/renderer/src/recording/track.ts.
inline constexpr auto CURSOR_SHAPES = std::to_array<std::string_view>({
    "arrow", "hand", "ibeam", "wait", "progress", "crosshair", "not-allowed", "move",
    "resize-ew", "resize-ns", "resize-nwse", "resize-nesw", "help", "other",
});
