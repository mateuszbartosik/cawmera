#include "track.h"

#include <algorithm>
#include <format>
#include <fstream>
#include <ranges>

#include "json.h"

namespace {

std::string quoted(std::string_view text) {
    return std::format(R"("{}")", jsonEscape(text));
}

template <typename Item, typename Format>
std::string jsonArray(const std::vector<Item>& items, Format format) {
    std::string out = "[";
    for (size_t i = 0; i < items.size(); ++i) {
        if (i > 0) out += ',';
        out += format(items[i]);
    }
    return out + "]";
}

}  // namespace

int TrackWriter::shapeIndex(std::string_view name) {
    std::scoped_lock lock(mutex_);
    const auto known = std::ranges::find(shapes_, name);
    if (known != shapes_.end()) return static_cast<int>(known - shapes_.begin());
    shapes_.emplace_back(name);
    return static_cast<int>(shapes_.size()) - 1;
}

void TrackWriter::addCursor(double t, double x, double y, int shape) {
    std::scoped_lock lock(mutex_);
    cursor_.push_back({t, x, y, shape});
}

void TrackWriter::addClick(double tDown, double x, double y, MouseButton button) {
    std::scoped_lock lock(mutex_);
    clicks_.push_back({tDown, x, y, button, std::nullopt});
}

void TrackWriter::release(MouseButton button, double tUp) {
    std::scoped_lock lock(mutex_);
    auto newestFirst = clicks_ | std::views::reverse;
    const auto latest = std::ranges::find(newestFirst, button, &ClickRow::button);
    if (latest != newestFirst.end() && !latest->tUp) latest->tUp = tUp;
}

bool TrackWriter::write(const std::filesystem::path& path, std::string_view kind, int width, int height, int fps,
                        double durationMs, double scale) const {
    const auto cursorRow = [](const CursorRow& row) {
        return std::format("[{},{},{},{}]", jsonTime(row.t), jsonPosition(row.x), jsonPosition(row.y), row.shape);
    };
    const auto clickRow = [](const ClickRow& row) {
        const std::string tUp = row.tUp ? jsonTime(*row.tUp) : "-1";
        return std::format("[{},{},{},{},{}]", jsonTime(row.tDown), jsonPosition(row.x), jsonPosition(row.y),
                           static_cast<int>(row.button), tUp);
    };

    std::string json =
        std::format(R"({{"version":1,"kind":{},"width":{},"height":{},"fps":{},"durationMs":{},"scale":{},)",
                    quoted(kind), width, height, fps, jsonTime(durationMs), jsonNumber(scale));
    {
        std::scoped_lock lock(mutex_);
        json += std::format("\n \"shapes\":{},\n \"cursor\":{},\n \"clicks\":{}}}\n", jsonArray(shapes_, quoted),
                            jsonArray(cursor_, cursorRow), jsonArray(clicks_, clickRow));
    }

    std::ofstream file(path, std::ios::binary);
    file << json;
    file.close();
    return !file.fail();
}
