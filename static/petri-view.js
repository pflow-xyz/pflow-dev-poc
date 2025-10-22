// javascript
// static/petri-view.js
class PetriView extends HTMLElement {
    constructor() {
        super();
        this._model = {};
        this._root = null;
        this._canvas = null;
        this._ctx = null;
        this._nodes = {}; // id -> element (places & transitions)
        this._weights = []; // DOM badges for arc weights
        this._ro = null;
        this._dpr = window.devicePixelRatio || 1;

        this._drag = null; // {id, kind:"place|transition", dx, dy}
        this._ldScript = null; // <script type="application/ld+json"> to keep in sync

        // new: editing state
        this._mode = 'select'; // select | add-place | add-transition | add-arc | add-token | delete
        this._arcDraft = null; // { source: id }
        this._menu = null;
    }

    // -------- lifecycle ------------------------------------------------------
    connectedCallback() {
        if (this._root) return;

        this._root = document.createElement('div');
        this._root.className = 'pv-root';
        this._root.style.position = 'relative';
        this.appendChild(this._root);

        this._canvas = document.createElement('canvas');
        this._canvas.className = 'pv-canvas';
        this._root.appendChild(this._canvas);
        this._ctx = this._canvas.getContext('2d');

        // parse model from child <script type="application/ld+json">
        this._ldScript = this.querySelector('script[type="application/ld+json"]');
        if (this._ldScript && this._ldScript.textContent) {
            try { this._model = JSON.parse(this._ldScript.textContent); } catch { this._model = {}; }
        }

        this._normalizeModel();
        this._renderUI();

        // create edit menu
        this._createMenu();

        // resize/draw observers
        this._ro = new ResizeObserver(() => this._onResize());
        this._ro.observe(this._root);
        // redraw on font load/paint
        window.addEventListener('load', () => this._onResize());
    }

    disconnectedCallback() {
        if (this._ro) this._ro.disconnect();
    }

    // -------- public API -----------------------------------------------------
    setModel(m) {
        this._model = m || {};
        this._normalizeModel();
        this._renderUI();
        this._syncLD();
    }

    getModel() { return this._model; }

    exportJSON() { return JSON.parse(JSON.stringify(this._model)); }

    importJSON(json) { this.setModel(json); }

    /** Write current model back into the child <script type="application/ld+json"> */
    saveToScript() { this._syncLD(true); }

    // -------- internal: schema & helpers ------------------------------------
    _normalizeModel() {
        const m = this._model || (this._model = {});
        m['@context'] ||= 'https://pflow.xyz/schema';
        m['@type'] ||= 'PetriNet';
        m.version ||= 'v1';

        m.token ||= ['https://pflow.xyz/tokens/black'];
        m.places ||= {};
        m.transitions ||= {};
        m.arcs ||= [];

        // ensure numeric fields
        for (const [id, p] of Object.entries(m.places)) {
            p['@type'] ||= 'Place';
            p.offset = Number(p.offset ?? 0);
            p.initial = Array.isArray(p.initial) ? p.initial.map(v => Number(v)||0) : [Number(p.initial||0)];
            p.capacity = Array.isArray(p.capacity) ? p.capacity.map(v => Number(v)||Infinity) : [Number(p.capacity ?? Infinity)];
            p.x = Number(p.x || 0);
            p.y = Number(p.y || 0);
        }
        for (const [id, t] of Object.entries(m.transitions)) {
            t['@type'] ||= 'Transition';
            t.x = Number(t.x || 0);
            t.y = Number(t.y || 0);
        }
        for (const a of m.arcs) {
            a['@type'] ||= 'Arrow';
            if (a.weight == null) a.weight = [1];
            if (!Array.isArray(a.weight)) a.weight = [Number(a.weight)||1];
            a.inhibitTransition = !!a.inhibitTransition;
        }
    }

    _stableStringify(obj, space = 2) {
        const seen = new WeakSet();
        const sortObj = (o) => {
            if (o === null || typeof o !== 'object') return o;
            if (seen.has(o)) return undefined;
            seen.add(o);
            if (Array.isArray(o)) return o.map(sortObj);
            const out = {};
            for (const k of Object.keys(o).sort()) out[k] = sortObj(o[k]);
            return out;
        };
        return JSON.stringify(sortObj(obj), null, space);
    }

