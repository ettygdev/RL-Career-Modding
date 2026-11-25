#include <Windows.h>
#include "intermission-music.h"
#include "bakkesmod/plugin/bakkesmodplugin.h"
#include "bakkesmod/plugin/pluginwindow.h"
#include "imgui.h"
#include "bakkesmod/wrappers/ArrayWrapper.h"
#include "bakkesmod/wrappers/GameEvent/ServerWrapper.h"
#include "bakkesmod/wrappers/GameObject/CameraWrapper.h"
#include "bakkesmod/wrappers/GameObject/PriWrapper.h"
#include "bakkesmod/wrappers/PlayerControllerWrapper.h"
#include "bakkesmod/wrappers/SpectatorHUDWrapper.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstring>
#include <fstream>
#include <sstream>
#include <optional>
#include <string_view>
#include <unordered_map>
#include <utility>
#include <vector>
#include "spectator-hud.h"
#include "team-hud.h"

namespace {
using CameraProfiles = std::unordered_map<std::string, ProfileCameraSettings>;
using Clock = std::chrono::system_clock;

std::string key(std::string name) {
    std::transform(name.begin(), name.end(), name.begin(), [](unsigned char c) {
        if (c == ';' || c == '"') return ' ';
        return c >= 'A' && c <= 'Z' ? static_cast<char>(c + ('a' - 'A')) : static_cast<char>(c);
    });
    const auto first = name.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) return {};
    return name.substr(first, name.find_last_not_of(" \t\r\n") - first + 1);
}

long long nowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now().time_since_epoch()).count();
}

bool between(float value, float low, float high) {
    return std::isfinite(value) && value >= low && value <= high;
}

bool readCamera(std::istream& row, ProfileCameraSettings& camera) {
    return (row >> camera.FOV >> camera.Height >> camera.Pitch >> camera.Distance >>
            camera.Stiffness >> camera.SwivelSpeed >> camera.TransitionSpeed) &&
           between(camera.FOV, 60, 110) && between(camera.Height, 40, 200) &&
           between(camera.Pitch, -45, 0) && between(camera.Distance, 100, 500) &&
           between(camera.Stiffness, 0, 1) && between(camera.SwivelSpeed, 1, 10) &&
           between(camera.TransitionSpeed, 1, 2);
}

struct Request {
    std::string token;
    long long expires = 0;
    CameraProfiles profiles;
    std::vector<std::string> roster;
    unsigned game = 0, bestOf = 0, blueWins = 0, orangeWins = 0;
    std::array<std::string, 2> names, crests;
    std::string header;
    bool postmatch = false;
};

Request readRequest(const std::filesystem::path& file) {
    std::ifstream in(file, std::ios::binary);
    Request value;
    unsigned count = 0;
    if (!(in >> value.token >> value.expires >> count) || (count != 6 && count != 5) ||
        value.token.size() > 100 || value.expires <= nowMs()) return {};
    std::string line;
    std::getline(in, line);
    std::istringstream series(line);
    if (!(series >> value.game >> value.bestOf >> value.blueWins >> value.orangeWins) ||
        value.bestOf > 9 || value.game > value.bestOf ||
        value.blueWins > value.bestOf || value.orangeWins > value.bestOf) {
        value.game = value.bestOf = value.blueWins = value.orangeWins = 0;
    }
    for (unsigned i = 0; i < count && std::getline(in, line); ++i) {
        const auto separator = line.find('\t');
        const auto name = key(line.substr(0, separator));
        if (name.empty() || name.size() > 100 ||
            std::find(value.roster.begin(), value.roster.end(), name) != value.roster.end()) return {};
        value.roster.push_back(name);
        if (separator != std::string::npos) {
            std::istringstream settings(line.substr(separator + 1));
            ProfileCameraSettings profile{};
            if (!readCamera(settings, profile)) return {};
            value.profiles.emplace(name, profile);
        }
    }
    if (value.roster.size() != count) return {};
    for (unsigned i = 0; i < 2 && std::getline(in, line); ++i) {
        const auto tab = line.find('\t');
        if (tab == std::string::npos) continue;
        value.names[i] = line.substr(0, std::min<std::size_t>(tab, 64));
        const auto asset = line.substr(tab + 1);
        constexpr std::string_view prefix = "inventory-crest-";
        if (asset.size() == prefix.size() + 20 && asset.starts_with(prefix) && asset.ends_with(".png") &&
            asset.find_first_not_of("0123456789abcdef", prefix.size()) == asset.size() - 4) {
            value.crests[i] = asset;
        }
    }
    if (std::getline(in, line)) value.header = line.substr(0, 120);
    in >> value.postmatch;
    return value;
}
}

class CareerCameras : public BakkesMod::Plugin::BakkesModPlugin, public BakkesMod::Plugin::PluginWindow {
public:
    void onLoad() override {
        directory = gameWrapper->GetDataFolder() / "rlcareermode";
        lifecycle = std::make_shared<int>(0);
        hudFontReady = hudFont.prepare(directory / "inventory-font-bahnschrift-v1");
        cvarManager->registerCvar("rlcareercameras_hud", "1", "Career spectator overlay", true, true, 0, true, 1);
        std::weak_ptr<int> life = lifecycle;
        gameWrapper->RegisterDrawable([this, life](CanvasWrapper canvas) {
            if (life.expired()) return;
            capturePostmatch(gameWrapper->GetGameEventAsServer());
            intermissionMusic.update();
            drawPostmatch(canvas);
            drawSpectatorHud(canvas);
            updateQuickChat(canvas);
            drawOfficials(canvas);
        });
        gameWrapper->HookEventWithCaller<CarWrapper>(demoEvent, [this](CarWrapper victim, void* params, std::string) {
            captureDemo(victim, params);
        });
        gameWrapper->HookEventWithCaller<CarWrapper>(destroyEvent, [this](CarWrapper victim, void*, std::string) {
            captureDemo(victim, nullptr);
        });
        gameWrapper->HookEvent("Function TAGame.GameEvent_Soccar_TA.StartReplay", [this](std::string) {
            if (!matchToken.empty()) refereeReplayUntil = nowMs() + 8000;
        });
        gameWrapper->HookEvent("Function TAGame.GameEvent_Soccar_TA.HandleReplayFinished", [this](std::string) {
            refereeReplayUntil = 0;
        });
        cvarManager->registerNotifier("rlc_quick_direction", [this](std::vector<std::string> args) {
            if (args.size() == 2 && args[1].size() == 1 && args[1][0] >= '0' && args[1][0] <= '3')
                quickDirection(unsigned(args[1][0] - '0'));
        }, "Career quick chat D-pad routing", PERMISSION_ALL);
        nextTick();
        cvarManager->log("RL Career Cameras: loaded");
    }

    void onUnload() override {
        syncOfficialsMenu(false);
        setQuickBinds(false);
        cvarManager->removeNotifier("rlc_quick_direction");
        gameWrapper->UnhookEvent(demoEvent);
        gameWrapper->UnhookEvent(destroyEvent);
        gameWrapper->UnhookEvent("Function TAGame.GameEvent_Soccar_TA.StartReplay");
        gameWrapper->UnhookEvent("Function TAGame.GameEvent_Soccar_TA.HandleReplayFinished");
        endTechnicalPause(gameWrapper->GetGameEventAsServer(), Recovery::Resume);
        setReplacement(false);
        setNativeMatchInfo(false);
        intermissionMusic.close();
        lifecycle.reset();
        restore(gameWrapper->GetGameEventAsServer());
    }

    std::string GetMenuName() override { return "rlc_timeout"; }
    std::string GetMenuTitle() override { return "Overhaul Tactical Timeout"; }
    void SetImGuiContext(uintptr_t context) override {
        ImGui::SetCurrentContext(reinterpret_cast<ImGuiContext*>(context));
    }
    bool ShouldBlockInput() override { return officialsMenuWanted; }
    bool IsActiveOverlay() override { return officialsMenuWanted; }
    void OnOpen() override { officialsMenuOpen = true; }
    void OnClose() override { officialsMenuOpen = false; }

