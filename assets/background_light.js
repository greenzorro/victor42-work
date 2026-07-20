/*
 * File: background_light.js
 * Project: victor42-work (portable)
 * Description: Soft, layered leaf shadows for light surfaces.
 *
 * Pipeline:
 *  1) Build deterministic branch-and-leaf silhouettes on offscreen canvases
 *  2) Pre-blur and fade three depth layers to create a natural penumbra
 *  3) Each frame: drive damped spring transforms with a shared gust force
 *
 * API: LeafShadowBackground.init / start / stop / isRunning / destroy
 */
(function (global) {
    'use strict';

    const DEFAULTS = {
        targetFps: 24,
        dprCap: 1.5,
        textureWidth: 1000,
        textureHeight: 900,
        seed: 20260720,
        shadowColor: '#26342e',
        shadowOpacity: 0.14,
        windStrength: 1.28,
        verticalStretch: 1.18,
        minDisplayWidth: 520,
        maxDisplayWidth: 960,
        widthRatio: 0.48,
        heightRatio: 0.87,
        edgeOverscan: 0.16
    };

    const LAYER_SPECS = [
        {
            blur: 22,
            phase: 0.2,
            rotationDeg: 1.1,
            shiftX: 6,
            shiftY: 4,
            pivotX: 20,
            pivotY: 10
        },
        {
            blur: 12.5,
            phase: 2.1,
            rotationDeg: 2,
            shiftX: 11,
            shiftY: 7,
            pivotX: 55,
            pivotY: 35
        },
        {
            blur: 6.5,
            phase: 4.4,
            rotationDeg: 3,
            shiftX: 17,
            shiftY: 10,
            pivotX: 100,
            pivotY: 55
        }
    ];

    const LAYER_LAYOUTS = [
        {
            branches: [
                [-170, -95, 120, -35, 440, 30, 910, 92, 11],
                [-165, -90, 95, 20, 390, 125, 770, 275, 10],
                [-155, -80, 60, 80, 310, 260, 625, 455, 8],
                [-145, -65, 35, 145, 185, 370, 360, 560, 6],
                [10, 35, 230, 65, 445, 110, 705, 190, 5]
            ]
        },
        {
            branches: [
                [-145, -80, 125, -25, 415, 38, 855, 105, 8],
                [-140, -75, 95, 35, 350, 145, 720, 295, 7],
                [-130, -65, 55, 95, 270, 275, 580, 475, 6],
                [-120, -50, 25, 160, 150, 380, 330, 565, 5],
                [25, 45, 220, 80, 410, 125, 650, 210, 4]
            ]
        },
        {
            branches: [
                [-115, -65, 120, -12, 390, 45, 795, 112, 6],
                [-110, -60, 85, 48, 320, 160, 665, 310, 5],
                [-100, -50, 45, 110, 235, 285, 530, 490, 4],
                [-90, -35, 15, 175, 125, 390, 300, 570, 3],
                [40, 55, 215, 88, 375, 135, 585, 218, 3]
            ]
        }
    ];

    const CANOPY_SPECS = [
        {
            rowGap: 118,
            columnGap: 126,
            radiusX: 122,
            radiusY: 94,
            leafCount: 26,
            baseSize: 52,
            heading: 0.38,
            yOffset: -35
        },
        {
            rowGap: 104,
            columnGap: 112,
            radiusX: 101,
            radiusY: 78,
            leafCount: 22,
            baseSize: 46,
            heading: 0.48,
            yOffset: -18
        },
        {
            rowGap: 94,
            columnGap: 101,
            radiusX: 79,
            radiusY: 60,
            leafCount: 17,
            baseSize: 39,
            heading: 0.58,
            yOffset: 4
        }
    ];

    const BRANCH_GROUPS = [0, 1, 2, 3, 4];

    const GROUP_MOTION = [
        { phase: 0.0, speed: 0.74, amplitude: 0.78, gustDelay: 0.0 },
        { phase: 1.35, speed: 1.08, amplitude: 1.16, gustDelay: 0.26 },
        { phase: 2.8, speed: 0.89, amplitude: 0.94, gustDelay: 0.58 },
        { phase: 4.25, speed: 1.22, amplitude: 1.24, gustDelay: 0.96 },
        { phase: 5.7, speed: 0.68, amplitude: 0.84, gustDelay: 1.3 }
    ];

    const state = {
        canvas: null,
        ctx: null,
        maskCanvas: null,
        maskCtx: null,
        layers: null,
        raf: 0,
        running: false,
        wantRun: false,
        lastTs: 0,
        elapsed: 0,
        dpr: 1,
        cssW: 0,
        cssH: 0,
        resizeTimer: 0,
        listenersBound: false,
        motionQuery: null,
        options: Object.assign({}, DEFAULTS)
    };

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function lerp(a, b, amount) {
        return a + (b - a) * amount;
    }

    function toRadians(degrees) {
        return degrees * Math.PI / 180;
    }

    function mulberry32(seed) {
        return function () {
            let value = (seed += 0x6d2b79f5);
            value = Math.imul(value ^ (value >>> 15), value | 1);
            value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
            return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
        };
    }

    function hash2(x, y, seed) {
        const value = Math.sin(
            x * 127.1 + y * 311.7 + seed * 0.013
        ) * 43758.5453123;
        return value - Math.floor(value);
    }

    function valueNoise(x, y, seed) {
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const fx = x - x0;
        const fy = y - y0;
        const ux = fx * fx * (3 - 2 * fx);
        const uy = fy * fy * (3 - 2 * fy);
        const a = hash2(x0, y0, seed);
        const b = hash2(x0 + 1, y0, seed);
        const c = hash2(x0, y0 + 1, seed);
        const d = hash2(x0 + 1, y0 + 1, seed);
        return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
    }

    function densityNoise(x, y, seed) {
        const broad = valueNoise(x * 0.006, y * 0.006, seed);
        const detail = valueNoise(x * 0.014, y * 0.014, seed + 37);
        return broad * 0.72 + detail * 0.28;
    }

    function getMotionQuery() {
        if (!state.motionQuery) {
            state.motionQuery = global.matchMedia('(prefers-reduced-motion: reduce)');
        }
        return state.motionQuery;
    }

    function prefersReducedMotion() {
        return getMotionQuery().matches;
    }

    function createCanvas(width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }

    function drawLeaf(ctx, x, y, length, width, angle) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(-length * 0.52, 0);
        ctx.bezierCurveTo(
            -length * 0.18, -width * 0.58,
            length * 0.2, -width * 0.55,
            length * 0.52, 0
        );
        ctx.bezierCurveTo(
            length * 0.2, width * 0.55,
            -length * 0.18, width * 0.58,
            -length * 0.52, 0
        );
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    function drawBranch(ctx, branch) {
        ctx.lineWidth = branch[8];
        ctx.beginPath();
        ctx.moveTo(branch[0], branch[1]);
        ctx.bezierCurveTo(
            branch[2], branch[3],
            branch[4], branch[5],
            branch[6], branch[7]
        );
        ctx.stroke();
    }

    function pointOnBranch(branch, t) {
        const inverse = 1 - t;
        const inverseSquared = inverse * inverse;
        const tSquared = t * t;
        const x = inverseSquared * inverse * branch[0]
            + 3 * inverseSquared * t * branch[2]
            + 3 * inverse * tSquared * branch[4]
            + tSquared * t * branch[6];
        const y = inverseSquared * inverse * branch[1]
            + 3 * inverseSquared * t * branch[3]
            + 3 * inverse * tSquared * branch[5]
            + tSquared * t * branch[7];
        const dx = 3 * inverseSquared * (branch[2] - branch[0])
            + 6 * inverse * t * (branch[4] - branch[2])
            + 3 * tSquared * (branch[6] - branch[4]);
        const dy = 3 * inverseSquared * (branch[3] - branch[1])
            + 6 * inverse * t * (branch[5] - branch[3])
            + 3 * tSquared * (branch[7] - branch[5]);
        return { x: x, y: y, heading: Math.atan2(dy, dx) };
    }

    function drawBranchTipLeaves(ctx, branch, layerIndex, random) {
        const spec = CANOPY_SPECS[layerIndex];
        const placements = [
            { t: 0.8, radiusScale: 0.5, countScale: 0.5, sizeScale: 0.88 },
            { t: 0.97, radiusScale: 0.68, countScale: 0.72, sizeScale: 0.96 }
        ];

        for (let i = 0; i < placements.length; i++) {
            const placement = placements[i];
            const point = pointOnBranch(branch, placement.t);
            drawLeafCluster(ctx, [
                point.x,
                point.y,
                spec.radiusX * placement.radiusScale,
                spec.radiusY * placement.radiusScale,
                Math.max(8, Math.round(spec.leafCount * placement.countScale)),
                point.heading,
                spec.baseSize * placement.sizeScale
            ], random);
        }
    }

    function drawLeafCluster(ctx, cluster, random) {
        const cx = cluster[0];
        const cy = cluster[1];
        const radiusX = cluster[2];
        const radiusY = cluster[3];
        const count = cluster[4];
        const heading = cluster[5];
        const baseSize = cluster[6];

        for (let i = 0; i < count; i++) {
            const orbit = random() * Math.PI * 2;
            const distance = Math.sqrt(random());
            const x = cx + Math.cos(orbit) * radiusX * distance;
            const y = cy + Math.sin(orbit) * radiusY * distance;
            const length = baseSize * lerp(0.68, 1.28, random());
            const width = length * lerp(0.42, 0.62, random());
            const radialInfluence = Math.atan2(y - cy, x - cx) * 0.28;
            const angle = heading + radialInfluence + (random() - 0.5) * 1.25;

            ctx.lineWidth = lerp(1.2, 2.7, random());
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.quadraticCurveTo(
                lerp(cx, x, 0.58) + (random() - 0.5) * 14,
                lerp(cy, y, 0.58) + (random() - 0.5) * 14,
                x,
                y
            );
            ctx.stroke();
            drawLeaf(ctx, x, y, length, width, angle);
        }
    }

    function applyEdgeFade(ctx, width, height) {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-in';

        const horizontal = ctx.createLinearGradient(0, 0, width, 0);
        horizontal.addColorStop(0, 'rgba(0,0,0,1)');
        horizontal.addColorStop(0.82, 'rgba(0,0,0,0.98)');
        horizontal.addColorStop(0.94, 'rgba(0,0,0,0.58)');
        horizontal.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = horizontal;
        ctx.fillRect(0, 0, width, height);

        const vertical = ctx.createLinearGradient(0, 0, 0, height);
        vertical.addColorStop(0, 'rgba(0,0,0,1)');
        vertical.addColorStop(0.84, 'rgba(0,0,0,0.98)');
        vertical.addColorStop(0.95, 'rgba(0,0,0,0.5)');
        vertical.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = vertical;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
    }

    function blurTexture(source, blurRadius) {
        const output = createCanvas(source.width, source.height);
        const ctx = output.getContext('2d');

        ctx.filter = 'blur(' + blurRadius + 'px)';
        ctx.drawImage(source, 0, 0);
        ctx.filter = 'blur(' + Math.max(1, blurRadius * 0.12) + 'px)';
        ctx.globalAlpha = 0.985;
        ctx.drawImage(source, 0, 0);
        ctx.filter = 'none';
        ctx.globalAlpha = 1;
        return output;
    }

    function buildCanopyClusters(layerIndex, random) {
        const clusters = [];
        const spec = CANOPY_SPECS[layerIndex];
        const width = state.options.textureWidth;
        const height = state.options.textureHeight;
        let rowIndex = 0;

        for (let y = spec.yOffset; y < height * 0.96; y += spec.rowGap) {
            const t = clamp((y + 42) / (height - 16), 0, 1);
            const curvedEdge = width * 0.93 * (1 - Math.pow(t, 1.55));
            const outwardBulge = Math.sin(t * Math.PI) * width * 0.07;
            const edgeX = curvedEdge + outwardBulge;
            const stagger = rowIndex % 2 === 0 ? 0 : spec.columnGap * 0.43;

            for (let x = -36 + stagger; x <= edgeX; x += spec.columnGap) {
                const candidateX = x + (random() - 0.5) * 30;
                const candidateY = y + (random() - 0.5) * 26;
                const normalizedX = Math.max(0, candidateX) / width;
                const normalizedY = Math.max(0, candidateY) / height;
                const cornerDistance = Math.hypot(normalizedX, normalizedY) / 1.12;
                const cornerBias = 1 - clamp(cornerDistance, 0, 1);
                const innerDepth = clamp(
                    (edgeX - candidateX) / (spec.columnGap * 2.75),
                    0,
                    1
                );
                const patch = densityNoise(
                    candidateX,
                    candidateY,
                    state.options.seed + layerIndex * 101
                );
                const sharedMicroGap = valueNoise(
                    candidateX * 0.03,
                    candidateY * 0.03,
                    state.options.seed + 509
                );
                const microGapPenalty = sharedMicroGap < 0.45
                    ? (0.45 - sharedMicroGap) * 1.42
                    : 0;
                const localDensity = clamp(
                    0.28
                        + cornerBias * 0.42
                        + innerDepth * 0.28
                        + (patch - 0.5) * 0.54
                        - microGapPenalty,
                    0.07,
                    0.99
                );

                if (random() > localDensity) continue;

                const sizeVariation = lerp(0.82, 1.2, random())
                    * lerp(0.88, 1.12, localDensity);
                const angle = Math.atan2(
                    Math.max(0, candidateY) + 58,
                    Math.max(0, candidateX) + 72
                );
                const groupIndex = clamp(
                    Math.round(
                        angle / (Math.PI * 0.5) * (GROUP_MOTION.length - 1)
                        + (random() - 0.5) * 0.62
                    ),
                    0,
                    GROUP_MOTION.length - 1
                );

                clusters.push({
                    group: groupIndex,
                    data: [
                        candidateX,
                        candidateY,
                        spec.radiusX * sizeVariation,
                        spec.radiusY * lerp(0.84, 1.16, random()),
                        Math.round(
                            spec.leafCount
                            * lerp(0.4, 1.32, localDensity)
                            * lerp(0.86, 1.14, random())
                        ),
                        spec.heading + t * 0.42 + (random() - 0.5) * 0.28,
                        spec.baseSize * lerp(0.9, 1.1, random())
                    ]
                });
            }
            rowIndex++;
        }
        return clusters;
    }

    function buildMotionSpec(layerIndex, groupIndex) {
        const layer = LAYER_SPECS[layerIndex];
        const motion = GROUP_MOTION[groupIndex];
        const referenceStiffness = 38 + motion.speed * 9 + layerIndex * 2.5;
        const stiffness = referenceStiffness * 0.86;
        return {
            phase: layer.phase + motion.phase,
            responseSpeed: motion.speed * (1 + layerIndex * 0.045),
            gustDelay: motion.gustDelay + layerIndex * 0.06,
            stiffness: stiffness,
            damping: 2 * 0.92 * Math.sqrt(stiffness),
            forceScale: referenceStiffness,
            rotationDeg: layer.rotationDeg * motion.amplitude,
            shiftX: layer.shiftX * motion.amplitude,
            shiftY: layer.shiftY * motion.amplitude,
            pivotX: layer.pivotX + groupIndex * 6,
            pivotY: layer.pivotY + (GROUP_MOTION.length - 1 - groupIndex) * 5
        };
    }

    function buildLayerTextures(layerIndex) {
        const width = state.options.textureWidth;
        const height = state.options.textureHeight;
        const layout = LAYER_LAYOUTS[layerIndex];
        const random = mulberry32(state.options.seed + layerIndex * 7919);
        const clusters = buildCanopyClusters(layerIndex, random);
        const textures = [];

        for (let groupIndex = 0; groupIndex < GROUP_MOTION.length; groupIndex++) {
            const raw = createCanvas(width, height);
            const ctx = raw.getContext('2d');

            ctx.fillStyle = state.options.shadowColor;
            ctx.strokeStyle = state.options.shadowColor;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            for (let i = 0; i < layout.branches.length; i++) {
                if (BRANCH_GROUPS[i] === groupIndex) {
                    drawBranch(ctx, layout.branches[i]);
                    drawBranchTipLeaves(
                        ctx,
                        layout.branches[i],
                        layerIndex,
                        random
                    );
                }
            }
            for (let i = 0; i < clusters.length; i++) {
                if (clusters[i].group === groupIndex) {
                    drawLeafCluster(ctx, clusters[i].data, random);
                }
            }

            const texture = blurTexture(raw, LAYER_SPECS[layerIndex].blur);
            applyEdgeFade(texture.getContext('2d'), width, height);
            textures.push({
                texture: texture,
                spec: buildMotionSpec(layerIndex, groupIndex),
                spring: {
                    displacement: 0,
                    velocity: 0
                }
            });
        }
        return textures;
    }

    function ensureLayers() {
        if (state.layers) return;
        state.layers = [];
        for (let i = 0; i < LAYER_SPECS.length; i++) {
            const layerTextures = buildLayerTextures(i);
            for (let j = 0; j < layerTextures.length; j++) {
                state.layers.push(layerTextures[j]);
            }
        }
    }

    function invalidateLayers() {
        state.layers = null;
    }

    function resize() {
        if (!state.canvas) return;
        const cssW = global.innerWidth;
        const cssH = global.innerHeight;
        const dpr = Math.min(global.devicePixelRatio || 1, state.options.dprCap);

        state.cssW = cssW;
        state.cssH = cssH;
        state.dpr = dpr;
        state.canvas.width = Math.round(cssW * dpr);
        state.canvas.height = Math.round(cssH * dpr);
        state.canvas.style.width = cssW + 'px';
        state.canvas.style.height = cssH + 'px';
        state.ctx = state.canvas.getContext('2d');
        if (!state.maskCanvas) {
            state.maskCanvas = createCanvas(state.canvas.width, state.canvas.height);
        } else {
            state.maskCanvas.width = state.canvas.width;
            state.maskCanvas.height = state.canvas.height;
        }
        state.maskCtx = state.maskCanvas.getContext('2d');
        invalidateLayers();
        ensureLayers();
    }

    function needsResize() {
        if (!state.canvas || !state.ctx || !state.maskCanvas || !state.maskCtx || !state.layers) return true;
        const cssW = global.innerWidth;
        const cssH = global.innerHeight;
        const dpr = Math.min(global.devicePixelRatio || 1, state.options.dprCap);
        return state.cssW !== cssW
            || state.cssH !== cssH
            || state.dpr !== dpr
            || state.canvas.width !== Math.round(cssW * dpr)
            || state.canvas.height !== Math.round(cssH * dpr)
            || state.maskCanvas.width !== state.canvas.width
            || state.maskCanvas.height !== state.canvas.height;
    }

    function getPlacement() {
        const responsiveWidth = state.cssW < 640
            ? state.cssW * 1.16
            : Math.min(
                state.cssW * state.options.widthRatio,
                state.cssH * state.options.heightRatio
            );
        const visibleWidth = clamp(
            responsiveWidth,
            state.cssW < 640 ? 440 : state.options.minDisplayWidth,
            state.options.maxDisplayWidth
        );
        const displayWidth = visibleWidth / (1 - state.options.edgeOverscan);
        const scale = displayWidth / state.options.textureWidth;
        const scaleY = scale * state.options.verticalStretch;
        return {
            x: -displayWidth * state.options.edgeOverscan,
            y: -state.options.textureHeight * scaleY * state.options.edgeOverscan,
            scale: scale,
            scaleY: scaleY
        };
    }

    function gustForceAt(time) {
        // Incommensurate waves approximate a broad gust plus smaller turbulent
        // eddies. Their sum has no short, visibly repeating rise-and-fall cycle.
        const broad = Math.sin(time * 0.35 + 0.4) * 0.3;
        const medium = Math.sin(time * 0.79 + 2.1) * 0.2;
        const short = Math.sin(time * 1.69 - 0.8) * 0.11;
        const turbulence = Math.sin(time * 3.17 + 1.7) * 0.05;
        const normalized = clamp(
            0.34 + broad + medium + short + turbulence,
            0,
            1
        );
        return normalized * normalized * (3 - 2 * normalized);
    }

    function stepSpring(spring, force, dt, stiffness, damping) {
        if (dt <= 0) return;
        const acceleration = force - spring.displacement * stiffness
            - spring.velocity * damping;
        spring.velocity += acceleration * dt;
        spring.displacement += spring.velocity * dt;
    }

    function draw(time, dt) {
        if (!state.ctx || !state.maskCtx || !state.layers) return;
        const ctx = state.ctx;
        const maskCtx = state.maskCtx;
        const dpr = state.dpr;
        const placement = getPlacement();

        maskCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        maskCtx.clearRect(0, 0, state.cssW, state.cssH);
        maskCtx.globalCompositeOperation = 'source-over';

        for (let i = 0; i < state.layers.length; i++) {
            const layer = state.layers[i];
            const spec = layer.spec;
            // The same wind field reaches nearby branch groups a fraction apart,
            // staggering peak deformation without changing the wind direction.
            const delayedGust = gustForceAt(time - spec.gustDelay)
                * state.options.windStrength;
            const response = 0.92
                + Math.sin(time * spec.responseSpeed + spec.phase) * 0.08;
            stepSpring(
                layer.spring,
                delayedGust * response * spec.forceScale,
                dt,
                spec.stiffness,
                spec.damping
            );
            const displacement = layer.spring.displacement;
            const pivotX = placement.x + spec.pivotX * placement.scale;
            const pivotY = placement.y + spec.pivotY * placement.scaleY;
            const rotation = toRadians(spec.rotationDeg * displacement);

            maskCtx.save();
            maskCtx.globalAlpha = 1;
            maskCtx.translate(
                pivotX + spec.shiftX * displacement,
                pivotY + spec.shiftY * displacement
            );
            // Project after branch rotation so the elongation direction remains
            // fixed to the page instead of rotating with each branch group.
            maskCtx.scale(placement.scale, placement.scaleY);
            maskCtx.rotate(rotation);
            maskCtx.translate(-spec.pivotX, -spec.pivotY);
            maskCtx.drawImage(layer.texture, 0, 0);
            maskCtx.restore();
        }

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
        ctx.globalAlpha = state.options.shadowOpacity;
        ctx.drawImage(state.maskCanvas, 0, 0);
        ctx.globalAlpha = 1;
    }

    function frame(ts) {
        if (!state.running || !state.ctx || !state.layers) {
            state.raf = 0;
            return;
        }

        const frameInterval = 1000 / state.options.targetFps;
        if (state.lastTs && ts - state.lastTs < frameInterval - 1) {
            state.raf = global.requestAnimationFrame(frame);
            return;
        }

        const dt = state.lastTs ? Math.min(0.08, (ts - state.lastTs) / 1000) : 0;
        state.lastTs = ts;
        state.elapsed += dt;
        draw(state.elapsed, dt);
        state.raf = global.requestAnimationFrame(frame);
    }

    function canAnimate() {
        return !prefersReducedMotion() && document.visibilityState === 'visible';
    }

    function renderStatic() {
        if (!state.canvas || !state.wantRun || document.visibilityState !== 'visible') return;
        if (needsResize()) resize();
        draw(state.elapsed, 0);
    }

    function startLoop() {
        if (!state.canvas || state.running || !state.wantRun || !canAnimate()) return;
        if (needsResize()) resize();
        state.running = true;
        state.lastTs = 0;
        draw(state.elapsed, 0);
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
        if (clear && state.maskCtx && state.maskCanvas) {
            state.maskCtx.setTransform(1, 0, 0, 1, 0, 0);
            state.maskCtx.clearRect(0, 0, state.maskCanvas.width, state.maskCanvas.height);
        }
    }

    function syncRuntime() {
        if (!state.wantRun) {
            stopLoop(true);
        } else if (canAnimate()) {
            startLoop();
        } else if (prefersReducedMotion()) {
            stopLoop(false);
            renderStatic();
        } else {
            stopLoop(false);
        }
    }

    function onResize() {
        global.clearTimeout(state.resizeTimer);
        state.resizeTimer = global.setTimeout(function () {
            if (!state.canvas || !state.wantRun) return;
            if (needsResize()) resize();
            if (state.running || prefersReducedMotion()) {
                draw(state.elapsed, 0);
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
            invalidateLayers();
            bindListeners();
            if (shouldResume) syncRuntime();
            return true;
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
            state.maskCanvas = null;
            state.maskCtx = null;
            invalidateLayers();
        }
    };

    global.LeafShadowBackground = api;
})(typeof window !== 'undefined' ? window : this);
