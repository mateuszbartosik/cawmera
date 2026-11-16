#include <windows.h>
#include <unknwn.h>

#include <winrt/base.h>

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <exception>
#include <filesystem>
#include <optional>
#include <string>
#include <string_view>
#include <thread>
#include <variant>

#include "args.h"
#include "capture.h"
#include "clock.h"
#include "compositor.h"
#include "encoder.h"
#include "failure.h"
#include "input.h"
#include "json.h"
#include "target.h"
#include "track.h"

namespace {

constexpr DWORD CONSOLE_CLOSE_GRACE_MS = 4000;
constexpr DWORD TARGET_CHECK_MS = 50;

HANDLE stopRequested;
HANDLE startRequested;
HANDLE lastLinePrinted;
std::atomic<int64_t> startLineQpc;

struct Recorded {
    int64_t frames;
    double durationMs;
};

void printLine(std::string line) {
    line += '\n';
    DWORD written = 0;
    WriteFile(GetStdHandle(STD_OUTPUT_HANDLE), line.data(), static_cast<DWORD>(line.size()), &written, nullptr);
}

bool isSet(HANDLE event) {
    return WaitForSingleObject(event, 0) == WAIT_OBJECT_0;
}

void watchStdin() {
    const HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
    std::string pending;
    char chunk[256];
    DWORD read = 0;
    while (ReadFile(input, chunk, sizeof(chunk), &read, nullptr) && read > 0) {
        const int64_t receivedAt = qpcNow();
        pending.append(chunk, read);
        size_t lineEnd;
        while ((lineEnd = pending.find('\n')) != std::string::npos) {
            const Command command = parseCommand(std::string_view(pending).substr(0, lineEnd));
            pending.erase(0, lineEnd + 1);
            if (command == Command::stop) {
                SetEvent(stopRequested);
                return;
            }
            if (command == Command::start && !isSet(startRequested)) {
                startLineQpc = receivedAt;
                SetEvent(startRequested);
            }
        }
    }
    SetEvent(stopRequested);
}

BOOL WINAPI onConsoleEvent(DWORD event) {
    SetEvent(stopRequested);
    // Windows ends the process as soon as this returns from a close, so give the recording time to be saved.
    if (event == CTRL_CLOSE_EVENT) WaitForSingleObject(lastLinePrinted, CONSOLE_CLOSE_GRACE_MS);
    return TRUE;
}

[[noreturn]] void failMonitorGone() {
    throw Failure(FailureCode::targetGone, "The monitor to record went away before recording began");
}

void waitForFirstFrame(LatestFrame& latest, HANDLE captureClosed) {
    const HANDLE waits[] = {stopRequested, captureClosed, latest.arrived()};
    const DWORD woke = WaitForMultipleObjects(3, waits, FALSE, INFINITE);
    if (woke == WAIT_OBJECT_0 + 2) return;
    latest.rethrowFailure();
    if (woke == WAIT_OBJECT_0 + 1) failMonitorGone();
    throw Failure(FailureCode::internal, "Stopped before the first frame arrived");
}

void waitForStart(const RecordingTarget& target, LatestFrame& latest, HANDLE captureClosed) {
    const HANDLE waits[] = {stopRequested, captureClosed, startRequested};
    for (;;) {
        if (target.isGone())
            throw Failure(FailureCode::targetGone, "The window to record closed before recording began");
        const DWORD woke = WaitForMultipleObjects(3, waits, FALSE, TARGET_CHECK_MS);
        if (woke == WAIT_OBJECT_0) {
            latest.rethrowFailure();
            throw Failure(FailureCode::internal, "Stopped before recording began");
        }
        if (woke == WAIT_OBJECT_0 + 1) failMonitorGone();
        if (woke == WAIT_OBJECT_0 + 2) return;
        if (woke != WAIT_TIMEOUT) throwLastError(FailureCode::internal, "Waiting for the start line");
    }
}

Recorded recordVideo(const Args& args, RecordingTarget& target, TrackWriter& track) {
    const auto device = createDeviceFor(target.monitor());
    Compositor compositor(device.get(), target.width(), target.height());
    Mp4Writer video(device.get(), std::filesystem::path(args.outDir) / L"video.mp4", target.width(), target.height(),
                    args.fps);
    LatestFrame latest(device.get());
    const winrt::handle captureClosed(CreateEventW(nullptr, TRUE, FALSE, nullptr));
    if (!captureClosed) throwLastError(FailureCode::internal, "Creating an event");
    std::optional<MonitorCapture> capture(
        std::in_place, device.get(), target.monitor(),
        [&latest](ID3D11Texture2D* frame, int64_t) { latest.store(frame); },
        [&latest](std::exception_ptr failure) {
            latest.fail(failure);
            SetEvent(stopRequested);
        },
        [&captureClosed] { SetEvent(captureClosed.get()); });

    waitForFirstFrame(latest, captureClosed.get());
    printLine(readyLine(target.width(), target.height()));
    const int64_t readyAt = qpcNow();
    waitForStart(target, latest, captureClosed.get());
    // A start line that came before ready starts the recording at ready.
    const int64_t origin = std::max(startLineQpc.load(), readyAt);

    const RECT monitor = target.monitorRect();
    const auto composeNewest = [&] {
        Mapping mapping = target.current();
        OffsetRect(&mapping.crop, -monitor.left, -monitor.top);
        return compositor.compose(latest.newest().get(), mapping);
    };
    const auto ending = [&] { return isSet(stopRequested) || isSet(captureClosed.get()); };

    Metronome frameClock(origin, args.fps);
    ID3D11Texture2D* firstFrame = composeNewest();
    InputTracker mouse(track, [&target] { return target.current(); }, origin);
    video.write(firstFrame, 0);
    int64_t frames = 1;

    const HANDLE frameWaits[] = {stopRequested, captureClosed.get(), frameClock.handle()};
    for (;;) {
        const DWORD woke = WaitForMultipleObjects(3, frameWaits, FALSE, INFINITE);
        if (woke == WAIT_OBJECT_0 || woke == WAIT_OBJECT_0 + 1) break;
        if (woke != WAIT_OBJECT_0 + 2) throwLastError(FailureCode::internal, "Waiting for the next frame");
        const int64_t due = frameClock.latestBeat();
        frameClock.armAfter(due);
        if (target.isGone()) break;
        ID3D11Texture2D* frame = composeNewest();
        // Ticks missed while the encoder was busy get the same picture, so every frame keeps its place in time.
        for (; frames <= due && !ending(); ++frames) video.write(frame, frames);
    }

    latest.rethrowFailure();
    capture.reset();
    mouse.finish();
    video.finish();
    return {frames, frames * 1000.0 / args.fps};
}

void record(const Args& args) {
    winrt::init_apartment(winrt::apartment_type::multi_threaded);
    MonitorCapture::requireSupport();
    MonitorCapture::requireAccess();
    RecordingTarget target(args);
    std::filesystem::create_directories(args.outDir);
    TrackWriter track;
    // Returning releases the capture, the encoder, the GPU and video.mp4, so Cawmera never finds them in use.
    const Recorded recorded = recordVideo(args, target, track);
    if (!track.write(std::filesystem::path(args.outDir) / L"track.json", target.kind(), target.width(),
                     target.height(), args.fps, recorded.durationMs, target.density()))
        throw Failure(FailureCode::internal, "Writing track.json failed");
    printLine(doneLine(recorded.durationMs, recorded.frames));
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
    stopRequested = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    startRequested = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    lastLinePrinted = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    SetConsoleCtrlHandler(onConsoleEvent, TRUE);
    std::thread(watchStdin).detach();

    int exitCode = 1;
    try {
        const auto parsed = parseArgs(argc, argv);
        if (const auto* problem = std::get_if<std::string>(&parsed)) throw Failure(FailureCode::internal, *problem);
        // The manifest already asks for this, so the call fails; it only matters if the manifest is ever lost.
        SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        record(std::get<Args>(parsed));
        exitCode = 0;
    } catch (const Failure& failure) {
        printLine(errorLine(codeName(failure.code()), failure.what()));
    } catch (const winrt::hresult_error& error) {
        printLine(errorLine(codeName(FailureCode::internal), "Recording failed: " + hresultText(error.code())));
    } catch (const std::exception& error) {
        printLine(errorLine(codeName(FailureCode::internal), utf8FromAnsi(error.what())));
    } catch (...) {
        printLine(errorLine(codeName(FailureCode::internal), "Recording failed"));
    }
    SetEvent(lastLinePrinted);
    return exitCode;
}
