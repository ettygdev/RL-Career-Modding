#pragma once

namespace teamHud {
using Color = std::array<unsigned char, 4>;
inline constexpr Color white{248, 251, 255, 255}, muted{179, 197, 210, 255};
inline constexpr Color blue{40, 192, 255, 255}, orange{255, 107, 29, 255};

struct Panel {
    CanvasWrapper canvas;
    spectatorHud::HudFont& font;
    float scale;
    Color accent;

    void color(Color c) {
        canvas.SetColor(char(c[0]), char(c[1]), char(c[2]), char(c[3]));
    }
    void box(float x, float y, float w, float h, Color c) {
        if (w <= 0 || h <= 0) return;
        color(c);
        canvas.SetPosition(Vector2F{x * scale, y * scale});
        canvas.FillBox(Vector2F{w * scale, h * scale});
    }
    void text(const std::string& value, float x, float y, float w, float h, float size,
              Color c = white, bool center = false) {
        color(c);
        font.draw(canvas, value, x * scale, y * scale, w * scale, h * scale, size * scale, center);
    }
    void surface(float x, float y, float w, float h, bool tinted = false) {
        box(x + 2, y + 3, w, h, {4, 6, 10, 165});
        box(x - 1, y - 1, w + 2, h + 2, {77, 95, 109, 255});
        const Color start = tinted ? Color{22, 43, 60, 255} : Color{28, 38, 50, 255};
        const Color end{8, 11, 17, 255};
        constexpr int steps = 40;
        for (int i = 0; i < steps; ++i) {
            Color current{};
            for (unsigned j = 0; j < current.size(); ++j)
                current[j] = static_cast<unsigned char>(start[j] + (end[j] - start[j]) * i / float(steps - 1));
            box(x + w * i / steps, y, w / steps + 0.12f, h, current);
        }
    }
    void direction(unsigned index, float x, float y) {
        box(x + 5, y, 6, 16, {59, 77, 91, 255});
        box(x, y + 5, 16, 6, {59, 77, 91, 255});
        constexpr std::array<float, 4> offsetsX{5, 0, 11, 5}, offsetsY{0, 5, 5, 11};
        box(x + offsetsX[index], y + offsetsY[index], index == 1 || index == 2 ? 5 : 6,
            index == 1 || index == 2 ? 6 : 5, accent);
    }
};
}
