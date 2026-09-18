import { ExecuteSceneScriptMethodOptions } from "@cocos/creator-types/editor/packages/scene/@types/public";
import { Node } from "cc";

/**
 * @en Registration method for the main process of Extension
 * @zh 为扩展的主进程的注册方法
 */
export const methods: { [key: string]: (...any: any) => any } = {
    /**
     * @en A method that can be triggered by message
     * @zh 通过 message 触发的方法
     */
    // async MoveUpComponentByName() {
    //     const selection = Editor.Selection.getSelected('node');
    //     if (!selection || selection.length === 0) {
    //         console.warn('No nodes selected.');
    //         return;
    //     }
    //     for (const uuid of selection) {
    //         const node = await Editor.Message.request('scene', 'query-node', uuid);
    //         if (!node) continue;
            

    //         const componentName = "Block";
    //         const components = node.__comps__;
    //         const index = components.findIndex(comp => comp.type === componentName);
            
    //         if (index > 0) {
    //             // Move to front by removing and unshifting
    //             const comp = components.splice(index, 1)[0];
    //             components.unshift(comp);

    //             // Gửi lại node đã chỉnh sửa về scene
    //             // await Editor.Message.request('scene', 'set-node', node.uuid, {
    //             //     components: components,
    //             // });
    //             await Editor.Message.send('scene', 'execute-scene-script', {
    //                 name: 'move-up-component',
    //                 method: 'moveUpComponentByName',
    //                 args: [selection, componentName],
    //             });

    //             console.log(`Moved component "${componentName}" to top in node ${node.name}`);
    //         } else if (index === 0) {
    //             console.log(`Component "${componentName}" is already at the top in node ${node.name}`);
    //         } else {
    //             console.warn(`Component "${componentName}" not found in node ${node.name}`);
    //         }
    //     }
    // },
    async MoveUpComponentByName() {
        const componentName = "Block";
        const options: ExecuteSceneScriptMethodOptions = {
            name: 'tools',
            method: 'moveUpComponentByName',
            args: [componentName],
        };
        
        const result = await Editor.Message.request('scene', 'execute-scene-script', options);
    },
};

/**
 * @en Method Triggered on Extension Startup
 * @zh 扩展启动时触发的方法
 */
export function load() { }

/**
 * @en Method triggered when uninstalling the extension
 * @zh 卸载扩展时触发的方法
 */
export function unload() { }
