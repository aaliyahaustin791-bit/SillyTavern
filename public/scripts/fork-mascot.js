/* fork-mascot.js — Momo-chan, MobileTavern's home-screen greeter.
 * Standalone static file (loaded via index.html <head>, NOT webpack) so it
 * ships without a recompile. Talks only to #chat .welcomePanel markup:
 * tap her -> she hops + says a line in a bubble; 5 quick taps = hidden
 * reaction; she greets you once per home visit and idles occasionally.
 * All lines are local flavor text — no API calls, nothing leaves the phone.
 */
(function () {
    'use strict';
    if (window.__forkMascotLoaded) { return; }
    window.__forkMascotLoaded = true;

    var IMG_SEL = '#chat > .welcomePanel .welcomeMascot img';

    var S = {
        home: false,
        enteredAt: 0,
        greeted: false,
        taps: [],
        bubbleTimer: null,
        idleAt: 0,
        lastLine: '',
        ultra: false,
        ultraTimer: null,
    };

    /* ---------- tiny DOM helpers ---------- */

    function imgEl() { return document.querySelector(IMG_SEL); }

    function isHome() {
        var el = imgEl();
        return !!(el && el.closest('.welcomePanel') && el.offsetParent !== null);
    }

    function container() {
        var el = imgEl();
        return el ? el.parentElement : null;
    }

    function bubbleNode() {
        var c = container();
        if (!c) { return null; }
        var b = c.querySelector('.mascotBubble');
        if (!b) {
            b = document.createElement('div');
            b.className = 'mascotBubble';
            b.setAttribute('aria-hidden', 'true');
            c.appendChild(b);
        }
        return b;
    }

    function bubbleShowing() {
        var c = container();
        if (!c) { return false; }
        var b = c.querySelector('.mascotBubble');
        return !!(b && b.classList.contains('show'));
    }

    function hideBubble() {
        if (S.bubbleTimer) { clearTimeout(S.bubbleTimer); S.bubbleTimer = null; }
        var c = container();
        if (!c) { return; }
        var b = c.querySelector('.mascotBubble');
        if (b) { b.classList.remove('show'); }
    }

    function showBubble(text, duration) {
        var dur = duration || 4200;
        var b = bubbleNode();
        if (!b) { return; }
        b.textContent = text;
        b.classList.remove('show');
        void b.offsetWidth; /* restart the fade-in */
        b.classList.add('show');
        if (S.bubbleTimer) { clearTimeout(S.bubbleTimer); }
        S.bubbleTimer = setTimeout(function () {
            if (b.classList) { b.classList.remove('show'); }
            S.bubbleTimer = null;
        }, dur);
        S.lastLine = text;
        S.idleAt = Date.now() + 55000; /* a bubble buys her a quiet minute */
    }

    function bounce() {
        var el = imgEl();
        if (!el) { return; }
        el.classList.remove('mascot-bounce');
        void el.offsetWidth;
        el.classList.add('mascot-bounce');
        setTimeout(function () {
            if (el.classList) { el.classList.remove('mascot-bounce'); }
        }, 700);
    }

    /* ---------- line generation (all local flavor) ---------- */

    function hour() { return new Date().getHours(); }

    function pick(list) {
        return list[Math.floor(Math.random() * list.length)];
    }

    function greetingLine() {
        var h = hour();
        if (h >= 5 && h < 12) {
            return pick([
                'Good morning! The tavern is fresh and ready~ ☀️',
                'Rise and shine! I polished my halo while you slept ✨',
                'Morning, morning! Momo-chan is fully charged 💫',
            ]);
        }
        if (h >= 12 && h < 18) {
            return pick([
                'Welcome back to the Tavern~ ✨',
                'You\'re here! I was just thinking about you 💕',
                'Perfect timing — the stories were getting lonely~',
            ]);
        }
        if (h >= 18 && h < 23) {
            return pick([
                'Evening! The lanterns are lit and the stories are warm 🌙',
                'Cozy hour at the Tavern~ glad you made it 🍵',
                'The night shift starts... just me and my halo ✨',
            ]);
        }
        return pick([
            'Still up? Night stories hit different 🌙✨',
            'The Tavern never sleeps... but I do recommend it~',
            'Burning the midnight oil? Let me light your story 🔥',
        ]);
    }

    function shelfStats() {
        var rows = document.querySelectorAll('#chat .welcomePanel .recentChat:not(.hidden)');
        var count = 0, pinned = 0, oldest = null;
        var now = Date.now();
        rows.forEach(function (row) {
            count++;
            if (row.querySelector('.recentChatPinned')) { pinned++; }
            var nameEl = row.querySelector('.characterName');
            var dateEl = row.querySelector('.chatDate');
            var name = nameEl ? nameEl.textContent.trim() : '';
            var dateStr = dateEl ? (dateEl.getAttribute('title') || dateEl.textContent) : '';
            var t = Date.parse(dateStr);
            var days = isNaN(t) ? -1 : Math.floor((now - t) / 86400000);
            if (days >= 0 && (!oldest || days > oldest.days)) {
                oldest = { name: name, days: days };
            }
        });
        return { count: count, pinned: pinned, oldest: oldest };
    }

    function shelfLine(st) {
        if (st.count === 0) {
            return pick([
                'The shelf is empty... want to write the first story together? ✍️',
                'No tales on the shelf yet — the ink is fresh, the page is yours 📖',
            ]);
        }
        if (st.pinned > 0 && Math.random() < 0.6) {
            return pick([
                'Your pinned favorites are right up top 📌 — good taste~',
                st.pinned + ' pinned tale' + (st.pinned > 1 ? 's' : '') + ', always within reach 📌✨',
            ]);
        }
        if (st.count === 1) {
            return 'One story on the shelf, waiting just for you~ 💭';
        }
        return pick([
            st.count + ' stories on the shelf — quite the library you\'ve built! 📚',
            'I counted ' + st.count + ' adventures up there. You\'ve been busy! ✨',
        ]);
    }

    function waitingLine(st) {
        var o = st.oldest;
        if (!o || o.days < 3) { return null; }
        var dayWord = o.days === 1 ? 'day' : 'days';
        return pick([
            'Psst... ' + o.name + ' hasn\'t been by in ' + o.days + ' ' + dayWord + '. They miss you, I bet 🥺',
            o.name + ' is gathering dust... and dust is NOT a good look for a hero 😤',
            'I saw ' + o.name + ' looking at the door earlier. Just saying~ 👀',
            'It\'s been ' + o.days + ' ' + dayWord + ' since ' + o.name + '! A story this good shouldn\'t go cold 🍲',
        ]);
    }

    function cuteLine() {
        return pick([
            'My wings get sparkly every time you open the Tavern~ 💫',
            'I counted the halos in here... just mine. I\'m special ✨',
            'Halo\'s polished. Wings fluffed. Ready for story time! 🎀',
            'If the Tavern were a song, you\'d be the chorus 🎵',
            'Tap me again if you\'re bored — I don\'t mind one bit~ 😊',
            'I keep the welcome mat warm. Literally. Wings are great heaters 🕊️',
            'One day I\'ll figure out how to pour tea with these wings. Today is not that day 🍵',
        ]);
    }

    function ultraLine() {
        return pick([
            'FIVE taps?! Okay okay, you found me! 💖 Want me to tell the Story Advisor you\'re coming?',
            'Ehehe~ that tickles! What do I get for being so cute? 💕✨',
            'You\'re going to wear my halo out! ...I love it, keep going 💫',
        ]);
    }

    function idleLine() {
        return pick([
            '……*she hums softly, polishing her halo*',
            '*fluffs a wing* Ready when you are~',
            '*gently floats in place* I could do this all day~',
            '…the stories can wait. You take your time 💕',
        ]);
    }

    function makeLine(preferGreeting) {
        var st = shelfStats();
        var attempts = 0;
        while (attempts < 6) {
            attempts++;
            var r = Math.random();
            var line = null;
            if (preferGreeting || r < 0.25) {
                line = greetingLine();
            } else if (r < 0.55) {
                line = waitingLine(st);
                if (!line) { line = shelfLine(st); }
            } else if (r < 0.78) {
                line = shelfLine(st);
            } else {
                line = cuteLine();
            }
            if (line && line !== S.lastLine) { return line; }
        }
        return cuteLine();
    }

    /* ---------- interactions ---------- */

    function doUltra() {
        var el = imgEl();
        if (el) { el.classList.add('mascot-ultra'); }
        if (S.ultraTimer) { clearTimeout(S.ultraTimer); }
        S.ultraTimer = setTimeout(function () {
            if (el && el.classList) { el.classList.remove('mascot-ultra'); }
            S.ultra = false;
        }, 3600);
    }

    function react() {
        var now = Date.now();
        S.taps.push(now);
        S.taps = S.taps.filter(function (t) { return now - t < 2600; });
        bounce();
        if (S.taps.length >= 5 && !S.ultra) {
            S.ultra = true;
            S.taps = [];
            showBubble(ultraLine(), 5200);
            doUltra();
            return;
        }
        showBubble(makeLine(false));
    }

    /* tap anywhere on her (or her bubble) — capture so nothing steals it */
    document.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.closest) { return; }
        if (t.closest('#chat .welcomeMascot img, #chat .welcomeMascot .mascotBubble')) {
            react();
        }
    }, true);

    /* heartbeat: track home enter/leave, schedule greet + idle life */
    setInterval(function () {
        /* prune stale tap timestamps EVERY tick — they only used to expire on
           the next tap push, so one tap permanently blocked the greeting and
           idle gates (S.taps.length === 0 was never true again). */
        var nowMs = Date.now();
        S.taps = S.taps.filter(function (t) { return nowMs - t < 2600; });
        var home = isHome();
        if (home && !S.home) {
            S.home = true;
            S.enteredAt = Date.now();
            S.greeted = false;
            S.taps = [];
            S.idleAt = Date.now() + 60000;
        } else if (!home && S.home) {
            S.home = false;
            hideBubble();
        }
        if (!S.home) { return; }
        /* greet once, ~2.6s after the home screen appears, unless she was tapped */
        if (!S.greeted && Date.now() - S.enteredAt > 2600 && S.taps.length === 0 && !bubbleShowing()) {
            S.greeted = true;
            showBubble(makeLine(true));
            return;
        }
        /* idle life: only when she has been quiet for a while */
        if (Date.now() > S.idleAt && !bubbleShowing() && !S.ultra && S.taps.length === 0) {
            S.idleAt = Date.now() + 55000;
            if (Math.random() < 0.5) { showBubble(idleLine(), 3600); }
        }
    }, 1200);
})();
