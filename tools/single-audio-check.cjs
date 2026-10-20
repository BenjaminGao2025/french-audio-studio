// Run with node tools/single-audio-check.cjs (uses the frontend's jsdom).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('../frontend/node_modules/jsdom');
const dom = new JSDOM('<audio id="sentence"></audio><video></video>', { runScripts: 'outside-only' });
const w = dom.window;
const paused = new WeakMap();
w.HTMLMediaElement.prototype.play = function () { paused.set(this, false); return Promise.resolve(); };
w.HTMLMediaElement.prototype.pause = function () { paused.set(this, true); this.dispatchEvent(new w.Event('pause')); };
Object.defineProperty(w.HTMLMediaElement.prototype, 'paused', { get() { return paused.get(this) !== false; } });
let spoken = null;
w.speechSynthesis = { speak(u) { spoken = u; }, cancel() { spoken = null; } };
w.OscillatorNode = class extends w.EventTarget { start() { this.stopped = false; } stop() { this.stopped = true; } };
w.eval(fs.readFileSync('static/audio-controller.js', 'utf8'));
(async () => {
 const sentence = w.document.querySelector('audio');
 let resets = 0;
 w.FrenchAudio.bind(sentence, () => resets++);
 await sentence.play();
 const word = new w.Audio('/word'); // Detached: document capture cannot see it.
 await word.play();
 assert(sentence.paused); assert.equal(resets, 1); assert(!word.paused);
 const utterance = new w.EventTarget();
 let speechReset = 0;
 w.FrenchAudio.bind(utterance, () => speechReset++);
 w.speechSynthesis.speak(utterance);
 assert(word.paused); assert.equal(spoken, utterance);
 const recording = new w.Audio('/my-recording');
 await recording.play();
 assert.equal(spoken, null); assert.equal(speechReset, 1);
 const native = w.document.querySelector('video');
 paused.set(native, false);
 native.dispatchEvent(new w.Event('play')); // Native controls, without JS play().
 assert(recording.paused); assert(!native.paused);
 const osc = new w.OscillatorNode(); osc.start();
 assert(native.paused);
 await word.play(); assert(osc.stopped);
 // A pending play cannot regain ownership when its promise resolves late.
 const pending = sentence.play();
 await word.play(); await pending;
 assert(sentence.paused); assert(!word.paused);
 // Interruption during a repeat gap still cancels the owner's scheduled work.
 let repeatCancelled = false;
 w.FrenchAudio.bind(word, () => { repeatCancelled = true; });
 word.dispatchEvent(new w.Event('ended'));
 await recording.play(); assert(repeatCancelled);
 // A multi-clip session may advance and fall back to speech without ending its UI.
 const session = {};
 let sessionStops = 0;
 const stopSession = () => sessionStops++;
 const firstClip = w.FrenchAudio.bind(new w.Audio(), stopSession, session);
 const nextClip = w.FrenchAudio.bind(new w.Audio(), stopSession, session);
 await firstClip.play(); await nextClip.play();
 assert(firstClip.paused); assert.equal(sessionStops, 0);
 const fallback = w.FrenchAudio.bind(new w.EventTarget(), stopSession, session);
 w.speechSynthesis.speak(fallback);
 assert(nextClip.paused); assert.equal(sessionStops, 0);
 await recording.play(); assert.equal(sessionStops, 1);
 w.FrenchAudio.stopAll(); assert(recording.paused);
 dom.window.close();
 console.log('single-audio legacy checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; dom.window.close(); });
