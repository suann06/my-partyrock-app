/* =============================================
   TASTE OF MALAYSIA — script.js
   Handles: navbar scroll shadow, mobile menu
            toggle, smooth scroll, active link
   ============================================= */

(function () {
  'use strict';

  /* ── Element references ── */
  const navbar    = document.getElementById('navbar');
  const navToggle = document.getElementById('navToggle');
  const navLinks  = document.getElementById('navLinks');
  const allLinks  = document.querySelectorAll('.nav-link');

  /* =============================================
     1. NAVBAR — add shadow when page is scrolled
     ============================================= */
  function onScroll() {
    if (window.scrollY > 10) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });

  /* =============================================
     2. MOBILE HAMBURGER MENU TOGGLE
     ============================================= */
  navToggle.addEventListener('click', function () {
    const isOpen = navLinks.classList.toggle('open');
    navToggle.classList.toggle('active', isOpen);
    navToggle.setAttribute('aria-expanded', isOpen);
  });

  /* Close mobile menu when a link is clicked */
  allLinks.forEach(function (link) {
    link.addEventListener('click', function () {
      navLinks.classList.remove('open');
      navToggle.classList.remove('active');
      navToggle.setAttribute('aria-expanded', false);
    });
  });

  /* Close mobile menu if user clicks outside the nav */
  document.addEventListener('click', function (e) {
    if (!navbar.contains(e.target)) {
      navLinks.classList.remove('open');
      navToggle.classList.remove('active');
      navToggle.setAttribute('aria-expanded', false);
    }
  });

  /* =============================================
     3. SMOOTH SCROLL for anchor links
        (CSS scroll-behavior handles modern browsers,
         this is a fallback for older ones)
     ============================================= */
  allLinks.forEach(function (link) {
    link.addEventListener('click', function (e) {
      const href = link.getAttribute('href');

      if (href && href.startsWith('#')) {
        const target = document.querySelector(href);
        if (target) {
          e.preventDefault();
          const navHeight = navbar.offsetHeight;
          const targetTop = target.getBoundingClientRect().top + window.scrollY - navHeight;

          window.scrollTo({
            top: targetTop,
            behavior: 'smooth'
          });
        }
      }
    });
  });

  /* Also handle the hero "Explore Food" button */
  const exploreBtn = document.querySelector('.btn-explore');
  if (exploreBtn) {
    exploreBtn.addEventListener('click', function (e) {
      const href = exploreBtn.getAttribute('href');
      if (href && href.startsWith('#')) {
        const target = document.querySelector(href);
        if (target) {
          e.preventDefault();
          const navHeight = navbar.offsetHeight;
          const targetTop = target.getBoundingClientRect().top + window.scrollY - navHeight;
          window.scrollTo({ top: targetTop, behavior: 'smooth' });
        }
      }
    });
  }

  /* =============================================
     4. ACTIVE NAV LINK — highlight based on scroll
     ============================================= */
  const sections = document.querySelectorAll('section[id]');

  function setActiveLink() {
    const scrollY    = window.scrollY;
    const navHeight  = navbar.offsetHeight;

    sections.forEach(function (section) {
      const sectionTop    = section.offsetTop - navHeight - 20;
      const sectionBottom = sectionTop + section.offsetHeight;
      const id            = section.getAttribute('id');
      const link          = document.querySelector('.nav-link[href="#' + id + '"]');

      if (link) {
        if (scrollY >= sectionTop && scrollY < sectionBottom) {
          allLinks.forEach(function (l) { l.classList.remove('active'); });
          link.classList.add('active');
        }
      }
    });
  }

  window.addEventListener('scroll', setActiveLink, { passive: true });

  /* Run once on load to set the initial active state */
  setActiveLink();

})();


/* =============================================
   FOODIE AI CHATBOT — frontend logic
   Communicates with POST /api/chat on the
   Express server. Never talks to Bedrock directly.
   ============================================= */

(function () {
  'use strict';

  /* ── Element references ── */
  const fab        = document.getElementById('chatFab');
  const chatWindow = document.getElementById('chatWindow');
  const closeBtn   = document.getElementById('chatCloseBtn');
  const messages   = document.getElementById('chatMessages');
  const input      = document.getElementById('chatInput');
  const sendBtn    = document.getElementById('chatSendBtn');
  const loading    = document.getElementById('chatLoading');

  /* ── Conversation history sent to the server ── */
  let history = [];   // [{ role: 'user'|'assistant', content: '...' }, ...]

  /* ── Welcome message (shown once on first open) ── */
  const WELCOME =
    '👋 Hi! I\'m Foodie AI Assistant. Ask me anything about Malaysian cuisine — ' +
    'dishes, ingredients, cooking methods or food culture. How can I help you today?';

  let welcomeShown = false;

  /* =============================================
     Open / Close chat window
     ============================================= */
  function openChat() {
    chatWindow.hidden = false;
    fab.setAttribute('aria-expanded', 'true');
    input.focus();

    if (!welcomeShown) {
      appendMessage('assistant', WELCOME);
      welcomeShown = true;
    }
  }

  function closeChat() {
    chatWindow.hidden = true;
    fab.setAttribute('aria-expanded', 'false');
    fab.focus();
  }

  fab.addEventListener('click', openChat);
  closeBtn.addEventListener('click', closeChat);

  /* Close on Escape key */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !chatWindow.hidden) {
      closeChat();
    }
  });

  /* =============================================
     Append a message bubble to the conversation
     ============================================= */
  function appendMessage(role, text) {
    const bubble = document.createElement('div');
    bubble.classList.add('chat-msg', role);   // role: 'user' | 'assistant' | 'error'
    bubble.textContent = text;
    messages.appendChild(bubble);

    /* Scroll to the latest message */
    messages.scrollTop = messages.scrollHeight;
  }

  /* =============================================
     Set UI to loading / idle state
     ============================================= */
  function setLoading(isLoading) {
    loading.hidden  = !isLoading;
    sendBtn.disabled = isLoading;
    input.disabled   = isLoading;

    if (isLoading) {
      messages.scrollTop = messages.scrollHeight;
    }
  }

  /* =============================================
     Send a message to /api/chat
     ============================================= */
  async function sendMessage() {
    const userText = input.value.trim();
    if (!userText) return;

    /* Show the user's message immediately */
    appendMessage('user', userText);
    input.value = '';

    /* Add to history before sending */
    history.push({ role: 'user', content: userText });

    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history })
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        /* Server returned an error — show it as an error bubble */
        const errText = data.error || 'Something went wrong. Please try again.';
        appendMessage('error', '⚠️ ' + errText);

        /* Remove the failed user turn from history so the user can retry */
        history.pop();
        return;
      }

      /* Success — show assistant reply and add to history */
      appendMessage('assistant', data.reply);
      history.push({ role: 'assistant', content: data.reply });

    } catch (networkErr) {
      /* Network failure (server not running, etc.) */
      appendMessage(
        'error',
        '⚠️ Could not reach the server. Make sure the Node.js server is running on http://localhost:3000.'
      );
      /* Roll back the failed user message */
      history.pop();
    } finally {
      setLoading(false);
      input.focus();
    }
  }

  /* =============================================
     Event listeners for Send button and Enter key
     ============================================= */
  sendBtn.addEventListener('click', sendMessage);

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

})();
