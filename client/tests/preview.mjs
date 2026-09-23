import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Scene,Object3D} from 'three';
import {previewDecisions} from '../dist/index.js';
test('named study decisions preview and revert with arbitrary stable IDs',()=>{
 const scene=new Scene(),node=new Object3D();node.userData.gaId='node|west';node.position.x=2;scene.add(node);
 const preview=previewDecisions(scene,{x:4,shown:false},[{decision:'x',target:{type:'position',object_id:'node|west',axis:'x'}},{decision:'shown',target:{type:'visibility',object_id:'node|west'}}]);
 assert.equal(node.position.x,4);assert.equal(node.visible,false);preview.revert();assert.equal(node.position.x,2);assert.equal(node.visible,true);
});
test('a failed preview restores changes already applied',()=>{
 const scene=new Scene(),node=new Object3D();node.userData.gaId='node';node.position.x=2;scene.add(node);
 assert.throws(()=>previewDecisions(scene,{x:4},[{decision:'x',target:{type:'position',object_id:'node',axis:'x'}},{decision:'x',target:{type:'position',object_id:'missing',axis:'x'}}]),/no longer contains/);
 assert.equal(node.position.x,2);
});
