/**
 * ============================================================
 *  SKYCLAW AI — Frontend Application
 *  Chat engine, model selector, conversation manager,
 *  markdown rendering, streaming, and UI interactions
 * ============================================================
 */

// ─── State ───────────────────────────────────────────────────
const state = {
  conversations: JSON.parse(localStorage.getItem('ag_conversations') || '[]'),
  activeConvId: localStorage.getItem('ag_activeConv') || null,
  models: {},
  selectedModel: localStorage.getItem('ag_model') || '',
  selectedProvider: localStorage.getItem('ag_provider') || '',
  systemPrompt: localStorage.getItem('ag_systemPrompt') || '',
  temperature: parseFloat(localStorage.getItem('ag_temperature') || '0.7'),
  isStreaming: false,
  abortController: null,
};

// ─── DOM References ──────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const chatMessages = $('#chatMessages');
const welcomeScreen = $('#welcomeScreen');
const messageInput = $('#messageInput');
const sendBtn = $('#sendBtn');
const stopBtn = $('#stopBtn');
const modelSelector = $('#modelSelector');
const providerBadge = $('#providerBadge');
const conversationList = $('#conversationList');
const charCount = $('#charCount');
const sidebar = $('#sidebar');

// ─── Init ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadModels();
  renderConversations();
  loadActiveConversation();
  setupEventListeners();
  setupMarkdown();
  restoreSettings();
});

// ═══════════════════════════════════════════════════════════════
//  MODELS
// ═══════════════════════════════════════════════════════════════

async function loadModels() {
  try {
    const res = await fetch('/api/models');
    state.models = await res.json();
    populateModelSelector();
  } catch (err) {
    console.error('Failed to load models:', err);
  }
}

function populateModelSelector() {
  modelSelector.innerHTML = '';
  const providers = { openrouter: 'OpenRouter', gemini: 'Gemini', groq: 'Groq ⚡' };

  for (const [key, label] of Object.entries(providers)) {
    const models = state.models[key];
    if (!models || !models.length) continue;
    const group = document.createElement('optgroup');
    group.label = label;
    for (const m of models) {
      const opt = document.createElement('option');
      opt.value = `${key}::${m.id}`;
      opt.textContent = m.name;
      if (state.selectedModel === m.id && state.selectedProvider === key) opt.selected = true;
      group.appendChild(opt);
    }
    modelSelector.appendChild(group);
  }

  // Set default if none selected
  if (!state.selectedModel && modelSelector.options.length) {
    const first = modelSelector.value.split('::');
    state.selectedProvider = first[0];
    state.selectedModel = first[1];
  }
  updateProviderBadge();
}

function updateProviderBadge() {
  const labels = { openrouter: 'OpenRouter', gemini: 'Gemini', groq: 'Groq ⚡' };
  providerBadge.textContent = labels[state.selectedProvider] || 'AI';
  providerBadge.className = 'model-badge';
}

// ═══════════════════════════════════════════════════════════════
//  CONVERSATIONS
// ═══════════════════════════════════════════════════════════════

function createConversation() {
  const conv = {
    id: 'conv_' + Date.now(),
    title: 'New Chat',
    messages: [],
    createdAt: Date.now(),
  };
  state.conversations.unshift(conv);
  state.activeConvId = conv.id;
  saveConversations();
  renderConversations();
  renderMessages();
  messageInput.focus();
}

function deleteConversation(id) {
  state.conversations = state.conversations.filter(c => c.id !== id);
  if (state.activeConvId === id) {
    state.activeConvId = state.conversations[0]?.id || null;
  }
  saveConversations();
  renderConversations();
  renderMessages();
}

function switchConversation(id) {
  state.activeConvId = id;
  localStorage.setItem('ag_activeConv', id);
  renderConversations();
  renderMessages();
  // Close sidebar on mobile
  if (window.innerWidth <= 768) sidebar.classList.remove('open');
}

function getActiveConversation() {
  return state.conversations.find(c => c.id === state.activeConvId);
}

function saveConversations() {
  localStorage.setItem('ag_conversations', JSON.stringify(state.conversations));
  localStorage.setItem('ag_activeConv', state.activeConvId || '');
}

function renderConversations() {
  const search = ($('#searchConversations')?.value || '').toLowerCase();
  const filtered = state.conversations.filter(c => c.title.toLowerCase().includes(search));

  conversationList.innerHTML = filtered.map(c => `
    <div class="conv-item ${c.id === state.activeConvId ? 'active' : ''}" data-id="${c.id}">
      <span class="conv-item-title">${escapeHtml(c.title)}</span>
      <button class="conv-item-delete" data-delete="${c.id}" title="Delete">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `).join('');

  // Bind clicks
  conversationList.querySelectorAll('.conv-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-delete]')) return;
      switchConversation(el.dataset.id);
    });
  });
  conversationList.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', () => deleteConversation(btn.dataset.delete));
  });
}

