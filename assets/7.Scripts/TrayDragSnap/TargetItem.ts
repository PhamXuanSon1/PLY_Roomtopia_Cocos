import { _decorator, Component, Material, MeshRenderer, Node, tween, Vec3 } from 'cc';
const { ccclass, property } = _decorator;

/**
 * Gắn lên từng mesh trong map. Giữ material gốc, đổi sang xám khi chưa hoàn thành,
 * trả lại màu + punch scale khi snap đúng.
 */
@ccclass('TargetItem')
export class TargetItem extends Component {
    @property({ type: MeshRenderer, tooltip: 'Để trống sẽ tự lấy MeshRenderer trên node' })
    renderer: MeshRenderer | null = null;

    isCompleted = false;
    defaultMats: Material[] = [];

    private _baseScale = new Vec3();

    onLoad() {
        if (!this.renderer) this.renderer = this.getComponent(MeshRenderer);
        // PHẢI cache trước khi bất kỳ ai đổi sang gray
        this.defaultMats = this.renderer!.sharedMaterials.slice() as Material[];
        this._baseScale.set(this.node.scale);
    }

    setGray(gray: Material) {
        if (this.isCompleted) return;
        this.renderer!.sharedMaterials = this.defaultMats.map(() => gray);
    }

    restoreMaterials() {
        this.renderer!.sharedMaterials = this.defaultMats;
    }

    complete() {
        if (this.isCompleted) return;
        this.isCompleted = true;
        this.restoreMaterials();
        this.punchScale();
    }

    reset() {
        this.isCompleted = false;
        this.node.setScale(this._baseScale);
    }

    private punchScale() {
        const n = this.node;
        const big = this._baseScale.clone().multiplyScalar(1.3);
        tween(n)
            .to(0.12, { scale: big }, { easing: 'quadOut' })
            .to(0.18, { scale: this._baseScale.clone() }, { easing: 'backOut' })
            .start();
    }
}
