import { _decorator, Component, Material, Node } from 'cc';
import { TargetItem } from './TargetItem';
const { ccclass, property } = _decorator;

/**
 * Giữ danh sách target của level (1 level duy nhất — playable).
 * Thứ tự `targets` = thứ tự ô trên thanh.
 */
@ccclass('GameManager')
export class GameManager extends Component {
    static inst: GameManager | null = null;

    @property({ type: Node, tooltip: 'Root của map 3D; tự gom mọi TargetItem con' })
    model: Node | null = null;

    @property({ type: Material, tooltip: 'Material xám cho target chưa hoàn thành' })
    grayMat: Material | null = null;

    @property({ type: [TargetItem], tooltip: 'Để trống → tự gom từ model theo thứ tự hierarchy' })
    targets: TargetItem[] = [];

    @property({ tooltip: 'Xáo thứ tự thanh mỗi lần chạy' })
    shuffle = false;

    collected = 0;
    get total() { return this.targets.length; }
    get remain() { return this.targets.length - this.collected; }

    onLoad() {
        GameManager.inst = this;
        if (this.targets.length === 0 && this.model) {
            this.targets = this.model.getComponentsInChildren(TargetItem);
        }
        if (this.shuffle) {
            for (let i = this.targets.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [this.targets[i], this.targets[j]] = [this.targets[j], this.targets[i]];
            }
        }
    }

    start() {
        // TargetItem.onLoad đã cache defaultMats ở frame trước → giờ mới được đổi xám
        if (this.grayMat) this.targets.forEach(t => t.setGray(this.grayMat!));
        console.log(`[GameManager] ${this.total} targets`);
    }

    onDestroy() {
        if (GameManager.inst === this) GameManager.inst = null;
    }
}
