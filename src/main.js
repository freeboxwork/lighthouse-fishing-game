import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Water } from 'three/addons/objects/Water.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createProceduralRowboat } from './createProceduralBoat.js';
import { createFishingGame } from './fishingGame.js';
import './styles.css';

const WATER_LEVEL = -0.43;
const SPAWN = new THREE.Vector3(-12, 0, -9);
const ISLAND_COLLISION = { x: 8.4, z: 6.5 };
const WORLD_RADIUS = 70;
const MAX_RENDER_PIXELS = 2_200_000;
const MIN_ADAPTIVE_PIXEL_RATIO = 0.5;

function preferredPixelRatio() {
  const nativeRatio = Math.min(window.devicePixelRatio, 1.5);
  const pixelBudgetRatio = Math.sqrt(MAX_RENDER_PIXELS / Math.max(1, window.innerWidth * window.innerHeight));
  return Math.min(nativeRatio, Math.max(0.55, pixelBudgetRatio));
}

function minimumPixelRatio() {
  const preferred = preferredPixelRatio();
  return Math.min(preferred, Math.max(MIN_ADAPTIVE_PIXEL_RATIO, preferred * 0.82));
}

const WAVE_FIELD_GLSL = /* glsl */ `
  float waveSeaState(float waveTime) {
    float primary = sin(waveTime * 0.24);
    float secondary = sin(waveTime * 0.071 + 1.9);
    return clamp(0.84 + primary * 0.18 + secondary * 0.10, 0.58, 1.12);
  }

  float waveHash(vec2 point) {
    return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float waveValueNoise(vec2 point) {
    vec2 cell = floor(point);
    vec2 blend = fract(point);
    blend = blend * blend * (3.0 - 2.0 * blend);
    float a = waveHash(cell);
    float b = waveHash(cell + vec2(1.0, 0.0));
    float c = waveHash(cell + vec2(0.0, 1.0));
    float d = waveHash(cell + vec2(1.0, 1.0));
    return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
  }

  float waveFbm(vec2 point) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int octave = 0; octave < 4; octave++) {
      value += waveValueNoise(point) * amplitude;
      point = point * 2.02 + vec2(17.17, -11.53);
      amplitude *= 0.5;
    }
    return value / 0.9375;
  }

  float waveNoiseHeight(vec2 point, float waveTime, float seaState) {
    float macroNoise = waveFbm(point * 0.055 + vec2(waveTime * 0.045, -waveTime * 0.032)) - 0.5;
    float mesoNoise = waveFbm(point * 0.21 + vec2(-waveTime * 0.11, waveTime * 0.085)) - 0.5;
    return macroNoise * 0.17 * seaState + mesoNoise * 0.07 * (0.62 + seaState * 0.38);
  }

  vec3 gerstnerWave(
    vec2 point,
    vec2 direction,
    float steepness,
    float wavelength,
    float phaseOffset,
    float waveTime,
    float amplitudeScale
  ) {
    float waveNumber = 6.28318530718 / wavelength;
    float phaseSpeed = sqrt(9.8 / waveNumber);
    vec2 heading = normalize(direction);
    float phase = waveNumber * (dot(heading, point) - phaseSpeed * waveTime) + phaseOffset;
    float amplitude = (steepness / waveNumber) * amplitudeScale;
    return vec3(
      heading.x * amplitude * cos(phase),
      heading.y * amplitude * cos(phase),
      amplitude * sin(phase)
    );
  }

  vec3 getWaveDisplacement(vec2 point, float waveTime) {
    float seaState = waveSeaState(waveTime);
    vec3 displacement = vec3(0.0);
    displacement += gerstnerWave(point, vec2(1.0, 0.24), 0.16, 7.8, 0.0, waveTime, seaState);
    displacement += gerstnerWave(point, vec2(-0.36, 1.0), 0.10, 4.6, 1.7, waveTime, 0.78 + seaState * 0.24);
    displacement += gerstnerWave(point, vec2(0.72, -1.0), 0.065, 2.65, 3.2, waveTime, 0.58 + seaState * 0.38);
    displacement += gerstnerWave(point, vec2(-0.82, -0.34), 0.038, 1.45, 5.1, waveTime, 0.52 + seaState * 0.42);
    displacement.z += waveNoiseHeight(point, waveTime, seaState);
    return displacement;
  }
`;

const container = document.querySelector('#scene');
const loadingScreen = document.querySelector('#loading-screen');
const loadingLabel = document.querySelector('#loading-label');
const loadingProgress = document.querySelector('#loading-progress');
const gameStartButton = document.querySelector('#game-start-button');
const gameLayers = [...document.querySelectorAll('#app > :not(#loading-screen)')];
const speedValue = document.querySelector('#speed-value');
const waveValue = document.querySelector('#wave-value');
const cameraValue = document.querySelector('#camera-value');
const positionValue = document.querySelector('#position-value');
const navigationState = document.querySelector('#navigation-state');
const appStatus = document.querySelector('#app-status');
const cameraButton = document.querySelector('#camera-button');
const resetButton = document.querySelector('#reset-button');
let worldReady = false;
let gameStarted = false;
gameLayers.forEach((layer) => {
  layer.inert = true;
});

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(preferredPixelRatio());
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fb4c7);
scene.fog = new THREE.FogExp2(0x8fb4c7, 0.0048);

const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  260,
);
camera.position.set(-18, 12, -18);

const orbitControls = new OrbitControls(camera, renderer.domElement);
orbitControls.enableDamping = true;
orbitControls.dampingFactor = 0.075;
orbitControls.enablePan = false;
orbitControls.minDistance = 12;
orbitControls.maxDistance = 46;
orbitControls.maxPolarAngle = Math.PI * 0.46;
orbitControls.target.set(0, 1.8, 0);
orbitControls.enabled = false;

const hemisphere = new THREE.HemisphereLight(0xc6e7ea, 0x496050, 2.15);
scene.add(hemisphere);

const sun = new THREE.DirectionalLight(0xffd5ad, 3.4);
sun.position.set(-18, 24, -16);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 70;
sun.shadow.camera.left = -24;
sun.shadow.camera.right = 24;
sun.shadow.camera.top = 24;
sun.shadow.camera.bottom = -24;
sun.shadow.bias = -0.00025;
scene.add(sun);

const lighthouseGlow = new THREE.PointLight(0xffcf84, 18, 15, 1.6);
lighthouseGlow.position.set(-3.65, 8.1, -1.1);
scene.add(lighthouseGlow);

