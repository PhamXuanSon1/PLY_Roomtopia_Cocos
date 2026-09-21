import { screen } from 'cc';

/** Đơn vị world — giữ nguyên từ Unity vì camera ortho cùng size 5 */
export const SPACING = 1.15;        // khoảng cách giữa các ô trong thanh
export const EDGE_PAD = 0.8;       // ô đầu cách mép trái
export const ICON_FILL = 0.85;     // icon chiếm 85% ô
export const CELL_PX = 200;        // 1 ô trong thanh (đơn vị local của BottomBar, 1080 = full width)
export const SPACING_PX = 250;     // khoảng cách tâm 2 ô
export const EDGE_PAD_PX = 150;    // ô đầu cách mép trái thanh
export const CULL_PAD_PX = 150;    // ô còn hiện khi tâm cách mép thanh ≤ giá trị này
export const TRAY_Y_OFFSET = 2.75; // thanh cách đáy màn hình
export const CULL_PAD = 0.8;       // ô còn hiển thị khi x ∈ [left-pad, right+pad]

export const HEIGHT_OFFSET = 1.3;  // ghost nhấc cao hơn ngón tay
export const FOLLOW_LERP = 15;
export const SCROLL_GAIN = 1;      // 1 = thanh đi đúng bằng ngón tay
export const SCROLL_LERP = 8;

export const DECISION_PX = 10;
export const SELECT_ANGLE = 70;    // độ so với hướng lên; nhỏ hơn = nhấc item

/** Constant pixel quy về màn 1080 wide để đồng nhất giữa thiết bị */
export const px = (v: number) => v * screen.windowSize.width / 393;   // quy theo iPhone 14 Pro (393 pt)
export const SNAP_PX = () => px(100);   // thả cách target dưới ngưỡng này = đúng
