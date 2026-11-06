#include "input.h"

#include <hidusage.h>

#include <algorithm>

#include "failure.h"
#include "shapes.h"

namespace {

constexpr double SAMPLES_PER_SECOND = 120;
constexpr USHORT BUTTON_FLAGS =
    RI_MOUSE_LEFT_BUTTON_DOWN | RI_MOUSE_LEFT_BUTTON_UP | RI_MOUSE_RIGHT_BUTTON_DOWN | RI_MOUSE_RIGHT_BUTTON_UP;
constexpr wchar_t WINDOW_CLASS[] = L"CawmeraRecorderMouse";

consteval std::string_view knownShape(std::string_view name) {
    if (std::ranges::find(CURSOR_SHAPES, name) == CURSOR_SHAPES.end()) throw "not one of CURSOR_SHAPES";
    return name;
}

const std::pair<LPCWSTR, std::string_view> SYSTEM_CURSORS[] = {
    {IDC_ARROW, knownShape("arrow")},
    {IDC_HAND, knownShape("hand")},
    {IDC_IBEAM, knownShape("ibeam")},
    {IDC_WAIT, knownShape("wait")},
    {IDC_APPSTARTING, knownShape("progress")},
    {IDC_CROSS, knownShape("crosshair")},
    {IDC_NO, knownShape("not-allowed")},
    {IDC_SIZEALL, knownShape("move")},
    {IDC_SIZEWE, knownShape("resize-ew")},
    {IDC_SIZENS, knownShape("resize-ns")},
    {IDC_SIZENWSE, knownShape("resize-nwse")},
    {IDC_SIZENESW, knownShape("resize-nesw")},
    {IDC_HELP, knownShape("help")},
};
constexpr std::string_view OTHER_SHAPE = knownShape("other");

class MouseListener {
public:
    MouseListener() {
        const HINSTANCE instance = GetModuleHandleW(nullptr);
        const WNDCLASSEXW windowClass{.cbSize = sizeof(WNDCLASSEXW),
                                      .lpfnWndProc = DefWindowProcW,
                                      .hInstance = instance,
                                      .lpszClassName = WINDOW_CLASS};
        if (!RegisterClassExW(&windowClass) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS)
            throwLastError(FailureCode::internal, "Registering the mouse window");
        window_ = CreateWindowExW(0, WINDOW_CLASS, L"", 0, 0, 0, 0, 0, HWND_MESSAGE, nullptr, instance, nullptr);
        if (!window_) throwLastError(FailureCode::internal, "Creating the mouse window");

        const RAWINPUTDEVICE mouse{HID_USAGE_PAGE_GENERIC, HID_USAGE_GENERIC_MOUSE, RIDEV_INPUTSINK, window_};
        if (!RegisterRawInputDevices(&mouse, 1, sizeof(mouse))) {
            const DWORD error = GetLastError();
            DestroyWindow(window_);
            throw failureFor(HRESULT_FROM_WIN32(error), FailureCode::internal, "Listening to the mouse");
        }
    }

    ~MouseListener() {
        const RAWINPUTDEVICE mouse{HID_USAGE_PAGE_GENERIC, HID_USAGE_GENERIC_MOUSE, RIDEV_REMOVE, nullptr};
        RegisterRawInputDevices(&mouse, 1, sizeof(mouse));
        DestroyWindow(window_);
    }

    MouseListener(const MouseListener&) = delete;
    MouseListener& operator=(const MouseListener&) = delete;

private:
    HWND window_;
};

}  // namespace

InputTracker::InputTracker(TrackWriter& track, std::function<Mapping()> currentMapping, int64_t originQpc)
    : track_(track),
      currentMapping_(std::move(currentMapping)),
      originQpc_(originQpc),
      stop_(CreateEventW(nullptr, TRUE, FALSE, nullptr)) {
    if (!stop_) throwLastError(FailureCode::internal, "Creating an event");
    for (const auto& [id, shape] : SYSTEM_CURSORS) systemCursors_.push_back({LoadCursorW(nullptr, id), shape});

    std::promise<void> started;
    std::future<void> ready = started.get_future();
    thread_ = std::jthread([this, started = std::move(started)]() mutable { run(std::move(started)); });
    ready.get();
}

InputTracker::~InputTracker() {
    SetEvent(stop_.get());
}

void InputTracker::finish() {
    SetEvent(stop_.get());
    thread_.join();
    if (failure_) std::rethrow_exception(failure_);
}

