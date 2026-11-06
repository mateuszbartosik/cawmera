#pragma once

#include <windows.h>
#include <unknwn.h>

#include <d3d11.h>

#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>

#include <cstdint>
#include <exception>
#include <functional>
#include <mutex>

// A device on the GPU that shows `monitor`, set up for capture, video processing and Media Foundation.
winrt::com_ptr<ID3D11Device> createDeviceFor(HMONITOR monitor);

// Captures a monitor with Windows.Graphics.Capture, without the cursor.
class MonitorCapture {
public:
    using FrameHandler = std::function<void(ID3D11Texture2D* frame, int64_t qpcTime)>;
    using FailureHandler = std::function<void(std::exception_ptr failure)>;

    // Throws Failure: unsupported before Windows 10 version 2004, access-denied when capture is blocked.
    static void requireSupport();

    // Frames and the first failure arrive on a capture thread; nothing arrives once the capture is destroyed.
    MonitorCapture(ID3D11Device* device, HMONITOR monitor, FrameHandler onFrame, FailureHandler onFailure);
    ~MonitorCapture();
    MonitorCapture(const MonitorCapture&) = delete;
    MonitorCapture& operator=(const MonitorCapture&) = delete;

private:
    void onFrameArrived(winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool const& pool,
                        winrt::Windows::Foundation::IInspectable const&);

    FrameHandler onFrame_;
    FailureHandler onFailure_;
    std::mutex deliveryMutex_;
    bool delivering_ = true;

    winrt::Windows::Graphics::DirectX::Direct3D11::IDirect3DDevice device_{nullptr};
    winrt::Windows::Graphics::SizeInt32 size_{};
    winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool pool_{nullptr};
    winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool::FrameArrived_revoker frameArrived_;
    winrt::Windows::Graphics::Capture::GraphicsCaptureSession session_{nullptr};
};
