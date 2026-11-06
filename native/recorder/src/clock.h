#pragma once

#include <windows.h>

#include <winrt/base.h>

#include <cstdint>

inline constexpr int64_t HUNDRED_NS_PER_SECOND = 10'000'000;

int64_t qpcNow();
int64_t qpcPerSecond();
double qpcToMs(int64_t ticks);
int64_t qpcFromHundredNs(int64_t hundredNs);

class Metronome {
public:
    Metronome(int64_t startQpc, double beatsPerSecond);

    HANDLE handle() const { return timer_.get(); }
    int64_t latestBeat() const;
    void armAfter(int64_t beat);

private:
    winrt::handle timer_;
    int64_t start_;
    double period_;
};
