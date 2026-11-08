/* ==========================================================================
   French Audio Studio - Read selection, used by /study
   Select French text and a small floating bar offers "Read selection" (and "Meaning"):
     - desktop: drag with the mouse; the bar appears on mouseup
     - phone: long press and the system handles (selectionchange), or the per-sentence
       "Select" mode: tap the first word, then the last word
   The text is snapped to whole words and captured when the bar appears, so a selection the
   browser drops on the next tap cannot change what is read. Reading is always started from the
   tap on the bar itself (iOS only plays audio inside a user gesture).
   This file also tells a tap from a drag (isTap): the word hit areas are only for taps, so a
   click that ends a drag or a selection never opens the single-word popover.
   The mouse drag itself is painted here (not by the browser): a native drag that starts on a
   word does not survive — the word is focusable, which cancels the browser's selection drag
   when the caret lands at the word's edge, and the 44px hit area above the text moves the
   selection anchor past the word, dropping it from the selection.
   ========================================================================== */

(function (root) {
    'use strict';

    const doc = root.document;
    const EN = !root.FrenchI18n || root.FrenchI18n.lang() === 'en';
    const TEXT = {
        en: {
            toolbar: 'Selection actions', read: 'Read selection', meaning: 'Meaning', done: 'Done',
            hintFirst: 'Tap the first word', hintLast: 'Tap the last word',
        },
        zh: {
            toolbar: '选中内容操作', read: '朗读选中', meaning: '释义', done: '完成',
            hintFirst: '点第一个词', hintLast: '再点最后一个词',
        },
    };
    const T = TEXT[EN ? 'en' : 'zh'];

    // A pointer that moved further than this between press and click was dragging, not tapping
    const DRAG_PX = 8;
    // Longest phrase Meaning will look up (matches word-popover show() / etymology-sized lookups).
    // The Meaning button itself stays visible whenever Read is; longer text is capped at action time.
    const MEANING_MAX = 200;
    const SETTLE_MS = 300;
    const WORD_CHAR = /[\p{L}\p{N}'’-]/u;
    const HAS_LETTER = /[\p{L}\p{N}]/u;

    const ICON_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';
    const ICONS = {
        read: `<svg ${ICON_ATTRS}><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/></svg>`,
        done: `<svg ${ICON_ATTRS}><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
    };

    // ---- Tap or drag -------------------------------------------------------------------------
    let pressed = null;
    const rememberPress = (e) => { if (!(e.button > 0)) pressed = { x: e.clientX, y: e.clientY }; };
    doc.addEventListener('pointerdown', rememberPress, { capture: true, passive: true });
    // Browsers without pointer events
    doc.addEventListener('mousedown', rememberPress, { capture: true, passive: true });

    function selectedText() {
        const selection = root.getSelection && root.getSelection();
        return selection && !selection.isCollapsed ? selection.toString().trim() : '';
    }

    // A drag (moved too far) is never a tap. isTap also requires no selected text, so it stays
    // false while the Read/Meaning bar is up; word hits use isDrag + dismiss instead.
    function isDrag(e) {
        return Boolean(e && e.detail !== 0 && pressed && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > DRAG_PX);
    }
    function isTap(e) {
        if (isDrag(e)) return false;
        return !selectedText();
    }

    // ---- Snapping a range to whole French words -------------------------------------------------
    function frenchRegionOf(node) {
        const el = node && (node.nodeType === 1 ? node : node.parentElement);
        const region = el && el.closest('[lang]');
        return region && /^fr(?:-|$)/i.test(region.lang) && !region.closest('.read-selection-bar, [data-word-card], .floating-word-popover, [data-fr-card]') ? region : null;
    }

    // The French text nodes a range touches, with the two outer ends moved out to word edges.
    // Only French text counts: a drag across the word-by-word gloss also covers the English line
    // under each word, which must not be read.
    function snapRange(range) {
        const rootNode = range.commonAncestorContainer;
        const nodes = [];
        if (rootNode.nodeType === 3) nodes.push(rootNode);
        else {
            const walker = doc.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) if (range.intersectsNode(node)) nodes.push(node);
        }
        const pieces = [];
        for (const node of nodes) {
            if (!frenchRegionOf(node)) continue;
            const from = node === range.startContainer ? range.startOffset : 0;
            const to = node === range.endContainer ? range.endOffset : node.nodeValue.length;
            if (to > from) pieces.push({ node, from, to });
        }
        if (!pieces.length) return { text: '', range: null };
        const first = pieces[0];
        const last = pieces[pieces.length - 1];
        const inWord = (value, i) => WORD_CHAR.test(value[i - 1]) && WORD_CHAR.test(value[i]);
        while (first.from > 0 && inWord(first.node.nodeValue, first.from)) first.from--;
        while (last.to < last.node.nodeValue.length && inWord(last.node.nodeValue, last.to)) last.to++;
        let text = '';
        let lastRegion = null;
        for (const piece of pieces) {
            const region = frenchRegionOf(piece.node);
            // French words that sit in different elements (one per gloss column) need a space between
            // ...but not inside a hyphenated word: "avez-" and "vous" are two spans of one "avez-vous"
            if (lastRegion && region !== lastRegion && !region.contains(lastRegion) && !lastRegion.contains(region)
                && !/-$/.test(text) && !piece.node.nodeValue.slice(piece.from, piece.to).startsWith('-')) text += ' ';
            text += piece.node.nodeValue.slice(piece.from, piece.to);
            lastRegion = region;
        }
        text = text.replace(/[\s ]+/g, ' ').trim();
        text = text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}'’]+$/gu, '').trim();
        if (!HAS_LETTER.test(text)) return { text: '', range: null };
        const snapped = doc.createRange();
        snapped.setStart(first.node, first.from);
        snapped.setEnd(last.node, last.to);
        return { text, range: snapped };
    }

    function geometry(range) {
        const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 || r.height > 0);
        const box = range.getBoundingClientRect();
        return { rects, box: box && (box.width > 0 || box.height > 0) ? box : rects[0] || null };
    }

    const elementOf = (node) => (node.nodeType === 1 ? node : node.parentElement);

    // ---- Where the bar goes ------------------------------------------------------------------
    // A mouse: above the selection, below when there is no room (unchanged).
    // A touch screen: the system's own callout (Copy / Look Up / Translate) sits ABOVE the
    // selection and the two handles hang below its ends, so the bar goes BELOW the last selected
    // line, past the end handle, and never just above the text, where it would cover the callout.
    // Without room below: a selection running off the bottom of the screen gets the bar pinned to
    // the bottom edge (the end handle is off screen anyway); otherwise the bar goes above, leaving
    // room for the callout, and only when neither fits is it pinned to the bottom.
    const EDGE = 8;
    const TOUCH_HANDLE_GAP = 36;    // the end handle's knob under the text, plus air
    const TOUCH_CALLOUT_ROOM = 64;  // fallback above: the callout's height and its gaps
    function placement({ rects, box, width, height, view, touch }) {
        const first = (rects && rects[0]) || box;
        const last = (rects && rects[rects.length - 1]) || box;
        const left = Math.max(view.left + EDGE, Math.min((box.left + box.right) / 2 - width / 2, view.right - width - EDGE));
        if (!touch) {
            const above = first.top - 10 - height;
            const below = last.bottom + 10;
            if (above >= view.top + EDGE) return { left, top: above, side: 'above' };
            if (below + height <= view.bottom - EDGE) return { left, top: below, side: 'below' };
            return { left, top: view.bottom - height - EDGE, side: 'pinned' };
        }
        const below = last.bottom + TOUCH_HANDLE_GAP;
        const pinned = view.bottom - height - EDGE;
        if (below <= pinned) return { left, top: below, side: 'below' };
        if (last.bottom > view.bottom) return { left, top: pinned, side: 'pinned' };
        const above = first.top - TOUCH_CALLOUT_ROOM - height;
        if (above >= view.top + EDGE) return { left, top: above, side: 'above' };
        return { left, top: pinned, side: 'pinned' };
    }

    /**
     * options:
     *   speak(text, onEnd)         start reading the text (required); onEnd runs when it stops
     *   wordSelector               CSS selector of the tappable words (range mode)
     *   rangeLineFor(toggle)       the French line a [data-range-toggle] button selects words in
     *   meaning(text, anchor, ctx) optional: opens the phrase popover; anchor has getBoundingClientRect
     *   meaningOnSelect            true: a text selection opens that card directly (no Read/Meaning bar)
     *   contextFor(element)        optional: {sentence, sentence_cn} around the selection
     *   openWord()                 optional: the word element the popover is open for, if any
     */
    function create(options) {
        const wordSelector = options.wordSelector || '';
        const meaningOnSelect = Boolean(options.meaningOnSelect && options.meaning);
        const coarse = () => Boolean(root.matchMedia && root.matchMedia('(pointer: coarse)').matches);

        const bar = doc.createElement('div');
        bar.className = 'read-selection-bar';
        bar.setAttribute('role', 'toolbar');
        bar.setAttribute('aria-label', T.toolbar);
        bar.hidden = true;
        bar.innerHTML = `
            <span class="rs-hint" role="status" hidden></span>
            <button type="button" class="rs-btn rs-read" data-rs="read">${ICONS.read}<span>${T.read}</span></button>
            <button type="button" class="rs-btn rs-meaning" data-rs="meaning">${T.meaning}</button>
            <button type="button" class="rs-btn rs-done" data-rs="done" title="${T.done}" aria-label="${T.done}">${ICONS.done}</button>`;
        doc.body.appendChild(bar);
        const els = {
            hint: bar.querySelector('.rs-hint'), read: bar.querySelector('.rs-read'),
            meaning: bar.querySelector('.rs-meaning'), done: bar.querySelector('.rs-done'),
        };

        // What the bar acts on: {text, range, source: 'native' | 'range'}
        let state = null;
        // The last text the bar offered, with its box and the bar's own box snapshotted while
        // they were on screen. A phone can clear the selection (and hide the bar through another
        // path) during the tap on the bar; the action still runs on what the user saw.
        let remembered = null;
        // Meaning owns this range until the user selects a different span. Native selections often
        // remain painted while buttons are pressed; do not offer the same selection again.
        let meaningRange = null;
        const inCard = node => Boolean(node && (node.nodeType === 1 ? node : node.parentElement)?.closest('[data-word-card], .floating-word-popover, [data-fr-card]'));
        const sameRange = (a, b) => Boolean(a && b && a.startContainer === b.startContainer
            && a.startOffset === b.startOffset && a.endContainer === b.endContainer && a.endOffset === b.endOffset);
        let pressing = false;
        let pressTimer = null;
        let mouseHeld = false;
        let touching = false;
        let settleTimer = null;
        let hideTimer = null;
        let frame = 0;
        let playToken = 0;

        // ---- Bar -------------------------------------------------------------------------------
        // The visible screen, in the bar's (layout viewport) coordinates. On a touch screen this is
        // the visual viewport (pinch zoom, the keyboard, the collapsing toolbar) minus the safe area
        // (notch, home indicator); a mouse keeps the plain window, as before.
        let probe = null;
        function safeInsets() {
            if (!probe) {
                probe = doc.createElement('div');
                probe.className = 'rs-safe-probe';
                probe.setAttribute('aria-hidden', 'true');
                doc.body.appendChild(probe);
            }
            const style = root.getComputedStyle ? root.getComputedStyle(probe) : null;
            const px = (value) => parseFloat(value) || 0;
            return style
                ? { top: px(style.paddingTop), right: px(style.paddingRight), bottom: px(style.paddingBottom), left: px(style.paddingLeft) }
                : { top: 0, right: 0, bottom: 0, left: 0 };
        }
        function viewFor(touch) {
            const vw = root.innerWidth;
            const vh = root.innerHeight;
            if (!touch) return { left: 0, top: 0, right: vw, bottom: vh };
            const vv = root.visualViewport;
            const safe = safeInsets();
            const top = vv ? vv.offsetTop : 0;
            const left = vv ? vv.offsetLeft : 0;
            return {
                left: left + safe.left, top: top + safe.top,
                right: (vv ? left + vv.width : vw) - safe.right, bottom: (vv ? top + vv.height : vh) - safe.bottom,
            };
        }

        function place() {
            if (!state || bar.hidden) return;
            if (rangeLine && !rangeLine.isConnected) { exitRange(); return; }
            const { rects, box } = geometry(state.range);
            const touch = coarse();
            const view = viewFor(touch);
            if (!box || box.bottom < view.top || box.top > view.bottom || box.right < view.left || box.left > view.right) { hide(); return; }
            const width = bar.offsetWidth || 220;
            const height = bar.offsetHeight || 44;
            const { left, top, side } = placement({ rects, box, width, height, view, touch });
            bar.style.left = `${Math.round(left)}px`;
            bar.style.top = `${Math.round(top)}px`;
            bar.dataset.side = side;
            if (remembered && state.text === remembered.text) {
                remembered.box = snapshot(box);
                remembered.barBox = snapshot({ left, top, right: left + width, bottom: top + height, width, height });
            }
        }

        const usable = (r) => Boolean(r && (r.width > 0 || r.height > 0));
        const snapshot = (r) => (usable(r) ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } : null);

        function rememberText(next) {
            if (!next || !next.text) return;
            remembered = { text: next.text, range: next.range, box: null, barBox: null };
            if (next.range) remembered.box = snapshot(geometry(next.range).box);
        }

        // Where the popover goes: the live text if it still has a box, else the box it had,
        // else where the bar was, else the top of the screen (show() ignores a 0x0 anchor)
        function anchorBoxFor(picked) {
            let live = null;
            try { live = picked.range ? geometry(picked.range).box : null; } catch (err) { live = null; }
            const box = snapshot(live) || picked.box || picked.barBox;
            if (box) return box;
            const width = Math.min(240, Math.max(120, (root.innerWidth || 320) - 24));
            const left = Math.max(12, ((root.innerWidth || 320) - width) / 2);
            return { left, top: 80, right: left + width, bottom: 110, width, height: 30 };
        }

        function schedulePlace() {
            if (frame) return;
            const next = root.requestAnimationFrame || ((fn) => setTimeout(fn, 16));
            frame = next(() => { frame = 0; place(); });
        }

        function render() {
            const text = state ? state.text : '';
            const hint = rangeHint();
            els.hint.hidden = !hint;
            els.hint.textContent = hint;
            els.read.hidden = !text;
            // Always offer Meaning next to Read. Long phrases are capped when opening the popover,
            // not by hiding the button (a 45-char selection used to lose Meaning at the old 40 cap).
            els.meaning.hidden = !(text && options.meaning);
            els.done.hidden = !rangeLine;
            bar.classList.toggle('is-range', Boolean(rangeLine));
            bar.classList.toggle('has-text', Boolean(text));
        }

        function show(next) {
            clearTimeout(hideTimer);
            state = next;
            rememberText(next);
            bar.hidden = false;
            render();
            place();
        }

        function hide() {
            clearTimeout(hideTimer);
            bar.hidden = true;
            state = null;
            setPlaying(false);
        }

        function dismissSelection() {
            hide();
            const selection = root.getSelection && root.getSelection();
            if (selection) selection.removeAllRanges();
        }
        dismissActive = dismissSelection;


        function setPlaying(on) {
            els.read.classList.toggle('is-playing', on);
            els.read.setAttribute('aria-busy', String(on));
        }

        // ---- Native selection (mouse drag, long press and handles) ----------------------------------
        function nativeSelection() {
            const selection = root.getSelection && root.getSelection();
            if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
            const active = doc.activeElement;
            if (active && active.matches && active.matches('input, textarea, [contenteditable="true"]')) return null;
            const snapped = snapRange(selection.getRangeAt(0));
            return snapped.text ? snapped : null;
        }
        function evaluate(afterDoubleClick) {
            if (rangeLine && !rangeLine.isConnected) exitRange();
            if (rangeLine) return;
            const found = nativeSelection();
            if (found && sameRange(meaningRange, found.range)) { hide(); return; }
            if (found) meaningRange = null;
            if (!found) { scheduleHide(); return; }
            // A word the popover is already open for (a double click selects it afterwards) needs
            // no bar: the popover has its own speaker
            const open = afterDoubleClick === true && options.openWord ? options.openWord() : null;
            if (open && !found.text.includes(' ') && open.contains(found.range.commonAncestorContainer)) { hide(); return; }
            const picked = { text: found.text, range: found.range, source: 'native' };
            // Selecting text opens its meaning card directly; the card's speaker is the audio path.
            if (meaningOnSelect && openMeaning(picked)) return;
            show(picked);
        }

        function scheduleHide() {
            clearTimeout(hideTimer);
            // The tap on the bar itself collapses the selection on some browsers before its click
            hideTimer = setTimeout(() => { if (!pressing && !rangeLine) hide(); }, 200);
        }

        function scheduleEvaluate(delay, afterDoubleClick = false) {
            clearTimeout(settleTimer);
            settleTimer = setTimeout(() => evaluate(afterDoubleClick), delay);
        }

        // ---- Mouse drag, painted here -----------------------------------------------------------------
        // The browser's own drag-select cannot be used on the words: the word is focusable (a
        // native drag is cancelled when the caret lands at its edge) and the 44px hit area sits
        // above the text, which moves the selection anchor past the word — the word the drag
        // started on would be dropped. So the mousedown is answered here and the selection is
        // painted word by word while the mouse moves; on mouseup the usual evaluation shows the
        // bar. A long press on a phone selects natively and is not touched by this.
        const FRENCH_LINE = '.sentence-french-text, .buildup-fr-text, .dictation-diff, .dictation-answer-text, .deck-note-sentence, .answer-fr, .prompt-fr, .prompt-word';
        let dragFrom = null;

        const frenchLineOf = (target) => (target && target.closest ? target.closest(FRENCH_LINE) : null);
        const blind = (line) => Boolean(line && line.closest('.is-blind-mode'));

        // The word a point means on a French line: the one under it, else the nearest one
        function wordNear(e, startLine) {
            const direct = e.target.closest && e.target.closest(wordSelector);
            if (direct) return direct;
            const line = frenchLineOf(e.target) || startLine;
            if (!line || !root.FrenchWordPopover) return null;
            return root.FrenchWordPopover.nearestElement(line.querySelectorAll(wordSelector), e.clientX, e.clientY, 22);
        }

        function paintDrag(from, to) {
            if (!from || !to) return;
            const range = doc.createRange();
            if (from.compareDocumentPosition(to) & Node.DOCUMENT_POSITION_FOLLOWING) {
                range.setStartBefore(from);
                range.setEndAfter(to);
            } else {
                range.setStartBefore(to);
                range.setEndAfter(from);
            }
            const snapped = snapRange(range);
            if (!snapped.text) return;
            const selection = root.getSelection && root.getSelection();
            if (!selection) return;
            selection.removeAllRanges();
            selection.addRange(snapped.range);
            // Direct mode waits for mouseup (evaluate) to open one card; the bar does not flash
            // under the moving drag.
            if (!meaningOnSelect) show({ text: snapped.text, range: snapped.range, source: 'native' });
        }

        doc.addEventListener('mousedown', (e) => {
            if (e.button !== 0 || bar.contains(e.target) || inCard(e.target)) return;
            meaningRange = null;
            mouseHeld = true;
            if (!rangeLine) hide();
            const line = frenchLineOf(e.target);
            // Blind mode ("Test me") keeps its hidden chunks hidden; range mode picks by tap
            if (line && !rangeLine && !blind(line)) {
                e.preventDefault();
                dragFrom = wordNear(e, line);
            }
        });
        doc.addEventListener('mousemove', (e) => {
            if (!mouseHeld || !dragFrom) return;
            if (!pressed || Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) <= DRAG_PX) return;
            paintDrag(dragFrom, wordNear(e, frenchLineOf(dragFrom.closest(FRENCH_LINE))));
        });
        doc.addEventListener('mouseup', (e) => {
            dragFrom = null;
            if (!mouseHeld) return;
            mouseHeld = false;
            if (!bar.contains(e.target) && !inCard(e.target)) scheduleEvaluate(0, e.detail >= 2);
        });
        doc.addEventListener('touchstart', (e) => {
            touching = true;
            if (!bar.contains(e.target) && !inCard(e.target)) meaningRange = null;
        }, { passive: true });
        const touchEnded = (e) => { touching = false; if (!rangeLine && !bar.contains(e.target) && !inCard(e.target)) scheduleEvaluate(SETTLE_MS); };
        doc.addEventListener('touchend', touchEnded, { passive: true });
        doc.addEventListener('touchcancel', touchEnded, { passive: true });
        // Mark the bar pressed as early as possible (before selectionchange can hide it).
        // preventDefault on touch keeps the system from clearing the selection under the finger;
        // for mouse, mousedown below still does that without blocking click.
        const pressBar = (e) => {
            if (!bar.contains(e.target)) return;
            pressing = true;
            clearTimeout(pressTimer);
            pressTimer = setTimeout(() => { pressing = false; }, 800);
            if (e.cancelable && (e.type === 'touchstart' || e.pointerType === 'touch' || e.pointerType === 'pen')) {
                e.preventDefault();
            }
        };
        bar.addEventListener('touchstart', pressBar, { capture: true, passive: false });
        doc.addEventListener('pointerdown', pressBar, true);
        // Handles are dragged by the system, which sends no touch events: wait until they settle
        doc.addEventListener('selectionchange', () => {
            // While the finger/pointer is on the bar, keep it up even if the OS cleared the selection.
            // Do not hide the bar here: on phones selectionchange fires while handles settle, and
            // hiding for up to 1s made a valid selection look like it had no toolbar.
            if (rangeLine || mouseHeld || pressing) return;
            scheduleEvaluate(touching ? 1000 : SETTLE_MS);
        });
        // Keep the text selected while the bar is pressed (and no focus change on desktop)
        bar.addEventListener('mousedown', (e) => e.preventDefault());
        root.addEventListener('scroll', schedulePlace, { passive: true });
        root.addEventListener('resize', schedulePlace, { passive: true });
        // Pinch zoom, the keyboard and the collapsing browser bars move the visible screen
        if (root.visualViewport) {
            root.visualViewport.addEventListener('resize', schedulePlace, { passive: true });
            root.visualViewport.addEventListener('scroll', schedulePlace, { passive: true });
        }
        doc.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || bar.hidden) return;
            if (rangeLine) exitRange(); else { hide(); const s = root.getSelection && root.getSelection(); if (s) s.removeAllRanges(); }
        });

        // ---- Actions ----------------------------------------------------------------------------
        function context(picked) {
            let anchor = null;
            try { anchor = picked.range ? elementOf(picked.range.startContainer) : null; } catch (err) { anchor = null; }
            return options.contextFor && anchor && anchor.isConnected ? options.contextFor(anchor) || {} : {};
        }

        function meaningText(picked) {
            return picked.text.length > MEANING_MAX
                ? picked.text.slice(0, MEANING_MAX).replace(/\s+\S*$/, '').trim() || picked.text.slice(0, MEANING_MAX)
                : picked.text;
        }

        // Open the meaning card for a selection, with the same anchor/range stability the bar's
        // Meaning button used. The card's own speaker button is the only audio path.
        function openMeaning(picked) {
            if (!options.meaning || !picked || !picked.text) return false;
            rememberText(picked);
            const anchorBox = anchorBoxFor(picked);
            // Clone: a live Selection range mutates when the OS adjusts/clears the selection,
            // which made coversRange fail ~600ms later and auto-close the card.
            let range = null;
            try { range = picked.range ? picked.range.cloneRange() : null; } catch (err) { range = null; }
            const ctx = context(picked);
            const text = meaningText(picked);
            hide();
            clearTimeout(settleTimer);
            meaningRange = range ? range.cloneRange() : null;
            // coversRange() lets the popover tell this selection from a new one: it stays
            // open while the phrase it explains is still selected (one range holds the other)
            const holds = (outer, inner) => outer.compareBoundaryPoints(Range.START_TO_START, inner) <= 0
                && outer.compareBoundaryPoints(Range.END_TO_END, inner) >= 0;
            options.meaning(text, {
                getBoundingClientRect: () => anchorBox,
                // Source metadata is separate from the virtual anchor's geometry/stability.
                sourceRange: range ? range.cloneRange() : null,
                coversRange: (other) => { try { return Boolean(range && other && (holds(range, other) || holds(other, range))); } catch (err) { return false; } },
            }, ctx);
            return true;
        }

        // pointerup runs the action even when touchstart.preventDefault suppressed the click,
        // or when the OS cleared the selection mid-tap. click remains for keyboard activation.
        const GHOST_MS = 600;
        let actedAt = 0;
        const runBarAction = (e) => {
            const button = e.target.closest('[data-rs]');
            if (!button || button.disabled) return;
            if (e.type === 'pointerup' && e.button !== 0) return;
            // One shot per gesture: pointerup then the synthetic click must not double-fire
            if (e.type === 'click' && Date.now() - actedAt < GHOST_MS) { e.stopPropagation(); e.preventDefault(); return; }
            e.stopPropagation();
            pressing = false;
            clearTimeout(pressTimer);
            if (e.type === 'pointerup') actedAt = Date.now();
            const action = button.dataset.rs;
            if (action === 'done') { if (rangeLine) exitRange(); else hide(); return; }
            // The live state can be gone by now (selection cleared, bar hidden mid-tap): act on
            // the text the bar was showing
            const picked = state && state.text ? state : remembered;
            if (!picked || !picked.text) return;
            if (action === 'read') {
                // Starting a clip first ends the previous one, whose end callback must not reset this button
                const mine = ++playToken;
                options.speak(picked.text, () => { if (mine === playToken) setPlaying(false); });
                setPlaying(true);
                return;
            }
            if (action === 'meaning') openMeaning(picked);
        };
        bar.addEventListener('pointerup', runBarAction);
        bar.addEventListener('click', runBarAction);
        // The bar is hidden by the time the click that ends a touch on Meaning is dispatched, so
        // that click can land on the word under the bar. Swallow only clicks near the bar's last
        // box — a tap on a different word elsewhere must still open that word.
        doc.addEventListener('click', (e) => {
            if (!actedAt || Date.now() - actedAt >= GHOST_MS || bar.contains(e.target) || inCard(e.target)) return;
            const box = remembered && remembered.barBox;
            if (box) {
                const pad = 12;
                const hit = e.clientX >= box.left - pad && e.clientX <= box.right + pad
                    && e.clientY >= box.top - pad && e.clientY <= box.bottom + pad;
                if (!hit) return;
            }
            actedAt = 0;
            e.stopImmediatePropagation();
            e.preventDefault();
        }, true);

        // ---- Range mode: tap the first word, then the last ------------------------------------------
        let rangeLine = null;
        let rangeToggle = null;
        let anchorWord = null;
        let endWord = null;
        const wordsOfLine = () => (rangeLine ? Array.from(rangeLine.querySelectorAll(wordSelector)) : []);

        function paintRange() {
            const words = wordsOfLine();
            const a = words.indexOf(anchorWord);
            const b = words.indexOf(endWord);
            const from = Math.min(a, b);
            const to = Math.max(a, b);
            words.forEach((word, i) => {
                const inside = a !== -1 && i >= from && i <= to;
                word.classList.toggle('is-range-word', inside);
                word.classList.toggle('is-range-last', inside && i === to);
            });
        }

        function rangeState() {
            const words = wordsOfLine();
            const a = words.indexOf(anchorWord);
            const b = words.indexOf(endWord);
            if (a === -1 || b === -1) return null;
            const span = doc.createRange();
            span.setStartBefore(words[Math.min(a, b)]);
            span.setEndAfter(words[Math.max(a, b)]);
            const snapped = snapRange(span);
            return snapped.text ? { text: snapped.text, range: snapped.range, source: 'range' } : null;
        }

        function showRange() {
            const next = rangeState();
            if (next) { show(next); return; }
            // Nothing picked yet: the bar only explains what to do, next to the line
            const line = doc.createRange();
            line.selectNodeContents(rangeLine);
            state = { text: '', range: line, source: 'range' };
            bar.hidden = false;
            render();
            place();
        }

        let pickedSecond = false;
        // What to do next, while words are being picked
        function rangeHint() {
            if (!rangeLine) return '';
            return !anchorWord ? T.hintFirst : pickedSecond ? '' : T.hintLast;
        }

        function enterRange(line, toggle) {
            exitRange();
            rangeLine = line;
            rangeToggle = toggle;
            anchorWord = null;
            endWord = null;
            pickedSecond = false;
            line.classList.add('is-range-mode');
            toggle.setAttribute('aria-pressed', 'true');
            const selection = root.getSelection && root.getSelection();
            if (selection) selection.removeAllRanges();
            showRange();
        }

        function exitRange() {
            if (!rangeLine) return;
            wordsOfLine().forEach((word) => word.classList.remove('is-range-word', 'is-range-last'));
            rangeLine.classList.remove('is-range-mode');
            if (rangeToggle) rangeToggle.setAttribute('aria-pressed', 'false');
            rangeLine = null;
            rangeToggle = null;
            anchorWord = null;
            endWord = null;
            hide();
        }

        function pickWord(word) {
            if (!anchorWord || pickedSecond) {
                anchorWord = word;
                endWord = word;
                pickedSecond = false;
            } else {
                endWord = word;
                pickedSecond = true;
            }
            paintRange();
            const complete = pickedSecond && rangeState();
            if (complete && meaningOnSelect) {
                // A complete range is a selection too: open its card and leave the picking mode.
                exitRange();
                openMeaning(complete);
                return;
            }
            showRange();
        }

        // The word a click means inside the range line: the one clicked, else the nearest on the line
        function wordInLine(e) {
            const direct = e.target.closest(wordSelector);
            if (direct && rangeLine.contains(direct)) return direct;
            if (e.detail === 0 || !root.FrenchWordPopover) return null;
            return root.FrenchWordPopover.nearestElement(wordsOfLine(), e.clientX, e.clientY, 22);
        }

        // Capture phase on the document: nothing below (word popover, sentence row) sees these clicks
        doc.addEventListener('click', (e) => {
            const toggle = e.target.closest && e.target.closest('[data-range-toggle]');
            if (toggle) {
                const line = options.rangeLineFor ? options.rangeLineFor(toggle) : null;
                if (!line) return;
                e.stopPropagation();
                if (rangeLine === line) exitRange(); else enterRange(line, toggle);
                return;
            }
            if (!rangeLine || bar.contains(e.target) || !rangeLine.contains(e.target)) return;
            e.stopPropagation();
            e.preventDefault();
            if (e.detail !== 0 && pressed && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > DRAG_PX) return;
            const word = wordInLine(e);
            if (word) pickWord(word);
        }, true);

        return {
            bar, hide, isRangeMode: () => Boolean(rangeLine), current: () => (state ? state.text : ''),
            exitRange, evaluate,
        };
    }

    let dismissActive = () => {};
    root.FrenchReadSelection = { create, isTap, isDrag, snapRange, placement, dismiss: () => dismissActive() };

})(window);