function loadActiveConversation() {
  if (state.activeConvId && getActiveConversation()) {
    renderMessages();
  } else if (state.conversations.length) {
    state.activeConvId = state.conversations[0].id;
    renderMessages();
  }
  renderConversations();
}

// ═══════════════════════════════════════════════════════════════
//  MESSAGES & RENDERING
// ═══════════════════════════════════════════════════════════════

function renderMessages() {
  const conv = getActiveConversation();
  if (!conv || conv.messages.length === 0) {
    welcomeScreen.classList.remove('hidden');
    // Remove all messages but keep welcome screen
    chatMessages.querySelectorAll('.message').forEach(el => el.remove());
    return;
  }
  welcomeScreen.classList.add('hidden');

  // Clear and re-render
  chatMessages.querySelectorAll('.message').forEach(el => el.remove());
  for (const msg of conv.messages) {
    appendMessageToDOM(msg.role, msg.content, false);
  }
  scrollToBottom();
}

function appendMessageToDOM(role, content, animate = true) {
  const div = document.createElement('div');
  div.className = `message ${role}`;
  if (animate) div.style.animation = 'fadeInUp 0.3s ease';

  const avatarLabel = role === 'user' ? 'U' : 'A';
  div.innerHTML = `
    <div class="message-avatar">${avatarLabel}</div>
    <div class="message-body">
      <div class="message-role">${role === 'user' ? 'You' : 'Skyclaw'}</div>
      <div class="message-content">${role === 'user' ? escapeHtml(content) : renderMarkdown(content)}</div>
    </div>
  `;
  chatMessages.appendChild(div);
  // Highlight code blocks
  div.querySelectorAll('pre code').forEach(block => {
    try { hljs.highlightElement(block); } catch {}
  });
  addCopyButtons(div);
  return div;
}

function addCopyButtons(container) {
  container.querySelectorAll('pre').forEach(pre => {
    if (pre.parentElement.classList.contains('code-block-wrapper')) return;
    const code = pre.querySelector('code');
    const lang = code?.className?.match(/language-(\w+)/)?.[1] || 'code';
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block-wrapper';
    wrapper.innerHTML = `<div class="code-block-header"><span>${lang}</span><button class="copy-code-btn">Copy</button></div>`;
    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);
    wrapper.querySelector('.copy-code-btn').addEventListener('click', function() {
      navigator.clipboard.writeText(code?.textContent || pre.textContent);
      this.textContent = 'Copied!';
      setTimeout(() => this.textContent = 'Copy', 1500);
    });
  });
}

function scrollToBottom() {
  const container = $('#chatContainer');
  container.scrollTop = container.scrollHeight;
}

// ═══════════════════════════════════════════════════════════════
//  SEND MESSAGE & STREAMING
// ═══════════════════════════════════════════════════════════════

async function sendMessage(text) {
  if (!text.trim() || state.isStreaming) return;

  // Create conversation if needed
  if (!getActiveConversation()) createConversation();
  const conv = getActiveConversation();

  // Hide welcome, add user message
  welcomeScreen.classList.add('hidden');
  conv.messages.push({ role: 'user', content: text });
  appendMessageToDOM('user', text);
  scrollToBottom();

  // Auto-title from first message
  if (conv.messages.length === 1) {
    conv.title = text.slice(0, 60) + (text.length > 60 ? '...' : '');
    renderConversations();
  }

  // Prepare streaming
  state.isStreaming = true;
  state.abortController = new AbortController();
  sendBtn.classList.add('hidden');
  stopBtn.classList.remove('hidden');
  messageInput.value = '';
  messageInput.style.height = 'auto';
  updateCharCount();

  // Create assistant message placeholder
  const assistantDiv = appendMessageToDOM('assistant', '');
  const contentEl = assistantDiv.querySelector('.message-content');
  contentEl.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';

  let fullResponse = '';

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: conv.messages.filter(m => m.role !== 'system'),
        model: state.selectedModel,
        provider: state.selectedProvider,
        systemPrompt: state.systemPrompt || undefined,
      }),
      signal: state.abortController.signal,
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') break;

        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            fullResponse += `\n\n**Error:** ${parsed.error}`;
            break;
          }
          if (parsed.content) {
            fullResponse += parsed.content;
            contentEl.innerHTML = renderMarkdown(fullResponse);
            contentEl.querySelectorAll('pre code').forEach(block => {
              try { hljs.highlightElement(block); } catch {}
            });
            addCopyButtons(contentEl);
            scrollToBottom();
          }
        } catch {}
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      fullResponse += '\n\n*[Generation stopped]*';
    } else {
      fullResponse = `**Error:** ${err.message}`;
    }
  }

  // Finalize
  contentEl.innerHTML = renderMarkdown(fullResponse || '*No response received.*');
  contentEl.querySelectorAll('pre code').forEach(block => {
    try { hljs.highlightElement(block); } catch {}
  });
  addCopyButtons(contentEl);

  conv.messages.push({ role: 'assistant', content: fullResponse });
  saveConversations();

  state.isStreaming = false;
  state.abortController = null;
  sendBtn.classList.remove('hidden');
  stopBtn.classList.add('hidden');
  sendBtn.disabled = true;
  scrollToBottom();
}

