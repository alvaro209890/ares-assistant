import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { AresState } from '../../shared/types'
import { getLevel } from '../lib/audio'

// Ruído simplex 3D (Ashima) para deformar a malha da orbe no vertex shader.
const NOISE_GLSL = `
vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x,289.0);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+1.0*C.xxx; vec3 x2=x0-i2+2.0*C.xxx; vec3 x3=x0-1.0+3.0*C.xxx;
  i=mod(i,289.0);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=1.0/7.0; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`

const VERT = `
uniform float uTime; uniform float uAmp; uniform float uFreq;
varying float vDisp; varying vec3 vNormal; varying vec3 vView;
${NOISE_GLSL}
void main(){
  vNormal = normalize(normalMatrix * normal);
  float n = snoise(normal * uFreq + uTime * 0.45);
  float n2 = snoise(normal * (uFreq*2.1) + uTime * 0.9) * 0.5;
  float disp = (n + n2) * uAmp;
  vDisp = disp;
  vec3 pos = position + normal * disp;
  vec4 mv = modelViewMatrix * vec4(pos,1.0);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`

const FRAG = `
uniform vec3 uColor; uniform float uTime; uniform float uGlow;
varying float vDisp; varying vec3 vNormal; varying vec3 vView;
void main(){
  float fres = pow(1.0 - max(dot(vNormal, vView), 0.0), 2.2);
  vec3 base = mix(uColor * 0.25, uColor, fres);
  base += vec3(1.0) * pow(fres, 3.0) * 0.8;             // borda branca brilhante
  base += uColor * smoothstep(0.0, 0.4, vDisp) * 0.6;    // cristas iluminadas
  float alpha = clamp(0.55 + fres * 0.7 + uGlow, 0.0, 1.0);
  gl_FragColor = vec4(base, alpha);
}`

const STATE_TARGET: Record<AresState, { color: THREE.Color; amp: number; freq: number; spin: number }> = {
  idle: { color: new THREE.Color('#38e1ff'), amp: 0.07, freq: 1.6, spin: 0.06 },
  listening: { color: new THREE.Color('#5ef0ff'), amp: 0.18, freq: 2.0, spin: 0.12 },
  thinking: { color: new THREE.Color('#6a78ff'), amp: 0.2, freq: 2.6, spin: 0.95 },
  speaking: { color: new THREE.Color('#7df0ff'), amp: 0.16, freq: 2.2, spin: 0.3 }
}

function Core({ state }: { state: AresState }): JSX.Element {
  const matRef = useRef<THREE.ShaderMaterial>(null)
  const groupRef = useRef<THREE.Group>(null)
  const ampRef = useRef(0.07)
  const spinRef = useRef(0.06)
  const colorRef = useRef(new THREE.Color('#38e1ff'))

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uAmp: { value: 0.07 },
      uFreq: { value: 1.6 },
      uColor: { value: new THREE.Color('#38e1ff') },
      uGlow: { value: 0 }
    }),
    []
  )

  useFrame((_, delta) => {
    const t = STATE_TARGET[state]
    // Em "ouvindo", a amplitude vem do nível real do microfone.
    const liveAmp = state === 'listening' ? Math.max(t.amp, getLevel() * 0.9) : t.amp
    const breathing = state === 'idle' ? Math.sin(performance.now() / 700) * 0.015 : 0
    const speakPulse = state === 'speaking' ? Math.abs(Math.sin(performance.now() / 160)) * 0.08 : 0
    const targetAmp = liveAmp + breathing + speakPulse

    ampRef.current += (targetAmp - ampRef.current) * Math.min(1, delta * 8)
    spinRef.current += (t.spin - spinRef.current) * Math.min(1, delta * 3)
    colorRef.current.lerp(t.color, Math.min(1, delta * 3))

    if (matRef.current) {
      matRef.current.uniforms.uTime.value += delta
      matRef.current.uniforms.uAmp.value = ampRef.current
      matRef.current.uniforms.uFreq.value += (t.freq - matRef.current.uniforms.uFreq.value) * Math.min(1, delta * 3)
      ;(matRef.current.uniforms.uColor.value as THREE.Color).copy(colorRef.current)
      matRef.current.uniforms.uGlow.value = state === 'thinking' ? 0.12 : 0.0
    }
    if (groupRef.current) {
      groupRef.current.rotation.y += spinRef.current * delta
      groupRef.current.rotation.x += spinRef.current * 0.35 * delta
    }
  })

  return (
    <group ref={groupRef}>
      {/* Núcleo deformável */}
      <mesh>
        <icosahedronGeometry args={[1.15, 20]} />
        <shaderMaterial ref={matRef} uniforms={uniforms} vertexShader={VERT} fragmentShader={FRAG} transparent />
      </mesh>
      {/* Halo aditivo (sensação de brilho/bloom) */}
      <mesh scale={1.45}>
        <sphereGeometry args={[1.15, 32, 32]} />
        <meshBasicMaterial color={'#1aa6ff'} transparent opacity={0.1} side={THREE.BackSide} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh scale={2.1}>
        <sphereGeometry args={[1.15, 24, 24]} />
        <meshBasicMaterial color={'#0e64ff'} transparent opacity={0.04} side={THREE.BackSide} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  )
}

