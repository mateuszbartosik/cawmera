#include "capture.h"

#include <d3d11_4.h>
#include <dxgi.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>

#include <winrt/Windows.Foundation.Metadata.h>

#include "clock.h"
#include "failure.h"

namespace {

using winrt::Windows::Foundation::Metadata::ApiInformation;
using winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool;
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

}  // namespace

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

MonitorCapture::MonitorCapture(ID3D11Device* device, HMONITOR monitor, FrameHandler onFrame,
                               FailureHandler onFailure)
    : onFrame_(std::move(onFrame)), onFailure_(std::move(onFailure)) {
    try {
        winrt::com_ptr<IDXGIDevice> dxgiDevice;
        winrt::check_hresult(device->QueryInterface(IID_PPV_ARGS(dxgiDevice.put())));
        winrt::com_ptr<::IInspectable> inspectable;
        winrt::check_hresult(CreateDirect3D11DeviceFromDXGIDevice(dxgiDevice.get(), inspectable.put()));
        device_ = inspectable.as<IDirect3DDevice>();

        const auto interop = winrt::get_activation_factory<GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
        GraphicsCaptureItem item{nullptr};
        winrt::check_hresult(
            interop->CreateForMonitor(monitor, winrt::guid_of<GraphicsCaptureItem>(), winrt::put_abi(item)));
        size_ = item.Size();

        pool_ = Direct3D11CaptureFramePool::CreateFreeThreaded(device_, PIXEL_FORMAT, FRAME_BUFFERS, size_);
        frameArrived_ = pool_.FrameArrived(winrt::auto_revoke, {this, &MonitorCapture::onFrameArrived});
        session_ = pool_.CreateCaptureSession(item);
        session_.IsCursorCaptureEnabled(false);
        session_.StartCapture();
    } catch (const winrt::hresult_error& error) {
        const HRESULT hr = error.code();
        throw failureFor(hr, hr == E_ACCESSDENIED ? FailureCode::accessDenied : FailureCode::internal,
                         "Starting screen capture");
    }
}

MonitorCapture::~MonitorCapture() {
    {
        std::scoped_lock lock(deliveryMutex_);
        delivering_ = false;
    }
    frameArrived_.revoke();
    try {
        session_.Close();
        pool_.Close();
    } catch (const winrt::hresult_error&) {
        // The recording is over either way.
    }
}

void MonitorCapture::onFrameArrived(Direct3D11CaptureFramePool const& pool,
                                    winrt::Windows::Foundation::IInspectable const&) {
    std::scoped_lock lock(deliveryMutex_);
    if (!delivering_) return;
    try {
        const auto frame = pool.TryGetNextFrame();
        if (!frame) return;
        if (frame.ContentSize() != size_) {
            size_ = frame.ContentSize();
            pool.Recreate(device_, PIXEL_FORMAT, FRAME_BUFFERS, size_);
            return;
        }

        winrt::com_ptr<ID3D11Texture2D> texture;
        winrt::check_hresult(
            frame.Surface().as<IDirect3DDxgiInterfaceAccess>()->GetInterface(IID_PPV_ARGS(texture.put())));
        onFrame_(texture.get(), qpcFromHundredNs(frame.SystemRelativeTime().count()));
    } catch (...) {
        delivering_ = false;
        onFailure_(std::current_exception());
    }
}
