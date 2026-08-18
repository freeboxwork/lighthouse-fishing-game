import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const FISH_CATALOG = Object.freeze([
  { id: 'sardine', name: '은빛 정어리', tier: 'common', col: 0, row: 0, color: 0x9dc9d4, minKg: 0.18, maxKg: 0.46 },
  { id: 'mackerel', name: '푸른 고등어', tier: 'common', col: 1, row: 0, color: 0x2a91ab, minKg: 0.42, maxKg: 1.1 },
  { id: 'rockfish', name: '노을 쏨뱅이', tier: 'common', col: 2, row: 0, color: 0xe5663d, minKg: 0.36, maxKg: 0.92 },
  { id: 'seabream', name: '줄무늬 감성돔', tier: 'common', col: 3, row: 0, color: 0xc2b8aa, minKg: 0.58, maxKg: 1.42 },
  { id: 'flyingfish', name: '비취 날치', tier: 'uncommon', col: 0, row: 1, color: 0x39c5d5, minKg: 0.5, maxKg: 1.36 },
  { id: 'snapper', name: '산호 참돔', tier: 'uncommon', col: 1, row: 1, color: 0xed6e69, minKg: 0.72, maxKg: 2.15 },
  { id: 'yellowtail', name: '황금 방어', tier: 'uncommon', col: 2, row: 1, color: 0x1f8da9, minKg: 1.2, maxKg: 3.8 },
  { id: 'squid', name: '보랏빛 오징어', tier: 'uncommon', col: 3, row: 1, color: 0xa44be0, minKg: 0.65, maxKg: 2.4 },
  { id: 'mahimahi', name: '청록 만새기', tier: 'rare', col: 0, row: 2, color: 0x5dc867, minKg: 2.2, maxKg: 6.7 },
  { id: 'tuna', name: '심해 참다랑어', tier: 'rare', col: 1, row: 2, color: 0x2852a8, minKg: 3.8, maxKg: 11.5 },
  { id: 'jellyfish', name: '달빛 해파리', tier: 'rare', col: 2, row: 2, color: 0x71bfff, minKg: 0.3, maxKg: 1.2 },
  { id: 'sunscale', name: '태양비늘어', tier: 'legendary', col: 3, row: 2, color: 0xffa13d, minKg: 5.5, maxKg: 14.2 },
]);

const TIER_META = Object.freeze({
  common: { label: '일반', color: '#b9d5d6' },
  uncommon: { label: '고급', color: '#7ed8b0' },
  rare: { label: '희귀', color: '#8cb8ff' },
  legendary: { label: '전설', color: '#ffc573' },
});

const FIGHT_PROFILES = Object.freeze({
  common: { reelRate: 0.285, pull: 0.28, surge: 0.34, retreat: 0.018, maxTime: 22, snapGrace: 0.82, slackGrace: 1.55 },
  uncommon: { reelRate: 0.235, pull: 0.4, surge: 0.48, retreat: 0.026, maxTime: 26, snapGrace: 0.68, slackGrace: 1.4 },
  rare: { reelRate: 0.19, pull: 0.54, surge: 0.64, retreat: 0.04, maxTime: 31, snapGrace: 0.54, slackGrace: 1.22 },
  legendary: { reelRate: 0.195, pull: 0.68, surge: 0.82, retreat: 0.055, maxTime: 44, snapGrace: 0.44, slackGrace: 1.05 },
});

const SPOT_DEFINITIONS = Object.freeze([
  { id: 'shoal', name: '은빛 여울', x: -23, z: -3, color: 0x85dcd4, weights: [0.76, 0.21, 0.03, 0] },
  { id: 'reef', name: '산호 암초', x: -5, z: -24, color: 0xff8f71, weights: [0.5, 0.38, 0.11, 0.01] },
  { id: 'blue', name: '푸른 수로', x: 23, z: -12, color: 0x5daff3, weights: [0.3, 0.4, 0.26, 0.04] },
  { id: 'moon', name: '달빛 웅덩이', x: 18, z: 19, color: 0xae8cff, weights: [0.23, 0.34, 0.34, 0.09] },
  { id: 'sun', name: '노을 난류', x: -22, z: 22, color: 0xffb36c, weights: [0.27, 0.34, 0.28, 0.11] },
]);

const DOCK_POSITION = new THREE.Vector3(-10.1, 0, -7.6);
const CARGO_CAPACITY = 6;
const FISH_BY_ID = new Map(FISH_CATALOG.map((fish) => [fish.id, fish]));
const FISHING_PHASES = new Set(['casting', 'waiting', 'bite', 'reeling', 'caught']);

function easeInOutCubic(value) {
  return value < 0.5 ? 4 * value * value * value : 1 - ((-2 * value + 2) ** 3) / 2;
}

function createFishingAudio() {
  let context = null;
  const ensure = () => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!context) context = new AudioContextClass();
    if (context.state === 'suspended') context.resume().catch(() => {});
    return context;
  };
  const tone = (startFrequency, endFrequency, duration, type = 'sine', volume = 0.03, delay = 0) => {
    const audioContext = ensure();
    if (!audioContext) return;
    const startAt = audioContext.currentTime + delay;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(startFrequency, startAt);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(24, endFrequency), startAt + duration);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.02);
  };
  const noise = (duration = 0.18, volume = 0.035, frequency = 900, delay = 0) => {
    const audioContext = ensure();
    if (!audioContext) return;
    const length = Math.max(1, Math.floor(audioContext.sampleRate * duration));
    const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      channel[index] = (Math.random() * 2 - 1) * (1 - index / length);
    }
    const source = audioContext.createBufferSource();
    const filter = audioContext.createBiquadFilter();
    const gain = audioContext.createGain();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = 0.72;
    gain.gain.value = volume;
    source.buffer = buffer;
    source.connect(filter).connect(gain).connect(audioContext.destination);
    source.start(audioContext.currentTime + delay);
  };
  return {
    ensure,
    cast() {
      noise(0.28, 0.035, 1250);
      tone(150, 430, 0.25, 'triangle', 0.024);
    },
    splash(strength = 1) {
      noise(0.22, 0.045 * strength, 760);
      tone(115, 62, 0.2, 'sine', 0.018 * strength);
    },
    bite() {
      tone(390, 720, 0.11, 'square', 0.035);
      tone(520, 920, 0.12, 'square', 0.03, 0.13);
    },
    hook() {
      tone(170, 330, 0.13, 'sawtooth', 0.035);
    },
    reel(tension) {
      tone(92 + tension * 75, 70 + tension * 42, 0.038, 'square', 0.012 + tension * 0.009);
    },
    surge(strength) {
      tone(82 + strength * 35, 42, 0.16, 'sawtooth', 0.018 + strength * 0.014);
    },
    success() {
      tone(330, 440, 0.13, 'triangle', 0.035);
      tone(440, 660, 0.18, 'triangle', 0.038, 0.12);
      tone(660, 880, 0.2, 'triangle', 0.032, 0.27);
    },
    fail() {
      tone(180, 72, 0.38, 'sawtooth', 0.026);
    },
  };
}

function material(color, roughness = 0.78, emissive = 0x000000) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness: 0,
    flatShading: true,
    emissive,
    emissiveIntensity: emissive === 0x000000 ? 0 : 0.65,
  });
}

function createCylinderBetween(start, end, radius, sourceMaterial, radialSegments = 6) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 1.06, direction.length(), radialSegments),
    sourceMaterial,
  );
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  mesh.castShadow = true;
  return mesh;
}

function createLowPolyFish(color, scale = 1) {
  const root = new THREE.Group();
  const makeNonIndexed = (source) => {
    if (!source.index) return source;
    const converted = source.toNonIndexed();
    source.dispose();
    return converted;
  };
  const bodyGeometry = makeNonIndexed(new THREE.IcosahedronGeometry(0.32, 1));
  bodyGeometry.scale(1.42, 0.58, 0.68);
  const tailGeometry = makeNonIndexed(new THREE.ConeGeometry(0.22, 0.42, 3));
  tailGeometry.rotateZ(-Math.PI / 2);
  tailGeometry.scale(1, 1, 0.62);
  tailGeometry.translate(-0.49, 0, 0);
  const finGeometry = makeNonIndexed(new THREE.ConeGeometry(0.13, 0.28, 3));
  finGeometry.translate(0.02, 0.24, 0);
  const geometry = mergeGeometries([bodyGeometry, tailGeometry, finGeometry], false);
  bodyGeometry.dispose();
  tailGeometry.dispose();
  finGeometry.dispose();
  const fish = new THREE.Mesh(geometry, material(color, 0.56));
  fish.castShadow = false;
  root.add(fish);
  root.scale.setScalar(scale);
  return root;
}