function EnergyShell({ state }: { state: AresState }): JSX.Element {
  const shellRef = useRef<THREE.Group>(null)
  const matRef = useRef<THREE.MeshBasicMaterial>(null)
  useFrame((_, delta) => {
    const active = state === 'thinking' || state === 'speaking'
    if (shellRef.current) {
      shellRef.current.rotation.y -= delta * (active ? 0.34 : 0.16)
      shellRef.current.rotation.z += delta * (active ? 0.18 : 0.07)
      const pulse = 1 + Math.sin(performance.now() / 560) * (active ? 0.035 : 0.015)
      shellRef.current.scale.setScalar(pulse)
    }
    if (matRef.current) {
      const targetOpacity = state === 'idle' ? 0.12 : state === 'listening' ? 0.2 : 0.26
      matRef.current.opacity += (targetOpacity - matRef.current.opacity) * Math.min(1, delta * 5)
    }
  })
  return (
    <group ref={shellRef}>
      <mesh scale={1.72}>
        <icosahedronGeometry args={[1.15, 3]} />
        <meshBasicMaterial
          ref={matRef}
          color={'#6ee7ff'}
          transparent
          opacity={0.14}
          wireframe
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh scale={1.98} rotation={[0.42, 0.18, 0.2]}>
        <sphereGeometry args={[1.15, 32, 16]} />
        <meshBasicMaterial
          color={'#376cff'}
          transparent
          opacity={0.055}
          wireframe
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  )
}

function Rings({ state }: { state: AresState }): JSX.Element {
  const g = useRef<THREE.Group>(null)
  const speed = useRef(0.2)
  useFrame((_, delta) => {
    const target = state === 'thinking' ? 1.6 : state === 'listening' ? 0.5 : 0.2
    speed.current += (target - speed.current) * Math.min(1, delta * 2)
    if (g.current) {
      g.current.rotation.z += speed.current * delta
      g.current.rotation.x = Math.sin(performance.now() / 3000) * 0.3
    }
  })
  return (
    <group ref={g}>
      <mesh rotation={[Math.PI / 2.4, 0, 0]}>
        <torusGeometry args={[2.1, 0.012, 16, 160]} />
        <meshBasicMaterial color={'#38e1ff'} transparent opacity={0.45} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh rotation={[Math.PI / 1.7, Math.PI / 5, 0]}>
        <torusGeometry args={[2.55, 0.008, 16, 160]} />
        <meshBasicMaterial color={'#6a78ff'} transparent opacity={0.3} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh rotation={[Math.PI / 2.05, -Math.PI / 5.5, Math.PI / 7]}>
        <torusGeometry args={[3.05, 0.006, 16, 180]} />
        <meshBasicMaterial color={'#7df0ff'} transparent opacity={0.2} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh rotation={[Math.PI / 1.25, Math.PI / 3.2, Math.PI / 4]}>
        <torusGeometry args={[1.55, 0.01, 16, 140]} />
        <meshBasicMaterial color={'#b8fbff'} transparent opacity={0.22} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  )
}

function Particles(): JSX.Element {
  const ref = useRef<THREE.Points>(null)
  const geom = useMemo(() => {
    const N = 620
    const arr = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      const r = 2.3 + Math.random() * 2.45
      const th = Math.random() * Math.PI * 2
      const ph = Math.acos(2 * Math.random() - 1)
      arr[i * 3] = r * Math.sin(ph) * Math.cos(th)
      arr[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th)
      arr[i * 3 + 2] = r * Math.cos(ph)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3))
    return g
  }, [])
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.04
  })
  return (
    <points ref={ref} geometry={geom}>
      <pointsMaterial color={'#7fdcff'} size={0.018} transparent opacity={0.74} blending={THREE.AdditiveBlending} />
    </points>
  )
}

export default function Orb3D({ state }: { state: AresState }): JSX.Element {
  return (
    <Canvas
      camera={{ position: [0, 0, 6.1], fov: 40 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      style={{ width: '100%', height: '100%' }}
    >
      <group scale={0.72}>
        <EnergyShell state={state} />
        <Core state={state} />
        <Rings state={state} />
        <Particles />
      </group>
    </Canvas>
  )
}
