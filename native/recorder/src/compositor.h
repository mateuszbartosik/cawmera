#pragma once

#include <windows.h>
#include <unknwn.h>

#include <d3d11.h>

#include <winrt/base.h>

// Turns monitor frames into the video's NV12 frames on the GPU: a crop, fitted inside the output size, on black.
class Compositor {
public:
    Compositor(ID3D11Device* device, int outW, int outH);

    // `crop` is in the monitor's pixels and may reach past its edges; those parts stay black. When none of it is on
    // the monitor, the last composed frame comes back unchanged.
    ID3D11Texture2D* compose(ID3D11Texture2D* monitor, RECT crop);

private:
    void prepareFor(ID3D11Texture2D* monitor, UINT width, UINT height);
    void createProcessor(UINT inputW, UINT inputH);
    void requireFormat(DXGI_FORMAT format, UINT support) const;

    int outW_, outH_;
    winrt::com_ptr<ID3D11VideoDevice> videoDevice_;
    winrt::com_ptr<ID3D11VideoContext> videoContext_;
    winrt::com_ptr<ID3D11Texture2D> output_;

    UINT inputW_ = 0, inputH_ = 0;
    winrt::com_ptr<ID3D11VideoProcessorEnumerator> enumerator_;
    winrt::com_ptr<ID3D11VideoProcessor> processor_;
    winrt::com_ptr<ID3D11VideoProcessorOutputView> outputView_;
    winrt::com_ptr<ID3D11Texture2D> input_;
    winrt::com_ptr<ID3D11VideoProcessorInputView> inputView_;
};
