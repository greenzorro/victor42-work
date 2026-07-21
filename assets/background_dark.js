/*
 * File: background_dark.js
 * Project: victor42-work (portable)
 * Description: Oblique spiral galaxy — continuous disk texture and particles.
 *
 * Pipeline:
 *  1) Pre-render face-on continuous density field (arms, dust cutouts, color)
 *  2) Soft multi-pass blur (nebula body, not particle beads)
 *  3) Each frame: draw texture with tilt squash + in-plane spin
 *  4) Overlay 3D-projected star particles (depth, near-side thickness)
 *  5) Soft bulge bloom + deep-field stars
 *
 * Dynamics: CCW disk spin; trailing log spirals θ = -ln(r)/b.
 * API: StarfieldBackground.init / prepare / prepareAsync / start / stop / isRunning / destroy
 */
(function (global) {
    'use strict';

    const DEFAULTS = {
        targetFps: 30,
        rotationPeriodSec: 300,
        dprCap: 1.5,
        textureSize: 480,
        particleCount: 4800,
        fieldStarCount: 1600,
        tiltDeg: 76,
        yawDeg: -20,
        armCount: 2,
        armTightness: 0.27,
        scaleFactor: 0.9
    };

    const ARM_STRENGTH = [1.05, 0.68];
    const ARM_TIGHTNESS = [0.94, 1.14];
    const ARM_PHASE = [0.0, 0.42];
    const HASH_CACHE = new Map();

    const FIELD_GLOW_STOPS = [
        [0, 'rgba(255,255,255,0.32)'],
        [0.15, 'rgba(220,230,255,0.14)'],
        [0.45, 'rgba(160,180,255,0.045)'],
        [1, 'rgba(80,100,180,0)']
    ];

    const HALO_GLOW_STOPS = [
        [0, 'rgba(255,245,220,0.14)'],
        [0.18, 'rgba(240,220,190,0.06)'],
        [0.5, 'rgba(180,160,140,0.018)'],
        [1, 'rgba(80,70,60,0)']
    ];

    const BULGE_BAR_STOPS = [
        [0, 'rgba(255, 242, 220, 0.16)'],
        [0.22, 'rgba(255, 215, 170, 0.082)'],
        [0.52, 'rgba(240, 170, 140, 0.034)'],
        [0.82, 'rgba(150, 100, 130, 0.009)'],
        [1, 'rgba(55, 50, 75, 0)']
    ];

    const BULGE_SIDE_STOPS = [
        [0, 'rgba(255, 230, 195, 0.08)'],
        [0.3, 'rgba(240, 190, 150, 0.035)'],
        [0.7, 'rgba(180, 120, 130, 0.010)'],
        [1, 'rgba(60, 50, 80, 0)']
    ];

    const BULGE_OUTER_STOPS = [
        [0, 'rgba(255, 248, 230, 0.24)'],
        [0.2, 'rgba(255, 225, 185, 0.12)'],
        [0.5, 'rgba(250, 180, 140, 0.042)'],
        [0.78, 'rgba(210, 125, 110, 0.012)'],
        [1, 'rgba(110, 70, 70, 0)']
    ];

    const BULGE_INNER_STOPS = [
        [0, 'rgba(255, 252, 245, 0.38)'],
        [0.3, 'rgba(255, 238, 205, 0.16)'],
        [0.65, 'rgba(255, 205, 160, 0.04)'],
        [1, 'rgba(230, 165, 120, 0)']
    ];

    const BULGE_LOBES = [
        { dx: 0, dy: 0, sx: 1, sy: 1, rot: -0.32, a: 1 },
        { dx: 0.04, dy: -0.02, sx: 0.7, sy: 0.85, rot: 0.5, a: 0.45 },
        { dx: -0.03, dy: 0.025, sx: 0.55, sy: 0.7, rot: -1.1, a: 0.35 }
    ].map(function(lobe) {
        lobe.stops = [
            [0, 'rgba(255, 235, 205, ' + (0.055 * lobe.a) + ')'],
            [0.25, 'rgba(255, 195, 155, ' + (0.028 * lobe.a) + ')'],
            [0.55, 'rgba(195, 135, 155, ' + (0.012 * lobe.a) + ')'],
            [0.82, 'rgba(110, 80, 130, ' + (0.004 * lobe.a) + ')'],
            [1, 'rgba(40, 40, 75, 0)']
        ];
        return lobe;
    });

    const state = {
        canvas: null,
        ctx: null,
        texture: null,
        particles: null,
        projected: null,
        visibleProjected: null,
        fieldStars: null,
        brightField: null,
        haloStars: null,
        brightHalo: null,
        angle: 0,
        raf: 0,
        running: false,
        wantRun: false,
        lastTs: 0,
        dpr: 1,
        cssW: 0,
        cssH: 0,
        scale: 1,
        resizeTimer: 0,
        listenersBound: false,
        motionQuery: null,
        assetBuildToken: 0,
        preparePromise: null,
        buildUrgent: false,
        options: Object.assign({}, DEFAULTS),
        cosTilt: 1,
        sinTilt: 0,
        cosYaw: 1,
        sinYaw: 0,
        squashY: 0.3,
        staticItems: null,
        projectionScratch: { x: 0, y: 0, depth: 0 }
    };

    function getMotionQuery() {
        if (!state.motionQuery) {
            state.motionQuery = global.matchMedia('(prefers-reduced-motion: reduce)');
        }
        return state.motionQuery;
    }

    function prefersReducedMotion() {
        return getMotionQuery().matches;
    }

    function mulberry32(seed) {
        return function () {
            let t = (seed += 0x6d2b79f5);
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function clamp(v, a, b) {
        return Math.max(a, Math.min(b, v));
    }

    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    function smoothstep(e0, e1, x) {
        const t = clamp((x - e0) / (e1 - e0), 0, 1);
        return t * t * (3 - 2 * t);
    }

    function updateViewMatrix() {
        const tilt = (state.options.tiltDeg * Math.PI) / 180;
        const yaw = (state.options.yawDeg * Math.PI) / 180;
        state.cosTilt = Math.cos(tilt);
        state.sinTilt = Math.sin(tilt);
        state.cosYaw = Math.cos(yaw);
        state.sinYaw = Math.sin(yaw);
        // tiltDeg = angle from face-on toward edge-on
        state.squashY = Math.max(0.12, Math.cos(tilt));

        const depthFactor = state.cosYaw * state.cosTilt;
        state.staticItems = [
            { type: 'slice', depth: -0.018 * depthFactor, z: -0.018, opacity: 0.08, scale: 1.08 },
            { type: 'slice', depth: -0.008 * depthFactor, z: -0.008, opacity: 0.20, scale: 1.04 },
            { type: 'slice', depth: 0, z: 0, opacity: 0.65, scale: 1.0 },
            { type: 'bulge', depth: 0 },
            { type: 'slice', depth: 0.008 * depthFactor, z: 0.008, opacity: 0.20, scale: 1.04 },
            { type: 'slice', depth: 0.018 * depthFactor, z: 0.018, opacity: 0.08, scale: 1.08 }
        ];
        state.staticItems.sort(function (a, b) {
            return a.depth - b.depth;
        });
    }

    // Value-noise fBm adds organic density variation.
    function hash2(x, y) {
        const normalizedX = x >= 0 ? x * 2 : -x * 2 - 1;
        const normalizedY = y >= 0 ? y * 2 : -y * 2 - 1;
        const sum = normalizedX + normalizedY;
        const key = sum * (sum + 1) / 2 + normalizedY;
        const cached = HASH_CACHE.get(key);
        if (cached !== undefined) return cached;

        const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
        const value = n - Math.floor(n);
        HASH_CACHE.set(key, value);
        return value;
    }

    function valueNoise(x, y) {
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const fx = x - x0;
        const fy = y - y0;
        const ux = fx * fx * (3 - 2 * fx);
        const uy = fy * fy * (3 - 2 * fy);
        const a = hash2(x0, y0);
        const b = hash2(x0 + 1, y0);
        const c = hash2(x0, y0 + 1);
        const d = hash2(x0 + 1, y0 + 1);
        return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
    }

    function fbm(x, y) {
        let v = 0;
        let a = 0.5;
        let f = 1;
        for (let i = 0; i < 4; i++) {
            v += a * valueNoise(x * f, y * f);
            f *= 2.05;
            a *= 0.5;
        }
        return v;
    }

    // Two asymmetric trailing arms with phase variation, clumps, and a spur.
    function armDensity(r, theta, arms, tightness) {
        let d = 0;

        for (let a = 0; a < arms; a++) {
            const n1 = fbm(r * 3.1 + a * 7.3, theta * 1.4 + a) - 0.5;
            const n2 = fbm(r * 9.0 + theta * 2.2, a * 4.1) - 0.5;
            // Phase jitter preserves the logarithmic spiral flow.
            const phaseJitter = n1 * 0.25 + n2 * 0.12;
            const localTight = tightness * ARM_TIGHTNESS[a];
            const phase = arms * (theta + Math.log(Math.max(r, 0.03)) / localTight)
                + ARM_PHASE[a] * arms
                + phaseJitter;
            let wave = 0.5 + 0.5 * Math.cos(phase);
            wave = Math.pow(wave, 1.35);
            // Low-frequency fBm creates brightness clumps along each arm.
            const clump = 0.7 + 0.5 * fbm(r * 5.5 + a * 2, theta * 3.8 + r * 2.5);
            // Local width variation keeps each arm continuous.
            const breakUp = 0.8 + 0.3 * fbm(theta * 2.5 + r * 4, a * 9 + r * 1.2);
            d = Math.max(d, wave * ARM_STRENGTH[a] * clump * breakUp);
        }

        // A faint irregular spur bridges the main arms.
        const spurPhase = 3.15 * (theta + Math.log(Math.max(r, 0.03)) / 0.38 + 0.7);
        let spur = 0.5 + 0.5 * Math.cos(spurPhase);
        spur = spur * spur * (0.15 + 0.35 * fbm(r * 6, theta * 5));
        d = Math.max(d, spur);

        return clamp(d, 0, 1.55);
    }

    function projectInto(output, x, y, z, cosA, sinA) {
        const xr = x * cosA - y * sinA;
        const yr = x * sinA + y * cosA;
        const x1 = xr * state.cosYaw + z * state.sinYaw;
        const z1 = -xr * state.sinYaw + z * state.cosYaw;
        const y2 = yr * state.cosTilt - z1 * state.sinTilt;
        const z2 = yr * state.sinTilt + z1 * state.cosTilt;
        output.x = x1;
        output.y = y2;
        output.depth = z2;
        return output;
    }

    function softBlur(source, mixOriginal) {
        const out = document.createElement('canvas');
        out.width = source.width;
        out.height = source.height;
        const octx = out.getContext('2d');
        octx.imageSmoothingEnabled = true;
        octx.imageSmoothingQuality = 'high';

        const w2 = Math.max(1, source.width >> 1);
        const h2 = Math.max(1, source.height >> 1);
        const w4 = Math.max(1, source.width >> 2);
        const h4 = Math.max(1, source.height >> 2);

        const s2 = document.createElement('canvas');
        s2.width = w2;
        s2.height = h2;
        s2.getContext('2d').drawImage(source, 0, 0, w2, h2);

        const s4 = document.createElement('canvas');
        s4.width = w4;
        s4.height = h4;
        s4.getContext('2d').drawImage(s2, 0, 0, w4, h4);

        octx.globalAlpha = 1;
        octx.drawImage(s4, 0, 0, out.width, out.height);
        octx.globalAlpha = 0.55;
        octx.drawImage(s2, 0, 0, out.width, out.height);
        octx.globalAlpha = mixOriginal;
        octx.drawImage(source, 0, 0);
        octx.globalAlpha = 1;
        return out;
    }

    function* buildGalaxyTextureSteps(texSize) {
        const raw = document.createElement('canvas');
        raw.width = texSize;
        raw.height = texSize;
        const ctx = raw.getContext('2d');
        const img = ctx.createImageData(texSize, texSize);
        const data = img.data;
        const arms = state.options.armCount;
        const tightness = state.options.armTightness;
        const half = texSize * 0.5;
        const inv = 1 / (half * 0.9);

        // Offset, slightly barred disk frame.
        const ox = 0.055;
        const oy = -0.03;
        const stretchX = 1.08;
        const stretchY = 0.9;

        for (let j = 0; j < texSize; j++) {
            for (let i = 0; i < texSize; i++) {
                let x = (i - half) * inv;
                let y = (j - half) * inv;
                // Warp into irregular disk coordinates.
                x = (x - ox) * stretchX;
                y = (y - oy) * stretchY;
                // Mild azimuthal warp.
                const r0 = Math.sqrt(x * x + y * y);
                if (r0 > 1.25) continue;
                const th0 = Math.atan2(y, x);
                const warp = (fbm(x * 1.8, y * 1.8) - 0.5) * 0.12;
                const r = r0 * (1 + warp * 0.35 + (fbm(th0 * 0.8, r0 * 2) - 0.5) * 0.08);
                const theta = th0 + (fbm(r0 * 2.2, th0) - 0.5) * 0.22;

                // Smooth outer boundary.
                const edgeN = fbm(x * 2.4 + 3, y * 2.4 - 1);
                const rMax = 0.92 + edgeN * 0.07 + Math.abs(Math.sin(th0 * 2 + 0.4)) * 0.03;
                if (r > rMax) continue;

                const arm = armDensity(r, theta, arms, tightness);
                const coreN = fbm(x * 4, y * 4);
                const core = Math.exp(-r * r * (9.5 + coreN * 2.5));
                const diskFall = Math.exp(-Math.pow(r / (0.78 + edgeN * 0.08), 1.55));
                const diskN = 0.65 + 0.7 * fbm(x * 3.5, y * 3.5);
                const disk = diskFall * diskN;
                const outer = smoothstep(0.26, 0.78, r);

                // Layered noise forms continuous dust ribbons.
                const dustBase = armDensity(r, theta + 0.18 + (fbm(r * 3, theta) - 0.5) * 0.3, arms, tightness);
                // The first dust band defines broad, continuous lanes.
                const dustPatch = 0.62 + 0.38 * fbm(x * 3.2, y * 3.2);
                // Dust attenuation extends into the core at reduced strength.
                const dustBand = dustBase * dustBase
                    * dustPatch
                    * (1 - core * 0.72)
                    * smoothstep(0.04, 0.12, r)
                    * (1 - smoothstep(0.7, 0.98, r));
                // A secondary band adds narrow absorptive lanes.
                const dustBase2 = armDensity(r, theta + 0.35 + (fbm(r * 4.2, theta) - 0.5) * 0.25, arms, tightness);
                const narrowDust = dustBase2 * dustBase2 * dustBase2
                    * (0.5 + 0.5 * fbm(x * 4.5, y * 4.5))
                    * (1 - core * 0.65)
                    * smoothstep(0.06, 0.15, r)
                    * (1 - smoothstep(0.62, 0.88, r));

                // Faint cool haze fills the inter-arm regions.
                const haze = disk * (0.012 + 0.035 * fbm(x * 2, y * 2)) * (1 - arm * 0.55);

                let light = disk * (0.02 + arm * 0.72 + core * 0.95) + haze;
                // Low-frequency mottling follows the trailing flow.
                light *= 0.9 + 0.2 * fbm(x * 3.8 + 2, y * 3.8 - 3);
                // Dust absorption darkens the narrow lanes.
                light *= 1 - Math.min(0.97, dustBand * 1.05 + narrowDust * 1.25);

                if (light < 0.003 && dustBand < 0.12) continue;

                // H II regions form violet star-forming knots along the arms.
                let hii = 0;
                if (r > 0.16 && r < 0.74 && arm > 0.18) {
                    const hiiNoise = fbm(x * 14 + 5, y * 14 + 2);
                    const hiiClump = fbm(x * 6 + 1, y * 6 + 3);
                    hii = Math.pow(arm * hiiClump * (0.35 + 0.65 * hiiNoise), 1.9)
                        * smoothstep(0.16, 0.26, r)
                        * (1 - smoothstep(0.62, 0.78, r))
                        * (1 - core);
                }

                let cr; let cg; let cb; let ca;
                const mott = fbm(x * 5, y * 5);

                if (dustBand > 0.28) {
                    const t = clamp(dustBand * (0.7 + mott * 0.5), 0, 1);
                    // Near-black dust lanes silhouette the background light and stars.
                    cr = Math.round(lerp(8, 15, t));
                    cg = Math.round(lerp(6, 12, t));
                    cb = Math.round(lerp(10, 18, t));
                    ca = (0.22 + t * 0.35) * disk * 175;
                } else {
                    // Compute disk color first (inner or outer)
                    let crDisk, cgDisk, cbDisk, caDisk;
                    if (outer > 0.4) {
                        // Outer arms transition from blue-violet to cyan.
                        const cyanMix = smoothstep(0.65, 0.98, outer);
                        
                        // Blue-violet base for the inner-to-outer transition.
                        const bvR = Math.round(lerp(100, 60, arm));
                        const bvG = Math.round(lerp(80, 110, arm));
                        const bvB = Math.round(lerp(220, 250, arm));
                        
                        // Saturated ice-blue cyan at the outer edge.
                        const cyR = 15;
                        const cyG = 135;
                        const cyB = 255;
                        
                        crDisk = Math.round(lerp(bvR, cyR, cyanMix));
                        cgDisk = Math.round(lerp(bvG, cyG, cyanMix));
                        cbDisk = Math.round(lerp(bvB, cyB, cyanMix));
                        caDisk = light * 230 * smoothstep(0.05, 0.3, arm);
                    } else {
                        // The inner disk uses violet-purple arms and blue-violet gaps.
                        const armMix = smoothstep(0.1, 0.38, arm);
                        const baseT = (1 - outer) * (0.25 + arm * 0.75) * (0.7 + mott * 0.4);
                        const t = baseT * (0.45 + 0.55 * armMix);
                        // Violet-purple arm cores contrast with deep blue-violet gaps.
                        const warmR = Math.round(lerp(150, 185, t));
                        const warmG = Math.round(lerp(90, 125, t));
                        const warmB = Math.round(lerp(210, 245, t));
                        const coolR = Math.round(lerp(40, 90, t));
                        const coolG = Math.round(lerp(45, 100, t));
                        const coolB = Math.round(lerp(160, 220, t));
                        crDisk = Math.round(lerp(coolR, warmR, armMix));
                        cgDisk = Math.round(lerp(coolG, warmG, armMix));
                        cbDisk = Math.round(lerp(coolB, warmB, armMix));
                        caDisk = light * 195 * smoothstep(0.05, 0.3, arm + core);
                    }

                    // Core density smoothly blends the bulge color into the disk.
                    const coreMix = smoothstep(0.06, 0.45, core);
                    if (coreMix > 0.0) {
                        const tCore = clamp(core * (0.85 + mott * 0.3), 0, 1);
                        const coreR = 255;
                        const coreG = Math.round(lerp(210, 250, tCore));
                        const coreB = Math.round(lerp(180, 235, tCore));
                        const coreA = light * 245 * (0.5 + tCore * 0.35);

                        cr = Math.round(lerp(crDisk, coreR, coreMix));
                        cg = Math.round(lerp(cgDisk, coreG, coreMix));
                        cb = Math.round(lerp(cbDisk, coreB, coreMix));
                        ca = lerp(caDisk, coreA, coreMix);
                    } else {
                        cr = crDisk;
                        cg = cgDisk;
                        cb = cbDisk;
                        ca = caDisk;
                    }
                }

                // H II regions add violet emission along the arms.
                if (hii > 0.03) {
                    const h = clamp(hii * 1.6, 0, 1);
                    cr = lerp(cr, 175, h * 0.65);
                    cg = lerp(cg, 105, h * 0.6);
                    cb = lerp(cb, 240, h * 0.5);
                    ca = lerp(ca, 245, h * 0.45);
                }

                const edge = 1 - smoothstep(rMax * 0.72, rMax, r);
                ca *= edge * edge;

                const idx = (j * texSize + i) * 4;
                data[idx] = clamp(cr | 0, 0, 255);
                data[idx + 1] = clamp(cg | 0, 0, 255);
                data[idx + 2] = clamp(cb | 0, 0, 255);
                data[idx + 3] = clamp(ca | 0, 0, 255);
            }
            yield null;
        }

        ctx.putImageData(img, 0, 0);
        // Preserve arm structure and color contrast.
        const soft = softBlur(raw, 0.35);
        return softBlur(soft, 0.48);
    }

    function buildGalaxyTexture(texSize) {
        const steps = buildGalaxyTextureSteps(texSize);
        let result = steps.next();
        while (!result.done) result = steps.next();
        return result.value;
    }

    function scheduleAssetBuildChunk(callback) {
        if (state.buildUrgent || !('requestIdleCallback' in global)) {
            global.setTimeout(function() { callback(null); }, 0);
        } else {
            global.requestIdleCallback(callback, { timeout: 120 });
        }
    }

    function buildGalaxyTextureAsync(texSize, token) {
        const steps = buildGalaxyTextureSteps(texSize);

        return new Promise(function(resolve, reject) {
            function runChunk(deadline) {
                if (token !== state.assetBuildToken) {
                    resolve(null);
                    return;
                }

                const started = global.performance && global.performance.now
                    ? global.performance.now()
                    : Date.now();
                const rowLimit = state.buildUrgent ? 4 : 2;
                const timeLimit = state.buildUrgent ? 9 : 6;
                let rows = 0;
                let result = null;

                do {
                    try {
                        result = steps.next();
                    } catch (error) {
                        reject(error);
                        return;
                    }
                    rows++;
                    if (result.done) {
                        resolve(result.value);
                        return;
                    }

                    const now = global.performance && global.performance.now
                        ? global.performance.now()
                        : Date.now();
                    if (now - started >= timeLimit) break;
                    if (deadline && deadline.timeRemaining() < 2) break;
                } while (rows < rowLimit);

                scheduleAssetBuildChunk(runChunk);
            }

            scheduleAssetBuildChunk(runChunk);
        });
    }

    function buildParticles(count) {
        const rand = mulberry32(0xc0a1a);
        const arms = state.options.armCount;
        const tightness = state.options.armTightness;
        const particles = [];
        let attempts = 0;
        const maxAttempts = count * 18;

        while (particles.length < count && attempts < maxAttempts) {
            attempts++;
            // Mild lopsided sampling
            const r = Math.pow(rand(), 0.48 + rand() * 0.08) * (0.95 + rand() * 0.12);
            const theta = rand() * Math.PI * 2 + (rand() - 0.5) * 0.15;
            const arm = armDensity(r, theta, arms, tightness);
            const core = Math.exp(-r * r * (8 + rand() * 3));
            // Rejection sampling concentrates stars in the arms and core.
            const accept = 0.008 + Math.pow(arm, 2.5) * 0.85 + core * 0.4 + rand() * 0.01;
            if (rand() > accept) continue;

            // Warped thickness — not a flat sheet
            const zSpread = (0.01 + 0.014 * (1 - r)) * (0.7 + arm * 0.6 + rand() * 0.4);
            const zWarp = (fbm(r * 3, theta) - 0.5) * 0.012;
            const z = (rand() + rand() + rand() - 1.5) * zSpread + zWarp;

            const inCore = r < 0.14;
            const outer = r > 0.5;
            let size = 0.35 + rand() * 0.85;
            let brightness = 0.22 + rand() * 0.4;
            let cr; let cg; let cb;
            let kind = 'disk';

            if (inCore) {
                kind = 'core';
                size = 0.6 + rand() * 1.3;
                brightness = 0.55 + rand() * 0.4;
                cr = 255;
                cg = Math.round(lerp(215, 248, rand()));
                cb = Math.round(lerp(170, 220, rand()));
            } else if (outer && arm > 0.4) {
                kind = 'arm-blue';
                size = 0.4 + rand() * 1.0;
                brightness = 0.35 + rand() * 0.45;
                cr = Math.round(lerp(145, 205, rand()));
                cg = Math.round(lerp(170, 225, rand()));
                cb = 255;
            } else if (arm > 0.4) {
                kind = 'arm';
                size = 0.4 + rand() * 0.9;
                brightness = 0.3 + rand() * 0.4;
                // This inner-arm band shifts from blue-violet toward cream-white.
                const warm = smoothstep(0.14, 0.48, r);
                cr = Math.round(lerp(235, 255, warm));
                cg = Math.round(lerp(200, 238, warm));
                cb = Math.round(lerp(185, 220, warm));
                cr = Math.round(lerp(cr, 160 + rand() * 50, 1 - warm));
                cg = Math.round(lerp(cg, 175 + rand() * 40, 1 - warm));
                cb = Math.round(lerp(cb, 235 + rand() * 20, 1 - warm));
            } else {
                kind = 'halo';
                size = 0.25 + rand() * 0.5;
                brightness = 0.1 + rand() * 0.22;
                cr = Math.round(lerp(120, 170, rand()));
                cg = Math.round(lerp(130, 180, rand()));
                cb = Math.round(lerp(180, 230, rand()));
            }

            if (rand() < 0.007) {
                kind = 'bright';
                size *= 2;
                brightness = Math.min(1, brightness + 0.3);
            }

            particles.push({
                r: r,
                theta0: theta,
                x: Math.cos(theta) * r,
                y: Math.sin(theta) * r,
                z: z,
                zAbs: Math.abs(z),
                size: size,
                brightness: brightness,
                cr: cr,
                cg: cg,
                cb: cb,
                rgbaPrefix: 'rgba(' + cr + ',' + cg + ',' + cb + ',',
                kind: kind
            });
        }
        return particles;
    }

    function buildFieldStars(count) {
        const rand = mulberry32(0x5eed);
        const stars = [];
        const bright = [];
        for (let i = 0; i < count; i++) {
            // Hierarchy: many faint, few medium, rare bright
            const roll = rand();
            let size; let a;
            if (roll < 0.72) {
                size = 0.25 + rand() * 0.45;
                a = 0.12 + rand() * 0.28;
            } else if (roll < 0.94) {
                size = 0.45 + rand() * 0.7;
                a = 0.28 + rand() * 0.35;
            } else {
                size = 0.9 + rand() * 1.2;
                a = 0.5 + rand() * 0.4;
            }
            const star = {
                x: rand(),
                y: rand(),
                size: size,
                a: a,
                cr: Math.round(lerp(190, 255, rand())),
                cg: Math.round(lerp(200, 255, rand())),
                cb: 255
            };
            stars.push(star);
            if (size > 1.05 && a > 0.55) bright.push(star);
        }
        return { stars: stars, bright: bright };
    }

    // Sparse stellar halo around the galaxy — ancient Population-II-like stars
    function buildHaloStars(count) {
        const rand = mulberry32(0x7a10);
        const stars = [];
        const bright = [];
        for (let i = 0; i < count; i++) {
            const roll = rand();
            let size; let a;
            if (roll < 0.85) {
                size = 0.22 + rand() * 0.42;
                a = 0.05 + rand() * 0.12;
            } else {
                size = 0.65 + rand() * 0.95;
                a = 0.18 + rand() * 0.25;
            }
            // Spherical distribution, flattened slightly
            const r = Math.pow(rand(), 0.32) * 1.45 + 0.35;
            const theta = rand() * Math.PI * 2;
            const phi = Math.acos(2 * rand() - 1);
            const x = r * Math.sin(phi) * Math.cos(theta);
            const y = r * Math.sin(phi) * Math.sin(theta);
            const z = r * Math.cos(phi) * 0.55;
            const star = {
                x: x,
                y: y,
                z: z,
                size: size,
                a: a,
                cr: Math.round(lerp(220, 255, rand())),
                cg: Math.round(lerp(210, 250, rand())),
                cb: Math.round(lerp(170, 225, rand()))
            };
            stars.push(star);
            if (size > 0.85 && a > 0.2) bright.push(star);
        }
        return { stars: stars, bright: bright };
    }

    function ensureAssets() {
        if (state.texture) return;
        const area = state.cssW * state.cssH;
        const scale = clamp(area / (1280 * 800), 0.7, 1.3);
        const tex = Math.round(state.options.textureSize * clamp(scale, 0.85, 1.1));
        commitAssets(buildGalaxyTexture(tex), scale);
    }

    function commitAssets(texture, scale) {
        state.texture = texture;
        state.particles = buildParticles(Math.round(state.options.particleCount * scale));
        state.projected = new Array(state.particles.length);
        for (let i = 0; i < state.projected.length; i++) {
            const particle = state.particles[i];
            state.projected[i] = {
                x: 0,
                y: 0,
                depth: 0,
                sx: 0,
                sy: 0,
                size: particle.size,
                brightness: particle.brightness,
                rgbaPrefix: particle.rgbaPrefix,
                kind: particle.kind,
                zAbs: particle.zAbs
            };
        }
        state.visibleProjected = [];
        const field = buildFieldStars(Math.round(state.options.fieldStarCount * scale));
        state.fieldStars = field.stars;
        state.brightField = field.bright;
        const halo = buildHaloStars(Math.round(260 * scale));
        state.haloStars = halo.stars;
        state.brightHalo = halo.bright;
        state.scale = Math.min(state.cssW, state.cssH) * state.options.scaleFactor;
    }

    function ensureAssetsAsync(urgent) {
        if (state.texture) return Promise.resolve(true);
        if (urgent) state.buildUrgent = true;
        if (state.preparePromise) return state.preparePromise;

        const area = state.cssW * state.cssH;
        const scale = clamp(area / (1280 * 800), 0.7, 1.3);
        const tex = Math.round(state.options.textureSize * clamp(scale, 0.85, 1.1));
        const token = state.assetBuildToken;
        const promise = buildGalaxyTextureAsync(tex, token).then(function(texture) {
            if (!texture || token !== state.assetBuildToken) return false;
            commitAssets(texture, scale);
            return true;
        });

        state.preparePromise = promise;
        promise.finally(function() {
            if (state.preparePromise === promise) {
                state.preparePromise = null;
                state.buildUrgent = false;
            }
        });
        return promise;
    }

    function invalidateAssets() {
        state.assetBuildToken++;
        state.preparePromise = null;
        state.buildUrgent = false;
        state.texture = null;
        state.particles = null;
        state.projected = null;
        state.visibleProjected = null;
        state.fieldStars = null;
        state.brightField = null;
        state.haloStars = null;
        state.brightHalo = null;
    }

    function viewportNeedsSync() {
        const cssW = global.innerWidth;
        const cssH = global.innerHeight;
        const dpr = Math.min(global.devicePixelRatio || 1, state.options.dprCap);
        return state.cssW !== cssW
            || state.cssH !== cssH
            || state.dpr !== dpr;
    }

    function syncViewportMetrics() {
        if (!state.canvas) return false;
        const cssW = global.innerWidth;
        const cssH = global.innerHeight;
        const dpr = Math.min(global.devicePixelRatio || 1, state.options.dprCap);
        const changed = state.cssW !== cssW
            || state.cssH !== cssH
            || state.dpr !== dpr;
        if (!changed) return false;

        state.cssW = cssW;
        state.cssH = cssH;
        state.dpr = dpr;
        invalidateAssets();
        return true;
    }

    function displayCanvasNeedsResize() {
        if (!state.canvas || !state.ctx) return true;
        return state.canvas.width !== Math.round(state.cssW * state.dpr)
            || state.canvas.height !== Math.round(state.cssH * state.dpr);
    }

    function resizeCanvas() {
        if (!state.canvas) return;
        syncViewportMetrics();
        state.canvas.width = Math.round(state.cssW * state.dpr);
        state.canvas.height = Math.round(state.cssH * state.dpr);
        state.canvas.style.width = state.cssW + 'px';
        state.canvas.style.height = state.cssH + 'px';
        state.ctx = state.canvas.getContext('2d');
    }

    function needsResize() {
        return viewportNeedsSync() || !state.texture;
    }

    function prepareAssetsAsync(urgent) {
        if (!state.canvas) return Promise.resolve(false);
        syncViewportMetrics();
        return ensureAssetsAsync(Boolean(urgent));
    }

    function softRadial(ctx, x, y, r1, stops) {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r1);
        for (let i = 0; i < stops.length; i++) {
            g.addColorStop(stops[i][0], stops[i][1]);
        }
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r1, 0, Math.PI * 2);
        ctx.fill();
    }

    function drawParticleGlow(ctx, particle, radius, alpha) {
        const gradient = ctx.createRadialGradient(
            particle.sx,
            particle.sy,
            0,
            particle.sx,
            particle.sy,
            radius
        );
        const color = particle.rgbaPrefix;
        gradient.addColorStop(0, color + (alpha * 0.32) + ')');
        gradient.addColorStop(0.25, color + (alpha * 0.12) + ')');
        gradient.addColorStop(0.6, color + (alpha * 0.035) + ')');
        gradient.addColorStop(1, color + '0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(particle.sx, particle.sy, radius, 0, Math.PI * 2);
        ctx.fill();
    }

    function softEllipse(ctx, x, y, rx, ry, rot, stops) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rot);
        ctx.scale(1, ry / Math.max(rx, 0.001));
        softRadial(ctx, 0, 0, rx, stops);
        ctx.restore();
    }

    function drawSpike(ctx, x, y, len, alpha) {
        if (alpha < 0.025) return;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = 'rgba(230, 240, 255, ' + alpha + ')';
        ctx.lineWidth = 0.4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x - len, y);
        ctx.lineTo(x + len, y);
        ctx.moveTo(x, y - len);
        ctx.lineTo(x, y + len);
        ctx.stroke();
        ctx.restore();
    }

    function drawSpaceGradient(ctx, w, h) {
        const R = Math.max(w, h) * 0.9;
        const g = ctx.createRadialGradient(w * 0.5, h * 0.48, 0, w * 0.5, h * 0.5, R);
        g.addColorStop(0, 'rgba(18, 24, 55, 0.22)');
        g.addColorStop(0.4, 'rgba(10, 14, 36, 0.1)');
        g.addColorStop(0.75, 'rgba(5, 8, 22, 0.04)');
        g.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
    }

    function drawField(ctx, w, h) {
        const stars = state.fieldStars;
        for (let i = 0; i < stars.length; i++) {
            const st = stars[i];
            const a = st.a * 0.4;
            ctx.beginPath();
            ctx.fillStyle = 'rgba(' + st.cr + ',' + st.cg + ',' + st.cb + ',' + a + ')';
            ctx.arc(st.x * w, st.y * h, st.size, 0, Math.PI * 2);
            ctx.fill();
        }
        const bright = state.brightField;
        for (let i = 0; i < bright.length; i++) {
            const st = bright[i];
            const x = st.x * w;
            const y = st.y * h;
            softRadial(ctx, x, y, st.size * 7, FIELD_GLOW_STOPS);
            drawSpike(ctx, x, y, st.size * 6.5, 0.14);
        }
    }

    function drawHalo(ctx, cx, cy, s) {
        if (!state.haloStars) return;
        const stars = state.haloStars;
        const bright = state.brightHalo;
        // Project faint halo stars using fixed in-plane angle (halo doesn't co-rotate with disk)
        for (let i = 0; i < stars.length; i++) {
            const st = stars[i];
            const pr = projectInto(state.projectionScratch, st.x, st.y, st.z, 1, 0);
            const x = cx + pr.x * s;
            const y = cy + pr.y * s * 0.9;
            const a = st.a * 0.35;
            ctx.beginPath();
            ctx.fillStyle = 'rgba(' + st.cr + ',' + st.cg + ',' + st.cb + ',' + a + ')';
            ctx.arc(x, y, st.size, 0, Math.PI * 2);
            ctx.fill();
        }
        for (let i = 0; i < bright.length; i++) {
            const st = bright[i];
            const pr = projectInto(state.projectionScratch, st.x, st.y, st.z, 1, 0);
            const x = cx + pr.x * s;
            const y = cy + pr.y * s * 0.9;
            softRadial(ctx, x, y, st.size * 5, HALO_GLOW_STOPS);
        }
    }

    // Draw a single 3D-sliced layer of the galaxy disk at a specific Z-offset
    function drawGalaxySlice(ctx, cx, cy, s, angle, z, opacity, scaleFactor) {
        if (!state.texture) return;
        const tex = state.texture;
        
        // Project the Z-offset (0, 0, z) into screen coordinates
        const pr = projectInto(state.projectionScratch, 0, 0, z, 1, 0);
        
        // Base off-center offset + projected translation
        const ox = s * 0.02 + pr.x * s;
        const oy = s * -0.015 + pr.y * s * 0.9;
        const half = s * 1.06 * scaleFactor;

        ctx.save();
        ctx.translate(cx + ox, cy + oy);
        ctx.rotate((state.options.yawDeg * Math.PI) / 180);
        ctx.scale(1.02, state.squashY * 0.98);
        ctx.rotate(angle);
        ctx.globalAlpha = opacity;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(tex, -half, -half, half * 2, half * 2);
        ctx.restore();
    }

    function drawBulge(ctx, cx, cy, s, cosA, sinA) {
        // Nucleus offset from the geometric center.
        const p = projectInto(state.projectionScratch, 0.035, -0.02, 0.002, cosA, sinA);
        const bx = cx + p.x * s;
        const by = cy + p.y * s * 0.9;
        const rx = s * 0.29;
        const ry = s * 0.094 * (0.85 + state.squashY * 0.4);
        const barRot = (state.options.yawDeg * Math.PI) / 180;

        // The bulge must co-rotate with the disk pattern. We draw it in a
        // local coordinate system centered on the nucleus, rotated by the
        // in-plane disk angle so the bar/lobes spin with the arms.
        ctx.save();
        ctx.translate(bx, by);
        ctx.rotate(state.angle);
        ctx.translate(-bx, -by);

        // Boxy peanut bar along the line of nodes (Andromeda-like pseudo-bar)
        // Main bar: elongated warm glow (brighter core)
        softEllipse(ctx, bx, by, s * 0.34, s * 0.072, barRot, BULGE_BAR_STOPS);
        // Peanut side lobes
        const barLobeSep = s * 0.10;
        const brx = s * 0.13;
        const bry = s * 0.07;
        const bcos = Math.cos(barRot);
        const bsin = Math.sin(barRot);
        const lobe1x = bx + barLobeSep * bcos;
        const lobe1y = by + barLobeSep * bsin;
        const lobe2x = bx - barLobeSep * bcos;
        const lobe2y = by - barLobeSep * bsin;
        softEllipse(ctx, lobe1x, lobe1y, brx, bry, barRot, BULGE_SIDE_STOPS);
        softEllipse(ctx, lobe2x, lobe2y, brx, bry, barRot, BULGE_SIDE_STOPS);

        // Multi-lobe bloom around the core.
        for (let i = 0; i < BULGE_LOBES.length; i++) {
            const L = BULGE_LOBES[i];
            softEllipse(
                ctx,
                bx + L.dx * s,
                by + L.dy * s,
                rx * 2.4 * L.sx,
                ry * 2.6 * L.sy,
                L.rot,
                L.stops
            );
        }

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        softEllipse(ctx, bx, by, rx * 1.25, ry * 1.35, -0.28, BULGE_OUTER_STOPS);
        softEllipse(
            ctx,
            bx + s * 0.01,
            by - s * 0.005,
            rx * 0.42,
            ry * 0.45,
            -0.2,
            BULGE_INNER_STOPS
        );
        ctx.restore();

        ctx.restore();
    }

    function frame(ts) {
        if (!state.running || !state.ctx || !state.texture) {
            state.raf = 0;
            return;
        }

        const frameInterval = 1000 / state.options.targetFps;
        if (state.lastTs && ts - state.lastTs < frameInterval - 1) {
            state.raf = global.requestAnimationFrame(frame);
            return;
        }

        const dt = state.lastTs ? Math.min(0.05, (ts - state.lastTs) / 1000) : 0;
        state.lastTs = ts;
        state.angle += (Math.PI * 2 / state.options.rotationPeriodSec) * dt;

        const ctx = state.ctx;
        const dpr = state.dpr;
        const w = state.cssW;
        const h = state.cssH;
        const cx = w * 0.5;
        const cy = h * 0.52;
        const s = state.scale;
        const cosA = Math.cos(state.angle);
        const sinA = Math.sin(state.angle);
        const particles = state.particles;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        drawSpaceGradient(ctx, w, h);
        drawField(ctx, w, h);
        drawHalo(ctx, cx, cy, s);
        // 1. Project particle positions and retain only entries that can be drawn.
        const projectionSlots = state.projected;
        const projected = state.visibleProjected;
        let projectedCount = 0;
        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            const out = projectionSlots[i];
            projectInto(out, p.x, p.y, p.z, cosA, sinA);
            out.sx = cx + out.x * s;
            out.sy = cy + out.y * s * 0.9;
            if (out.sx < -40 || out.sy < -40 || out.sx > w + 40 || out.sy > h + 40) {
                continue;
            }
            projected[projectedCount++] = out;
        }
        projected.length = projectedCount;

        // 2. Sort visible particles by depth from back to front.
        projected.sort(function (a, b) {
            return a.depth - b.depth;
        });

        // 3. Reuse the depth-sorted disk and bulge slices for this view matrix.
        const staticItems = state.staticItems;

        // 4. Merge the depth-sorted slices, bulge, and stars into one draw pass.
        let pIdx = 0;
        let sIdx = 0;
        const numParticles = projected.length;
        const numStatic = staticItems.length;

        while (pIdx < numParticles || sIdx < numStatic) {
            const nextIsStatic = sIdx < numStatic && (pIdx >= numParticles || staticItems[sIdx].depth <= projected[pIdx].depth);

            if (nextIsStatic) {
                const item = staticItems[sIdx++];
                if (item.type === 'slice') {
                    drawGalaxySlice(ctx, cx, cy, s, state.angle, item.z, item.opacity, item.scale);
                } else if (item.type === 'bulge') {
                    drawBulge(ctx, cx, cy, s, cosA, sinA);
                }
            } else {
                const p = projected[pIdx++];
                const depthFade = clamp(0.72 + p.depth * 0.45, 0.36, 1.2);
                // Near-side thickness cue
                const thick = 1 + p.zAbs * 8;
                const alpha = clamp(p.brightness * depthFade * 0.75, 0.03, 0.9);
                const radius = p.size * (0.6 + depthFade * 0.5) * thick;

                if (p.kind === 'bright' || p.kind === 'core') {
                    drawParticleGlow(ctx, p, radius * 5, alpha);
                    if (p.kind === 'bright') {
                        drawSpike(ctx, p.sx, p.sy, radius * 3.2, alpha * 0.35);
                    }
                }

                ctx.beginPath();
                ctx.fillStyle = p.rgbaPrefix + alpha + ')';
                ctx.arc(p.sx, p.sy, radius, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        state.raf = global.requestAnimationFrame(frame);
    }

    function canAnimate() {
        return !prefersReducedMotion() && document.visibilityState === 'visible';
    }

    function startLoop() {
        if (!state.canvas || state.running || !state.wantRun || !canAnimate()) return;
        if (needsResize()) {
            prepareAssetsAsync(true).then(function(prepared) {
                if (prepared) startLoop();
            }).catch(function(error) {
                console.error('Could not prepare dark background:', error);
            });
            return;
        }
        if (displayCanvasNeedsResize()) resizeCanvas();
        state.running = true;
        state.lastTs = 0;
        if (!state.raf) {
            state.raf = global.requestAnimationFrame(frame);
        }
    }

    function stopLoop(clear) {
        state.running = false;
        state.lastTs = 0;
        if (state.raf) {
            global.cancelAnimationFrame(state.raf);
            state.raf = 0;
        }
        if (clear && state.ctx && state.canvas) {
            state.ctx.setTransform(1, 0, 0, 1, 0, 0);
            state.ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
        }
    }

    function syncRuntime() {
        if (state.wantRun && canAnimate()) {
            startLoop();
        } else {
            stopLoop(true);
        }
    }

    function onResize() {
        global.clearTimeout(state.resizeTimer);
        state.resizeTimer = global.setTimeout(function () {
            if (!state.canvas) return;
            if (state.running) {
                if (needsResize()) {
                    stopLoop(false);
                    prepareAssetsAsync(true).then(function(prepared) {
                        if (prepared) startLoop();
                    }).catch(function(error) {
                        console.error('Could not prepare dark background:', error);
                    });
                }
            } else if (state.wantRun && canAnimate()) {
                startLoop();
            }
        }, 120);
    }

    function resolveCanvas(target) {
        if (!target) return null;
        if (typeof target === 'string') return document.querySelector(target);
        if (target && target.tagName === 'CANVAS') return target;
        return null;
    }

    function bindListeners() {
        if (state.listenersBound) return;
        global.addEventListener('resize', onResize);
        document.addEventListener('visibilitychange', syncRuntime);
        getMotionQuery().addEventListener('change', syncRuntime);
        state.listenersBound = true;
    }

    function unbindListeners() {
        if (!state.listenersBound) return;
        global.removeEventListener('resize', onResize);
        document.removeEventListener('visibilitychange', syncRuntime);
        getMotionQuery().removeEventListener('change', syncRuntime);
        state.listenersBound = false;
    }

    const api = {
        init: function (target, options) {
            const canvas = resolveCanvas(target);
            if (!canvas) return false;
            const shouldResume = state.wantRun;
            stopLoop(true);
            state.canvas = canvas;
            state.ctx = null;
            state.options = Object.assign({}, DEFAULTS, options || {});
            updateViewMatrix();
            invalidateAssets();
            bindListeners();
            if (shouldResume) syncRuntime();
            return true;
        },

        prepare: function () {
            if (!state.canvas) return false;
            syncViewportMetrics();
            if (state.preparePromise) return false;
            ensureAssets();
            return Boolean(state.texture);
        },

        prepareAsync: function () {
            return prepareAssetsAsync(false);
        },

        start: function () {
            state.wantRun = true;
            syncRuntime();
        },

        stop: function () {
            state.wantRun = false;
            stopLoop(true);
        },

        isRunning: function () {
            return state.running;
        },

        destroy: function () {
            state.wantRun = false;
            stopLoop(true);
            unbindListeners();
            global.clearTimeout(state.resizeTimer);
            state.resizeTimer = 0;
            state.motionQuery = null;
            state.canvas = null;
            state.ctx = null;
            invalidateAssets();
        }
    };

    global.StarfieldBackground = api;
})(typeof window !== 'undefined' ? window : this);
