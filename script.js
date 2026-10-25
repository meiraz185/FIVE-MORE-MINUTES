(() => {
  // ---------- Settings (easy to adjust) ----------

  // Scenes in order. 1–5 are alarm scenes, 6 is the ending.
  const SCENES = [
    { src: 'images/1.png', alt: 'Alarm at 07:00 — Just five more minutes...' },
    { src: 'images/2.png', alt: 'Alarm at 08:30 — Okay, one more...' },
    { src: 'images/3.png', alt: 'Alarm at 11:00 — Wait... what time is it?' },
    { src: 'images/4.png', alt: 'Alarm at 16:00 — I can still save the day...' },
    { src: 'images/5.png', alt: 'Alarm at 23:40 — Oops...' },
    { src: 'images/6.png', alt: 'Daily summary: 16h 40m time spent snoozing. Congratulations! You successfully avoided the entire day.' },
  ];

  // Hotspots as % of the image (measured from the 1672×941 artwork).
  // Add ?debug to the URL to see them.
  const SNOOZE_HOTSPOT = { left: 41.8, top: 67.2, width: 19.7, height: 10.5 };
  const RESTART_HOTSPOT = { left: 33.5, top: 82.1, width: 33.4, height: 9.9 };

  // Timing in milliseconds
  const FADE_OUT = 400;     // image → black
  const BLACK_HOLD = 900;   // black screen with ticking
  const FADE_IN = 500;      // black → next image
  const END_BLACK = 1000;   // ticking before the ending
  const END_SILENCE = 700;  // silence before the ending appears
  const END_FADE_IN = 1600; // slow reveal of the ending
  const RESTART_HOLD = 400; // black pause when restarting
  const MUSIC_FADE_IN = 1500; // ending music fade-in

  // ---------- Elements ----------

  const stage = document.getElementById('stage');
  const scene = document.getElementById('scene');
  const black = document.getElementById('black');
  const snoozeBtn = document.getElementById('snooze');
  const restartBtn = document.getElementById('restart');
  const startBtn = document.getElementById('start');
  const muteBtn = document.getElementById('mute');
  const alarm = document.getElementById('alarm');
  const tick = document.getElementById('tick');

  let index = 0;
  let busy = false;

  if (new URLSearchParams(location.search).has('debug')) {
    document.documentElement.classList.add('debug');
  }

  placeHotspot(snoozeBtn, SNOOZE_HOTSPOT);
  placeHotspot(restartBtn, RESTART_HOTSPOT);

  // ---------- Preload all images ----------

  const preloaded = SCENES.map(({ src }) => {
    const img = new Image();
    img.src = src;
    return img.decode ? img.decode().catch(() => {}) : Promise.resolve();
  });

  // ---------- Helpers ----------

  function placeHotspot(el, box) {
    el.style.left = box.left + '%';
    el.style.top = box.top + '%';
    el.style.width = box.width + '%';
    el.style.height = box.height + '%';
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function fadeBlack(on, ms) {
    black.style.transitionDuration = ms + 'ms';
    black.classList.toggle('on', on);
    return wait(ms);
  }

  function setBusy(value) {
    busy = value;
    stage.classList.toggle('busy', value);
  }

  function showScene(i) {
    index = i;
    scene.src = SCENES[i].src;
    scene.alt = SCENES[i].alt;
    const isEnding = i === SCENES.length - 1;
    snoozeBtn.hidden = isEnding;
    restartBtn.hidden = !isEnding;
  }

  function play(audio) {
    audio.currentTime = 0;
    return audio.play();
  }

  function stop(audio) {
    audio.pause();
    audio.currentTime = 0;
  }

  // ---------- Ending music ----------

  // Web Audio gives a gapless loop and a smooth fade-in in every browser.
  // If it isn't available (e.g. index.html opened from file://),
  // the <audio id="sleep"> element is used instead.
  const music = (() => {
    const AC = window.AudioContext || window.webkitAudioContext;
    const el = document.getElementById('sleep');
    let ctx = null;
    let buffer = null;
    let source = null;
    let fade = null;
    let mute = null;
    let fadeTimer = null;
    let muted = false;

    // Must be called from a user gesture (a SNOOZE click).
    function prepare() {
      if (ctx) {
        if (ctx.state === 'suspended') ctx.resume();
        return;
      }

      // Unlock the fallback element silently.
      el.volume = 0;
      el.play().then(() => stop(el)).catch(() => {});

      if (!AC) return;
      ctx = new AC();
      fade = ctx.createGain();
      mute = ctx.createGain();
      mute.gain.value = muted ? 0 : 1;
      fade.connect(mute);
      mute.connect(ctx.destination);
      fetch(el.getAttribute('src'))
        .then((r) => r.arrayBuffer())
        .then((data) => new Promise((res, rej) => ctx.decodeAudioData(data, res, rej)))
        .then((decoded) => { buffer = decoded; })
        .catch(() => {});
    }

    function start(ms) {
      stopMusic();
      if (ctx && buffer) {
        source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(fade);
        const t = ctx.currentTime;
        fade.gain.cancelScheduledValues(t);
        fade.gain.setValueAtTime(0, t);
        fade.gain.linearRampToValueAtTime(1, t + ms / 1000);
        source.start();
        return;
      }
      el.currentTime = 0;
      el.volume = 0;
      el.play().catch(() => {});
      const t0 = performance.now();
      fadeTimer = setInterval(() => {
        const p = Math.min((performance.now() - t0) / ms, 1);
        el.volume = p;
        if (p === 1) clearInterval(fadeTimer);
      }, 30);
    }

    function stopMusic() {
      clearInterval(fadeTimer);
      stop(el);
      if (source) {
        source.stop();
        source.disconnect();
        source = null;
      }
    }

    function setMuted(value) {
      muted = value;
      el.muted = value;
      if (mute) mute.gain.value = value ? 0 : 1;
    }

    return { prepare, start, stop: stopMusic, setMuted };
  })();

  // ---------- Sequence ----------

  async function snooze() {
    if (busy) return;
    setBusy(true);

    music.prepare();
    stop(alarm);
    play(tick).catch(() => {});
    const isLast = index === SCENES.length - 2;

    await fadeBlack(true, FADE_OUT);

    if (isLast) {
      await wait(END_BLACK);
      stop(tick);
      await wait(END_SILENCE);
      showScene(index + 1);
      await preloaded[index];
      music.start(MUSIC_FADE_IN);
      await fadeBlack(false, END_FADE_IN);
    } else {
      await wait(BLACK_HOLD);
      stop(tick);
      showScene(index + 1);
      await preloaded[index];
      play(alarm).catch(() => {});
      await fadeBlack(false, FADE_IN);
    }

    setBusy(false);
  }

  async function restart() {
    if (busy) return;
    setBusy(true);

    music.stop();
    stop(alarm);
    stop(tick);
    await fadeBlack(true, FADE_OUT);
    await wait(RESTART_HOLD);
    showScene(0);
    await preloaded[0];
    play(alarm).catch(() => {});
    await fadeBlack(false, FADE_IN);

    setBusy(false);
  }

  snoozeBtn.addEventListener('click', snooze);
  restartBtn.addEventListener('click', restart);

  // ---------- Mute ----------

  muteBtn.addEventListener('click', () => {
    const muted = muteBtn.getAttribute('aria-pressed') !== 'true';
    muteBtn.setAttribute('aria-pressed', String(muted));
    muteBtn.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
    alarm.muted = muted;
    tick.muted = muted;
    music.setMuted(muted);
  });

  // ---------- Start (autoplay handling) ----------

  // The ticking sound always starts on a SNOOZE click (a user gesture),
  // and the alarm is unlocked here, so later timed plays are allowed.
  async function begin() {
    play(alarm).catch(() => {});
    startBtn.classList.add('gone');
    await fadeBlack(false, FADE_IN);
    startBtn.hidden = true;
    setBusy(false);
  }

  showScene(0);
  setBusy(true);
  black.classList.add('on');

  play(alarm)
    .then(() => {
      // Autoplay allowed: reveal the first scene right away.
      fadeBlack(false, FADE_IN).then(() => setBusy(false));
    })
    .catch(() => {
      // Autoplay blocked: wait for one click before the alarm starts.
      startBtn.hidden = false;
      startBtn.addEventListener('click', begin, { once: true });
    });

  // Block dragging / context menu on the artwork
  document.addEventListener('dragstart', (e) => e.preventDefault());
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
})();
