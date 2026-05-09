// AI Assistant Functionality
const aiAssistant = {
    init(containerId) {
        // containerId should point to a wrapper that contains the toggle and the chat elements
        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.warn('AI Assistant: container not found for id', containerId);
            return;
        }

        // Prefer querying within the provided container so multiple instances would work
        this.aiToggle = this.container.querySelector('.ai-toggle') || document.querySelector('.ai-toggle');
        this.aiChat = this.container.querySelector('.ai-chat-container') || document.querySelector('.ai-chat-container');
        this.aiClose = this.container.querySelector('.ai-close') || document.querySelector('.ai-close');
        this.aiMessages = this.container.querySelector('.ai-chat-messages') || document.querySelector('.ai-chat-messages');
        this.aiInput = this.container.querySelector('#aiInput') || this.container.querySelector('#ai-input') || document.querySelector('#aiInput') || document.querySelector('#ai-input') || this.container.querySelector('.ai-input');
        this.aiSend = this.container.querySelector('#aiSend') || this.container.querySelector('#ai-send') || document.querySelector('#aiSend') || document.querySelector('#ai-send') || this.container.querySelector('.ai-send');
        this.aiTyping = this.container.querySelector('.ai-typing') || document.querySelector('.ai-typing');
        // Support new button-based toggle (#aiSearchToggleBtn) or old checkbox for backward compatibility
        this.aiSearchBtn = this.container.querySelector('#aiSearchToggleBtn') || document.querySelector('#aiSearchToggleBtn');
        this.aiSearchToggle = this.container.querySelector('.ai-search-toggle input') || document.querySelector('.ai-search-toggle input');
        // Normalize a checked state accessor
        if (!this.aiSearchToggle) {
            if (!this.aiSearchBtn) {
                this.aiSearchToggle = { checked: false };
            } else {
                // create a small adapter object reading aria-pressed
                this.aiSearchToggle = {
                    get checked() {
                        return (this._btn && this._btn.getAttribute('aria-pressed') === 'true');
                    },
                    setBtn(btn) { this._btn = btn; }
                };
                this.aiSearchToggle.setBtn(this.aiSearchBtn);
            }
        }

        this.lastUserMessage = '';
        this.setupEventListeners();
    },

    setupEventListeners() {
        // Toggle AI chat
        if (this.aiToggle && this.aiChat) {
            this.aiToggle.addEventListener('click', () => {
                this.aiChat.classList.toggle('active');
            });
        } else {
            if (!this.aiToggle) console.warn('AI Assistant: aiToggle element not found');
            if (!this.aiChat) console.warn('AI Assistant: aiChat element not found');
        }

        // Close AI chat
        if (this.aiClose && this.aiChat) {
            this.aiClose.addEventListener('click', () => {
                this.aiChat.classList.remove('active');
            });
        }

        // Send message
        if (this.aiSend) {
            this.aiSend.addEventListener('click', () => this.sendMessage());
        }

        // Wire up new search toggle button if present
        if (this.aiSearchBtn) {
            this.aiSearchBtn.addEventListener('click', () => {
                const pressed = this.aiSearchBtn.getAttribute('aria-pressed') === 'true';
                this.aiSearchBtn.setAttribute('aria-pressed', (!pressed).toString());
                // sync adapter if exists
                if (this.aiSearchToggle && typeof this.aiSearchToggle.setBtn === 'function') this.aiSearchToggle.setBtn(this.aiSearchBtn);
            });
        }

        if (this.aiInput) {
            this.aiInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.sendMessage();
                }
            });
        }
    },

    // sendMessage accepts optional message param for retries; addUser controls whether to append a user bubble
    async sendMessage(messageParam, addUser = true) {
        const message = (typeof messageParam === 'string') ? messageParam : ((this.aiInput && this.aiInput.value) ? this.aiInput.value.trim() : '');
        if (!message) return;

        // store last message for retry
        this.lastUserMessage = message;

        if (addUser) {
            // Add user message to chat
            this.addMessage(message, 'user');
            if (this.aiInput) this.aiInput.value = '';
        }

        // Show typing indicator (skeleton)
        if (this.aiTyping && this.aiTyping.classList) this.aiTyping.classList.add('active');

        // Process message via unified /api/ai endpoint (passes searchMode flag)
        try {
            const useWebSearch = !!(this.aiSearchToggle && this.aiSearchToggle.checked);
            const resp = await fetch('https://hotel-maxx-backend.onrender.com/api/ai', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: message, searchMode: useWebSearch })
            });

            if (!resp.ok) {
                const txt = await resp.text();
                // If server returned the friendly rate-limit message, present it directly
                if (typeof txt === 'string' && txt.includes('We are sorry for interruption')) {
                    throw new Error(txt);
                }
                throw new Error(`AI request failed: ${txt}`);
            }

            const data = await resp.json();

            // Hide typing indicator
            if (this.aiTyping && this.aiTyping.classList) this.aiTyping.classList.remove('active');

            // If search error occurred, show a small informative message
            if (data && data.searchError) {
                const errMsg = `Web search unavailable: ${data.searchError.message || data.searchError}`;
                this.addMessage(errMsg, 'bot');
            }

            // If sources were returned, present a Sources toggle button above the answer
            if (data && Array.isArray(data.sources) && data.sources.length) {
                this._insertSourcesElement(data.sources);
            }

            if (data && typeof data === 'object' && data.response) {
                this.addMessage(data.response, 'bot', { fallback: !!data.fallback, detail: data.detail });
            } else {
                this.addMessage(String(data), 'bot');
            }
        } catch (error) {
            console.error('Error processing message:', error);
            if (this.aiTyping && this.aiTyping.classList) this.aiTyping.classList.remove('active');
            const userMessage = (error && error.message) ? error.message : 'Sorry, I encountered an error. Please try again.';
            this.addMessage(userMessage, 'bot');
        }
    },

    addMessage(text, sender, meta = {}) {
        if (sender === 'bot') {
            this.revealMessage(text, meta);
            return;
        }

        const messageElement = document.createElement('div');
        messageElement.classList.add('ai-message', sender);
        messageElement.textContent = text;
        this.aiMessages.appendChild(messageElement);

        // Check if user is at the bottom before auto-scrolling
        const isAtBottom = this.aiMessages.scrollHeight - this.aiMessages.scrollTop === this.aiMessages.clientHeight;
        if (isAtBottom) {
            this.aiMessages.scrollTop = this.aiMessages.scrollHeight;
        }
    },

    // Reveal text progressively for bot responses
    revealMessage(text, meta = {}) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('ai-message', 'bot');
        const content = document.createElement('div');
        content.classList.add('ai-bot-content');
        messageElement.appendChild(content);
        this.aiMessages.appendChild(messageElement);
        // Only auto-scroll if user was at the bottom when the message started
        const wasAtBottom = (this.aiMessages.scrollHeight - this.aiMessages.scrollTop === this.aiMessages.clientHeight);

        // Fallback if text is short — show immediately
        if (!text || text.length < 40) {
            content.innerHTML = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            if (wasAtBottom) this.aiMessages.scrollTop = this.aiMessages.scrollHeight;
            if (meta.fallback) this._attachRetry(messageElement);
            return;
        }

        // Reveal in chunks
    const sanitized = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        let i = 0;
        const total = sanitized.length;
        // Determine speed: larger messages reveal at slightly faster per-char pace
        const baseDelay = Math.max(8, 28 - Math.min(18, Math.floor(total / 40)) ); // ms per char

        const chunk = () => {
            i++;
            content.innerHTML = sanitized.slice(0, i);
            if (wasAtBottom) this.aiMessages.scrollTop = this.aiMessages.scrollHeight;
            if (i < total) {
                setTimeout(chunk, baseDelay);
            } else {
                if (meta.fallback) this._attachRetry(messageElement);
            }
        };

        // Start small immediate partial reveal to feel responsive
        content.innerHTML = sanitized.slice(0, Math.min(6, total));
        if (wasAtBottom) this.aiMessages.scrollTop = this.aiMessages.scrollHeight;
        setTimeout(chunk, 60);
    },

    _attachRetry(messageElement) {
        // attach a Try Again button at the end of this bot message
        const actions = document.createElement('div');
        actions.classList.add('ai-bot-actions');
        const retry = document.createElement('button');
        retry.classList.add('ai-retry-btn');
        retry.textContent = 'Try again';
        retry.addEventListener('click', () => {
            // remove the actions to prevent double clicks and show spinner
            actions.remove();
            // resend last user message
            if (this.lastUserMessage) this.sendMessage(this.lastUserMessage, false);
        });
        actions.appendChild(retry);
        messageElement.appendChild(actions);
        this.aiMessages.scrollTop = this.aiMessages.scrollHeight;
    },

    // Insert a bot message that contains a Sources toggle and a collapsible list of sources
    _insertSourcesElement(sources) {
        try {
            const messageElement = document.createElement('div');
            messageElement.classList.add('ai-message', 'bot', 'ai-sources');

            const header = document.createElement('div');
            header.classList.add('ai-sources-header');

            const btn = document.createElement('button');
            btn.classList.add('ai-sources-btn');
            btn.textContent = `Sources (${sources.length})`;
            btn.setAttribute('aria-pressed', 'false');

            header.appendChild(btn);
            messageElement.appendChild(header);

            const panel = document.createElement('div');
            panel.classList.add('ai-sources-panel');
            panel.style.display = 'none';
            panel.style.padding = '8px 12px';
            panel.style.borderTop = '1px solid #eee';

            sources.forEach(s => {
                const item = document.createElement('div');
                item.classList.add('ai-source-item');
                const a = document.createElement('a');
                a.href = s.link || '#';
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                a.textContent = s.title || s.link || 'source';
                a.style.display = 'block';
                a.style.fontWeight = '600';
                a.style.marginBottom = '4px';

                const snip = document.createElement('div');
                snip.classList.add('ai-source-snippet');
                snip.textContent = s.snippet || '';
                snip.style.fontSize = '90%';
                snip.style.color = '#333';
                snip.style.marginBottom = '10px';

                item.appendChild(a);
                item.appendChild(snip);
                panel.appendChild(item);
            });

            btn.addEventListener('click', () => {
                const isOpen = panel.style.display === 'block';
                panel.style.display = isOpen ? 'none' : 'block';
                btn.setAttribute('aria-pressed', (!isOpen).toString());
                // If user was at bottom, keep it scrolled when opening
                const isAtBottom = this.aiMessages.scrollHeight - this.aiMessages.scrollTop === this.aiMessages.clientHeight;
                if (isAtBottom) this.aiMessages.scrollTop = this.aiMessages.scrollHeight;
            });

            messageElement.appendChild(panel);
            this.aiMessages.appendChild(messageElement);
            const isAtBottom = this.aiMessages.scrollHeight - this.aiMessages.scrollTop === this.aiMessages.clientHeight;
            if (isAtBottom) this.aiMessages.scrollTop = this.aiMessages.scrollHeight;
        } catch (e) {
            console.error('Error inserting sources element:', e);
        }
    },

    async searchWeb(query) {
    const url = 'https://hotel-maxx-backend.onrender.com/api/search';
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ query })
            });
            if (!response.ok) {
                throw new Error('Search request failed');
            }
            const data = await response.json();
            return data.results;
        } catch (error) {
            console.error('Search error:', error);
            throw error;
        }
    },


    async queryGemini(message, searchResults = '') {
    const url = 'https://hotel-maxx-backend.onrender.com/api/gemini';
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ message, searchResults })
            });
            const dataText = await response.text();
            let data;
            try {
                data = JSON.parse(dataText);
            } catch (e) {
                // Not JSON — return raw text
                if (!response.ok) {
                    // If server returned the friendly rate-limit message, surface it without the prefix
                    if (typeof dataText === 'string' && dataText.includes('We are sorry for interruption')) {
                        throw new Error(dataText);
                    }
                    throw new Error(`Gemini API request failed: ${dataText}`);
                }
                return dataText;
            }

            if (!response.ok) {
                // Prefer the `detail` or `details` fields, fall back to `error` or full JSON
                const detailRaw = data.detail || data.details || data.error || data;
                let detail = (typeof detailRaw === 'string') ? detailRaw : JSON.stringify(detailRaw, null, 2);
                if (detail.length > 1000) detail = detail.slice(0, 1000) + '... (truncated)';
                throw new Error(`Gemini API request failed: ${detail}`);
            }

            return data.response;
        } catch (error) {
            console.error('Gemini API error:', error);
            throw error;
        }
    }
};

// Export for use in other files
window.aiAssistant = aiAssistant;