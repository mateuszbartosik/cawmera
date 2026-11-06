#pragma once

#include <windows.h>

#include <winrt/base.h>

#include <cstdint>

int64_t qpcNow();
int64_t qpcPerSecond();
double qpcToMs(int64_t ticks);
int64_t qpcFromHundredNs(int64_t hundredNs);

// Beats at start + n × period on a high-resolution waitable timer, so a late beat never delays the ones after it.
// Beat 0 is the start; the timer is armed for beat 1.
class Metronome {
public:
    Metronome(int64_t startQpc, double beatsPerSecond);

    HANDLE handle() const { return timer_.get(); }
    // Arms the timer for the next beat and returns the latest beat that has passed.
    int64_t rearm();

private:
    void arm(int64_t beat, int64_t nowQpc);

    winrt::handle timer_;
    int64_t start_;
    double period_;
};
