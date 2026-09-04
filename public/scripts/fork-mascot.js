/* fork-mascot.js — Momo-chan, MobileTavern's home-screen greeter.
 * Standalone static file (loaded via index.html <head>, NOT webpack) so it
 * ships without a recompile. Talks only to #chat .welcomePanel markup.
 *
 * v2 personality (2026-09-03):
 *  - tap her          -> hop + themed speech bubble (data-aware)
 *  - 5 quick taps     -> rainbow glow + special line
 *  - greets on arrival, now RETURN-AWARE: quick trip back, real session,
 *    long absence, and multi-visit days each get their own tone
 *  - scrolls the list -> occasional "browsing" comment (debounced, cool-down)
 *  - idle whispers after a quiet minute
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
        leftAt: 0,          // when she was last left alone (0 = fresh session)
        awayMs: -1,         // how long the last absence lasted
        greeted: false,
        visitsToday: 0,
        visitDate: '',
        taps: [],
        bubbleTimer: null,
        idleAt: 0,
        lastLine: '',
        ultra: false,
        ultraTimer: null,
        scrollMoved: 0,
        scrollTimer: null,
        scrollCooldown: 0,
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
        void b.getBoundingClientRect(); /* restart the fade-in */
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

    function wave() {
        var el = imgEl();
        if (!el) { return; }
        el.classList.remove('mascot-wave');
        void el.offsetWidth;
        el.classList.add('mascot-wave');
        setTimeout(function () {
            if (el.classList) { el.classList.remove('mascot-wave'); }
        }, 900);
    }

    /* ---------- line pools ---------- */

    function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

    function hour() { return new Date().getHours(); }

    function hourGreeting() {
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

    function returnLine(awayMs) {
        if (awayMs < 20000) { /* quick trip back */
            return pick([
                'Back so soon? Missed me already? 💕',
                'Did you forget something?~ Or just missed my halo ✨',
                'That was fast! The stories can wait, you know~',
            ]);
        }
        if (awayMs < 4 * 3600000) { /* real session */
            return pick([
                'Welcome back~ How was the story? 🍵',
                'You were gone a while... good tale? I want details~',
                'Ooh, back already? Well — I missed you. The shelf did too 💕',
            ]);
        }
        return pick([
            'Welcome home! I kept the lantern burning 🏮✨',
            'There you are! I started polishing my wings out of boredom 🕊️',
            'A whole ' + Math.max(1, Math.round(awayMs / 3600000)) + ' hour' +
                (awayMs >= 7200000 ? 's' : '') + ' away... I counted. Welcome back~ ⏳',
        ]);
    }

    function visitLine() {
        return pick([
            S.visitsToday + ' visits to the Tavern today — someone\'s in a story mood! ✨',
            S.visitsToday + ' trips today and you still came back to me. I\'m flattered~ 💕',
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
                'An empty shelf is just a story waiting to happen~ ✨',
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
            'I gave the welcome mat a fresh polish today. You\'re welcome~',
            'If stories were fish, you\'d be a legend by now 🎣',
            'My halo doubles as a reading light, you know 📖✨',
            'I don\'t sleep. I just... glow softer 💤',
        ]);
    }

    function scrollLine() {
        return pick([
            'Ooh, browsing the shelf? Take your time~ 📖',
            'That one\'s got good energy... trust Momo-chan 👀',
            'The best story is the one you haven\'t opened yet~ ✨',
            'Window shopping? I approve. Window reading too 📚',
            'Looking for something specific? I know every spine on this shelf~',
        ]);
    }

    function idleLine() {
        return pick([
            '……*she hums softly, polishing her halo*',
            '*fluffs a wing* Ready when you are~',
            '*gently floats in place* I could do this all day~',
            '…the stories can wait. You take your time 💕',
            '*tries to catch a floating dust mote* …got it~ ✨',
            '*humming an old tavern tune* ♪',
            '*checks the door again* Any minute now... 💫',
        ]);
    }

    function rareLine() {
        return pick([
            'Psst — the ✦ button upstairs knows some very helpful people 🤫✨',
            'I\'ve read every story on this shelf. I have favorites. I\'m not telling 🤐💕',
            'Between you and me, I think the characters can feel when their story opens... spooky~ 👻',
        ]);
    }

    function ultraLine() {
        return pick([
            'FIVE taps?! Okay okay, you found me! 💖 Want me to tell the Story Advisor you\'re coming?',
            'Ehehe~ that tickles! What do I get for being so cute? 💕✨',
            'You\'re going to wear my halo out! ...I love it, keep going 💫',
        ]);
    }

    /* ---------- line selection ---------- */

    function makeLine(preferGreeting) {
        if (preferGreeting) {
            if (S.awayMs >= 0) { /* returning visitor, not a fresh page load */
                if (S.visitsToday >= 3 && Math.random() < 0.45) { return visitLine(); }
                return returnLine(S.awayMs);
            }
            return hourGreeting();
        }
        var st = shelfStats();
        var attempts = 0;
        while (attempts < 6) {
            attempts++;
            var r = Math.random();
            var line = null;
            if (r < 0.02) {
                line = rareLine();
            } else if (r < 0.27) {
                line = hourGreeting();
            } else if (r < 0.52) {
                line = waitingLine(st);
                if (!line) { line = shelfLine(st); }
            } else if (r < 0.75) {
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
        if (Math.random() < 0.15) { wave(); } else { bounce(); }
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

    /* scrolling the home list — she notices browsing (debounced, cool-down) */
    document.addEventListener('scroll', function (e) {
        if (!S.home) { return; }
        var t = e.target;
        if (!(t instanceof Element)) { return; }
        var isChatScroll = (t.id === 'chat' || (t.classList && t.classList.contains('welcomePanel')));
        if (!isChatScroll) { return; }
        S.scrollMoved += 1;
        if (S.scrollTimer) { clearTimeout(S.scrollTimer); }
        S.scrollTimer = setTimeout(function () {
            S.scrollTimer = null;
            if (!S.home || !S.scrollMoved || S.ultra || bubbleShowing()) { S.scrollMoved = 0; return; }
            S.scrollMoved = 0;
            if (Date.now() < S.scrollCooldown) { return; }
            if (Math.random() < 0.3) {
                S.scrollCooldown = Date.now() + 45000;
                showBubble(scrollLine(), 3800);
            }
        }, 1400);
    }, true);

    /* heartbeat: track home enter/leave, schedule greet + idle life */
    setInterval(function () {
        /* prune stale tap timestamps EVERY tick — they only used to expire on
           the next tap push, so one tap permanently blocked the greeting and
           idle gates (S.taps.length === 0 was never true again). */
        var now = Date.now();
        S.taps = S.taps.filter(function (t) { return now - t < 2600; });
        var home = isHome();
        if (home && !S.home) {
            S.home = true;
            S.enteredAt = now;
            S.greeted = false;
            S.taps = [];
            S.idleAt = now + 60000;
            /* measure the absence that just ended */
            if (S.leftAt > 0) {
                S.awayMs = now - S.leftAt;
                if (S.awayMs >= 30000) {
                    var dk = new Date().toDateString();
                    if (S.visitDate !== dk) { S.visitDate = dk; S.visitsToday = 0; }
                    S.visitsToday += 1;
                }
            } else {
                S.awayMs = -1; /* fresh page load — classic greeting */
            }
        } else if (!home && S.home) {
            S.home = false;
            S.leftAt = now;
            hideBubble();
        }
        if (!S.home) { return; }
        /* greet once, ~2.6s after the home screen appears, unless she was tapped */
        if (!S.greeted && now - S.enteredAt > 2600 && S.taps.length === 0 && !bubbleShowing()) {
            S.greeted = true;
            showBubble(makeLine(true));
            wave();
            return;
        }
        /* idle life: only when she has been quiet for a while */
        if (now > S.idleAt && !bubbleShowing() && !S.ultra && S.taps.length === 0) {
            S.idleAt = now + 55000;
            if (Math.random() < 0.5) { showBubble(idleLine(), 3600); }
        }
    }, 1200);
})();
