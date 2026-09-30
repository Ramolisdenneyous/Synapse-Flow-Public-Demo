import { useCallback, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { DragControls } from 'three/addons/controls/DragControls.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { Focus } from 'lucide-react';
import { CHANNEL_COLORS, NODE_KINDS } from '../model/catalog.js';
import {
  edgeArrowSample,
  edgePulseDirection,
  edgePulseProgress,
} from '../three/edgeAnimation3d.js';
import { defaultGraphPositions3d, graphBounds3d } from '../three/graphLayout3d.js';

const NODE_RADIUS = 0.76;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

function hashString(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose?.();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) {
        if (value?.isTexture) value.dispose();
      }
      material.dispose?.();
    }
  });
}

function labelTexture(node, accent) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'rgba(7, 12, 19, 0.78)';
  context.fillRect(4, 4, 504, 120);
  context.strokeStyle = accent;
  context.globalAlpha = 0.72;
  context.lineWidth = 2;
  context.strokeRect(5.5, 5.5, 501, 117);
  context.globalAlpha = 1;
  context.fillStyle = accent;
  context.font = '700 17px Inter, Arial, sans-serif';
  context.textAlign = 'center';
  context.fillText(String(NODE_KINDS[node.data.kind]?.label || node.data.kind).toUpperCase(), 256, 34);
  context.fillStyle = '#f7fbff';
  context.font = '700 25px Inter, Arial, sans-serif';
  const label = String(node.data.label || node.id);
  const clipped = label.length > 34 ? `${label.slice(0, 33)}...` : label;
  context.fillText(clipped, 256, 79, 470);
  context.fillStyle = '#9eb1bc';
  context.font = '600 15px Inter, Arial, sans-serif';
  context.fillText(node.data.status === 'idle' ? 'READY' : String(node.data.status).toUpperCase(), 256, 106);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

function drawNodeGlyph(context, kind) {
  context.lineWidth = 11;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  if (kind === 'trigger') {
    context.moveTo(98, 70);
    context.lineTo(180, 128);
    context.lineTo(98, 186);
    context.closePath();
  } else if (kind === 'agent') {
    context.roundRect(68, 78, 120, 100, 20);
    context.moveTo(128, 78);
    context.lineTo(128, 52);
    context.moveTo(128, 52);
    context.lineTo(148, 38);
    context.moveTo(92, 128);
    context.lineTo(104, 128);
    context.moveTo(152, 128);
    context.lineTo(164, 128);
  } else if (kind === 'user') {
    context.arc(128, 92, 35, 0, Math.PI * 2);
    context.moveTo(63, 196);
    context.quadraticCurveTo(128, 130, 193, 196);
  } else if (kind === 'logic') {
    context.font = '700 124px Consolas, monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('{}', 128, 130);
  } else if (kind === 'governor') {
    context.moveTo(128, 43);
    context.lineTo(194, 72);
    context.lineTo(184, 150);
    context.quadraticCurveTo(164, 190, 128, 211);
    context.quadraticCurveTo(92, 190, 72, 150);
    context.lineTo(62, 72);
    context.closePath();
    context.moveTo(98, 126);
    context.lineTo(120, 148);
    context.lineTo(161, 105);
  } else if (kind === 'search') {
    context.arc(112, 106, 52, 0, Math.PI * 2);
    context.moveTo(150, 144);
    context.lineTo(202, 196);
  } else if (kind === 'tool') {
    context.arc(92, 86, 34, 0.55, 4.05);
    context.moveTo(111, 111);
    context.lineTo(184, 184);
    context.arc(193, 193, 15, 0, Math.PI * 2);
  } else if (kind === 'memory') {
    context.ellipse(128, 67, 66, 27, 0, 0, Math.PI * 2);
    context.moveTo(62, 67);
    context.lineTo(62, 176);
    context.moveTo(194, 67);
    context.lineTo(194, 176);
    context.moveTo(62, 121);
    context.bezierCurveTo(78, 154, 178, 154, 194, 121);
    context.moveTo(62, 176);
    context.bezierCurveTo(78, 209, 178, 209, 194, 176);
  } else {
    context.moveTo(73, 45);
    context.lineTo(73, 210);
    context.moveTo(73, 55);
    context.quadraticCurveTo(140, 32, 188, 76);
    context.quadraticCurveTo(140, 122, 73, 98);
  }
  context.stroke();
}