void InputTracker::run(std::promise<void> started) {
    bool listening = false;
    try {
        const MouseListener mouse;
        Metronome sampler(qpcNow(), SAMPLES_PER_SECOND);
        started.set_value();
        listening = true;
        sampleCursor();
        listen(sampler);
    } catch (...) {
        if (listening)
            failure_ = std::current_exception();
        else
            started.set_exception(std::current_exception());
    }
}

void InputTracker::listen(Metronome& sampler) {
    const HANDLE waits[] = {stop_.get(), sampler.handle()};
    for (;;) {
        const DWORD woke = MsgWaitForMultipleObjectsEx(2, waits, INFINITE, QS_ALLINPUT, MWMO_INPUTAVAILABLE);
        if (woke == WAIT_OBJECT_0) return;
        if (woke == WAIT_OBJECT_0 + 1) {
            sampler.armAfter(sampler.latestBeat());
            sampleCursor();
        } else if (woke == WAIT_OBJECT_0 + 2) {
            MSG message;
            while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
                if (message.message == WM_INPUT) onRawInput(reinterpret_cast<HRAWINPUT>(message.lParam));
                DispatchMessageW(&message);
            }
        } else {
            throwLastError(FailureCode::internal, "Waiting for the mouse");
        }
    }
}

void InputTracker::sampleCursor() {
    const double t = msSinceOrigin(qpcNow());
    CURSORINFO cursor{.cbSize = sizeof(CURSORINFO)};
    if (!GetCursorInfo(&cursor)) return;
    const Mapping mapping = currentMapping_();
    const auto [x, y] = screenToVideo(cursor.ptScreenPos.x, cursor.ptScreenPos.y, mapping.crop, mapping.fit);
    // While the window is hidden, the video holds an old frame the cursor isn't over.
    track_.addCursor(t, x, y, mapping.shown ? shapeOf(cursor) : TrackWriter::HIDDEN_SHAPE);
}

void InputTracker::onRawInput(HRAWINPUT input) {
    const double t = msSinceOrigin(qpcNow());
    RAWINPUT data;
    UINT size = sizeof(data);
    if (GetRawInputData(input, RID_INPUT, &data, &size, sizeof(RAWINPUTHEADER)) == static_cast<UINT>(-1) ||
        data.header.dwType != RIM_TYPEMOUSE)
        return;
    const USHORT buttons = data.data.mouse.usButtonFlags;
    POINT position;
    if (!(buttons & BUTTON_FLAGS) || !GetCursorPos(&position)) return;

    // Raw Input reports physical buttons; with them swapped for the left hand, the right one is the primary click.
    const bool swapped = GetSystemMetrics(SM_SWAPBUTTON) != 0;
    const MouseButton physicalLeft = swapped ? MouseButton::right : MouseButton::left;
    const MouseButton physicalRight = swapped ? MouseButton::left : MouseButton::right;
    const Mapping mapping = currentMapping_();
    const auto [x, y] = screenToVideo(position.x, position.y, mapping.crop, mapping.fit);
    // A press can't land on a hidden window, but a release still ends a press made before it hid.
    if (mapping.shown && (buttons & RI_MOUSE_LEFT_BUTTON_DOWN)) track_.addClick(t, x, y, physicalLeft);
    if (buttons & RI_MOUSE_LEFT_BUTTON_UP) track_.release(physicalLeft, t);
    if (mapping.shown && (buttons & RI_MOUSE_RIGHT_BUTTON_DOWN)) track_.addClick(t, x, y, physicalRight);
    if (buttons & RI_MOUSE_RIGHT_BUTTON_UP) track_.release(physicalRight, t);
}

double InputTracker::msSinceOrigin(int64_t qpc) const {
    return qpcToMs(qpc - originQpc_);
}

int InputTracker::shapeOf(const CURSORINFO& cursor) {
    const bool drawn = (cursor.flags & CURSOR_SHOWING) && !(cursor.flags & CURSOR_SUPPRESSED) && cursor.hCursor;
    if (!drawn) return TrackWriter::HIDDEN_SHAPE;
    if (cursor.hCursor != lastCursor_) {
        const auto known = std::ranges::find(systemCursors_, cursor.hCursor, &SystemCursor::handle);
        lastShape_ = track_.shapeIndex(known != systemCursors_.end() ? known->shape : OTHER_SHAPE);
        lastCursor_ = cursor.hCursor;
    }
    return lastShape_;
}
