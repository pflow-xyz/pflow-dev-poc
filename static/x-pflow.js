class PetriView extends HTMLElement {
    constructor() {
        super();
        this._model = {};
        this._root = null;
        this._canvas = null;
        this._ctx = null;
        this._nodes = {}; // id -> element
        this._ro = null;
        this._dpr = window.devicePixelRatio || 1;
    }

    connectedCallback() {
        if (this._root) return;
        this._root = document.createElement('div');
        this._root.className = 'pv-root';
        this.appendChild(this._root);

        this._canvas = document.createElement('canvas');
        this._canvas.className = 'pv-canvas';
        this._root.appendChild(this._canvas);
        this._ctx = this._canvas.getContext('2d');

        // parse model from a child script[type="application/ld+json"]
        const ld = this.querySelector('script[type="application/ld+json"]');
        if (ld && ld.textContent) {
            try { this._model = JSON.parse(ld.textContent); } catch(e) { this._model = {}; }
        }

        this._renderUI();
        // redraw on resize
        this._ro = new ResizeObserver(() => this._onResize());
        this._ro.observe(this._root);
        window.addEventListener('load', () => this._onResize());
    }

    disconnectedCallback() {
        if (this._ro) this._ro.disconnect();
        window.removeEventListener('load', this._onResize);
    }

    setModel(m) {
        this._model = m || {};
        this._renderUI();
    }

    getModel() { return this._model; }

    _renderUI() {
        // clear existing nodes (leave canvas)
        Object.values(this._nodes).forEach(n => n.remove());
        this._nodes = {};

        const places = this._model.places || {};
        const transitions = this._model.transitions || {};
        const arcs = this._model.arcs || [];

        // create elements for places
        Object.entries(places).forEach(([id, p]) => {
            const el = document.createElement('div');
            el.className = 'pv-node pv-place';
            el.dataset.id = id;
            // center the place at p.x, p.y using outer 80px box (so subtract 40)
            el.style.left = `${(p.x || 0) - 40}px`;
            el.style.top = `${(p.y || 0) - 40}px`;

            // invisible handle circle for hit testing (keeps same center)
            const handle = document.createElement('div');
            handle.className = 'pv-place-handle';
            el.appendChild(handle);

            // inner visible circle (r ~16)
            const inner = document.createElement('div');
            inner.className = 'pv-place-inner';
            el.appendChild(inner);

            const label = document.createElement('div');
            label.className = 'pv-label';
            label.textContent = id;
            el.appendChild(label);

            const tokenCount = Array.isArray(p.initial) ? p.initial.reduce((s, v)=>s+ (Number(v)||0), 0) : 0;
            if (tokenCount > 1) {
                const token = document.createElement('div');
                token.className = 'pv-token';
                token.textContent = ''+tokenCount;
                el.appendChild(token);
            } else if (tokenCount === 1) {
                const dot = document.createElement('div');
                dot.className = 'pv-token-dot';
                el.appendChild(dot);
            }

            this._root.appendChild(el);
            this._nodes[id] = el;
        });

        // create elements for transitions
        Object.entries(transitions).forEach(([id, t]) => {
            const el = document.createElement('div');
            el.className = 'pv-node pv-transition';
            el.dataset.id = id;
            // center the 30x30 rect at t.x,t.y => subtract 15
            el.style.left = `${(t.x || 0) - 15}px`;
            el.style.top = `${(t.y || 0) - 15}px`;

            const label = document.createElement('div');
            label.className = 'pv-label';
            label.textContent = id;
            el.appendChild(label);

            // interaction: firing (simple visual pulse)
            el.addEventListener('click', () => {
                el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 250 });
                this.dispatchEvent(new CustomEvent('transition-fired', { detail: { id } }));
            });

            this._root.appendChild(el);
            this._nodes[id] = el;
        });

        // weight badges near middle of arc (created as DOM for accessibility)
        arcs.forEach((arc, idx) => {
            const w = (() => {
                if (arc.weight == null) return 1;
                if (Array.isArray(arc.weight)) return Number(arc.weight[0]) || 1;
                return Number(arc.weight) || 1;
            })();
            const badge = document.createElement('div');
            badge.className = 'pv-weight';
            badge.style.pointerEvents = 'none';
            badge.dataset.arc = idx;
            badge.textContent = w > 1 ? `${w}` : '1';
            this._root.appendChild(badge);
        });
        this._onResize();
    }

    _onResize() {
        // size canvas
        const rect = this._root.getBoundingClientRect();
        const w = Math.max(300, Math.floor(rect.width));
        const h = Math.max(200, Math.floor(rect.height));
        this._canvas.width = Math.floor(w * this._dpr);
        this._canvas.height = Math.floor(h * this._dpr);
        this._canvas.style.width = `${w}px`;
        this._canvas.style.height = `${h}px`;
        this._ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);

        this._draw();
    }

    _draw() {
        const ctx = this._ctx;
        ctx.clearRect(0,0,this._canvas.width/this._dpr, this._canvas.height/this._dpr);
        ctx.lineWidth = 1;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const arcs = this._model.arcs || [];
        arcs.forEach((arc, idx) => {
            const srcEl = this._nodes[arc.source];
            const trgEl = this._nodes[arc.target];
            if (!srcEl || !trgEl) return;

            const srcRect = srcEl.getBoundingClientRect();
            const trgRect = trgEl.getBoundingClientRect();
            const rootRect = this._root.getBoundingClientRect();

            const sx = (srcRect.left + srcRect.width/2) - rootRect.left;
            const sy = (srcRect.top + srcRect.height/2) - rootRect.top;
            const tx = (trgRect.left + trgRect.width/2) - rootRect.left;
            const ty = (trgRect.top + trgRect.height/2) - rootRect.top;

            const srcIsPlace = srcEl.classList.contains('pv-place');
            const trgIsPlace = trgEl.classList.contains('pv-place');

            const padPlace = 16 + 2;
            const padTransition = 15 + 2;
            const padSrc = srcIsPlace ? padPlace : padTransition;
            const padTrg = trgIsPlace ? padPlace : padTransition;

            const dx = tx - sx, dy = ty - sy;
            const dist = Math.hypot(dx, dy) || 1;
            const ux = dx / dist, uy = dy / dist;

            // arrow/marker sizes
            const ahSize = 8;
            const inhibitRadius = 6;
            // tipOffset moves the arrow tip away from the node boundary so the head doesn't overlap
            const tipOffset = arc.inhibitTransition ? (inhibitRadius + 2) : (ahSize * 0.9);

            const ex = sx + ux * padSrc;
            const ey = sy + uy * padSrc;
            // subtract additional tipOffset from the target padding
            const fx = tx - ux * (padTrg + tipOffset);
            const fy = ty - uy * (padTrg + tipOffset);

            // line style
            if (arc.inhibitTransition) {
                ctx.strokeStyle = '#c0392b';
                ctx.setLineDash([6,4]);
            } else {
                ctx.strokeStyle = '#000000';
                ctx.setLineDash([]);
            }

            // draw straight line
            ctx.beginPath();
            ctx.moveTo(ex, ey);
            ctx.lineTo(fx, fy);
            ctx.stroke();

            // arrowhead at target (use direction ux,uy)
            const tpx = fx, tpy = fy;
            if (arc.inhibitTransition) {
                ctx.beginPath();
                ctx.fillStyle = '#c0392b';
                ctx.setLineDash([]);
                ctx.arc(tpx, tpy, inhibitRadius, 0, Math.PI*2);
                ctx.fill();
                ctx.beginPath();
                ctx.fillStyle = '#ffffff';
                ctx.arc(tpx, tpy, 2.5, 0, Math.PI*2);
                ctx.fill();
            } else {
                const leftx = tpx - ux * ahSize - uy * (ahSize * 0.6);
                const lefty = tpy - uy * ahSize + ux * (ahSize * 0.6);
                const rightx = tpx - ux * ahSize + uy * (ahSize * 0.6);
                const righty = tpy - uy * ahSize - ux * (ahSize * 0.6);

                ctx.beginPath();
                ctx.fillStyle = '#000000';
                ctx.setLineDash([]);
                ctx.moveTo(tpx, tpy);
                ctx.lineTo(leftx, lefty);
                ctx.lineTo(rightx, righty);
                ctx.closePath();
                ctx.fill();
            }

            // place weight badge at midpoint of straight line
            const bx = (ex + fx) / 2;
            const by = (ey + fy) / 2;
            const badge = this._root.querySelector(`.pv-weight[data-arc="${idx}"]`);
            if (badge) {
                badge.style.left = `${bx - 12}px`;
                badge.style.top = `${by - 10}px`;
            }
        });
    }

    _cubicAt(a, b, c, d, t) {
        const mt = 1 - t;
        return mt*mt*mt*a + 3*mt*mt*t*b + 3*mt*t*t*c + t*t*t*d;
    }
}

customElements.define('petri-view', PetriView);