#pragma once

#include <windows.h>
#include <unknwn.h>

#include <d3d11.h>

#include <winrt/base.h>

#include "geometry.h"

class Compositor {
public:
    Compositor(ID3D11Device* device, int outW, int outH);

    // A hidden window holds the last frame; any part of a shown crop that's off the monitor composes as black.
    ID3D11Texture2D* compose(ID3D11Texture2D* monitor, const Mapping& mappingOnMonitor);

private:
    void prepareFor(ID3D11Texture2D* monitor, UINT width, UINT height);
    void createProcessor(UINT inputW, UINT inputH);
    void requireFormat(DXGI_FORMAT format, UINT support) const;

    int outW_, outH_;
    winrt::com_ptr<ID3D11DeviceContext> context_;
    winrt::com_ptr<ID3D11VideoDevice> videoDevice_;
    winrt::com_ptr<ID3D11VideoContext> videoContext_;
    winrt::com_ptr<ID3D11Texture2D> output_;
    winrt::com_ptr<ID3D11Texture2D> black_;

    UINT inputW_ = 0, inputH_ = 0;
    winrt::com_ptr<ID3D11VideoProcessorEnumerator> enumerator_;
    winrt::com_ptr<ID3D11VideoProcessor> processor_;
    winrt::com_ptr<ID3D11VideoProcessorOutputView> outputView_;
    winrt::com_ptr<ID3D11Texture2D> input_;
    winrt::com_ptr<ID3D11VideoProcessorInputView> inputView_;
};
