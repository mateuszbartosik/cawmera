#include "clock.h"

#include <algorithm>
#include <cmath>

#include "failure.h"

namespace {

constexpr int64_t HUNDRED_NS_PER_SECOND = 10'000'000;

}  // namespace

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
    arm(1, qpcNow());
}

int64_t Metronome::rearm() {
    const int64_t now = qpcNow();
    const auto beat = static_cast<int64_t>(std::floor((now - start_) / period_));
    arm(beat + 1, now);
    return beat;
}

void Metronome::arm(int64_t beat, int64_t nowQpc) {
    const int64_t at = start_ + static_cast<int64_t>(std::ceil(beat * period_));
    LARGE_INTEGER due;
    due.QuadPart = -std::max<int64_t>(1, (at - nowQpc) * HUNDRED_NS_PER_SECOND / qpcPerSecond());
    if (!SetWaitableTimer(timer_.get(), &due, 0, nullptr, nullptr, FALSE))
        throwLastError(FailureCode::internal, "Arming a timer");
}
