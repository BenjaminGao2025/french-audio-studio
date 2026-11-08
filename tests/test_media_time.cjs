// Run with: node tests/test_media_time.cjs
// static/media-time.js: audio time counts while audio is really playing (also with the phone locked),
// each second once, seeks and bad readings are not listening, and detached Audio() objects count too.
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const MT = require('../static/media-time.js');

const dom = new JSDOM('<body><audio id="a"></audio></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
const { window } = dom;
const { document } = window;
// jsdom cannot play audio: a stand-in play() that the tracker wraps like the browser's
const nativePlay = function play() { return Promise.resolve(); };
window.HTMLMediaElement.prototype.play = nativePlay;
const credits = [];
let clock = 1_000_000;
let active = false;
const tracker = MT.create({
    document, window, now: () => clock, tickMs: 5000,
    isActive: () => active,
    laneFor: el => (el ? 'car' : 'reading'),
    onSeconds: (lane, seconds) => credits.push([lane, Math.round(seconds)]),
});
const total = () => credits.reduce((sum, [, s]) => sum + s, 0);
const reset = () => { credits.length = 0; };

// A media element whose position and paused state the test drives (jsdom does not play audio)
function fakeAudio(el) {
    let position = 0;
    let paused = true;
    Object.defineProperty(el, 'currentTime', { get: () => position, set: v => { position = v; el.dispatchEvent(new window.Event('seeking')); el.dispatchEvent(new window.Event('seeked')); }, configurable: true });
    Object.defineProperty(el, 'paused', { get: () => paused, configurable: true });
    Object.defineProperty(el, 'ended', { get: () => false, configurable: true });
    return {
        play() { paused = false; el.dispatchEvent(new window.Event('play')); },
        pause() { paused = true; el.dispatchEvent(new window.Event('pause')); },
        advance(seconds, wall = seconds) { position += seconds; clock += wall * 1000; },
    };
}

const audio = document.getElementById('a');
const drive = fakeAudio(audio);

// 1. Play 30 s with the page in the foreground ticking along: counted from the audio
drive.play();
for (let i = 0; i < 6; i++) { drive.advance(5); tracker.beat(); }
drive.pause();
assert.equal(total(), 30);
assert.ok(credits.every(([lane]) => lane === 'car'), 'audio earns its own lane');

// 2. Locked iPhone: the page's timers froze for 20 minutes while the audio played on; waking up
//    (visibilitychange) reads the position jump
reset();
drive.play();
drive.advance(1200, 1200);
document.dispatchEvent(new window.Event('visibilitychange'));
assert.equal(total(), 1200);
drive.pause();

// 3. Paused time is not counted: 5 minutes of nothing, then a beat
reset();
clock += 300_000;
tracker.beat();
assert.equal(total(), 0);

// 4. A seek is not listening (the position jumps with no wall time passing)
reset();
drive.play();
drive.advance(10);
tracker.beat();
audio.currentTime = 600;       // the learner scrubs forward
drive.advance(5);
tracker.beat();
drive.pause();
assert.equal(total(), 15, '10 s + 5 s played, the 590 s jump is skipped');

// 5. No double counting: the page is in use AND audio plays: one second is counted once
reset();
active = true;
tracker.beat();                // learn that the page is active
drive.play();
for (let i = 0; i < 6; i++) { drive.advance(5); tracker.beat(); }
drive.pause();
active = false;
assert.ok(total() <= 32 && total() >= 28, `30 s of use + audio counted once, got ${total()}`);

// 6. A gap is capped: a page that was active, then nothing for an hour, does not earn an hour
reset();
active = true;
tracker.beat();
clock += 3_600_000;
tracker.beat();
active = false;
assert.ok(total() <= 10, `active credit is bounded to a tick or two, got ${total()}`);

// 7. A detached Audio() (never in the document) is found through play()
reset();
let detachedPosition = 0;
let detachedPaused = true;
const DetachedAudio = window.Audio;
const clip = new DetachedAudio();
Object.defineProperty(clip, 'currentTime', { get: () => detachedPosition, configurable: true });
Object.defineProperty(clip, 'paused', { get: () => detachedPaused, configurable: true });
Object.defineProperty(clip, 'ended', { get: () => false, configurable: true });
assert.notEqual(window.HTMLMediaElement.prototype.play, nativePlay, 'play() is wrapped');
detachedPaused = false;
clip.play();
detachedPosition = 40;
clock += 40_000;
tracker.beat();
assert.equal(total(), 40);
detachedPaused = true;
clip.dispatchEvent(new window.Event('pause'));

// 8. destroy() stops everything and restores play()
tracker.destroy();
assert.equal(tracker.playing(), 0);
assert.equal(window.HTMLMediaElement.prototype.play, nativePlay, 'play() restored');

console.log('PASS: media time (lock screen, no double count, seeks, gaps, detached Audio).');