    void Render() override {
        if (!officialsMenuWanted || officialsMenuSubmitted) return;
        std::ifstream file(directory / "inventory-officials-break.txt");
        std::string token, phase;
        long long end = 0, scoreboardEnd = 0;
        if (!(file >> token >> phase >> end >> scoreboardEnd) || end <= nowMs() ||
            (phase != "proposal" && phase != "timeout")) return;
        const bool offer = phase == "proposal";
        const auto display = ImGui::GetIO().DisplaySize;
        const float scale = std::clamp(std::min(display.x / 1920.0f, display.y / 1080.0f), .65f, 2.0f);
        const float width = (offer ? 470 : 225) * scale;
        const float height = (offer ? 111 : 48) * scale;
        const float centerY = offer ? display.y * .80f : display.y * .5f + 268 *
            std::min(display.x / 1920.0f, display.y / 1080.0f);
        ImGui::SetNextWindowPos(ImVec2((display.x - width) * .5f, centerY - height * .5f), ImGuiCond_Always);
        ImGui::SetNextWindowSize(ImVec2(width, height), ImGuiCond_Always);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 2);
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 2);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(12 * scale, 8 * scale));
        ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(.06f, .09f, .13f, .98f));
        ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(.29f, .38f, .46f, 1.f));
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(.13f, .24f, .33f, 1.f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(.10f, .38f, .52f, 1.f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(.15f, .50f, .66f, 1.f));
        const auto flags = ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoScrollbar;
        const char* choice = nullptr;
        if (ImGui::Begin("##CareerPlusTimeout", nullptr, flags)) {
            ImGui::SetWindowFontScale(scale);
            if (offer) {
                const auto label = "COACH REQUESTS A TIMEOUT   |   " + std::to_string((end-nowMs()+999)/1000) + " S";
                ImGui::TextUnformatted(label.c_str());
                ImGui::Spacing();
                const float buttonWidth = (ImGui::GetContentRegionAvail().x - ImGui::GetStyle().ItemSpacing.x) * .5f;
                if (ImGui::Button("ACCEPT", ImVec2(buttonWidth, 38 * scale))) choice = "yes";
                ImGui::SameLine();
                if (ImGui::Button("DECLINE", ImVec2(buttonWidth, 38 * scale))) choice = "no";
            } else if (ImGui::Button("SKIP TIMEOUT", ImVec2(ImGui::GetContentRegionAvail().x, 30 * scale))) choice = "skip";
        }
        ImGui::End();
        ImGui::PopStyleColor(5);
        ImGui::PopStyleVar(3);
        if (choice && nowMs() < end) {
            officialInput(token, offer ? "decision" : "skip", choice);
            officialsMenuSubmitted = true;
        }
    }

