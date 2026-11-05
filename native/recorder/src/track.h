#pragma once

#include <filesystem>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

enum class MouseButton { left = 0, right = 1 };

class TrackWriter {
public:
    static constexpr int HIDDEN_SHAPE = -1;

    int shapeIndex(std::string_view name);
    void addCursor(double t, double x, double y, int shape);
    void addClick(double tDown, double x, double y, MouseButton button);
    void release(MouseButton button, double tUp);
    bool write(const std::filesystem::path& path, std::string_view kind, int width, int height, int fps,
               double durationMs, double scale) const;

private:
    struct CursorRow {
        double t, x, y;
        int shape;
    };
    struct ClickRow {
        double tDown, x, y;
        MouseButton button;
        std::optional<double> tUp;
    };

    mutable std::mutex mutex_;
    std::vector<std::string> shapes_;
    std::vector<CursorRow> cursor_;
    std::vector<ClickRow> clicks_;
};
