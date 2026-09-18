import { _decorator, Color, color, Component, Material, Node, v3, Vec3 } from 'cc';
import { colors } from '../Gameplay/Data';
const { ccclass, property } = _decorator;

@ccclass('Mats')
export class Mats extends Component {

    @property([Material])
    mats: Material[] = [];

    @property({slide: true, range: [-254, 254], step: 1})
    dark: number = 0;
    @property({slide: true, range: [-10, 10], step: 1})
    sat: number = 1.5;
    _on: boolean = false;

    get on() { return this._on; }

    @property 
    set on(v: boolean) {
        // this._on = v;
        this.changeColor();
    }

    changeColor() {
        console.log("set color to mats");
        
        this.mats.forEach((m, i) => {
            let c = colors[i].clone();
            c.r += this.dark;
            c.g += this.dark;
            c.b += this.dark;
            this.sat = 1;
            let satColor = AdjustSaturation(v3(c.r / 255, c.g / 255, c.b / 255), this.sat).multiplyScalar(255);
            c = color(satColor.x, satColor.y, satColor.z, 255);
            m.setProperty("mainColor", c)
            let a = colors[i].clone();
            let dt = 150;
            if(a.r > dt) a.r -= dt;
            else a.r = 20;
            if(a.g > dt) a.g -= dt;
            else a.g = 20;
            if(a.b > dt) a.b -= dt;
            else a.b = 20;
            m.setProperty("baseColor", a)
        });
        
    }


    start() {

    }

    update(deltaTime: number) {
        
    }
}

function AdjustSaturation(color: Vec3, sat: number) {
    let gray = Vec3.dot(color, v3(0.299, 0.587, 0.114));
    // return mix(vec3(gray), color, sat);
    return Vec3.lerp(v3(), v3(gray, gray, gray), color, sat);
}


