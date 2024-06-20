import * as SUPER_THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader';
import { OBB } from 'three/addons/math/OBB';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils';
import { LightProbeGenerator } from 'three/examples/jsm/lights/LightProbeGenerator';

var objectAssign = require('object-assign');
var THREE = window.THREE = objectAssign({}, SUPER_THREE);

// TODO: Eventually include these only if they are needed by a component.
require('../../vendor/DeviceOrientationControls'); // THREE.DeviceOrientationControls
THREE.DRACOLoader = DRACOLoader;
THREE.GLTFLoader = GLTFLoader;
THREE.KTX2Loader = KTX2Loader;
THREE.OBJLoader = OBJLoader;
THREE.MTLLoader = MTLLoader;
THREE.BufferGeometryUtils = BufferGeometryUtils;
THREE.LightProbeGenerator = LightProbeGenerator;

export default THREE;
