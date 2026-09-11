
  import * as THREE from 'three';
  const canvas = document.getElementById('authBackdropCanvas');
  if (canvas && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: false, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10); cam.position.z = 1;
    const geo = new THREE.PlaneGeometry(2, 2);

    /* Marketing-hero palette — light + dark theme variants. Reads from
       html[data-theme] so toggling theme on the auth screen re-tunes
       the shader without rebuilding the WebGL context. */
    const PALETTES = {
      light: {
        base:    '#FFFFFF',
        flameA:  '#FF61AB',
        flameB:  '#FFA75E',
        flameC:  '#5BD2FF',
        accent:  '#C8A2FF',
      },
      dark: {
        base:    '#0a0a0c',
        flameA:  '#E63B85',
        flameB:  '#FF8E3C',
        flameC:  '#3FB8E8',
        accent:  '#9F7BFF',
      },
    };
    function currentPalette() {
      return document.documentElement.getAttribute('data-theme') === 'light' ? PALETTES.light : PALETTES.dark;
    }
    const p = currentPalette();
    const u = {
      u_time:   { value: 0 },
      u_base:   { value: new THREE.Color(p.base) },
      u_flameA: { value: new THREE.Color(p.flameA) },
      u_flameB: { value: new THREE.Color(p.flameB) },
      u_flameC: { value: new THREE.Color(p.flameC) },
      u_accent: { value: new THREE.Color(p.accent) },
    };
    /* Re-tune palette on theme toggle without rebuilding the renderer */
    new MutationObserver(() => {
      const np = currentPalette();
      u.u_base.value.set(np.base);
      u.u_flameA.value.set(np.flameA);
      u.u_flameB.value.set(np.flameB);
      u.u_flameC.value.set(np.flameC);
      u.u_accent.value.set(np.accent);
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    const vs = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;

    /* SIMPLEX 2D + FBM helpers — identical to marketing hero's
       buildHeroFlame shader. 5 FBM octaves at decreasing amplitude. */
    const fs = `
      vec3 permute(vec3 x){return mod(((x*34.0)+1.0)*x,289.0);}
      float snoise(vec2 v){
        const vec4 C=vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);
        vec2 i=floor(v+dot(v,C.yy));
        vec2 x0=v-i+dot(i,C.xx);
        vec2 i1=(x0.x>x0.y)?vec2(1.0,0.0):vec2(0.0,1.0);
        vec4 x12=x0.xyxy+C.xxzz; x12.xy-=i1;
        i=mod(i,289.0);
        vec3 p=permute(permute(i.y+vec3(0.0,i1.y,1.0))+i.x+vec3(0.0,i1.x,1.0));
        vec3 m=max(0.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.0); m=m*m; m=m*m;
        vec3 x=2.0*fract(p*C.www)-1.0; vec3 h=abs(x)-0.5; vec3 ox=floor(x+0.5); vec3 a0=x-ox;
        m*=1.79284291400159-0.85373472095314*(a0*a0+h*h);
        vec3 g; g.x=a0.x*x0.x+h.x*x0.y; g.yz=a0.yz*x12.xz+h.yz*x12.yw;
        return 130.0*dot(m,g);
      }
      float fbm(vec2 p){
        float v=0.0; float a=0.5; vec2 shift=vec2(100.0);
        mat2 rot=mat2(cos(0.5),sin(0.5),-sin(0.5),cos(0.5));
        for(int i=0;i<5;i++){ v+=a*snoise(p); p=rot*p*2.0+shift; a*=0.5; }
        return v;
      }
      varying vec2 vUv;
      uniform float u_time;
      uniform vec3 u_base, u_flameA, u_flameB, u_flameC, u_accent;
      void main(){
        vec2 uv = vUv; uv.x *= 1.6;
        float t = u_time * 0.08;
        vec2 q = vec2(fbm(uv + t*0.5), fbm(uv + vec2(5.2,1.3) + t*0.4));
        vec2 rv = vec2(fbm(uv + 4.0*q + vec2(1.7,9.2) + t*0.6), fbm(uv + 4.0*q + vec2(8.3,2.8) + t*0.5));
        float f = fbm(uv + 3.5*rv + t*0.3);
        vec3 color = u_base;
        color = mix(color, u_flameA, clamp(length(q)*0.65, 0.0, 1.0));
        color = mix(color, u_flameB, clamp(length(rv)*0.55, 0.0, 1.0));
        color = mix(color, u_flameC, clamp(f*f*1.2 + 0.1, 0.0, 1.0));
        color = mix(color, u_accent, clamp(pow(f, 4.0)*1.8, 0.0, 0.5));
        float alpha = smoothstep(0.0, 0.06, vUv.y) * smoothstep(1.0, 0.94, vUv.y);
        gl_FragColor = vec4(color, alpha * 0.95);
      }
    `;
    const m = new THREE.ShaderMaterial({ uniforms: u, vertexShader: vs, fragmentShader: fs, transparent: true, depthWrite: false });
    scene.add(new THREE.Mesh(geo, m));
    function fit(){ const w=canvas.clientWidth, h=canvas.clientHeight; if(w&&h) r.setSize(w,h,false); }
    fit(); window.addEventListener('resize', fit);
    let f = 0; const t0 = performance.now();
    (function loop(){
      requestAnimationFrame(loop);
      const overlay = document.getElementById('authOverlay');
      if (!overlay || overlay.style.display === 'none' || document.hidden) return;
      f++; if (f % 2) return;
      u.u_time.value = (performance.now() - t0) / 1000;
      r.render(scene, cam);
    })();
  }
