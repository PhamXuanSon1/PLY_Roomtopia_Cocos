import { _decorator, Animation, CCString, Label, Node, Quat, Vec3 } from 'cc';
import { Ply_GameUnit } from '../ScriptTemplate/Ply_GameUnit';
import { Ply_Pool } from '../ScriptTemplate/Ply_Pool';
import { PoolType } from '../ScriptTemplate/Ply_Types';
const { ccclass, property } = _decorator;

/**
 * WinReact: chữ phản hồi ("Great!", "Perfect!"...) — animation làm bằng AnimationClip của Cocos
 * (assets/1.Animations/WinReact.anim: scale nảy + fade opacity + trôi lên, đánh vào node con "Text"),
 * script chỉ: chọn chữ → play clip → hết clip thì trả về Ply_Pool (PoolType.WinReact).
 *
 *  Prefab dựng theo px (font ~80). Node cha là UI 2D tính theo world unit → spawner đặt scale (vd 0.003 như HandSprite).
 *  Dùng: WinReact.spawn(parent, worldPos, scale) — prefab khai báo ở Ply_Pool; hoặc kéo prefab vào scene (autoPlay chạy ở start()).
 */
@ccclass('WinReact')
export class WinReact extends Ply_GameUnit {
    @property({ type: Label, tooltip: 'Label hiện chữ (node con Text). Để trống → Label trong con' })
    label: Label | null = null;

    @property({ type: Animation, tooltip: 'Animation chứa clip WinReact. Để trống → Animation trên node này' })
    anim: Animation | null = null;

    @property({ type: [CCString], tooltip: 'Chọn ngẫu nhiên 1 chữ mỗi lần play (để trống = giữ chữ trong prefab)' })
    texts: string[] = ['Great!', 'Nice!', 'Perfect!'];

    @property({ tooltip: 'Tự chạy khi start() (khi đặt thẳng prefab vào scene). Lấy từ Ply_Pool thì luôn tắt' })
    autoPlay = true;

    /** Gán loại WinReact để chữ phản hồi được thu hồi về đúng pool. */
    onLoad() {
        this.poolType = PoolType.WinReact;
    }

    /** Lấy chữ từ Ply_Pool tại worldPos (dưới parent UI 2D), tự play, hết clip tự trả về pool */
    static spawn(parent: Node, worldPos: Vec3, scale = 0.003, text?: string): WinReact | null {
        const unit = Ply_Pool.Ins?.spawn(PoolType.WinReact, worldPos, Quat.IDENTITY, parent);
        const r = unit?.getComponent(WinReact) ?? null;
        if (!r) { unit?.despawn(); return null; }
        r.node.setScale(scale, scale, scale);
        r.node.setWorldPosition(worldPos);
        r.autoPlay = false;
        r.play(text);
        return r;
    }

    /** Tự phát khi prefab đặt sẵn trong scene; đối tượng lấy từ pool đã được spawn() phát. */
    start() {
        if (this.autoPlay) this.play();
    }

    /** Hiện chữ truyền vào hoặc chọn ngẫu nhiên; phát clip rồi về pool, thiếu clip thì thu hồi ngay. */
    play(text?: string) {
        const label = this.label ?? this.getComponentInChildren(Label);
        const t = text ?? (this.texts.length ? this.texts[Math.floor(Math.random() * this.texts.length)] : undefined);
        if (label && t !== undefined) label.string = t;

        const anim = this.anim ?? this.getComponent(Animation);
        if (!anim || !anim.defaultClip) { this.despawn(); return; }
        anim.once(Animation.EventType.FINISHED, () => { if (this.node.isValid) this.despawn(); });
        anim.play();
    }
}