function glyphTexture(kind, accent) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  const glow = context.createRadialGradient(128, 128, 15, 128, 128, 118);
  glow.addColorStop(0, 'rgba(255,255,255,0.28)');
  glow.addColorStop(0.52, `${accent}38`);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, 256, 256);
  context.strokeStyle = '#07101b';
  context.fillStyle = '#07101b';
  context.shadowColor = accent;
  context.shadowBlur = 9;
  drawNodeGlyph(context, kind);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(64, 64, 2, 64, 64, 63);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.17, 'rgba(255,255,255,0.75)');
  gradient.addColorStop(0.48, 'rgba(255,255,255,0.18)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

function organicGeometry(nodeId) {
  const geometry = mergeVertices(new THREE.IcosahedronGeometry(NODE_RADIUS, 4));
  const positions = geometry.attributes.position;
  const seed = (hashString(nodeId) % 1000) / 1000;
  const vertex = new THREE.Vector3();
  for (let index = 0; index < positions.count; index += 1) {
    vertex.fromBufferAttribute(positions, index);
    const direction = vertex.clone().normalize();
    const wobble =
      1 +
      Math.sin(direction.x * 8.4 + seed * 17) * 0.055 +
      Math.sin(direction.y * 11.2 - seed * 23) * 0.035 +
      Math.cos(direction.z * 7.6 + direction.x * 5.1) * 0.045;
    vertex.multiplyScalar(wobble);
    positions.setXYZ(index, vertex.x, vertex.y, vertex.z);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function neuralCurve(from, to, seed) {
  const delta = new THREE.Vector3().subVectors(to, from);
  const length = Math.max(delta.length(), 0.001);
  const direction = delta.clone().normalize();
  const random = new THREE.Vector3(
    Math.sin(seed * 12.9898),
    Math.cos(seed * 7.233),
    Math.sin(seed * 4.117 + 1.7),
  ).normalize();
  let normal = new THREE.Vector3().crossVectors(direction, random);
  if (normal.lengthSq() < 0.01) normal = new THREE.Vector3(0, 1, 0);
  normal.normalize();
  const secondary = new THREE.Vector3().crossVectors(direction, normal).normalize();
  const bend = Math.min(1.15, length * 0.17);
  const point1 = from.clone().lerp(to, 0.32)
    .addScaledVector(normal, bend)
    .addScaledVector(secondary, bend * 0.28);
  const point2 = from.clone().lerp(to, 0.68)
    .addScaledVector(normal, bend * 0.72)
    .addScaledVector(secondary, -bend * 0.22);
  return new THREE.CatmullRomCurve3([from.clone(), point1, point2, to.clone()], false, 'centripetal');
}

function updateEdgePath(item, source, target) {
  item.curve = neuralCurve(source.position, target.position, item.seed);
  item.tube.geometry.dispose();
  item.halo.geometry.dispose();
  item.tube.geometry = new THREE.TubeGeometry(item.curve, 36, item.active ? 0.065 : 0.046, 8, false);
  item.halo.geometry = new THREE.TubeGeometry(item.curve, 36, item.active ? 0.13 : 0.09, 8, false);
  const arrowSample = edgeArrowSample(item.direction);
  const arrowPoint = item.curve.getPointAt(arrowSample.progress);
  const tangent = item.curve
    .getTangentAt(arrowSample.progress)
    .normalize()
    .multiplyScalar(arrowSample.tangentScale);
  item.arrow.position.copy(arrowPoint);
  item.arrow.quaternion.setFromUnitVectors(Y_AXIS, tangent);
}

function frameCamera(camera, controls, positions) {
  const { center, radius } = graphBounds3d(positions);
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
  const limitingFov = Math.min(verticalFov, horizontalFov);
  const distance = (radius / Math.sin(limitingFov / 2)) * 1.42;
  const direction = new THREE.Vector3(0.18, 0.14, 1).normalize();
  controls.target.set(center.x, center.y, center.z);
  camera.position.set(center.x, center.y, center.z).addScaledVector(direction, distance);
  camera.near = Math.max(0.05, radius / 100);
  camera.far = Math.max(200, radius * 20);
  camera.updateProjectionMatrix();
  controls.update();
}

export default function Graph3DCanvas({
  nodes,
  edges,
  selectedId,
  onSelectNode,
  onClearSelection,
  onMoveNode,
}) {
  const hostRef = useRef(null);
  const runtimeRef = useRef(null);
  const graphSignatureRef = useRef('');

  const resetCamera = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    frameCamera(runtime.camera, runtime.orbit, runtime.positions);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#050914');
    scene.fog = new THREE.FogExp2('#07101d', 0.012);

    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 500);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.domElement.className = 'graph-3d-canvas';
    host.appendChild(renderer.domElement);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.78, 0.5, 0.68);
    composer.addPass(bloom);

    const graphGroup = new THREE.Group();
    scene.add(graphGroup);
    const grid = new THREE.GridHelper(44, 22, '#1d3650', '#0d1d2b');
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -5;
    grid.material.transparent = true;
    grid.material.opacity = 0.44;
    scene.add(grid);
    scene.add(new THREE.HemisphereLight('#b7eaff', '#111329', 1.55));
    const keyLight = new THREE.DirectionalLight('#d8f6ff', 2.2);
    keyLight.position.set(8, 12, 14);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight('#e886ff', 2.1);
    rimLight.position.set(-12, -4, 8);
    scene.add(rimLight);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.075;
    orbit.minDistance = 3;
    orbit.maxDistance = 140;
    orbit.screenSpacePanning = true;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDown = null;
    const selectAtPointer = (event) => {
      if (pointerDown && Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(runtimeRef.current?.nodeMeshes || [], false);
      if (hits[0]?.object.userData.nodeId) onSelectNode(hits[0].object.userData.nodeId);
      else onClearSelection();
    };
    const onPointerDown = (event) => { pointerDown = { x: event.clientX, y: event.clientY }; };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', selectAtPointer);

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      composer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (runtimeRef.current?.positions?.size) {
        frameCamera(camera, orbit, runtimeRef.current.positions);
      }
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    const runtime = {
      scene,
      camera,
      renderer,
      composer,
      orbit,
      graphGroup,
      nodeMeshes: [],
      nodeById: new Map(),
      labels: [],
      edgeObjects: [],
      positions: new Map(),
      drag: null,
      frame: 0,
    };
    runtimeRef.current = runtime;

    const animate = () => {
      runtime.frame = requestAnimationFrame(animate);
      const elapsed = performance.now() / 1000;
      orbit.update();
      for (const item of runtime.edgeObjects) {
        if (!item.pulse || !item.curve) continue;
        const t = edgePulseProgress(elapsed, item.offset, item.direction);
        item.pulse.position.copy(item.curve.getPointAt(t));
        const flare = 0.88 + Math.sin(t * Math.PI) * 0.55;
        item.pulse.scale.setScalar(flare);
      }
      for (const mesh of runtime.nodeMeshes) {
        const active = mesh.userData.status === 'running';
        const selected = mesh.userData.selected;
        if (active) {
          const wave = (Math.sin(elapsed * 8.5) + 1) / 2;
          mesh.scale.setScalar(1.02 + wave * 0.12);
          mesh.material.emissiveIntensity = 1 + wave * 1.15;
          mesh.userData.core.material.opacity = 0.68 + wave * 0.24;
          mesh.userData.aura.material.opacity = 0.25 + wave * 0.24;
          if (mesh.userData.light) mesh.userData.light.intensity = 3.2 + wave * 3.4;
        } else {
          mesh.scale.setScalar(1);
          mesh.material.emissiveIntensity = selected ? 0.46 : 0.2;
          mesh.userData.core.material.opacity = selected ? 0.62 : 0.45;
          mesh.userData.aura.material.opacity = selected ? 0.16 : 0.07;
          if (mesh.userData.light) mesh.userData.light.intensity = selected ? 1.15 : 0;
        }
      }
      for (const { sprite, nodeId } of runtime.labels) {
        const mesh = runtime.nodeById.get(nodeId);
        if (mesh) sprite.position.copy(mesh.position).add(new THREE.Vector3(0, -1.3, 0));
      }
      composer.render();
    };
    animate();

    return () => {
      cancelAnimationFrame(runtime.frame);
      runtime.drag?.dispose();
      orbit.dispose();
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', selectAtPointer);
      disposeObject(graphGroup);
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      runtimeRef.current = null;
    };
  }, [onClearSelection, onSelectNode]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return undefined;
    runtime.drag?.dispose();
    disposeObject(runtime.graphGroup);
    runtime.graphGroup.clear();
    runtime.nodeMeshes = [];
    runtime.nodeById = new Map();
    runtime.labels = [];
    runtime.edgeObjects = [];
    runtime.positions = defaultGraphPositions3d(nodes);

    for (const node of nodes) {
      const accent = NODE_KINDS[node.data.kind]?.color || '#7e8a91';
      const color = new THREE.Color(accent);
      const shellMaterial = new THREE.MeshPhysicalMaterial({
        color,
        roughness: 0.22,
        metalness: 0.02,
        transparent: true,
        opacity: 0.48,
        transmission: 0.18,
        thickness: 0.8,
        emissive: color,
        emissiveIntensity: node.data.status === 'running' ? 1.2 : node.id === selectedId ? 0.46 : 0.2,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(organicGeometry(node.id), shellMaterial);
      const position = runtime.positions.get(node.id);
      mesh.position.set(position.x, position.y, position.z);

      const coreColor = color.clone().multiplyScalar(node.data.status === 'running' ? 0.82 : 0.48);
      const core = new THREE.Mesh(
        new THREE.IcosahedronGeometry(NODE_RADIUS * 0.58, 3),
        new THREE.MeshBasicMaterial({
          color: coreColor,
          transparent: true,
          opacity: node.data.status === 'running' ? 0.86 : node.id === selectedId ? 0.62 : 0.45,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      mesh.add(core);

      const icon = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glyphTexture(node.data.kind, accent),
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }));
      icon.scale.set(1.12, 1.12, 1);
      mesh.add(icon);

      const aura = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(),
        color,
        transparent: true,
        opacity: node.data.status === 'running' ? 0.42 : node.id === selectedId ? 0.16 : 0.07,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      aura.scale.set(2.65, 2.65, 1);
      mesh.add(aura);

      const illuminated = node.data.status === 'running' || node.id === selectedId;
      const light = illuminated
        ? new THREE.PointLight(
            color,
            node.data.status === 'running' ? 5 : 1.15,
            5.5,
            2,
          )
        : null;
      if (light) mesh.add(light);
      mesh.userData = {
        nodeId: node.id,
        status: node.data.status,
        selected: node.id === selectedId,
        core,
        aura,
        light,
      };
      runtime.nodeMeshes.push(mesh);
      runtime.nodeById.set(node.id, mesh);
      runtime.graphGroup.add(mesh);

      if (node.id === selectedId) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(NODE_RADIUS + 0.18, 0.025, 12, 72),
          new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.88 }),
        );
        ring.rotation.x = Math.PI / 2;
        mesh.add(ring);
      }

      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: labelTexture(node, accent),
        transparent: true,
        depthWrite: false,
      }));
      sprite.scale.set(2.8, 0.7, 1);
      runtime.labels.push({ sprite, nodeId: node.id });
      runtime.graphGroup.add(sprite);
    }

    for (const [index, edge] of edges.entries()) {
      const source = runtime.nodeById.get(edge.source);
      const target = runtime.nodeById.get(edge.target);
      if (!source || !target) continue;
      const channel = edge.data?.channel || 'data';
      const color = new THREE.Color(CHANNEL_COLORS[channel] || CHANNEL_COLORS.data);
      const active = String(edge.className || '').includes('edge-pulse');
      const direction = edgePulseDirection(edge.className);
      const tube = new THREE.Mesh(
        new THREE.BufferGeometry(),
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: active ? 2.8 : 0.3,
          roughness: 0.42,
          transparent: true,
          opacity: active ? 0.96 : edge.selected ? 0.9 : 0.7,
        }),
      );
      const halo = new THREE.Mesh(
        new THREE.BufferGeometry(),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: active ? 0.34 : 0.06,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.BackSide,
        }),
      );
      const arrow = new THREE.Mesh(
        new THREE.ConeGeometry(active ? 0.14 : 0.11, active ? 0.34 : 0.28, 14),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: active ? 1 : 0.8 }),
      );
      const pulse = active
        ? new THREE.Mesh(
            new THREE.SphereGeometry(0.16, 18, 12),
            new THREE.MeshBasicMaterial({
              color: '#ffffff',
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            }),
          )
        : null;
      if (pulse) {
        const pulseAura = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glowTexture(),
          color,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }));
        pulseAura.scale.set(0.95, 0.95, 1);
        pulse.add(pulseAura);
      }
      runtime.graphGroup.add(halo, tube, arrow);
      if (pulse) runtime.graphGroup.add(pulse);
      const item = {
        sourceId: edge.source,
        targetId: edge.target,
        tube,
        halo,
        arrow,
        pulse,
        active,
        direction,
        seed: (hashString(edge.id || `${edge.source}-${edge.target}`) % 10000) / 997,
        offset: (index * 0.137) % 1,
        curve: null,
      };
      updateEdgePath(item, source, target);
      runtime.edgeObjects.push(item);
    }

    const updateConnectedEdges = (nodeId) => {
      for (const item of runtime.edgeObjects) {
        if (item.sourceId !== nodeId && item.targetId !== nodeId) continue;
        const source = runtime.nodeById.get(item.sourceId);
        const target = runtime.nodeById.get(item.targetId);
        if (source && target) updateEdgePath(item, source, target);
      }
    };
    const drag = new DragControls(runtime.nodeMeshes, runtime.camera, runtime.renderer.domElement);
    drag.addEventListener('dragstart', () => {
      runtime.orbit.enabled = false;
      runtime.renderer.domElement.classList.add('is-dragging-node');
    });
    drag.addEventListener('drag', (event) => {
      updateConnectedEdges(event.object.userData.nodeId);
    });
    drag.addEventListener('dragend', (event) => {
      runtime.orbit.enabled = true;
      runtime.renderer.domElement.classList.remove('is-dragging-node');
      const { x, y, z } = event.object.position;
      runtime.positions.set(event.object.userData.nodeId, { x, y, z });
      onMoveNode(event.object.userData.nodeId, { x, y, z });
    });
    runtime.drag = drag;

    const signature = nodes.map((node) => node.id).sort().join('|');
    if (graphSignatureRef.current !== signature) {
      graphSignatureRef.current = signature;
      frameCamera(runtime.camera, runtime.orbit, runtime.positions);
    }

    return () => drag.dispose();
  }, [edges, nodes, onMoveNode, selectedId]);

  return (
    <div className="graph-3d-host" ref={hostRef}>
      <div className="graph-3d-controls">
        <button type="button" onClick={resetCamera} title="Frame the complete 3D graph" aria-label="Frame complete 3D graph">
          <Focus size={17} />
        </button>
      </div>
    </div>
  );
}
