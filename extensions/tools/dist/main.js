"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.methods = void 0;
exports.load = load;
exports.unload = unload;
/**
 * @en Registration method for the main process of Extension
 * @zh 为扩展的主进程的注册方法
 */
exports.methods = {
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
        const options = {
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
function load() { }
/**
 * @en Method triggered when uninstalling the extension
 * @zh 卸载扩展时触发的方法
 */
function unload() { }
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NvdXJjZS9tYWluLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQWtFQSxvQkFBMEI7QUFNMUIsd0JBQTRCO0FBckU1Qjs7O0dBR0c7QUFDVSxRQUFBLE9BQU8sR0FBNEM7SUFDNUQ7OztPQUdHO0lBQ0gsa0NBQWtDO0lBQ2xDLDhEQUE4RDtJQUM5RCxrREFBa0Q7SUFDbEQsOENBQThDO0lBQzlDLGtCQUFrQjtJQUNsQixRQUFRO0lBQ1Isc0NBQXNDO0lBQ3RDLGtGQUFrRjtJQUNsRiwrQkFBK0I7SUFHL0IseUNBQXlDO0lBQ3pDLDZDQUE2QztJQUM3QyxtRkFBbUY7SUFFbkYsMkJBQTJCO0lBQzNCLDBEQUEwRDtJQUMxRCwyREFBMkQ7SUFDM0Qsd0NBQXdDO0lBRXhDLG9EQUFvRDtJQUNwRCxnRkFBZ0Y7SUFDaEYsNkNBQTZDO0lBQzdDLHFCQUFxQjtJQUNyQiwyRUFBMkU7SUFDM0UsNkNBQTZDO0lBQzdDLG1EQUFtRDtJQUNuRCxvREFBb0Q7SUFDcEQsa0JBQWtCO0lBRWxCLDZGQUE2RjtJQUM3RixvQ0FBb0M7SUFDcEMsc0dBQXNHO0lBQ3RHLG1CQUFtQjtJQUNuQiwyRkFBMkY7SUFDM0YsWUFBWTtJQUNaLFFBQVE7SUFDUixLQUFLO0lBQ0wsS0FBSyxDQUFDLHFCQUFxQjtRQUN2QixNQUFNLGFBQWEsR0FBRyxPQUFPLENBQUM7UUFDOUIsTUFBTSxPQUFPLEdBQW9DO1lBQzdDLElBQUksRUFBRSxPQUFPO1lBQ2IsTUFBTSxFQUFFLHVCQUF1QjtZQUMvQixJQUFJLEVBQUUsQ0FBQyxhQUFhLENBQUM7U0FDeEIsQ0FBQztRQUVGLE1BQU0sTUFBTSxHQUFHLE1BQU0sTUFBTSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsT0FBTyxFQUFFLHNCQUFzQixFQUFFLE9BQU8sQ0FBQyxDQUFDO0lBQzFGLENBQUM7Q0FDSixDQUFDO0FBRUY7OztHQUdHO0FBQ0gsU0FBZ0IsSUFBSSxLQUFLLENBQUM7QUFFMUI7OztHQUdHO0FBQ0gsU0FBZ0IsTUFBTSxLQUFLLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBFeGVjdXRlU2NlbmVTY3JpcHRNZXRob2RPcHRpb25zIH0gZnJvbSBcIkBjb2Nvcy9jcmVhdG9yLXR5cGVzL2VkaXRvci9wYWNrYWdlcy9zY2VuZS9AdHlwZXMvcHVibGljXCI7XHJcbmltcG9ydCB7IE5vZGUgfSBmcm9tIFwiY2NcIjtcclxuXHJcbi8qKlxyXG4gKiBAZW4gUmVnaXN0cmF0aW9uIG1ldGhvZCBmb3IgdGhlIG1haW4gcHJvY2VzcyBvZiBFeHRlbnNpb25cclxuICogQHpoIOS4uuaJqeWxleeahOS4u+i/m+eoi+eahOazqOWGjOaWueazlVxyXG4gKi9cclxuZXhwb3J0IGNvbnN0IG1ldGhvZHM6IHsgW2tleTogc3RyaW5nXTogKC4uLmFueTogYW55KSA9PiBhbnkgfSA9IHtcclxuICAgIC8qKlxyXG4gICAgICogQGVuIEEgbWV0aG9kIHRoYXQgY2FuIGJlIHRyaWdnZXJlZCBieSBtZXNzYWdlXHJcbiAgICAgKiBAemgg6YCa6L+HIG1lc3NhZ2Ug6Kem5Y+R55qE5pa55rOVXHJcbiAgICAgKi9cclxuICAgIC8vIGFzeW5jIE1vdmVVcENvbXBvbmVudEJ5TmFtZSgpIHtcclxuICAgIC8vICAgICBjb25zdCBzZWxlY3Rpb24gPSBFZGl0b3IuU2VsZWN0aW9uLmdldFNlbGVjdGVkKCdub2RlJyk7XHJcbiAgICAvLyAgICAgaWYgKCFzZWxlY3Rpb24gfHwgc2VsZWN0aW9uLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgLy8gICAgICAgICBjb25zb2xlLndhcm4oJ05vIG5vZGVzIHNlbGVjdGVkLicpO1xyXG4gICAgLy8gICAgICAgICByZXR1cm47XHJcbiAgICAvLyAgICAgfVxyXG4gICAgLy8gICAgIGZvciAoY29uc3QgdXVpZCBvZiBzZWxlY3Rpb24pIHtcclxuICAgIC8vICAgICAgICAgY29uc3Qgbm9kZSA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ3F1ZXJ5LW5vZGUnLCB1dWlkKTtcclxuICAgIC8vICAgICAgICAgaWYgKCFub2RlKSBjb250aW51ZTtcclxuICAgICAgICAgICAgXHJcblxyXG4gICAgLy8gICAgICAgICBjb25zdCBjb21wb25lbnROYW1lID0gXCJCbG9ja1wiO1xyXG4gICAgLy8gICAgICAgICBjb25zdCBjb21wb25lbnRzID0gbm9kZS5fX2NvbXBzX187XHJcbiAgICAvLyAgICAgICAgIGNvbnN0IGluZGV4ID0gY29tcG9uZW50cy5maW5kSW5kZXgoY29tcCA9PiBjb21wLnR5cGUgPT09IGNvbXBvbmVudE5hbWUpO1xyXG4gICAgICAgICAgICBcclxuICAgIC8vICAgICAgICAgaWYgKGluZGV4ID4gMCkge1xyXG4gICAgLy8gICAgICAgICAgICAgLy8gTW92ZSB0byBmcm9udCBieSByZW1vdmluZyBhbmQgdW5zaGlmdGluZ1xyXG4gICAgLy8gICAgICAgICAgICAgY29uc3QgY29tcCA9IGNvbXBvbmVudHMuc3BsaWNlKGluZGV4LCAxKVswXTtcclxuICAgIC8vICAgICAgICAgICAgIGNvbXBvbmVudHMudW5zaGlmdChjb21wKTtcclxuXHJcbiAgICAvLyAgICAgICAgICAgICAvLyBH4butaSBs4bqhaSBub2RlIMSRw6MgY2jhu4luaCBz4butYSB24buBIHNjZW5lXHJcbiAgICAvLyAgICAgICAgICAgICAvLyBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdzY2VuZScsICdzZXQtbm9kZScsIG5vZGUudXVpZCwge1xyXG4gICAgLy8gICAgICAgICAgICAgLy8gICAgIGNvbXBvbmVudHM6IGNvbXBvbmVudHMsXHJcbiAgICAvLyAgICAgICAgICAgICAvLyB9KTtcclxuICAgIC8vICAgICAgICAgICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnNlbmQoJ3NjZW5lJywgJ2V4ZWN1dGUtc2NlbmUtc2NyaXB0Jywge1xyXG4gICAgLy8gICAgICAgICAgICAgICAgIG5hbWU6ICdtb3ZlLXVwLWNvbXBvbmVudCcsXHJcbiAgICAvLyAgICAgICAgICAgICAgICAgbWV0aG9kOiAnbW92ZVVwQ29tcG9uZW50QnlOYW1lJyxcclxuICAgIC8vICAgICAgICAgICAgICAgICBhcmdzOiBbc2VsZWN0aW9uLCBjb21wb25lbnROYW1lXSxcclxuICAgIC8vICAgICAgICAgICAgIH0pO1xyXG5cclxuICAgIC8vICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBNb3ZlZCBjb21wb25lbnQgXCIke2NvbXBvbmVudE5hbWV9XCIgdG8gdG9wIGluIG5vZGUgJHtub2RlLm5hbWV9YCk7XHJcbiAgICAvLyAgICAgICAgIH0gZWxzZSBpZiAoaW5kZXggPT09IDApIHtcclxuICAgIC8vICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBDb21wb25lbnQgXCIke2NvbXBvbmVudE5hbWV9XCIgaXMgYWxyZWFkeSBhdCB0aGUgdG9wIGluIG5vZGUgJHtub2RlLm5hbWV9YCk7XHJcbiAgICAvLyAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAvLyAgICAgICAgICAgICBjb25zb2xlLndhcm4oYENvbXBvbmVudCBcIiR7Y29tcG9uZW50TmFtZX1cIiBub3QgZm91bmQgaW4gbm9kZSAke25vZGUubmFtZX1gKTtcclxuICAgIC8vICAgICAgICAgfVxyXG4gICAgLy8gICAgIH1cclxuICAgIC8vIH0sXHJcbiAgICBhc3luYyBNb3ZlVXBDb21wb25lbnRCeU5hbWUoKSB7XHJcbiAgICAgICAgY29uc3QgY29tcG9uZW50TmFtZSA9IFwiQmxvY2tcIjtcclxuICAgICAgICBjb25zdCBvcHRpb25zOiBFeGVjdXRlU2NlbmVTY3JpcHRNZXRob2RPcHRpb25zID0ge1xyXG4gICAgICAgICAgICBuYW1lOiAndG9vbHMnLFxyXG4gICAgICAgICAgICBtZXRob2Q6ICdtb3ZlVXBDb21wb25lbnRCeU5hbWUnLFxyXG4gICAgICAgICAgICBhcmdzOiBbY29tcG9uZW50TmFtZV0sXHJcbiAgICAgICAgfTtcclxuICAgICAgICBcclxuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdzY2VuZScsICdleGVjdXRlLXNjZW5lLXNjcmlwdCcsIG9wdGlvbnMpO1xyXG4gICAgfSxcclxufTtcclxuXHJcbi8qKlxyXG4gKiBAZW4gTWV0aG9kIFRyaWdnZXJlZCBvbiBFeHRlbnNpb24gU3RhcnR1cFxyXG4gKiBAemgg5omp5bGV5ZCv5Yqo5pe26Kem5Y+R55qE5pa55rOVXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gbG9hZCgpIHsgfVxyXG5cclxuLyoqXHJcbiAqIEBlbiBNZXRob2QgdHJpZ2dlcmVkIHdoZW4gdW5pbnN0YWxsaW5nIHRoZSBleHRlbnNpb25cclxuICogQHpoIOWNuOi9veaJqeWxleaXtuinpuWPkeeahOaWueazlVxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIHVubG9hZCgpIHsgfVxyXG4iXX0=