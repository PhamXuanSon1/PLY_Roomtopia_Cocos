import { _decorator, Animation, CCString, Component, instantiate, Label, Node, Prefab, Vec3 } from 'cc';
const { ccclass, property } = _decorator;

/**
 * WinReact: chữ phản hồi ("Great!", "Perfect!"...) — animation làm bằng AnimationClip của Cocos
 * (assets/1.Animations/WinReact.anim: scale nảy + fade opacity + trôi lên, đánh vào node con "Text"),
 * script chỉ: chọn chữ → play clip → hết clip thì destroy node.
 *
 *  Prefab dựng theo px (font ~80). Node cha là UI 2D tính theo world unit → spawner đặt scale (vd 0.003 như HandSprite).
 *  Dùng: WinReact.spawn(prefab, parent, worldPos, scale) hoặc kéo prefab vào scene (autoPlay chạy ở start()).
 */
@ccclass('WinReact')
export class WinReact extends Component {
    @property({ type: Label, tooltip: 'Label hiện chữ (node con Text). Để trống → Label trong con' })
    label: Label | null = null;

    @property({ type: Animation, tooltip: 'Animation chứa clip WinReact. Để trống → Animation trên node này' })
    anim: Animation | null = null;

    @property({ type: [CCString], tooltip: 'Chọn ngẫu nhiên 1 chữ mỗi lần play (để trống = giữ chữ trong prefab)' })
    texts: string[] = ['Great!', 'Nice!', 'Perfect!'];

    @property({ tooltip: 'Tự chạy khi start()' })
    autoPlay = true;

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
        const label = this.label ?? this.getComponentInChildren(Label);
        const t = text ?? (this.texts.length ? this.texts[Math.floor(Math.random() * this.texts.length)] : undefined);
        if (label && t !== undefined) label.string = t;

        const anim = this.anim ?? this.getComponent(Animation);
        if (!anim || !anim.defaultClip) { this.node.destroy(); return; }
        anim.once(Animation.EventType.FINISHED, () => { if (this.node.isValid) this.node.destroy(); });
        anim.play();
    }
}
