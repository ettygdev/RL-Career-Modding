#pragma once
#include <Windows.h>
#include <xaudio2.h>
#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <vector>

class IntermissionMusic {
public:
    ~IntermissionMusic() { close(); }
    IntermissionMusic() = default;
    IntermissionMusic(const IntermissionMusic&) = delete;
    IntermissionMusic& operator=(const IntermissionMusic&) = delete;

    bool start(const std::filesystem::path& path, bool loop = true) {
        close();
        const auto com = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
        if (FAILED(com) && com != RPC_E_CHANGED_MODE) return false;
        comThread = SUCCEEDED(com) ? GetCurrentThreadId() : 0;
        WAVEFORMATEX format{};
        XAUDIO2_BUFFER buffer{};
        if (!readWave(path, format, buffer)) { close(); return false; }
        buffer.LoopCount = loop ? XAUDIO2_LOOP_INFINITE : 0;
        looping = loop;
        if (FAILED(XAudio2Create(&engine)) ||
            FAILED(engine->CreateMasteringVoice(&master)) ||
            FAILED(engine->CreateSourceVoice(&voice, &format)) ||
            FAILED(voice->SubmitSourceBuffer(&buffer)) ||
            FAILED(voice->Start())) {
            close();
            return false;
        }
        return true;
    }

    void fadeOut() {
        if (voice && fadeStart == Clock::time_point{}) fadeStart = Clock::now();
    }

    void update() {
        if (!voice) return;
        if (fadeStart == Clock::time_point{}) {
            if (!looping) {
                XAUDIO2_VOICE_STATE state{};
                voice->GetState(&state, XAUDIO2_VOICE_NOSAMPLESPLAYED);
                if (!state.BuffersQueued) close();
            }
            return;
        }
        const float elapsed = std::chrono::duration<float>(Clock::now() - fadeStart).count();
        const float remaining = std::max(0.0f, 1.0f - elapsed / 0.8f);
        if (remaining <= 0.0f) {
            close();
        } else {
            voice->SetVolume(remaining * remaining);
        }
    }

    void close() {
        if (voice) voice->DestroyVoice();
        if (master) master->DestroyVoice();
        if (engine) engine->Release();
        voice = nullptr;
        master = nullptr;
        engine = nullptr;
        samples.clear();
        fadeStart = {};
        if (comThread && comThread == GetCurrentThreadId()) CoUninitialize();
        comThread = 0;
    }

private:
    using Clock = std::chrono::steady_clock;
    IXAudio2* engine = nullptr;
    IXAudio2MasteringVoice* master = nullptr;
    IXAudio2SourceVoice* voice = nullptr;
    std::vector<unsigned char> samples;
    Clock::time_point fadeStart{};
    DWORD comThread = 0;
    bool looping = true;

    bool readWave(const std::filesystem::path& path, WAVEFORMATEX& format, XAUDIO2_BUFFER& buffer) {
        std::ifstream input(path, std::ios::binary | std::ios::ate);
        const auto size = input ? input.tellg() : std::streampos(-1);
        if (size < 44 || size > 64 * 1024 * 1024) return false;
        samples.resize(static_cast<size_t>(size));
        input.seekg(0);
        if (!input.read(reinterpret_cast<char*>(samples.data()), samples.size()) ||
            std::memcmp(samples.data(), "RIFF", 4) != 0 ||
            std::memcmp(samples.data() + 8, "WAVE", 4) != 0) return false;
        bool gotFormat = false;
        for (size_t i = 12; i + 8 <= samples.size();) {
            const auto* chunk = samples.data() + i;
            uint32_t length = 0;
            std::memcpy(&length, chunk + 4, sizeof(length));
            if (length > samples.size() - i - 8) return false;
            if (std::memcmp(chunk, "fmt ", 4) == 0 && length >= 16) {
                std::memcpy(&format, chunk + 8, 16);
                gotFormat = format.wFormatTag == WAVE_FORMAT_PCM && format.wBitsPerSample == 16 &&
                    (format.nChannels == 1 || format.nChannels == 2) &&
                    format.nBlockAlign == format.nChannels * 2;
            } else if (std::memcmp(chunk, "data", 4) == 0 && length) {
                buffer.AudioBytes = length;
                buffer.pAudioData = chunk + 8;
            }
            i += 8 + length + (length & 1);
        }
        return gotFormat && buffer.AudioBytes && buffer.AudioBytes % format.nBlockAlign == 0;
    }
};
