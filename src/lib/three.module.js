import * as SUPER_THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader';
import { OBB } from 'three/addons/math/OBB.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils';
import { LightProbeGenerator } from 'three/examples/jsm/lights/LightProbeGenerator';
import  'three/addons/nodes/Nodes.js';
//import WebGPU from 'three/addons/capabilities/WebGPU.js';
//import WebGL from 'three/addons/capabilities/WebGL.js';

//import WebGPURenderer from 'three/addons/renderers/webgpu/WebGPURenderer';


var THREE = window.THREE = SUPER_THREE;

// TODO: Eventually include these only if they are needed by a component.
//require('../../vendor/DeviceOrientationControls'); // THREE.DeviceOrientationControls

THREE.DRACOLoader = DRACOLoader;
THREE.GLTFLoader = GLTFLoader;
THREE.KTX2Loader = KTX2Loader;
THREE.OBJLoader = OBJLoader;
THREE.MTLLoader = MTLLoader;
THREE.OBB = OBB;
THREE.BufferGeometryUtils = BufferGeometryUtils;
THREE.LightProbeGenerator = LightProbeGenerator;



//const {WebGPURenderer} =  await import ('three/examples/jsm/renderers/webgpu/WebGPURenderer.js')
//console.error(WebGPURenderer)
export default {THREE}

