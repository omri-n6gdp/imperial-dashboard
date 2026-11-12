/* ---------------------------------------------------------------- voice (spoken viva, dictation)
   Speaking uses the Mac's own voices (speechSynthesis); listening uses the browser's speech recognition
   (Safari: Siri dictation; it asks for the microphone the first time). Maths in an answer is read out in words
   ("psi equals A e to the i k x"), citations and formatting are skipped. Used by the study buddy (buddy.js). */
(() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const V = { rec: null, want: false, speaking: false, onState: null, silenceT: null };
  const GREEK = 'alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi rho sigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Phi Psi Omega'.split(' ');
  const WORDS = { hbar: 'h bar', partial: 'partial', nabla: 'del', int: 'the integral of', oint: 'the loop integral of', sum: 'the sum of', prod: 'the product of', infty: 'infinity',
    approx: 'is about', sim: 'is about', propto: 'is proportional to', cdot: 'times', times: 'times', pm: 'plus or minus', mp: 'minus or plus', to: 'tends to', rightarrow: 'goes to',
    Rightarrow: 'which gives', leq: 'is at most', le: 'is at most', geq: 'is at least', ge: 'is at least', neq: 'is not equal to', ll: 'is much less than', gg: 'is much greater than',
    langle: 'the expectation of', rangle: '', dagger: 'dagger', ln: 'log', log: 'log', exp: 'exp', sin: 'sine', cos: 'cos', tan: 'tan', dot: '', vec: 'vector', hat: 'hat',
    mathrm: '', text: '', mathbf: '', boldsymbol: '', left: '', right: '', quad: ',', qquad: ',', ',': ' ', ';': ' ', '!': '', degree: 'degrees', circ: 'degrees', AA: 'angstroms' };
  GREEK.forEach(g => { WORDS[g] = g.replace(/^var/, ''); });

  function texWords(t) {
    let s = ' ' + t + ' ';
    for (let i = 0; i < 4; i++) {
      s = s.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, ' $1 over $2 ')
        .replace(/\\sqrt\s*\{([^{}]*)\}/g, ' root of $1 ')
        .replace(/\^\s*\{\s*2\s*\}|\^2/g, ' squared ').replace(/\^\s*\{\s*3\s*\}|\^3/g, ' cubed ')
        .replace(/\^\s*\{\s*\\dagger\s*\}|\^\\dagger/g, ' dagger ')
        .replace(/\^\s*\{([^{}]*)\}/g, ' to the $1 ').replace(/\^\s*(\\?\w)/g, ' to the $1 ')
        .replace(/_\s*\{([^{}]*)\}/g, ' $1 ').replace(/_\s*(\\?\w)/g, ' $1 ');
    }
    s = s.replace(/\\([a-zA-Z]+|[,;!])/g, (m, w) => ' ' + (w in WORDS ? WORDS[w] : w) + ' ')
      .replace(/[{}]/g, ' ').replace(/\s=\s|=/g, ' equals ').replace(/\s-\s|(?<=\w)-(?=\w)/g, ' minus ').replace(/^\s*-|(?<=[\s(])-/g, ' minus ')
      .replace(/\+/g, ' plus ').replace(/\//g, ' over ').replace(/</g, ' is less than ').replace(/>/g, ' is greater than ')
      .replace(/\|/g, ' ').replace(/~/g, ' about ').replace(/&/g, ' ').replace(/\\\\/g, ', ');
    return s.replace(/\s+/g, ' ').trim();
  }
  function sayable(md) {
    return String(md || '')
      .replace(/\$\$([\s\S]+?)\$\$/g, (m, t) => ' ' + texWords(t) + ' ').replace(/\$([^$\n]+?)\$/g, (m, t) => texWords(t))
      .replace(/\[(S\d+|file:[^\]]*)\]/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^\s*\*\*Try next:?\*\*[\s\S]*$/m, '').replace(/^VIVA RESULT:.*$/m, '')
      .replace(/[*_`#>]+/g, '').replace(/^\s*[-•]\s+/gm, '').replace(/\n{2,}/g, '. ').replace(/\n/g, ' ')
      .replace(/\s+/g, ' ').replace(/(\.\s*){2,}/g, '. ').trim();
  }

  /* ---- speaking */
  let voice = null;
  function pickVoice() {
    const vs = speechSynthesis.getVoices();
    voice = vs.find(v => /en-GB/i.test(v.lang) && /Daniel|Serena|Kate|Arthur|Martha|Premium|Enhanced/i.test(v.name)) || vs.find(v => /en-GB/i.test(v.lang)) || vs.find(v => /^en/i.test(v.lang)) || null;
  }
  if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  function speak(md, done) {
    if (!('speechSynthesis' in window)) { if (done) done(); return; }
    stopListening(); speechSynthesis.cancel();
    const text = sayable(md), parts = text.match(/[^.!?]+[.!?]*\s*/g) || [text];
    V.speaking = true; state_();
    let i = 0;
    const next = () => {
      if (!V.speaking) return;
      if (i >= parts.length) { V.speaking = false; state_(); if (done) done(); return; }
      const u = new SpeechSynthesisUtterance(parts[i++]);
      if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-GB';
      u.rate = 1.02;
      u.onend = next; u.onerror = next;
      speechSynthesis.speak(u);
    };
    next();
  }
  function stopSpeaking() { V.speaking = false; if ('speechSynthesis' in window) speechSynthesis.cancel(); state_(); }
  /* Safari only lets a page talk after a click: call this from the click that starts a spoken viva */
  function unlock() { try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) { /* no speech */ } }

  /* ---- listening: words go into the box as you speak; with autoSend, a pause of a few seconds sends them */
  function listen(qa, o = {}) {
    if (!SR) return false;
    stopSpeaking(); stopListening();
    const rec = new SR(), base = qa.value ? qa.value.replace(/\s*$/, ' ') : '';
    rec.lang = 'en-GB'; rec.continuous = true; rec.interimResults = true;
    let fin = '';
    V.rec = rec; V.want = true; V.qa = qa; V.o = o; state_();
    const finish = send => {
      clearTimeout(V.silenceT);
      const said = (base + fin).trim();
      V.want = false; try { rec.stop(); } catch (e) { /* ended */ }
      if (send && said && o.onSend) o.onSend(said);
    };
    V.finish = finish;
    rec.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) fin += r[0].transcript + ' '; else interim += r[0].transcript;
      }
      qa.value = base + fin + interim;
      qa.dispatchEvent(new Event('input', { bubbles: true }));
      clearTimeout(V.silenceT);
      if (/\b(that'?s my answer|i'?m done|done answering)\W*$/i.test((fin + interim).trim())) {
        fin = fin.replace(/\b(that'?s my answer|i'?m done|done answering)\W*$/i, ''); return finish(true);
      }
      if (o.autoSend && (fin + interim).trim()) V.silenceT = setTimeout(() => finish(true), o.pause || 3500);
    };
    rec.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { V.want = false; if (o.onError) o.onError('mic'); } };
    rec.onend = () => {
      if (V.rec !== rec) return;
      if (V.want) { try { rec.start(); return; } catch (e) { /* give up */ } }        // Safari stops after a while: carry on
      V.rec = null; V.want = false; clearTimeout(V.silenceT); state_();
    };
    try { rec.start(); } catch (e) { V.rec = null; V.want = false; state_(); return false; }
    return true;
  }
  function stopListening(send) { if (V.rec) { if (V.finish) V.finish(!!send); V.rec = null; V.want = false; state_(); } }
  function state_() { if (V.onState) V.onState({ speaking: V.speaking, listening: !!V.rec }); }

  window.icdVoice = { canListen: !!SR, canSpeak: 'speechSynthesis' in window, speak, stopSpeaking, unlock, listen, stopListening,
    stopAll() { stopSpeaking(); stopListening(false); }, listening: () => !!V.rec, speaking: () => V.speaking, onState: f => { V.onState = f; }, sayable, texWords };
})();