const lighthouseBeamTarget = new THREE.Object3D();
scene.add(lighthouseBeamTarget);
const lighthouseBeam = new THREE.SpotLight(0xffe4ad, 105, 34, 0.16, 0.74, 1.25);
lighthouseBeam.position.copy(lighthouseGlow.position);
lighthouseBeam.target = lighthouseBeamTarget;
scene.add(lighthouseBeam);

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(175, 48, 24),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(0x9fc1d4) },
      uHorizon: { value: new THREE.Color(0xc4d4dc) },
      uLower: { value: new THREE.Color(0x5e8798) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldDirection;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldDirection = normalize(world.xyz - cameraPosition);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uLower;
      varying vec3 vWorldDirection;
      void main() {
        float height = vWorldDirection.y;
        vec3 lowerBand = mix(uLower, uHorizon, smoothstep(-0.18, 0.03, height));
        vec3 skyColor = mix(lowerBand, uTop, smoothstep(0.02, 0.72, height));
        float haze = 1.0 - smoothstep(0.0, 0.16, abs(height));
        skyColor = mix(skyColor, uHorizon, haze * 0.52);
        gl_FragColor = vec4(skyColor, 1.0);
      }
    `,
  }),
);
scene.add(sky);

const CLOUD_CLUSTER_COUNT = 10;
const CLOUD_LOBES = [
  { x: -0.7, y: 0.02, z: 0.02, sx: 1.08, sy: 0.58, sz: 0.72 },
  { x: -0.22, y: 0.22, z: -0.04, sx: 1.22, sy: 0.78, sz: 0.82 },
  { x: 0.28, y: 0.3, z: 0, sx: 1.34, sy: 0.86, sz: 0.86 },
  { x: 0.78, y: 0.04, z: 0.04, sx: 0.98, sy: 0.56, sz: 0.68 },
  { x: 0.03, y: -0.08, z: 0.1, sx: 1.58, sy: 0.46, sz: 0.86 },
];
const cloudGeometry = new THREE.IcosahedronGeometry(1, 1);
const cloudMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 1,
  metalness: 0,
  flatShading: true,
  fog: true,
  emissive: 0x303b3f,
  emissiveIntensity: 0.24,
});
const cloudField = new THREE.InstancedMesh(
  cloudGeometry,
  cloudMaterial,
  CLOUD_CLUSTER_COUNT * CLOUD_LOBES.length,
);
cloudField.name = 'GEO-threejs-clear-clouds';
cloudField.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
cloudField.frustumCulled = false;
cloudField.castShadow = false;
cloudField.receiveShadow = false;
scene.add(cloudField);

function cloudRandom(seed) {
  return fract(Math.sin(seed * 91.731 + 13.17) * 43758.5453);
}

const cloudClusters = Array.from({ length: CLOUD_CLUSTER_COUNT }, (_, index) => {
  const angle = (index / CLOUD_CLUSTER_COUNT) * Math.PI * 2 + cloudRandom(index + 1) * 0.42;
  const radius = 44 + cloudRandom(index + 11) * 46;
  const scale = index === 0 ? 0.68 : 1.05 + cloudRandom(index + 23) * 0.95;
  const speed = 0.22 + cloudRandom(index + 37) * 0.2;
  const height = index === 0 ? 5.4 : index === 2 ? 6.1 : 5.2 + cloudRandom(index + 19) * 3.8;
  return {
    center: new THREE.Vector3(
      Math.cos(angle) * radius,
      height,
      Math.sin(angle) * radius,
    ),
    velocity: new THREE.Vector3(0.72 + cloudRandom(index + 31) * 0.28, 0, 0.16).normalize().multiplyScalar(speed),
    scale,
    yaw: cloudRandom(index + 47) * Math.PI * 2,
    phase: cloudRandom(index + 59) * Math.PI * 2,
  };
});
const cloudTransform = new THREE.Object3D();
const cloudOffset = new THREE.Vector3();
const cloudColor = new THREE.Color();

cloudClusters.forEach((_cluster, clusterIndex) => {
  CLOUD_LOBES.forEach((lobe, lobeIndex) => {
    const heightTone = THREE.MathUtils.clamp(0.9 + lobe.y * 0.16 + cloudRandom(clusterIndex * 7 + lobeIndex) * 0.06, 0.88, 1);
    cloudColor.setRGB(heightTone * 0.96, heightTone * 0.99, heightTone);
    cloudField.setColorAt(clusterIndex * CLOUD_LOBES.length + lobeIndex, cloudColor);
  });
});
cloudField.instanceColor.needsUpdate = true;

function updateClouds(delta, elapsed) {
  let instanceIndex = 0;
  cloudClusters.forEach((cluster) => {
    cluster.center.addScaledVector(cluster.velocity, delta);
    if (cluster.center.x > 98) cluster.center.x = -98;
    if (cluster.center.z > 98) cluster.center.z = -98;
    const cosine = Math.cos(cluster.yaw);
    const sine = Math.sin(cluster.yaw);
    CLOUD_LOBES.forEach((lobe, lobeIndex) => {
      cloudOffset.set(
        (lobe.x * cosine - lobe.z * sine) * cluster.scale,
        lobe.y * cluster.scale + Math.sin(elapsed * 0.16 + cluster.phase + lobeIndex) * 0.08,
        (lobe.x * sine + lobe.z * cosine) * cluster.scale,
      );
      cloudTransform.position.copy(cluster.center).add(cloudOffset);
      cloudTransform.rotation.set(0, cluster.yaw, 0);
      cloudTransform.scale.set(
        lobe.sx * cluster.scale,
        lobe.sy * cluster.scale,
        lobe.sz * cluster.scale,
      );
      cloudTransform.updateMatrix();
      cloudField.setMatrixAt(instanceIndex, cloudTransform.matrix);
      instanceIndex += 1;
    });
  });
  cloudField.instanceMatrix.needsUpdate = true;
}

const seabed = new THREE.Mesh(
  new THREE.PlaneGeometry(180, 180, 96, 96),
  new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color(0x0c4f67) },
      uMid: { value: new THREE.Color(0x1593a3) },
      uShallow: { value: new THREE.Color(0x78c9bd) },
      uSand: { value: new THREE.Color(0xd1c08d) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPosition;
      void main() {
        vec3 displacedPosition = position;
        float islandRadius = length(vec2(position.x / 9.2, position.y / 7.0));
        float depthDrop = smoothstep(1.05, 5.2, islandRadius);
        displacedPosition.z -= depthDrop * 6.4;
        vec4 world = modelMatrix * vec4(displacedPosition, 1.0);
        vWorldPosition = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uDeep;
      uniform vec3 uMid;
      uniform vec3 uShallow;
      uniform vec3 uSand;
      varying vec3 vWorldPosition;

      float causticPattern(vec2 point) {
        float a = sin(point.x * 2.56 + sin(point.y * 1.32 + uTime * 0.9) * 1.55 + uTime);
        float b = sin(point.y * 2.82 + sin(point.x * 1.18 - uTime * 0.72) * 1.42 - uTime * 0.76);
        float ribbons = 1.0 - abs(a - b);
        return pow(clamp(ribbons, 0.0, 1.0), 9.0);
      }

      void main() {
        vec2 islandSpace = vec2(vWorldPosition.x / 8.7, vWorldPosition.z / 6.7);
        float radius = length(islandSpace);
        float nearShore = 1.0 - smoothstep(1.08, 3.9, radius);
        float sandyShelf = 1.0 - smoothstep(1.04, 1.95, radius);
        float midShelf = 1.0 - smoothstep(2.4, 6.5, radius);
        vec3 base = mix(uDeep, uMid, midShelf);
        base = mix(base, uShallow, nearShore * 0.82);
        base = mix(base, uSand, sandyShelf * 0.62);
        float caustic = causticPattern(vWorldPosition.xz);
        base += vec3(0.09, 0.14, 0.12) * caustic * nearShore;
        float broadPatch = sin(vWorldPosition.x * 0.16 + vWorldPosition.z * 0.11) * 0.5 + 0.5;
        base *= 0.91 + broadPatch * 0.09;
        gl_FragColor = vec4(base, 1.0);
      }
    `,
  }),
);
seabed.rotation.x = -Math.PI / 2;
seabed.position.y = -2.4;
seabed.receiveShadow = true;
scene.add(seabed);

