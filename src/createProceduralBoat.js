import * as THREE from 'three';

const STATIONS = [
  { z: -1.8, halfWidth: 0.07, sheer: 0.42, chine: -0.1, keel: -0.2 },
  { z: -1.42, halfWidth: 0.46, sheer: 0.47, chine: -0.18, keel: -0.35 },
  { z: -0.82, halfWidth: 0.69, sheer: 0.5, chine: -0.25, keel: -0.46 },
  { z: 0, halfWidth: 0.78, sheer: 0.52, chine: -0.28, keel: -0.5 },
  { z: 0.82, halfWidth: 0.69, sheer: 0.5, chine: -0.25, keel: -0.46 },
  { z: 1.42, halfWidth: 0.46, sheer: 0.47, chine: -0.18, keel: -0.35 },
  { z: 1.8, halfWidth: 0.07, sheer: 0.42, chine: -0.1, keel: -0.2 },
];

function installWoodVariation(material, { seed, grainScale, contrast }) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        'varying vec3 vBoatWoodPosition;\nvoid main() {',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vBoatWoodPosition = position;',
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `varying vec3 vBoatWoodPosition;
        float boatWoodHash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7)) + ${seed.toFixed(2)}) * 43758.5453);
        }
        float boatWoodNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(boatWoodHash(i), boatWoodHash(i + vec2(1.0, 0.0)), f.x),
            mix(boatWoodHash(i + vec2(0.0, 1.0)), boatWoodHash(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }
        float boatWoodFbm(vec2 p) {
          float value = 0.0;
          float amplitude = 0.55;
          for (int octave = 0; octave < 3; octave++) {
            value += amplitude * boatWoodNoise(p);
            p = mat2(1.67, -1.09, 1.09, 1.67) * p + 2.3;
            amplitude *= 0.47;
          }
          return value;
        }
        void main() {`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float woodMacro = boatWoodFbm(vBoatWoodPosition.xz * ${grainScale.toFixed(2)});
        float woodRings = sin(vBoatWoodPosition.z * ${(grainScale * 8).toFixed(2)} + woodMacro * 5.5);
        float woodMicro = boatWoodNoise(vBoatWoodPosition.xz * ${(grainScale * 16).toFixed(2)});
        float woodBand = (woodMacro - 0.48) * 0.74 + woodRings * 0.16 + (woodMicro - 0.5) * 0.10;
        diffuseColor.rgb *= 1.0 + woodBand * ${contrast.toFixed(2)};`,
      );
  };
  material.customProgramCacheKey = () => `procedural-boat-wood-${seed}-${grainScale}-${contrast}`;
}

function pushTriangle(positions, a, b, c) {
  positions.push(...a, ...b, ...c);
}

function pushQuad(positions, a, b, c, d) {
  pushTriangle(positions, a, b, d);
  pushTriangle(positions, b, c, d);
}

function createHullGeometry() {
  const positions = [];

  for (let index = 0; index < STATIONS.length - 1; index += 1) {
    const a = STATIONS[index];
    const b = STATIONS[index + 1];
    for (const side of [-1, 1]) {
      const upperA = [side * a.halfWidth, a.sheer, a.z];
      const upperB = [side * b.halfWidth, b.sheer, b.z];
      const chineA = [side * a.halfWidth * 0.72, a.chine, a.z];
      const chineB = [side * b.halfWidth * 0.72, b.chine, b.z];
      const keelA = [0, a.keel, a.z];
      const keelB = [0, b.keel, b.z];

      if (side < 0) {
        pushQuad(positions, upperA, upperB, chineB, chineA);
        pushQuad(positions, chineA, chineB, keelB, keelA);
      } else {
        pushQuad(positions, upperB, upperA, chineA, chineB);
        pushQuad(positions, chineB, chineA, keelA, keelB);
      }
    }
  }

  const stern = STATIONS[0];
  const bow = STATIONS.at(-1);
  for (const station of [stern, bow]) {
    const direction = station === stern ? -1 : 1;
    const portUpper = [-station.halfWidth, station.sheer, station.z + direction * 0.015];
    const starboardUpper = [station.halfWidth, station.sheer, station.z + direction * 0.015];
    const keel = [0, station.keel, station.z + direction * 0.015];
    if (direction < 0) pushTriangle(positions, starboardUpper, portUpper, keel);
    else pushTriangle(positions, portUpper, starboardUpper, keel);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}

function createTaperedFloorGeometry() {
  const positions = [];
  const floorStations = STATIONS.slice(1, -1).map((station) => ({
    z: station.z,
    halfWidth: Math.max(0.18, station.halfWidth * 0.43),
  }));
  const top = -0.02;
  const bottom = -0.11;

  for (let index = 0; index < floorStations.length - 1; index += 1) {
    const a = floorStations[index];
    const b = floorStations[index + 1];
    pushQuad(
      positions,
      [-a.halfWidth, top, a.z],
      [-b.halfWidth, top, b.z],
      [b.halfWidth, top, b.z],
      [a.halfWidth, top, a.z],
    );
    pushQuad(
      positions,
      [a.halfWidth, bottom, a.z],
      [b.halfWidth, bottom, b.z],
      [-b.halfWidth, bottom, b.z],
      [-a.halfWidth, bottom, a.z],
    );
  }

  for (const side of [-1, 1]) {
    for (let index = 0; index < floorStations.length - 1; index += 1) {
      const a = floorStations[index];
      const b = floorStations[index + 1];
      pushQuad(
        positions,
        [side * a.halfWidth, top, a.z],
        [side * a.halfWidth, bottom, a.z],
        [side * b.halfWidth, bottom, b.z],
        [side * b.halfWidth, top, b.z],
      );
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function markModel(root) {
  root.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
    child.frustumCulled = true;
    child.userData.explodeWithParent = child.name.includes('blade') || child.name.includes('shaft');
  });
}

export function createProceduralRowboat() {
  const root = new THREE.Group();
  root.name = 'procedural-rowboat';

  const hullMaterial = new THREE.MeshPhysicalMaterial({
    name: 'boat-hull-dark-wood',
    color: 0x865f45,
    roughness: 0.68,
    clearcoat: 0.08,
    clearcoatRoughness: 0.7,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  const interiorMaterial = new THREE.MeshPhysicalMaterial({
    name: 'boat-interior-wood',
    color: 0x795039,
    roughness: 0.73,
    clearcoat: 0.04,
    clearcoatRoughness: 0.78,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  const warmWoodMaterial = new THREE.MeshPhysicalMaterial({
    name: 'boat-warm-worn-wood',
    color: 0xbb7d46,
    roughness: 0.6,
    clearcoat: 0.1,
    clearcoatRoughness: 0.66,
    flatShading: true,
  });
  installWoodVariation(hullMaterial, { seed: 1.7, grainScale: 2.2, contrast: 0.34 });
  installWoodVariation(interiorMaterial, { seed: 4.1, grainScale: 2.8, contrast: 0.24 });
  installWoodVariation(warmWoodMaterial, { seed: 7.3, grainScale: 3.4, contrast: 0.18 });

  const hull = new THREE.Mesh(createHullGeometry(), hullMaterial);
  hull.name = 'hull-shell';
  root.add(hull);

  const innerFloor = new THREE.Mesh(createTaperedFloorGeometry(), interiorMaterial);
  innerFloor.name = 'inner-floor';
  root.add(innerFloor);

  for (const side of [-1, 1]) {
    const railCurve = new THREE.CatmullRomCurve3(
      STATIONS.map((station) => new THREE.Vector3(
        side * (station.halfWidth + 0.025),
        station.sheer + 0.025,
        station.z,
      )),
    );
    railCurve.curveType = 'catmullrom';
    railCurve.tension = 0.3;
    const rail = new THREE.Mesh(new THREE.TubeGeometry(railCurve, 32, 0.055, 5, false), warmWoodMaterial);
    rail.name = side < 0 ? 'gunwale-port' : 'gunwale-starboard';
    root.add(rail);
  }

  const benchZ = [-0.76, 0, 0.76];
  benchZ.forEach((z, index) => {
    const halfWidth = 0.73 - Math.abs(z) * 0.08;
    const bench = new THREE.Mesh(
      new THREE.BoxGeometry(halfWidth * 1.72, 0.1, 0.24, 1, 1, 1),
      warmWoodMaterial,
    );
    bench.name = `bench-${index + 1}`;
    bench.position.set(0, 0.34, z);
    root.add(bench);
  });

  for (const z of [-1.1, -0.55, 0, 0.55, 1.1]) {
    for (const side of [-1, 1]) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.42, 0.07), interiorMaterial);
      rib.name = `inner-rib-${side < 0 ? 'port' : 'starboard'}-${z}`;
      rib.position.set(side * (0.54 - Math.abs(z) * 0.12), 0.12, z);
      rib.rotation.z = side * -0.22;
      root.add(rib);
    }
  }

  const keel = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.13, 3.1), hullMaterial);
  keel.name = 'keel';
  keel.position.y = -0.5;
  root.add(keel);

  root.userData.waterlineOffset = 0.3;
  root.userData.buoyancyPoints = [
    { id: 'center', x: 0, z: 0, weight: 1.5 },
    { id: 'bow', x: 0, z: 1.35, weight: 1 },
    { id: 'stern', x: 0, z: -1.35, weight: 1 },
    { id: 'port', x: -0.58, z: 0, weight: 0.8 },
    { id: 'starboard', x: 0.58, z: 0, weight: 0.8 },
  ];
  root.userData.sculptRuntime = {
    modelId: 'procedural-rowboat',
    selectableParts: ['hull-shell', 'inner-floor', 'gunwale-port', 'gunwale-starboard', 'bench-1', 'bench-2', 'bench-3', 'keel'],
    destructionGroups: { hull: ['hull-shell', 'inner-floor', 'keel'], deck: ['gunwale-port', 'gunwale-starboard', 'bench-1', 'bench-2', 'bench-3'], equipment: [] },
  };

  markModel(root);
  return root;
}
