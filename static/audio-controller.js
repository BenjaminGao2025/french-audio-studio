/* One playback owner per page, including detached Audio objects and native controls. */
(function (root) {
    'use strict';
    if (root.FrenchAudio) return;
    const bindings = new WeakMap();
    let active = null;

    function bind(source, stop, owner = source) {
        bindings.set(source, { stop, owner });
        return source;
    }
    function interrupt(entry) {
        if (!entry) return;
        entry.cancelled = true;
        // Invalidate the session before pause/cancel can fire callbacks.
        try { entry.stop(); } catch (_) {}
        const binding = bindings.get(entry.source);
        if (binding) binding.stop();
        entry.source.dispatchEvent(new Event('audiointerrupt'));
    }
    function claim(source, stop) {
        if (active && active.source === source && !active.cancelled) return active;
        const previous = active;
        active = null;
        const owner = (bindings.get(source) || {}).owner || source;
        if (previous) {
            if (previous.owner === owner) {
                previous.cancelled = true;
                previous.stop();
            } else interrupt(previous);
        }
        document.querySelectorAll('audio, video').forEach(media => {
            if (media !== source && !media.paused) media.pause();
        });
        const entry = { source, owner, stop, cancelled: false };
        active = entry;
        return entry;
    }
    function stopAll() {
        const previous = active;
        active = null;
        interrupt(previous);
        document.querySelectorAll('audio, video').forEach(media => media.pause());
    }
    const mediaProto = root.HTMLMediaElement.prototype;
    const nativePlay = mediaProto.play;
    mediaProto.play = function (...args) {
        const entry = claim(this, () => this.pause());
        // Claim synchronously: even a pending play request must be interrupted.
        return Promise.resolve(nativePlay.apply(this, args)).then(value => {
            if (entry.cancelled) this.pause();
            return value;
        });
    };
    document.addEventListener('play', event => {
        const media = event.target;
        if (media instanceof root.HTMLMediaElement) claim(media, () => media.pause());
    }, true);

    const synth = root.speechSynthesis;
    if (synth) {
        const speak = synth.speak.bind(synth);
        synth.speak = function (utterance) {
            claim(utterance, () => synth.cancel());
            // Cancel browser speech queued outside this controller as well.
            synth.cancel();
            return speak(utterance);
        };
    }
    // Oscillators and decoded buffer sources can otherwise outlive media playback.
    for (const name of ['AudioBufferSourceNode', 'OscillatorNode', 'ConstantSourceNode']) {
        const proto = root[name] && root[name].prototype;
        if (!proto) continue;
        const start = proto.start;
        proto.start = function (...args) {
            claim(this, () => { try { this.stop(); } catch (_) {} });
            return start.apply(this, args);
        };
    }
    root.addEventListener('pagehide', stopAll);
    root.FrenchAudio = { bind, stopAll };
})(window);
