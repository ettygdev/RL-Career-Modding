#pragma once
#include "bakkesmod/wrappers/CanvasWrapper.h"
#include "bakkesmod/wrappers/GameObject/CarWrapper.h"
#include "bakkesmod/wrappers/GameObject/CarComponent/BoostWrapper.h"
#include "bakkesmod/wrappers/GameObject/TeamWrapper.h"
#include <array>
#include "hud-font.h"

namespace spectatorHud {
struct Player {
    std::string name;
    int boost = -1;
    float boostFraction = 0;
    float dialFraction = 0;
    bool focused = false;
    std::array<int, 6> stats{};
    std::array<float, 3> pulse{};
    float hit = 0;
};
struct Demo { std::string attacker, victim; unsigned team; };
struct Match {
    std::string header;
    std::array<std::string, 2> names{"BLUE", "ORANGE"};
    std::array<int, 2> score{};
    std::array<ImageWrapper*, 2> crests{};
    std::vector<Demo> demos;
    std::array<std::vector<Player>, 2> players;
    unsigned game = 0;
    unsigned bestOf = 0;
    std::array<unsigned, 2> wins{};
    int seconds = 0;
    bool overtime = false;
};

inline std::string uppercaseAscii(std::string value) {
    for (char& c : value) if (c >= 'a' && c <= 'z') c -= 'a' - 'A';
    return value;
}

class HudArt {
public:
    enum Asset { Shot, Save, DemoIcon, Wreck, Panel, Dial };
    ImageWrapper* get(const std::filesystem::path& folder, Asset asset) {
        constexpr std::array names{"shot", "save", "demo", "wreck", "panel", "dial"};
        auto& image = images[asset];
        if (!image) {
            const auto file = folder / (std::string(names[asset]) + ".png");
            std::error_code error;
            if (!std::filesystem::is_regular_file(file, error)) return nullptr;
            image = std::make_unique<ImageWrapper>(file, true, false);
        }
        return image->IsLoadedForCanvas() ? image.get() : nullptr;
    }
private:
    std::array<std::unique_ptr<ImageWrapper>, 6> images;
};

inline void drawCompact(CanvasWrapper canvas, HudFont& font, const Match& match) {
    const auto screen = canvas.GetSize();
    const float scale = std::min(screen.X / 1280.0f, screen.Y / 720.0f);
    if (scale <= 0) return;
    const float x = screen.X / scale / 2 - 224;
    constexpr float width = 448;
    constexpr float headerHeight = 17;
    constexpr float scoreHeight = 42;
    constexpr float footerTop = headerHeight + scoreHeight;
    constexpr float footerHeight = 18;
    auto box = [&](float left, float top, float w, float h, int r, int g, int b) {
        canvas.SetColor(char(r), char(g), char(b), char(255));
        canvas.SetPosition(Vector2F{left * scale, top * scale});
        canvas.FillBox(Vector2F{w * scale, h * scale});
    };
    box(x - 1, 0, width + 2, footerTop + footerHeight + 1, 68, 82, 98);
    box(x, 0, width, footerTop + footerHeight, 12, 17, 24);
    const std::array<int, 3> middle = match.overtime ? std::array{155, 26, 43} : std::array{29, 37, 48};
    const std::array<std::array<int, 3>, 3> stops{{{15, 74, 120}, middle, {126, 52, 21}}};
    for (unsigned i = 0; i < 48; ++i) {
        const unsigned side = i / 24;
        const float t = (i % 24) / 23.0f;
        auto channel = [&](unsigned j) { return int(stops[side][j] + (stops[side + 1][j] - stops[side][j]) * t); };
        box(x + width * i / 48, headerHeight, width / 48 + 0.25f, scoreHeight, channel(0), channel(1), channel(2));
    }
    auto text = [&](const std::string& value, float left, float y, float w, float h, float size) {
        canvas.SetColor(char(255), char(255), char(255), char(255));
        font.draw(canvas, value, left * scale, y * scale, w * scale, h * scale, size * scale, true);
    };
    const auto header = match.header.empty() ? "CAREER MATCH" : uppercaseAscii(match.header);
    text(header, x + 8, 0, width - 16, headerHeight, 11.5f);
    for (unsigned team = 0; team < 2; ++team) {
        const float left = x + (team ? 294 : 0);
        auto* logo = match.crests[team];
        const bool hasLogo = logo && logo->IsLoadedForCanvas() && logo->GetSizeF().X > 0 && logo->GetSizeF().Y > 0;
        if (hasLogo) {
            const auto size = logo->GetSizeF();
            const float factor = 24 / std::max(size.X, size.Y);
            const float logoX = left + (team ? 124 : 8);
            canvas.SetColor(char(255), char(255), char(255), char(255));
            canvas.SetPosition(Vector2F{(logoX + (24 - size.X * factor) / 2) * scale,
                (headerHeight + (scoreHeight - size.Y * factor) / 2) * scale});
            canvas.DrawTexture(logo, factor * scale);
        }
        text(uppercaseAscii(match.names[team]), left + (hasLogo && !team ? 38 : 7), headerHeight,
            hasLogo ? 108 : 138, scoreHeight, 17);
    }
    box(x + 154, headerHeight + 8, 1, 26, 87, 100, 118);
    box(x + 293, headerHeight + 8, 1, 26, 87, 100, 118);
    text(std::to_string(match.score[0]), x + 155, headerHeight, 37, scoreHeight, 25);
    const int seconds = std::clamp(match.seconds, 0, 7199);
    const auto clock = std::string(match.overtime ? "OT +" : "") + std::to_string(seconds / 60) + ":" +
        (seconds % 60 < 10 ? "0" : "") + std::to_string(seconds % 60);
    text(clock, x + 192, headerHeight, 64, scoreHeight, 19);
    text(std::to_string(match.score[1]), x + 256, headerHeight, 37, scoreHeight, 25);
    if (match.game && match.bestOf) {

        text("GAME " + std::to_string(match.game) + " | BO" + std::to_string(match.bestOf), x + 155, footerTop, 138, footerHeight, 11);
        const auto needed = (match.bestOf + 1) / 2;
        const float pitch = 120.0f / needed;
        for (unsigned i = 0; i < needed; ++i) {
            const bool blue = i < match.wins[0], orange = i < match.wins[1];
            box(x + 5 + (needed - 1 - i) * pitch, footerTop + 8, pitch - 3, 3, blue ? 40 : 45, blue ? 192 : 54, blue ? 255 : 67);
            box(x + 323 + i * pitch, footerTop + 8, pitch - 3, 3, orange ? 255 : 45, orange ? 107 : 54, orange ? 29 : 67);
        }
    }
}

inline void draw(CanvasWrapper canvas, const Match& match, HudFont& font, HudArt& art,
        const std::filesystem::path& artFolder) {
    const auto screen = canvas.GetSize();
    const float scale = std::min(screen.X / 1280.0f, screen.Y / 720.0f);
    if (scale <= 0) return;
    const float width = screen.X / scale;
    const float height = screen.Y / scale;
    const float center = width / 2;
    using Color = std::array<unsigned char, 4>;
    const Color panel{8, 10, 15, 252}, track{39, 49, 64, 255}, white{249, 252, 255, 255};
    const Color muted{170, 184, 197, 255}, red{176, 27, 43, 255};
    const std::array<Color, 2> accent{{{40, 192, 255, 255}, {255, 107, 29, 255}}};
    const std::array<Color, 2> tint{{{13, 63, 107, 255}, {107, 40, 17, 255}}};
    auto color = [&](Color c) { canvas.SetColor(char(c[0]), char(c[1]), char(c[2]), char(c[3])); };
    auto box = [&](float x, float y, float w, float h, Color c) {
        if (w <= 0 || h <= 0) return;
        color(c);
        canvas.SetPosition(Vector2F{x * scale, y * scale});
        canvas.FillBox(Vector2F{w * scale, h * scale});
    };
    auto text = [&](std::string value, float x, float y, float w, float h, float size, Color c, bool centered = true) {
        color(c);
        font.draw(canvas, value, x * scale, y * scale, w * scale, h * scale, size * 18 * scale, centered);
    };
    constexpr float pi = 3.14159265f;
    auto texture = [&](HudArt::Asset asset, float x, float y, float width, Color tint = {255, 255, 255, 255}) {
        auto* image = art.get(artFolder, asset);
        if (!image) return false;
        const auto size = image->GetSizeF();
        if (size.X <= 0) return false;
        color(tint);
        canvas.SetPosition(Vector2F{x * scale, y * scale});
        canvas.DrawTexture(image, width * scale / size.X);
        return true;
    };
    auto mix = [](Color from, Color to, float amount) {
        Color c;
        for (unsigned i = 0; i < c.size(); ++i) {
            c[i] = static_cast<unsigned char>(from[i] + (to[i] - from[i]) * amount);
        }
        return c;
    };
    auto number = [](int value) { return value >= 0 ? std::to_string(value) : std::string("-"); };
    const auto seconds = std::clamp(match.seconds, 0, 7199);
    const std::string clock = (match.overtime ? "+" : "") + std::to_string(seconds / 60) + ":" +
        (seconds % 60 < 10 ? "0" : "") + std::to_string(seconds % 60);

    const Color rim{78, 94, 109, 255}, shade{25, 37, 51, 252};
    auto fade = [&](float x, float y, float w, float h, Color start, Color end, bool reverse = false) {
        constexpr unsigned steps = 24;
        for (unsigned i = 0; i < steps; ++i) {
            const float t = i / float(steps - 1);
            const auto c = mix(start, end, reverse ? 1 - t : t);
            box(x + w * i / steps, y, w / steps + 0.3f, h, c);
        }
    };
    auto frame = [&](float x, float y, float w, float h) {
        box(x + 2, y + 3, w, h, Color{4, 6, 10, 175});
        box(x - 1, y - 1, w + 2, h + 2, rim);
    };
    auto surface = [&](float x, float y, float w, float h) {
        frame(x, y, w, h);
        fade(x, y, w, h, shade, panel);
    };
    auto scoreSurface = [&](float x, float y, float w, float h) {
        const Color black{8, 10, 14, 255}, gray{39, 45, 54, 255};
        frame(x, y, w, h);
        fade(x, y, w / 2, h, black, gray);
        fade(x + w / 2, y, w / 2, h, gray, black);
    };
    const float top = match.header.empty() ? 21 : 38;
    if (!match.header.empty()) {
        scoreSurface(center - 301, 16, 602, 19);
        text(uppercaseAscii(match.header), center - 287, 15, 574, 21, 0.82f, white);
    }
    const Color blueEdge{16, 82, 127, 255}, orangeEdge{133, 57, 20, 255};
    const Color scoreCenter = match.overtime ? red : Color{44, 52, 63, 255};
    frame(center - 301, top, 602, 44);
    fade(center - 301, top, 301, 44, blueEdge, scoreCenter);
    fade(center, top, 301, 44, scoreCenter, orangeEdge);
    box(center - 91, top + 8, 1, 28, rim);
    box(center + 90, top + 8, 1, 28, rim);
    if (match.overtime) text("OT", center - 44, top + 2, 88, 14, 0.76f, white);
    for (unsigned team = 0; team < 2; ++team) {
        const float x = team ? center + 91 : center - 300;
        const bool loaded = match.crests[team] && match.crests[team]->IsLoadedForCanvas();
        const float logoX = team ? x + 168 : x + 7;
        if (loaded) {
            const auto size = match.crests[team]->GetSizeF();
            if (size.X > 0 && size.Y > 0) {
                const float factor = 32 / std::max(size.X, size.Y);
                color(white);
                canvas.SetPosition(Vector2F{(logoX + (32 - size.X * factor) / 2) * scale,
                    (top + 5 + (32 - size.Y * factor) / 2) * scale});
                canvas.DrawTexture(match.crests[team], factor * scale);
            }
        }
        text(uppercaseAscii(match.names[team]), x + (loaded && !team ? 46 : 7), top,
            loaded ? 157 : 194, 40, 1.19f, white);
    }
    text(number(match.score[0]), center - 90, top, 42, 43, 1.75f, white);
    text(number(match.score[1]), center + 48, top, 42, 43, 1.75f, white);
    text(clock, center - 44, top + (match.overtime ? 15 : 0), 88,
        match.overtime ? 28 : 43, match.overtime ? 1.26f : 1.61f, white);
    if (match.game && match.bestOf) {
        scoreSurface(center - 301, top + 47, 602, 22);
        text("GAME " + std::to_string(match.game) + " | BO" + std::to_string(match.bestOf),
            center - 90, top + 46, 180, 24, 0.83f, white);
        const unsigned needed = (match.bestOf + 1) / 2;
        const float pitch = 187.0f / needed;
        for (unsigned i = 0; i < needed; ++i) {
            box(center - 105 - pitch * (i + 1), top + 55, pitch - 5, 6,
                i < match.wins[0] ? accent[0] : track);
            box(center + 105 + pitch * i, top + 55, pitch - 5, 6,
                i < match.wins[1] ? accent[1] : track);
        }
    }

    for (unsigned i = 0; i < match.demos.size(); ++i) {
        const auto& demo = match.demos[i];
        const float x = width - 250, y = top + 128 + i * 26;
        box(x, y, 228, 22, panel);
        box(x, y, 3, 22, accent[demo.team]);
        text(uppercaseAscii(demo.attacker) + "  >  " + uppercaseAscii(demo.victim),
            x + 10, y, 208, 22, 0.74f, white);
    }
    for (unsigned team = 0; team < 2; ++team) {
        float y = top;
        const float x = team ? width - 242 : 22;
        for (const auto& player : match.players[team]) {
            const auto strongest = std::max_element(player.pulse.begin(), player.pulse.end());
            const bool victim = player.hit > 0;
            const float remaining = victim ? player.hit : *strongest;
            const auto eventIcon = victim ? HudArt::Wreck : static_cast<HudArt::Asset>(strongest - player.pulse.begin());
            const float extension = 36 * std::clamp(std::min((1 - remaining) * 16, remaining * 7), 0.0f, 1.0f);
            const float rowX = team ? x - extension : x;
            const float rowWidth = 220 + extension;
            frame(rowX, y, rowWidth, 32);
            const Color edge = player.focused ? mix(tint[team], accent[team], 0.16f) : tint[team];
            const Color inner = mix(panel, Color{54, 63, 75, 255}, extension / 36.0f);
            fade(rowX, y, rowWidth, 32, edge, inner, team != 0);
            if (extension > 0.5f) {
                if (extension > 18) {
                    const float iconSize = std::min(20.0f, extension - 5);
                    const float middle = team ? x - extension / 2 : x + 220 + extension / 2;
                    texture(eventIcon, middle - iconSize / 2, y + (25 - iconSize) / 2, iconSize);
                }
            }
            const float trackWidth = rowWidth - 16;
            box(rowX + 8, y + 27, trackWidth, 2.5f, track);
            const float fill = trackWidth * player.boostFraction;
            box(team ? rowX + rowWidth - 8 - fill : rowX + 8, y + 27, fill, 2.5f, accent[team]);
            const float numberX = team ? x + 8 : x + 174;
            const float nameX = team ? x + 50 : x + 12;
            text(uppercaseAscii(player.name), nameX, y, 156, 25, 1.06f, white, team != 0);
            text(number(player.boost), numberX, y, 37, 25, 1.17f, white);
            y += 37;
            if (!player.focused) continue;

            const float footer = height - 68;
            surface(22, footer, 478, 46);
            fade(22, footer, 148, 46, tint[team], shade);
            box(169, footer, 1, 43, rim);
            box(22, footer + 43, 478, 3, accent[team]);
            text(uppercaseAscii(player.name), 32, footer, 128, 43, 0.94f, white);
            constexpr std::array labels{"SCORE", "GOALS", "ASSISTS", "SHOTS", "SAVES", "DEMOS"};
            for (unsigned i = 0; i < labels.size(); ++i) {
                const float col = 171 + i * 54.5f;
                text(labels[i], col, footer + 3, 53, 15, 0.59f, muted);
                text(number(player.stats[i]), col, footer + 17, 53, 23, 1.0f, white);
            }
            const float cx = width - 92, cy = height - 88;
            texture(HudArt::Dial, cx - 68, cy - 68, 136);
            constexpr unsigned slices = 128;
            const float fraction = std::clamp(player.dialFraction, 0.0f, 1.0f);
            for (unsigned i = 0; i < slices && i < fraction * slices; ++i) {
                const float a = -pi / 2 + i * 2 * pi / slices;
                const float b = -pi / 2 + std::min((i + 1) / float(slices), fraction) * 2 * pi;
                const auto point = [&](float radius, float angle) {
                    return Vector2F{(cx + radius * std::cos(angle)) * scale,
                        (cy + radius * std::sin(angle)) * scale};
                };
                color(mix(accent[team], white, 0.18f * i / slices));
                canvas.FillTriangle(point(52, a), point(58.5f, a), point(58.5f, b));
                canvas.FillTriangle(point(52, a), point(58.5f, b), point(52, b));
            }
            text(number(player.boost), cx - 40, cy - 31, 80, 45, 2.28f, white);
            text("BOOST", cx - 36, cy + 15, 72, 20, 0.68f, muted);
        }
    }
}
}