    _syncLD(force = false) {
        if (!this._ldScript) return; // nothing to sync
        // Pretty unless author opts out with data-compact
        const pretty = !this.hasAttribute('data-compact');
        const text = pretty ? this._stableStringify(this._model, 2) : JSON.stringify(this._model);
        if (force || this._ldScript.textContent !== text) {
            this._ldScript.textContent = text;
            this.dispatchEvent(new CustomEvent('jsonld-updated', { detail: { json: this.exportJSON() } }));
        }
    }

    _marking() {
        // single-color token vector -> use index 0
        const marks = {};
        for (const [pid, p] of Object.entries(this._model.places)) {
            const sum = (Array.isArray(p.initial) ? p.initial : [Number(p.initial||0)])
                .reduce((s,v)=> s + (Number(v)||0), 0);
            marks[pid] = sum;
        }
        return marks;
    }

    _setMarking(marks) {
        // write back into place.initial[0]
        for (const [pid, count] of Object.entries(marks)) {
            const p = this._model.places[pid];
            if (!p) continue;
            const arr = Array.isArray(p.initial) ? p.initial : [Number(p.initial||0)];
            arr[0] = Math.max(0, Number(count)||0);
            p.initial = arr;
        }
        this._syncLD();
    }

    _capacityOf(pid) {
        const p = this._model.places[pid];
        if (!p) return Infinity;
        const arr = Array.isArray(p.capacity) ? p.capacity : [Number(p.capacity||Infinity)];
        return Number.isFinite(arr[0]) ? arr[0] : Infinity;
    }

    _inArcsOf(tid) { return (this._model.arcs||[]).filter(a => a.target === tid); }
    _outArcsOf(tid) { return (this._model.arcs||[]).filter(a => a.source === tid); }

    _enabled(tid, marks) {
        const inArcs = this._inArcsOf(tid);
        for (const a of inArcs) {
            const fromPlace = this._model.places[a.source];
            if (!fromPlace) continue; // ignore malformed
            const w = Number(a.weight?.[0] ?? 1);
            const tokens = marks[a.source] ?? 0;
            if (a.inhibitTransition) {
                if (!(tokens < w)) return false; // inhibitor blocks if tokens >= w
            } else {
                if (tokens < w) return false; // insufficient tokens
            }
        }
        const outArcs = this._outArcsOf(tid);
        for (const a of outArcs) {
            const toPlace = this._model.places[a.target];
            if (!toPlace) continue;
            const w = Number(a.weight?.[0] ?? 1);
            const cap = this._capacityOf(a.target);
            const cur = marks[a.target] ?? 0;
            if (cur + w > cap) return false; // would exceed capacity
        }
        return true;
    }

    _fire(tid) {
        const marks = this._marking();
        if (!this._enabled(tid, marks)) {
            this.dispatchEvent(new CustomEvent('transition-fired-blocked', {detail:{id:tid}}));
            return false;
        }
        // consume
        for (const a of this._inArcsOf(tid)) {
            const isPlace = !!this._model.places[a.source];
            if (!isPlace) continue; // malformed arcs ignored
            const w = Number(a.weight?.[0] ?? 1);
            if (!a.inhibitTransition) { marks[a.source] = Math.max(0, (marks[a.source]||0) - w); }
        }
        // produce
        for (const a of this._outArcsOf(tid)) {
            const isPlace = !!this._model.places[a.target];
            if (!isPlace) continue;
            const w = Number(a.weight?.[0] ?? 1);
            marks[a.target] = (marks[a.target]||0) + w;
        }
        this._setMarking(marks); // also syncs LD
        this._renderTokens();
        this._updateTransitionStates();
        this._draw();
        this.dispatchEvent(new CustomEvent('marking-changed', {detail:{marks}}));
        this.dispatchEvent(new CustomEvent('transition-fired-success', {detail:{id:tid}}));
        return true;
    }

    // small helper: briefly flash an element to indicate invalid arc attempt
    _flashInvalidArc(el) {
        if (!el) return;
        el.classList.add('pv-invalid');
        setTimeout(() => el.classList.remove('pv-invalid'), 350);
    }

