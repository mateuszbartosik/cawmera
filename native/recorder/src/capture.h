#pragma once

#include <windows.h>
#include <unknwn.h>

#include <d3d11.h>

#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>

#include <cstdint>
#include <exception>
#include <functional>
#include <memory>
#include <mutex>

winrt::com_ptr<ID3D11Device> createDeviceFor(HMONITOR monitor);

class MonitorCapture {
public:
    using FrameHandler = std::function<void(ID3D11Texture2D* frame, int64_t qpcTime)>;
    using FailureHandler = std::function<void(std::exception_ptr failure)>;
    using ClosedHandler = std::function<void()>;

    static void requireSupport();
    static void requireAccess();

    MonitorCapture(ID3D11Device* device, HMONITOR monitor, FrameHandler onFrame, FailureHandler onFailure,
                   ClosedHandler onClosed);
    ~MonitorCapture();
    MonitorCapture(const MonitorCapture&) = delete;
    MonitorCapture& operator=(const MonitorCapture&) = delete;

private:
    struct Delivery;

    std::shared_ptr<Delivery> delivery_;
    winrt::Windows::Graphics::Capture::GraphicsCaptureItem item_{nullptr};
    winrt::Windows::Graphics::Capture::GraphicsCaptureItem::Closed_revoker closed_;
    winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool pool_{nullptr};
    winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool::FrameArrived_revoker frameArrived_;
    winrt::Windows::Graphics::Capture::GraphicsCaptureSession session_{nullptr};
};

class LatestFrame {
public:
    explicit LatestFrame(ID3D11Device* device);

    HANDLE arrived() const { return arrived_.get(); }
    void store(ID3D11Texture2D* frame);
    void fail(std::exception_ptr failure);
    void rethrowFailure();
    winrt::com_ptr<ID3D11Texture2D> newest();

private:
    winrt::handle arrived_;
    winrt::com_ptr<ID3D11Device> device_;
    winrt::com_ptr<ID3D11DeviceContext> context_;
    std::mutex mutex_;
    winrt::com_ptr<ID3D11Texture2D> image_;
    std::exception_ptr failure_;
};
