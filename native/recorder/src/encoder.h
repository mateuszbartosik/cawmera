#pragma once

#include <windows.h>
#include <unknwn.h>

#include <d3d11.h>
#include <mfidl.h>
#include <mfreadwrite.h>

#include <winrt/base.h>

#include <cstdint>
#include <filesystem>

class Mp4Writer {
public:
    Mp4Writer(ID3D11Device* device, const std::filesystem::path& path, int width, int height, int fps);
    Mp4Writer(const Mp4Writer&) = delete;
    Mp4Writer& operator=(const Mp4Writer&) = delete;

    void write(ID3D11Texture2D* nv12, int64_t frameIndex);
    void finish();

private:
    struct MediaFoundation {
        MediaFoundation();
        ~MediaFoundation();
    };

    winrt::com_ptr<IMFSample> freeSample();

    MediaFoundation mediaFoundation_;
    int fps_;
    winrt::com_ptr<ID3D11DeviceContext> context_;
    winrt::com_ptr<IMFDXGIDeviceManager> deviceManager_;
    winrt::com_ptr<IMFSinkWriter> sinkWriter_;
    DWORD stream_ = 0;
    winrt::com_ptr<IMFVideoSampleAllocatorEx> samples_;
};