    // delete helper: remove node and any arcs referencing it
    _deleteNode(id) {
        if (!this._model) return;
        let changed = false;
        if (this._model.places && this._model.places[id]) {
            delete this._model.places[id];
            changed = true;
        }
        if (this._model.transitions && this._model.transitions[id]) {
            delete this._model.transitions[id];
            changed = true;
        }
        if (changed) {
            // remove arcs that reference this id
            this._model.arcs = (this._model.arcs || []).filter(a => a.source !== id && a.target !== id);
            // clear any draft referencing deleted node
            if (this._arcDraft && this._arcDraft.source === id) this._arcDraft = null;
            this._normalizeModel();
            this._renderUI();
            this._syncLD();
            this.dispatchEvent(new CustomEvent('node-deleted', { detail: { id } }));
        }
    }

    // -------- UI render ------------------------------------------------------
    _renderUI() {
        // clear existing nodes (leave canvas)
        for (const n of Object.values(this._nodes)) n.remove();
        this._nodes = {};
        for (const b of this._weights) b.remove();
        this._weights = [];

        const places = this._model.places || {};
        const transitions = this._model.transitions || {};
        const arcs = this._model.arcs || [];

        // Places
        for (const [id, p] of Object.entries(places)) {
            const el = document.createElement('div');
            el.className = 'pv-node pv-place';
            el.dataset.id = id;
            el.style.position = 'absolute';
            el.style.left = `${(p.x||0) - 40}px`;
            el.style.top  = `${(p.y||0) - 40}px`;

            const handle = document.createElement('div');
            handle.className = 'pv-place-handle';
            el.appendChild(handle);

            const inner = document.createElement('div');
            inner.className = 'pv-place-inner';
            el.appendChild(inner);

            const label = document.createElement('div');
            label.className = 'pv-label';
            label.textContent = id;
            el.appendChild(label);

            // click behavior depends on mode
            el.addEventListener('click', (ev) => {
                ev.stopPropagation();
                if (this._mode === 'select') return;
                if (this._mode === 'add-token') {
                    const arr = Array.isArray(p.initial) ? p.initial : [Number(p.initial||0)];
                    arr[0] = (Number(arr[0]) || 0) + 1;
                    p.initial = arr;
                    this._syncLD();
                    this._renderTokens();
                    this._draw();
                    return;
                }
                if (this._mode === 'add-arc') {
                    this._arcNodeClicked(id);
                    return;
                }
                if (this._mode === 'delete') {
                    this._deleteNode(id);
                    return;
                }
                // other modes ignore clicks on places
            });

            // right-click (contextmenu) to remove a token when in token mode,
            // OR finish/start an inhibitor arc when in add-arc mode.
            el.addEventListener('contextmenu', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                if (this._mode === 'add-token') {
                    const arr = Array.isArray(p.initial) ? p.initial : [Number(p.initial||0)];
                    arr[0] = Math.max(0, (Number(arr[0]) || 0) - 1);
                    p.initial = arr;
                    this._syncLD();
                    this._renderTokens();
                    this._draw();
                    return;
                }
                if (this._mode === 'add-arc') {
                    // finish or start arc as inhibitor
                    this._arcNodeClicked(id, { inhibit: true });
                    return;
                }
                if (this._mode === 'delete') {
                    this._deleteNode(id);
                    return;
                }
            });

            // drag
            handle.addEventListener('pointerdown', (ev)=> this._beginDrag(ev, id, 'place'));

            this._root.appendChild(el);
            this._nodes[id] = el;
        }

        // Transitions
        for (const [id, t] of Object.entries(transitions)) {
            const el = document.createElement('div');
            el.className = 'pv-node pv-transition';
            el.dataset.id = id;
            el.style.position = 'absolute';
            el.style.left = `${(t.x||0) - 15}px`;
            el.style.top  = `${(t.y||0) - 15}px`;

            const label = document.createElement('div');
            label.className = 'pv-label';
            label.textContent = id;
            el.appendChild(label);

            // click-to-fire OR editing behavior
            el.addEventListener('click', (ev) => {
                ev.stopPropagation();
                if (this._mode === 'select') {
                    this.dispatchEvent(new CustomEvent('transition-fired', {detail:{id}}));
                    // pulse
                    el.animate([{transform:'scale(1)'},{transform:'scale(1.06)'},{transform:'scale(1)'}], {duration:250});
                    this._fire(id);
                    return;
                }
                if (this._mode === 'add-arc') {
                    this._arcNodeClicked(id);
                    return;
                }
                if (this._mode === 'delete') {
                    this._deleteNode(id);
                    return;
                }
                // other modes ignore transition clicks
            });

            // right-click in arc mode toggles/creates inhibitor-typed arc finish/start
            el.addEventListener('contextmenu', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                if (this._mode === 'add-arc') {
                    this._arcNodeClicked(id, { inhibit: true });
                }
                if (this._mode === 'delete') {
                    this._deleteNode(id);
                }
            });