function makeLabelSprite(text, accent = '#f0b66a', width = 430) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = 112;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'rgba(9, 31, 36, 0.82)';
  context.beginPath();
  context.roundRect(8, 8, canvas.width - 16, canvas.height - 16, 28);
  context.fill();
  context.strokeStyle = accent;
  context.lineWidth = 3;
  context.stroke();
  context.fillStyle = '#f7f1e4';
  context.font = '700 35px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, opacity: 0.82 }),
  );
  sprite.scale.set(4.1, 1.06, 1);
  return sprite;
}

function createFishingSpot(definition, waterLevel) {
  const root = new THREE.Group();
  root.name = `fishing-spot-${definition.id}`;
  root.position.set(definition.x, waterLevel, definition.z);

  const ringMaterial = new THREE.MeshBasicMaterial({
    color: definition.color,
    transparent: true,
    opacity: 0.52,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const outerRing = new THREE.Mesh(new THREE.TorusGeometry(2.7, 0.055, 6, 48), ringMaterial);
  outerRing.rotation.x = Math.PI / 2;
  root.add(outerRing);
  const innerRing = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.028, 5, 40), ringMaterial.clone());
  innerRing.rotation.x = Math.PI / 2;
  innerRing.material.opacity = 0.28;
  root.add(innerRing);

  const buoy = new THREE.Group();
  const buoyStem = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.72, 6), material(0x604133, 0.76));
  buoyStem.position.y = 0.33;
  buoy.add(buoyStem);
  const buoyTop = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), material(definition.color, 0.48, definition.color));
  buoyTop.position.y = 0.72;
  buoy.add(buoyTop);
  root.add(buoy);

  const label = makeLabelSprite(definition.name, `#${new THREE.Color(definition.color).getHexString()}`);
  label.position.y = 1.65;
  root.add(label);

  const fishSchool = new THREE.Group();
  const fish = [];
  for (let index = 0; index < 6; index += 1) {
    const swimmer = createLowPolyFish(
      index % 3 === 0 ? definition.color : new THREE.Color(definition.color).lerp(new THREE.Color(0x91c6ba), index / 10),
      0.45 + (index % 3) * 0.08,
    );
    swimmer.userData.angle = (index / 6) * Math.PI * 2;
    swimmer.userData.radius = 0.82 + (index % 3) * 0.48;
    swimmer.userData.speed = 0.35 + index * 0.035;
    swimmer.position.y = -0.56 - (index % 2) * 0.18;
    fishSchool.add(swimmer);
    fish.push(swimmer);
  }
  root.add(fishSchool);
  return { ...definition, root, outerRing, innerRing, buoy, label, fish };
}

function createAngler() {
  const root = new THREE.Group();
  root.name = 'GEO-threejs-angler';
  root.position.set(-0.04, 0.12, 0.08);
  root.rotation.y = -0.12;

  const bootMaterial = material(0x2b2524, 0.86);
  const trouserMaterial = material(0x304c52, 0.82);
  const sweaterMaterial = material(0xe3d3ad, 0.9);
  const vestMaterial = material(0x174f55, 0.76);
  const skinMaterial = material(0xc98962, 0.72);
  const hairMaterial = material(0x241c1a, 0.88);
  const capMaterial = material(0xd85f45, 0.85);
  const rodMaterial = material(0x5a3524, 0.66);

  const leftLeg = createCylinderBetween(new THREE.Vector3(-0.12, 0.2, 0), new THREE.Vector3(-0.16, 0.48, 0.03), 0.085, trouserMaterial);
  const rightLeg = createCylinderBetween(new THREE.Vector3(0.12, 0.2, 0), new THREE.Vector3(0.16, 0.48, 0.03), 0.085, trouserMaterial);
  root.add(leftLeg, rightLeg);
  for (const x of [-0.13, 0.13]) {
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.11, 0.25), bootMaterial);
    boot.position.set(x, 0.12, 0.08);
    boot.castShadow = true;
    root.add(boot);
  }

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.27, 0.48, 7), vestMaterial);
  torso.position.y = 0.68;
  torso.castShadow = true;
  root.add(torso);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.036, 5, 8), sweaterMaterial);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.93;
  root.add(collar);

  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18, 1), skinMaterial);
  head.scale.set(0.88, 1.08, 0.92);
  head.position.y = 1.09;
  head.castShadow = true;
  root.add(head);
  const hair = new THREE.Mesh(new THREE.IcosahedronGeometry(0.185, 1), hairMaterial);
  hair.scale.set(0.9, 0.58, 0.94);
  hair.position.y = 1.19;
  root.add(hair);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.205, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), capMaterial);
  cap.scale.y = 0.72;
  cap.position.y = 1.25;
  root.add(cap);
  const capBand = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.027, 5, 9), capMaterial);
  capBand.rotation.x = Math.PI / 2;
  capBand.position.y = 1.245;
  root.add(capBand);

  const leftArm = createCylinderBetween(new THREE.Vector3(-0.2, 0.79, 0), new THREE.Vector3(0.05, 0.7, 0.12), 0.064, sweaterMaterial);
  const rightArm = createCylinderBetween(new THREE.Vector3(0.2, 0.79, 0), new THREE.Vector3(0.3, 0.68, 0.12), 0.064, sweaterMaterial);
  root.add(leftArm, rightArm);

  const rodPivot = new THREE.Group();
  rodPivot.position.set(0.12, 0.73, 0.12);
  rodPivot.rotation.z = -1.02;
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.022, 1.42, 6), rodMaterial);
  rod.geometry.translate(0, 0.71, 0);
  rod.castShadow = true;
  rodPivot.add(rod);
  const rodTip = new THREE.Object3D();
  rodTip.position.y = 1.42;
  rod.add(rodTip);
  root.add(rodPivot);

  const hookBadge = new THREE.Mesh(new THREE.TorusGeometry(0.033, 0.008, 5, 9, Math.PI * 1.55), material(0xc49a4c, 0.45));
  hookBadge.position.set(0.16, 0.75, 0.245);
  root.add(hookBadge);

  root.traverse((child) => {
    if (child.isMesh) child.castShadow = true;
  });
  leftArm.userData.baseQuaternion = leftArm.quaternion.clone();
  rightArm.userData.baseQuaternion = rightArm.quaternion.clone();
  return { root, rodPivot, rodTip, head, leftArm, rightArm };
}

function createFishCrate() {
  const root = new THREE.Group();
  root.name = 'GEO-threejs-fish-crate';
  root.position.set(0, 0.22, -0.86);
  const wood = material(0x8b603b, 0.9);
  const dark = material(0x30271f, 0.9);
  const bottom = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.06, 0.54), dark);
  root.add(bottom);
  for (const x of [-0.34, 0.34]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.31, 0.58), wood);
    side.position.set(x, 0.14, 0);
    root.add(side);
  }
  for (const z of [-0.29, 0.29]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.31, 0.055), wood);
    side.position.set(0, 0.14, z);
    root.add(side);
  }
  const fill = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.035, 0.46),
    new THREE.MeshStandardMaterial({ color: 0x65b8bd, transparent: true, opacity: 0.32, roughness: 0.3 }),
  );
  fill.position.y = 0.08;
  root.add(fill);
  return { root, fill };
}