private:
    std::filesystem::path directory;
    std::shared_ptr<int> lifecycle;
    Request request;
    std::string musicCue;
    long long nextMusicRetry = 0;
    IntermissionMusic intermissionMusic;
    std::string quickSession;
    bool quickEnabled = false, botCalls = false;
    struct QuickChoice { std::string id, label; };
    std::array<QuickChoice, 8> quickMessages;
    static constexpr std::array quickKeys{"XboxTypeS_DPad_Up", "XboxTypeS_DPad_Left",
        "XboxTypeS_DPad_Right", "XboxTypeS_DPad_Down"};
    std::array<std::string, 4> savedQuickBinds;
    bool quickBinds = false;
    int quickGroup = -1;
    long long quickMenuUntil = 0, lastQuickCall = 0, lastBotCall = 0, quickTextUntil = 0;
    std::string quickSpeaker, quickText;
    long long tacticUntil = 0, lastDirectionAt = 0;
    int lastDirection = -1, tacticLevel = 3;
    static constexpr std::array tacticModes{"park", "ultra_defensive", "defensive", "balanced",
        "attacking", "ultra_attacking", "all_out"};
    static constexpr std::array tacticLabels{"PARK THE BUS", "ULTRA DEFENSIVE", "DEFENSIVE", "BALANCED",
        "ATTACKING", "ULTRA ATTACKING", "ALL OUT"};
    spectatorHud::HudFont hudFont;
    spectatorHud::HudArt hudArt;
    bool hudFontReady = false;
    struct Postmatch {
        std::unique_ptr<ImageWrapper> frame;
        std::string token;
        std::array<float, 6> layout{};
        long long capturedAt = 0, nextFrameRead = 0;
        long long start = 0, deadline = 0;
        unsigned winner = 0;
        bool confirmed = false, released = false, showingTimeout = false, published = false;
        bool arenaReady = false, hidden = false;
    };
    std::optional<Postmatch> postmatch;
    std::string capturedResult;

    static constexpr auto demoEvent = "Function TAGame.Car_TA.Demolish2";
    static constexpr auto destroyEvent = "Function TAGame.Car_TA.DemolishDestroyTimer";
    std::optional<int> priorScorebug;
    bool restoreMatchInfo = false;
    std::array<std::unique_ptr<ImageWrapper>, 2> crestImages;
    std::array<std::string, 2> crestFiles;
    static constexpr long long eventDuration = 2600;
    struct Demo { std::string attacker, victim; unsigned team = 0; long long until = 0; };
    std::vector<Demo> demos;
    std::unordered_map<uintptr_t, long long> demoVictims;
    std::unordered_map<uintptr_t, uintptr_t> playerCars;
    std::array<int, 2> demolitionTotals{-1, -1};
    std::array<long long, 2> lastTeamDemo{};
    struct PlayerEffects {
        std::array<int, 3> last{};
        std::array<long long, 3> started{};
        long long sampled = 0;
        long long wreckedAt = 0;
        bool respawning = false;
        bool hadCar = false;
        long long disappearance = 0;
        float dial = 0;
    };
    std::unordered_map<uintptr_t, PlayerEffects> effects;
    std::string matchToken;
    uintptr_t serverAddress = 0;
    enum class Recovery { Resume, Kickoff, Restart };
    struct Officials {
        std::string token;
        long long expires = 0;
        int referee = 0, fraction = 0, duration = 0;
        bool available = false, taken = false, fired = false;
        Recovery recovery = Recovery::Resume;
        int startClock = 0;
    } officials;
    long long officialsRead = 0, refereeReplayUntil = 0;
    long long issueStart = 0, issueEnd = 0, issueResume = 0;
    uintptr_t issueServer = 0;
    std::string breakToken, breakPhase, breakClub, breakNext, revealedTimeout, inputToken, inputPhase;
    long long breakEnds = 0;
    bool f8Was = false, yesWas = false, noWas = false, enterWas = false, decisionSent = false, skipSent = false;
    std::atomic_bool officialsMenuWanted{false}, officialsMenuOpen{false}, officialsMenuSubmitted{false};
    std::string timeoutMenuOriginal, timeoutMenuDisabled;

    void syncOfficialsMenu(bool wanted) {
        if (officialsMenuWanted.exchange(wanted) == wanted) return;
        if (officialsMenuOpen != wanted) cvarManager->executeCommand("togglemenu rlc_timeout");
    }

    void allowTimeoutButton(bool allow) {
        const auto path = directory / "talk" / "timeout-ok.json";
        std::ifstream in(path, std::ios::ate);
        const auto size = in ? in.tellg() : std::streampos(-1);
        if (size <= 0 || size > 4096) return;
        std::string current(static_cast<size_t>(size), '\0');
        in.seekg(0);
        if (!in.read(current.data(), current.size())) return;
        in.close();
        auto saved = current;
        if (allow) {
            if (std::exchange(timeoutMenuDisabled, {}) != current) {
                timeoutMenuOriginal.clear();
                return;
            }
            current = std::exchange(timeoutMenuOriginal, {});
        } else {
            const auto flag = current.find("\"allow\":true");
            if (flag == std::string::npos) return;
            current.replace(flag, 12, "\"allow\":false");
        }
        const auto staging = directory / "talk" / "inventory-timeout-ok.tmp";
        std::ofstream out(staging, std::ios::trunc);
        out << current;
        out.close();
        if (out && MoveFileExW(staging.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING) && !allow) {
            timeoutMenuOriginal = std::move(saved);
            timeoutMenuDisabled = std::move(current);
        }
    }

    static const char* recoveryLabel(Recovery outcome) {
        switch (outcome) {
        case Recovery::Kickoff: return "RESUMING FROM KICKOFF";
        case Recovery::Restart: return "RESTARTING THE GAME";
        default: return "PLAY WILL RESUME";
        }
    }

    void endTechnicalPause(ServerWrapper server, Recovery recovery) {
        if (issueServer && server && server.memory_address == issueServer && !server.GetbMatchEnded()) {
            auto controller = gameWrapper->GetPlayerController();
            auto pauser = server.GetPauser();
            if (controller && pauser && controller.memory_address == pauser.memory_address) {
                const int previous = server.GetSecondsRemaining();
                server.SetPaused(controller, 0);
                if (recovery == Recovery::Kickoff) {
                    server.StartNewRound();
                    server.SetSecondsRemaining(previous);
                } else if (recovery == Recovery::Restart) {
                    server.ResetGame();
                    demos.clear();
                    effects.clear();
                }
            }
        }
        issueStart = issueEnd = issueResume = 0;
        issueServer = 0;
        if (!timeoutMenuOriginal.empty()) allowTimeoutButton(true);
    }

    void officialInput(const std::string& token, const std::string& action, const std::string& value) {
        std::ofstream record(directory / ("inventory-officials-" + action + ".txt"), std::ios::trunc);
        if (record) record << token << ' ' << value << ' ' << nowMs();
    }

    bool timeoutArenaReady(ServerWrapper server) {
        if (!server || server.GetbMatchEnded() || !server.GetBall() ||
            server.memory_address != serverAddress || request.token != matchToken ||
            request.token.substr(0, request.token.find('.')) != breakNext) return false;
        std::array<int, 2> teams{};
        std::array<uintptr_t, 6> placed{};
        size_t count = 0;
        auto players = server.GetPRIs();
        for (int i = 0; i < players.Count(); ++i) {
            auto player = players.Get(i);
            if (!player || player.IsSpectator() || player.GetTeamNum()>1) continue;
            auto car = player.GetCar();
            if (!car || count==placed.size() || std::find(placed.begin(),placed.end(),car.memory_address)!=placed.end())
                return false;
            const auto location = car.GetLocation();
            if (!std::isfinite(location.X) || !std::isfinite(location.Y) || (location.X==0 && location.Y==0)) return false;
            placed[count++] = car.memory_address;
            ++teams[player.GetTeamNum()];
        }
        return teams[0]==3 && teams[1]==3;
    }

    void drawOfficials(CanvasWrapper canvas) {
        auto server = gameWrapper->GetGameEventAsServer();
        if (gameWrapper->IsInOnlineGame() || gameWrapper->IsInFreeplay() || gameWrapper->IsInReplay()) {
            syncOfficialsMenu(false);
            return;
        }
        const auto now = nowMs();
        if (now >= officialsRead) {
            officialsRead = now + 120;
            Officials next;
            int allowed = 0, recovery = 0;
            std::ifstream cfg(directory / "inventory-officials.txt");
            if (cfg >> next.token >> next.expires >> next.referee >> allowed >> next.fraction >> next.duration >> recovery &&
                next.expires > now && next.referee >= 10 && next.referee <= 99 && next.token != officials.token) {
                endTechnicalPause(server, Recovery::Resume);
                next.available = allowed == 1;
                next.recovery = recovery == 2 ? Recovery::Restart : recovery == 1 ? Recovery::Kickoff : Recovery::Resume;
                officials = next;
            }
            std::ifstream pause(directory / "inventory-officials-break.txt");
            std::string phase, token;
            long long finish = 0, scoreUntil = 0;
            if (pause >> token >> phase >> finish >> scoreUntil &&
                finish + (phase=="timeout" ? 600 : 0) > now && token != revealedTimeout &&
                (token == capturedResult || token == request.token || (postmatch && token == postmatch->token))) {
                if (inputToken != token || inputPhase != phase) {
                    inputToken = token;
                    inputPhase = phase;
                    decisionSent = skipSent = false;
                    officialsMenuSubmitted = false;
                }
                breakToken = token;
                breakPhase = phase;
                breakEnds = finish;
                std::getline(pause, breakClub);
                std::getline(pause, breakClub);
                breakNext.clear();
                if (phase=="loading") std::getline(pause, breakNext);
                if (breakClub.size() > 125) breakClub.resize(125);
            } else breakPhase.clear();
        }
        DWORD focusedProcess = 0;
        GetWindowThreadProcessId(GetForegroundWindow(), &focusedProcess);
        auto hit = [focused = focusedProcess == GetCurrentProcessId()](int key, bool& was) {
            const bool down = focused && (GetAsyncKeyState(key) & 0x8000) != 0;
            const bool pressed = down && !was;
            was = down;
            return pressed;
        };
        const bool requestKey = hit(VK_F8, f8Was);
        const bool yes = hit('Y', yesWas), no = hit('N', noWas), skip = hit(VK_RETURN, enterWas);
        const bool active = server && officials.expires > now && officials.token == request.token &&
            matchToken == officials.token && serverAddress == server.memory_address && !server.GetbMatchEnded();
        if (issueServer && (!active || now >= issueResume))
            endTechnicalPause(server, active ? officials.recovery : Recovery::Resume);

        if (active && !issueServer && requestKey && officials.available && !officials.taken) {
            officialInput(officials.token, "request", "call");
            officials.taken = true;
        }
        if (active && !officials.fired && officials.fraction > 0 && officials.duration >= 5 && officials.duration <= 15 &&
            server.GetbRoundActive() && server.GetbBallHasBeenHit() && !server.GetPauser() && now >= refereeReplayUntil) {
            const int remaining = server.GetSecondsRemaining();
            if (officials.startClock == 0 && remaining >= 10) officials.startClock = remaining;
            if (remaining >= 4 && officials.startClock >= 10 &&
                (officials.startClock - remaining) * 1000 >= officials.startClock * officials.fraction) {
                auto controller = gameWrapper->GetPlayerController();
                if (controller) {
                    officials.fired = true;
                    allowTimeoutButton(false);
                    server.SetPaused(controller, 1);
                    if (server.GetPauser()) {
                        issueServer = server.memory_address;
                        issueStart = now + 3000;
                        issueEnd = issueStart + 1000LL * officials.duration;
                        issueResume = issueEnd + 3000;
                        officialInput(officials.token, "incident", officials.recovery == Recovery::Restart ?
                            "restart" : officials.recovery == Recovery::Kickoff ? "kickoff" : "resume");
                    } else if (!timeoutMenuOriginal.empty()) allowTimeoutButton(true);
                }
            }
        }
        if (breakPhase == "proposal" && !decisionSent && (yes || no) && now < breakEnds) {
            officialInput(breakToken, "decision", no ? "no" : "yes");
            decisionSent = true;
        }
        if (breakPhase == "timeout" && !skipSent && skip && now < breakEnds) {
            officialInput(breakToken, "skip", "skip");
            skipSent = true;
        }
        syncOfficialsMenu(now < breakEnds && !officialsMenuSubmitted &&
            ((breakPhase == "proposal" && !decisionSent) || (breakPhase == "timeout" && !skipSent)));
        if (breakPhase == "loading" && timeoutArenaReady(server)) {
            officialInput(breakNext, "ready", "ready");
            revealedTimeout = breakToken;
            breakPhase.clear();
        }
        if (!hudFontReady) return;
        const auto screen = canvas.GetSize();
        const auto scale = std::min(screen.X / 1920.0f, screen.Y / 1080.0f);
        if (scale <= 0) return;
        teamHud::Panel panel{canvas,hudFont,scale,teamHud::blue};
        const float width=screen.X / scale, height=screen.Y / scale;
        const std::string referee = "RLCS Referee #" + std::to_string(officials.referee);
        const bool technical = issueServer && now >= issueStart && now < issueEnd;
        if ((breakPhase == "timeout" && now < breakEnds + 600) || (breakPhase == "loading" && now < breakEnds)) {
            drawTimeout(panel, width, height, referee, now, breakPhase == "loading" || now >= breakEnds);
        } else if (technical) {
            const float x=(width-720)/2, y=(height-290)/2;
            panel.box(0,0,width,height,{7,11,17,255});
            panel.surface(x,y,720,290,true);
            panel.box(x,y,720,4,teamHud::blue);
            panel.text(referee,x+20,y+20,680,38,23,teamHud::muted,true);
            panel.text("TECHNICAL PAUSE",x+20,y+60,680,54,45,teamHud::white,true);
            panel.text(std::to_string((issueEnd-now+999)/1000) + " S",x+20,y+118,680,70,58,teamHud::white,true);
            panel.text(recoveryLabel(officials.recovery),x+20,y+225,680,36,23,teamHud::muted,true);
            panel.box(x+54,y+273,612,4,{54,64,78,255});
            const auto progress=std::clamp(float(now-issueStart)/std::max(1LL,issueEnd-issueStart),0.0f,1.0f);
            panel.box(x+54,y+273,612*progress,4,teamHud::blue);
        } else if (issueServer && now >= issueEnd && now < issueResume) {
            const float x=(width-450)/2, y=height*.22f;
            panel.surface(x,y,450,55,true);
            panel.text(std::string(officials.recovery == Recovery::Restart ? "GAME RESTARTS IN " : "PLAY RESUMES IN ") +
                std::to_string((issueResume-now+999)/1000),
                x+14,y+10,422,35,25,teamHud::white,true);
        } else if (active && now < refereeReplayUntil) {
            panel.surface(width-360,height-155,301,42);
            panel.text(referee,width-345,height-148,271,29,20,teamHud::muted,true);
        }
    }

    void drawTimeout(teamHud::Panel& panel, float width, float height, const std::string& referee, long long now, bool loading) {
        panel.box(0, 0, width, height, {9, 13, 19, 255});
        const auto point = [&panel](float x, float y) { return Vector2F{x * panel.scale, y * panel.scale}; };
        const float slant = height * .43f;
        for (int stripe = -1; stripe < 6; ++stripe) {
            const float x = stripe * width * .22f;
            const float band = width * .105f;
            panel.color(stripe % 2 ? teamHud::Color{20, 29, 40, 255} : teamHud::Color{15, 22, 31, 255});
            panel.canvas.FillTriangle(point(x+slant,0), point(x+band+slant,0), point(x,height));
            panel.canvas.FillTriangle(point(x+band+slant,0), point(x+band,height), point(x,height));
        }
        auto header = request.header.empty() ? std::string("RLCAREER OVERHAUL") : request.header;
        panel.surface(width*.04f,height*.04f,width*.92f,44);
        panel.text(header,width*.04f,height*.04f,width*.92f,44,24,teamHud::muted,true);
        panel.box(width*.12f,height*.5f-118,width*.76f,3,{61,78,94,255});
        panel.text("TACTICAL TIMEOUT",0,height*.5f-205,width,74,67,teamHud::white,true);
        panel.text(breakClub,0,height*.5f-103,width,49,34,teamHud::blue,true);
        const auto seconds = loading ? 0 : (breakEnds-now+999)/1000;
        const auto clock = std::to_string(seconds/60) + ":" + (seconds%60<10?"0":"") + std::to_string(seconds%60);
        panel.text(clock,0,height*.5f-45,width,162,144,teamHud::white,true);
        const float bar = width * .42f;
        const float progress = loading ? 1.f : std::clamp(float(breakEnds-now)/90000,0.f,1.f);
        panel.box((width-bar)*.5f,height*.5f+143,bar,7,{40,53,68,255});
        panel.box((width-bar)*.5f,height*.5f+143,bar*progress,7,teamHud::blue);
        panel.text(referee,0,height*.5f+171,width,45,24,teamHud::muted,true);
        if (loading) panel.text("LOADING NEXT GAME",0,height*.5f+244,width,45,26,teamHud::white,true);
    }
    uintptr_t cameraAddress = 0;
    uintptr_t focusAddress = 0;
    long long nextRead = 0;
    std::string overtimeToken;
    uintptr_t overtimeServer = 0;
    int lastOvertimeSecond = -1;
    ProfileCameraSettings savedView{};
    std::unordered_map<uintptr_t, ProfileCameraSettings> original;

    void nextTick() {
        std::weak_ptr<int> life = lifecycle;
        gameWrapper->SetTimeout([this, life](GameWrapper*) {
            if (life.expired()) return;
            tick();
            nextTick();
        }, 0.15f);
    }

    void restoreView() {
        if (!cameraAddress) return;
        auto camera = gameWrapper->GetCamera();
        if (camera && camera.memory_address == cameraAddress) camera.SetCameraSettings(savedView);
        cameraAddress = 0;
        focusAddress = 0;
    }

    void restore(ServerWrapper server) {
        setQuickBinds(false);
        setReplacement(false);
        setNativeMatchInfo(false);
        demos.clear();
        demoVictims.clear();
        playerCars.clear();
        demolitionTotals = {-1, -1};
        lastTeamDemo = {};
        effects.clear();
        if (server && server.memory_address == serverAddress) {
            restoreView();
            auto players = server.GetPRIs();
            for (int i = 0; i < players.Count(); ++i) {
                auto player = players.Get(i);
                if (!player) continue;
                const auto found = original.find(player.memory_address);
                if (found != original.end()) player.SetCameraSettings(found->second);
            }
        }
        cameraAddress = 0;
        focusAddress = 0;
        serverAddress = 0;
        matchToken.clear();
        original.clear();
    }

    void captureOvertime(ServerWrapper server) {
        if (!server || gameWrapper->IsInOnlineGame() || gameWrapper->IsInReplay() ||
            gameWrapper->IsInFreeplay() || !server.GetbOverTime()) return;
        std::ifstream requestFile(directory / "inventory-overtime-request.txt");
        std::string token;
        long long expires = 0;
        if (!(requestFile >> token >> expires) || token.size() > 120 || expires <= nowMs()) return;
        if (token != overtimeToken) {
            overtimeToken = token;
            overtimeServer = server.memory_address;
            lastOvertimeSecond = -1;
        }
        if (server.memory_address != overtimeServer) return;
        const float elapsed = server.GetOvertimeTimePlayed();
        if (!std::isfinite(elapsed) || elapsed < 0 || elapsed >= 7200) return;
        const int seconds = static_cast<int>(elapsed);
        if (seconds <= lastOvertimeSecond) return;
        const auto destination = directory / "inventory-overtime-result.txt";
        auto temporary = destination;
        temporary += ".tmp";
        std::ofstream output(temporary, std::ios::trunc);
        output << token << ' ' << seconds << '\n';
        output.close();
        if (output && MoveFileExW(temporary.c_str(), destination.c_str(), MOVEFILE_REPLACE_EXISTING)) {
            lastOvertimeSecond = seconds;
        }
    }

    void matchCrests(spectatorHud::Match& data) {
        for (unsigned i = 0; i < 2; ++i) {
            if (!request.names[i].empty()) data.names[i] = request.names[i];
            if (crestFiles[i] != request.crests[i]) {
                crestFiles[i] = request.crests[i];
                crestImages[i].reset();
                if (!crestFiles[i].empty()) {
                    crestImages[i] = std::make_unique<ImageWrapper>(directory / crestFiles[i], true, false);
                }
            }
            data.crests[i] = crestImages[i].get();
        }
    }

    void capturePostmatch(ServerWrapper server) {
        if (!request.postmatch || request.expires <= nowMs() || !serverAddress || !server || server.memory_address != serverAddress ||
            !server.GetbMatchEnded() || capturedResult == request.token || matchToken != request.token ||
            gameWrapper->IsInOnlineGame() || gameWrapper->IsInReplay() || gameWrapper->IsInFreeplay()) return;
        Postmatch result;
        spectatorHud::Match data;
        auto teams = server.GetTeams();
        std::array<bool, 2> scored{};
        for (int i = 0; i < teams.Count(); ++i) {
            auto team = teams.Get(i);
            if (!team || team.GetTeamNum() > 1) continue;
            data.score[team.GetTeamNum()] = team.GetScore();
            scored[team.GetTeamNum()] = true;
        }
        if (!scored[0] || !scored[1] || data.score[0] == data.score[1]) return;
        result.winner = data.score[0] > data.score[1] ? 0 : 1;
        data.overtime = server.GetbOverTime();
        const float overtime = server.GetOvertimeTimePlayed();
        if (data.overtime && between(overtime, 0, 7199)) data.seconds = int(overtime);
        auto players = server.GetPRIs();
        for (int i = 0; i < players.Count(); ++i) {
            auto player = players.Get(i);
            if (!player || player.IsSpectator() || player.GetTeamNum() > 1) continue;
            auto& side = data.players[player.GetTeamNum()];
            if (side.size() >= 3) continue;
            spectatorHud::Player row;
            row.name = player.GetPlayerName().ToString();
            row.stats = {player.GetMatchScore(), player.GetMatchGoals(), player.GetMatchAssists(),
                player.GetMatchShots(), player.GetMatchSaves(), player.GetMatchDemolishes()};
            side.push_back(std::move(row));
        }
        result.token = request.token.substr(0, request.token.find('.'));
        result.capturedAt = nowMs();
        const auto temporary = directory / "inventory-result-snapshot.tmp";
        std::ofstream snapshot(temporary, std::ios::trunc);
        snapshot << result.token << ' ' << result.capturedAt << ' ' << data.score[0] << ' '
            << data.score[1] << ' ' << (data.overtime ? 1 : 0) << ' ' << data.seconds << '\n';
        for (unsigned team = 0; team < 2; ++team) {
            for (auto& player : data.players[team]) {
                std::replace_if(player.name.begin(), player.name.end(),
                    [](unsigned char c) { return c < 32; }, ' ');
                snapshot << team << '\t' << player.name;
                for (const auto stat : player.stats) snapshot << '\t' << stat;
                snapshot << '\n';
            }
        }
        snapshot.close();
        if (snapshot) MoveFileExW(temporary.c_str(),
            (directory / "inventory-result-snapshot.tsv").c_str(), MOVEFILE_REPLACE_EXISTING);
        capturedResult = request.token;
        postmatch = std::move(result);
        startIntermissionTrack("postmatch-" + postmatch->token);
    }

    void updatePostmatch(ServerWrapper server) {
        if (!postmatch) return;
        auto& result = *postmatch;
        const auto now = nowMs();
        if (now - result.capturedAt > (result.confirmed ? 180000 : 25000)) {
            postmatch.reset();
            return;
        }
        std::ifstream transition(directory / "inventory-intermission.txt");
        std::string token, phase;
        long long start = 0, deadline = 0, at = 0;
        if (transition >> token >> start >> deadline && token == result.token &&
            start >= result.capturedAt - 2000 && deadline > start && deadline - start <= 20000) {
            result.start = start;
            result.deadline = deadline;
        }
        std::ifstream input(directory / "inventory-result-view.txt");
        if (input >> token >> phase >> at && token == result.token && at >= result.capturedAt - 2000) {
            result.confirmed = true;
            if (phase == "closed") {
                if (!result.released && !result.arenaReady) intermissionMusic.fadeOut();
                postmatch.reset();
                return;
            }
            result.showingTimeout = phase == "timeout";
            if (phase == "released") result.released = true;
        }
        if (!result.arenaReady && !result.showingTimeout && server && !server.GetbMatchEnded() &&
            serverAddress == server.memory_address && request.token == matchToken && request.token != capturedResult &&
            request.token.starts_with(result.token.substr(0, result.token.rfind('-') + 1))) {
            auto controller = gameWrapper->GetPlayerController();
            auto local = controller ? controller.GetPRI() : PriWrapper(0);
            if (local && server.GetBall() && (local.IsSpectator() || local.GetCar())) {
                result.arenaReady = true;
                const auto temp = directory / "inventory-arena-ready.tmp";
                std::ofstream report(temp, std::ios::trunc);
                report << request.token.substr(0, request.token.find('.')) << ' ' << now << '\n';
                report.close();
                if (report) MoveFileExW(temp.c_str(), (directory / "inventory-arena-ready.txt").c_str(),
                    MOVEFILE_REPLACE_EXISTING);
            }
        }
        if (result.arenaReady && ((result.deadline && now >= result.deadline) || result.released)) result.hidden = true;
    }

    void loadPostmatchFrame(Postmatch& result, long long now) {
        if (result.frame || now < result.nextFrameRead) return;
        result.nextFrameRead = now + 50;
        std::ifstream input(directory / "inventory-result-frame.txt");
        std::string token, filename;
        if (!(input >> token >> filename) || token != result.token ||
            filename != "inventory-result-" + result.token + "-" + std::to_string(result.capturedAt) + ".png") return;
        auto& [width, height, x, y, w, h] = result.layout;
        if (!(input >> width >> height >> x >> y >> w >> h) ||
            !between(width, 1, 7680) || !between(height, 1, 4320) ||
            !between(x, 0, width) || !between(y, 0, height) ||
            !between(w, 0, width - x + 1) || !between(h, 0, height - y + 1)) return;
        result.frame = std::make_unique<ImageWrapper>(directory / filename, true, false);
    }

    void drawPostmatch(CanvasWrapper canvas) {
        if (!postmatch || postmatch->hidden || postmatch->showingTimeout) return;
        auto& result = *postmatch;
        const auto now = nowMs();
        loadPostmatchFrame(result, now);
        if (!result.frame || !result.frame->GetCanvasTex()) return;
        const auto size = result.frame->GetSizeF();
        const auto screen = canvas.GetSize();
        if (size.X <= 0 || size.Y <= 0 || screen.X <= 0 || screen.Y <= 0) return;
        const float scale = std::min(screen.X / size.X, screen.Y / size.Y);
        const float left = (screen.X - size.X * scale) / 2.0f, top = (screen.Y - size.Y * scale) / 2.0f;
        canvas.SetColor(9, 11, 14, char(255));
        canvas.SetPosition(Vector2F{0, 0});
        canvas.FillBox(Vector2F{float(screen.X), float(screen.Y)});
        canvas.SetColor(char(255), char(255), char(255), char(255));
        canvas.SetPosition(Vector2F{left, top});
        canvas.DrawTexture(result.frame.get(), scale);
        const auto [width, height, x, y, w, h] = result.layout;
        const float progress = result.deadline > result.start
            ? std::clamp(float(now - result.start) / (result.deadline - result.start), 0.0f, 1.0f) : 0.0f;
        if (progress > 0 && w > 0 && h > 0) {
            const auto accent = result.winner == 0 ? teamHud::blue : teamHud::orange;
            canvas.SetColor(char(accent[0]), char(accent[1]), char(accent[2]), char(accent[3]));
            const float sx = size.X * scale / width, sy = size.Y * scale / height;
            canvas.SetPosition(Vector2F{left + x * sx, top + y * sy});
            canvas.FillBox(Vector2F{w * sx * progress, h * sy});
        }
        if (!result.published) {
            const auto temporary = directory / "inventory-result-native.tmp";
            std::ofstream output(temporary, std::ios::trunc);
            output << result.token << ' ' << now << '\n';
            output.close();
            result.published = output && MoveFileExW(temporary.c_str(),
                (directory / "inventory-result-native.txt").c_str(), MOVEFILE_REPLACE_EXISTING);
        }
    }

    void startIntermissionTrack(const std::string& cue) {
        if (cue == musicCue || nowMs() < nextMusicRetry) return;
        if (intermissionMusic.start(directory / "inventory-rl-music.wav", false)) {
            musicCue = cue;
            cvarManager->log("RL Career: intermission music started (" + cue + ")");
        } else {
            nextMusicRetry = nowMs() + 1000;
            cvarManager->log("RL Career: intermission music unavailable (inventory-rl-music.wav)");
        }
    }

    void updateMusic() {
        std::ifstream input(directory / "inventory-music.txt");
        std::string timeoutCue;
        long long expires = 0;
        if (!(input >> timeoutCue >> expires) || expires <= nowMs() || !timeoutCue.starts_with("timeout-"))
            timeoutCue.clear();
        std::ifstream fallback(directory / "inventory-intermission-music.txt");
        std::string resultCue;
        if (!(fallback >> resultCue >> expires) || expires <= nowMs() || quickSession.empty() ||
            !resultCue.starts_with("postmatch-" + quickSession + "-")) resultCue.clear();
        auto server = gameWrapper->GetGameEventAsServer();
        updatePostmatch(server);
        const bool live = server && server.GetbRoundActive() && !server.GetbMatchEnded();
        const auto now = nowMs();
        if (breakPhase == "timeout" && breakEnds > now) {
            const std::string cue = "tactical-" + breakToken;
            if (musicCue != cue && now >= nextMusicRetry) {
                if (intermissionMusic.start(directory / "inventory-timeout.wav", false)) musicCue = cue;
                else nextMusicRetry = now + 1000;
            }
        } else if (musicCue.starts_with("tactical-")) {
            intermissionMusic.fadeOut();
            musicCue.clear();
        } else if (!timeoutCue.empty() && !live && (!postmatch || postmatch->showingTimeout)) {
            if (timeoutCue != musicCue && now >= nextMusicRetry) {
                if (intermissionMusic.start(directory / "inventory-timeout.wav", false)) musicCue = timeoutCue;
                else nextMusicRetry = now + 1000;
            }
        } else if (postmatch && !postmatch->showingTimeout && !postmatch->released) {
            startIntermissionTrack("postmatch-" + postmatch->token);
        } else if (!resultCue.empty() && !live) {
            startIntermissionTrack(resultCue);
        } else if (musicCue.starts_with("timeout-")) {
            musicCue.clear();
            intermissionMusic.fadeOut();
        }
        intermissionMusic.update();
    }

    void readQuickSettings() {
        std::ifstream input(directory / "inventory-quick-chat.tsv");
        bool enabled = false, calls = false;
        long long expires = 0;
        if (!(input >> quickSession >> enabled >> calls >> expires) || expires < nowMs()) enabled = false;
        quickEnabled = enabled;
        botCalls = calls;
        std::string line;
        std::getline(input, line);
        for (auto& choice : quickMessages) {
            choice = {};
            if (!std::getline(input, line)) continue;
            const auto split = line.find('\t');
            if (split == std::string::npos) continue;
            choice.id = line.substr(0, split);
            choice.label = line.substr(split + 1, 64);
        }
        if (botCalls && quickEnabled && request.roster.size() == 5 && serverAddress &&
            request.token.starts_with(quickSession + "-")) {
            std::ifstream bot(directory / "inventory-quick-bot.txt");
            std::string session, name;
            long long created = 0;
            if (bot >> session >> created && session == request.token && created > lastBotCall &&
                created <= nowMs() && nowMs() - created < 3000) {
                std::getline(bot, name);
                std::getline(bot, name);
                std::string message;
                std::getline(bot, message);
                if (!name.empty() && name.size() <= 48 && !message.empty() && message.size() <= 48) {
                    quickSpeaker = name;
                    quickText = message;
                    quickTextUntil = nowMs() + 2900;
                    lastBotCall = created;
                }
            }
        }
    }

    static std::string quickBind(unsigned direction) {
        return "rlc_quick_direction " + std::to_string(direction);
    }

    void setQuickBinds(bool active) {
        if (!active && !quickBinds) return;
        const bool entering = active && !quickBinds;
        quickBinds = active;
        if (entering || !active) {
            quickGroup = -1;
            quickMenuUntil = tacticUntil = quickTextUntil = 0;
            lastDirection = -1;
        }
        for (unsigned i = 0; i < quickKeys.size(); ++i) {
            const auto current = cvarManager->getBindStringForKey(quickKeys[i]);
            const auto route = quickBind(i);
            if (active && (entering || current != route)) {
                if (entering) savedQuickBinds[i] = current == route ? "" : current;
                // The Hub appends a native command to these same keys. Remove the
                // complete binding before installing our exclusive dispatch.
                if (current != route) {
                    cvarManager->removeBind(quickKeys[i]);
                    cvarManager->setBind(quickKeys[i], route);
                }
            } else if (!active && current.starts_with(route)) {
                cvarManager->removeBind(quickKeys[i]);
                if (!savedQuickBinds[i].empty()) cvarManager->setBind(quickKeys[i], savedQuickBinds[i]);
            }
        }
    }

    bool playedInputActive() {
        if (!serverAddress || request.roster.size() != 5 ||
            request.expires <= nowMs() || !request.token.starts_with(quickSession + "-") ||
            gameWrapper->IsInOnlineGame() || gameWrapper->IsInReplay() || gameWrapper->IsInFreeplay()) return false;
        auto server = gameWrapper->GetGameEventAsServer();
        auto controller = gameWrapper->GetPlayerController();
        auto local = controller ? controller.GetPRI() : PriWrapper(0);
        return server && server.memory_address == serverAddress && !server.GetbMatchEnded() &&
            local && !local.IsSpectator();
    }

    void changeTactic(int step) {
        auto controller = gameWrapper->GetPlayerController();
        auto local = controller ? controller.GetPRI() : PriWrapper(0);
        if (!local) return;
        const int team = local.GetTeamNum();
        if (team > 1) return;
        const auto target = directory / "tactics.txt";
        unsigned long long seq = 0;
        int currentTeam = -1;
        std::string mode;
        {
            std::ifstream existing(target);
            if (existing && !(existing >> seq >> currentTeam >> mode)) return;
        }
        const auto gear = std::find(tacticModes.begin(), tacticModes.end(), mode);
        const int current = currentTeam == team && gear != tacticModes.end() ?
            int(gear - tacticModes.begin()) : 3;
        tacticLevel = std::clamp(current + step, 0, int(tacticModes.size()) - 1);
        if (tacticLevel != current) {
            const auto temporary = directory / "inventory-tactics.tmp";
            std::ofstream output(temporary, std::ios::trunc);
            output << std::max(seq + 1, static_cast<unsigned long long>(nowMs())) << ' '
                << team << ' ' << tacticModes[tacticLevel] << '\n';
            output.close();
            if (!output || !MoveFileExW(temporary.c_str(), target.c_str(), MOVEFILE_REPLACE_EXISTING)) return;
        }
        tacticUntil = nowMs() + 2400;
    }

    void quickDirection(unsigned direction) {
        if (!quickBinds || !playedInputActive()) return;
        auto server = gameWrapper->GetGameEventAsServer();
        if (!server || server.GetPauser()) return;
        const auto now = nowMs();
        if (lastDirection == int(direction) && now - lastDirectionAt < 175) return;
        lastDirection = int(direction);
        lastDirectionAt = now;
        if (quickEnabled && quickGroup >= 0 && quickMenuUntil >= now) {
            const auto group = quickGroup;
            quickGroup = -1;
            if ((group == 1 && server.GetbBallHasBeenHit()) || now - lastQuickCall < 1300) return;
            const auto& choice = quickMessages[group * 4 + direction];
            if (choice.id.empty()) return;
            const auto temporary = directory / "inventory-quick-command.tmp";
            std::ofstream output(temporary, std::ios::trunc);
            output << request.token << ' ' << now + 4500 << ' ' << group << ' ' << choice.id << '\n';
            output.close();
            if (output && MoveFileExW(temporary.c_str(),
                (directory / "inventory-quick-command.txt").c_str(), MOVEFILE_REPLACE_EXISTING)) {
                lastQuickCall = now;
                quickSpeaker = "YOU";
                quickText = choice.label;
                quickTextUntil = now + 2900;
            }
        } else if (direction == 0 || direction == 3) {
            if (!quickEnabled) return;
            quickGroup = direction == 0 ? 0 : 1;
            quickMenuUntil = now + 2300;
            tacticUntil = 0;
        } else {
            quickGroup = -1;
            changeTactic(direction == 1 ? -1 : 1);
        }
    }

    void updateQuickChat(CanvasWrapper canvas) {
        if (!hudFontReady || !quickBinds || !playedInputActive()) return;
        auto server = gameWrapper->GetGameEventAsServer();
        if (!server || server.GetPauser()) return;
        auto controller = gameWrapper->GetPlayerController();
        auto local = controller ? controller.GetPRI() : PriWrapper(0);
        if (!local) return;
        const auto now = nowMs();
        const bool choosing = quickEnabled && quickGroup >= 0 && quickMenuUntil > now;
        const bool showingCall = quickEnabled && quickTextUntil > now;
        const bool showingTactic = !choosing && tacticUntil > now;
        if (!choosing && !showingCall && !showingTactic) return;
        const auto screen = canvas.GetSize();
        const float scale = std::min(screen.X / 1280.0f, screen.Y / 720.0f);
        if (scale <= 0) return;
        teamHud::Panel panel{canvas, hudFont, scale, local.GetTeamNum() == 1 ? teamHud::orange : teamHud::blue};
        constexpr float x = 24, y = 124, width = 276;
        float callY = y;
        if (choosing) {
            constexpr float height = 148;
            panel.surface(x, y, width, height);
            panel.box(x, y, width, 27, {19, 29, 40, 255});
            panel.text(quickGroup == 0 ? "COMM" : "KICK-OFF", x + 13, y, 112, 27, 17);
            panel.text("TEAM QUICK CHAT", x + 137, y, 125, 27, 12, teamHud::muted, true);
            for (unsigned i = 0; i < 4; ++i) {
                const float row = y + 29 + 28 * i;
                panel.direction(i, x + 13, row + 5);
                panel.text(quickMessages[quickGroup * 4 + i].label, x + 43, row, width - 57, 25, 16);
                if (i != 3) panel.box(x + 43, row + 25, width - 57, 1, {48, 61, 74, 235});
            }
            panel.box(x, y + height - 3, width * (quickMenuUntil - now) / 2300, 3, panel.accent);
            callY += height + 9;
        }
        if (showingTactic) {
            constexpr float height = 61, segment = 33;
            panel.surface(x, y, width, height, true);
            panel.text("TEAM TACTICS", x + 13, y, 100, 24, 13, teamHud::muted);
            panel.text(tacticLabels[tacticLevel], x + 113, y, width - 126, 25, 16);
            panel.direction(1, x + 14, y + 34);
            panel.direction(2, x + width - 30, y + 34);
            for (int i = 0; i < int(tacticModes.size()); ++i) {
                auto color = i == tacticLevel ? panel.accent : teamHud::Color{56, 71, 85, 255};
                panel.box(x + 39 + i * (segment - 4), y + 40, segment - 9, 5, color);
            }
            callY += height + 9;
        }
        if (showingCall) {
            panel.surface(x, callY, width, 45, true);
            panel.box(x, callY, 3, 45, panel.accent);
            panel.text(quickSpeaker, x + 12, callY + 3, width - 24, 16, 12, teamHud::muted);
            panel.text(quickText, x + 12, callY + 19, width - 24, 23, 17);
        }
    }

    void tick() {
        capturePostmatch(gameWrapper->GetGameEventAsServer());
        updateMusic();
        if (nowMs() >= nextRead) {
            nextRead = nowMs() + (breakPhase=="loading" ? 120 : 600);
            request = readRequest(directory / "inventory-cameras.tsv");
            readQuickSettings();
            if (!hudFontReady && !request.roster.empty()) hudFontReady = hudFont.prepare(directory / "inventory-font-bahnschrift-v1");
        }
        auto server = gameWrapper->GetGameEventAsServer();
        captureOvertime(server);
        if (request.expires <= nowMs() || request.roster.empty() || !server ||
            gameWrapper->IsInOnlineGame() || gameWrapper->IsInReplay() || gameWrapper->IsInFreeplay() ||
            server.GetbMatchEnded()) {
            if (serverAddress) restore(server);
            return;
        }
        auto controller = gameWrapper->GetPlayerController();
        auto local = controller ? controller.GetPRI() : PriWrapper(0);
        if (!local || bool(local.IsSpectator()) != (request.roster.size() == 6)) {
            if (serverAddress) restore(server);
            return;
        }

        auto players = server.GetPRIs();
        std::unordered_map<std::string, PriWrapper> bots;
        bool otherHuman = false;
        for (int i = 0; i < players.Count(); ++i) {
            auto player = players.Get(i);
            if (player && player.GetbBot()) bots.emplace(key(player.GetPlayerName().ToString()), player);
            else if (player && player.memory_address != local.memory_address && !player.IsSpectator()) otherHuman = true;
        }
        if (otherHuman || bots.size() != request.roster.size() ||
            std::any_of(request.roster.begin(), request.roster.end(), [&](const auto& name) { return !bots.contains(name); })) {
            if (serverAddress) restore(server);
            return;
        }
        if (serverAddress != server.memory_address || matchToken != request.token) {
            if (serverAddress) restore(server);
            serverAddress = server.memory_address;
            matchToken = request.token;
        }
        if (!local.IsSpectator()) {
            setQuickBinds(playedInputActive());
            setNativeMatchInfo(hudFontReady && cvarManager->getCvar("rlcareercameras_hud").getBoolValue());
            setReplacement(hudFontReady && cvarManager->getCvar("rlcareercameras_hud").getBoolValue());
            return;
        }
        const auto profileCount = original.size();
        for (const auto& [name, settings] : request.profiles) {
            auto player = bots.at(name);
            if (original.contains(player.memory_address)) continue;
            original.emplace(player.memory_address, player.GetCameraSettings());
            player.SetCameraSettings(settings);
        }
        if (original.size() != profileCount) {
            cvarManager->log("RL Career Cameras: " + std::to_string(original.size()) + " pro profiles applied");
        }
        setReplacement(hudFontReady && cvarManager->getCvar("rlcareercameras_hud").getBoolValue());
        updateView(controller);
    }

    void setNativeMatchInfo(bool hide) {
        auto controller = gameWrapper->GetPlayerController();
        if (!controller) { restoreMatchInfo = false; return; }
        auto hud = controller.GetSpectatorHud();
        if (!hud) { restoreMatchInfo = false; return; }
        auto viewer = hud.GetViewerData();
        if (!viewer) { restoreMatchInfo = false; return; }
        if (hide && viewer.GetbShowMatchInfoHUD()) {
            restoreMatchInfo = true;
            viewer.SetShowMatchInfoHUD(0);
        } else if (!hide && restoreMatchInfo) {
            viewer.SetShowMatchInfoHUD(1);
            restoreMatchInfo = false;
        }
    }

    void setReplacement(bool active) {
        auto scorebug = cvarManager->getCvar("rlcareer_scorebug");
        if (!scorebug) return;
        if (active) {
            const int visible = scorebug.getIntValue();
            if (!priorScorebug || visible != 0) priorScorebug = visible;
            if (visible != 0) scorebug.setValue(0);
        } else if (!active && priorScorebug) {
            if (scorebug.getIntValue() == 0 && *priorScorebug != 0) scorebug.setValue(*priorScorebug);
            priorScorebug.reset();
        }
    }

    void captureDemo(CarWrapper victim, void* params) {
        if (!serverAddress || !victim || !cvarManager->getCvar("rlcareercameras_hud").getBoolValue()) return;
        auto server = gameWrapper->GetGameEventAsServer();
        if (!server || server.memory_address != serverAddress || server.GetbMatchEnded()) return;
        auto victimPri = victim.GetPRI();
        if (!victimPri || !victimPri.GetbBot()) {
            const auto tracked = playerCars.find(victim.memory_address);
            if (tracked != playerCars.end()) demoVictims[tracked->second] = nowMs();
            return;
        }
        const auto time = nowMs();
        demoVictims[victimPri.memory_address] = time;
        if (!params) return;
        // Resolve the Demolisher actor against live cars without dereferencing the raw pointer.
        uintptr_t attackerAddress = 0;
        std::memcpy(&attackerAddress, params, sizeof(attackerAddress));
        auto players = server.GetPRIs();
        for (int i = 0; i < players.Count(); ++i) {
            auto attacker = players.Get(i);
            if (!attacker || !attacker.GetbBot() || attacker.GetTeamNum() > 1 ||
                attacker.memory_address == victimPri.memory_address) continue;
            auto car = attacker.GetCar();
            if (!car || car.memory_address != attackerAddress) continue;
            demos.push_back({attacker.GetPlayerName().ToString(), victimPri.GetPlayerName().ToString(),
                attacker.GetTeamNum(), nowMs() + eventDuration});
            if (demos.size() > 3) demos.erase(demos.begin());
            return;
        }
    }

    void drawSpectatorHud(CanvasWrapper canvas) {
        if (postmatch && postmatch->frame && !postmatch->hidden && !postmatch->showingTimeout) return;
        if (!hudFontReady || !serverAddress || !cvarManager->getCvar("rlcareercameras_hud").getBoolValue() ||
            gameWrapper->IsInOnlineGame() || gameWrapper->IsInReplay() || gameWrapper->IsInFreeplay()) return;
        auto server = gameWrapper->GetGameEventAsServer();
        if (!server || server.memory_address != serverAddress || server.GetbMatchEnded() || server.GetPauser()) return;
        auto controller = gameWrapper->GetPlayerController();
        if (!controller) return;
        auto local = controller.GetPRI();
        auto hud = controller.GetSpectatorHud();
        if (!local || bool(local.IsSpectator()) != (request.roster.size() == 6)) return;
        const bool compact = !local.IsSpectator();
        if (!compact && !hud) return;
        setReplacement(true);
        if (compact) setNativeMatchInfo(true);
        auto target = hud ? hud.GetTargetPlayerPRI() : PriWrapper(0);
        const auto focus = hud ? hud.GetFocusCar() : CarWrapper(0);
        auto viewer = hud ? hud.GetViewerData() : ReplayViewerDataWrapper(0);
        const auto mode = viewer ? key(viewer.GetCameraMode()) : std::string{};
        const bool freeView = mode.find("fly") != std::string::npos ||
            mode.find("free") != std::string::npos || mode == "ball";
        auto camera = gameWrapper->GetCamera();
        const auto view = camera ? camera.GetViewTarget() : ViewTarget{};
        spectatorHud::Match data;
        matchCrests(data);
        const auto time = nowMs();
        std::erase_if(demos, [&](const Demo& demo) { return demo.until <= time; });
        for (const auto& demo : demos) data.demos.push_back({demo.attacker, demo.victim, demo.team});
        data.header = request.header;
        data.game = request.game;
        data.bestOf = request.bestOf;
        data.wins = {request.blueWins, request.orangeWins};
        data.overtime = server.GetbOverTime();
        const float elapsed = server.GetOvertimeTimePlayed();
        data.seconds = data.overtime && between(elapsed, 0, 7199) ? static_cast<int>(elapsed) : server.GetSecondsRemaining();
        auto teams = server.GetTeams();
        for (int i = 0; i < teams.Count(); ++i) {
            auto team = teams.Get(i);
            if (!team || team.GetTeamNum() > 1) continue;
            const auto index = team.GetTeamNum();
            auto name = team.GetTeamName().ToString();
            if (request.names[index].empty() && !name.empty()) data.names[index] = std::move(name);
            data.score[index] = team.GetScore();
        }
        if (compact) {
            spectatorHud::drawCompact(canvas, hudFont, data);
            return;
        }
        auto players = server.GetPRIs();
        const bool liveRound = server.GetbRoundActive();
        std::array<int, 2> totals{};
        for (int i = 0; i < players.Count(); ++i) {
            auto player = players.Get(i);
            if (player && player.GetbBot() && player.GetTeamNum() < 2) {
                totals[player.GetTeamNum()] += std::max(0, player.GetMatchDemolishes());
            }
        }
        for (unsigned team = 0; team < 2; ++team) {
            if (liveRound && demolitionTotals[team] >= 0 && totals[team] > demolitionTotals[team]) {
                lastTeamDemo[team] = time;
            }
        }
        demolitionTotals = totals;
        for (int i = 0; i < players.Count(); ++i) {
            auto player = players.Get(i);
            if (!player || !player.GetbBot() || player.GetTeamNum() > 1) continue;
            auto car = player.GetCar();
            if (car) playerCars[car.memory_address] = player.memory_address;
            auto boost = car ? car.GetBoostComponent() : BoostWrapper(0);
            const auto amount = boost ? boost.GetCurrentBoostAmount() : -1.0f;
            spectatorHud::Player row;
            row.name = player.GetPlayerName().ToString();
            const bool hasBoost = between(amount, 0, 1.01f);
            row.boostFraction = hasBoost ? std::min(1.0f, amount) : 0.0f;
            row.boost = hasBoost ? int(std::lround(row.boostFraction * 100)) : -1;
            row.focused = !freeView && (focus ? car && car.memory_address == focus.memory_address :
                target && target.GetbBot() ? target.memory_address == player.memory_address :
                view.PRI == reinterpret_cast<void*>(player.memory_address) ||
                (car && view.Target == reinterpret_cast<void*>(car.memory_address)));
            row.stats = {player.GetMatchScore(), player.GetMatchGoals(), player.GetMatchAssists(),
                player.GetMatchShots(), player.GetMatchSaves(), player.GetMatchDemolishes()};
            auto [entry, first] = effects.try_emplace(player.memory_address);
            auto& effect = entry->second;
            const auto elapsedMs = std::clamp(time - effect.sampled, 0LL, 100LL);
            const float blend = 1.0f - std::exp(-float(elapsedMs) / 95.0f);
            effect.dial = first ? row.boostFraction : effect.dial + (row.boostFraction - effect.dial) * blend;
            effect.sampled = time;
            row.dialFraction = effect.dial;
            const bool respawning = player.GetRespawnTimeRemaining() > 0;
            if (!first && respawning && !effect.respawning && server.GetbRoundActive()) {
                effect.wreckedAt = time;
            }
            effect.respawning = respawning;
            const bool hasCar = bool(car);
            if (!liveRound || hasCar) {
                effect.disappearance = 0;
            } else if (!first && effect.hadCar) {
                effect.disappearance = time;
            }
            effect.hadCar = hasCar;
            // The server can clear the destroyed car before delivering the demolition hook.
            // Match that transition to a nearby increase in the opposing team's demo count.
            const auto opponentDemo = lastTeamDemo[1 - player.GetTeamNum()];
            if (effect.disappearance && opponentDemo &&
                std::abs(opponentDemo - effect.disappearance) <= 450) {
                effect.wreckedAt = std::max(effect.wreckedAt, std::max(opponentDemo, effect.disappearance));
                effect.disappearance = 0;
            }
            if (const auto direct = demoVictims.find(player.memory_address); direct != demoVictims.end()) {
                effect.wreckedAt = std::max(effect.wreckedAt, direct->second);
            }
            row.hit = std::clamp(1.0f - float(time - effect.wreckedAt) / float(eventDuration), 0.0f, 1.0f);
            for (unsigned i = 0; i < 3; ++i) {
                const auto value = row.stats[3 + i];
                if (!first && value > effect.last[i]) effect.started[i] = time;
                effect.last[i] = value;
                row.pulse[i] = std::clamp(1.0f - float(time - effect.started[i]) / float(eventDuration), 0.0f, 1.0f);
            }
            for (const auto& demo : demos) {
                const float remaining = std::clamp(float(demo.until - time) / float(eventDuration), 0.0f, 1.0f);
                if (demo.attacker == row.name) row.pulse[2] = std::max(row.pulse[2], remaining);
            }
            data.players[player.GetTeamNum()].push_back(std::move(row));
        }
        if (data.players[0].size() == 3 && data.players[1].size() == 3) spectatorHud::draw(canvas, data, hudFont, hudArt, directory / "inventory-hud-art-v1");
    }

    void updateView(PlayerControllerWrapper controller) {
        auto hud = controller.GetSpectatorHud();
        if (!hud) { restoreView(); return; }
        auto viewer = hud.GetViewerData();
        if (!viewer) { restoreView(); return; }
        if (isFreeView(viewer.GetCameraMode())) { restoreView(); return; }
        auto focus = hud.GetFocusCar();
        auto target = hud ? hud.GetTargetPlayerPRI() : PriWrapper(0);
        auto camera = gameWrapper->GetCamera();
        if (!focus || !target || !camera) { restoreView(); return; }
        if (!original.contains(target.memory_address)) { restoreView(); return; }
        auto profile = request.profiles.find(key(target.GetPlayerName().ToString()));
        if (profile == request.profiles.end()) { restoreView(); return; }
        if (cameraAddress != camera.memory_address) {
            savedView = camera.GetCameraSettings();
            cameraAddress = camera.memory_address;
            focusAddress = 0;
        }
        if (focusAddress != target.memory_address) {
            camera.SetCameraSettings(profile->second);
            focusAddress = target.memory_address;
            cvarManager->log("RL Career Cameras: viewing " + profile->first);
        }
    }

    static bool isFreeView(const std::string& name) {
        const auto mode = key(name);
        return mode.find("fly") != std::string::npos || mode.find("free") != std::string::npos ||
            mode.find("director") != std::string::npos || mode == "ball";
    }

};

BAKKESMOD_PLUGIN(CareerCameras, "RL Career Spectator Cameras", "0.3.9", PLUGINTYPE_SPECTATOR)
