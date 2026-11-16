#include "capture.h"

#include <d3d11_4.h>
#include <dxgi.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>

#include <winrt/Windows.Foundation.Metadata.h>

#include <optional>

#include "access.h"
#include "clock.h"
#include "failure.h"

namespace {

using winrt::Windows::Foundation::Metadata::ApiInformation;
using winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool;
using winrt::Windows::Graphics::Capture::GraphicsCaptureAccess;
using winrt::Windows::Graphics::Capture::GraphicsCaptureAccessKind;
using winrt::Windows::Graphics::Capture::GraphicsCaptureItem;
using winrt::Windows::Graphics::Capture::GraphicsCaptureSession;
using winrt::Windows::Graphics::DirectX::DirectXPixelFormat;
using winrt::Windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
using ::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess;

constexpr auto PIXEL_FORMAT = DirectXPixelFormat::B8G8R8A8UIntNormalized;
constexpr int32_t FRAME_BUFFERS = 2;

winrt::com_ptr<IDXGIAdapter1> adapterShowing(HMONITOR monitor) {
    winrt::com_ptr<IDXGIFactory1> factory;
    if (FAILED(CreateDXGIFactory1(IID_PPV_ARGS(factory.put())))) return nullptr;
    for (UINT a = 0;; ++a) {
        winrt::com_ptr<IDXGIAdapter1> adapter;
        if (FAILED(factory->EnumAdapters1(a, adapter.put()))) return nullptr;
        for (UINT o = 0;; ++o) {
            winrt::com_ptr<IDXGIOutput> output;
            if (FAILED(adapter->EnumOutputs(o, output.put()))) break;
            DXGI_OUTPUT_DESC description;
            if (SUCCEEDED(output->GetDesc(&description)) && description.Monitor == monitor) return adapter;
        }
    }
}

HRESULT createDevice(IDXGIAdapter* adapter, winrt::com_ptr<ID3D11Device>& device) {
    const D3D_DRIVER_TYPE driver = adapter ? D3D_DRIVER_TYPE_UNKNOWN : D3D_DRIVER_TYPE_HARDWARE;
    const UINT flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT;
    winrt::com_ptr<ID3D11Device> created;
    const HRESULT hr = D3D11CreateDevice(adapter, driver, nullptr, flags, nullptr, 0, D3D11_SDK_VERSION,
                                         created.put(), nullptr, nullptr);
    if (SUCCEEDED(hr)) device = created;
    return hr;
}

bool sameSize(ID3D11Texture2D* texture, const D3D11_TEXTURE2D_DESC& desc) {
    D3D11_TEXTURE2D_DESC current;
    texture->GetDesc(&current);
    return current.Width == desc.Width && current.Height == desc.Height;
}

winrt::com_ptr<ID3D11Texture2D> textureLike(ID3D11Device* device, const D3D11_TEXTURE2D_DESC& frame) {
    const D3D11_TEXTURE2D_DESC desc{.Width = frame.Width,
                                    .Height = frame.Height,
                                    .MipLevels = 1,
                                    .ArraySize = 1,
                                    .Format = frame.Format,
                                    .SampleDesc = {1, 0},
                                    .Usage = D3D11_USAGE_DEFAULT,
                                    .BindFlags = D3D11_BIND_SHADER_RESOURCE | D3D11_BIND_RENDER_TARGET};
    winrt::com_ptr<ID3D11Texture2D> texture;
    throwIfFailed(device->CreateTexture2D(&desc, nullptr, texture.put()), FailureCode::internal,
                  "Keeping the latest frame");
    return texture;
}

std::optional<CaptureAccessStatus> programmaticCaptureAccess() {
    try {
        if (!ApiInformation::IsTypePresent(L"Windows.Graphics.Capture.GraphicsCaptureAccess")) return std::nullopt;
        return answerInTime(GraphicsCaptureAccess::RequestAccessAsync(GraphicsCaptureAccessKind::Programmatic));
    } catch (const winrt::hresult_error&) {
        return std::nullopt;
    }
}

}  // namespace

// WinRT can still be running a handler when the capture is destroyed, so the handlers hold this instead.
struct MonitorCapture::Delivery {
    FrameHandler onFrame;
    FailureHandler onFailure;
    ClosedHandler onClosed;
    IDirect3DDevice device{nullptr};
    winrt::Windows::Graphics::SizeInt32 size{};
    std::mutex mutex;
    bool open = true;

    void frameArrived(Direct3D11CaptureFramePool const& pool) {
        std::scoped_lock lock(mutex);
        if (!open) return;
        try {
            const auto frame = pool.TryGetNextFrame();
            if (!frame) return;
            if (frame.ContentSize() != size) {
                size = frame.ContentSize();
                pool.Recreate(device, PIXEL_FORMAT, FRAME_BUFFERS, size);
                return;
            }
            winrt::com_ptr<ID3D11Texture2D> texture;
            winrt::check_hresult(
                frame.Surface().as<IDirect3DDxgiInterfaceAccess>()->GetInterface(IID_PPV_ARGS(texture.put())));
            onFrame(texture.get(), qpcFromHundredNs(frame.SystemRelativeTime().count()));
        } catch (...) {
            open = false;
            onFailure(std::current_exception());
        }
    }