function createIslandFacilities(scene, waterLevel) {
  const facilityRoot = new THREE.Group();
  facilityRoot.name = 'GEO-threejs-fishing-facilities';
  scene.add(facilityRoot);

  const pierStart = new THREE.Vector3(-6.15, waterLevel + 0.54, -4.45);
  const pierEnd = DOCK_POSITION.clone().setY(waterLevel + 0.54);
  const pierDirection = new THREE.Vector3().subVectors(pierEnd, pierStart);
  const pierLength = pierDirection.length();
  const pierYaw = Math.atan2(pierDirection.x, pierDirection.z);
  const dockWood = material(0xa9784e, 0.92);
  const dockDark = material(0x54392b, 0.9);
  const plankCount = 15;
  const plankInstances = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.18, 0.12, pierLength / plankCount * 0.84),
    dockWood,
    plankCount,
  );
  const instanceTransform = new THREE.Object3D();
  for (let index = 0; index < plankCount; index += 1) {
    const progress = index / (plankCount - 1);
    instanceTransform.position.lerpVectors(pierStart, pierEnd, progress);
    instanceTransform.rotation.set(0, pierYaw, 0);
    instanceTransform.updateMatrix();
    plankInstances.setMatrixAt(index, instanceTransform.matrix);
  }
  plankInstances.instanceMatrix.needsUpdate = true;
  plankInstances.castShadow = true;
  plankInstances.receiveShadow = true;
  facilityRoot.add(plankInstances);

  const postProgress = [0.05, 0.34, 0.65, 0.94];
  const postInstances = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.055, 0.07, 1.25, 6),
    dockDark,
    postProgress.length * 2,
  );
  let postIndex = 0;
  for (const side of [-1, 1]) {
    for (const progress of postProgress) {
      const center = new THREE.Vector3().lerpVectors(pierStart, pierEnd, progress);
      const right = new THREE.Vector3(Math.cos(pierYaw), 0, -Math.sin(pierYaw));
      instanceTransform.position.copy(center).addScaledVector(right, side * 0.57);
      instanceTransform.position.y = waterLevel + 0.21;
      instanceTransform.rotation.set(0, 0, 0);
      instanceTransform.updateMatrix();
      postInstances.setMatrixAt(postIndex, instanceTransform.matrix);
      postIndex += 1;
    }
  }
  postInstances.instanceMatrix.needsUpdate = true;
  postInstances.castShadow = true;
  facilityRoot.add(postInstances);

  const aquarium = new THREE.Group();
  aquarium.name = 'GEO-threejs-island-aquarium';
  aquarium.position.set(-4.2, 0.1, -3.72);
  aquarium.rotation.y = pierYaw * 0.42;
  facilityRoot.add(aquarium);

  const stone = material(0x8a8c7e, 0.94);
  const frame = material(0x6b4934, 0.88);
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.45, 0.24, 1.32), stone);
  base.position.y = 0.12;
  base.castShadow = true;
  aquarium.add(base);
  const water = new THREE.Mesh(
    new THREE.BoxGeometry(2.08, 0.9, 0.94),
    new THREE.MeshStandardMaterial({
      color: 0x43b8c3,
      transparent: true,
      opacity: 0.48,
      roughness: 0.22,
      metalness: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  water.position.y = 0.82;
  aquarium.add(water);
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(2.18, 1.04, 1.04),
    new THREE.MeshStandardMaterial({
      color: 0xb9eff0,
      transparent: true,
      opacity: 0.2,
      roughness: 0.12,
      metalness: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  glass.position.y = 0.86;
  aquarium.add(glass);
  const aquariumPosts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, 1.24, 0.09), frame, 4);
  let aquariumPostIndex = 0;
  for (const x of [-1.14, 1.14]) {
    for (const z of [-0.57, 0.57]) {
      instanceTransform.position.set(x, 0.82, z);
      instanceTransform.rotation.set(0, 0, 0);
      instanceTransform.updateMatrix();
      aquariumPosts.setMatrixAt(aquariumPostIndex, instanceTransform.matrix);
      aquariumPostIndex += 1;
    }
  }
  aquariumPosts.instanceMatrix.needsUpdate = true;
  aquarium.add(aquariumPosts);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.62, 0.48, 4), material(0xb95d47, 0.9));
  roof.rotation.y = Math.PI / 4;
  roof.scale.z = 0.68;
  roof.position.y = 1.65;
  roof.castShadow = true;
  aquarium.add(roof);
  const sign = makeLabelSprite('섬 수족관', '#f0b66a', 360);
  sign.position.set(0, 2.08, 0);
  sign.scale.set(2.8, 0.86, 1);
  aquarium.add(sign);

  const aquariumFish = FISH_CATALOG.map((fish, index) => {
    const swimmer = createLowPolyFish(fish.color, 0.26 + (index % 2) * 0.035);
    swimmer.visible = false;
    swimmer.userData.base = new THREE.Vector3(
      -0.82 + (index % 4) * 0.54,
      0.62 + Math.floor(index / 4) * 0.23,
      -0.27 + (index % 3) * 0.27,
    );
    swimmer.position.copy(swimmer.userData.base);
    aquarium.add(swimmer);
    return swimmer;
  });

  const dockMarker = makeLabelSprite('귀항 · E 보관', '#8ed5aa', 430);
  dockMarker.position.copy(DOCK_POSITION).setY(waterLevel + 1.45);
  dockMarker.scale.set(3.8, 0.98, 1);
  facilityRoot.add(dockMarker);

  return { root: facilityRoot, aquarium, aquariumWater: water, aquariumFish, dockMarker };
}

function weightedChoice(items) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item.value;
  }
  return items.at(-1).value;
}

function fishSpriteStyle(fish) {
  const x = fish.col === 0 ? 0 : (fish.col / 3) * 100;
  const y = fish.row === 0 ? 0 : (fish.row / 2) * 100;
  return `--fish-x:${x}%;--fish-y:${y}%`;
}

