/* =====================================================
 * scene.js — Three.js 场景 / 相机 / 灯光 / 简易轨道控制
 * ===================================================== */
(function () {
  'use strict';
  window.PE = window.PE || {};

  PE.SceneMgr = class {
    constructor(holder) {
      this.renderer = new THREE.WebGLRenderer({ antialias: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.outputEncoding = THREE.sRGBEncoding;
      holder.appendChild(this.renderer.domElement);
      this.canvas = this.renderer.domElement;

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x0b0e17); // 玄墨夜幕
      this.scene.fog = new THREE.Fog(0x0b0e17, 24, 44);

      this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 140);

      // 简易轨道相机（yaw / pitch / dist / target）
      this.orbit = {
        yaw: -0.55,
        pitch: 0.84,
        dist: 17.5,
        target: new THREE.Vector3(0, 0, 0.4)
      };
      this._shakeT = 0;
      this._shakeAmp = 0;

      // 灯光（星墨手卷：暖月主光 + 淡金轮廓）
      this.scene.add(new THREE.AmbientLight(0x8f93a3, 0.55));
      const dir = new THREE.DirectionalLight(0xede5cd, 0.92); // 月光
      dir.position.set(9, 15, 6);
      this.scene.add(dir);
      const rim = new THREE.DirectionalLight(0xc9a86a, 0.3); // 月金轮廓补光
      rim.position.set(-8, 6, -10);
      this.scene.add(rim);

      // 常驻：远景地面 + 星子 + 明月
      const far = new THREE.Mesh(
        new THREE.PlaneGeometry(160, 160),
        new THREE.MeshStandardMaterial({ color: 0x0a0d15, roughness: 1, metalness: 0 })
      );
      far.rotation.x = -Math.PI / 2;
      far.position.y = -0.3;
      this.scene.add(far);
      this._makeStars();
      this._makeMoon();

      // 射线拾取
      this._raycaster = new THREE.Raycaster();
      this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

      this._resize();
      window.addEventListener('resize', () => this._resize());
    }

    _makeStars() {
      const n = 420;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const r = 42 + Math.random() * 30;
        const th = Math.random() * Math.PI * 2;
        const ph = Math.random() * Math.PI;
        pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
        pos[i * 3 + 1] = Math.abs(r * Math.cos(ph)) * 0.8 + 2;
        pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({
        color: 0xe6ddc4, size: 0.55, sizeAttenuation: true, // 宣纸金白星子
        transparent: true, opacity: 0.8, fog: false
      });
      this.stars = new THREE.Points(geo, mat);
      this.scene.add(this.stars);
    }

    /* 一轮明月：月轮 + 月晕（不受雾影响） */
    _makeMoon() {
      const moonMat = new THREE.MeshBasicMaterial({ color: 0xf2ecd8, fog: false });
      const moon = new THREE.Mesh(new THREE.SphereGeometry(3.4, 32, 24), moonMat);
      moon.position.set(-30, 27, -40);
      this.scene.add(moon);

      const cv = document.createElement('canvas');
      cv.width = cv.height = 256;
      const ctx = cv.getContext('2d');
      const g = ctx.createRadialGradient(128, 128, 12, 128, 128, 128);
      g.addColorStop(0, 'rgba(242,236,216,0.8)');
      g.addColorStop(0.28, 'rgba(238,229,201,0.24)');
      g.addColorStop(1, 'rgba(238,229,201,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 256);
      const tex = new THREE.CanvasTexture(cv);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, opacity: 0.95, depthWrite: false, fog: false
      }));
      halo.scale.set(20, 20, 1);
      halo.position.copy(moon.position);
      this.scene.add(halo);
      this.moonHalo = halo;
    }

    _resize() {
      const w = window.innerWidth, h = window.innerHeight;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }

    /* ---- 相机控制 ---- */
    applyOrbit() {
      const o = this.orbit;
      this.camera.position.set(
        o.target.x + Math.sin(o.yaw) * Math.cos(o.pitch) * o.dist,
        o.target.y + Math.sin(o.pitch) * o.dist,
        o.target.z + Math.cos(o.yaw) * Math.cos(o.pitch) * o.dist
      );
      this.camera.lookAt(o.target);
    }

    orbitFromDrag(dx, dy) {
      this.orbit.yaw -= dx * 0.005;
      this.orbit.pitch = PE.utils.clamp(this.orbit.pitch + dy * 0.004, 0.3, 1.32);
    }

    zoom(deltaY) {
      this.orbit.dist = PE.utils.clamp(this.orbit.dist + deltaY * 0.014, 9, 28);
    }

    shake(amp) {
      this._shakeAmp = Math.max(this._shakeAmp, amp);
      this._shakeT = 0.28;
    }

    /** 屏幕坐标 → 地面(y=0)世界坐标点 */
    groundPoint(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        (clientX - rect.left) / rect.width * 2 - 1,
        -((clientY - rect.top) / rect.height * 2 - 1)
      );
      this._raycaster.setFromCamera(ndc, this.camera);
      const out = new THREE.Vector3();
      if (this._raycaster.ray.intersectPlane(this._groundPlane, out)) return out;
      return null;
    }

    update(dt) {
      if (this._shakeT > 0) {
        this._shakeT -= dt;
        const k = Math.max(0, this._shakeT) / 0.28 * this._shakeAmp;
        this.applyOrbit();
        this.camera.position.x += (Math.random() - 0.5) * k;
        this.camera.position.y += (Math.random() - 0.5) * k;
        this.camera.position.z += (Math.random() - 0.5) * k;
      }
      if (this.stars) this.stars.rotation.y += dt * 0.008;
      if (this.moonHalo) {
        const s = 20 + Math.sin(performance.now() * 0.0006) * 0.8;
        this.moonHalo.scale.set(s, s, 1);
      }
    }

    render() {
      if (this._shakeT <= 0) this.applyOrbit();
      this.renderer.render(this.scene, this.camera);
    }
  };
})();
