#include "clock.h"

#include <algorithm>
#include <cmath>

#include "failure.h"

int64_t qpcNow() {
    LARGE_INTEGER now;
    QueryPerformanceCounter(&now);
    return now.QuadPart;
}

int64_t qpcPerSecond() {
    static const int64_t frequency = [] {
        LARGE_INTEGER value;
        QueryPerformanceFrequency(&value);
        return value.QuadPart;
    }();
    return frequency;
}

double qpcToMs(int64_t ticks) {
    return ticks * 1000.0 / qpcPerSecond();
}

int64_t qpcFromHundredNs(int64_t hundredNs) {
    const int64_t seconds = hundredNs / HUNDRED_NS_PER_SECOND;
    const int64_t rest = hundredNs % HUNDRED_NS_PER_SECOND;
    return seconds * qpcPerSecond() + rest * qpcPerSecond() / HUNDRED_NS_PER_SECOND;
}

Metronome::Metronome(int64_t startQpc, double beatsPerSecond)
    : timer_(CreateWaitableTimerExW(nullptr, nullptr, CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, TIMER_ALL_ACCESS)),
      start_(startQpc),
      period_(qpcPerSecond() / beatsPerSecond) {
    if (!timer_) throwLastError(FailureCode::internal, "Creating a timer");
    armAfter(0);
}

int64_t Metronome::latestBeat() const {
    return static_cast<int64_t>(std::floor((qpcNow() - start_) / period_));
}

void Metronome::armAfter(int64_t beat) {
    const int64_t at = start_ + static_cast<int64_t>(std::ceil((beat + 1) * period_));
    LARGE_INTEGER due;
    due.QuadPart = -std::max<int64_t>(1, (at - qpcNow()) * HUNDRED_NS_PER_SECOND / qpcPerSecond());
    if (!SetWaitableTimer(timer_.get(), &due, 0, nullptr, nullptr, FALSE))
        throwLastError(FailureCode::internal, "Arming a timer");
}
