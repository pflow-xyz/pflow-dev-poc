// javascript
// static/petri-view.js
class PetriView extends HTMLElement {
    constructor() {
        super();
        this._model = {};
        this._root = null;
        this._stage = null; // new: transformable layer (nodes + canvas live here)
        this._canvas = null;
        this._ctx = null;
        this._nodes = {}; // id -> element (places & transitions)
        this._weights = []; // DOM badges for arc weights
        this._ro = null;
        this._dpr = window.devicePixelRatio || 1;

        this._drag = null; // {id, kind:"place|transition", dx, dy}
        this._ldScript = null; // <script type="application/ld+json"> to keep in sync

        // editing state
        this._mode = 'select'; // select | add-place | add-transition | add-arc | add-token | delete
        this._arcDraft = null; // { source: id }
        this._menu = null;

        // simulation state
        this._simRunning = false;
        this._prevMode = null;
        this._menuPlayBtn = null;

        // live arc preview
        this._mouse = {x: 0, y: 0};

        // pan/zoom
        this._view = {scale: 1, tx: 0, ty: 0};
        this._panning = null;
        this._spaceDown = false;

        // history (undo/redo)
        this._history = [];
        this._redo = [];
    }

    // -------- lifecycle ------------------------------------------------------
    connectedCallback() {
        if (this._root) return;

        // root container
        this._root = document.createElement('div');
        this._root.className = 'pv-root';
        this._root.style.position = 'relative';
        this._root.style.width = '100%';
        this._root.style.height = '100%';
        this.appendChild(this._root);

        // stage (pan/zoom via CSS transform)
        this._stage = document.createElement('div');
        this._stage.className = 'pv-stage';
        Object.assign(this._stage.style, {
            position: 'absolute',
            left: '0',
            top: '0',
            width: '100%',
            height: '100%',
            transformOrigin: '0 0'
        });
        this._root.appendChild(this._stage);

        // canvas (lives in stage so it pan/zooms with nodes)
        this._canvas = document.createElement('canvas');
        this._canvas.className = 'pv-canvas';
        this._canvas.style.position = 'absolute';
        this._canvas.style.left = '0';
        this._canvas.style.top = '0';
        this._stage.appendChild(this._canvas);
        this._ctx = this._canvas.getContext('2d');

        // parse model from child <script type="application/ld+json">
        this._ldScript = this.querySelector('script[type="application/ld+json"]');
        if (this._ldScript && this._ldScript.textContent) {
            try {
                this._model = JSON.parse(this._ldScript.textContent);
            } catch {
                this._model = {};
            }
        } else {
            // try restore from autosave
            try {
                const saved = localStorage.getItem('petri-view:last');
                if (saved) this._model = JSON.parse(saved);
            } catch {
            }
        }

        this._normalizeModel();
        this._renderUI();
        this._applyViewTransform();
        this._pushHistory(true); // seed history

        // create edit menu
        this._createMenu();

        // resize/draw observers
        this._ro = new ResizeObserver(() => this._onResize());
        this._ro.observe(this._root);
        // redraw on font load/paint
        window.addEventListener('load', () => this._onResize());

        // track mouse for arc preview
        this._root.addEventListener('pointermove', (e) => {
            const r = this._root.getBoundingClientRect();
            this._mouse.x = Math.round(e.clientX - r.left);
            this._mouse.y = Math.round(e.clientY - r.top);
            if (this._arcDraft) this._draw();
        });

        // pan/zoom: wheel zoom (keep cursor anchored)
        this._root.addEventListener('wheel', (e) => {
            e.preventDefault();
            const r = this._root.getBoundingClientRect();
            const mx = e.clientX - r.left;
            const my = e.clientY - r.top;

            const prev = this._view.scale;
            const next = Math.max(0.5, Math.min(2.5, prev * (e.deltaY < 0 ? 1.1 : 0.9)));
            if (next === prev) return;

            // keep point under cursor stable: tx' = mx - (mx - tx) * (next/prev)
            this._view.tx = mx - (mx - this._view.tx) * (next / prev);
            this._view.ty = my - (my - this._view.ty) * (next / prev);
            this._view.scale = next;
            this._applyViewTransform();
            this._draw();
        }, {passive: false});

        // pan with space (or middle click)
        window.addEventListener('keydown', (e) => {
            if (e.key === ' ') {
                this._spaceDown = true;
            }
            // undo/redo
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                if (e.shiftKey) this._redoAction(); else this._undoAction();
            }
            // cancel arc draft
            if (e.key === 'Escape' && this._arcDraft) {
                this._arcDraft = null;
                this._updateArcDraftHighlight();
                this._draw();
            }
            // quick mode keys 1..6
            const map = {
                '1': 'select',
                '2': 'add-place',
                '3': 'add-transition',
                '4': 'add-arc',
                '5': 'add-token',
                '6': 'delete'
            };
            if (map[e.key]) this._setMode(map[e.key]);
        });
        window.addEventListener('keyup', (e) => {
            if (e.key === ' ') {
                this._spaceDown = false;
            }
        });

