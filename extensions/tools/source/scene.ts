import { director, Node } from 'cc';
import { join } from 'path';
module.paths.push(join(Editor.App.path, 'node_modules'));

export function load() {};

export function unload() {};

export const methods = {
    moveUpComponentByName(componentName: string) {      
        
        
                  
        const scene = director.getScene();
        if (!scene) return;      
        const selection = Editor.Selection.getSelected('node');
        for (const uuid of selection) {
            var node: Node;
            scene.walk((n) => {
                if (n.uuid === uuid) {
                    node = n;
                    return false; // Stop walking once we find the node
                }
            }); 
        }  
        const nodes = scene.getComponentsInChildren(componentName).map(c => c.node);;
        if (nodes.length === 0) {
            console.warn(`No components of type "${componentName}" found in the scene.`);
            return;
        }
        for (const node of nodes) {
            const components = [...node.components];
            const comp = node.getComponent(componentName);
            if (comp) {
                const index = components.indexOf(comp);
                if (index > 0) {
                    // Move to front by removing and unshifting
                    components.splice(index, 1);
                    components.unshift(comp);
                    var anyNode = node as any;
                    anyNode._components = components; // Update the node's components
                    console.log(`Moved component "${comp.name}" to top in node ${node.name}`);
                } else if (index === 0) {
                    console.log(`Component "${comp.name}" is already at the top in node ${node.name}`);
                } else {
                    console.warn(`Component "${comp.name}" not found in node ${node.name}`);
                }
            }
        }
    }
};