    void itemClosed() {
        std::scoped_lock lock(mutex);
        if (!open) return;
        open = false;
        onClosed();
    }

    void close() {
        std::scoped_lock lock(mutex);
        open = false;
    }
};

winrt::com_ptr<ID3D11Device> createDeviceFor(HMONITOR monitor) {
    winrt::com_ptr<ID3D11Device> device;
    // The monitor's own GPU saves copying every frame across GPUs; any hardware device still works.
    const auto adapter = adapterShowing(monitor);
    if (!adapter || FAILED(createDevice(adapter.get(), device)))
        throwIfFailed(createDevice(nullptr, device), FailureCode::unsupported, "Creating a Direct3D device");

    winrt::com_ptr<ID3D11DeviceContext> context;
    device->GetImmediateContext(context.put());
    // Capture, the compositor and the encoder use the device from different threads.
    context.as<ID3D11Multithread>()->SetMultithreadProtected(TRUE);
    return device;
}

void MonitorCapture::requireSupport() {
    bool captureSupported = false;
    try {
        captureSupported = GraphicsCaptureSession::IsSupported();
    } catch (const winrt::hresult_error&) {
    }
    if (!captureSupported) throw Failure(FailureCode::unsupported, "Windows can't capture the screen on this PC");
    if (!ApiInformation::IsPropertyPresent(L"Windows.Graphics.Capture.GraphicsCaptureSession",
                                           L"IsCursorCaptureEnabled"))
        throw Failure(FailureCode::unsupported, "Recording needs Windows 10 version 2004 or later");
}

void MonitorCapture::requireAccess() {
    requireCaptureAllowed(programmaticCaptureAccess());
}

MonitorCapture::MonitorCapture(ID3D11Device* device, HMONITOR monitor, FrameHandler onFrame,
                               FailureHandler onFailure, ClosedHandler onClosed)
    : delivery_(std::make_shared<Delivery>()) {
    delivery_->onFrame = std::move(onFrame);
    delivery_->onFailure = std::move(onFailure);
    delivery_->onClosed = std::move(onClosed);
    try {
        winrt::com_ptr<IDXGIDevice> dxgiDevice;
        winrt::check_hresult(device->QueryInterface(IID_PPV_ARGS(dxgiDevice.put())));
        winrt::com_ptr<::IInspectable> inspectable;
        winrt::check_hresult(CreateDirect3D11DeviceFromDXGIDevice(dxgiDevice.get(), inspectable.put()));
        delivery_->device = inspectable.as<IDirect3DDevice>();

        const auto interop = winrt::get_activation_factory<GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
        winrt::check_hresult(
            interop->CreateForMonitor(monitor, winrt::guid_of<GraphicsCaptureItem>(), winrt::put_abi(item_)));
        delivery_->size = item_.Size();

        pool_ = Direct3D11CaptureFramePool::CreateFreeThreaded(delivery_->device, PIXEL_FORMAT, FRAME_BUFFERS,
                                                              delivery_->size);
        frameArrived_ = pool_.FrameArrived(
            winrt::auto_revoke,
            [delivery = delivery_](Direct3D11CaptureFramePool const& pool, auto&&) { delivery->frameArrived(pool); });
        closed_ = item_.Closed(winrt::auto_revoke, [delivery = delivery_](auto&&, auto&&) { delivery->itemClosed(); });
        session_ = pool_.CreateCaptureSession(item_);
        session_.IsCursorCaptureEnabled(false);
        session_.StartCapture();
    } catch (const winrt::hresult_error& error) {
        delivery_->close();
        const HRESULT hr = error.code();
        throw failureFor(hr, hr == E_ACCESSDENIED ? FailureCode::accessDenied : FailureCode::internal,
                         "Starting screen capture");
    }
}

MonitorCapture::~MonitorCapture() {
    delivery_->close();
    frameArrived_.revoke();
    closed_.revoke();
    try {
        session_.Close();
        pool_.Close();
    } catch (const winrt::hresult_error&) {
        // A destructor can't throw, and the capture is ending either way.
    }
}

LatestFrame::LatestFrame(ID3D11Device* device) : arrived_(CreateEventW(nullptr, TRUE, FALSE, nullptr)) {
    if (!arrived_) throwLastError(FailureCode::internal, "Creating an event");
    device_.copy_from(device);
    device->GetImmediateContext(context_.put());
}

void LatestFrame::store(ID3D11Texture2D* frame) {
    D3D11_TEXTURE2D_DESC desc;
    frame->GetDesc(&desc);
    std::scoped_lock lock(mutex_);
    if (!image_ || !sameSize(image_.get(), desc)) image_ = textureLike(device_.get(), desc);
    context_->CopyResource(image_.get(), frame);
    SetEvent(arrived_.get());
}

void LatestFrame::fail(std::exception_ptr failure) {
    std::scoped_lock lock(mutex_);
    if (!failure_) failure_ = failure;
}

void LatestFrame::rethrowFailure() {
    std::scoped_lock lock(mutex_);
    if (failure_) std::rethrow_exception(failure_);
}

winrt::com_ptr<ID3D11Texture2D> LatestFrame::newest() {
    std::scoped_lock lock(mutex_);
    return image_;
}
