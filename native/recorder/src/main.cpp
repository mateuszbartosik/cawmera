#include <windows.h>
#include <unknwn.h>

#include <winrt/base.h>

#include <cstdint>
#include <exception>
#include <filesystem>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <thread>
#include <utility>
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

// Set by a stop line, the end of stdin, the console closing, or a capture failure.
HANDLE stopRequested;
// Set once the last line is out, so a closing console can wait for the files to be saved.
HANDLE lastLinePrinted;

void printLine(std::string line) {
    line += '\n';
    DWORD written = 0;
    WriteFile(GetStdHandle(STD_OUTPUT_HANDLE), line.data(), static_cast<DWORD>(line.size()), &written, nullptr);
}

void watchStdin() {
    const HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
    std::string pending;
    char chunk[256];
    DWORD read = 0;
    while (ReadFile(input, chunk, sizeof(chunk), &read, nullptr) && read > 0) {
        pending.append(chunk, read);
        size_t lineEnd;
        while ((lineEnd = pending.find('\n')) != std::string::npos) {
            if (isStopLine(std::string_view(pending).substr(0, lineEnd))) {
                SetEvent(stopRequested);
                return;
            }
            pending.erase(0, lineEnd + 1);
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

// The newest monitor image, copied out of the capture's frame pool so that every tick can compose it again, or the
// failure that ended the capture.
class LatestFrame {
public:
    explicit LatestFrame(ID3D11Device* device) : arrived_(CreateEventW(nullptr, TRUE, FALSE, nullptr)) {
        if (!arrived_) throwLastError(FailureCode::internal, "Creating an event");
        device_.copy_from(device);
        device->GetImmediateContext(context_.put());
    }

    HANDLE arrived() const { return arrived_.get(); }

    void store(ID3D11Texture2D* frame, int64_t qpcTime) {
        D3D11_TEXTURE2D_DESC desc;
        frame->GetDesc(&desc);
        std::scoped_lock lock(mutex_);
        if (!image_ || !sameSize(desc)) image_ = textureLike(desc);
        context_->CopyResource(image_.get(), frame);
        capturedAt_ = qpcTime;
        SetEvent(arrived_.get());
    }

    void fail(std::exception_ptr failure) {
        std::scoped_lock lock(mutex_);
        if (!failure_) failure_ = failure;
    }

    void rethrowFailure() {
        std::scoped_lock lock(mutex_);
        if (failure_) std::rethrow_exception(failure_);
    }

    std::pair<winrt::com_ptr<ID3D11Texture2D>, int64_t> newest() {
        std::scoped_lock lock(mutex_);
        return {image_, capturedAt_};
    }

private:
    bool sameSize(const D3D11_TEXTURE2D_DESC& desc) const {
        D3D11_TEXTURE2D_DESC current;
        image_->GetDesc(&current);
        return current.Width == desc.Width && current.Height == desc.Height;
    }

    winrt::com_ptr<ID3D11Texture2D> textureLike(const D3D11_TEXTURE2D_DESC& frame) const {
        const D3D11_TEXTURE2D_DESC desc{.Width = frame.Width,
                                        .Height = frame.Height,
                                        .MipLevels = 1,
                                        .ArraySize = 1,
                                        .Format = frame.Format,
                                        .SampleDesc = {1, 0},
                                        .Usage = D3D11_USAGE_DEFAULT,
                                        .BindFlags = D3D11_BIND_SHADER_RESOURCE | D3D11_BIND_RENDER_TARGET};
        winrt::com_ptr<ID3D11Texture2D> texture;
        throwIfFailed(device_->CreateTexture2D(&desc, nullptr, texture.put()), FailureCode::internal,
                      "Keeping the latest frame");
        return texture;
    }

    winrt::handle arrived_;
    winrt::com_ptr<ID3D11Device> device_;
    winrt::com_ptr<ID3D11DeviceContext> context_;
    std::mutex mutex_;
    winrt::com_ptr<ID3D11Texture2D> image_;
    int64_t capturedAt_ = 0;
    std::exception_ptr failure_;
};

void record(const Args& args) {
    winrt::init_apartment(winrt::apartment_type::multi_threaded);
    MonitorCapture::requireSupport();
    RecordingTarget target(args);
    const std::filesystem::path folder(args.outDir);
    std::filesystem::create_directories(folder);

    const auto device = createDeviceFor(target.monitor());
    Compositor compositor(device.get(), target.width(), target.height());
    Mp4Writer video(device.get(), folder / L"video.mp4", target.width(), target.height(), args.fps);
    LatestFrame latest(device.get());
    std::optional<MonitorCapture> capture(
        std::in_place, device.get(), target.monitor(),
        [&latest](ID3D11Texture2D* frame, int64_t qpcTime) { latest.store(frame, qpcTime); },
        [&latest](std::exception_ptr failure) {
            latest.fail(failure);
            SetEvent(stopRequested);
        });

    const HANDLE startWaits[] = {stopRequested, latest.arrived()};
    if (WaitForMultipleObjects(2, startWaits, FALSE, INFINITE) != WAIT_OBJECT_0 + 1) {
        latest.rethrowFailure();
        throw Failure(FailureCode::internal, "Stopped before the first frame arrived");
    }
    printLine(readyLine(target.width(), target.height()));

    const RECT monitor = target.monitorRect();
    const auto composeNewest = [&] {
        const auto [image, capturedAt] = latest.newest();
        const Mapping now = target.current();
        // With nothing of the window on screen, an empty crop has the compositor hold the last frame.
        RECT crop = now.shown ? now.crop : RECT{};
        OffsetRect(&crop, -monitor.left, -monitor.top);
        return std::pair{compositor.compose(image.get(), crop), capturedAt};
    };

    Metronome frameClock(qpcNow(), args.fps);
    const auto [firstFrame, origin] = composeNewest();
    TrackWriter track;
    InputTracker mouse(track, [&target] { return target.current(); }, origin);
    video.write(firstFrame, 0);
    int64_t frames = 1;

    const HANDLE frameWaits[] = {stopRequested, frameClock.handle()};
    for (;;) {
        const DWORD woke = WaitForMultipleObjects(2, frameWaits, FALSE, INFINITE);
        if (woke == WAIT_OBJECT_0) break;
        if (woke != WAIT_OBJECT_0 + 1) throwLastError(FailureCode::internal, "Waiting for the next frame");
        const int64_t due = frameClock.rearm();
        if (target.isGone()) break;
        ID3D11Texture2D* frame = composeNewest().first;
        // Ticks missed while the encoder was busy get the same picture, so every frame keeps its place in time.
        for (; frames <= due; ++frames) video.write(frame, frames);
    }

    latest.rethrowFailure();
    capture.reset();
    mouse.finish();
    video.finish();
    const double durationMs = frames * 1000.0 / args.fps;
    if (!track.write(folder / L"track.json", target.kind(), target.width(), target.height(), args.fps, durationMs,
                     target.density()))
        throw Failure(FailureCode::internal, "Writing track.json failed");
    printLine(doneLine(durationMs, frames));
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
    stopRequested = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    lastLinePrinted = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    SetConsoleCtrlHandler(onConsoleEvent, TRUE);
    std::thread(watchStdin).detach();

    int exitCode = 1;
    try {
        const auto parsed = parseArgs(argc, argv);
        if (const auto* problem = std::get_if<std::string>(&parsed)) throw Failure(FailureCode::internal, *problem);
        // The manifest already asks for this; the call only matters if the helper ever loses its manifest.
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
