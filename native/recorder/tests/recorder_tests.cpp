#include <cmath>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <limits>
#include <optional>
#include <regex>
#include <sstream>
#include <string>
#include <string_view>
#include <variant>
#include <vector>

#include "args.h"
#include "geometry.h"
#include "json.h"
#include "shapes.h"
#include "track.h"

static int failures = 0;

#define CHECK(expr)                                                                        \
    do {                                                                                   \
        if (!(expr)) {                                                                     \
            std::fprintf(stderr, "%s(%d): CHECK failed: %s\n", __FILE__, __LINE__, #expr); \
            ++failures;                                                                    \
        }                                                                                  \
    } while (false)

namespace {

bool nearly(double actual, double expected) {
    return std::abs(actual - expected) < 1e-9;
}

bool sameRect(RECT a, RECT b) {
    return a.left == b.left && a.top == b.top && a.right == b.right && a.bottom == b.bottom;
}

bool contains(const std::string& text, std::string_view part) {
    return text.find(part) != std::string::npos;
}

std::string readFile(const std::filesystem::path& path) {
    std::ifstream file(path, std::ios::binary);
    std::ostringstream text;
    text << file.rdbuf();
    return text.str();
}

std::optional<Args> parsed(std::vector<std::wstring> words) {
    words.insert(words.begin(), L"cawmera-recorder.exe");
    std::vector<wchar_t*> argv;
    for (std::wstring& word : words) argv.push_back(word.data());
    auto result = parseArgs(static_cast<int>(argv.size()), argv.data());
    if (const Args* args = std::get_if<Args>(&result)) return *args;
    return std::nullopt;
}

std::string writtenJson(const TrackWriter& track, std::string_view kind, int width, int height, int fps,
                        double durationMs, double scale) {
    const auto path = std::filesystem::temp_directory_path() / "cawmera-recorder-tests-track.json";
    CHECK(track.write(path, kind, width, height, fps, durationMs, scale));
    const std::string json = readFile(path);
    std::filesystem::remove(path);
    return json;
}

std::vector<std::string> rendererCursorShapes() {
    const std::string source = readFile(TRACK_TS_PATH);
    const size_t start = source.find("CURSOR_SHAPES = [");
    const size_t end = source.find(']', start);
    if (end == std::string::npos) return {};

    const std::string list = source.substr(start, end - start);
    const std::regex quoted("'([^']*)'");
    std::vector<std::string> names;
    for (auto match = std::sregex_iterator(list.begin(), list.end(), quoted); match != std::sregex_iterator(); ++match)
        names.push_back(match->str(1));
    return names;
}

void fitsCentredScalingDownOrUp() {
    const Fit down = fitInside(2560, 1440, 1920, 1080);
    CHECK(nearly(down.scale, 0.75));
    CHECK(nearly(down.x, 0));
    CHECK(nearly(down.y, 0));

    const Fit up = fitInside(1000, 1000, 1920, 1080);
    CHECK(nearly(up.scale, 1.08));
    CHECK(nearly(up.x, 420));
    CHECK(nearly(up.y, 0));
}

void mapsScreenPointsIntoTheVideo() {
    const auto [x, y] = screenToVideo(100 + 640, 50 + 360, {100, 50, 1380, 770}, fitInside(1280, 720, 1920, 1080));
    CHECK(nearly(x, 960));
    CHECK(nearly(y, 540));
}

void clampsRectsToBounds() {
    const RECT monitor{0, 0, 1920, 1080};
    CHECK(sameRect(clampTo({-10, 20, 500, 1200}, monitor), {0, 20, 500, 1080}));
    CHECK(sameRect(clampTo({2000, 100, 2400, 300}, monitor), {1920, 100, 1920, 300}));
}

void roundsSizesUpToEven() {
    CHECK(evenUp(1081) == 1082);
    CHECK(evenUp(1080) == 1080);
}

void acceptsAWindowTarget() {
    const auto args = parsed({L"--window", L"1234", L"--fps", L"60", L"--out", L"C:\\t"});
    CHECK(args.has_value());
    if (!args) return;
    CHECK(args->hwnd == 1234u);
    CHECK(!args->monitorPoint);
    CHECK(args->fps == 60);
    CHECK(args->outDir == L"C:\\t");
}

void acceptsAMonitorPoint() {
    const auto args = parsed({L"--monitor-point", L"-1920,540", L"--fps", L"30", L"--out", L"C:\\t"});
    CHECK(args.has_value());
    if (!args) return;
    CHECK(!args->hwnd);
    CHECK(args->monitorPoint && args->monitorPoint->x == -1920 && args->monitorPoint->y == 540);
}

void rejectsBadCommandLines() {
    CHECK(!parsed({L"--fps", L"60", L"--out", L"C:\\t"}));
    CHECK(!parsed({L"--window", L"1234", L"--monitor-point", L"0,0", L"--fps", L"60", L"--out", L"C:\\t"}));
    CHECK(!parsed({L"--monitor-point", L"0", L"--fps", L"60", L"--out", L"C:\\t"}));
    CHECK(!parsed({L"--window", L"1234", L"--fps", L"sixty", L"--out", L"C:\\t"}));
    CHECK(!parsed({L"--window", L"1234", L"--fps", L"0", L"--out", L"C:\\t"}));
    CHECK(!parsed({L"--window", L"1234", L"--fps", L"60", L"--out"}));
    CHECK(!parsed({L"--window", L"1234", L"--fps", L"60", L"--out", L"C:\\t", L"--keys", L"on"}));
}

void buildsProtocolLines() {
    const std::string accessDenied = R"({"type":"error","code":"access-denied","message":"a \"b\""})";
    CHECK(errorLine("access-denied", "a \"b\"") == accessDenied);
    CHECK(readyLine(1280, 720) == R"({"type":"ready","width":1280,"height":720})");
    CHECK(doneLine(1000, 60) == R"({"type":"done","durationMs":1000.0,"frames":60})");
}

