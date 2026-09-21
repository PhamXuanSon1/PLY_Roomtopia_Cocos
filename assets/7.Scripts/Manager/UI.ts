import { _decorator, Animation, Camera, Color, Component, Enum, Label, MeshRenderer, misc, Node, Sprite, Tween, tween, UITransform, v3, Vec3, view} from 'cc';
import { EDITOR } from 'cc/env';
import { pc, PointerController } from './PointerController';
import { sm, SoundType } from './SoundManager';
import { gc } from '../Tool/GameController';
const { ccclass, property, executeInEditMode } = _decorator;

export enum BindUIType {
    Left,
    Right,
    Top,
    Bottom
}

export var ui: UI;

@ccclass("BindingUI")
export class BindingUI {
    @property([Node])
    binds: Node[] = [];
    @property({type: Enum(BindUIType)})
    type: BindUIType = BindUIType.Left;
    @property({ tooltip: 'Offset cách mép (world unit đối với 3D, pixel đối với 2D)' })
    offset: number = 0;
}

@ccclass('UI')
@executeInEditMode(true)
export class UI extends Component {

    @property({
        displayName: '⚡ Align In Editor',
        tooltip: 'Click vào đây để căn lề trực tiếp các node ngay trong Scene Editor (không cần Play)'
    })
    get alignInEditor(): boolean {
        return false;
    }
    set alignInEditor(val: boolean) {
        if (EDITOR) {
            if (this.height === 0 && this.uiCamera) {
                this.height = this.uiCamera.orthoHeight;
                this.width = 1080 / 2350 * this.height;
            }
            this.bind();
        }
    }

    @property(Camera)
    uiCamera: Camera = null!;
    @property(Camera)
    wCamera: Camera = null!;

    @property(Node)
    fail: Node = null!;
    @property(Node)
    win: Node = null!;
    @property(Node)
    hand: Node = null!;

    // @property(Node)
    startHand: Node = null!;
    // @property(Node)
    endHand: Node = null!;
    current: Node = null!;
    cTween: Tween<any> = null!;
    hTween: Tween<any> = null!;

    @property([Node])
    offButtons: Node[] = [];
    @property([Node])
    endOffs: Node[] = [];  
    @property([Node])
    fisrtOn: Node[] = [];
    @property([Node])
    firstOff: Node[] = [];
    @property([Node])
    adaptUIs: Node[] = [];
    @property([Node])
    portraitNodes: Node[] = [];
    @property([Node])
    landscapeNodes: Node[] = [];
    @property([Node])
    gameplays: Node[] = []
    @property([Node])
    widthNodes: Node[] = []
      
    @property([BindingUI])
    bindings: BindingUI[] = [];

    moveDir: number = 0;
    scale: number = 0
    width: number = 0;
    height: number = 0;

    onLoad() {
        if (EDITOR) return;
        
        try {
            //@ts-ignore
            if(window.redirectStore.toString() == "function redirectStore(){window.open(clickTag)}") {
                this.offButtons.forEach(node => node.active = false);
            }
            
            
        } catch (error) {
            
        }

        ui = this;
    }

    bindingToStore() {
        pc.unBindingEvent();
        pc.onStore();
    }

    openStore(...args: any) {
        sm.stopAll();
        console.log('openStore');        
        gc.redirectToStore();
    }

    
    first: boolean = true;
    firstMove() {
        if(this.first) {
            this.first = false;
            this.fisrtOn.forEach(node => { if (node) node.active = true; });
            this.firstOff.forEach(node => { if (node) node.active = false; });
        }
    }

    onLose() {
        // if(this.win.active || this.fail.active) return;
        this.fail.active = true;
        this.bindingToStore();     
        sm.playSound(SoundType.Lose);   
        this.endOffs.forEach(button => {
            button.active = false;
        });
    }

    onWin() {
        if(this.win.active || this.fail.active) return;
        this.win.active = true;
        this.bindingToStore();     
        sm.playSound(SoundType.Win);
        this.endOffs.forEach(button => {
            button.active = false;
        });
    }

    handTap(node: Node) {
        this.current = node;
        if(!node) return;
        this.hand.active = true;
        let pos = this.hand.worldPosition.clone();
        this.hand.worldPosition = node.worldPosition.clone();
        this.hand.worldPositionZ = pos.z;
    }

    offHand() {
        this.hand.active = false;
        this.hTween?.stop();
        this.cTween?.stop();
        this.current = null;
    }

