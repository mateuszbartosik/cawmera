#include "encoder.h"

#include <codecapi.h>
#include <mfapi.h>
#include <mferror.h>
#include <mftransform.h>

#include <algorithm>
#include <string_view>

#include "clock.h"
#include "failure.h"

namespace {

constexpr double BITS_PER_PIXEL = 0.12;
constexpr double MIN_BITRATE = 8'000'000;
constexpr double MAX_BITRATE = 40'000'000;
// The hardware encoder holds several frames to look ahead; fewer samples would stall it.
constexpr DWORD INITIAL_SAMPLES = 4;
constexpr DWORD MAX_SAMPLES = 16;
constexpr int64_t SAMPLE_WAIT_MS = 1000;

void check(HRESULT hr, std::string_view step) {
    throwIfFailed(hr, FailureCode::encoder, step);
}

int64_t frameTime(int64_t frameIndex, int fps) {
    return frameIndex * HUNDRED_NS_PER_SECOND / fps;
}

UINT32 bitrateFor(int width, int height, int fps) {
    const double bitrate = static_cast<double>(width) * height * fps * BITS_PER_PIXEL;
    return static_cast<UINT32>(std::clamp(bitrate, MIN_BITRATE, MAX_BITRATE));
}

winrt::com_ptr<IMFMediaType> videoType(const GUID& subtype, int width, int height, int fps) {
    constexpr std::string_view step = "Describing the video";
    winrt::com_ptr<IMFMediaType> type;
    check(MFCreateMediaType(type.put()), step);
    check(type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video), step);
    check(type->SetGUID(MF_MT_SUBTYPE, subtype), step);
    check(type->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive), step);
    check(MFSetAttributeSize(type.get(), MF_MT_FRAME_SIZE, width, height), step);
    check(MFSetAttributeRatio(type.get(), MF_MT_FRAME_RATE, fps, 1), step);
    check(MFSetAttributeRatio(type.get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1), step);
    // The compositor writes BT.709 at 16–235; these tags let players read it that way.
    check(type->SetUINT32(MF_MT_VIDEO_NOMINAL_RANGE, MFNominalRange_16_235), step);
    check(type->SetUINT32(MF_MT_YUV_MATRIX, MFVideoTransferMatrix_BT709), step);
    check(type->SetUINT32(MF_MT_VIDEO_PRIMARIES, MFVideoPrimaries_BT709), step);
    check(type->SetUINT32(MF_MT_TRANSFER_FUNCTION, MFVideoTransFunc_709), step);
    return type;
}

}  // namespace

Mp4Writer::MediaFoundation::MediaFoundation() {
    // Lite leaves out the sockets library: the helper never touches the network.
    check(MFStartup(MF_VERSION, MFSTARTUP_LITE), "Starting Media Foundation");
}

Mp4Writer::MediaFoundation::~MediaFoundation() {
    MFShutdown();
}