function stopGeneration() {
  if (state.abortController) state.abortController.abort();
}

// ═══════════════════════════════════════════════════════════════
//  MARKDOWN RENDERING
// ═══════════════════════════════════════════════════════════════

function setupMarkdown() {
  if (typeof marked !== 'undefined') {
    marked.setOptions({
      breaks: true,
      gfm: true,
      headerIds: false,
      mangle: false,
    });
  }
}

function renderMarkdown(text) {
  if (!text) return '';
  try {
    // Handle LaTeX blocks
    let processed = text
      .replace(/\$\$([\s\S]*?)\$\$/g, (_, expr) => {
        try { return katex.renderToString(expr.trim(), { displayMode: true }); } catch { return `$$${expr}$$`; }
      })
      .replace(/\$([^\$\n]+?)\$/g, (_, expr) => {
        try { return katex.renderToString(expr.trim(), { displayMode: false }); } catch { return `$${expr}$`; }
      });
    return marked.parse(processed);
  } catch {
    return escapeHtml(text);
  }
}

// ═══════════════════════════════════════════════════════════════
//  EXPORT
// ═══════════════════════════════════════════════════════════════

function exportConversation() {
  const conv = getActiveConversation();
  if (!conv || !conv.messages.length) return;

  let md = `# ${conv.title}\n\n`;
  for (const msg of conv.messages) {
    md += `## ${msg.role === 'user' ? 'You' : 'Antigravity AI'}\n\n${msg.content}\n\n---\n\n`;
  }

  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${conv.title.replace(/[^a-z0-9]/gi, '_')}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════
//  EVENT LISTENERS
// ═══════════════════════════════════════════════════════════════

function setupEventListeners() {
  // Send
  sendBtn.addEventListener('click', () => sendMessage(messageInput.value));
  stopBtn.addEventListener('click', stopGeneration);

  // Input
  messageInput.addEventListener('input', () => {
    sendBtn.disabled = !messageInput.value.trim();
    autoResize(messageInput);
    updateCharCount();
  });

  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (messageInput.value.trim() && !state.isStreaming) sendMessage(messageInput.value);
    }
  });

  // Model selector
  modelSelector.addEventListener('change', () => {
    const [provider, model] = modelSelector.value.split('::');
    state.selectedProvider = provider;
    state.selectedModel = model;
    localStorage.setItem('ag_model', model);
    localStorage.setItem('ag_provider', provider);
    updateProviderBadge();
  });

  // New chat
  $('#newChatBtn').addEventListener('click', createConversation);

  // Search
  $('#searchConversations').addEventListener('input', renderConversations);

  // Sidebar toggle
  $('#sidebarToggle').addEventListener('click', () => sidebar.classList.toggle('open'));

  // Export
  $('#exportBtn').addEventListener('click', exportConversation);

  // Settings
  $('#settingsBtn').addEventListener('click', () => $('#settingsModal').classList.remove('hidden'));
  $('#closeSettings').addEventListener('click', () => $('#settingsModal').classList.add('hidden'));
  $('#settingsModal').addEventListener('click', (e) => {
    if (e.target === $('#settingsModal')) $('#settingsModal').classList.add('hidden');
  });

  // System prompt
  $('#systemPromptInput').addEventListener('input', (e) => {
    state.systemPrompt = e.target.value;
    localStorage.setItem('ag_systemPrompt', state.systemPrompt);
  });

  // Temperature
  $('#temperatureSlider').addEventListener('input', (e) => {
    state.temperature = parseFloat(e.target.value);
    $('#temperatureValue').textContent = state.temperature.toFixed(1);
    localStorage.setItem('ag_temperature', state.temperature);
  });

  // Clear all
  $('#clearAllBtn').addEventListener('click', () => {
    if (confirm('Delete all conversations? This cannot be undone.')) {
      state.conversations = [];
      state.activeConvId = null;
      saveConversations();
      renderConversations();
      renderMessages();
      $('#settingsModal').classList.add('hidden');
    }
  });

  // Welcome chips
  document.querySelectorAll('.welcome-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const prompt = chip.dataset.prompt;
      messageInput.value = prompt;
      sendBtn.disabled = false;
      sendMessage(prompt);
    });
  });
}

function restoreSettings() {
  $('#systemPromptInput').value = state.systemPrompt;
  $('#temperatureSlider').value = state.temperature;
  $('#temperatureValue').textContent = state.temperature.toFixed(1);
}

// ═══════════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════════

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function autoResize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
}

function updateCharCount() {
  charCount.textContent = messageInput.value.length;
}
