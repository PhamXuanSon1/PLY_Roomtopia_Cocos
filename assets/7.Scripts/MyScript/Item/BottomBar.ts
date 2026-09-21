import { _decorator, Component, Label, Node } from 'cc';
const { ccclass, property } = _decorator;

/**
 * Điều khiển giao diện thanh bar phía dưới (BottomBar)
 */
@ccclass('BottomBar')
export class BottomBar extends Component {
    @property(Label)
    countLabel: Label | null = null;

    @property(Node)
    tabNode: Node | null = null;

    @property(Node)
    bgNode: Node | null = null;

    /**
     * Cập nhật số đếm tiến trình (ví dụ: 0/63)
     */
    setCount(current: number, total: number) {
        if (this.countLabel) {
            this.countLabel.string = `${current}/${total}`;
        }
    }

    /**
     * Thiết lập chuỗi text tùy ý
     */
    setText(text: string) {
        if (this.countLabel) {
            this.countLabel.string = text;
        }
    }
}