    moveHand() {
        if(!this.startHand || !this.endHand) 
            return;
        this.handTap(this.startHand);
        // return;
        let child = this.hand.children[0].getComponent(Sprite)!;
        // child.node.scale = v3(1, 1, 1).multiplyScalar(this.defaultWOrtho / 14 * 0.007);
        const hand = this.hand;
        child.color = new Color(255, 255, 255, 255);
        let pos = this.endHand.getWorldPosition();
        let delta = this.hand.worldPosition.clone().subtract(pos);
        if(this.moveDir == 0) {

            let p = v3(this.hand.worldPosition.x,  this.hand.worldPosition.y, pos.z);
            let dd = this.hand.worldPosition.clone().subtract(p);
            let tt = dd.length() * 0.15;
            // console.log(tt);


            // Board.ins.tutCat.setMove();
            this.hTween = tween(this.hand)
            .delay(0.2)
            .to(tt, {worldPosition: p}, {easing: 'smooth', 
            onUpdate(target, ratio) {
            },})
            .call(() => {          
                p = v3(pos.x, this.hand.worldPosition.y,  this.hand.worldPosition.z);
                let dd = this.hand.worldPosition.clone().subtract(p);
                let tt = dd.length() * 0.15;
                // console.log(tt);
                
                this.hTween = tween(this.hand)
                .to(tt, {worldPosition: p}, {easing: 'smooth', 
                    onUpdate(target, ratio) {
                    },
                })
                .call(() => {
                    this.cTween = tween(child).delay(0.2).to(0.2, {color: new Color(255, 255, 255, 0)}, {easing: 'smooth'})
                    .call(() => {
                        this.moveHand();
                    })
                    .start();   
                })
                .start();
            })
            .start();

        } else if (this.moveDir == 1) {

            let p = v3(pos.x, pos.y, pos.z);
            let time = delta.length() * 0.2;


            this.hTween = tween(this.hand)
            .delay(0.2)
            .to(time, {worldPosition: p}, {easing: 'smooth'})
            .call(() => {          
                this.cTween = tween(child).delay(0.2).to(0.2, {color: new Color(255, 255, 255, 0)}, {easing: 'smooth'})
                .call(() => {
                    this.moveHand();
                })
                .start();   
            })
            .start();

        }
    }

    @property(BindingUI)
    topNode: BindingUI = null!;
    @property(BindingUI)
    bottomNode: BindingUI = null!;
    @property(BindingUI)
    leftNode: BindingUI = null!;
    @property(BindingUI)
    rightNode: BindingUI = null!;

    getEdge(type: BindUIType) {
        switch(type) {
            case BindUIType.Top:
                return this.topNode.binds[0].getWorldPosition().y;
            case BindUIType.Bottom:
                return this.bottomNode.binds[0].getWorldPosition().y;
            case BindUIType.Left:
                return this.leftNode.binds[0].getWorldPosition().x;
            case BindUIType.Right:
                return this.rightNode.binds[0].getWorldPosition().x;
        }
    }

    bind() {
        let pos = this.uiCamera.node.position.clone();
        {
            this.topNode.binds[0].position = this.topNode.binds[0].position.clone();
            this.topNode.binds[0].position = v3(this.topNode.binds[0].position.x + pos.x, 
            this.height + pos.y, 
            this.topNode.binds[0].position.z);

            this.bottomNode.binds[0].position = this.bottomNode.binds[0].position.clone();
            this.bottomNode.binds[0].position = v3(this.bottomNode.binds[0].position.x + pos.x, 
            -this.height + pos.y, 
            this.bottomNode.binds[0].position.z);

            this.leftNode.binds[0].position = this.leftNode.binds[0].position.clone();
            this.leftNode.binds[0].position = v3(-this.width + pos.x, 
            this.leftNode.binds[0].position.y + pos.y, 
            this.leftNode.binds[0].position.z);

            this.rightNode.binds[0].position = this.rightNode.binds[0].position.clone();
            this.rightNode.binds[0].position = v3(this.width + pos.x, 
            this.rightNode.binds[0].position.y + pos.y, 
            this.rightNode.binds[0].position.z);
        }


        this.bindings.forEach(bind => {
            bind.binds.forEach(item => {
                if (!item || !item.isValid) return;

                // Kiểm tra nếu item là node 3D (không có UITransform hoặc thuộc layer 3D)
                const is3D = !item.getComponent(UITransform) || item.layer !== 33554432;

                if (is3D && this.wCamera) {
                    this.bind3D(item, bind.type, bind.offset || 0);
                } else {
                    item.position = item.position.clone();
                    let pos = item.getWorldPosition();
                    switch(bind.type) {
                        case BindUIType.Top:
                            pos.y = this.getEdge(bind.type) - (bind.offset || 0);
                            break;
                        case BindUIType.Bottom:
                            pos.y = this.getEdge(bind.type) + (bind.offset || 0);
                            break;
                        case BindUIType.Left:
                            pos.x = this.getEdge(bind.type) + (bind.offset || 0);
                            break;
                        case BindUIType.Right:
                            pos.x = this.getEdge(bind.type) - (bind.offset || 0);
                            break;
                    }
                    let lpos = item.parent ? item.parent.inverseTransformPoint(v3(), pos) : pos;
                    item.position = lpos;
                }
            })            
        })   
    }