void escapesJsonStrings() {
    CHECK(jsonEscape("C:\\t\r\n\t\x01 ok") == R"(C:\\t\r\n\t\u0001 ok)");
}

void writesTheTrackWithAReleasedClick() {
    TrackWriter track;
    track.addCursor(0, 812.5, 400.25, track.shapeIndex("arrow"));
    track.addClick(1520, 812.5, 400.25, MouseButton::left);
    track.release(MouseButton::left, 1610);

    const std::string json = writtenJson(track, "window", 1920, 1080, 60, 48600, 1.14);
    CHECK(contains(json, R"("version":1)"));
    CHECK(contains(json, R"("shapes":["arrow"])"));
    CHECK(contains(json, R"("cursor":[[0.0,812.50,400.25,0]])"));
    CHECK(contains(json, R"("clicks":[[1520.0,812.50,400.25,0,1610.0]])"));
}

void writesTheHeaderHiddenCursorAndHeldButton() {
    TrackWriter track;
    CHECK(track.shapeIndex("hand") == 0);
    CHECK(track.shapeIndex("arrow") == 1);
    CHECK(track.shapeIndex("hand") == 0);
    track.addCursor(16.66, 10, 20, TrackWriter::HIDDEN_SHAPE);
    track.addClick(100, 1, 2, MouseButton::left);
    track.release(MouseButton::left, 150);
    track.addClick(200, 3, 4, MouseButton::right);
    track.addClick(300, 5, 6, MouseButton::left);
    track.release(MouseButton::left, 350);

    const std::string json = writtenJson(track, "monitor", 2560, 1440, 30, 1016.666, 0.75);
    CHECK(json.starts_with(
        R"({"version":1,"kind":"monitor","width":2560,"height":1440,"fps":30,"durationMs":1016.7,"scale":0.75,)"));
    CHECK(contains(json, R"("shapes":["hand","arrow"])"));
    CHECK(contains(json, R"("cursor":[[16.7,10.00,20.00,-1]])"));
    CHECK(contains(json, R"("clicks":[[100.0,1.00,2.00,0,150.0],[200.0,3.00,4.00,1,-1],[300.0,5.00,6.00,0,350.0]])"));
}

void writesNullForNumbersThatAreNotFinite() {
    TrackWriter track;
    track.addCursor(0, std::numeric_limits<double>::quiet_NaN(), 20, TrackWriter::HIDDEN_SHAPE);
    CHECK(contains(writtenJson(track, "window", 100, 100, 60, 0, 1), R"("cursor":[[0.0,null,20.00,-1]])"));
}

void listsCursorShapesLikeTheRenderer() {
    const std::vector<std::string> expected(CURSOR_SHAPES.begin(), CURSOR_SHAPES.end());
    CHECK(rendererCursorShapes() == expected);
}

}  // namespace

int main() {
    fitsCentredScalingDownOrUp();
    mapsScreenPointsIntoTheVideo();
    clampsRectsToBounds();
    roundsSizesUpToEven();
    acceptsAWindowTarget();
    acceptsAMonitorPoint();
    rejectsBadCommandLines();
    buildsProtocolLines();
    escapesJsonStrings();
    writesTheTrackWithAReleasedClick();
    writesTheHeaderHiddenCursorAndHeldButton();
    writesNullForNumbersThatAreNotFinite();
    listsCursorShapesLikeTheRenderer();

    if (failures > 0) std::fprintf(stderr, "%d check(s) failed\n", failures);
    return failures == 0 ? 0 : 1;
}
