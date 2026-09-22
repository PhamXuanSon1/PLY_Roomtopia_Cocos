import { _decorator, CCString, Component, instantiate, Label, Node, Prefab, tween, UIOpacity, Vec3 } from 'cc';
const { ccclass, property } = _decorator;

/**
 * WinReact: chữ phản hồi ("Great!", "Perfect!"...) nảy lên rồi mờ dần — không dùng particle.
 *
 *  Timeline: scale 0 → popScale (backOut) → 1, giữ holdTime, rồi fade opacity về 0 + trôi lên riseY, xong tự destroy.
 *  Prefab dựng theo px (font ~80). Node cha là UI 2D tính theo world unit → spawner đặt scale (vd 0.003 như HandSprite).
 *
 *  Dùng: WinReact.spawn(prefab, parent, worldPos, scale) hoặc kéo prefab vào scene (autoPlay chạy ở start()).
 */
@ccclass('WinReact')
export class WinReact extends Component {
    @property({ type: Label, tooltip: 'Label hiện chữ. Để trống → Label trên node này' })
    label: Label | null = null;

    @property({ type: [CCString], tooltip: 'Chọn ngẫu nhiên 1 chữ mỗi lần play (để trống = giữ chữ trong prefab)' })
    texts: string[] = ['Great!', 'Nice!', 'Perfect!'];

    @property({ tooltip: 'Tự chạy khi start()' })
    autoPlay = true;

    @property({ group: 'Scale', tooltip: 'Nảy quá scale gốc bao nhiêu lần trước khi về 1' })
    popScale = 1.3;

    @property({ group: 'Scale', tooltip: 'Thời gian nảy từ 0 lên popScale (s)' })
    popTime = 0.25;

    @property({ group: 'Scale', tooltip: 'Thời gian co từ popScale về 1 (s)' })
    settleTime = 0.1;

    @property({ group: 'Fade', tooltip: 'Giữ nguyên bao lâu trước khi mờ (s)' })
    holdTime = 0.4;

    @property({ group: 'Fade', tooltip: 'Thời gian mờ dần về 0 (s)' })
    fadeTime = 0.35;

    @property({ group: 'Fade', tooltip: 'Trôi lên bấy nhiêu px (local, nhân với scale node) trong lúc mờ' })
    riseY = 60;

    private baseScale = new Vec3(1, 1, 1);

    /** Spawn prefab tại worldPos (dưới parent UI 2D), tự play + tự huỷ */
    static spawn(prefab: Prefab, parent: Node, worldPos: Vec3, scale = 0.003, text?: string): WinReact | null {
        const n = instantiate(prefab);
        n.setParent(parent, false);
        n.setScale(scale, scale, scale);
        n.setWorldPosition(worldPos);
        const r = n.getComponent(WinReact);
        if (r) { r.autoPlay = false; r.play(text); }
        return r;
    }

    start() {
        if (this.autoPlay) this.play();
    }

    play(text?: string) {
        const label = this.label ?? this.getComponent(Label);
        const t = text ?? (this.texts.length ? this.texts[Math.floor(Math.random() * this.texts.length)] : undefined);
        if (label && t !== undefined) label.string = t;

        const op = this.getComponent(UIOpacity) ?? this.addComponent(UIOpacity)!;
        this.baseScale.set(this.node.scale);
        const n = this.node;
        op.opacity = 255;
        n.setScale(0, 0, 0);

        const pop = Vec3.multiplyScalar(new Vec3(), this.baseScale, this.popScale);
        const rise = n.position.clone().add3f(0, this.riseY * this.baseScale.y, 0);

        tween(n)
            .to(this.popTime, { scale: pop }, { easing: 'backOut' })
            .to(this.settleTime, { scale: this.baseScale.clone() })
            .delay(this.holdTime)
            .to(this.fadeTime, { position: rise }, { easing: 'sineOut' })
            .call(() => { if (n.isValid) n.destroy(); })
            .start();
        tween(op)
            .delay(this.popTime + this.settleTime + this.holdTime)
            .to(this.fadeTime, { opacity: 0 })
            .start();
    }
}