            // drag
            el.addEventListener('pointerdown', (ev)=> this._beginDrag(ev, id, 'transition'));

            this._root.appendChild(el);
            this._nodes[id] = el;
        }

        // Weight badges
        arcs.forEach((arc, idx) => {
            const w = (() => {
                if (arc.weight == null) return 1;
                if (Array.isArray(arc.weight)) return Number(arc.weight[0]) || 1;
                return Number(arc.weight) || 1;
            })();
            const badge = document.createElement('div');
            badge.className = 'pv-weight';
            // allow interaction with badge
            badge.style.pointerEvents = 'auto';
            badge.dataset.arc = String(idx);
            badge.textContent = w > 1 ? `${w}` : '1';
            badge.style.position = 'absolute';

            // left-click in add-token mode: set weight via prompt; in delete mode remove arc
            badge.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const i = Number(badge.dataset.arc);
                const a = this._model.arcs && this._model.arcs[i];
                if (!a) return;
                if (this._mode === 'add-token') {
                    try {
                        const ans = prompt('Arc weight (positive integer)', String(Number(a.weight?.[0]||1)));
                        const parsed = Number(ans);
                        if (!Number.isNaN(parsed) && parsed > 0) {
                            a.weight = [Math.floor(parsed)];
                            this._normalizeModel();
                            this._renderUI();
                            this._syncLD();
                        }
                    } catch (e) {}
                    return;
                }
                if (this._mode === 'delete') {
                    // remove arc by index
                    this._model.arcs = (this._model.arcs || []).filter((_, j) => j !== i);
                    this._normalizeModel();
                    this._renderUI();
                    this._syncLD();
                    return;
                }
            });

            // right-click in add-token mode: decrement weight by 1 (min 1)
            badge.addEventListener('contextmenu', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                const i = Number(badge.dataset.arc);
                const a = this._model.arcs && this._model.arcs[i];
                if (!a) return;
                if (this._mode === 'add-token') {
                    const cur = Number(a.weight?.[0] || 1);
                    const nw = Math.max(1, cur - 1);
                    a.weight = [nw];
                    this._normalizeModel();
                    this._renderUI();
                    this._syncLD();
                    return;
                }
                if (this._mode === 'delete') {
                    // remove arc by index
                    this._model.arcs = (this._model.arcs || []).filter((_, j) => j !== i);
                    this._normalizeModel();
                    this._renderUI();
                    this._syncLD();
                }
            });

            this._root.appendChild(badge);
            this._weights.push(badge);
        });

        // Tokens & enabled states
        this._renderTokens();
        this._updateTransitionStates();

        this._onResize();
        this._syncLD();

        // visual arc-draft highlight update
        this._updateArcDraftHighlight();
        this._updateMenuActive();
    }

    _renderTokens() {
        // remove any old token elements and recreate based on marking
        for (const [id, el] of Object.entries(this._nodes)) {
            if (!el.classList.contains('pv-place')) continue;
            el.querySelectorAll('.pv-token, .pv-token-dot').forEach(n => n.remove());
            const p = this._model.places[id];
            const tokenCount = Array.isArray(p.initial) ? p.initial.reduce((s,v)=>s+(Number(v)||0),0) : Number(p.initial||0);
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

            // capacity full state could be styled (optional)
            const cap = this._capacityOf(id);
            el.toggleAttribute('data-cap-full', Number.isFinite(cap) && tokenCount >= cap);
        }
    }

    _updateTransitionStates() {
        const marks = this._marking();
        for (const [id, el] of Object.entries(this._nodes)) {
            if (!el.classList.contains('pv-transition')) continue;
            const on = this._enabled(id, marks);
            el.classList.toggle('pv-active', !!on);
        }
    }

    // -------- edit menu -----------------------------------------------------
    _createMenu() {
        if (this._menu) this._menu.remove();
        this._menu = document.createElement('div');
        this._menu.className = 'pv-menu';
        // basic inline styles so it's visible without external CSS
        Object.assign(this._menu.style, {
            position: 'absolute',
            bottom: '10px',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: '8px',
            padding: '6px 8px',
            background: 'rgba(255,255,255,0.9)',
            borderRadius: '8px',
            boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
            zIndex: 2000,
            alignItems: 'center',
            userSelect: 'none',
            fontSize: '14px'
        });

        const tools = [
            {mode:'select', label:'◉', title:'Select / Fire (default)'},
            {mode:'add-place', label:'\u25CB', title:'Add Place'},
            {mode:'add-transition', label:'\u25A3', title:'Add Transition'},
            {mode:'add-arc', label:'\u2192', title:'Add Arc'},
            {mode:'add-token', label:'\u2022', title:'Add / Remove Tokens'},
            {mode:'delete', label:'\u{1F5D1}', title:'Delete element (nodes or arcs)'},
        ];

        tools.forEach(t => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'pv-tool';
            // ensure emoji works in older JS engines by using textContent assignment
            btn.textContent = t.label;
            btn.title = t.title;
            Object.assign(btn.style, {
                width: '36px', height: '36px', borderRadius: '6px', border: 'none',
                background: 'transparent', cursor: 'pointer', fontSize: '16px'
            });
            btn.dataset.mode = t.mode;
            btn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                this._setMode(t.mode);
            });
            this._menu.appendChild(btn);
        });

        this._root.appendChild(this._menu);

        // click on empty root to add nodes when in add-place/add-transition mode
        this._root.addEventListener('click', (ev) => {
            // ignore clicks that hit nodes (we handle node clicks separately)
            if (ev.target.closest('.pv-node')) return;
            const rect = this._root.getBoundingClientRect();
            const x = Math.round(ev.clientX - rect.left);
            const y = Math.round(ev.clientY - rect.top);

            if (this._mode === 'add-place') {
                const id = this._generateId('p');
                this._model.places[id] = { '@type':'Place', x: x, y: y, initial: [0], capacity: [Infinity] };
                this._normalizeModel();
                this._renderUI();
                this._syncLD();
            } else if (this._mode === 'add-transition') {
                const id = this._generateId('t');
                this._model.transitions[id] = { '@type':'Transition', x: x, y: y };
                this._normalizeModel();
                this._renderUI();
                this._syncLD();
            }
        });
    }

    _setMode(mode) {
        this._mode = mode;
        // cancel any arc draft when switching away from add-arc
        if (mode !== 'add-arc' && this._arcDraft) {
            this._arcDraft = null;
            this._updateArcDraftHighlight();
        }
        this._updateMenuActive();
    }

    _updateMenuActive() {
        if (!this._menu) return;
        this._menu.querySelectorAll('.pv-tool').forEach(btn => {
            btn.style.background = (btn.dataset.mode === this._mode) ? 'rgba(0,0,0,0.08)' : 'transparent';
        });
    }

    _generateId(prefix) {
        // simple unique id based on timestamp + counter
        const base = prefix + Date.now().toString(36);
        let id = base;
        let i = 0;
        while ((this._model.places && this._model.places[id]) || (this._model.transitions && this._model.transitions[id])) {
            id = base + '-' + (++i);
        }
        return id;
    }

    // allow optional options, e.g. { inhibit: true } to create inhibitor arcs via right-click
    _arcNodeClicked(id, opts = {}) {
        if (!this._arcDraft || !this._arcDraft.source) {
            // start arc
            this._arcDraft = { source: id };
            this._updateArcDraftHighlight();
            return;
        }
        // finish arc
        const source = this._arcDraft.source;
        const target = id;

        // disallow arcs between two shapes of the same type
        const srcEl = this._nodes[source];
        const trgEl = this._nodes[target];
        if (srcEl && trgEl) {
            const srcIsPlace = srcEl.classList.contains('pv-place');
            const trgIsPlace = trgEl.classList.contains('pv-place');
            if (srcIsPlace === trgIsPlace) {
                // same-type attempted, flash invalid and cancel draft
                this._flashInvalidArc(srcEl);
                this._flashInvalidArc(trgEl);
                this._arcDraft = null;
                this._updateArcDraftHighlight();
                return;
            }
        }

        if (source === target) {
            // cancel self-arc creation
            this._arcDraft = null;
            this._updateArcDraftHighlight();
            return;
        }
        // optional weight prompt
        let w = 1;
        try {
            const ans = prompt('Arc weight (positive integer)', '1');
            const parsed = Number(ans);
            if (!Number.isNaN(parsed) && parsed > 0) w = Math.floor(parsed);
        } catch (e) {}
        this._model.arcs = this._model.arcs || [];
        const inhibit = !!opts.inhibit;
        this._model.arcs.push({ '@type':'Arrow', source, target, weight: [w], inhibitTransition: inhibit });
        this._arcDraft = null;
        this._normalizeModel();
        this._renderUI();
        this._syncLD();
    }

    _updateArcDraftHighlight() {
        // remove any existing highlight
        for (const el of Object.values(this._nodes)) {
            el.classList.toggle('pv-arc-src', false);
        }
        if (this._arcDraft && this._arcDraft.source) {
            const srcEl = this._nodes[this._arcDraft.source];
            if (srcEl) srcEl.classList.toggle('pv-arc-src', true);
        }
    }

    // -------- drag & move ----------------------------------------------------
    _beginDrag(ev, id, kind) {
        ev.preventDefault();
        const el = this._nodes[id];
        if (!el) return;
        el.setPointerCapture(ev.pointerId);

        const rect = el.getBoundingClientRect();
        const rootRect = this._root.getBoundingClientRect();
        const startLeft = rect.left - rootRect.left;
        const startTop  = rect.top  - rootRect.top;
        const startX = ev.clientX;
        const startY = ev.clientY;

        const move = (e) => {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            const newLeft = startLeft + dx;
            const newTop  = startTop  + dy;
            el.style.left = `${newLeft}px`;
            el.style.top  = `${newTop}px`;
            // write back center position to model
            if (kind === 'place') {
                const p = this._model.places[id];
                p.x = Math.round(newLeft + 40);
                p.y = Math.round(newTop + 40);
            } else {
                const t = this._model.transitions[id];
                t.x = Math.round(newLeft + 15);
                t.y = Math.round(newTop + 15);
            }
            this._draw();
        };

        const up = (e) => {
            el.releasePointerCapture(ev.pointerId);
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            this._syncLD();
            this.dispatchEvent(new CustomEvent('node-moved', {detail:{id, kind}}));
        };

        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    }

    // -------- drawing (arcs + badges) ---------------------------------------
    _onResize() {
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
        const rootRect = this._root.getBoundingClientRect();
        const width = this._canvas.width / this._dpr;
        const height = this._canvas.height / this._dpr;

        ctx.clearRect(0, 0, width, height);
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

            const ahSize = 8;
            const inhibitRadius = 6;
            const tipOffset = arc.inhibitTransition ? (inhibitRadius + 2) : (ahSize * 0.9);

            const ex = sx + ux * padSrc;
            const ey = sy + uy * padSrc;
            const fx = tx - ux * (padTrg + tipOffset);
            const fy = ty - uy * (padTrg + tipOffset);

            if (arc.inhibitTransition) {
                ctx.strokeStyle = '#c0392b';
                ctx.setLineDash([6,4]);
            } else {
                ctx.strokeStyle = '#000000';
                ctx.setLineDash([]);
            }

            ctx.beginPath();
            ctx.moveTo(ex, ey);
            ctx.lineTo(fx, fy);
            ctx.stroke();

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

            // position weight badge
            const bx = (ex + fx) / 2;
            const by = (ey + fy) / 2;
            const badge = this._root.querySelector(`.pv-weight[data-arc="${idx}"]`);
            if (badge) {
                badge.style.left = `${bx - 12}px`;
                badge.style.top = `${by - 10}px`;
            }
        });

        // optionally draw arc draft preview
        if (this._arcDraft && this._arcDraft.source) {
            const srcEl = this._nodes[this._arcDraft.source];
            if (srcEl) {
                const srcRect = srcEl.getBoundingClientRect();
                const rootRect = this._root.getBoundingClientRect();
                const sx = (srcRect.left + srcRect.width/2) - rootRect.left;
                const sy = (srcRect.top + srcRect.height/2) - rootRect.top;
                // draw line from source to current mouse if available (best-effort)
                // note: for simplicity this example does not track mouse while drafting
                ctx.setLineDash([4,4]);
                ctx.strokeStyle = '#666';
                ctx.beginPath();
                // short stub to indicate draft
                ctx.moveTo(sx, sy);
                ctx.lineTo(sx+20, sy+0);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }
    }
}

customElements.define('petri-view', PetriView);

export { PetriView };