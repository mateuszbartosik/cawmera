#include "compositor.h"

#include <algorithm>
#include <cstdint>
#include <string_view>
#include <vector>

#include "failure.h"

namespace {

constexpr uint8_t BLACK_LUMA = 16;
constexpr uint8_t NEUTRAL_CHROMA = 128;

void check(HRESULT hr, std::string_view step) {
    throwIfFailed(hr, FailureCode::internal, step);
}

}  // namespace

Compositor::Compositor(ID3D11Device* device, int outW, int outH) : outW_(outW), outH_(outH) {
    winrt::com_ptr<ID3D11Device> sharedDevice;
    sharedDevice.copy_from(device);
    device->GetImmediateContext(context_.put());
    videoDevice_ = sharedDevice.try_as<ID3D11VideoDevice>();
    videoContext_ = context_.try_as<ID3D11VideoContext>();
    if (!videoDevice_ || !videoContext_)
        throw Failure(FailureCode::unsupported, "The graphics device can't convert frames to video");

    const size_t lumaPlaneSize = static_cast<size_t>(outW) * outH;
    const size_t chromaPlaneSize = lumaPlaneSize / 2;
    std::vector<uint8_t> black(lumaPlaneSize + chromaPlaneSize, NEUTRAL_CHROMA);
    std::fill_n(black.begin(), lumaPlaneSize, BLACK_LUMA);
    const D3D11_SUBRESOURCE_DATA initial{.pSysMem = black.data(), .SysMemPitch = static_cast<UINT>(outW)};
    const D3D11_TEXTURE2D_DESC desc{.Width = static_cast<UINT>(outW),
                                    .Height = static_cast<UINT>(outH),
                                    .MipLevels = 1,
                                    .ArraySize = 1,
                                    .Format = DXGI_FORMAT_NV12,
                                    .SampleDesc = {1, 0},
                                    .Usage = D3D11_USAGE_DEFAULT,
                                    .BindFlags = D3D11_BIND_RENDER_TARGET};
    check(device->CreateTexture2D(&desc, &initial, output_.put()), "Creating the video frame");
    check(device->CreateTexture2D(&desc, &initial, black_.put()), "Creating the video frame");
}

ID3D11Texture2D* Compositor::compose(ID3D11Texture2D* monitor, const Mapping& mappingOnMonitor) {
    if (!mappingOnMonitor.shown) return output_.get();
    D3D11_TEXTURE2D_DESC desc;
    monitor->GetDesc(&desc);
    const RECT monitorRect{0, 0, static_cast<LONG>(desc.Width), static_cast<LONG>(desc.Height)};
    const Blit blit = blitOf(mappingOnMonitor, monitorRect, outW_, outH_);
    if (IsRectEmpty(&blit.destination)) {
        context_->CopyResource(output_.get(), black_.get());
        return output_.get();
    }

    prepareFor(monitor, desc.Width, desc.Height);
    videoContext_->VideoProcessorSetStreamSourceRect(processor_.get(), 0, TRUE, &blit.source);
    videoContext_->VideoProcessorSetStreamDestRect(processor_.get(), 0, TRUE, &blit.destination);
    D3D11_VIDEO_PROCESSOR_STREAM stream{.Enable = TRUE, .pInputSurface = inputView_.get()};
    check(videoContext_->VideoProcessorBlt(processor_.get(), outputView_.get(), 0, 1, &stream),
          "Composing a video frame");
    return output_.get();
}

void Compositor::prepareFor(ID3D11Texture2D* monitor, UINT width, UINT height) {
    if (width != inputW_ || height != inputH_) {
        createProcessor(width, height);
        input_ = nullptr;
    }
    if (input_.get() != monitor) {
        inputView_ = nullptr;
        const D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC viewDesc{.ViewDimension = D3D11_VPIV_DIMENSION_TEXTURE2D};
        check(videoDevice_->CreateVideoProcessorInputView(monitor, enumerator_.get(), &viewDesc, inputView_.put()),
              "Reading the monitor frame");
        input_.copy_from(monitor);
    }
}

void Compositor::createProcessor(UINT inputW, UINT inputH) {
    enumerator_ = nullptr;
    processor_ = nullptr;
    outputView_ = nullptr;
    const D3D11_VIDEO_PROCESSOR_CONTENT_DESC content{.InputFrameFormat = D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
                                                     .InputWidth = inputW,
                                                     .InputHeight = inputH,
                                                     .OutputWidth = static_cast<UINT>(outW_),
                                                     .OutputHeight = static_cast<UINT>(outH_),
                                                     .Usage = D3D11_VIDEO_USAGE_OPTIMAL_QUALITY};
    check(videoDevice_->CreateVideoProcessorEnumerator(&content, enumerator_.put()), "Setting up video conversion");
    requireFormat(DXGI_FORMAT_B8G8R8A8_UNORM, D3D11_VIDEO_PROCESSOR_FORMAT_SUPPORT_INPUT);
    requireFormat(DXGI_FORMAT_NV12, D3D11_VIDEO_PROCESSOR_FORMAT_SUPPORT_OUTPUT);
    check(videoDevice_->CreateVideoProcessor(enumerator_.get(), 0, processor_.put()), "Setting up video conversion");
    const D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC viewDesc{.ViewDimension = D3D11_VPOV_DIMENSION_TEXTURE2D};
    check(videoDevice_->CreateVideoProcessorOutputView(output_.get(), enumerator_.get(), &viewDesc, outputView_.put()),
          "Setting up video conversion");

    ID3D11VideoProcessor* processor = processor_.get();
    const RECT wholeFrame{0, 0, outW_, outH_};
    videoContext_->VideoProcessorSetOutputTargetRect(processor, TRUE, &wholeFrame);
    D3D11_VIDEO_COLOR black{};
    black.RGBA = {0.0f, 0.0f, 0.0f, 1.0f};
    videoContext_->VideoProcessorSetOutputBackgroundColor(processor, FALSE, &black);
    // The screen is full-range RGB; the video is BT.709 in the 16–235 range that players expect.
    const D3D11_VIDEO_PROCESSOR_COLOR_SPACE screen{.RGB_Range = 0};
    const D3D11_VIDEO_PROCESSOR_COLOR_SPACE video{.YCbCr_Matrix = 1,
                                                  .Nominal_Range = D3D11_VIDEO_PROCESSOR_NOMINAL_RANGE_16_235};
    videoContext_->VideoProcessorSetStreamColorSpace(processor, 0, &screen);
    videoContext_->VideoProcessorSetOutputColorSpace(processor, &video);
    videoContext_->VideoProcessorSetStreamFrameFormat(processor, 0, D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE);
    // Left on, some drivers sharpen or denoise the picture, which smears small text.
    videoContext_->VideoProcessorSetStreamAutoProcessingMode(processor, 0, FALSE);
    inputW_ = inputW;
    inputH_ = inputH;
}

void Compositor::requireFormat(DXGI_FORMAT format, UINT support) const {
    UINT supported = 0;
    if (FAILED(enumerator_->CheckVideoProcessorFormat(format, &supported)) || !(supported & support))
        throw Failure(FailureCode::unsupported, "The graphics device can't convert frames to video");
}