Mp4Writer::Mp4Writer(ID3D11Device* device, const std::filesystem::path& path, int width, int height, int fps)
    : fps_(fps) {
    device->GetImmediateContext(context_.put());
    UINT resetToken = 0;
    check(MFCreateDXGIDeviceManager(&resetToken, deviceManager_.put()), "Sharing the GPU with the encoder");
    check(deviceManager_->ResetDevice(device, resetToken), "Sharing the GPU with the encoder");

    constexpr std::string_view fileStep = "Setting up the MP4 file";
    winrt::com_ptr<IMFAttributes> options;
    check(MFCreateAttributes(options.put(), 3), fileStep);
    check(options->SetUnknown(MF_SINK_WRITER_D3D_MANAGER, deviceManager_.get()), fileStep);
    check(options->SetUINT32(MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, TRUE), fileStep);
    check(options->SetGUID(MF_TRANSCODE_CONTAINERTYPE, MFTranscodeContainerType_MPEG4), fileStep);
    check(MFCreateSinkWriterFromURL(path.c_str(), nullptr, options.get(), sinkWriter_.put()), "Creating the MP4 file");

    constexpr std::string_view encoderStep = "Setting up the H.264 encoder";
    const auto h264 = videoType(MFVideoFormat_H264, width, height, fps);
    check(h264->SetUINT32(MF_MT_AVG_BITRATE, bitrateFor(width, height, fps)), encoderStep);
    check(h264->SetUINT32(MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_High), encoderStep);
    check(sinkWriter_->AddStream(h264.get(), &stream_), encoderStep);
    const auto nv12 = videoType(MFVideoFormat_NV12, width, height, fps);
    check(sinkWriter_->SetInputMediaType(stream_, nv12.get(), nullptr), encoderStep);

    constexpr std::string_view samplesStep = "Setting up video frames";
    check(MFCreateVideoSampleAllocatorEx(IID_PPV_ARGS(samples_.put())), samplesStep);
    check(samples_->SetDirectXManager(deviceManager_.get()), samplesStep);
    winrt::com_ptr<IMFAttributes> sampleOptions;
    check(MFCreateAttributes(sampleOptions.put(), 2), samplesStep);
    check(sampleOptions->SetUINT32(MF_SA_D3D11_BINDFLAGS, D3D11_BIND_RENDER_TARGET), samplesStep);
    check(sampleOptions->SetUINT32(MF_SA_D3D11_USAGE, D3D11_USAGE_DEFAULT), samplesStep);
    check(samples_->InitializeSampleAllocatorEx(INITIAL_SAMPLES, MAX_SAMPLES, sampleOptions.get(), nv12.get()),
          samplesStep);

    check(sinkWriter_->BeginWriting(), "Starting the MP4 file");
}

void Mp4Writer::write(ID3D11Texture2D* nv12, int64_t frameIndex) {
    constexpr std::string_view step = "Preparing a video frame";
    // The encoder may still be reading earlier frames, so each one goes into a sample of its own.
    const auto sample = freeSample();
    winrt::com_ptr<IMFMediaBuffer> buffer;
    check(sample->GetBufferByIndex(0, buffer.put()), step);
    winrt::com_ptr<IMFDXGIBuffer> surface;
    check(buffer->QueryInterface(IID_PPV_ARGS(surface.put())), step);
    winrt::com_ptr<ID3D11Texture2D> texture;
    check(surface->GetResource(IID_PPV_ARGS(texture.put())), step);
    UINT subresource = 0;
    check(surface->GetSubresourceIndex(&subresource), step);
    context_->CopySubresourceRegion(texture.get(), subresource, 0, 0, 0, nv12, 0, nullptr);

    winrt::com_ptr<IMF2DBuffer> picture;
    check(buffer->QueryInterface(IID_PPV_ARGS(picture.put())), step);
    DWORD length = 0;
    check(picture->GetContiguousLength(&length), step);
    check(buffer->SetCurrentLength(length), step);

    const int64_t time = frameTime(frameIndex, fps_);
    check(sample->SetSampleTime(time), step);
    check(sample->SetSampleDuration(frameTime(frameIndex + 1, fps_) - time), step);
    check(sinkWriter_->WriteSample(stream_, sample.get()), "Encoding a video frame");
}

void Mp4Writer::finish() {
    check(sinkWriter_->Finalize(), "Finishing the MP4 file");
}

winrt::com_ptr<IMFSample> Mp4Writer::freeSample() {
    const int64_t giveUpAt = qpcNow() + SAMPLE_WAIT_MS * qpcPerSecond() / 1000;
    for (;;) {
        winrt::com_ptr<IMFSample> sample;
        const HRESULT hr = samples_->AllocateSample(sample.put());
        if (hr != MF_E_SAMPLEALLOCATOR_EMPTY || qpcNow() > giveUpAt) {
            check(hr, "Getting a free video frame");
            return sample;
        }
        Sleep(1);
    }
}