    /**
     * Căn chỉnh node 3D theo mép nhìn của Camera 3D (wCamera)
     * Chỉ căn chỉnh trực tiếp vị trí của node cha (item), không bắt buộc các node con phải nằm ở mép camera.
     * @param item Node 3D cần căn (ví dụ Lv50_Bathroom_Root)
     * @param type Hướng căn (Top, Bottom, Left, Right)
     * @param offset Khoảng cách từ vị trí node đến mép camera (đơn vị world)
     */
    bind3D(item: Node, type: BindUIType, offset: number = 0) {
        if (!this.wCamera || !item) return;

        const wCam = this.wCamera;
        const camNode = wCam.node;
        const invCamMat = camNode.worldMatrix.clone().invert();

        // Tọa độ gốc của item (Node cha) trong không gian camera (view space)
        const originInCam = item.worldPosition.clone().transformMat4(invCamMat);

        // Vector hướng UP của camera trong world space (theo góc nghiêng camera)
        const camUp = v3();
        Vec3.transformQuat(camUp, Vec3.UP, camNode.worldRotation);

        // Vector hướng RIGHT của camera trong world space
        const camRight = v3();
        Vec3.transformQuat(camRight, Vec3.RIGHT, camNode.worldRotation);

        let deltaWorld = v3();

        switch (type) {
            case BindUIType.Top: {
                const targetTopInCam = wCam.orthoHeight - offset;
                const deltaYInCam = targetTopInCam - originInCam.y;
                deltaWorld = camUp.multiplyScalar(deltaYInCam);
                break;
            }
            case BindUIType.Bottom: {
                const targetBottomInCam = -wCam.orthoHeight + offset;
                const deltaYInCam = targetBottomInCam - originInCam.y;
                deltaWorld = camUp.multiplyScalar(deltaYInCam);
                break;
            }
            case BindUIType.Left: {
                let size = view.getVisibleSize();
                let aspect = size.width / size.height;
                const halfW = wCam.orthoHeight * aspect;
                const targetLeftInCam = -halfW + offset;
                const deltaXInCam = targetLeftInCam - originInCam.x;
                deltaWorld = camRight.multiplyScalar(deltaXInCam);
                break;
            }
            case BindUIType.Right: {
                let size = view.getVisibleSize();
                let aspect = size.width / size.height;
                const halfW = wCam.orthoHeight * aspect;
                const targetRightInCam = halfW - offset;
                const deltaXInCam = targetRightInCam - originInCam.x;
                deltaWorld = camRight.multiplyScalar(deltaXInCam);
                break;
            }
        }

        const newWorldPos = item.worldPosition.clone().add(deltaWorld);
        const newLocalPos = item.parent ? item.parent.inverseTransformPoint(v3(), newWorldPos) : newWorldPos;
        item.position = newLocalPos;
    }

    
    keepTap() {    
        if(this.current && this.hand.active) {
            this.handTap(this.current);
        }   
    }

    resize(scale: number = this.scale) {
        this.scale = scale;
        let time = 0;
        this.height = this.uiCamera.orthoHeight;
        this.width = 1080/2350 * this.height * scale;  
        console.log(this.width / this.height, this.width, this.height);
        setTimeout(() => {            
            this.keepTap();          
        }, time);
        let max = 2;
        if (this.wCamera) {
            let size = view.getVisibleSize();
            let aspect = size.width / size.height;
            const targetWidth = 6.6;
            if (aspect < 1.2) {
                this.wCamera.orthoHeight = Math.max(6.8, targetWidth / (2 * aspect));
            } else {
                this.wCamera.orthoHeight = 6.0;
            }
        }
        if(this.width / this.height < 1.5) {
            scale = misc.clampf(scale, 1, max);
            this.gameplays.forEach((item) => {
                const is3D = !item.getComponent(UITransform) || item.layer !== 33554432;
                if (!is3D) {
                    item.scale = v3(1, 1, 1).multiplyScalar(1*scale);          
                } else {
                    item.scale = v3(1, 1, 1);
                }
            })  
            this.portraitNodes.forEach((item) => {
                item.active = true;
            });
            this.landscapeNodes.forEach((item) => {
                item.active = false;
            });
            this.adaptUIs.forEach((item) => {
                item.scale = v3(1, 1, 1);
            });
        } else {
            this.gameplays.forEach((item) => {
                const is3D = !item.getComponent(UITransform) || item.layer !== 33554432;
                if (!is3D) {
                    item.scale = v3(1, 1, 1).multiplyScalar(max);          
                } else {
                    item.scale = v3(1, 1, 1);
                }
            })  
            this.portraitNodes.forEach((item) => {
                item.active = false;
            });
            this.landscapeNodes.forEach((item) => {
                item.active = true;
            });
            this.adaptUIs.forEach((item) => {
                item.scale = v3(1, 1, 1).multiplyScalar(2);
            });

        }
        this.widthNodes.forEach((item) => {
            let x = item.getWorldScale().x;
            let uit = item.getComponent(UITransform)!;
            uit.width = this.width / x * 2;
        })
        this.bind();  
        
    }

    update(dt: number) {  
        if (EDITOR) return;

        let size = view.getVisibleSize();
        let scale = size.width/1080;
        if(scale != this.scale) {
            this.resize(scale);
        }

        if(this.current) {
            this.handTap(this.current);
        }
    }
}