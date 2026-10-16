import { _decorator, Camera, Enum, math, Node, ParticleSystem, Quat } from 'cc';
import { Ply_GameUnit } from '../ScriptTemplate/Ply_GameUnit';
import { PoolType } from '../ScriptTemplate/Ply_Types';
import { ItemGraphic } from '../Item/ItemGraphic';
const { ccclass, property } = _decorator;

/** Lấy cạnh nào của bbox item (theo mặt phẳng màn hình) để scale effect */
export enum FxFitMode { Mean = 0, Width = 1, Height = 2, Max = 3, Min = 4 }
Enum(FxFitMode);

/**
 * BlinkFx — gắn trên ROOT prefab BlinkEffect3D. Prefab tự biết nổ ra sao: to/nhỏ theo item, xoay theo camera,
 * đặt ở tâm bbox target, tắt depth-test cho hạt, hết hạt thì tự trả về Ply_Pool.
 *  Dùng: (Ply_Pool.Ins.spawn(PoolType.BlinkFx)?.getComponent(BlinkFx))?.play(target, cam, layer)
 *
 *  Fit theo item: scale = clamp(cạnh bbox item trên màn hình × fitPadding / fitRefSize, fitMin, fitMax) × scale
 *  → đồ to (sàn, tường) nổ to, đồ nhỏ (bàn chải, lọ) nổ nhỏ.
 */
@ccclass('BlinkFx')
export class BlinkFx extends Ply_GameUnit {
    @property({ tooltip: 'Nhân thêm độ to của effect (1 = đúng kết quả fit theo item)' })
    scale = 1;

    @property({ tooltip: 'BẬT: effect to / nhỏ theo kích thước item trên màn hình. TẮT: luôn dùng `scale`' })
    fitToItem = true;

    @property({ type: FxFitMode, visible(this: BlinkFx) { return this.fitToItem; }, tooltip: 'Đo item theo cạnh nào: Mean = trung bình nhân rộng×cao (đồ dài như sàn không bị quá to), Width = bề ngang, Height = bề cao, Max / Min = cạnh lớn / nhỏ' })
    fitMode = FxFitMode.Mean;

    @property({ visible(this: BlinkFx) { return this.fitToItem; }, tooltip: 'Item có cạnh (world unit) bằng số này thì effect giữ scale 1. Prefab dàn hạt rộng ~1.8 unit' })
    fitRefSize = 1.8;

    @property({ visible(this: BlinkFx) { return this.fitToItem; }, tooltip: 'Effect rộng hơn item bấy nhiêu lần (1 = vừa khít, 1.2 = lòi ra 20%)' })
    fitPadding = 1.2;

    @property({ visible(this: BlinkFx) { return this.fitToItem; }, tooltip: 'Scale nhỏ nhất (đồ rất nhỏ vẫn thấy rõ effect)' })
    fitMin = 0.35;

    @property({ visible(this: BlinkFx) { return this.fitToItem; }, tooltip: 'Scale lớn nhất (đồ rất to không nổ tràn màn)' })
    fitMax = 2;

    @property({ tooltip: 'Dịch effect lên trên (world Y) bấy nhiêu unit so với tâm bbox target' })
    offsetY = 0;

    private _depthOff = false;

    /** Gán loại BlinkFx để hiệu ứng được trả về đúng pool khi hết hạt. */
    onLoad() {
        this.poolType = PoolType.BlinkFx;
    }

    /** Scale cho target: fit theo bbox trên màn hình × scale */
    fitScale(target: Node, cam: Camera | null): number {
        if (!this.fitToItem || !cam) return this.scale;
        const { w, h } = ItemGraphic.screenPlaneSize(target, cam);
        if (w <= 0 || h <= 0) return this.scale;
        let size: number;
        switch (this.fitMode) {
            case FxFitMode.Width: size = w; break;
            case FxFitMode.Height: size = h; break;
            case FxFitMode.Max: size = Math.max(w, h); break;
            case FxFitMode.Min: size = Math.min(w, h); break;
            default: size = Math.sqrt(w * h);
        }
        return math.clamp(size * this.fitPadding / (this.fitRefSize || 1), this.fitMin, this.fitMax) * this.scale;
    }

    /**
     * Nổ tại target (tâm bbox = đúng chỗ snap). `layer` = layer camera FX (vẽ đè lên phòng / nền).
     * Xoay theo camera → mặt phẳng bắn hạt đối diện camera, dàn hàng ngang đúng theo màn hình.
     */
    play(target: Node, cam: Camera | null, layer = 0) {
        const n = this.node;
        const s = this.fitScale(target, cam);
        n.setWorldScale(s, s, s);
        n.setWorldRotation(cam ? cam.node.worldRotation : Quat.IDENTITY);
        n.setWorldPosition(ItemGraphic.worldCenter(target).add3f(0, this.offsetY, 0));
        if (layer) ItemGraphic.setLayerRecursive(n, layer);

        let maxEnd = 0;
        for (const ps of n.getComponentsInChildren(ParticleSystem)) {
            ps.loop = false;
            ps.stop();
            ps.clear();                        // spawn lại từ pool: xoá hạt lần trước
            ps.play();
            if (!this._depthOff) {
                // Tắt depth-test: hạt bay vào sau mesh vẫn hiện. Prefab không gán material → override default material của processor
                const mat = ps.getMaterialInstance(0) ?? ps.processor?.getDefaultMaterial();
                mat?.overridePipelineStates({ depthStencilState: { depthTest: false, depthWrite: false } });
            }
            maxEnd = Math.max(maxEnd, ps.duration + ps.startLifetime.getMax() + (ps.startDelay?.getMax() ?? 0));
        }
        this._depthOff = true;
        this.deSpawnByTime(maxEnd + 0.1);      // hết hạt → về pool
    }
}
