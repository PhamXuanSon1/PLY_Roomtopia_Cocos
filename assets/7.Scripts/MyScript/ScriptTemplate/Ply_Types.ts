import { Enum } from 'cc';

/**
 * Các loại prefab do Ply_Pool quản lý. Mọi prefab trong game CHỈ được tạo qua Ply_Pool (spawn / create),
 * khai báo prefab + số lượng tạo sẵn ở component Ply_Pool (node Manager/Ply_Pool).
 * Thêm prefab mới: thêm 1 giá trị ở đây (số mới, không đổi số cũ) rồi khai báo trong Ply_Pool.
 */
export enum PoolType {
    /** Effect nổ khi thả đúng (5.Prefabs/BlinkEffect3D, script BlinkFx) */
    BlinkFx = 0,
    /** 1 ô item trong thanh (5.Prefabs/Gameplay/Item) */
    Item = 1,
    /** Hạt sao (5.Prefabs/Star) */
    Star = 2,
    /** Chữ phản hồi "Great!" (5.Prefabs/WinReact) */
    WinReact = 3,
    /** Nền thanh dự phòng khi BottomBar chưa có node Bg (5.Prefabs/Gameplay/Bg) */
    TrayBg = 4,
    /** Tab thanh dự phòng khi BottomBar chưa có node Tab (5.Prefabs/Gameplay/Tab) */
    TrayTab = 5,
}
Enum(PoolType);
