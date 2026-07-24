#include <algorithm>
#include <cstddef>
#include <vector>
#include <rubberband/RubberBandStretcher.h>

using RubberBand::RubberBandStretcher;

struct RunBeatStretcher {
    RubberBandStretcher stretcher;
    unsigned int channels;
    std::vector<std::vector<float>> planar;
    std::vector<float *> pointers;

    RunBeatStretcher(unsigned int sampleRate, unsigned int channelCount, double timeRatio)
        : stretcher(
              sampleRate,
              channelCount,
              RubberBandStretcher::OptionProcessOffline |
                  RubberBandStretcher::OptionEngineFiner |
                  RubberBandStretcher::OptionChannelsTogether |
                  RubberBandStretcher::OptionThreadingNever,
              timeRatio,
              1.0),
          channels(channelCount),
          planar(channelCount),
          pointers(channelCount) {}
};

static void deinterleave(RunBeatStretcher *state, const float *input, unsigned int frames) {
    for (unsigned int channel = 0; channel < state->channels; ++channel) {
        state->planar[channel].resize(frames);
        for (unsigned int frame = 0; frame < frames; ++frame) {
            state->planar[channel][frame] = input[frame * state->channels + channel];
        }
        state->pointers[channel] = state->planar[channel].data();
    }
}

extern "C" {

__attribute__((used)) RunBeatStretcher *runbeat_rb_create(
    unsigned int sampleRate,
    unsigned int channels,
    double timeRatio,
    unsigned int expectedFrames) {
    auto *state = new RunBeatStretcher(sampleRate, channels, timeRatio);
    state->stretcher.setExpectedInputDuration(expectedFrames);
    state->stretcher.setMaxProcessSize(8192);
    return state;
}

__attribute__((used)) void runbeat_rb_destroy(RunBeatStretcher *state) { delete state; }

__attribute__((used)) void runbeat_rb_study(
    RunBeatStretcher *state,
    const float *interleaved,
    unsigned int frames,
    int final) {
    deinterleave(state, interleaved, frames);
    state->stretcher.study(state->pointers.data(), frames, final != 0);
}

__attribute__((used)) void runbeat_rb_process(
    RunBeatStretcher *state,
    const float *interleaved,
    unsigned int frames,
    int final) {
    deinterleave(state, interleaved, frames);
    state->stretcher.process(state->pointers.data(), frames, final != 0);
}

__attribute__((used)) int runbeat_rb_available(RunBeatStretcher *state) {
    return state->stretcher.available();
}

__attribute__((used)) unsigned int runbeat_rb_retrieve(
    RunBeatStretcher *state,
    float *interleaved,
    unsigned int maxFrames) {
    const int available = state->stretcher.available();
    if (available <= 0) return 0;
    maxFrames = std::min(maxFrames, static_cast<unsigned int>(available));
    for (unsigned int channel = 0; channel < state->channels; ++channel) {
        state->planar[channel].resize(maxFrames);
        state->pointers[channel] = state->planar[channel].data();
    }
    const auto frames = state->stretcher.retrieve(state->pointers.data(), maxFrames);
    for (unsigned int frame = 0; frame < frames; ++frame) {
        for (unsigned int channel = 0; channel < state->channels; ++channel) {
            interleaved[frame * state->channels + channel] = state->planar[channel][frame];
        }
    }
    return frames;
}

}
