#pragma once
#include <fstream>
#include <filesystem>
#include <array>

#include <memory>
#include <string_view>
#include "bakkesmod/wrappers/CanvasWrapper.h"

namespace spectatorHud {
class HudFont {
    struct Glyph {
        float advance = 0;

        std::filesystem::path file;
        std::unique_ptr<ImageWrapper> image;
    };
    std::array<Glyph, 95> glyphs;
    static constexpr float em = 64.0f;

    static std::string ascii(std::string_view input) {
        std::string result;
        for (const unsigned char ch : input) {
            if (ch >= 32 && ch < 127) result += char(ch);
            else if ((ch & 0xc0) != 0x80) result += '?';
        }
        return result;
    }

public:
    bool prepare(const std::filesystem::path& directory) {
        std::ifstream metrics(directory / "metrics.txt");
        for (unsigned i = 0; i < glyphs.size(); ++i) {
            unsigned code = 0;
            auto& glyph = glyphs[i];
            if (!(metrics >> code >> glyph.advance) || code != i + 32 ||
                glyph.advance <= 0 || glyph.advance > 96) return false;
            if (code != 32) {
                glyph.file = directory / (std::to_string(code) + ".png");
                std::error_code error;
                if (!std::filesystem::is_regular_file(glyph.file, error)) return false;
            }
        }
        return true;
    }

    void draw(CanvasWrapper& canvas, std::string_view value, float x, float y, float w, float h,
        float size, bool centered) {
        const auto visible = ascii(value);
        float width = 0;
        for (char ch : visible) width += glyphs[ch - 32].advance;
        if (width <= 0) return;
        const float ratio = std::min(size / em, w / width);
        float left = x + (centered ? (w - width * ratio) / 2 : 0);
        const float top = y + (h - 80 * ratio) / 2;
        for (char ch : visible) {
            auto& glyph = glyphs[ch - 32];
            if (!glyph.file.empty()) {
                if (!glyph.image) glyph.image = std::make_unique<ImageWrapper>(glyph.file, true, false);
                if (glyph.image->IsLoadedForCanvas()) {
                    canvas.SetPosition(Vector2F{left - 8 * ratio, top});
                    canvas.DrawTexture(glyph.image.get(), ratio);
                }
            }
            left += glyph.advance * ratio;
        }
    }
};
}
