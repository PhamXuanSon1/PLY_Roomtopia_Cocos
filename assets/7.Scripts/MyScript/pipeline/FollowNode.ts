/**
 * FollowNode — node "đi theo" một node khác dù không còn là con của nó trong cây.
 *
 * SceneBuilder gắn component này khi phải TÁCH một sprite con ra khỏi cha để xếp đúng
 * thứ tự render (Unity xếp bằng sortingOrder toàn cục, Cocos xếp theo thứ tự cây —
 * có lúc 1 sprite con phải nằm giữa các sprite của node khác, không thể ở dưới cha).
 *
 * Mỗi frame: world transform = target.worldMatrix × offset (offset chụp lúc tách),
 * và bật/tắt các renderer theo target.activeInHierarchy.
 */

import { _decorator, Component, Node, Mat4, Vec3, Quat, UIRenderer } from 'cc';

const { ccclass, property, executeInEditMode, menu } = _decorator;

@ccclass('FollowNode')
@executeInEditMode(true)
@menu('Pipeline/FollowNode')
export class FollowNode extends Component {

    @property({ type: Node, tooltip: 'Node cha "logic" cần đi theo (transform + active).' })
    target: Node | null = null;

    @property({ tooltip: 'Bật/tắt renderer của node này theo activeInHierarchy của target.' })
    followActive = true;

    @property({ tooltip: 'Cha gốc trong Unity (chỉ để tra cứu).', readonly: true })
    originalParentPath = '';

    /** Offset local so với target, chụp lúc tách. */
    @property({ visible: false }) private offset: Mat4 = new Mat4();
    @property({ visible: false }) private hasOffset = false;

    private static readonly tmpM = new Mat4();
    private static readonly tmpP = new Vec3();
    private static readonly tmpR = new Quat();
    private static readonly tmpS = new Vec3();

    /** Gọi ngay sau khi setParent để chụp offset hiện tại so với target. */
    captureOffset(): void {
        if (!this.target || !this.target.isValid) return;
        const inv = Mat4.invert(FollowNode.tmpM, this.target.worldMatrix);
        Mat4.multiply(this.offset, inv, this.node.worldMatrix);
        this.hasOffset = true;
    }

    lateUpdate(): void {
        const t = this.target;
        if (!t || !t.isValid) return;
        if (!this.hasOffset) this.captureOffset();

        const m = Mat4.multiply(FollowNode.tmpM, t.worldMatrix, this.offset);
        Mat4.toRTS(m, FollowNode.tmpR, FollowNode.tmpP, FollowNode.tmpS);
        this.node.setWorldPosition(FollowNode.tmpP);
        this.node.setWorldRotation(FollowNode.tmpR);
        this.node.setWorldScale(FollowNode.tmpS);

        if (this.followActive) {
            const on = t.activeInHierarchy;
            for (const r of this.node.getComponentsInChildren(UIRenderer)) {
                if (r.enabled !== on) r.enabled = on;
            }
        }
    }
}
