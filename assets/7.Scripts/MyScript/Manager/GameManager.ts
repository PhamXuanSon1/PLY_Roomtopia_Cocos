import { _decorator, Component, Material, Node } from 'cc';
const { ccclass, property } = _decorator;

/**
 * Giữ cấu hình level (1 level duy nhất — playable).
 */
@ccclass('GameManager')
export class GameManager extends Component {
    static inst: GameManager | null = null;

    @property({ type: Node, tooltip: 'Root của map 3D' })
    model: Node | null = null;

    @property({ type: Material, tooltip: 'Material xám cho target chưa hoàn thành' })
    grayMat: Material | null = null;

    onLoad() {
        GameManager.inst = this;
    }

    onDestroy() {
        if (GameManager.inst === this) GameManager.inst = null;
    }
}