function createWaterNormals(size = 256, variant = 0) {
  const data = new Uint8Array(size * size * 4);
  const normalWaves = [
    [3, 1, 0.46, 0.2],
    [-2, 5, 0.34, 1.4],
    [7, -3, 0.22, 2.7],
    [11, 4, 0.12, 4.1],
    [-13, 7, 0.08, 0.8],
    [17, -9, 0.05, 3.5],
    [23, 13, 0.03, 5.2],
    [-29, 19, 0.02, 2.1],
  ];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x / size) * Math.PI * 2;
      const v = (y / size) * Math.PI * 2;
      let slopeX = 0;
      let slopeZ = 0;
      normalWaves.forEach(([baseX, baseZ, amplitude, phase], waveIndex) => {
        const directionOffset = variant * 2 + (waveIndex % 3);
        const waveX = Math.sign(baseX) * (Math.abs(baseX) + directionOffset);
        const waveZ = Math.sign(baseZ) * (Math.abs(baseZ) + variant + ((waveIndex + 1) % 2));
        const angle = waveX * u + waveZ * v + phase + variant * 1.73;
        const sine = Math.sin(angle);
        const variantAmplitude = amplitude * (1 - variant * 0.08);
        slopeX -= variantAmplitude * waveX * sine;
        slopeZ -= variantAmplitude * waveZ * sine;
      });
      const normal = new THREE.Vector3(-slopeX * 0.13, 1, -slopeZ * 0.13).normalize();
      const offset = (y * size + x) * 4;
      data[offset] = Math.round((normal.x * 0.5 + 0.5) * 255);
      data[offset + 1] = Math.round((normal.y * 0.5 + 0.5) * 255);
      data[offset + 2] = Math.round((normal.z * 0.5 + 0.5) * 255);
      data[offset + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

const waterNormalMacro = createWaterNormals(256, 0);
const waterNormalMeso = createWaterNormals(256, 1);
const waterNormalMicro = createWaterNormals(128, 2);

const water = new Water(new THREE.PlaneGeometry(180, 180, 128, 128), {
  textureWidth: 256,
  textureHeight: 256,
  waterNormals: waterNormalMacro,
  sunDirection: sun.position.clone().normalize(),
  sunColor: 0xffddb7,
  waterColor: 0x087b91,
  distortionScale: 3.1,
  fog: true,
  alpha: 0.88,
});
water.rotation.x = -Math.PI / 2;
water.position.y = WATER_LEVEL;
water.material.transparent = true;
water.material.depthWrite = false;
water.material.uniforms.normalSamplerMeso = { value: waterNormalMeso };
water.material.uniforms.normalSamplerMicro = { value: waterNormalMicro };
scene.add(water);

function installWaveDisplacement(waterMesh) {
  waterMesh.material.vertexShader = /* glsl */ `
    uniform mat4 textureMatrix;
    uniform float time;

    varying vec4 mirrorCoord;
    varying vec4 worldPosition;
    varying float waveElevation;
    varying vec3 waveNormal;
    varying float waveScale;

    #include <common>
    #include <fog_pars_vertex>
    #include <shadowmap_pars_vertex>
    #include <logdepthbuf_pars_vertex>

    ${WAVE_FIELD_GLSL}

    void main() {
      vec2 worldXZ = vec2(position.x, -position.y);
      vec3 waveDisplacement = getWaveDisplacement(worldXZ, time);
      vec3 displacedPosition = position + vec3(waveDisplacement.x, -waveDisplacement.y, waveDisplacement.z);
      waveElevation = waveDisplacement.z;
      waveScale = waveSeaState(time);

      float sampleDistance = 0.11;
      float heightLeft = getWaveDisplacement(worldXZ - vec2(sampleDistance, 0.0), time).z;
      float heightRight = getWaveDisplacement(worldXZ + vec2(sampleDistance, 0.0), time).z;
      float heightBack = getWaveDisplacement(worldXZ - vec2(0.0, sampleDistance), time).z;
      float heightFront = getWaveDisplacement(worldXZ + vec2(0.0, sampleDistance), time).z;
      waveNormal = normalize(vec3(
        heightLeft - heightRight,
        sampleDistance * 2.0,
        heightBack - heightFront
      ));

      mirrorCoord = modelMatrix * vec4(displacedPosition, 1.0);
      worldPosition = mirrorCoord;
      mirrorCoord = textureMatrix * mirrorCoord;
      vec4 mvPosition = modelViewMatrix * vec4(displacedPosition, 1.0);
      gl_Position = projectionMatrix * mvPosition;

      #include <beginnormal_vertex>
      #include <defaultnormal_vertex>
      #include <logdepthbuf_vertex>
      #include <fog_vertex>
      #include <shadowmap_vertex>
    }
  `;

  waterMesh.material.fragmentShader = waterMesh.material.fragmentShader
    .replace(
      'varying vec4 worldPosition;',
      'varying vec4 worldPosition;\n\t\t\t\tvarying float waveElevation;\n\t\t\t\tvarying vec3 waveNormal;\n\t\t\t\tvarying float waveScale;',
    )
    .replace(
      'uniform sampler2D normalSampler;',
      'uniform sampler2D normalSampler;\n\t\t\t\tuniform sampler2D normalSamplerMeso;\n\t\t\t\tuniform sampler2D normalSamplerMicro;',
    )
    .replace(
      'vec4 noise = getNoise( worldPosition.xz * size );',
      `vec4 macroNoise = getNoise(worldPosition.xz * size);
       vec2 mesoFlowA = worldPosition.xz / 31.0 + vec2(time * 0.041, -time * 0.053);
       vec2 mesoFlowB = worldPosition.zx / 19.0 + vec2(-time * 0.067, time * 0.038);
       vec4 mesoNoise = texture2D(normalSamplerMeso, mesoFlowA) + texture2D(normalSamplerMeso, mesoFlowB) - 1.0;
       vec2 microFlowA = worldPosition.xz / 8.5 + vec2(-time * 0.13, time * 0.105);
       vec2 microFlowB = worldPosition.zx / 5.7 + vec2(time * 0.17, time * 0.082);
       vec4 microNoise = texture2D(normalSamplerMicro, microFlowA) + texture2D(normalSamplerMicro, microFlowB) - 1.0;
       vec4 noise = macroNoise * 0.50 + mesoNoise * 0.34 + microNoise * 0.16;`,
    )
    .replace(
      'vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5, 1.0, 1.5 ) );',
      `vec3 detailNormal = normalize(noise.xzy * vec3(1.5, 1.0, 1.5));
       vec3 surfaceNormal = normalize(mix(waveNormal, detailNormal, 0.46));`,
    )
    .replace(
      'vec3 outgoingLight = albedo;',
      `float crestThreshold = mix(0.17, 0.265, 1.0 - waveScale);
       float crestHeight = smoothstep(crestThreshold, crestThreshold + 0.085, waveElevation);
       float crestBreakup = mesoNoise.x * 0.72 + microNoise.z * 0.38 + surfaceNormal.x * 0.32;
       float crest = crestHeight * smoothstep(-0.08, 0.42, crestBreakup);
       float islandDistance = length(vec2(worldPosition.x / 9.4, worldPosition.z / 7.2));
       float deepBlend = smoothstep(1.18, 6.4, islandDistance);
       vec3 shallowWater = vec3(0.018, 0.48, 0.54);
       vec3 deepWater = vec3(0.006, 0.105, 0.22);
       vec3 locationTint = mix(shallowWater, deepWater, deepBlend);
       vec3 outgoingLight = mix(albedo, locationTint, mix(0.68, 0.84, deepBlend));
       outgoingLight += crest * mix(vec3(0.13, 0.19, 0.18), vec3(0.07, 0.12, 0.15), deepBlend);`,
    );
  waterMesh.material.needsUpdate = true;
}

installWaveDisplacement(water);

const shorelineFoam = new THREE.Mesh(
  new THREE.PlaneGeometry(19.2, 13.2, 88, 60),
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0xe8fff4) },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying vec2 vWorldXZ;
      varying float vWaveElevation;

      ${WAVE_FIELD_GLSL}

      void main() {
        vUv = uv;
        vec3 displacedPosition = position;
        vec2 worldXZ = vec2(position.x, -position.y);
        vWaveElevation = getWaveDisplacement(worldXZ, uTime).z;
        displacedPosition.z += vWaveElevation + 0.055;
        vec4 world = modelMatrix * vec4(displacedPosition, 1.0);
        vWorldXZ = world.xz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      varying vec2 vUv;
      varying vec2 vWorldXZ;
      varying float vWaveElevation;

      float hash21(vec2 point) {
        point = fract(point * vec2(123.34, 456.21));
        point += dot(point, point + 45.32);
        return fract(point.x * point.y);
      }

      float noise21(vec2 point) {
        vec2 base = floor(point);
        vec2 blend = fract(point);
        blend = blend * blend * (3.0 - 2.0 * blend);
        return mix(
          mix(hash21(base), hash21(base + vec2(1.0, 0.0)), blend.x),
          mix(hash21(base + vec2(0.0, 1.0)), hash21(base + vec2(1.0, 1.0)), blend.x),
          blend.y
        );
      }

      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float ellipseRadius = length(p);
        float movingNoise = noise21(vWorldXZ * 0.58 + vec2(uTime * 0.18, -uTime * 0.11));
        float fineNoise = noise21(vWorldXZ * 1.72 - vec2(uTime * 0.24, uTime * 0.15));
        float unevenEdge = (movingNoise - 0.5) * 0.085 + sin(vWorldXZ.x * 1.8 + uTime) * 0.014;
        float ring = 1.0 - smoothstep(0.018, 0.076, abs(ellipseRadius - (0.82 + unevenEdge)));
        float broken = smoothstep(0.23, 0.72, fineNoise + ring * 0.34);
        float crestLight = smoothstep(0.02, 0.25, vWaveElevation + 0.12);
        float alpha = ring * mix(0.28, 0.78, broken) * mix(0.68, 1.0, crestLight);
        alpha += ring * smoothstep(0.68, 0.9, movingNoise) * 0.16;
        if (alpha < 0.025) discard;
        vec3 foamColor = mix(uColor * 0.78, uColor, broken);
        gl_FragColor = vec4(foamColor, clamp(alpha, 0.0, 0.88));
      }
    `,
  }),
);
shorelineFoam.rotation.x = -Math.PI / 2;
shorelineFoam.position.y = WATER_LEVEL;
shorelineFoam.renderOrder = 3;
scene.add(shorelineFoam);

function seaStateAt(time) {
  return THREE.MathUtils.clamp(
    0.84 + Math.sin(time * 0.24) * 0.18 + Math.sin(time * 0.071 + 1.9) * 0.1,
    0.58,
    1.12,
  );
}

function fract(value) {
  return value - Math.floor(value);
}

function waveHash(x, z) {
  return fract(Math.sin(x * 127.1 + z * 311.7) * 43758.5453123);
}

function waveValueNoise(x, z) {
  const cellX = Math.floor(x);
  const cellZ = Math.floor(z);
  let blendX = fract(x);
  let blendZ = fract(z);
  blendX = blendX * blendX * (3 - 2 * blendX);
  blendZ = blendZ * blendZ * (3 - 2 * blendZ);
  const a = waveHash(cellX, cellZ);
  const b = waveHash(cellX + 1, cellZ);
  const c = waveHash(cellX, cellZ + 1);
  const d = waveHash(cellX + 1, cellZ + 1);
  const lower = THREE.MathUtils.lerp(a, b, blendX);
  const upper = THREE.MathUtils.lerp(c, d, blendX);
  return THREE.MathUtils.lerp(lower, upper, blendZ);
}

function waveFbm(x, z) {
  let value = 0;
  let amplitude = 0.5;
  let pointX = x;
  let pointZ = z;
  for (let octave = 0; octave < 4; octave += 1) {
    value += waveValueNoise(pointX, pointZ) * amplitude;
    pointX = pointX * 2.02 + 17.17;
    pointZ = pointZ * 2.02 - 11.53;
    amplitude *= 0.5;
  }
  return value / 0.9375;
}

function waveNoiseHeightAt(x, z, time, seaState) {
  const macroNoise =
    waveFbm(x * 0.055 + time * 0.045, z * 0.055 - time * 0.032) - 0.5;
  const mesoNoise =
    waveFbm(x * 0.21 - time * 0.11, z * 0.21 + time * 0.085) - 0.5;
  return macroNoise * 0.17 * seaState + mesoNoise * 0.07 * (0.62 + seaState * 0.38);
}

function waveHeightAt(x, z, time) {
  const seaState = seaStateAt(time);
  const gerstnerHeight = (
    directionX,
    directionZ,
    steepness,
    wavelength,
    phaseOffset,
    amplitudeScale,
  ) => {
    const directionLength = Math.hypot(directionX, directionZ);
    const headingX = directionX / directionLength;
    const headingZ = directionZ / directionLength;
    const waveNumber = (Math.PI * 2) / wavelength;
    const phaseSpeed = Math.sqrt(9.8 / waveNumber);
    const phase = waveNumber * (headingX * x + headingZ * z - phaseSpeed * time) + phaseOffset;
    return (steepness / waveNumber) * amplitudeScale * Math.sin(phase);
  };

  return (
    gerstnerHeight(1, 0.24, 0.16, 7.8, 0, seaState) +
    gerstnerHeight(-0.36, 1, 0.1, 4.6, 1.7, 0.78 + seaState * 0.24) +
    gerstnerHeight(0.72, -1, 0.065, 2.65, 3.2, 0.58 + seaState * 0.38) +
    gerstnerHeight(-0.82, -0.34, 0.038, 1.45, 5.1, 0.52 + seaState * 0.42) +
    waveNoiseHeightAt(x, z, time, seaState)
  );
}

const palette = new Map([
  ['mat-sand_warm', 0xc7b984],
  ['mat-grass_island', 0x53785a],
  ['mat-grass_dark', 0x294c2e],
  ['mat-grass_light', 0x618847],
  ['mat-lighthouse_cream', 0xd8cebd],
  ['mat-lighthouse_dusty_rose', 0xb88080],
  ['mat-roof_coral_red', 0xe47862],
  ['mat-roof_dark_brown', 0x2c1918],
  ['mat-wood_warm', 0x714832],
  ['mat-wood_light', 0xb78861],
  ['mat-cabin_red', 0x8f3b31],
  ['mat-trim_warm_white', 0xeee4d0],
  ['mat-window_blue_black', 0x17353c],
  ['mat-stone_gray', 0x737773],
  ['mat-stone_light', 0xa9a89d],
  ['mat-rope', 0xa77c50],
  ['mat-bird_white', 0xf5f0dc],
  ['mat-flower_coral', 0xe36d5f],
  ['mat-fire_ember', 0xff7d2a],
]);
const materialCache = new Map();

function webMaterial(source) {
  const name = (source?.name || '').toLowerCase();
  if (materialCache.has(name)) return materialCache.get(name);

  const color = palette.get(name) ?? source?.color?.getHex?.() ?? 0x9aa19a;
  const isWindow = name.includes('window');
  const isFire = name.includes('fire');
  const material = new THREE.MeshStandardMaterial({
    name: source?.name || 'MAT-web-default',
    color,
    roughness: isWindow ? 0.24 : isFire ? 0.42 : 0.78,
    metalness: 0,
    flatShading: !isWindow,
    side: THREE.FrontSide,
  });

  if (isWindow) {
    material.envMapIntensity = 1.35;
  }
  if (isFire) {
    material.emissive.setHex(0xb92c08);
    material.emissiveIntensity = 1.8;
  }

  materialCache.set(name, material);
  return material;
}

const NON_SHADOW_ISLAND_MATERIALS = new Set([
  'mat-window_blue_black',
  'mat-trim_warm_white',
  'mat-rope',
  'mat-bird_white',
  'mat-flower_coral',
  'mat-fire_ember',
]);

function geometrySignature(geometry, material) {
  const attributes = Object.entries(geometry.attributes)
    .map(([name, attribute]) => `${name}:${attribute.itemSize}:${attribute.normalized}:${attribute.array.constructor.name}`)
    .sort()
    .join('|');
  return `${material.uuid}|${geometry.index ? 'indexed' : 'plain'}|${attributes}`;
}

function prepareStaticIsland(root) {
  root.updateMatrixWorld(true);
  const batches = new Map();

  root.traverse((child) => {
    if (!child.isMesh || child.isSkinnedMesh || child.morphTargetInfluences) return;
    const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material];
    if (sourceMaterials.length !== 1 || child.geometry.groups.length > 1) return;

    const outputMaterial = webMaterial(sourceMaterials[0]);
    const geometry = child.geometry.clone();
    geometry.applyMatrix4(child.matrixWorld);
    const signature = geometrySignature(geometry, outputMaterial);
    if (!batches.has(signature)) batches.set(signature, { material: outputMaterial, geometries: [] });
    batches.get(signature).geometries.push(geometry);
  });

  const optimizedRoot = new THREE.Group();
  optimizedRoot.name = 'GEO-optimized-lighthouse-island';
  let batchIndex = 0;
  batches.forEach(({ material, geometries }) => {
    const mergedGeometry = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false);
    if (!mergedGeometry) {
      console.warn(`Island batch could not be merged: ${material.name}`);
      geometries.forEach((geometry, index) => {
        const fallback = new THREE.Mesh(geometry, material);
        fallback.name = `GEO-island-${material.name}-fallback-${index}`;
        fallback.castShadow = !NON_SHADOW_ISLAND_MATERIALS.has(material.name.toLowerCase());
        fallback.receiveShadow = true;
        optimizedRoot.add(fallback);
      });
      return;
    }
    if (geometries.length > 1) geometries.forEach((geometry) => geometry.dispose());
    mergedGeometry.computeBoundingBox();
    mergedGeometry.computeBoundingSphere();
    const batch = new THREE.Mesh(mergedGeometry, material);
    batch.name = `GEO-island-batch-${batchIndex}-${material.name}`;
    batch.castShadow = !NON_SHADOW_ISLAND_MATERIALS.has(material.name.toLowerCase());
    batch.receiveShadow = true;
    batch.frustumCulled = true;
    optimizedRoot.add(batch);
    batchIndex += 1;
  });

  root.traverse((child) => {
    if (child.isMesh) child.geometry.dispose();
  });
  return optimizedRoot;
}

const boatRoot = new THREE.Group();
const boatFloat = new THREE.Group();
boatRoot.add(boatFloat);
scene.add(boatRoot);

const boatState = {
  ready: false,
  speed: 0,
  heading: 0.72,
  cameraMode: 'follow',
  wakeTimer: 0,
  fishingShake: 0,
  fishingDirection: 1,
};
let fishingGame = null;

const BOAT_FALLBACK_SCALE = 0.7;
const BOAT_BLENDER_SCALE = 0.74;
const proceduralBoat = createProceduralRowboat();
proceduralBoat.scale.setScalar(BOAT_FALLBACK_SCALE);
let boatWaterlineOffset = proceduralBoat.userData.waterlineOffset * BOAT_FALLBACK_SCALE;
let buoyancyPoints = proceduralBoat.userData.buoyancyPoints.map((point) => ({
  ...point,
  x: point.x * BOAT_FALLBACK_SCALE,
  z: point.z * BOAT_FALLBACK_SCALE,
}));
let boatInteriorFloorY = -0.11 * BOAT_FALLBACK_SCALE;
let boatGunwaleY = 0.42 * BOAT_FALLBACK_SCALE;
let boatModelSource = 'threejs-procedural-fallback';
boatFloat.add(proceduralBoat);
boatState.ready = true;

function installBlenderBoat(root) {
  root.name = 'blender-rowboat';
  root.scale.setScalar(BOAT_BLENDER_SCALE);
  root.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
    child.frustumCulled = true;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      material.side = THREE.DoubleSide;
      material.needsUpdate = true;
    });
  });

  boatFloat.remove(proceduralBoat);
  boatFloat.add(root);
  boatWaterlineOffset = 0.17;
  buoyancyPoints = [
    { id: 'center', x: 0, z: 0, weight: 1.5 },
    { id: 'bow', x: 0, z: 1.1, weight: 1 },
    { id: 'stern', x: 0, z: -1.1, weight: 1 },
    { id: 'port', x: -0.42, z: 0, weight: 0.8 },
    { id: 'starboard', x: 0.42, z: 0, weight: 0.8 },
  ];
  boatInteriorFloorY = -0.055 * BOAT_BLENDER_SCALE;
  boatGunwaleY = 0.46 * BOAT_BLENDER_SCALE;
  boatModelSource = 'blender-glb';
}

function createWakeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 30);
  gradient.addColorStop(0, 'rgba(244, 248, 236, 0.8)');
  gradient.addColorStop(0.45, 'rgba(225, 240, 232, 0.35)');
  gradient.addColorStop(1, 'rgba(225, 240, 232, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

const WAKE_COUNT = 100;
const wakePositions = new Float32Array(WAKE_COUNT * 3);
const wakeGeometry = new THREE.BufferGeometry();
wakeGeometry.setAttribute('position', new THREE.BufferAttribute(wakePositions, 3));
const wakeMaterial = new THREE.PointsMaterial({
  color: 0xe7f3ee,
  size: 0.62,
  map: createWakeTexture(),
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  sizeAttenuation: true,
});
const wakePoints = new THREE.Points(wakeGeometry, wakeMaterial);
wakePoints.frustumCulled = false;
scene.add(wakePoints);

const renderWaterReflection = water.onBeforeRender;
const WATER_REFLECTION_INTERVAL_MS = 1000 / 30;
let lastWaterReflectionAt = -Infinity;
water.onBeforeRender = (...renderArguments) => {
  const reflectionNow = performance.now();
  if (reflectionNow - lastWaterReflectionAt < WATER_REFLECTION_INTERVAL_MS) return;
  lastWaterReflectionAt = reflectionNow;
  const foamWasVisible = shorelineFoam.visible;
  const wakeWasVisible = wakePoints.visible;
  const reflectionExclusions = fishingGame?.reflectionExclusions || [];
  const reflectionVisibility = reflectionExclusions.map((object) => object.visible);
  const shadowAutoUpdate = renderer.shadowMap.autoUpdate;
  shorelineFoam.visible = false;
  wakePoints.visible = false;
  reflectionExclusions.forEach((object) => {
    object.visible = false;
  });
  renderer.shadowMap.autoUpdate = false;
  try {
    renderWaterReflection(...renderArguments);
  } finally {
    renderer.shadowMap.autoUpdate = shadowAutoUpdate;
    shorelineFoam.visible = foamWasVisible;
    wakePoints.visible = wakeWasVisible;
    reflectionExclusions.forEach((object, index) => {
      object.visible = reflectionVisibility[index];
    });
  }
};

const wakeParticles = Array.from({ length: WAKE_COUNT }, () => ({
  position: new THREE.Vector3(0, -20, 0),
  velocity: new THREE.Vector3(),
  life: 0,
}));
let wakeCursor = 0;

function spawnWake(waterTime) {
  const forward = new THREE.Vector3(Math.sin(boatState.heading), 0, Math.cos(boatState.heading));
  const side = new THREE.Vector3(forward.z, 0, -forward.x);
  for (const sign of [-1, 1]) {
    const particle = wakeParticles[wakeCursor];
    wakeCursor = (wakeCursor + 1) % WAKE_COUNT;
    particle.position
      .copy(boatRoot.position)
      .addScaledVector(forward, -1.25)
      .addScaledVector(side, sign * 0.36);
    particle.position.y =
      WATER_LEVEL + waveHeightAt(particle.position.x, particle.position.z, waterTime) + 0.045;
    particle.velocity.copy(side).multiplyScalar(sign * 0.24).addScaledVector(forward, -0.15);
    particle.life = 1;
  }
}

function updateWake(delta, waterTime) {
  wakeParticles.forEach((particle, index) => {
    if (particle.life > 0) {
      particle.life -= delta * 0.42;
      particle.position.addScaledVector(particle.velocity, delta);
      particle.position.y =
        WATER_LEVEL +
        waveHeightAt(particle.position.x, particle.position.z, waterTime) +
        0.035 +
        Math.sin(particle.life * 10) * 0.008;
    } else {
      particle.position.set(0, -20, 0);
    }
    const offset = index * 3;
    wakePositions[offset] = particle.position.x;
    wakePositions[offset + 1] = particle.position.y;
    wakePositions[offset + 2] = particle.position.z;
  });
  wakeGeometry.attributes.position.needsUpdate = true;
  wakeMaterial.opacity = THREE.MathUtils.clamp(Math.abs(boatState.speed) / 5.2, 0.16, 0.58);
}

const heldControls = new Set();
const controlCodes = new Map([
  ['KeyW', 'forward'],
  ['ArrowUp', 'forward'],
  ['KeyS', 'backward'],
  ['ArrowDown', 'backward'],
  ['KeyA', 'left'],
  ['ArrowLeft', 'left'],
  ['KeyD', 'right'],
  ['ArrowRight', 'right'],
]);

function updateKeyIndicators() {
  document.querySelectorAll('[data-control]').forEach((element) => {
    element.classList.toggle('is-active', heldControls.has(element.dataset.control));
  });
  document.querySelectorAll('[data-touch]').forEach((element) => {
    element.classList.toggle('is-active', heldControls.has(element.dataset.touch));
  });
}

window.addEventListener('keydown', (event) => {
  if (!gameStarted) {
    if (!event.repeat && worldReady && (event.code === 'Enter' || event.code === 'Space')) {
      event.preventDefault();
      startGame();
    }
    return;
  }

  const control = controlCodes.get(event.code);
  if (control) {
    event.preventDefault();
    heldControls.add(control);
    updateKeyIndicators();
  }
  if (!event.repeat && event.code === 'KeyC') toggleCamera();
  if (!event.repeat && event.code === 'KeyR') resetBoat();
  if (event.code === 'Space' || event.code === 'KeyF') {
    event.preventDefault();
    if (!event.repeat) fishingGame?.primaryAction();
    fishingGame?.setReelHeld(true);
  }
  if (!event.repeat && event.code === 'KeyE') {
    event.preventDefault();
    fishingGame?.storeCargo();
  }
  if (!event.repeat && event.code === 'KeyJ') {
    event.preventDefault();
    fishingGame?.openAquarium();
  }
});

window.addEventListener('keyup', (event) => {
  const control = controlCodes.get(event.code);
  if (control) {
    event.preventDefault();
    heldControls.delete(control);
    updateKeyIndicators();
  }
  if (event.code === 'Space' || event.code === 'KeyF') {
    event.preventDefault();
    fishingGame?.setReelHeld(false);
  }
});

window.addEventListener('blur', () => {
  heldControls.clear();
  fishingGame?.setReelHeld(false);
  updateKeyIndicators();
});

document.querySelectorAll('[data-touch]').forEach((button) => {
  const control = button.dataset.touch;
  const press = (event) => {
    event.preventDefault();
    if (!gameStarted) return;
    button.setPointerCapture?.(event.pointerId);
    heldControls.add(control);
    updateKeyIndicators();
  };
  const release = (event) => {
    event.preventDefault();
    heldControls.delete(control);
    updateKeyIndicators();
  };
  button.addEventListener('pointerdown', press);
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', release);
});

cameraButton.addEventListener('click', toggleCamera);
resetButton.addEventListener('click', () => resetBoat());

function startGame() {
  if (!worldReady || gameStarted) return;
  gameStarted = true;
  heldControls.clear();
  updateKeyIndicators();
  gameLayers.forEach((layer) => {
    layer.inert = false;
  });
  loadingScreen.classList.add('is-hidden');
  loadingScreen.setAttribute('aria-hidden', 'true');
  gameStartButton.blur();
  setNavigationState('항해 준비 · WASD로 출발', 'ready');
}

gameStartButton.addEventListener('click', startGame);

function setNavigationState(text, state = 'ready') {
  navigationState.dataset.state = state;
  navigationState.lastElementChild.textContent = text;
  appStatus.textContent = text;
}

fishingGame = createFishingGame({
  scene,
  boatRoot,
  boatFloat,
  boatState,
  waterLevel: WATER_LEVEL,
  waveHeightAt,
  setNavigationState,
});
window.__fishingDebug = fishingGame;

function isNavigable(x, z) {
  const insideIsland = (x / ISLAND_COLLISION.x) ** 2 + (z / ISLAND_COLLISION.z) ** 2 < 1;
  const insideWorld = x * x + z * z < WORLD_RADIUS * WORLD_RADIUS;
  return !insideIsland && insideWorld;
}

function resetBoat(announce = true) {
  boatState.speed = 0;
  boatState.heading = 0.72;
  boatRoot.position.copy(SPAWN);
  boatRoot.rotation.y = boatState.heading;
  fishingGame?.resetTripPosition();
  if (announce) setNavigationState('배 위치를 초기화했습니다', 'ready');
}

function toggleCamera() {
  boatState.cameraMode = boatState.cameraMode === 'follow' ? 'overview' : 'follow';
  const isOverview = boatState.cameraMode === 'overview';
  orbitControls.enabled = isOverview;
  if (isOverview) {
    camera.position.set(20, 21, 20);
    orbitControls.target.set(0, 1.8, 0);
    orbitControls.update();
    setNavigationState('전체 섬 카메라 · 드래그로 회전', 'ready');
  } else {
    setNavigationState('배 추적 카메라', 'ready');
  }
  cameraValue.textContent = isOverview ? '전체' : '추적';
  cameraButton.setAttribute('aria-pressed', String(isOverview));
}

function updateBoat(delta, elapsed, waterTime) {
  if (!boatState.ready) return;

  const navigationLocked = fishingGame?.navigationLocked ?? false;
  const throttle = navigationLocked
    ? 0
    : Number(heldControls.has('forward')) - Number(heldControls.has('backward'));
  const steer = navigationLocked
    ? 0
    : Number(heldControls.has('left')) - Number(heldControls.has('right'));

  if (throttle !== 0) {
    const acceleration = throttle > 0 ? 3.15 : 2.25;
    boatState.speed += throttle * acceleration * delta;
  } else {
    boatState.speed *= Math.exp(-1.18 * delta);
    if (Math.abs(boatState.speed) < 0.015) boatState.speed = 0;
  }
  boatState.speed = THREE.MathUtils.clamp(boatState.speed, -2.2, 5.2);

  if (steer !== 0) {
    const directionSign = boatState.speed >= 0 ? 1 : -0.72;
    const steering = 0.38 + Math.min(Math.abs(boatState.speed) / 5.2, 1) * 0.82;
    boatState.heading += steer * steering * directionSign * delta;
  }

  const forward = new THREE.Vector3(Math.sin(boatState.heading), 0, Math.cos(boatState.heading));
  const previous = boatRoot.position.clone();
  boatRoot.position.addScaledVector(forward, boatState.speed * delta);

  if (!isNavigable(boatRoot.position.x, boatRoot.position.z)) {
    boatRoot.position.copy(previous);
    // Stop at the shoreline instead of creating a brief reverse velocity.
    // A reflected negative speed is treated as reversing by the steering code,
    // which made left/right controls appear swapped beside the dock.
    boatState.speed = 0;
    setNavigationState('얕은 물입니다 · 방향을 바꿔주세요', 'warning');
  }

  boatRoot.rotation.y = boatState.heading;
  const side = new THREE.Vector3(forward.z, 0, -forward.x);
  const sampleHeights = new Map();
  let weightedHeight = 0;
  let totalWeight = 0;
  buoyancyPoints.forEach((point) => {
    const worldX = boatRoot.position.x + side.x * point.x + forward.x * point.z;
    const worldZ = boatRoot.position.z + side.z * point.x + forward.z * point.z;
    const height = waveHeightAt(worldX, worldZ, waterTime);
    sampleHeights.set(point.id, height);
    weightedHeight += height * point.weight;
    totalWeight += point.weight;
  });

  const averageWave = weightedHeight / totalWeight;
  const highestSample = Math.max(...sampleHeights.values());
  const supportedWave = Math.max(averageWave, highestSample - 0.06);
  const verticalTarget = WATER_LEVEL + boatWaterlineOffset + supportedWave;
  const verticalBlend = 1 - Math.exp(-6.5 * delta);
  const smoothedFloatY = THREE.MathUtils.lerp(boatFloat.position.y, verticalTarget, verticalBlend);
  const safeMinimumFloatY = WATER_LEVEL + highestSample + 0.13 - boatInteriorFloorY;
  boatFloat.position.y = Math.max(smoothedFloatY, safeMinimumFloatY);

  const bowWave = sampleHeights.get('bow');
  const sternWave = sampleHeights.get('stern');
  const portWave = sampleHeights.get('port');
  const starboardWave = sampleHeights.get('starboard');
  const pitchTarget = THREE.MathUtils.clamp(
    Math.atan2(sternWave - bowWave, 2.7) + Math.cos(elapsed * 0.9) * 0.003,
    -0.2,
    0.2,
  );
  const rollTarget = THREE.MathUtils.clamp(
    Math.atan2(starboardWave - portWave, 1.16) - steer * 0.022,
    -0.17,
    0.17,
  );
  const rotationBlend = 1 - Math.exp(-5.2 * delta);
  boatFloat.rotation.x = THREE.MathUtils.lerp(boatFloat.rotation.x, pitchTarget, rotationBlend);
  boatFloat.rotation.z = THREE.MathUtils.lerp(boatFloat.rotation.z, rollTarget, rotationBlend);

  window.__oceanDebug = {
    modelSource: boatModelSource,
    waterTime,
    seaState: seaStateAt(waterTime),
    averageWave,
    highestSample,
    supportedWave,
    boatFloatY: boatFloat.position.y,
    interiorFloorClearance: boatFloat.position.y + boatInteriorFloorY - (WATER_LEVEL + highestSample),
    gunwaleClearance: boatFloat.position.y + boatGunwaleY - (WATER_LEVEL + highestSample),
    pitch: boatFloat.rotation.x,
    roll: boatFloat.rotation.z,
    speed: boatState.speed,
  };

  boatState.wakeTimer -= delta;
  if (Math.abs(boatState.speed) > 0.65 && boatState.wakeTimer <= 0) {
    spawnWake(waterTime);
    boatState.wakeTimer = THREE.MathUtils.lerp(0.14, 0.055, Math.abs(boatState.speed) / 5.2);
  }
}

const cameraPositionTarget = new THREE.Vector3();
const cameraLookTarget = new THREE.Vector3();
const cameraFishingShake = new THREE.Vector3();
function updateCamera(delta, elapsed) {
  camera.position.sub(cameraFishingShake);
  cameraFishingShake.set(0, 0, 0);
  if (boatState.cameraMode === 'review') return;
  if (boatState.cameraMode === 'overview') {
    orbitControls.update();
    return;
  }

  const forward = new THREE.Vector3(Math.sin(boatState.heading), 0, Math.cos(boatState.heading));
  const side = new THREE.Vector3(forward.z, 0, -forward.x);
  cameraPositionTarget
    .copy(boatRoot.position)
    .addScaledVector(forward, -9.0)
    .add(new THREE.Vector3(0, 6.4, 0));
  const cameraBlend = 1 - Math.exp(-3.3 * delta);
  camera.position.lerp(cameraPositionTarget, cameraBlend);
  cameraLookTarget.copy(boatRoot.position).addScaledVector(forward, 4.2);
  cameraLookTarget.y = 1.55;
  const fishingShake = boatState.fishingShake || 0;
  if (fishingShake > 0.001) {
    const direction = boatState.fishingDirection || 1;
    cameraFishingShake
      .copy(side)
      .multiplyScalar((Math.sin(elapsed * 31) * 0.75 + Math.sin(elapsed * 17.3) * 0.25) * fishingShake * 0.075 * direction);
    cameraFishingShake.y = Math.cos(elapsed * 27) * fishingShake * 0.035;
    camera.position.add(cameraFishingShake);
    cameraLookTarget.addScaledVector(side, Math.sin(elapsed * 23) * fishingShake * 0.045 * direction);
    cameraLookTarget.y += Math.cos(elapsed * 19) * fishingShake * 0.022;
  }
  camera.lookAt(cameraLookTarget);
}

function setBoatReviewView(view) {
  const forward = new THREE.Vector3(Math.sin(boatState.heading), 0, Math.cos(boatState.heading));
  const side = new THREE.Vector3(forward.z, 0, -forward.x);
  const target = boatRoot.position.clone().add(new THREE.Vector3(0, 0.3, 0));
  boatState.cameraMode = 'review';
  orbitControls.enabled = false;
  if (view === 'long-axis') {
    camera.position.copy(target).addScaledVector(forward, -5.2).add(new THREE.Vector3(0, 2.4, 0));
  } else if (view === 'thickness-axis') {
    camera.position.copy(target).addScaledVector(side, 5.3).add(new THREE.Vector3(0, 2.1, 0));
  } else {
    camera.position
      .copy(target)
      .addScaledVector(forward, -4.2)
      .addScaledVector(side, 3.2)
      .add(new THREE.Vector3(0, 3.1, 0));
  }
  camera.lookAt(target);
}

let mapStrippedReviewState = null;
let isolatedReviewState = null;

function setIsolatedReview(enabled) {
  if (enabled && !isolatedReviewState) {
    isolatedReviewState = {
      background: scene.background,
      fog: scene.fog,
      visibility: scene.children.map((child) => [child, child.visible]),
    };
    scene.children.forEach((child) => {
      child.visible = child === boatRoot || child.isLight;
    });
    scene.background = new THREE.Color(0x89929b);
    scene.fog = null;
    return;
  }

  if (!enabled && isolatedReviewState) {
    isolatedReviewState.visibility.forEach(([child, visible]) => {
      child.visible = visible;
    });
    scene.background = isolatedReviewState.background;
    scene.fog = isolatedReviewState.fog;
    isolatedReviewState = null;
  }
}

function setMapStrippedReview(enabled) {
  if (enabled && !mapStrippedReviewState) {
    mapStrippedReviewState = {
      background: scene.background,
      fog: scene.fog,
      overrideMaterial: scene.overrideMaterial,
      visibility: scene.children.map((child) => [child, child.visible]),
    };
    scene.children.forEach((child) => {
      child.visible = child === boatRoot;
    });
    scene.background = new THREE.Color(0x89929b);
    scene.fog = null;
    scene.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0xb9b2a6 });
    return;
  }

  if (!enabled && mapStrippedReviewState) {
    mapStrippedReviewState.visibility.forEach(([child, visible]) => {
      child.visible = visible;
    });
    scene.background = mapStrippedReviewState.background;
    scene.fog = mapStrippedReviewState.fog;
    scene.overrideMaterial.dispose();
    scene.overrideMaterial = mapStrippedReviewState.overrideMaterial;
    mapStrippedReviewState = null;
  }
}

function measureBoatEnds() {
  boatFloat.updateMatrixWorld(true);
  const toBoatLocal = new THREE.Matrix4().copy(boatFloat.matrixWorld).invert();
  const points = [];
  boatFloat.traverse((child) => {
    if (!child.isMesh || !/hull_surface|gunwale_continuous/i.test(child.name)) return;
    const positions = child.geometry?.attributes?.position;
    if (!positions) return;
    for (let index = 0; index < positions.count; index += 1) {
      const point = new THREE.Vector3().fromBufferAttribute(positions, index);
      point.applyMatrix4(child.matrixWorld).applyMatrix4(toBoatLocal);
      points.push(point);
    }
  });
  if (points.length === 0) return null;
  const minZ = Math.min(...points.map((point) => point.z));
  const maxZ = Math.max(...points.map((point) => point.z));
  const widthAt = (targetZ) => {
    const near = points.filter((point) => Math.abs(point.z - targetZ) < 0.18);
    return near.length > 0
      ? Math.max(...near.map((point) => point.x)) - Math.min(...near.map((point) => point.x))
      : null;
  };
  return { minZ, maxZ, widthAtNegativeZ: widthAt(minZ), widthAtPositiveZ: widthAt(maxZ) };
}

window.__oceanDebugApi = {
  setBoatReviewView,
  setIsolatedReview,
  setMapStrippedReview,
  setPerformanceView(view = 'island') {
    boatState.cameraMode = 'review';
    orbitControls.enabled = false;
    camera.position.set(-18, 11, -18);
    camera.lookAt(view === 'sea' ? new THREE.Vector3(-42, 1.5, -42) : new THREE.Vector3(0, 2.4, 0));
  },
  getRenderStats() {
    const { render, memory } = renderer.info;
    return {
      calls: render.calls,
      triangles: render.triangles,
      points: render.points,
      lines: render.lines,
      geometries: memory.geometries,
      textures: memory.textures,
      pixelRatio: renderer.getPixelRatio(),
    };
  },
  resume() {
    setMapStrippedReview(false);
    setIsolatedReview(false);
    boatState.cameraMode = 'follow';
    cameraValue.textContent = '추적';
    cameraButton.setAttribute('aria-pressed', 'false');
  },
  resetBoat: () => resetBoat(false),
  measureBoatEnds,
};

function updateTelemetry(waterTime) {
  speedValue.textContent = (Math.abs(boatState.speed) * 1.94384).toFixed(1);
  waveValue.textContent = (0.18 + seaStateAt(waterTime) * 0.2).toFixed(2);
  positionValue.textContent = `${boatRoot.position.x.toFixed(1)} / ${boatRoot.position.z.toFixed(1)}`;
}

const loadingManager = new THREE.LoadingManager();
loadingManager.onProgress = (_url, loaded, total) => {
  const progress = total > 0 ? (loaded / total) * 100 : 10;
  loadingProgress.style.width = `${Math.max(8, progress)}%`;
  loadingLabel.textContent = `등대 섬을 불러오는 중 · ${Math.round(progress)}%`;
};
loadingManager.onError = (url) => {
  console.error(`Asset failed to load: ${url}`);
};
const loader = new GLTFLoader(loadingManager);

async function loadWorld() {
  const [islandResult, boatResult] = await Promise.allSettled([
    loader.loadAsync('/models/lighthouse-island.glb'),
    loader.loadAsync('/models/rowboat-blender.glb'),
  ]);

  if (islandResult.status === 'fulfilled') {
    scene.add(prepareStaticIsland(islandResult.value.scene));
  } else {
    console.error(islandResult.reason);
  }

  if (boatResult.status === 'fulfilled') {
    installBlenderBoat(boatResult.value.scene);
  } else {
    console.warn('Blender boat could not be loaded; using the smaller procedural fallback.', boatResult.reason);
  }

  loadingProgress.style.width = '100%';
  loadingLabel.textContent = '항해 준비 완료';
  worldReady = true;
  loadingScreen.classList.add('is-ready');
  gameStartButton.disabled = false;
  setNavigationState(
    islandResult.status === 'fulfilled' ? '타이틀 화면 · 낚시 시작을 눌러주세요' : '섬 없이 항해 준비 완료',
    islandResult.status === 'fulfilled' ? 'ready' : 'error',
  );
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(preferredPixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const timer = new THREE.Timer();
timer.connect(document);
let shadowRefreshAccumulator = 1 / 30;
let resolutionSampleTime = 0;
let resolutionSampleFrames = 0;

function updateAdaptiveResolution(rawDelta) {
  if (document.hidden) {
    resolutionSampleTime = 0;
    resolutionSampleFrames = 0;
    return;
  }
  resolutionSampleTime += Math.min(rawDelta, 0.2);
  resolutionSampleFrames += 1;
  if (resolutionSampleTime < 2.5) return;

  const averageFps = resolutionSampleFrames / resolutionSampleTime;
  const currentRatio = renderer.getPixelRatio();
  const preferredRatio = preferredPixelRatio();
  const minimumRatio = minimumPixelRatio();
  let nextRatio = currentRatio;
  if (averageFps < 58 && currentRatio > minimumRatio + 0.01) {
    nextRatio = Math.max(minimumRatio, currentRatio - 0.06);
  } else if (averageFps > 85 && currentRatio < preferredRatio - 0.01) {
    nextRatio = Math.min(preferredRatio, currentRatio + 0.03);
  }
  if (Math.abs(nextRatio - currentRatio) > 0.005) renderer.setPixelRatio(nextRatio);
  resolutionSampleTime = 0;
  resolutionSampleFrames = 0;
}

function animate(timestamp) {
  requestAnimationFrame(animate);
  timer.update(timestamp);
  const rawDelta = timer.getDelta();
  const delta = Math.min(rawDelta, 0.05);
  const elapsed = timer.getElapsed();
  updateAdaptiveResolution(rawDelta);
  shadowRefreshAccumulator += delta;
  if (shadowRefreshAccumulator >= 1 / 30) {
    renderer.shadowMap.needsUpdate = true;
    shadowRefreshAccumulator %= 1 / 30;
  }
  water.material.uniforms.time.value += delta * 0.72;
  const waterTime = water.material.uniforms.time.value;
  seabed.material.uniforms.uTime.value = waterTime;
  shorelineFoam.material.uniforms.uTime.value = waterTime;

  const beamAngle = elapsed * 0.34;
  lighthouseBeamTarget.position.set(
    lighthouseBeam.position.x + Math.cos(beamAngle) * 22,
    2.4,
    lighthouseBeam.position.z + Math.sin(beamAngle) * 22,
  );

  updateClouds(delta, elapsed);
  updateBoat(delta, elapsed, waterTime);
  fishingGame?.update(delta, elapsed, waterTime);
  updateWake(delta, waterTime);
  updateCamera(delta, elapsed);
  updateTelemetry(waterTime);
  renderer.render(scene, camera);
}

resetBoat(false);
loadWorld();
animate();