        this._root.addEventListener('pointerdown', (e) => {
            if (this._mode === 'add-token') return;
            // start panning if space, middle button, or Alt/Ctrl/Meta
            const isPan = this._spaceDown || e.button === 1 || e.altKey || e.ctrlKey || e.metaKey;
            if (isPan) {
                this._panning = {x: e.clientX, y: e.clientY, tx: this._view.tx, ty: this._view.ty};
                this._root.setPointerCapture(e.pointerId);
            }
        });
        this._root.addEventListener('pointermove', (e) => {
            if (!this._panning) return;
            this._view.tx = this._panning.tx + (e.clientX - this._panning.x);
            this._view.ty = this._panning.ty + (e.clientY - this._panning.y);
            this._applyViewTransform();
            this._draw();
        });
        this._root.addEventListener('pointerup', (e) => {
            if (this._panning) {
                this._panning = null;
                this._root.releasePointerCapture?.(e.pointerId);
            }
        });
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
        this._pushHistory();
    }

    getModel() {
        return this._model;
    }

    exportJSON() {
        return JSON.parse(JSON.stringify(this._model));
    }

    importJSON(json) {
        this.setModel(json);
    }

    /** Write current model back into the child <script type="application/ld+json"> */
    saveToScript() {
        this._syncLD(true);
    }

    /** Download JSON file of current model */
    downloadJSON(filename = 'petri-net.json') {
        const blob = new Blob([this._stableStringify(this._model)], {type: 'application/json'});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    // -------- internal: schema & helpers ------------------------------------
    _normalizeModel() {
        const m = this._model || (this._model = {});
        m['@context'] ||= 'https://pflow.xyz/schema';
        m['@type'] ||= 'PetriNet';

        m.token ||= ['https://pflow.xyz/tokens/black'];
        m.places ||= {};
        m.transitions ||= {};
        m.arcs ||= [];

        // ensure numeric fields
        for (const [id, p] of Object.entries(m.places)) {
            p['@type'] ||= 'Place';
            p.offset = Number(p.offset ?? 0);
            p.initial = Array.isArray(p.initial) ? p.initial.map(v => Number(v) || 0) : [Number(p.initial || 0)];
            p.capacity = Array.isArray(p.capacity) ? p.capacity.map(v => Number(v) || Infinity) : [Number(p.capacity ?? Infinity)];
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
            if (!Array.isArray(a.weight)) a.weight = [Number(a.weight) || 1];
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
        // autosave
        try {
            localStorage.setItem('petri-view:last', this._stableStringify(this._model));
        } catch {
        }
        if (!this._ldScript) return; // nothing to sync
        // Pretty unless author opts out with data-compact
        const pretty = !this.hasAttribute('data-compact');
        const text = pretty ? this._stableStringify(this._model, 2) : JSON.stringify(this._model);
        if (force || this._ldScript.textContent !== text) {
            this._ldScript.textContent = text;
            this.dispatchEvent(new CustomEvent('jsonld-updated', {detail: {json: this.exportJSON()}}));
        }
    }

    _pushHistory(seed = false) {
        const snap = this._stableStringify(this._model);
        if (seed && this._history.length === 0) {
            this._history.push(snap);
            return;
        }
        const last = this._history[this._history.length - 1];
        if (snap !== last) {
            this._history.push(snap);
            this._redo.length = 0;
        }
    }

    _undoAction() {
        if (this._history.length < 2) return;
        const cur = this._history.pop();
        this._redo.push(cur);
        const prev = this._history[this._history.length - 1];
        this._model = JSON.parse(prev);
        this._renderUI();
        this._syncLD();
    }

    _redoAction() {
        if (!this._redo.length) return;
        const nxt = this._redo.pop();
        this._history.push(nxt);
        this._model = JSON.parse(nxt);
        this._renderUI();
        this._syncLD();
    }

    _marking() {
        // single-color token vector -> use index 0
        const marks = {};
        for (const [pid, p] of Object.entries(this._model.places)) {
            const sum = (Array.isArray(p.initial) ? p.initial : [Number(p.initial || 0)])
                .reduce((s, v) => s + (Number(v) || 0), 0);
            marks[pid] = sum;
        }
        return marks;
    }

    _setMarking(marks) {
        // write back into place.initial[0]
        for (const [pid, count] of Object.entries(marks)) {
            const p = this._model.places[pid];
            if (!p) continue;
            const arr = Array.isArray(p.initial) ? p.initial : [Number(p.initial || 0)];
            arr[0] = Math.max(0, Number(count) || 0);
            p.initial = arr;
        }
        this._syncLD();
        this._pushHistory();
    }

    _capacityOf(pid) {
        const p = this._model.places[pid];
        if (!p) return Infinity;
        const arr = Array.isArray(p.capacity) ? p.capacity : [Number(p.capacity || Infinity)];
        return Number.isFinite(arr[0]) ? arr[0] : Infinity;
    }

    _inArcsOf(tid) {
        return (this._model.arcs || []).filter(a => a.target === tid);
    }

    _outArcsOf(tid) {
        return (this._model.arcs || []).filter(a => a.source === tid);
    }

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
            this.dispatchEvent(new CustomEvent('transition-fired-blocked', {detail: {id: tid}}));
            return false;
        }
        // consume
        for (const a of this._inArcsOf(tid)) {
            const isPlace = !!this._model.places[a.source];
            if (!isPlace) continue; // malformed arcs ignored
            const w = Number(a.weight?.[0] ?? 1);
            if (!a.inhibitTransition) {
                marks[a.source] = Math.max(0, (marks[a.source] || 0) - w);
            }
        }
        // produce
        for (const a of this._outArcsOf(tid)) {
            const isPlace = !!this._model.places[a.target];
            if (!isPlace) continue;
            const w = Number(a.weight?.[0] ?? 1);
            marks[a.target] = (marks[a.target] || 0) + w;
        }
        this._setMarking(marks); // also syncs LD + push history
        this._renderTokens();
        this._updateTransitionStates();
        this._draw();
        this.dispatchEvent(new CustomEvent('marking-changed', {detail: {marks}}));
        this.dispatchEvent(new CustomEvent('transition-fired-success', {detail: {id: tid}}));
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
            this._pushHistory();
            this.dispatchEvent(new CustomEvent('node-deleted', {detail: {id}}));
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
            el.style.left = `${(p.x || 0) - 40}px`;
            el.style.top = `${(p.y || 0) - 40}px`;

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
                    const arr = Array.isArray(p.initial) ? p.initial : [Number(p.initial || 0)];
                    arr[0] = (Number(arr[0]) || 0) + 1;
                    p.initial = arr;
                    this._syncLD();
                    this._pushHistory();
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
                }
            });

            // right-click (contextmenu) to remove a token when in token mode,
            // OR finish/start an inhibitor arc when in add-arc mode.
            el.addEventListener('contextmenu', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                if (this._mode === 'add-token') {
                    const arr = Array.isArray(p.initial) ? p.initial : [Number(p.initial || 0)];
                    arr[0] = Math.max(0, (Number(arr[0]) || 0) - 1);
                    p.initial = arr;
                    this._syncLD();
                    this._pushHistory();
                    this._renderTokens();
                    this._draw();
                    return;
                }
                if (this._mode === 'add-arc') {
                    // finish or start arc as inhibitor
                    this._arcNodeClicked(id, {inhibit: true});
                    return;
                }
                if (this._mode === 'delete') {
                    this._deleteNode(id);
                }
            });

            // drag
            handle.addEventListener('pointerdown', (ev) => {
                if (this._mode === 'add-token') return;
                // don't start dragging while user is in add-arc mode;
                // allow the click to be handled by the node click handler to start/finish arcs.
                if (this._mode === 'add-arc') {
                    // allow click events to reach the node click handler — do not stop propagation
                    return;
                }
                this._beginDrag(ev, id, 'place');
            });

            this._stage.appendChild(el);
            this._nodes[id] = el;
        }

        // Transitions
        for (const [id, t] of Object.entries(transitions)) {
            const el = document.createElement('div');
            el.className = 'pv-node pv-transition';
            el.dataset.id = id;
            el.style.position = 'absolute';
            el.style.left = `${(t.x || 0) - 15}px`;
            el.style.top = `${(t.y || 0) - 15}px`;

            const label = document.createElement('div');
            label.className = 'pv-label';
            label.textContent = id;
            el.appendChild(label);

            // click-to-fire OR editing behavior
            el.addEventListener('click', (ev) => {
                ev.stopPropagation();
                if (this._mode === 'select') {
                    this.dispatchEvent(new CustomEvent('transition-fired', {detail: {id}}));
                    // pulse
                    el.animate([{transform: 'scale(1)'}, {transform: 'scale(1.06)'}, {transform: 'scale(1)'}], {duration: 250});
                    this._fire(id);
                    return;
                }
                if (this._mode === 'add-arc') {
                    this._arcNodeClicked(id);
                    return;
                }
                if (this._mode === 'delete') {
                    this._deleteNode(id);
                }
            });

            // right-click in arc mode toggles/creates inhibitor-typed arc finish/start
            el.addEventListener('contextmenu', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                if (this._mode === 'add-arc') {
                    this._arcNodeClicked(id, {inhibit: true});
                }
                if (this._mode === 'delete') {
                    this._deleteNode(id);
                }
            });

            // drag
            el.addEventListener('pointerdown', (ev) => {
                // when adding arcs, don't initiate move/drag on the transition element.
                if (this._mode === 'add-arc') {
                    // allow click events to reach the node click handler — do not stop propagation
                    return;
                }
                this._beginDrag(ev, id, 'transition');
            });

            this._stage.appendChild(el);
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
                        const ans = prompt('Arc weight (positive integer)', String(Number(a.weight?.[0] || 1)));
                        const parsed = Number(ans);
                        if (!Number.isNaN(parsed) && parsed > 0) {
                            a.weight = [Math.floor(parsed)];
                            this._normalizeModel();
                            this._renderUI();
                            this._syncLD();
                            this._pushHistory();
                        }
                    } catch (e) {
                    }
                    return;
                }
                if (this._mode === 'delete') {
                    // remove arc by index
                    this._model.arcs = (this._model.arcs || []).filter((_, j) => j !== i);
                    this._normalizeModel();
                    this._renderUI();
                    this._syncLD();
                    this._pushHistory();
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
                    this._pushHistory();
                    return;
                }
                if (this._mode === 'delete') {
                    // remove arc by index
                    this._model.arcs = (this._model.arcs || []).filter((_, j) => j !== i);
                    this._normalizeModel();
                    this._renderUI();
                    this._syncLD();
                    this._pushHistory();
                }
            });

            this._stage.appendChild(badge);
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
            const tokenCount = Array.isArray(p.initial) ? p.initial.reduce((s, v) => s + (Number(v) || 0), 0) : Number(p.initial || 0);
            if (tokenCount > 1) {
                const token = document.createElement('div');
                token.className = 'pv-token';
                token.textContent = '' + tokenCount;
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
            {mode: 'select', label: '\u26F6', title: 'Select / Fire (1)'},
            {mode: 'add-place', label: '\u20DD', title: 'Add Place (2)'},
            {mode: 'add-transition', label: '\u25A2', title: 'Add Transition (3)'},
            {mode: 'add-arc', label: '\u2192', title: 'Add Arc (4)'},
            {mode: 'add-token', label: '\u2022', title: 'Add / Remove Tokens (5)'},
            {mode: 'delete', label: '\u{1F5D1}', title: 'Delete element (6)'},
        ];

        tools.forEach(t => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'pv-tool';
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

        // Play / Stop button
        const playBtn = document.createElement('button');
        playBtn.type = 'button';
        playBtn.className = 'pv-play';
        playBtn.textContent = this._simRunning ? '⏸' : '▶';
        playBtn.title = this._simRunning ? 'Stop simulation' : 'Start simulation';
        Object.assign(playBtn.style, {
            width: '44px', height: '36px', borderRadius: '6px', border: 'none',
            background: 'linear-gradient(180deg,#fff,#f3f3f3)', cursor: 'pointer', fontSize: '16px'
        });
        playBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            this._setSimulation(!this._simRunning);
        });
        this._menu.appendChild(playBtn);
        this._menuPlayBtn = playBtn;

        this._root.appendChild(this._menu);

        // click on empty root to add nodes when in add-place/add-transition mode
        this._root.addEventListener('click', (ev) => {
            // ignore clicks that hit nodes (we handle node clicks separately)
            if (ev.target.closest('.pv-node') || ev.target.closest('.pv-weight') || ev.target.closest('.pv-menu')) return;
            const rect = this._stage.getBoundingClientRect();
            const x = Math.round(ev.clientX - rect.left);
            const y = Math.round(ev.clientY - rect.top);

            if (this._mode === 'add-place') {
                const id = this._generateId('p');
                this._model.places[id] = {'@type': 'Place', x: x, y: y, initial: [0], capacity: [Infinity]};
                this._normalizeModel();
                this._renderUI();
                this._syncLD();
                this._pushHistory();
            } else if (this._mode === 'add-transition') {
                const id = this._generateId('t');
                this._model.transitions[id] = {'@type': 'Transition', x: x, y: y};
                this._normalizeModel();
                this._renderUI();
                this._syncLD();
                this._pushHistory();
            }
        });
    }

    _setMode(mode) {
        // if simulation running, lock to 'select' (allowing only stopping via play button)
        if (this._simRunning && mode !== 'select') return;
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
            this._arcDraft = {source: id};
            this._updateArcDraftHighlight();
            this._draw();
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
                this._draw();
                return;
            }
        }

        if (source === target) {
            // cancel self-arc creation
            this._arcDraft = null;
            this._updateArcDraftHighlight();
            this._draw();
            return;
        }
        // optional weight prompt
        let w = 1;
        try {
            const ans = prompt('Arc weight (positive integer)', '1');
            const parsed = Number(ans);
            if (!Number.isNaN(parsed) && parsed > 0) w = Math.floor(parsed);
        } catch (e) {
        }
        this._model.arcs = this._model.arcs || [];
        const inhibit = !!opts.inhibit;
        this._model.arcs.push({'@type': 'Arrow', source, target, weight: [w], inhibitTransition: inhibit});
        this._arcDraft = null;
        this._normalizeModel();
        this._renderUI();
        this._syncLD();
        this._pushHistory();
    }

    _updateArcDraftHighlight() {
        // remove any existing highlight
        for (const el of Object.values(this._nodes)) {
            el.classList.toggle('pv-arc-src', false);
        }
        if (this._arcDraft && this._arcDraft.source) {
            const srcEl = this._nodes[this._arcDraft.source];
            // highlight the source element of the draft so users see which node is the origin
            if (srcEl) srcEl.classList.toggle('pv-arc-src', true);
        }
    }

    // -------- simulation control --------------------------------------------
    _setSimulation(running) {
        if (running === !!this._simRunning) return;
        if (running) {
            // start simulation: remember previous mode, switch to select and disable editing tools
            this._prevMode = this._mode;
            this._simRunning = true;
            this._setMode('select');
            if (this._menuPlayBtn) {
                this._menuPlayBtn.textContent = '⏸';
                this._menuPlayBtn.title = 'Stop simulation';
            }
            // disable edit tool buttons
            if (this._menu) {
                this._menu.querySelectorAll('.pv-tool').forEach(btn => {
                    btn.disabled = true;
                    btn.style.opacity = '0.5';
                    btn.style.cursor = 'default';
                });
            }
            this._root.classList.add('pv-simulating');
            this.dispatchEvent(new CustomEvent('simulation-started'));
        } else {
            // stop simulation: restore previous mode and re-enable tools
            this._simRunning = false;
            if (this._menuPlayBtn) {
                this._menuPlayBtn.textContent = '▶';
                this._menuPlayBtn.title = 'Start simulation';
            }
            if (this._menu) {
                this._menu.querySelectorAll('.pv-tool').forEach(btn => {
                    btn.disabled = false;
                    btn.style.opacity = '';
                    btn.style.cursor = '';
                });
            }
            this._root.classList.remove('pv-simulating');
            // restore previous mode (or select if none)
            this._setMode(this._prevMode || 'select');
            this._prevMode = null;
            this.dispatchEvent(new CustomEvent('simulation-stopped'));
        }
    }

    // -------- drag & move ----------------------------------------------------
    _snap(n, g = 10) {
        return Math.round(n / g) * g;
    }

    _beginDrag(ev, id, kind) {
        ev.preventDefault();
        const el = this._nodes[id];
        if (!el) return;
        el.setPointerCapture(ev.pointerId);

        // read start position in stage-local coordinates (style.left/top)
        const startLeft = parseFloat(el.style.left) || 0;
        const startTop = parseFloat(el.style.top) || 0;
        const startX = ev.clientX;
        const startY = ev.clientY;
        const scale = this._view.scale || 1;

        // track current local left/top so 'up' can use final values
        let currentLeft = startLeft;
        let currentTop = startTop;

        const move = (e) => {
            // convert screen delta to stage-local delta by dividing by scale
            const dxLocal = (e.clientX - startX) / scale;
            const dyLocal = (e.clientY - startY) / scale;
            const newLeft = startLeft + dxLocal;
            const newTop = startTop + dyLocal;
            currentLeft = newLeft;
            currentTop = newTop;

            el.style.left = `${newLeft}px`;
            el.style.top = `${newTop}px`;

            // write back center position to model (stage-local coordinates)
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
            // release capture from the original pointerdown event
            el.releasePointerCapture(ev.pointerId);
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);

            // snap-to-grid using final stage-local coords
            if (kind === 'place') {
                const p = this._model.places[id];
                p.x = this._snap(Math.round(currentLeft + 40));
                p.y = this._snap(Math.round(currentTop + 40));
            } else {
                const t = this._model.transitions[id];
                t.x = this._snap(Math.round(currentLeft + 15));
                t.y = this._snap(Math.round(currentTop + 15));
            }
            this._renderUI(); // repositions badges nicely
            this._syncLD();
            this._pushHistory();
            this.dispatchEvent(new CustomEvent('node-moved', {detail: {id, kind}}));
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

    _applyViewTransform() {
        if (!this._stage) return;
        const {tx, ty, scale} = this._view;
        this._stage.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    }

// javascript
    _draw() {
        const ctx = this._ctx;
        const rootRect = this._root.getBoundingClientRect();
        const width = this._canvas.width / this._dpr;
        const height = this._canvas.height / this._dpr;

        ctx.clearRect(0, 0, width, height);
        ctx.lineWidth = 1;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const scale = this._view.scale || 1;
        const viewTx = this._view.tx || 0;
        const viewTy = this._view.ty || 0;

        const arcs = this._model.arcs || [];
        arcs.forEach((arc, idx) => {
            const srcEl = this._nodes[arc.source];
            const trgEl = this._nodes[arc.target];
            if (!srcEl || !trgEl) return;

            const srcRect = srcEl.getBoundingClientRect();
            const trgRect = trgEl.getBoundingClientRect();

            // screen coordinates relative to root
            const sxScreen = (srcRect.left + srcRect.width / 2) - rootRect.left;
            const syScreen = (srcRect.top + srcRect.height / 2) - rootRect.top;
            const txScreen = (trgRect.left + trgRect.width / 2) - rootRect.left;
            const tyScreen = (trgRect.top + trgRect.height / 2) - rootRect.top;

            // convert screen coords -> stage-local (canvas) coords by inverting the CSS transform
            const sx = (sxScreen - viewTx) / scale;
            const sy = (syScreen - viewTy) / scale;
            const tx = (txScreen - viewTx) / scale;
            const ty = (tyScreen - viewTy) / scale;

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
                ctx.setLineDash([6, 4]);
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
                ctx.arc(tpx, tpy, inhibitRadius, 0, Math.PI * 2);
                ctx.fill();
                ctx.beginPath();
                ctx.fillStyle = '#ffffff';
                ctx.arc(tpx, tpy, 2.5, 0, Math.PI * 2);
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

            // position weight badge in stage-local coordinates
            const bx = (ex + fx) / 2;
            const by = (ey + fy) / 2;
            const badge = this._stage.querySelector(`.pv-weight[data-arc="${idx}"]`);
            if (badge) {
                badge.style.left = `${bx - 12}px`;
                badge.style.top = `${by - 10}px`;
            }
        });

        // live arc draft preview to mouse (convert mouse pos to stage-local)
        if (this._arcDraft && this._arcDraft.source) {
            const srcEl = this._nodes[this._arcDraft.source];
            if (srcEl) {
                const srcRect = srcEl.getBoundingClientRect();
                const sxScreen = (srcRect.left + srcRect.width / 2) - rootRect.left;
                const syScreen = (srcRect.top + srcRect.height / 2) - rootRect.top;
                const sx = (sxScreen - viewTx) / scale;
                const sy = (syScreen - viewTy) / scale;

                const mx = (this._mouse.x - viewTx) / scale;
                const my = (this._mouse.y - viewTy) / scale;

                ctx.setLineDash([4, 4]);
                ctx.strokeStyle = '#666';
                ctx.beginPath();
                ctx.moveTo(sx, sy);
                ctx.lineTo(mx, my);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }
    }
}

customElements.define('petri-view', PetriView);

export {PetriView};