export function createFishingGame({
  scene,
  boatRoot,
  boatFloat,
  boatState,
  waterLevel,
  waveHeightAt,
  setNavigationState,
}) {
  const elements = {
    cargoCount: document.querySelector('#cargo-count'),
    cargoSlots: document.querySelector('#cargo-slots'),
    zoneValue: document.querySelector('#zone-value'),
    aquariumCount: document.querySelector('#aquarium-count'),
    actionPanel: document.querySelector('#fishing-action'),
    actionTitle: document.querySelector('#fishing-action-title'),
    actionHint: document.querySelector('#fishing-action-hint'),
    actionButton: document.querySelector('#fishing-button'),
    actionProgress: document.querySelector('#fishing-progress'),
    fightMeter: document.querySelector('#fishing-fight-meter'),
    tensionLabel: document.querySelector('#fishing-tension-label'),
    tensionFill: document.querySelector('#fishing-tension-fill'),
    tensionNeedle: document.querySelector('#fishing-tension-needle'),
    reelFill: document.querySelector('#fishing-reel-fill'),
    dockButton: document.querySelector('#dock-button'),
    journalButton: document.querySelector('#journal-button'),
    aquariumDialog: document.querySelector('#aquarium-dialog'),
    aquariumGrid: document.querySelector('#aquarium-grid'),
    aquariumSummary: document.querySelector('#aquarium-summary'),
    aquariumClose: document.querySelector('#aquarium-close'),
    catchReveal: document.querySelector('#catch-reveal'),
    catchFish: document.querySelector('#catch-fish'),
    catchTier: document.querySelector('#catch-tier'),
    catchName: document.querySelector('#catch-name'),
    catchWeight: document.querySelector('#catch-weight'),
  };

  const storedAquarium = (() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('lighthouse-fishing-aquarium-v1') || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  })();

  const state = {
    phase: 'sailing',
    phaseTimer: 0,
    phaseDuration: 1,
    cargo: [],
    aquarium: storedAquarium,
    nearestSpot: null,
    nearDock: false,
    pendingFish: null,
    lastCatch: null,
    uiSignature: '',
    environmentTimer: 0,
    revealTimer: 0,
    actionHeld: false,
    castTargetLocal: new THREE.Vector3(2.8, 0, 1.1),
    castOriginWorld: new THREE.Vector3(),
    castSplashPlayed: false,
    reelProgress: 0,
    tension: 0.36,
    fishPull: 0,
    fightElapsed: 0,
    surgeTimer: 0,
    surgeRemaining: 0,
    surgeDuration: 1,
    surgeStrength: 0,
    surgeVisual: 0,
    surgeDirection: 1,
    snapTimer: 0,
    slackTimer: 0,
    reelSoundTimer: 0,
    feedbackPulse: 0,
  };

  const audio = createFishingAudio();
  const angler = createAngler();
  const crate = createFishCrate();
  boatFloat.add(angler.root, crate.root);

  const lineGeometry = new THREE.BufferGeometry();
  const linePositions = new Float32Array(15);
  lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
  const fishingLine = new THREE.Line(
    lineGeometry,
    new THREE.LineBasicMaterial({ color: 0xe9e0c5, transparent: true, opacity: 0.86 }),
  );
  fishingLine.frustumCulled = false;
  fishingLine.visible = false;
  scene.add(fishingLine);
  const bobber = new THREE.Mesh(
    new THREE.SphereGeometry(0.075, 8, 6),
    [material(0xf2e4c7, 0.62), material(0xe25d43, 0.62)],
  );
  bobber.visible = false;
  scene.add(bobber);

  const hookedFishVisual = createLowPolyFish(0xffa13d, 0.72);
  hookedFishVisual.name = 'GEO-threejs-hooked-fish';
  hookedFishVisual.visible = false;
  scene.add(hookedFishVisual);
  let hookedFishVisualId = null;

  function prepareHookedFishVisual(catchItem) {
    const fish = FISH_BY_ID.get(catchItem?.fishId);
    if (!fish) return;
    if (hookedFishVisualId !== fish.id) {
      hookedFishVisual.traverse((child) => {
        if (child.isMesh) child.material.color.setHex(fish.color);
      });
      hookedFishVisualId = fish.id;
    }
    const weightRatio = THREE.MathUtils.clamp((catchItem.kg - fish.minKg) / Math.max(0.01, fish.maxKg - fish.minKg), 0, 1);
    const tierScale = { common: 0.58, uncommon: 0.68, rare: 0.8, legendary: 0.94 }[fish.tier];
    hookedFishVisual.scale.setScalar(tierScale * THREE.MathUtils.lerp(0.88, 1.12, weightRatio));
  }

  const SPLASH_COUNT = 48;
  const splashPositions = new Float32Array(SPLASH_COUNT * 3);
  splashPositions.fill(-20);
  const splashGeometry = new THREE.BufferGeometry();
  splashGeometry.setAttribute('position', new THREE.BufferAttribute(splashPositions, 3));
  const splashPoints = new THREE.Points(
    splashGeometry,
    new THREE.PointsMaterial({
      color: 0xeafff6,
      size: 0.095,
      transparent: true,
      opacity: 0.84,
      depthWrite: false,
      sizeAttenuation: true,
    }),
  );
  splashPoints.frustumCulled = false;
  scene.add(splashPoints);
  const splashParticles = Array.from({ length: SPLASH_COUNT }, () => ({
    position: new THREE.Vector3(0, -20, 0),
    velocity: new THREE.Vector3(),
    life: 0,
  }));
  let splashCursor = 0;

  function spawnSplash(origin, strength = 1, count = 14) {
    if (!origin) return;
    for (let index = 0; index < count; index += 1) {
      const particle = splashParticles[splashCursor];
      splashCursor = (splashCursor + 1) % SPLASH_COUNT;
      const angle = Math.random() * Math.PI * 2;
      const spread = (0.16 + Math.random() * 0.34) * strength;
      particle.position.copy(origin);
      particle.velocity.set(
        Math.cos(angle) * spread,
        (0.42 + Math.random() * 0.62) * strength,
        Math.sin(angle) * spread,
      );
      particle.life = 0.48 + Math.random() * 0.35;
    }
  }

  function updateSplashes(delta) {
    splashParticles.forEach((particle, index) => {
      if (particle.life > 0) {
        particle.life -= delta;
        particle.velocity.y -= 2.35 * delta;
        particle.position.addScaledVector(particle.velocity, delta);
      } else {
        particle.position.set(0, -20, 0);
      }
      const offset = index * 3;
      splashPositions[offset] = particle.position.x;
      splashPositions[offset + 1] = particle.position.y;
      splashPositions[offset + 2] = particle.position.z;
    });
    splashGeometry.attributes.position.needsUpdate = true;
  }

  const spots = SPOT_DEFINITIONS.map((definition) => {
    const spot = createFishingSpot(definition, waterLevel);
    scene.add(spot.root);
    return spot;
  });
  const facilities = createIslandFacilities(scene, waterLevel);

  function saveAquarium() {
    localStorage.setItem('lighthouse-fishing-aquarium-v1', JSON.stringify(state.aquarium));
  }

  function aquariumTotals() {
    const entries = Object.values(state.aquarium);
    return {
      species: entries.filter((entry) => entry.count > 0).length,
      total: entries.reduce((sum, entry) => sum + (entry.count || 0), 0),
    };
  }

  function renderAquarium() {
    const totals = aquariumTotals();
    elements.aquariumSummary.textContent = `발견 ${totals.species} / ${FISH_CATALOG.length}종 · 보관 ${totals.total}마리`;
    elements.aquariumGrid.innerHTML = FISH_CATALOG.map((fish) => {
      const record = state.aquarium[fish.id];
      const discovered = Boolean(record?.count);
      const meta = TIER_META[fish.tier];
      return `<article class="aquarium-entry${discovered ? '' : ' is-locked'}" data-tier="${fish.tier}">
        <span class="fish-sprite" style="${fishSpriteStyle(fish)}" aria-hidden="true"></span>
        <div>
          <span class="tier-label">${discovered ? meta.label : '미발견'}</span>
          <strong>${discovered ? fish.name : '???'}</strong>
          <small>${discovered ? `${record.count}마리 · 최고 ${record.bestKg.toFixed(2)} kg` : '바다에서 발견하세요'}</small>
        </div>
      </article>`;
    }).join('');
    elements.aquariumCount.textContent = `${totals.species} / ${FISH_CATALOG.length}`;
    facilities.aquariumFish.forEach((swimmer, index) => {
      swimmer.visible = Boolean(state.aquarium[FISH_CATALOG[index].id]?.count);
    });
  }

  function renderCargo() {
    elements.cargoCount.textContent = `${state.cargo.length} / ${CARGO_CAPACITY}`;
    elements.cargoSlots.innerHTML = Array.from({ length: CARGO_CAPACITY }, (_, index) => {
      const catchItem = state.cargo[index];
      if (!catchItem) return '<span class="cargo-slot is-empty" aria-label="빈 어창 칸"></span>';
      const fish = FISH_BY_ID.get(catchItem.fishId);
      return `<span class="cargo-slot" data-tier="${fish.tier}" title="${fish.name} ${catchItem.kg.toFixed(2)} kg" aria-label="${fish.name}">
        <span class="fish-sprite" style="${fishSpriteStyle(fish)}" aria-hidden="true"></span>
      </span>`;
    }).join('');
    crate.fill.scale.y = THREE.MathUtils.lerp(0.2, 1, state.cargo.length / CARGO_CAPACITY);
    crate.fill.material.opacity = 0.16 + state.cargo.length * 0.055;
  }

  function openAquarium() {
    renderAquarium();
    if (!elements.aquariumDialog.open) elements.aquariumDialog.showModal();
  }

  function closeAquarium() {
    if (elements.aquariumDialog.open) elements.aquariumDialog.close();
  }

  function chooseFish(spot) {
    const tiers = ['common', 'uncommon', 'rare', 'legendary'];
    const tier = weightedChoice(tiers.map((value, index) => ({ value, weight: spot.weights[index] })));
    const candidates = FISH_CATALOG.filter((fish) => fish.tier === tier);
    const fish = candidates[Math.floor(Math.random() * candidates.length)];
    const kg = THREE.MathUtils.lerp(fish.minKg, fish.maxKg, Math.pow(Math.random(), 0.68));
    return { fishId: fish.id, kg };
  }

  function setPhase(phase, duration = 1) {
    state.phase = phase;
    state.phaseTimer = duration;
    state.phaseDuration = Math.max(duration, 0.001);
    state.uiSignature = '';
  }

  function castTargetWorld(waterTime, elapsed = 0) {
    const localTarget = state.castTargetLocal.clone();
    if (state.phase === 'reeling') {
      localTarget.x += state.surgeDirection * state.fishPull * 0.78;
      localTarget.z += Math.sin(elapsed * 2.7 + state.fightElapsed) * state.fishPull * 0.38;
    }
    boatFloat.updateWorldMatrix(true, false);
    const target = boatFloat.localToWorld(localTarget);
    const biteDip = state.phase === 'bite'
      ? -0.16 + Math.sin(elapsed * 21) * 0.075
      : state.phase === 'reeling'
        ? -0.025 - state.fishPull * 0.075 + Math.sin(elapsed * 8.5) * state.fishPull * 0.028
        : Math.sin(elapsed * 3.2) * 0.025;
    target.y = waterLevel + waveHeightAt(target.x, target.z, waterTime) + 0.07 + biteDip;
    return target;
  }

  function startCast() {
    if (!state.nearestSpot || state.cargo.length >= CARGO_CAPACITY) return;
    audio.ensure();
    boatState.speed = 0;
    state.pendingFish = null;
    state.castTargetLocal.set(2.62 + Math.random() * 0.48, 0, 0.72 + Math.random() * 0.82);
    state.castSplashPlayed = false;
    state.feedbackPulse = 0.34;
    setPhase('casting', 1.28);
    audio.cast();
    setNavigationState(`${state.nearestSpot.name} · 낚싯대를 뒤로 젖혀 캐스팅합니다`, 'ready');
  }

  function landCast(waterTime) {
    const landingPoint = castTargetWorld(waterTime);
    bobber.position.copy(landingPoint);
    if (!state.castSplashPlayed) {
      spawnSplash(landingPoint, 1, 18);
      audio.splash(0.9);
      state.castSplashPlayed = true;
      state.feedbackPulse = Math.max(state.feedbackPulse, 0.28);
    }
  }

  function loseFish(message) {
    state.actionHeld = false;
    state.pendingFish = null;
    state.fishPull = 0;
    state.surgeVisual = 0;
    state.feedbackPulse = Math.max(state.feedbackPulse, 0.8);
    setPhase('sailing', 0);
    audio.fail();
    setNavigationState(message, 'warning');
  }

  function startFishFight() {
    if (state.phase !== 'bite') return;
    const fish = FISH_BY_ID.get(state.pendingFish?.fishId);
    if (!fish) {
      loseFish('바늘에서 물고기가 빠져나갔습니다');
      return;
    }
    const profile = FIGHT_PROFILES[fish.tier];
    state.actionHeld = true;
    state.reelProgress = 0.045;
    state.tension = 0.38;
    state.fishPull = profile.pull;
    state.fightElapsed = 0;
    state.surgeTimer = 0.7 + Math.random() * 0.65;
    state.surgeRemaining = 0;
    state.surgeStrength = 0;
    state.surgeVisual = 0;
    state.snapTimer = 0;
    state.slackTimer = 0;
    state.reelSoundTimer = 0;
    state.feedbackPulse = 1;
    setPhase('reeling', profile.maxTime);
    audio.hook();
    setNavigationState(`${TIER_META[fish.tier].label} ${fish.name} 챔질 성공 · SPACE를 누르고 떼며 장력을 조절하세요`, fish.tier === 'legendary' ? 'warning' : 'ready');
  }

  function setReelHeld(held) {
    state.actionHeld = state.phase === 'reeling' && Boolean(held);
    elements.actionButton.classList.toggle('is-held', state.phase === 'reeling' && state.actionHeld);
  }

  function updateFishFight(delta, elapsed) {
    const catchItem = state.pendingFish;
    const fish = FISH_BY_ID.get(catchItem?.fishId);
    if (!catchItem || !fish) {
      loseFish('낚싯줄 끝에서 물고기가 사라졌습니다');
      return;
    }
    const profile = FIGHT_PROFILES[fish.tier];
    const weightRatio = THREE.MathUtils.clamp((catchItem.kg - fish.minKg) / Math.max(0.01, fish.maxKg - fish.minKg), 0, 1);
    const weightStrength = THREE.MathUtils.lerp(0.9, 1.13, weightRatio);
    state.fightElapsed += delta;
    state.surgeTimer -= delta;
    state.reelSoundTimer -= delta;

    if (state.surgeTimer <= 0 && state.surgeRemaining <= 0) {
      state.surgeDuration = (0.5 + Math.random() * 0.48) * (0.92 + profile.pull * 0.4);
      state.surgeRemaining = state.surgeDuration;
      state.surgeStrength = profile.surge * (0.82 + Math.random() * 0.34) * weightStrength;
      state.surgeDirection = Math.random() < 0.5 ? -1 : 1;
      state.surgeTimer = Math.max(0.8, 1.65 + Math.random() * 1.2 - profile.pull * 0.52);
      state.feedbackPulse = Math.max(state.feedbackPulse, 0.72 + state.surgeStrength * 0.25);
      spawnSplash(bobber.position, 0.72 + state.surgeStrength * 0.35, 8);
      audio.surge(state.surgeStrength);
    }

    let surgeEnvelope = 0;
    if (state.surgeRemaining > 0) {
      state.surgeRemaining = Math.max(0, state.surgeRemaining - delta);
      const surgeProgress = 1 - state.surgeRemaining / Math.max(0.001, state.surgeDuration);
      surgeEnvelope = Math.sin(surgeProgress * Math.PI);
    }
    state.surgeVisual = surgeEnvelope;
    const swimmingPulse = 0.72 + Math.sin(elapsed * (2.2 + profile.pull * 1.8) + weightRatio * 4.3) * 0.16;
    state.fishPull = THREE.MathUtils.clamp(
      profile.pull * swimmingPulse * weightStrength + state.surgeStrength * surgeEnvelope,
      0.08,
      1.24,
    );

    const tensionVelocity = state.actionHeld
      ? 0.27 + state.fishPull * 0.39
      : -0.44 + state.fishPull * 0.16;
    state.tension = THREE.MathUtils.clamp(state.tension + tensionVelocity * delta, 0, 1.08);
    const safeLow = THREE.MathUtils.smoothstep(state.tension, 0.16, 0.33);
    const safeHigh = 1 - THREE.MathUtils.smoothstep(state.tension, 0.72, 0.94);
    const safeTension = safeLow * safeHigh;

    if (state.actionHeld) {
      const pullPenalty = 1 - THREE.MathUtils.clamp(state.fishPull * 0.18, 0, 0.28);
      state.reelProgress += profile.reelRate * (0.38 + safeTension * 0.86) * pullPenalty * delta;
      if (state.reelSoundTimer <= 0) {
        audio.reel(state.tension);
        state.reelSoundTimer = THREE.MathUtils.lerp(0.13, 0.072, safeTension);
      }
    } else {
      state.reelProgress -= profile.retreat * (0.45 + state.fishPull) * delta;
    }
    state.reelProgress = THREE.MathUtils.clamp(state.reelProgress, 0, 1);

    if (state.tension > 0.955) state.snapTimer += delta * (0.78 + state.fishPull * 0.44);
    else state.snapTimer = Math.max(0, state.snapTimer - delta * 1.8);
    if (state.tension < 0.055) state.slackTimer += delta;
    else state.slackTimer = Math.max(0, state.slackTimer - delta * 1.5);

    const dangerFeedback = THREE.MathUtils.smoothstep(state.tension, 0.76, 1.02);
    state.feedbackPulse = Math.max(state.feedbackPulse, state.fishPull * 0.24 + dangerFeedback * 0.48);
    if (state.snapTimer >= profile.snapGrace) {
      loseFish('장력이 너무 높아 낚싯줄이 끊어졌습니다 · 붉어지면 SPACE를 놓으세요');
      return;
    }
    if (state.slackTimer >= profile.slackGrace) {
      loseFish('줄이 너무 느슨해져 물고기가 바늘을 털어냈습니다');
      return;
    }
    if (state.phaseTimer <= 0) {
      loseFish('오래 끌려 다니다 물고기를 놓쳤습니다');
      return;
    }
    if (state.reelProgress >= 1) finishCatch();
  }

  function finishCatch() {
    const catchItem = state.pendingFish;
    if (!catchItem) {
      loseFish('물고기가 빠져나갔습니다');
      return;
    }
    state.cargo.push(catchItem);
    state.lastCatch = catchItem;
    state.pendingFish = null;
    state.actionHeld = false;
    state.fishPull = 0;
    renderCargo();
    const fish = FISH_BY_ID.get(catchItem.fishId);
    const meta = TIER_META[fish.tier];
    elements.catchFish.style.cssText = fishSpriteStyle(fish);
    elements.catchReveal.dataset.tier = fish.tier;
    elements.catchTier.textContent = meta.label;
    elements.catchName.textContent = fish.name;
    elements.catchWeight.textContent = `${catchItem.kg.toFixed(2)} kg`;
    elements.catchReveal.classList.add('is-visible');
    state.revealTimer = 2.4;
    state.feedbackPulse = 1.25;
    spawnSplash(bobber.position, 1.2, 22);
    audio.success();
    setPhase('caught', 1.25);
    const fullMessage = state.cargo.length >= CARGO_CAPACITY ? ' · 어창이 가득 찼습니다. 섬으로 귀항하세요' : '';
    setNavigationState(`${meta.label} ${fish.name} ${catchItem.kg.toFixed(2)} kg 포획${fullMessage}`, fish.tier === 'legendary' ? 'warning' : 'ready');
  }

  function primaryAction() {
    audio.ensure();
    if (state.phase === 'bite') {
      startFishFight();
      return;
    }
    if (state.phase === 'waiting') {
      loseFish('너무 일찍 당겼습니다 · 물고기가 달아났어요');
      return;
    }
    if (state.phase === 'reeling') return;
    if (FISHING_PHASES.has(state.phase)) return;
    if (state.cargo.length >= CARGO_CAPACITY) {
      setNavigationState('어창이 가득 찼습니다 · 섬 선착장으로 돌아가세요', 'warning');
      return;
    }
    if (!state.nearestSpot) {
      setNavigationState('빛나는 어장 표식 가까이 이동하세요', 'warning');
      return;
    }
    if (Math.abs(boatState.speed) > 0.72) {
      setNavigationState('낚시하려면 배를 천천히 멈춰주세요', 'warning');
      return;
    }
    startCast();
  }

  function storeCargo() {
    if (!state.nearDock || state.cargo.length === 0 || FISHING_PHASES.has(state.phase)) return;
    const storedCount = state.cargo.length;
    state.cargo.forEach((catchItem) => {
      const existing = state.aquarium[catchItem.fishId] || { count: 0, bestKg: 0 };
      existing.count += 1;
      existing.bestKg = Math.max(existing.bestKg, catchItem.kg);
      state.aquarium[catchItem.fishId] = existing;
    });
    state.cargo.length = 0;
    saveAquarium();
    renderCargo();
    renderAquarium();
    setNavigationState(`${storedCount}마리를 섬 수족관에 안전하게 보관했습니다`, 'ready');
    state.uiSignature = '';
  }

  function updateProximity() {
    let nearest = null;
    let nearestDistance = Infinity;
    spots.forEach((spot) => {
      const distance = Math.hypot(boatRoot.position.x - spot.x, boatRoot.position.z - spot.z);
      if (distance < nearestDistance) {
        nearest = spot;
        nearestDistance = distance;
      }
      spot.label.material.opacity = THREE.MathUtils.clamp(1.08 - distance / 30, 0.28, 0.88);
    });
    state.nearestSpot = nearestDistance <= 5.2 ? nearest : null;
    state.nearDock = boatRoot.position.distanceTo(DOCK_POSITION) <= 4.2;
    const zoneText = state.nearDock ? '섬 선착장' : state.nearestSpot?.name || '이동 중';
    elements.zoneValue.textContent = zoneText;
  }

  function actionCopy() {
    if (state.phase === 'casting') return ['낚싯대를 휘두르는 중', '뒤로 젖힌 뒤 목표 지점으로 힘껏 던집니다', true, 'SPACE'];
    if (state.phase === 'waiting') return ['입질을 기다리는 중', '찌가 크게 잠기면 당기세요', true, 'SPACE'];
    if (state.phase === 'bite') return ['입질! 지금 챔질하세요!', '놓치기 전에 SPACE를 누르세요', false, 'SPACE'];
    if (state.phase === 'reeling') {
      const fish = FISH_BY_ID.get(state.pendingFish?.fishId);
      const title = fish ? `${TIER_META[fish.tier].label} ${fish.name}와 힘겨루기` : '물고기와 힘겨루기';
      if (state.tension > 0.78) return [title, '장력 위험 · SPACE를 놓아 줄을 풀어주세요', false, 'SPACE'];
      if (state.tension < 0.22) return [title, '줄이 느슨합니다 · SPACE를 눌러 감으세요', false, 'SPACE'];
      return [title, state.actionHeld ? '안전 구간 · 리듬을 유지하며 감으세요' : '물고기가 지쳤습니다 · 지금 감으세요', false, 'SPACE'];
    }
    if (state.phase === 'caught') return ['물고기를 어창에 담았습니다', '다음 어획을 준비하세요', false, 'SPACE'];
    if (state.cargo.length >= CARGO_CAPACITY) return ['어창이 가득 찼습니다', '섬 선착장으로 귀항해 보관하세요', true, 'SPACE'];
    if (state.nearestSpot && Math.abs(boatState.speed) <= 0.72) return ['낚시 가능한 어장', `${state.nearestSpot.name}에서 줄을 던지세요`, false, 'SPACE'];
    if (state.nearestSpot) return ['배를 천천히 멈추세요', '속도 1.4 kn 이하에서 낚시할 수 있습니다', true, 'SPACE'];
    return ['어장을 찾는 중', '바다의 빛나는 원형 표식으로 이동하세요', true, 'SPACE'];
  }

  function updateHUD() {
    const [title, hint, disabled, key] = actionCopy();
    const signature = [state.phase, state.cargo.length, state.nearestSpot?.id, state.nearDock, disabled, title, hint, state.actionHeld].join('|');
    if (signature === state.uiSignature) return;
    state.uiSignature = signature;
    elements.actionTitle.textContent = title;
    elements.actionHint.textContent = hint;
    elements.actionButton.disabled = disabled;
    elements.actionButton.classList.toggle('is-bite', state.phase === 'bite');
    elements.actionButton.classList.toggle('is-reeling', state.phase === 'reeling');
    elements.actionButton.classList.toggle('is-held', state.phase === 'reeling' && state.actionHeld);
    elements.actionButton.querySelector('.button-key').textContent = key;
    elements.actionButton.querySelector('.action-label').textContent =
      state.phase === 'bite' ? '챔질!' : state.phase === 'reeling' ? (state.actionHeld ? '감는 중' : '줄 감기') : '낚시하기';
    elements.actionPanel.dataset.phase = state.phase;
    elements.fightMeter.hidden = state.phase !== 'reeling';
    elements.dockButton.hidden = !(state.nearDock && state.cargo.length > 0 && !FISHING_PHASES.has(state.phase));
  }

  function updateFightMeter() {
    if (state.phase !== 'reeling') {
      elements.fightMeter.hidden = true;
      return;
    }
    const tension = THREE.MathUtils.clamp(state.tension, 0, 1);
    const tensionState = tension > 0.78 ? 'danger' : tension < 0.22 ? 'slack' : 'stable';
    elements.fightMeter.hidden = false;
    elements.fightMeter.dataset.tension = tensionState;
    elements.fightMeter.style.setProperty('--tension', tension.toFixed(3));
    elements.fightMeter.style.setProperty('--tension-position', `${(tension * 100).toFixed(1)}%`);
    elements.tensionLabel.textContent = tension > 0.92 ? '끊어질 듯!' : tension > 0.78 ? '위험' : tension < 0.12 ? '빠질 듯!' : tension < 0.22 ? '느슨함' : '안정';
    elements.reelFill.style.transform = `scaleX(${state.reelProgress.toFixed(3)})`;
  }

  const animationAxisZ = new THREE.Vector3(0, 0, 1);
  const animationQuaternion = new THREE.Quaternion();
  const rodTipWorld = new THREE.Vector3();
  const linePoint = new THREE.Vector3();
  const lineColorNormal = new THREE.Color(0xe9e0c5);
  const lineColorDanger = new THREE.Color(0xff7765);

  function updateAnglerAnimation(delta, elapsed) {
    let rodTarget = -1.02;
    let bodyYaw = -0.12;
    let bodyRoll = 0;
    let bodyHeight = 0.12;
    let headYaw = 0;
    let armSwing = 0;

    if (state.phase === 'casting') {
      const progress = THREE.MathUtils.clamp(1 - state.phaseTimer / state.phaseDuration, 0, 1);
      if (progress < 0.3) {
        const windup = easeInOutCubic(progress / 0.3);
        rodTarget = THREE.MathUtils.lerp(-1.02, -2.04, windup);
        bodyYaw = THREE.MathUtils.lerp(-0.12, -0.58, windup);
        bodyRoll = THREE.MathUtils.lerp(0, 0.11, windup);
        armSwing = -0.28 * windup;
      } else if (progress < 0.62) {
        const swing = easeInOutCubic((progress - 0.3) / 0.32);
        rodTarget = THREE.MathUtils.lerp(-2.04, -0.46, swing);
        bodyYaw = THREE.MathUtils.lerp(-0.58, 0.24, swing);
        bodyRoll = THREE.MathUtils.lerp(0.11, -0.08, swing);
        armSwing = THREE.MathUtils.lerp(-0.28, 0.34, swing);
      } else {
        const settle = easeInOutCubic((progress - 0.62) / 0.38);
        rodTarget = THREE.MathUtils.lerp(-0.46, -0.96, settle);
        bodyYaw = THREE.MathUtils.lerp(0.24, -0.12, settle);
        bodyRoll = THREE.MathUtils.lerp(-0.08, 0, settle);
        armSwing = THREE.MathUtils.lerp(0.34, 0, settle);
      }
    } else if (state.phase === 'bite') {
      rodTarget = -0.88 + Math.sin(elapsed * 22) * 0.07;
      bodyRoll = Math.sin(elapsed * 18) * 0.025;
      headYaw = Math.sin(elapsed * 5) * 0.08;
    } else if (state.phase === 'reeling') {
      const reelCycle = state.actionHeld ? Math.sin(elapsed * 13.5) : 0;
      rodTarget = -0.96 + state.tension * 0.47 + state.fishPull * 0.08 + reelCycle * 0.025;
      bodyYaw = -0.12 + state.surgeDirection * state.fishPull * 0.13;
      bodyRoll = -state.surgeDirection * state.fishPull * 0.055 + reelCycle * 0.018;
      bodyHeight = 0.12 - state.fishPull * 0.025;
      headYaw = state.surgeDirection * 0.12;
      armSwing = state.actionHeld ? 0.12 + reelCycle * 0.18 : -0.06;
      boatFloat.rotation.z += state.surgeDirection * state.fishPull * 0.012 + reelCycle * 0.004;
      boatFloat.rotation.x += Math.sin(elapsed * 9.2) * state.fishPull * 0.006;
    } else if (state.phase === 'caught') {
      const celebration = Math.sin((1 - state.phaseTimer / state.phaseDuration) * Math.PI);
      rodTarget = -0.68;
      bodyHeight = 0.12 + celebration * 0.08;
      bodyRoll = -0.045 * celebration;
      armSwing = 0.28 * celebration;
    } else if (state.phase === 'waiting') {
      headYaw = Math.sin(elapsed * 0.8) * 0.08;
      rodTarget = -0.98 + Math.sin(elapsed * 1.1) * 0.012;
    }

    const response = state.phase === 'casting' ? 1 : 1 - Math.exp(-12 * delta);
    angler.rodPivot.rotation.z = THREE.MathUtils.lerp(angler.rodPivot.rotation.z, rodTarget, response);
    angler.root.rotation.y = THREE.MathUtils.lerp(angler.root.rotation.y, bodyYaw, response);
    angler.root.rotation.z = THREE.MathUtils.lerp(angler.root.rotation.z, bodyRoll, response);
    angler.root.position.y = THREE.MathUtils.lerp(angler.root.position.y, bodyHeight, response);
    angler.head.rotation.y = THREE.MathUtils.lerp(angler.head.rotation.y, headYaw, response);
    angler.leftArm.quaternion
      .copy(angler.leftArm.userData.baseQuaternion)
      .multiply(animationQuaternion.setFromAxisAngle(animationAxisZ, armSwing));
    angler.rightArm.quaternion
      .copy(angler.rightArm.userData.baseQuaternion)
      .multiply(animationQuaternion.setFromAxisAngle(animationAxisZ, armSwing * 0.82));

    state.feedbackPulse *= Math.exp(-4.2 * delta);
    boatState.fishingShake = state.phase === 'reeling'
      ? Math.max(state.feedbackPulse, state.fishPull * (0.18 + state.tension * 0.22))
      : state.feedbackPulse;
    boatState.fishingDirection = state.surgeDirection;
  }

  function updateLine(elapsed, waterTime) {
    const visible = FISHING_PHASES.has(state.phase);
    const castProgress = state.phase === 'casting'
      ? THREE.MathUtils.clamp(1 - state.phaseTimer / state.phaseDuration, 0, 1)
      : 1;
    fishingLine.visible = visible && (state.phase !== 'casting' || castProgress > 0.18);
    bobber.visible = fishingLine.visible;
    angler.rodPivot.visible = true;
    if (!visible) return;

    angler.rodTip.getWorldPosition(rodTipWorld);
    const landingTarget = castTargetWorld(waterTime, elapsed);
    let bobberWorld = landingTarget;
    if (state.phase === 'casting') {
      const releasePoint = 0.34;
      if (castProgress <= releasePoint) {
        state.castOriginWorld.copy(rodTipWorld);
        bobberWorld = rodTipWorld.clone();
      } else {
        const flight = THREE.MathUtils.clamp((castProgress - releasePoint) / (1 - releasePoint), 0, 1);
        const flightEase = easeInOutCubic(flight);
        bobberWorld = state.castOriginWorld.clone().lerp(landingTarget, flightEase);
        bobberWorld.y += Math.sin(flight * Math.PI) * 1.62;
      }
    }
    bobber.position.copy(bobberWorld);
    bobber.rotation.z = state.phase === 'reeling' ? Math.sin(elapsed * 16) * state.fishPull * 0.18 : 0;
    const sag = state.phase === 'reeling' ? 0.025 : state.phase === 'bite' ? 0.07 : state.phase === 'casting' ? 0.09 : 0.23;
    const vibration = state.phase === 'reeling' ? state.fishPull * (0.012 + state.tension * 0.018) : 0;
    for (let index = 0; index < 5; index += 1) {
      const progress = index / 4;
      linePoint.lerpVectors(rodTipWorld, bobberWorld, progress);
      linePoint.y -= Math.sin(progress * Math.PI) * sag;
      linePoint.x += Math.sin(elapsed * 31 + progress * 17) * vibration * Math.sin(progress * Math.PI);
      linePoint.z += Math.cos(elapsed * 27 + progress * 13) * vibration * Math.sin(progress * Math.PI);
      const point = linePoint;
      linePositions[index * 3] = point.x;
      linePositions[index * 3 + 1] = point.y;
      linePositions[index * 3 + 2] = point.z;
    }
    const dangerMix = state.phase === 'reeling' ? THREE.MathUtils.smoothstep(state.tension, 0.7, 1) : 0;
    fishingLine.material.color.lerpColors(lineColorNormal, lineColorDanger, dangerMix);
    lineGeometry.attributes.position.needsUpdate = true;
  }

  function updateHookedFishVisual(elapsed) {
    const catchItem = state.phase === 'caught' ? state.lastCatch : state.pendingFish;
    const visible = Boolean(catchItem) && ['bite', 'reeling', 'caught'].includes(state.phase);
    hookedFishVisual.visible = visible;
    if (!visible) return;
    prepareHookedFishVisual(catchItem);
    hookedFishVisual.position.copy(bobber.position);
    if (state.phase === 'caught') {
      const catchProgress = THREE.MathUtils.clamp(1 - state.phaseTimer / state.phaseDuration, 0, 1);
      hookedFishVisual.position.y += 0.16 + Math.sin(catchProgress * Math.PI) * 1.15;
      hookedFishVisual.position.x += state.surgeDirection * catchProgress * 0.32;
      hookedFishVisual.rotation.set(0, state.surgeDirection > 0 ? 0 : Math.PI, Math.sin(catchProgress * Math.PI) * -0.72);
    } else {
      hookedFishVisual.position.x += state.surgeDirection * (0.18 + state.fishPull * 0.34);
      hookedFishVisual.position.z += Math.sin(elapsed * 4.7) * (0.12 + state.fishPull * 0.18);
      hookedFishVisual.position.y -= 0.2 + state.fishPull * 0.12 - state.surgeVisual * 0.36 - Math.sin(elapsed * 7.2) * 0.055;
      hookedFishVisual.rotation.set(0, state.surgeDirection > 0 ? 0 : Math.PI, Math.sin(elapsed * 8.5) * 0.12);
    }
  }

  function updateWorldVisuals(delta, elapsed, waterTime) {
    spots.forEach((spot, spotIndex) => {
      const wave = waveHeightAt(spot.x, spot.z, waterTime);
      spot.root.position.y = waterLevel + wave + 0.025;
      spot.outerRing.rotation.z += delta * (0.08 + spotIndex * 0.012);
      spot.innerRing.rotation.z -= delta * (0.11 + spotIndex * 0.01);
      spot.buoy.position.y = Math.sin(elapsed * 1.7 + spotIndex) * 0.055;
      const isActiveFishingSpot = spot === state.nearestSpot && FISHING_PHASES.has(state.phase);
      spot.label.visible = !isActiveFishingSpot;
      spot.fish.forEach((swimmer, fishIndex) => {
        const angle = swimmer.userData.angle + elapsed * swimmer.userData.speed;
        swimmer.position.x = Math.cos(angle) * swimmer.userData.radius;
        swimmer.position.z = Math.sin(angle) * swimmer.userData.radius;
        swimmer.rotation.y = -angle;
        swimmer.position.y = -0.6 + Math.sin(elapsed * 1.2 + fishIndex) * 0.12;
      });
    });
    facilities.aquariumWater.material.opacity = 0.44 + Math.sin(elapsed * 1.1) * 0.035;
    facilities.aquariumFish.forEach((swimmer, index) => {
      if (!swimmer.visible) return;
      const base = swimmer.userData.base;
      swimmer.position.x = base.x + Math.sin(elapsed * (0.45 + index * 0.012) + index) * 0.16;
      swimmer.position.y = base.y + Math.sin(elapsed * 0.7 + index * 0.8) * 0.055;
      swimmer.rotation.y = Math.cos(elapsed * 0.34 + index) > 0 ? 0 : Math.PI;
    });
    const dockDistance = boatRoot.position.distanceTo(DOCK_POSITION);
    const nearDockFade = THREE.MathUtils.smoothstep(dockDistance, 3.2, 7.5);
    facilities.dockMarker.material.opacity =
      THREE.MathUtils.clamp(1.12 - dockDistance / 24, 0.22, 0.9) * nearDockFade;
  }

  function update(delta, elapsed, waterTime) {
    state.environmentTimer -= delta;
    if (state.environmentTimer <= 0) {
      updateProximity();
      updateHUD();
      state.environmentTimer = 0.12;
    }

    if (FISHING_PHASES.has(state.phase)) {
      boatState.speed *= Math.exp(-7.5 * delta);
      state.phaseTimer -= delta;
      if (state.phase === 'casting' && state.phaseTimer <= 0) {
        landCast(waterTime);
        setPhase('waiting', 2.2 + Math.random() * 2.6);
        setNavigationState('찌를 바라보며 입질을 기다리세요', 'ready');
      } else if (state.phase === 'waiting' && state.phaseTimer <= 0) {
        state.pendingFish = chooseFish(state.nearestSpot || spots[0]);
        const fish = FISH_BY_ID.get(state.pendingFish.fishId);
        const reactionWindow = THREE.MathUtils.lerp(1.5, 1.18, FIGHT_PROFILES[fish.tier].pull);
        setPhase('bite', reactionWindow);
        spawnSplash(bobber.position, 0.82 + FIGHT_PROFILES[fish.tier].pull * 0.35, 16);
        state.feedbackPulse = 1;
        audio.bite();
        setNavigationState('입질! 지금 SPACE 또는 낚시 버튼을 누르세요', 'warning');
      } else if (state.phase === 'bite' && state.phaseTimer <= 0) {
        loseFish('입질을 놓쳤습니다 · 다시 시도해보세요');
      } else if (state.phase === 'reeling') {
        updateFishFight(delta, elapsed);
      } else if (state.phase === 'caught' && state.phaseTimer <= 0) {
        setPhase('sailing', 0);
      }
      const progress = state.phase === 'reeling'
        ? state.reelProgress
        : 1 - Math.max(0, state.phaseTimer) / state.phaseDuration;
      elements.actionProgress.style.transform = `scaleX(${THREE.MathUtils.clamp(progress, 0, 1)})`;
    } else {
      elements.actionProgress.style.transform = 'scaleX(0)';
    }

    if (state.revealTimer > 0) {
      state.revealTimer -= delta;
      if (state.revealTimer <= 0) elements.catchReveal.classList.remove('is-visible');
    }
    updateAnglerAnimation(delta, elapsed);
    updateLine(elapsed, waterTime);
    updateHookedFishVisual(elapsed);
    updateSplashes(delta);
    updateWorldVisuals(delta, elapsed, waterTime);
    updateFightMeter();
    updateHUD();
  }

  function cancelFishing() {
    if (!FISHING_PHASES.has(state.phase)) return;
    state.pendingFish = null;
    state.actionHeld = false;
    state.fishPull = 0;
    boatState.fishingShake = 0;
    setPhase('sailing', 0);
    fishingLine.visible = false;
    bobber.visible = false;
  }

  function resetTripPosition() {
    cancelFishing();
    state.uiSignature = '';
    updateProximity();
    updateHUD();
  }

  const pressFishingAction = (event) => {
    if (elements.actionButton.disabled) return;
    event.preventDefault();
    elements.actionButton.setPointerCapture?.(event.pointerId);
    primaryAction();
    setReelHeld(true);
  };
  const releaseFishingAction = (event) => {
    event.preventDefault();
    setReelHeld(false);
  };
  elements.actionButton.addEventListener('pointerdown', pressFishingAction);
  elements.actionButton.addEventListener('pointerup', releaseFishingAction);
  elements.actionButton.addEventListener('pointercancel', releaseFishingAction);
  elements.actionButton.addEventListener('lostpointercapture', releaseFishingAction);
  elements.actionButton.addEventListener('click', (event) => {
    if (event.detail === 0) {
      primaryAction();
      if (state.phase === 'reeling') {
        setReelHeld(true);
        window.setTimeout(() => setReelHeld(false), 140);
      }
    }
  });
  elements.dockButton.addEventListener('click', storeCargo);
  elements.journalButton.addEventListener('click', openAquarium);
  elements.aquariumClose.addEventListener('click', closeAquarium);
  elements.aquariumDialog.addEventListener('click', (event) => {
    if (event.target === elements.aquariumDialog) closeAquarium();
  });

  renderCargo();
  renderAquarium();
  updateProximity();
  updateHUD();

  const api = {
    update,
    primaryAction,
    setReelHeld,
    storeCargo,
    openAquarium,
    closeAquarium,
    resetTripPosition,
    reflectionExclusions: [fishingLine, bobber, hookedFishVisual, splashPoints, ...spots.map((spot) => spot.root)],
    get navigationLocked() {
      return FISHING_PHASES.has(state.phase);
    },
    getState() {
      const hookedFish = FISH_BY_ID.get(state.pendingFish?.fishId);
      return {
        phase: state.phase,
        cargo: state.cargo.map((item) => ({ ...item })),
        aquarium: JSON.parse(JSON.stringify(state.aquarium)),
        nearestSpot: state.nearestSpot?.id || null,
        nearDock: state.nearDock,
        hookedFish: hookedFish ? { id: hookedFish.id, name: hookedFish.name, tier: hookedFish.tier, kg: state.pendingFish.kg } : null,
        tension: state.tension,
        reelProgress: state.reelProgress,
        fishPull: state.fishPull,
        actionHeld: state.actionHeld,
        timeRemaining: state.phaseTimer,
        animation: {
          rodRotation: angler.rodPivot.rotation.z,
          bodyYaw: angler.root.rotation.y,
          bodyRoll: angler.root.rotation.z,
          lineVisible: fishingLine.visible,
          bobber: bobber.position.toArray(),
        },
      };
    },
    teleportToSpot(id = 'shoal') {
      const spot = spots.find((candidate) => candidate.id === id) || spots[0];
      cancelFishing();
      boatState.speed = 0;
      boatRoot.position.set(spot.x - 2.6, boatRoot.position.y, spot.z - 0.4);
      updateProximity();
      updateHUD();
    },
    teleportToDock() {
      cancelFishing();
      boatState.speed = 0;
      boatRoot.position.copy(DOCK_POSITION).add(new THREE.Vector3(-0.8, 0, -0.6));
      updateProximity();
      updateHUD();
    },
    forceBite(tier = null) {
      if (!state.nearestSpot) this.teleportToSpot();
      if (tier && FIGHT_PROFILES[tier]) {
        const fish = FISH_CATALOG.find((candidate) => candidate.tier === tier);
        state.pendingFish = { fishId: fish.id, kg: THREE.MathUtils.lerp(fish.minKg, fish.maxKg, 0.64) };
      } else {
        state.pendingFish = chooseFish(state.nearestSpot || spots[0]);
      }
      prepareHookedFishVisual(state.pendingFish);
      setPhase('bite', 8);
      state.feedbackPulse = 1;
      updateHUD();
    },
    fillCargo() {
      state.cargo = FISH_CATALOG.slice(0, CARGO_CAPACITY).map((fish) => ({ fishId: fish.id, kg: fish.minKg }));
      renderCargo();
      updateHUD();
    },
    clearProgress() {
      state.cargo.length = 0;
      state.aquarium = {};
      saveAquarium();
      renderCargo();
      renderAquarium();
      updateHUD();
    },
  };
  return api;
}
